#!/usr/bin/env python3
"""Seven balance lenses over one rehearsal's ledgers: time, acts, speech, thought, culture, cost, targets.
Every lens prints what it measured beside the phase 2 and phase 4 numbers the village-turn plan asks for."""
# usage: python3 scripts/balance.py <rehearsal-dir>   (the dir holding dev-world.db and minds/*.db)

import collections
import json
import math
import os
import re
import shutil
import sqlite3
import statistics
import sys
import tempfile

DAY = 1440
WATCHED_DAY = 30
COST_TARGET = 'under $0.30'
COST_NOTE = (f'A watched day is one real day at 1x = {WATCHED_DAY} sim-days, so the plan\'s '
             f'"$9 per watched day for 12 minds" is {COST_TARGET} per sim-day for 12 minds.')
EARSHOT = 8
REPLY_TICKS = 30
CHAIN_TICKS = 60
MOMENTS = ('agent_died', 'co_slept', 'agent_tended', 'discovery_made', 'agent_expressed',
           'agent_born', 'agent_conceived', 'fire_ignited', 'partnership_formed',
           'partnership_dissolved', 'stranger_arrived')

SURVIVAL_V = {'eat', 'drink', 'fill', 'sleep', 'wake', 'stoke', 'kindle'}
MOVE_V = {'walk', 'take', 'drop', 'stow', 'give', 'enter', 'exit'}
MAKING_V = {'build', 'chop', 'craft', 'forage', 'fish', 'till', 'plant', 'harvest', 'hunt'}
NOTES_V = {'read', 'write', 'inscribe'}
SOCIAL_V = {'speak', 'tend', 'teach', 'court', 'propose', 'lie_with', 'leave_partner'}
WORKCARRY_V = {'build', 'chop', 'craft', 'forage', 'fish', 'till', 'plant', 'harvest',
               'carry', 'fill', 'stow', 'take', 'drop'}
EATTEND_V = {'eat', 'drink', 'tend'}

TASK_RE = re.compile(r"\b(wood|plank|planks|bread|loaf|loaves|water|well|fill|build|building|house|wall|roof|berries|berry|bush|bushes|fish|fishing|bucket|stow|hearth|fire|firewood|skin|waterskin|soup|storehouse|store|count|counted|tally|take|took|drop|walk|north|south|east|west|herb|herbs|nail|nails|stone|axe|tool|tools|field|till|forage|foraging|chop|chopping|haul|carry|carrying|bed|sleep|eat|eaten|drink|hungry|thirsty|thirst|hunger|cold|warm|dry|rain|stock|supplies|rota|shift|work|job|fetch|note|notes|page|write|written|farmhouse|cabin|cottage|plot|door|doorway|tiles|grave|marker|kindle|stoke|log|logs)\b", re.I)
FEEL_RE = re.compile(r"\b(you|your|yours|we|us|our|miss|missed|sorry|worried|worry|care|cared|trust|trusted|love|loved|hate|hated|angry|anger|glad|happy|sad|afraid|fear|scared|lonely|alone|thank|thanks|friend|friends|kind|cruel|hurt|forgive|proud|ashamed|jealous|fond|mean|nice|company|together|beside|promise|promised|owe|owed|debt|fault|blame|lie|lied|honest|truth|laugh|laughed|smile|smiled|cry|cried|tears|heart|hold|held|hand|hands)\b", re.I)
WONDER_RE = re.compile(r"\b(sky|clouds?|stars?|moon|sun|light|dawn|dusk|river|mountain|mountains|valley|ridge|sea|wind|storm|strange|odd|wonder|wondering|beautiful|quiet|still|silence|silent|why|how come|what if|maybe|perhaps|used to|before|once|remember|remembered|story|stories|world|god|gods|spirit|dead|death|die|died|dying|born|life|lives|ghost|dream|dreamt|dreamed|old|young|age|years|season|spring|winter|summer|autumn)\b", re.I)
SURV_RE = re.compile(r"\b(hungry|hunger|stomach|gnaw|gnawing|starv|thirst|thirsty|parched|dry throat|cold|freez|shiver|warm|tired|exhaust|weary|worn|legs|collapse|dizzy|faint|sleep|bed|rest|eat|drink|water|bread|food|fire|hearth|wood)\b", re.I)


def stage(src):
    tmp = tempfile.mkdtemp(prefix='balance-')
    for sub in ('', 'minds'):
        d = os.path.join(src, sub)
        if not os.path.isdir(d):
            continue
        out = os.path.join(tmp, sub)
        os.makedirs(out, exist_ok=True)
        for f in sorted(os.listdir(d)):
            if '.db' in f and os.path.isfile(os.path.join(d, f)):
                shutil.copy2(os.path.join(d, f), os.path.join(out, f))
    return tmp


def opendb(path):
    if not os.path.exists(path):
        return None
    try:
        con = sqlite3.connect(path)
        con.execute('select 1').fetchone()
        return con
    except sqlite3.Error:
        return None


def q(con, sql, *a):
    if con is None:
        return []
    try:
        return con.execute(sql, a).fetchall()
    except sqlite3.Error:
        return []


def one(con, sql, default=0):
    r = q(con, sql)
    if not r or r[0][0] is None:
        return default
    return r[0][0]


def has_table(con, name):
    return bool(q(con, "select 1 from sqlite_master where type='table' and name=?", name))


def pct(x, n):
    return f'{100 * x / n:.0f}%' if n else 'n/a'


def num(x, n, places=1):
    return f'{x / n:.{places}f}' if n else 'n/a'


def rate(x, n, unit, places=2):
    return f'{x / n:.{places}f}{unit}' if n else 'n/a'


def table(rows, head):
    out = ['| ' + ' | '.join(head) + ' |', '|' + '---|' * len(head)]
    for r in rows:
        out.append('| ' + ' | '.join(str(c) for c in r) + ' |')
    return '\n'.join(out)


def load_events(con):
    ev = []
    for tick, ty, payload in q(con, 'select tick,type,payload from events order by seq'):
        try:
            p = json.loads(payload)
        except (ValueError, TypeError):
            p = {}
        ev.append((tick, ty, p if isinstance(p, dict) else {}))
    return ev


def roster_of(ev, minds_dir):
    names = []
    for _, ty, p in ev:
        if ty in ('agent_spawned', 'agent_born', 'stranger_arrived'):
            a = p.get('agentId') or p.get('id') or p.get('childId')
            if a and a not in names:
                names.append(a)
    if os.path.isdir(minds_dir):
        for f in sorted(os.listdir(minds_dir)):
            if f.endswith('.db') and not f.startswith('_'):
                a = f[:-3]
                if a not in names:
                    names.append(a)
    if not names:
        for _, ty, p in ev:
            a = p.get('agentId')
            if a and a not in names:
                names.append(a)
    return names


def cat_of(verb):
    if verb == 'walk':
        return 'w'
    if verb in WORKCARRY_V:
        return 'k'
    if verb in EATTEND_V:
        return 'e'
    if verb in NOTES_V:
        return 'n'
    if verb in ('sleep', 'wake'):
        return 's'
    return 'o'


def time_budget(ev, roster, max_tick):
    spawn = {n: 0 for n in roster}
    for t, ty, p in ev:
        if ty in ('agent_born', 'stranger_arrived') and p.get('agentId') in spawn:
            spawn[p['agentId']] = t
    alive_to = {n: max_tick for n in roster}
    for t, ty, p in ev:
        if ty == 'agent_died' and p.get('agentId') in alive_to:
            alive_to[p['agentId']] = t
    state = {n: bytearray(b'i' * (max_tick + 2)) for n in roster}
    cur = {}
    sleep_start = {}
    scene_open = {}

    def close(agent, end):
        if agent in cur:
            t0, c = cur.pop(agent)
            end = max(end, t0 + 1)
            arr = state[agent]
            for x in range(t0, min(end, alive_to[agent] + 1)):
                if arr[x] == ord('i'):
                    arr[x] = ord(c)

    def paint(agent, t0, t1, c):
        if agent not in state:
            return
        for x in range(max(t0, 0), min(t1, alive_to[agent]) + 1):
            state[agent][x] = ord(c)

    for t, ty, p in ev:
        a = p.get('agentId')
        if ty == 'action_started' and a in state:
            close(a, t)
            cur[a] = (t, cat_of(p.get('verb', '')))
        elif ty in ('action_completed', 'action_interrupted') and a in state:
            close(a, t)
        elif ty == 'agent_slept' and a in state:
            sleep_start[a] = t
        elif ty == 'agent_woke' and a in state:
            if a in sleep_start:
                paint(a, sleep_start.pop(a), t, 's')
        elif ty == 'scene_opened':
            scene_open[p.get('id')] = (t, p.get('participants') or [])
        elif ty == 'scene_closed' and p.get('id') in scene_open:
            t0, parts = scene_open.pop(p['id'])
            for m in parts:
                paint(m, t0, t, 'c')
        elif ty == 'scene_line' and a in state:
            if state[a][t] not in (ord('c'), ord('s')):
                state[a][t] = ord('c')
        elif ty == 'agent_spoke' and a in state:
            if state[a][t] == ord('i'):
                state[a][t] = ord('v')
    for a in list(cur):
        close(a, alive_to[a])
    for a, t0 in sleep_start.items():
        paint(a, t0, alive_to[a], 's')
    for t0, parts in scene_open.values():
        for m in parts:
            paint(m, t0, alive_to.get(m, max_tick), 'c')
    out = {}
    for n in roster:
        lo, hi = spawn[n] + 1, alive_to[n] + 1
        counts = collections.Counter(chr(b) for b in state[n][lo:hi])
        out[n] = (max(hi - lo, 0), counts)
    return out


def dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def near(pa, ia, pb, ib):
    return dist(pa, pb) <= EARSHOT or (ia is not None and ia == ib)


def classify(text, name_re):
    task = len(TASK_RE.findall(text))
    feel = len(FEEL_RE.findall(text)) + len(name_re.findall(text))
    won = len(WONDER_RE.findall(text))
    scores = {'task': task, 'people': feel, 'wonder': won}
    if sum(scores.values()) == 0:
        return 'other'
    return max(scores, key=lambda k: (scores[k], {'task': 1, 'people': 2, 'wonder': 3}[k]))


def split_rows(texts, name_re):
    n = len(texts)
    cls = collections.Counter(classify(t, name_re) for t in texts)
    rows = [[k, cls.get(k, 0), pct(cls.get(k, 0), n)] for k in ('task', 'people', 'wonder', 'other')]
    return rows, cls


def main():
    if len(sys.argv) != 2:
        print('usage: python3 scripts/balance.py <rehearsal-dir>')
        return 2
    src = os.path.abspath(sys.argv[1])
    if not os.path.isdir(src):
        print(f'not a directory: {src}')
        return 2
    tmp = stage(src)
    try:
        return report(src, tmp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def report(src, tmp):
    world = opendb(os.path.join(tmp, 'dev-world.db'))
    if world is None:
        print(f'no dev-world.db in {src}')
        return 2
    minds_dir = os.path.join(tmp, 'minds')
    ev = load_events(world)
    max_tick = one(world, 'select max(tick) from events', 0)
    days = max_tick / DAY if max_tick else 0
    roster = roster_of(ev, minds_dir)
    tb = time_budget(ev, roster, max_tick)
    mind_ticks = sum(tb[n][0] for n in roster)
    mind_days = mind_ticks / DAY if mind_ticks else 0
    name_re = re.compile(r'\b(' + '|'.join(re.escape(n.capitalize()) for n in roster) + r')\b') \
        if roster else re.compile(r'(?!x)x')
    types = collections.Counter(ty for _, ty, _ in ev)

    print(f'# balance: {src}')
    print(f'\n{max_tick} ticks = {days:.2f} sim-days; {len(roster)} minds ' +
          f'({", ".join(roster) or "none"}); {mind_days:.2f} mind-days alive.\n')

    print('## 1. Waking hours per mind per sim-day\n')
    pooled = collections.Counter()
    for n in roster:
        pooled += tb[n][1]
    hours = {k: (pooled.get(k, 0) / mind_ticks * 24 if mind_ticks else 0) for k in 'iscwkenov'}
    awake = mind_ticks - pooled.get('s', 0)
    per_mind = {}
    for k in 'iscwkenov':
        per_mind[k] = ', '.join(
            f'{n} {tb[n][1].get(k, 0) / tb[n][0] * 24:.1f}' if tb[n][0] else f'{n} n/a'
            for n in roster)
    scene_lines = types.get('scene_line', 0)
    rows = [
        ['idle (awake, no action)', f'{hours["i"]:.1f}', '8', '6', per_mind['i']],
        ['in scenes', f'{hours["c"]:.1f}', '2', '2.5', per_mind['c']],
        ['work+carry', f'{hours["k"]:.1f}', '3', '4', per_mind['k']],
        ['walk', f'{hours["w"]:.1f}', '1.5', '1.5', per_mind['w']],
        ['eat/drink/tend', f'{hours["e"]:.1f}', '0.5', '0.5', per_mind['e']],
        ['notes (read/write)', f'{hours["n"]:.1f}', '-', '-', per_mind['n']],
        ['other verbs', f'{hours["o"]:.1f}', '-', '-', per_mind['o']],
        ['speaking (outside a scene)', f'{hours["v"]:.1f}', '-', '-', per_mind['v']],
        ['asleep', f'{hours["s"]:.1f}', '-', '-', per_mind['s']],
        ['**awake total**', f'{awake / mind_ticks * 24:.1f}' if mind_ticks else 'n/a', '15', '15', ''],
    ]
    print(table(rows, ['band', 'hours/mind-day', 'target p2', 'target p4', 'per mind']))
    print(f'\nscene_line events: {scene_lines} ({num(scene_lines, mind_days)} per mind-day); ' +
          f'scene_opened {types.get("scene_opened", 0)}, scene_closed {types.get("scene_closed", 0)}.')

    print('\n## 2. Accepted acts per mind-day by class\n')
    arb = opendb(os.path.join(minds_dir, '_arbiter.db'))
    rulings = one(arb, 'select count(*) from rulings')
    attempts = one(arb, "select count(*) from rulings where json_extract(verdict_json,'$.kind')='attempt'")
    verbs = collections.Counter(p.get('verb', '') for _, ty, p in ev if ty == 'action_started')

    def klass(v):
        if v.startswith('recipe:') or v.startswith('act:'):
            return 'invention'
        if v.startswith('express:') or v in SOCIAL_V:
            return 'social'
        if v in SURVIVAL_V:
            return 'survival'
        if v in MOVE_V:
            return 'move+carry'
        if v in MAKING_V:
            return 'making'
        if v in NOTES_V:
            return 'notes'
        return 'other'

    acts = collections.Counter()
    for v, c in verbs.items():
        acts[klass(v)] += c
    minted_acts = acts['invention']
    discoveries = types.get('discovery_made', 0)
    acts['invention'] += discoveries + attempts
    tot_acts = sum(acts.values())
    act_targets = {'survival': ('25%', '15%'), 'move+carry': ('35%', '25%'), 'making': ('10%', '20%'),
                   'notes': ('10%', '5%'), 'social': ('15%', '25%'), 'invention': ('5%', '10%')}
    rows = []
    for k in ('survival', 'move+carry', 'making', 'notes', 'social', 'invention', 'other'):
        t2, t4 = act_targets.get(k, ('-', '-'))
        rows.append([k, acts.get(k, 0), num(acts.get(k, 0), mind_days),
                     pct(acts.get(k, 0), tot_acts), t2, t4])
    rows.append(['**all**', tot_acts, num(tot_acts, mind_days), '100%', '', ''])
    print(table(rows, ['class', 'n', 'per mind-day', 'share', 'target p2', 'target p4']))
    print(f'\ninvention = {minted_acts} recipe:/act: verbs + {discoveries} discovery_made + ' +
          f'{attempts} arbiter rulings that wrote a recipe (verdict "attempt"); ' +
          f'the other {rulings - attempts} rulings were map or impossible.')

    print('\n## 3. Speech\n')
    lines = [(t, p.get('agentId'), p.get('text', ''), (p.get('x', 0), p.get('y', 0)), p.get('insideId'))
             for t, ty, p in ev if ty == 'agent_spoke']
    n = len(lines)
    replies = 0
    for i, (t, a, txt, pos, ins) in enumerate(lines):
        for j in range(i - 1, -1, -1):
            t2, a2, _, pos2, ins2 = lines[j]
            if t - t2 > REPLY_TICKS:
                break
            if a2 != a and near(pos, ins, pos2, ins2):
                replies += 1
                break
    chains = []
    cur = []
    for i, (t, a, txt, pos, ins) in enumerate(lines):
        if cur:
            t2, a2, _, pos2, ins2 = lines[cur[-1]]
            if t - t2 <= CHAIN_TICKS and near(pos, ins, pos2, ins2):
                cur.append(i)
                continue
            chains.append(cur)
        cur = [i]
    if cur:
        chains.append(cur)
    multi = [c for c in chains if len({lines[i][1] for i in c}) >= 2]
    runs = []
    for c in multi:
        run = best = 1
        for k in range(1, len(c)):
            if lines[c[k]][1] != lines[c[k - 1]][1]:
                run += 1
                best = max(best, run)
            else:
                run = 1
        runs.append(best)
    long_runs = sum(1 for r in runs if r >= 4)
    dup = collections.Counter(txt for _, _, txt, _, _ in lines)
    repeats = sum(v - 1 for v in dup.values() if v > 1)
    surv_speech = sum(1 for _, _, txt, _, _ in lines if SURV_RE.search(txt))
    per_agent = collections.Counter(a for _, a, _, _, _ in lines)
    rows = [
        ['lines', n, '-', '-'],
        ['lines per mind-day', num(n, mind_days), '-', '-'],
        ['reply within 30 ticks and 8 tiles', f'{replies} ({pct(replies, n)})', '-', '-'],
        ['exchanges with 2+ speakers', len(multi), '-', '-'],
        ['median longest alternating run', f'{statistics.median(runs):.0f}' if runs else 'n/a', '-', '-'],
        ['exchanges with a run of 4+', f'{long_runs} ({num(long_runs, days)}/sim-day)', '3/day', '5/day'],
        ['verbatim repeats', f'{repeats} ({pct(repeats, n)})', '-', '-'],
        ['survival vocabulary', pct(surv_speech, n), '-', '-'],
    ]
    print(table(rows, ['metric', 'measured', 'target p2', 'target p4']))
    srows, scls = split_rows([l[2] for l in lines], name_re)
    people_wonder = scls.get('people', 0) + scls.get('wonder', 0)
    srows.append(['**people+wonder**', people_wonder, pct(people_wonder, n)])
    print('\nkeyword classes (heuristic; the LLM pass is the number to quote):\n')
    print(table(srows, ['class', 'lines', 'share']))
    print('\nper mind: ' + (', '.join(f'{a}:{c}' for a, c in per_agent.most_common()) or 'none'))

    print('\n## 4. Thoughts (same heuristic; the LLM pass is the number to quote)\n')
    thoughts = q(world, 'select agent_id,text from observer_thoughts order by id') \
        if has_table(world, 'observer_thoughts') else []
    tn = len(thoughts)
    print(f'thoughts {tn} ({num(tn, mind_days, 0)} per mind-day)' if tn
          else 'no observer_thoughts rows: n/a')
    trows, _ = split_rows([t[1] for t in thoughts], name_re)
    surv_th = sum(1 for _, txt in thoughts if SURV_RE.search(txt))
    trows.append(['**survival vocabulary**', surv_th, pct(surv_th, tn)])
    th_targets = {'task': ('35%', '30%'), 'people': ('30%', '35%'), 'wonder': ('10%', '20%'),
                  '**survival vocabulary**': ('25%', '15%')}
    print()
    print(table([r + list(th_targets.get(r[0], ('-', '-'))) for r in trows],
                ['class', 'n', 'share', 'target p2', 'target p4']))

    print('\n## 5. Culture\n')
    rulebook = one(arb, 'select count(*) from rulebook')
    minted_verbs = len({v for v in verbs if v.startswith('recipe:') or v.startswith('act:')})
    laws = sum(c for ty, c in types.items() if ty.startswith('law_'))
    ratified = types.get('law_ratified', 0)
    weeks = days / 7 if days else 0
    rows = [
        ['discoveries (discovery_made)', discoveries, rate(discoveries, days, '/sim-day'), '-', '-'],
        ['minted verbs (recipe:/act: acted, rulebook entries)', f'{minted_verbs}, {rulebook}', '-', '-', '-'],
        ['laws (law_* events)', laws, '-', '-', '-'],
        ['laws ratified', ratified, rate(ratified, weeks, '/week'), 'n/a', '1 or more/week'],
        ['customs (custom_noted)', types.get('custom_noted', 0), '-', '-', '-'],
        ['partnerships (partnership_*)',
         sum(c for ty, c in types.items() if ty.startswith('partnership_')), '-', '-', '-'],
        ['arrivals (stranger_arrived)', types.get('stranger_arrived', 0), '-', '-', '-'],
        ['deaths (agent_died)', types.get('agent_died', 0), '-', '-', '-'],
        ['arbiter rulings (all verdicts)', rulings, rate(rulings, mind_days, '/mind-day'), '-', '-'],
        ['…of which wrote a recipe (verdict "attempt")', attempts,
         rate(attempts, mind_days, '/mind-day'), '-', '-'],
    ]
    print(table(rows, ['signal', 'n', 'rate', 'target p2', 'target p4']))

    print('\n## 6. Cost\n')
    ledgers = []
    for d in (tmp, minds_dir):
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            if f.endswith('.db'):
                c = opendb(os.path.join(d, f))
                if c is not None and has_table(c, 'llm_calls') and one(c, 'select count(*) from llm_calls'):
                    ledgers.append((f, c))
    total = sum(one(c, 'select sum(cost_usd) from llm_calls', 0.0) for _, c in ledgers)
    if not ledgers:
        print('no llm_calls table found: n/a')
    else:
        rows = []
        calls = 0
        for f, c in ledgers:
            for caller, ck, cost in q(c, 'select caller,count(*),sum(cost_usd) from llm_calls group by 1 order by 3 desc'):
                calls += ck
                rows.append([f, caller, ck, f'${cost or 0:.3f}',
                             f'${(cost or 0) / days:.3f}' if days else 'n/a'])
        rows.append(['**all**', '', calls, f'${total:.3f}', f'${total / days:.3f}' if days else 'n/a'])
        print(table(rows, ['ledger', 'caller', 'calls', 'cost', 'cost/sim-day']))
    per12 = total / mind_days * 12 if mind_days else 0
    watched = per12 * WATCHED_DAY
    print(f'\ncost per mind-day: ' + (f'${total / mind_days:.4f}' if mind_days else 'n/a') + '\n')
    print(table([
        ['cost per sim-day, scaled to 12 minds', f'${per12:.2f}' if mind_days else 'n/a',
         COST_TARGET, COST_TARGET],
        [f'…the same run per watched day ({WATCHED_DAY} sim-days at 1x)',
         f'${watched:.2f}' if mind_days else 'n/a', 'under $9', 'under $9'],
    ], ['metric', 'measured', 'target p2', 'target p4']))
    print(f'\n{COST_NOTE}')

    print('\n## 7. Targets\n')
    nar = opendb(os.path.join(minds_dir, '_narrator.db'))
    top5 = q(nar, 'select h.scene_id,s.start_tick,s.end_tick from heat_scores h '
                  'join scenes s on s.id=h.scene_id order by h.total desc limit 5')
    moment_ticks = [t for t, ty, _ in ev if ty in MOMENTS]
    hit5 = sum(1 for _, t0, t1 in top5 if any(t0 <= t <= t1 for t in moment_ticks))
    halluc = 0
    scene_parts = {}
    for _, ty, p in ev:
        if ty == 'scene_opened':
            scene_parts[p.get('id')] = {m for m in (p.get('participants') or [])}
        elif ty == 'scene_line':
            cast = scene_parts.get(p.get('id'), set()) | {p.get('agentId')}
            named = {m.lower() for m in name_re.findall(p.get('text', ''))}
            if named - {c for c in cast if c}:
                halluc += 1
    idle_h = hours['i']
    pw = 100 * people_wonder / n if n else 0
    inv_md = acts.get('invention', 0) / mind_days if mind_days else 0
    runs_day = long_runs / days if days else 0
    laws_week = ratified / weeks if weeks else 0
    halluc_100 = 100 * halluc / scene_lines if scene_lines else 0

    def mark(known, ok):
        return ('✓' if ok else '✗') if known else '-'

    rows = [
        ['idle hours per mind-day', f'{idle_h:.1f}' if mind_ticks else 'n/a', 'under 8',
         mark(mind_ticks, idle_h < 8), 'under 6', mark(mind_ticks, idle_h < 6)],
        ['speech about people or wonder (heuristic; the LLM pass is the number to quote)',
         f'{pw:.0f}%' if n else 'n/a', 'over 55%', mark(n, pw > 55), 'over 60%', mark(n, pw > 60)],
        ['exchanges with a run of 4+ per sim-day', f'{runs_day:.1f}' if days else 'n/a', '3',
         mark(days, runs_day >= 3), '5', mark(days, runs_day >= 5)],
        ['invention attempts per mind-day', f'{inv_md:.2f}' if mind_days else 'n/a', '0.5',
         mark(mind_days, inv_md >= 0.5), '1', mark(mind_days, inv_md >= 1)],
        ['laws ratified per week', f'{laws_week:.1f}' if weeks else 'n/a', 'n/a', '-',
         '1 or more', mark(weeks, laws_week >= 1)],
        ['moments in the director top five', f'{hit5} of {len(top5)}' if top5 else 'n/a', 'n/a', '-',
         '3 of 5', mark(top5, hit5 >= 3)],
        ['cost per sim-day, scaled to 12 minds',
         f'${per12:.2f} (${watched:.2f} per watched day)' if mind_days else 'n/a',
         COST_TARGET, mark(mind_days and total, per12 < 0.30),
         COST_TARGET, mark(mind_days and total, per12 < 0.30)],
        ['cast hallucinations per 100 scene lines', f'{halluc_100:.1f}' if scene_lines else 'n/a', '0',
         mark(scene_lines, halluc == 0), '0', mark(scene_lines, halluc == 0)],
    ]
    print(table(rows, ['target', 'measured', 'phase 2', 'p2', 'phase 4', 'p4']))
    return 0


if __name__ == '__main__':
    sys.exit(main())

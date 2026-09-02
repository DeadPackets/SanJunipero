#!/usr/bin/env python3
"""Quantify 'drones narrating chores' from the real ledgers. Read-only, WAL-safe copies."""
import json, math, os, re, sqlite3, sys, collections, statistics as st

BASE = os.path.dirname(os.path.abspath(__file__))
HOME = os.path.expanduser('~')
WORLDS = {
    'w2': (f'{BASE}/w2/dev-world.db', f'{BASE}/w2/minds'),
    'w3': (f'{BASE}/w3/dev-world.db', f'{BASE}/w3/minds'),
    'r3a': (f'{HOME}/handoff/cleanup/rehearsal6/run-r3a/dev-world.db', f'{HOME}/handoff/cleanup/rehearsal6/run-r3a'),
    'r3b': (f'{HOME}/handoff/cleanup/rehearsal6/run-r3b/dev-world.db', f'{HOME}/handoff/cleanup/rehearsal6/run-r3b'),
}
DAY = 1440
NAMES = ['amara', 'nadia', 'omar', 'salma', 'yusuf']
NAME_RE = re.compile(r'\b(Amara|Nadia|Omar|Salma|Yusuf)\b')
EARSHOT = 8

def ro(path):
    return sqlite3.connect(f'file:{path}?mode=ro', uri=True)

def q(con, sql, *a):
    return con.execute(sql, a).fetchall()

# ---------- classification heuristics ----------
TASK = re.compile(r"\b(wood|plank|planks|bread|loaf|loaves|water|well|fill|build|building|house|wall|roof|berries|berry|bush|bushes|fish|fishing|bucket|stow|hearth|fire|firewood|skin|waterskin|soup|storehouse|store|count|counted|tally|take|took|drop|walk|north|south|east|west|herb|herbs|nail|nails|stone|axe|tool|tools|field|till|forage|foraging|chop|chopping|haul|carry|carrying|bed|sleep|eat|eaten|drink|hungry|thirsty|thirst|hunger|cold|warm|dry|rain|stock|supplies|rota|shift|work|job|fetch|note|notes|page|write|written|farmhouse|cabin|cottage|plot|door|doorway|tiles|grave|marker|kindle|stoke|log|logs)\b", re.I)
FEEL = re.compile(r"\b(you|your|yours|we|us|our|miss|missed|sorry|worried|worry|care|cared|trust|trusted|love|loved|hate|hated|angry|anger|glad|happy|sad|afraid|fear|scared|lonely|alone|thank|thanks|friend|friends|kind|cruel|hurt|forgive|proud|ashamed|jealous|fond|mean|nice|company|together|beside|promise|promised|owe|owed|debt|fault|blame|lie|lied|honest|truth|laugh|laughed|smile|smiled|cry|cried|tears|heart|hold|held|hand|hands)\b", re.I)
WONDER = re.compile(r"\b(sky|clouds?|stars?|moon|sun|light|dawn|dusk|river|mountain|mountains|valley|ridge|sea|wind|storm|strange|odd|wonder|wondering|beautiful|quiet|still|silence|silent|why|how come|what if|maybe|perhaps|used to|before|once|remember|remembered|story|stories|world|god|gods|spirit|dead|death|die|died|dying|born|life|lives|ghost|dream|dreamt|dreamed|old|young|age|years|season|spring|winter|summer|autumn)\b", re.I)
WANT = re.compile(r"\b(wish|wishes|hope|hoped|hoping|dream of|someday|one day|would like|if only|curious|wonder what|wonder if|wonder why|want to (?:see|know|hear|learn|understand|talk|sit|watch|ask|tell)|like to (?:see|know|hear|learn|understand|talk|sit|watch|ask|tell)|ought to ask|should ask|want her|want him|want them|miss)\b", re.I)
NEEDWANT = re.compile(r"\b(want|wants|wanted|need|needs|needed)\b.{0,40}\b(food|bread|water|wood|sleep|bed|eat|drink|fire|hearth|warm|planks?|berries|fish|soup|herb|herbs|skin)\b", re.I)

def classify(text):
    t = text
    is_q = '?' in t
    task = len(TASK.findall(t)); feel = len(FEEL.findall(t)); won = len(WONDER.findall(t))
    people = len(NAME_RE.findall(t))
    feel += people
    scores = {'task': task, 'people': feel, 'wonder': won}
    best = max(scores, key=lambda k: (scores[k], {'task': 1, 'people': 2, 'wonder': 3}[k]))
    if sum(scores.values()) == 0:
        best = 'other'
    return best, is_q

# ---------- per world ----------
def load_world(name):
    wpath, mdir = WORLDS[name]
    con = ro(wpath)
    rows = q(con, "select seq,tick,type,payload from events where type in ('action_started','action_completed','action_interrupted','agent_spoke','agent_slept','agent_woke','agent_died','agent_spawned','agent_collapsed','affliction_recovered','agent_tended','co_slept','item_owner_changed','discovery_made','agent_expressed','fire_ignited','structure_completed','structure_planned','agent_conceived','agent_born','agent_attacked','agent_moved') order by seq")
    ev = [(s, t, ty, json.loads(p)) for s, t, ty, p in rows]
    max_tick = q(con, 'select max(tick) from events')[0][0]
    thoughts = q(con, 'select tick,agent_id,text from observer_thoughts order by id')
    return con, ev, max_tick, thoughts, mdir

def time_budget(ev, max_tick):
    alive_to = {n: max_tick for n in NAMES}
    for s, t, ty, p in ev:
        if ty == 'agent_died': alive_to[p['agentId']] = t
    # state per agent per tick: default idle
    state = {n: bytearray(b'i' * (max_tick + 2)) for n in NAMES}
    cur = {}  # agent -> (start_tick, cat)
    sleep_start = {}
    down_start = {}
    cats = {}
    def cat_of(verb):
        if verb == 'walk': return 'w'   # walking
        if verb in ('build', 'chop', 'craft', 'forage', 'fish', 'till', 'plant', 'harvest', 'hunt'): return 'k'  # work
        if verb in ('fill', 'take', 'stow', 'drop', 'stoke', 'kindle', 'enter', 'exit', 'give'): return 'l'  # logistics
        if verb in ('read', 'write', 'inscribe'): return 'n'  # notes
        if verb in ('eat', 'drink'): return 'e'
        if verb in ('sleep', 'wake'): return 'z'
        if verb in ('tend',): return 't'
        if verb.startswith('recipe:') or verb.startswith('express:'): return 'c'
        return 'o'
    def close(agent, end):
        if agent in cur:
            t0, c = cur.pop(agent)
            end = max(end, t0 + 1)
            st_ = state[agent]
            for x in range(t0, min(end, alive_to[agent] + 1)):
                if st_[x] == ord('i'): st_[x] = ord(c)
    for s, t, ty, p in ev:
        if ty == 'action_started':
            a = p['agentId']; close(a, t); cur[a] = (t, cat_of(p['verb']))
        elif ty in ('action_completed', 'action_interrupted'):
            close(p['agentId'], t)
        elif ty == 'agent_slept':
            sleep_start[p['agentId']] = t
        elif ty == 'agent_woke':
            a = p['agentId']
            if a in sleep_start:
                t0 = sleep_start.pop(a)
                for x in range(t0, min(t, alive_to[a]) + 1): state[a][x] = ord('s')
        elif ty == 'agent_collapsed':
            down_start[p['agentId']] = t
        elif ty == 'affliction_recovered' and p.get('agentId') in down_start:
            pass
        elif ty == 'agent_spoke':
            a = p['agentId']
            if state[a][t] == ord('i'): state[a][t] = ord('v')
    for a in list(cur): close(a, alive_to[a])
    for a, t0 in sleep_start.items():
        for x in range(t0, alive_to[a] + 1): state[a][x] = ord('s')
    out = {}
    for n in NAMES:
        counts = collections.Counter(chr(b) for b in state[n][1:alive_to[n] + 1])
        out[n] = (alive_to[n], counts)
    return out

LABEL = {'s': 'sleep', 'w': 'walk', 'k': 'work', 'l': 'logistics', 'n': 'notes', 'e': 'eat/drink', 'z': 'sleep-verb', 't': 'tend', 'c': 'custom', 'o': 'other', 'v': 'speak', 'i': 'idle'}

def dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])

def speech_stats(ev, N=60):
    lines = [(t, p['agentId'], p['text'], (p.get('x', 0), p.get('y', 0)), p.get('insideId')) for s, t, ty, p in ev if ty == 'agent_spoke']
    n = len(lines)
    cls = collections.Counter(); qs = 0; named = 0; replies30 = 0; replies60 = 0
    rows = []
    for i, (t, a, txt, pos, ins) in enumerate(lines):
        c, isq = classify(txt); cls[c] += 1; qs += isq
        names = {m.lower() for m in NAME_RE.findall(txt)} - {a}
        if names: named += 1
        # reply: nearest earlier line by another speaker within earshot
        r30 = r60 = False
        for j in range(i - 1, -1, -1):
            t2, a2, txt2, pos2, ins2 = lines[j]
            if t - t2 > 60: break
            if a2 != a and (dist(pos, pos2) <= EARSHOT or (ins and ins == ins2)):
                r60 = True
                if t - t2 <= 30: r30 = True
                break
        replies30 += r30; replies60 += r60
        rows.append((t, a, txt, c, isq, bool(names), r60))
    # chains: consecutive lines within 60 ticks & earshot of the previous line
    chains = []; cur = []
    for i, (t, a, txt, pos, ins) in enumerate(lines):
        if cur:
            t2, a2, txt2, pos2, ins2 = lines[cur[-1]]
            if t - t2 <= 60 and (dist(pos, pos2) <= EARSHOT or (ins and ins == ins2)):
                cur.append(i); continue
            chains.append(cur)
        cur = [i]
    if cur: chains.append(cur)
    multi = [c for c in chains if len({lines[i][1] for i in c}) >= 2]
    mono = [c for c in chains if len({lines[i][1] for i in c}) < 2 and len(c) > 1]
    # alternation: count speaker switches in multi chains
    alt_lengths = []
    for c in multi:
        # longest run of alternating speakers (speaker != previous)
        run = 1; best = 1
        for k in range(1, len(c)):
            if lines[c[k]][1] != lines[c[k - 1]][1]: run += 1; best = max(best, run)
            else: run = 1
        alt_lengths.append(best)
    dup = collections.Counter(txt for _, _, txt, _, _ in lines)
    repeated = sum(v for v in dup.values() if v > 1)
    lens = [len(txt.split()) for _, _, txt, _, _ in lines]
    per_agent = collections.Counter(a for _, a, _, _, _ in lines)
    return dict(n=n, cls=cls, questions=qs, named=named, replies30=replies30, replies60=replies60,
                chains=chains, multi=multi, mono=mono, alt_lengths=alt_lengths, dup=dup, repeated=repeated,
                words=lens, per_agent=per_agent, rows=rows)

def thought_stats(thoughts):
    n = len(thoughts); cls = collections.Counter(); qs = 0; other = 0; want = 0; lens = []
    rows = []
    for t, a, txt in thoughts:
        c, isq = classify(txt); cls[c] += 1; qs += isq
        names = {m.lower() for m in NAME_RE.findall(txt)} - {a}
        # pronoun-only mentions count too
        if names or re.search(r"\b(she|he|her|him|his|hers|they|them)\b", txt, re.I): other += 1
        w = bool(WANT.search(txt)) and not NEEDWANT.search(txt)
        want += w
        lens.append(len(txt.split()))
        rows.append((t, a, txt, c, bool(names), w))
    return dict(n=n, cls=cls, questions=qs, other=other, want=want, words=lens, rows=rows)

def fmt_pct(x, n):
    return f'{100 * x / n:.0f}%' if n else '-'

def main():
    out = []
    P = out.append
    all_speech_rows = {}; all_thought_rows = {}
    for w in WORLDS:
        con, ev, max_tick, thoughts, mdir = load_world(w)
        days = max_tick / DAY
        P(f'\n## {w}: {max_tick} ticks = {days:.2f} sim-days\n')
        tb = time_budget(ev, max_tick)
        P('### 1. Time budget (share of ticks alive)\n')
        P('| mind | days alive | ' + ' | '.join(LABEL[k] for k in 'swklnetcvzi') + ' |')
        P('|---|---|' + '---|' * 11)
        pooled = collections.Counter(); pooled_ticks = 0
        for n in NAMES:
            alive, c = tb[n]; tot = sum(c.values()) or 1
            pooled += c; pooled_ticks += tot
            P(f'| {n} | {alive / DAY:.2f} | ' + ' | '.join(fmt_pct(c.get(k, 0), tot) for k in 'swklnetcvzi') + ' |')
        P(f'| **pooled** | {pooled_ticks / DAY:.2f} | ' + ' | '.join(fmt_pct(pooled.get(k, 0), pooled_ticks) for k in 'swklnetcvzi') + ' |')
        awake = pooled_ticks - pooled.get('s', 0)
        idle = pooled.get('i', 0)
        P(f'\nAwake ticks pooled: {awake} ({awake / pooled_ticks * 100:.0f}%). Idle share of awake time: **{idle / awake * 100:.0f}%** = {idle / pooled_ticks * DAY / 60:.1f} sim-hours/day per mind (of {awake / pooled_ticks * DAY / 60:.1f} awake). Speaking ticks: {pooled.get("v", 0)}.')
        collapses = sum(1 for _, _, ty, _ in ev if ty == 'agent_collapsed')
        P(f'Collapses: {collapses}; deaths: ' + ', '.join(f"{p['agentId']}@d{t / DAY:.1f}({p['cause']})" for _, t, ty, p in ev if ty == 'agent_died'))

        ss = speech_stats(ev)
        all_speech_rows[w] = ss['rows']
        P('\n### 2. Speech\n')
        n = ss['n']
        P(f'Lines: {n} ({n / days:.0f}/day; per mind-day {n / max(1e-9, sum(tb[a][0] for a in NAMES) / DAY):.1f}). Median words {st.median(ss["words"]) if n else 0}, mean {st.mean(ss["words"]) if n else 0:.1f}.')
        P('| class | lines | share |')
        P('|---|---|---|')
        for k in ('task', 'people', 'wonder', 'other'):
            P(f'| {k} | {ss["cls"].get(k, 0)} | {fmt_pct(ss["cls"].get(k, 0), n)} |')
        P(f'| questions (any class) | {ss["questions"]} | {fmt_pct(ss["questions"], n)} |')
        P(f'| addressed to someone by name | {ss["named"]} | {fmt_pct(ss["named"], n)} |')
        P(f'| reply to another speaker within 30 ticks + earshot | {ss["replies30"]} | {fmt_pct(ss["replies30"], n)} |')
        P(f'| reply within 60 ticks + earshot | {ss["replies60"]} | {fmt_pct(ss["replies60"], n)} |')
        P(f'| exact-duplicate lines (line said before, verbatim) | {ss["repeated"] - sum(1 for v in ss["dup"].values() if v > 1)} | {fmt_pct(ss["repeated"] - sum(1 for v in ss["dup"].values() if v > 1), n)} |')
        P(f'| per mind | ' + ', '.join(f'{a}:{c}' for a, c in ss['per_agent'].most_common()) + ' | |')
        ch = ss['chains']; multi = ss['multi']; mono = ss['mono']
        P(f'\nExchange chains (lines within 60 ticks and earshot of the previous line): {len(ch)} total; {len(multi)} with 2+ speakers, {len(mono)} same-speaker monologue chains of 2+, {len(ch) - len(multi) - len(mono)} lone lines.')
        lens = collections.Counter(len(c) for c in multi)
        P('| 2+-speaker chain length (lines) | count |')
        P('|---|---|')
        for k in sorted(lens): P(f'| {k} | {lens[k]} |')
        alt = collections.Counter(ss['alt_lengths'])
        P('| longest alternating run within chain | count |')
        P('|---|---|')
        for k in sorted(alt): P(f'| {k} | {alt[k]} |')
        if multi:
            P(f'Lines inside 2+-speaker chains: {sum(len(c) for c in multi)} = {fmt_pct(sum(len(c) for c in multi), n)} of all speech. Median 2+-speaker chain {st.median(len(c) for c in multi)} lines, max {max(len(c) for c in multi)}.')
        # loops: inside 2+-speaker chains, lines whose first 25 chars repeat an earlier line of the same chain
        lines_ = [(t, p['agentId'], p['text']) for _, t, ty, p in ev if ty == 'agent_spoke']
        loop_lines = 0; loop_chains = 0
        for c in multi:
            seen_ = set(); rep_ = 0
            for i in c:
                k = lines_[i][2][:25].lower()
                if k in seen_: rep_ += 1
                seen_.add(k)
            loop_lines += rep_
            if rep_ >= 2: loop_chains += 1
        if multi:
            P(f'Loops: {loop_lines} of {sum(len(c) for c in multi)} lines inside 2+-speaker chains ({fmt_pct(loop_lines, sum(len(c) for c in multi))}) re-say a line already said in that chain (first 25 chars); {loop_chains} of {len(multi)} chains contain 2+ such repeats. Chains of 8+ lines: {sum(1 for c in multi if len(c) >= 8)}, of which looping: {sum(1 for c in multi if len(c) >= 8 and sum(1 for i in c if lines_[i][2][:25].lower() in {lines_[j][2][:25].lower() for j in c if j < i}) >= 2)}.')
        top_dup = [(t, c) for t, c in ss['dup'].most_common(6) if c > 1]
        if top_dup:
            P('Most repeated lines: ' + '; '.join(f'"{t[:70]}" x{c}' for t, c in top_dup))

        ts = thought_stats(thoughts)
        all_thought_rows[w] = ts['rows']
        P('\n### 3. Thoughts\n')
        n = ts['n']
        P(f'Thoughts: {n} ({n / days:.0f}/day). Mean {st.mean(ts["words"]) if n else 0:.0f} words, median {st.median(ts["words"]) if n else 0}.')
        P('| class | n | share |')
        P('|---|---|---|')
        for k in ('task', 'people', 'wonder', 'other'):
            P(f'| {k} | {ts["cls"].get(k, 0)} | {fmt_pct(ts["cls"].get(k, 0), n)} |')
        P(f'| mentions another person (name or pronoun) | {ts["other"]} | {fmt_pct(ts["other"], n)} |')
        P(f'| mentions a want beyond needs/work | {ts["want"]} | {fmt_pct(ts["want"], n)} |')
        P(f'| contains a question | {ts["questions"]} | {fmt_pct(ts["questions"], n)} |')

        # 4 relationships
        P('\n### 4. Relationships\n')
        cnt = collections.Counter(ty for _, _, ty, _ in ev if ty in ('co_slept', 'agent_tended', 'item_owner_changed', 'agent_conceived', 'agent_born', 'agent_attacked'))
        gives = [(t, p) for _, t, ty, p in ev if ty == 'action_started' and p['verb'] == 'give']
        P(f'co_slept: {cnt["co_slept"]}, tended: {cnt["agent_tended"]}, give actions: {len(gives)}, item_owner_changed: {cnt["item_owner_changed"]}, conceived: {cnt["agent_conceived"]}, born: {cnt["agent_born"]}, attacks: {cnt["agent_attacked"]}. (No partnership/dissolution/fight event types exist in the engine.)')
        P('| ledger | pairs | last updated day | mean chars | love/hate/trust/angry hits |')
        P('|---|---|---|---|---|')
        for a in NAMES:
            mp = f'{mdir}/{a}.db'
            if not os.path.exists(mp): continue
            mc = ro(mp)
            led = q(mc, 'select person_id, updated_day, doc from ledgers')
            if not led: P(f'| {a} | 0 | - | - | - |'); continue
            hits = sum(len(re.findall(r'\b(love|loved|hate|hated|trust|angry|fond|miss|resent|jealous)\b', d, re.I)) for _, _, d in led)
            P(f'| {a} | {len(led)} | {max(u for _, u, _ in led)} | {st.mean(len(d) for _, _, d in led):.0f} | {hits} |')
            mc.close()

        # 5 culture
        P('\n### 5. Culture\n')
        ap = f'{mdir}/_arbiter.db'
        if os.path.exists(ap):
            ac = ro(ap)
            vk = q(ac, "select json_extract(verdict_json,'$.kind'), count(*) from rulings group by 1")
            rb = q(ac, 'select recipe_id, name, verb, tick, reverted_at_tick from rulebook')
            cs = q(ac, 'select id,type,name,participants,first_tick,recurrences from constructs')
            P(f'Rulings: {sum(c for _, c in vk)} = ' + ', '.join(f'{k}:{c}' for k, c in vk) + f'. Rulebook entries (minted recipes/verbs): {len(rb)} -> ' + '; '.join(f'{r[1]} [{r[0].split(":")[0]}]' for r in rb) + f'. Constructs recognized: {len(cs)}' + (' -> ' + '; '.join(f'{c[1]} {c[2] or "(unnamed)"} {c[3]} recurrences={len(json.loads(c[5]))}' for c in cs) if cs else ''))
            known = q(ac, 'select id, known from codex')
            P(f'Codex arrangements known: {sum(k for i, k in known if i in ("work_rota", "common_store", "food_preserving", "memorial", "bridging"))}/5 (laws/arrangements reached).')
            ac.close()
        np_ = f'{mdir}/_narrator.db'
        if os.path.exists(np_):
            nc = ro(np_)
            ms = q(nc, 'select kind,label,day,tick,tier,domain,agent_ids from milestones order by tick')
            SOCIAL = {'first_speech', 'first_conversation', 'first_joke', 'first_metaphor', 'first_custom', 'first_trade', 'first_theft', 'first_expression', 'first_invention', 'first_gift', 'first_partnership', 'first_law'}
            soc = [m for m in ms if m[0] in SOCIAL]
            P(f'Milestones: {len(ms)} ({len(soc)} social/cultural, {len(ms) - len(soc)} material/engine). Social: ' + ', '.join(f'{m[0]}@d{m[2]}' for m in soc) + '. Material: ' + ', '.join(f'{m[0]}@d{m[2]}' for m in ms if m not in soc))
            inst = q(nc, 'select kind,name,description from institutions')
            P(f'Institutions: {len(inst)} -> ' + '; '.join(f'{k}: {d}' for k, nme, d in inst))
            sf = q(nc, 'select concept_kind,agent_id,day,quote,confidence from semantic_first_detected')
            P(f'Semantic firsts: {len(sf)} -> ' + '; '.join(f'{k} ({a}, d{d}, {c}) "{qq[:60]}"' for k, a, d, qq, c in sf))
            # 6 director
            P('\n### 6. Director (heat)\n')
            hs = q(nc, 'select s.id,s.day,s.start_tick,s.end_tick,s.cast,s.location,h.conflict,h.novelty,h.firsts,h.stakes,h.dramatic_irony,h.total from heat_scores h join scenes s on s.id=h.scene_id order by h.total desc')
            P(f'Scenes scored: {len(hs)}; total mean {st.mean(h[11] for h in hs) if hs else 0:.1f}, median {st.median(h[11] for h in hs) if hs else 0:.1f}.')
            P('| rank | day | ticks | cast | conflict | novelty | firsts | stakes | total | what happened in window |')
            P('|---|---|---|---|---|---|---|---|---|---|')
            for r, h in enumerate(hs[:8], 1):
                sid, day, t0, t1, cast, loc, cf, nv, fi, stk, di, tot = h
                inwin = [(t, ty, p) for _, t, ty, p in ev if t0 <= t <= t1]
                c = collections.Counter(ty for _, ty, _ in inwin)
                verbs = collections.Counter(p['verb'] for _, ty, p in inwin if ty == 'action_started')
                spk = c.get('agent_spoke', 0)
                notable = [ty for ty in ('agent_died', 'agent_collapsed', 'co_slept', 'agent_tended', 'fire_ignited', 'discovery_made', 'agent_expressed', 'structure_completed') if c.get(ty)]
                P(f'| {r} | {day} | {t0}-{t1} | {len(json.loads(cast))} | {cf:.1f} | {nv:.1f} | {fi:.0f} | {stk:.0f} | {tot:.1f} | {spk} lines; verbs {dict(verbs.most_common(4))}; {", ".join(f"{k}x{c[k]}" for k in notable) or "nothing notable"} |')
            # moments vs heat
            scenes = q(nc, 'select id,start_tick,end_tick from scenes')
            totals = {sid: tot for sid, *_, tot in [(h[0], h[11]) for h in hs]}
            ranks = {sid: i + 1 for i, h in enumerate(hs) for sid in [h[0]]}
            moments = [(t, ty, p) for _, t, ty, p in ev if ty in ('agent_died', 'co_slept', 'agent_tended', 'fire_ignited', 'discovery_made', 'agent_expressed', 'agent_born', 'agent_conceived')]
            P('\n| moment | tick | day | scene heat rank (of %d) | scene total |' % len(hs))
            P('|---|---|---|---|---|')
            seen = set()
            for t, ty, p in moments:
                key = (ty, t // 240)
                if key in seen: continue
                seen.add(key)
                sid = next((s for s, a, b in scenes if a <= t <= b), None)
                who = p.get('agentId') or p.get('byId') or (p.get('aId', '') + '+' + p.get('bId', '')) or ''
                P(f'| {ty} {who} | {t} | {t / DAY:.1f} | {ranks.get(sid, "no scene") if sid else "no scene"} | {totals.get(sid, 0):.1f} |' if sid else f'| {ty} {who} | {t} | {t / DAY:.1f} | no scene | - |')
            nc.close()

        # 7 turn economics
        P('\n### 7. Turn economics\n')
        op = f'{mdir}/_ops.db'
        if os.path.exists(op):
            oc = ro(op)
            to = q(oc, 'select agent_id, count(*), sum(acted), sum(spoke), sum(plan_continued) from turn_outcomes group by 1')
            P('| mind | turns | turns/day alive | acted | spoke | plan_continued |')
            P('|---|---|---|---|---|---|')
            T = A = Sp = Pc = 0
            for a, n_, ac_, sp, pc in to:
                alive = tb.get(a, (max_tick,))[0] / DAY
                P(f'| {a} | {n_} | {n_ / alive:.0f} | {fmt_pct(ac_, n_)} | {fmt_pct(sp, n_)} | {fmt_pct(pc, n_)} |')
                T += n_; A += ac_; Sp += sp; Pc += pc
            P(f'| **all** | {T} | {T / max(1e-9, sum(tb[a][0] for a in NAMES) / DAY):.0f} | {fmt_pct(A, T)} | {fmt_pct(Sp, T)} | {fmt_pct(Pc, T)} |')
            lc = q(oc, "select ok, coalesce(finish_reason,''), substr(coalesce(error,''),1,45), count(*) from llm_calls where caller='turn' group by 1,2,3 order by 4 desc limit 8")
            P('| turn LLM calls | ok | finish | error | n |')
            P('|---|---|---|---|---|')
            for ok, fr, er, c in lc: P(f'| | {ok} | {fr} | {er} | {c} |')
            tk = q(oc, "select sum(input_tokens), sum(cache_read_tokens), sum(output_tokens), round(sum(cost_usd),3), count(*) from llm_calls where caller='turn'")[0]
            P(f'Turn tokens: input {tk[0]}, cache-read {tk[1]}, output {tk[2]}, cost ${tk[3]}, calls {tk[4]}; mean input/call {tk[0] / max(1, tk[4]):.0f}.')
            al = q(oc, 'select kind, count(*) from alerts group by 1 order by 2 desc')
            P('Alerts: ' + ', '.join(f'{k}:{c}' for k, c in al))
            oc.close()
        # prompt share from perception memories
        tot = inv = places = people = needs = weather = 0; nper = 0
        for a in NAMES:
            mp = f'{mdir}/{a}.db'
            if not os.path.exists(mp): continue
            mc = ro(mp)
            for (txt,) in q(mc, "select text from memories where kind='perception'"):
                nper += 1
                sents = re.split(r'(?<=[.;])\s+', txt)
                for s_ in sents:
                    L = len(s_); tot += L
                    if re.search(r'You are carrying|Your hands hold|close enough for them to touch|You can see \d', s_): inv += L
                    elif re.search(r'stands at|tiles wide|the way out|doorway|Four walls|Carts and feet|reach this spot|the road|path', s_): places += L
                    elif NAME_RE.search(s_): people += L
                    elif re.search(r'stomach|thirst|tired|sleep|cold|warm|hungry|legs|eat before', s_): needs += L
                    elif re.search(r'storm|rain|air is|light|cloud|sun|wind|Water glints|day \d', s_): weather += L
            mc.close()
        if tot:
            P(f'\nPerception prose (block "now", {nper} turns): mean {tot / nper:.0f} chars = ~{tot / nper / 4:.0f} tokens/turn. Share by sentence: inventory {inv / tot * 100:.0f}%, places/structures {places / tot * 100:.0f}%, other people {people / tot * 100:.0f}%, own needs {needs / tot * 100:.0f}%, weather/time {weather / tot * 100:.0f}%, rest {(tot - inv - places - people - needs - weather) / tot * 100:.0f}%.')
        # 8 invention paths + survival share
        P('\n### 8. Invention paths and survival load (per sim-day)\n')
        mind_days = sum(tb[a][0] for a in NAMES) / DAY
        VCAT = {}
        for v in ('eat', 'drink', 'fill', 'sleep', 'wake', 'stoke', 'kindle', 'snuff'): VCAT[v] = 'survival'
        for v in ('enter', 'exit', 'take', 'stow', 'drop', 'walk', 'wear', 'doff'): VCAT[v] = 'move/carry'
        for v in ('build', 'chop', 'craft', 'forage', 'fish', 'till', 'plant', 'harvest', 'hunt', 'pave', 'dig_channel', 'extinguish', 'douse'): VCAT[v] = 'making'
        for v in ('give', 'tend', 'teach', 'speak', 'attack'): VCAT[v] = 'social'
        for v in ('write', 'read', 'inscribe'): VCAT[v] = 'notes'
        def vcat(v):
            if v == 'experiment' or v.startswith('recipe:') or v.startswith('express:'): return 'invention'
            return VCAT.get(v, 'other')
        acts = collections.Counter(vcat(p['verb']) for _, _, ty, p in ev if ty == 'action_started')
        tot_acts = sum(acts.values()) or 1
        P('| accepted acts (action_started) | n | per mind-day | share |')
        P('|---|---|---|---|')
        for k in ('survival', 'move/carry', 'making', 'social', 'notes', 'invention', 'other'):
            P(f'| {k} | {acts.get(k, 0)} | {acts.get(k, 0) / mind_days:.1f} | {fmt_pct(acts.get(k, 0), tot_acts)} |')
        # engine refusals
        ref = collections.Counter(); nref = 0
        for a in NAMES:
            mp = f'{mdir}/{a}.db'
            if not os.path.exists(mp): continue
            mc = ro(mp)
            for (txt,) in q(mc, "select text from memories where kind='action' and text like 'You realize you cannot%'"):
                nref += 1; ref[txt.split(':', 1)[1].strip()[:70]] += 1
            mc.close()
        P(f'\nEngine refusals ("You realize you cannot"): {nref} = {nref / mind_days:.1f} per mind-day, vs {tot_acts / mind_days:.1f} accepted acts per mind-day ({fmt_pct(nref, nref + tot_acts)} of tries refused). Top reasons: ' + '; '.join(f'"{k}" x{c}' for k, c in ref.most_common(6)))
        ap = f'{mdir}/_arbiter.db'
        if os.path.exists(ap):
            ac = ro(ap)
            rl = q(ac, "select id, tick, intent_text, json_extract(verdict_json,'$.kind'), json_extract(verdict_json,'$.verb'), json_extract(verdict_json,'$.reason') from rulings order by id")
            kinds = collections.Counter(r[3] for r in rl)
            exp = [r for r in rl if r[2].lower().startswith('experiment')]
            P(f'\nArbiter rulings: {len(rl)} = {len(rl) / days:.1f} per sim-day, {len(rl) / mind_days:.2f} per mind-day. Verdicts: ' + ', '.join(f'{k}:{c}' for k, c in kinds.items()) + f'. Intents that began with the word "experiment": {len(exp)}.')
            P('"map" = the mind wrote free text (or a malformed act) and the court folded it back onto an existing verb; "impossible" = refused; "attempt" = a new recipe was written and rolled.')
            P('| ruling | day | intent (trimmed) | verdict |')
            P('|---|---|---|---|')
            for rid, t, it, k, v, rs in rl:
                if k == 'map' and re.match(r'^(plan|walk|read|eat|fill|drop|stow|fish|sleep|journal|recall|wait|read_note)\b', it.strip(), re.I) and len(it) < 60: continue
                verdict = f'{k}' + (f' -> {v}' if v else '') + (f' ({rs})' if rs else '')
                P(f'| {rid} | {t / DAY:.1f} | {it.replace(chr(10), " ")[:95]} | {verdict} |')
            ac.close()
        inv_ev = collections.Counter(ty for _, _, ty, _ in ev if ty in ('discovery_made', 'agent_expressed'))
        con2 = ro(WORLDS[w][0])
        extra = dict(q(con2, "select type,count(*) from events where type in ('structure_inscribed','item_text_changed','skill_gained','agent_collapsed','agent_afflicted','hp_changed') group by 1"))
        con2.close()
        P(f'\nMinted things: discovery_made {inv_ev["discovery_made"]}, agent_expressed {inv_ev["agent_expressed"]}, structure_inscribed {extra.get("structure_inscribed", 0)}, notes written (item_text_changed) {extra.get("item_text_changed", 0)}. Laws: 0 (no law event type exists; codex arrangements all unknown). Customs: constructs above.')
        P(f'Body pressure: hp_changed {extra.get("hp_changed", 0)} ({extra.get("hp_changed", 0) / mind_days:.0f}/mind-day), collapses {extra.get("agent_collapsed", 0)}, afflictions {extra.get("agent_afflicted", 0)}.')
        SURV = re.compile(r"\b(hungry|hunger|stomach|gnaw|gnawing|starv|thirst|thirsty|parched|dry throat|cold|freez|shiver|warm|tired|exhaust|weary|worn|legs|collapse|dizzy|faint|sleep|bed|rest|eat|drink|water|bread|food|fire|hearth|wood)\b", re.I)
        sth = sum(1 for _, _, txt in thoughts if SURV.search(txt))
        ssp = sum(1 for r in ss['rows'] if SURV.search(r[2]))
        P(f'Survival vocabulary (hunger/thirst/cold/tired/sleep/food/water/fire/wood) appears in {fmt_pct(sth, len(thoughts))} of thoughts and {fmt_pct(ssp, ss["n"])} of speech lines (heuristic; the LLM pass below gives the stricter "main concern" share).')
        con.close()
    open(f'{BASE}/tables.md', 'w').write('\n'.join(out))
    json.dump({'speech': all_speech_rows, 'thoughts': all_thought_rows}, open(f'{BASE}/rows.json', 'w'))
    print('\n'.join(out))

main()

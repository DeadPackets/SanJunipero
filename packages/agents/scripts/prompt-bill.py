# The prompt's bill, itemised: which wake reason bought the calls, which block bought the
# tokens, and what the cache actually kept. Prices and the day length are read out of the
# source at runtime, never transcribed.
#
#   python3 packages/agents/scripts/prompt-bill.py rehearsals/minds
import collections, json, os, re, shutil, sqlite3, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
PINS = os.path.join(ROOT, 'packages/llm/src/pins.ts')
TIME = os.path.join(ROOT, 'packages/shared/src/time.ts')
# The reliably-cached prefix: RULES_OF_BEING + CAPABILITIES + SPEECH_RULES, floored to a
# 256-token cache block. Measured over the phase 1 gate run, not chosen.
CACHE_FLOOR = 2048


def read_prices():
    src = open(PINS).read()
    table = re.search(r'PRICE_PER_M_BY_PROVIDER[^{]*\{(.*?)\n\}', src, re.S).group(1)
    row = r'(\w+):\s*\{\s*input:\s*([\d.]+),\s*output:\s*([\d.]+),\s*cacheRead:\s*([\d.]+)'
    prices = {m[0]: tuple(float(x) for x in m[1:]) for m in re.findall(row, table)}
    c = re.search(r'CEILING_PRICE_PER_M[^{]*\{\s*input:\s*([\d.]+),\s*output:\s*([\d.]+),\s*cacheRead:\s*([\d.]+)', src)
    return prices, tuple(float(x) for x in c.groups())


def read_ints(path, *names):
    src = open(path).read()
    return [int(re.search(rf'{n}\s*=\s*(\d+)', src).group(1)) for n in names]


PRICES, CEILING = read_prices()
MINUTES_PER_DAY, TICK_REAL_MS = read_ints(TIME, 'MINUTES_PER_DAY', 'TICK_REAL_MS')


def cost(fresh, cached, out, provider):
    p = PRICES.get(provider or '', CEILING)
    return (fresh * p[0] + cached * p[2] + out * p[1]) / 1e6


def opened(scratch, path):
    """A run may still be writing: copy the database and both its side files, read the copy."""
    for suffix in ('', '-wal', '-shm'):
        src = path + suffix
        if os.path.exists(src):
            shutil.copy(src, os.path.join(scratch, os.path.basename(src)))
    return sqlite3.connect(os.path.join(scratch, os.path.basename(path)))


def has_table(c, name):
    return c.execute('SELECT 1 FROM sqlite_master WHERE type=? AND name=?', ('table', name)).fetchone() is not None


def pct(n, total):
    return 0.0 if total == 0 else 100.0 * n / total


def mean(xs):
    return sum(xs) / len(xs) if xs else 0.0


def main(minds_dir):
    files = sorted(f for f in os.listdir(minds_dir) if f.endswith('.db'))
    scratch = tempfile.mkdtemp(prefix='prompt-bill-')
    try:
        turns, outcomes, refusals, end_tick = [], (0, 0), 0, 0
        for f in files:
            c = opened(scratch, os.path.join(minds_dir, f))
            if has_table(c, 'llm_calls'):
                # A ledger written before the bill columns existed has neither: read NULL for
                # whichever it is missing rather than refusing the whole run.
                cols = {r[1] for r in c.execute('PRAGMA table_info(llm_calls)')}
                bill = ', '.join(n if n in cols else 'NULL' for n in ('wake_reason', 'block_tokens'))
                turns += c.execute(
                    'SELECT ts, input_tokens, output_tokens, cache_read_tokens, provider,'
                    f'      {bill}, ok'
                    "  FROM llm_calls WHERE caller = 'turn'").fetchall()
            if has_table(c, 'turn_outcomes'):
                r = c.execute('SELECT COUNT(*), COALESCE(SUM(acted),0) FROM turn_outcomes').fetchone()
                outcomes = (outcomes[0] + r[0], outcomes[1] + r[1])
            if has_table(c, 'memories'):
                refusals += c.execute("SELECT COUNT(*) FROM memories WHERE kind='action'").fetchone()[0]
            if has_table(c, 'mind_runtime'):
                for (t,) in c.execute('SELECT tick FROM mind_runtime'):
                    end_tick = max(end_tick, t)
            c.close()
    finally:
        shutil.rmtree(scratch, ignore_errors=True)

    if not turns:
        print(f'no turn calls under {minds_dir}')
        return
    n = len(turns)
    fresh_of = lambda r: max(0, r[1] - r[3])
    cost_of = lambda r: cost(fresh_of(r), r[3], r[2], r[4])
    print(f'{n} turn calls in {minds_dir}, {sum(1 for r in turns if not r[7])} of them came back with nothing')
    print(f'priced from pins.ts: ${sum(cost_of(r) for r in turns):.4f}\n')

    print('1. WHICH WAKE REASON BOUGHT THE CALL')
    print(f"{'reason':20s} {'calls':>6s} {'share':>7s} {'$/call':>9s} {'fresh tok':>10s}")
    by_reason = collections.defaultdict(list)
    for r in turns:
        by_reason[r[5] or '(not recorded)'].append(r)
    for reason, rows in sorted(by_reason.items(), key=lambda kv: -len(kv[1])):
        print(f'{reason:20s} {len(rows):6d} {pct(len(rows), n):6.1f}% '
              f'{mean([cost_of(x) for x in rows]):9.5f} {mean([fresh_of(x) for x in rows]):10.0f}')

    print('\n2. WHICH BLOCK BOUGHT THE TOKENS')
    blocks = collections.defaultdict(list)
    billed = 0
    for r in turns:
        if r[6] is None:
            continue
        billed += 1
        for k, v in json.loads(r[6]).items():
            if not k.startswith('_'):
                blocks[k].append(v)
    if billed == 0:
        print(f'   no row carries a block bill — all {n} predate this instrumentation')
    else:
        prompt = sum(sum(v) for v in blocks.values()) / billed
        print(f'{"block":14s} {"mean tok":>9s} {"share":>7s} {"sent on":>8s}   '
              f'(of {billed} billed calls, {prompt:.0f} tok each)')
        for name, vals in sorted(blocks.items(), key=lambda kv: -sum(kv[1])):
            # Mean over the calls that carried it; the share weights that by how often they did.
            print(f'{name:14s} {mean(vals):9.0f} {pct(sum(vals) / billed, prompt):6.1f}% {len(vals):8d}')
        print(f'the cache keeps at most the first {CACHE_FLOOR}; everything under it is fresh '
              f'on {pct(sum(1 for x in turns if x[3] <= CACHE_FLOOR), n):.0f}% of calls')

    print('\n3. WHAT THE CACHE KEPT')
    cached = [r[3] for r in turns]
    modal, modal_n = collections.Counter(cached).most_common(1)[0]
    at_floor = sum(1 for x in cached if x == CACHE_FLOOR)
    at_zero = sum(1 for x in cached if x == 0)
    print(f'{"mean cache_read":22s} {mean(cached):9.0f}')
    print(f'{"modal cache_read":22s} {modal:9d}   on {modal_n} calls ({pct(modal_n, n):.1f}%)')
    print(f'{"at the %d floor" % CACHE_FLOOR:22s} {at_floor:9d}   ({pct(at_floor, n):.1f}%)')
    print(f'{"cached nothing":22s} {at_zero:9d}   ({pct(at_zero, n):.1f}%)')

    print('\n4. HOW THE PROMPT GREW')
    first, last = min(r[0] for r in turns), max(r[0] for r in turns)
    # Ticks per real ms, derived from where the run actually ended rather than assumed: a
    # rehearsal at 2x would read as half a day at the shipped rate.
    rate = end_tick / (last - first) if end_tick and last > first else 1.0 / TICK_REAL_MS
    print(f'sim time read off the wall clock at {rate * 1000:.2f} tick/s '
          f'({"measured to tick %d" % end_tick if end_tick else "shipped tick rate"})')
    # A run shorter than two sim-days collapses into one row and shows nothing, so the bucket
    # drops to the sim-hour. The growth being looked for happens inside a single day.
    span = (last - first) * rate
    bucket, label = (MINUTES_PER_DAY, 'sim-day') if span >= 2 * MINUTES_PER_DAY else (60, 'sim-hour')
    by_bucket = collections.defaultdict(list)
    for r in turns:
        by_bucket[int((r[0] - first) * rate) // bucket].append(r)
    print(f"{label:>8s} {'calls':>6s} {'mean input':>11s} {'mean fresh':>11s} {'mean cached':>12s}")
    for b in sorted(by_bucket):
        rows = by_bucket[b]
        print(f'{b:8d} {len(rows):6d} {mean([x[1] for x in rows]):11.0f} '
              f'{mean([fresh_of(x) for x in rows]):11.0f} {mean([x[3] for x in rows]):12.0f}')

    print('\n5. WHAT THE CALLS WERE WORTH')
    sizes = [json.loads(r[6]).get('_planSize') for r in turns if r[6]]
    left = [json.loads(r[6]).get('_priorStepsLeft') for r in turns if r[6]]
    sizes = [x for x in sizes if x is not None]
    left = [x for x in left if x is not None]
    named = outcomes[1]
    print(f'paid turn calls               {n:8d}')
    print(f'answers that named an act     {named:8d}   ({pct(named, outcomes[0]):.1f}% of {outcomes[0]} turn outcomes)')
    print(f'paid calls per act named      {n / named if named else 0:8.2f}')
    print(f'refusals the world wrote back {refusals:8d}   (acts and plan steps alike)')
    if sizes:
        print(f'mean _planSize                {mean(sizes):8.2f}   over {len(sizes)} calls')
        print(f'mean _priorStepsLeft          {mean(left):8.2f}   over {len(left)} calls')
        thrown = [x for x in left if x > 0]
        print(f'calls that landed on a plan   {len(thrown):8d}   ({pct(len(thrown), len(left)):.1f}%), '
              f'{mean(thrown):.2f} steps left on average')
    else:
        print('mean _planSize                       —   no row carries one yet')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'rehearsals/minds')

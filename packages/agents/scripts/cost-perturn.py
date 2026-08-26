# $/hour depends on how busy the town is, so the transferable number is $/CALL, not $/hour.
# This prints both, at what Wafer actually charges, so a quiet town and a talkative one can be
# priced off the same measured per-call figures.
import sqlite3, os, sys

D = 'packages/agents/data/ladder'
W = {'input': 0.28, 'output': 0.56, 'cacheRead': 0.07}
MINDS = 5

def cost(inp, out, cr):
    return ((inp - cr) * W['input'] + cr * W['cacheRead'] + out * W['output']) / 1e6

print(f"{'arm':16s} {'simhr':>5s} {'turns':>6s} {'t/mind/hr':>9s} {'$/turn':>9s} {'refl':>5s} {'$/refl':>9s} {'$/simhr':>9s}")
for n in sys.argv[1:]:
    p = f'{D}/{n}.db'
    if not os.path.exists(p):
        continue
    c = sqlite3.connect(p)
    tot = 0.0
    out = {}
    for caller in ('turn', 'reflection'):
        r = c.execute(
            "SELECT COUNT(*), COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COALESCE(SUM(cache_read_tokens),0) "
            "FROM llm_calls WHERE caller=? AND ok=1", (caller,)).fetchone()
        cc = cost(r[1], r[2], r[3])
        tot += cc
        out[caller] = (r[0], cc)
    c.close()
    simhr = 7.0
    nt, ct = out['turn']
    nr, cr_ = out['reflection']
    print(f"{n:16s} {simhr:5.1f} {nt:6d} {nt/MINDS/simhr:9.2f} {ct/max(nt,1):9.5f} {nr:5d} {cr_/max(nr,1):9.5f} {tot/simhr:9.4f}")

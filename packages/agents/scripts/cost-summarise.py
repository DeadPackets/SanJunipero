import json, sys, os
D = 'packages/agents/data/ladder'
names = sys.argv[1:] or [f[:-5] for f in sorted(os.listdir(D)) if f.endswith('.json')]
hdr = f"{'arm':16s} {'turn':>5s} {'out/turn':>8s} {'r%':>5s} {'cache%':>6s} | {'refl':>4s} {'out/refl':>8s} {'r%':>5s} | {'$/simhr':>8s} | warm light bond built recov/ref rep hardf  thoughts spoke emdash%"
print(hdr)
for n in names:
    p = f'{D}/{n}.json'
    if not os.path.exists(p):
        continue
    d = json.load(open(p))
    bc = {c['caller']: c for c in d['byCaller']}
    t = bc.get('turn', {})
    r = bc.get('reflection', {})
    q = d['quality']
    print(f"{n:16s} {t.get('okCalls',0):5d} {t.get('outPerCall',0):8d} {t.get('reasoningPct',0):5.1f} {t.get('cacheHitPct',0):6.1f} | "
          f"{r.get('okCalls',0):4d} {r.get('outPerCall',0):8d} {r.get('reasoningPct',0):5.1f} | "
          f"{d['costPerSimHour']:8.4f} | {q['enteredWarm']:4d} {q['lightActs']:5d} {q['bonds']:4d} {q['completed']:5d} "
          f"{q['recovered']:5d}/{q['refusals']:<4d} {q['repairs']:3d} {q['hardFailures']:5d} {q['thoughts']:9d} {q['spoke']:5d} {q['emDashPct']:6.1f}")

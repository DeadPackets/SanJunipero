# A cheaper reflection that stops updating who a person is has broken the thing that makes this
# project interesting, and cost per call cannot see that. Reads each arm's night's work product
# out of its own tables: personality versions, facts kept, scenes, day nodes, ledgers, paragraphs.
import sqlite3, sys, os

D = 'packages/agents/data/ladder'
names = sys.argv[1:] or [f[:-3] for f in sorted(os.listdir(D)) if f.endswith('.db')]
print(f"{'arm':16s} {'reflCalls':>9s} {'persVers':>8s} {'facts':>6s} {'scenes':>7s} {'days':>5s} {'ledgers':>8s} {'autobio':>8s} {'factsMax':>8s}")
for n in names:
    p = f'{D}/{n}.db'
    if not os.path.exists(p):
        continue
    c = sqlite3.connect(p)
    q = lambda s: c.execute(s).fetchone()[0]
    try:
        refl = q("SELECT COUNT(*) FROM llm_calls WHERE caller='reflection' AND ok=1")
        # Version 1 is the seed written by PersonalityStore.init; anything above it is a night's edit.
        vers = q("SELECT COUNT(*) FROM personality_versions") - q("SELECT COUNT(DISTINCT agent_id) FROM personality_versions")
        facts = q("SELECT COUNT(*) FROM facts")
        scenes = q("SELECT COUNT(*) FROM summary_nodes WHERE level='scene'")
        days = q("SELECT COUNT(*) FROM summary_nodes WHERE level='day'")
        ledgers = q("SELECT COUNT(*) FROM ledgers")
        auto = q("SELECT COUNT(*) FROM autobiography")
        # The runaway `extractFacts` was the whole of fix 1: most facts kept in any single night.
        fmax = q("SELECT COALESCE(MAX(n),0) FROM (SELECT COUNT(*) AS n FROM facts GROUP BY day)")
        print(f"{n:16s} {refl:9d} {vers:8d} {facts:6d} {scenes:7d} {days:5d} {ledgers:8d} {auto:8d} {fmax:8d}")
    except sqlite3.Error as e:
        print(f"{n:16s} unreadable: {e}")
    c.close()

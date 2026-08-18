# GATE G11b — 16 of 17 — PARTIAL

One continuous live run on the 128×128 genesis town. `G11_TICKS=5760`, 5 minds, 250 ms/tick,
**unpinned with fallbacks on** (`G11_PROVIDER` unset, `G11_HARD_PROVIDER` unset). Reached
5760 of 5760 world ticks, never resumed, and wrote its own report.

**Tag: `gate-g11-partial`.** `gate-g11` stays reserved for a full seventeen. Precedent:
`gate-g13-partial`, cut when six of seven G13b assertions closed and the seventh was blocked
by another chunk.

## The criterion table

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | two+ sim-days, no crash, nothing drained, tick budget held | **PASS** | 5760/5760 ticks, 0 crash alerts, 0 left after the drain, **0 over-budget ticks** |
| 2 | thirst reaches an act | **PASS** | unprompted drinks recorded |
| 3 | food gathered then eaten | **PASS** | gathers whose yield was eaten |
| 4 | the sick founder is answered | **PASS** | the seeded ill founder drew a response |
| 5 | chronicle says nothing it should not | **PASS** | 52 lines, **0 violations** on all three regexes |
| 6 | feet wear the routes feet take | **PASS** | tiles crossed the dialled-down threshold |
| 7 | laws listed, flipped, replayed | **PASS** | paths listed, one flip, `replayHashMatches: true` |
| 8 | spend reported, nothing lost | **PASS** | **11 reflections started == 11 resolved**, 496 calls, 16 dead calls, 84 alert rows |
| 9 | constructs live | **FAIL** | `verbs=none first=null reused=null reuseCalls=0 pass=true/0 recognized=0 naming=true tier1=11` |
| 10 | a night somebody stood in | **PASS** | **147** dark perceptions in real memory rows |
| 11 | the nightly semantic pass runs clean | **PASS** | **`ran=true errors=0`** |
| A | ops plane wired | **PASS** | every seam wired; the semantic seam ran |
| B | measured on a grown map | **PASS** | grown map, traffic keys, fauna and forageables all non-zero |
| C | the ford takes a bridge | **PASS** | buildable at the shifted ford |
| D | the far bank stops at the water | **PASS** | refused, stopped at the water's edge |
| E | the clothed come through the night | **PASS** | the winter ladder holds |
| F | discretionary time reported | **PASS** | 16 mind-days recorded |

## Criterion 11 — the number this gate was re-run for

```
semanticPassRan     true
semanticPassErrors  0        <- was 2 (batch 14), corrected to 1 (batch 15), now 0
semanticSkippedNights 0
chapters in the database: 0, 1, 2, 3, 4   <- all five. Batch 14 lost day 3.
```

**Every night rendered a chronicle and every night got its semantic pass.** Batch 14's run
held days 0, 1, 2 and 4 and criterion 11 read `errors=2`; batch 15 proved the 2 was one night
double-counted; this run has no bad night to count.

**Stated honestly: criterion 11 passed because no chronicle failed, not because fix 1 rescued a
night.** Fix 1's guarantee — that a render failure cannot skip the pass — is proved by unit
test, not by this run, and `semanticSkippedNights: 0` is the standing instrument that will say
so if the ordering ever comes back. Fix 2, by contrast, *was* exercised live: **8 decodes were
repaired** (7 `turn`, 1 `reflection`, all of them the `braced` case — prose written before the
JSON), each for **zero extra calls**, where batch 14 measured 12 of 13 dead calls in exactly
that class.

## Criterion 9 — UNMET, and carried to G8

```
expressiveVerbs: []     agent_expressed events: 0     arbiter llm_calls: 0
recognized: 0           namingLawHolds: true          tier1 milestones: 11
```

**The arbiter was never asked** — a third honest test agreeing with batches 13 and 14. The
pathway is unexercised, not broken: the recognizer pass ran with 0 errors, the naming law
holds, and 11 tier-1 milestones fired.

**Debt owner: C8 Task 24** ("skills in words, a tradition that can be passed on, and an arbiter
that can see its own town"). **Gate it is carried to: G8.** C11 does not build the mechanism
that would make a mind reach for a word the world does not have, so this is not a C11 defect
and is not scored as one.

## Deaths — reported plainly, and separately from the survival tax

**All five founders died. Four of hunger, one of thirst. Every one of them unforced.**

| mind | tick | cause |
|---|---:|---|
| amara | 3814 | hunger |
| yusuf | 3875 | hunger |
| omar | 3897 | hunger |
| nadia | 5082 | hunger |
| salma | 5207 | thirst |

Batch 14's run lost 2 of 5, both to hunger. **This run is worse on the axis the user has since
ruled on (the target is zero unforced deaths), and the baseline going into C8 should be read
from this run as well as from batch 14's.** No gate criterion measures it today; C8's does.

The town also barely acted: **83 acts started across five minds and four sim-days**, of which
25 were sleeps and 20 were wakes. Batch 14's town started 357. Production was **0** — no build,
craft, chop, plant, harvest or pave — except a single `till`.

## Both survival-tax classifiers, with their n

| classifier | this run | batch 14 | batch 13 | batch 11 |
|---|---|---|---|---|
| **OLD** (sleep + wake counted as survival) | **75.9%** — 63 of 83, **n = 83** | 52.9% (n=357) | 53.9% (n=408) | 64.9% |
| **NEW** (sleep 25 + wake 20 removed from both sides) | **47.4%** — 18 of 38, **n = 38** | 40.6% (n=283) | 35.6% (n=292) | — |

**Both numbers are worse than batch 14's and both rest on a much smaller n.** At n = 83 and
n = 38 this run is not a second measurement of the same quantity — it is a measurement of a
town that starved before it did anything else, and 45 of its 83 acts were sleeping and waking.
**It should not be averaged with batch 14's; it should be read as the tax a dying town pays.**
R15's ~28.5% prediction for the NEW classifier remains refuted, now at a third n.

## Provider behaviour, unpinned with fallbacks on

| | this run | batch 14 |
|---|---:|---:|
| calls | 496 | 456 |
| served by the preferred back end (Baidu) | **54 (10.9%)** | 431 (94.5%) |
| largest actual back end | **DeepInfra 380 (76.6%)** | Baidu 431 |
| other back ends | Decart 23, StreamLake 8, Inceptron 2, Morph 2, Sail Research 2, DigitalOcean 1 | DeepInfra 10, Inceptron 1, Sail Research 1 |
| dead calls | **16 (3.2%)** — 15 unparseable, 1 empty | 13 (2.85%) |
| **decodes repaired** | **8** | n/a — the repair pass did not exist |
| **cache-read share** | **35.02%** | 44.81% |

**The routing was almost inverted from batch 14's and that is the headline non-criterion
finding.** `provider.order` is a preference, and on this night OpenRouter served three quarters
of the run from DeepInfra. The cache share fell with it, 44.8% → 35.0%. The pre-flight refused
an earlier attempt for the same reason (below).

## The gate refused to start once, and was right to

```
[g11] pre-flight: action 3/12 over 4 round(s), 0 passed; speech 2/12 — ADVISORY, not gated;
      served DeepInfra,Inceptron,Sail Research, $0.002323
GATE REFUSED TO START: provider 'Baidu' failed the turn pre-flight.
```

Baidu served none of the twelve. All twelve answered — **zero decode failures, zero repairs,
zero dead calls** — the turns simply carried no act. The next attempt cleared the bar on its
first round for $0.001127, served by Baidu. **Batch 14's pre-flight fix paid for itself a
second time**: $0.0023 spent refusing a run whose town could not act.

## Spend

| | |
|---|---:|
| refused attempt's pre-flight | $0.002323 |
| **the scored run, complete** | **$0.514623 over 496 calls** |
| **BATCH TOTAL** | **$0.516946** |

By caller: turn $0.4077, reflection $0.0979, narrator $0.0058, semantic $0.0020, pre-flight
$0.0011. Against a **$5 stop-and-report line** and batch 14's $0.679089. The
$20/mind/sim-hour tripwire was never approached.

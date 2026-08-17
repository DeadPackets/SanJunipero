# The gate that ran and was never scored

GATE G11b, C11 batch 13, branch tip `6d5c937`. Four sim-days, five minds, unpinned routing with
fallbacks on. The run reached **world tick 5760 of 5760** and was killed by the harness at 93%
of wall clock, **inside the last day-close, before the report writer ran.** `g11-deepworld.ts`
builds the world from genesis every time, so there was no continuation: the score, the
transcript and the report JSON were all lost with the process.

**No gate artifact exists for `6d5c937`.** `packages/agents/data/g11-report.json` and
`g11-transcript.md` in that commit are a dry run's leftovers, not this run's. There was no
artifact to commit because none was ever written — that is the whole finding of the incident,
and it is recorded here rather than papered over.

Everything below was recovered from the run's own SQLite database, which is gitignored and
therefore survived both the reap and the branch switch that followed it.

## The root cause of batch 12 is closed

| | batch 12, DeepInfra pinned | batch 13, unpinned |
|---|---:|---:|
| acts started / completed | 4 | **408 / 408** |
| words spoken aloud | 0 | **121** |
| tiles walked | 0 | **405** |
| tiles worn to a path | 0 | **118** |
| unprompted drinks | 0 | **16** |
| gathers / gathered food eaten | 0 / 0 | **18 / 12** |
| the founder seeded ill | died untended | **tended 7×, recovered at t1440** |
| deaths | 5 of 5 | 3 of 5 |
| cache-read share | 0.0% | **46.4%** |

Same prompt, same minds, same world. The difference is a provider that emits an optional field.

## A single probe decides nothing

The provider probe was run twice on identical code, three calls per candidate, and **gave
opposite answers**: three of four candidates cleared the bar on the first run and none cleared
it on the second. `action` is stable across rounds and separates candidates cleanly; `speech`
is not, because it measures a mind's CHOICE and not a provider's CAPABILITY.

Over four rounds × three calls per candidate:

| candidate | rounds passed | action | speech | dead calls | cache read |
|---|---:|---:|---:|---:|---:|
| StreamLake, pinned | 0/4 | 9/12 | 2/12 | 2 | 0.0% |
| Baidu, pinned | 2/4 | 9/12 | 9/12 | 3 | 83.6% |
| DeepInfra, pinned | 0/4 | **0/12** | 0/12 | 0 | 45.8% |
| unpinned, fallbacks on | 1/4 | **10/12** | 6/12 | 2 | 56.2% |

**DeepInfra emitted 0 actions in 18 calls across six independent rounds and two runs.** That is
a disqualification, not variance.

**Unpinned was the best configuration measured on every axis.** It routed 90.2% of gate traffic
to Baidu anyway, halved batch 11's dead-call rate (6.0% → 3.3%) and doubled its cache-read share
(22.5% → 46.4%). The pin was never the win; the routing already knew.

## Two things this run measured that nothing before it could

**R15's survival tax, at real n.** OLD classifier (sleep and wake counted as survival)
**53.9%, n = 408**, against batch 11's 64.9% — an 11-point fall. NEW classifier (ratchet churn
removed) **35.6%, n = 292**, against a ~28.5% prediction: the same region, not the claimed
number.

**Production is zero on all 17 mind-days.** In four sim-days nobody built, crafted, tilled,
planted, paved, chopped, stowed, wrote or inscribed anything, while the same minds emitted 408
acts. Three founders starved on day 3 while a fourth ate nine meals and gave none away. No
earlier run survived long enough to ask the question.

## What outlives the batch

1. **A 4-sim-day gate is ~60 minutes and ~35 of that is inside four day-closes.** Without a
   resume path, one reap loses the run, its score and its spend. This will recur on every
   4-day gate.
2. **A gate that computes a score it cannot emit has failed for no reason.** All 17 criteria's
   data was in the database; only the writer was missing.
3. **Never conclude a provider capability from a single probe.** Repeat the bar over rounds.
4. **A published capability predicts nothing** (R5, second instance): StreamLake publishes the
   same structured-output support as Baidu and will not speak.
5. **A probe's cache-read share predicts nothing either.** DeepInfra read 45.8% over 12 probe
   calls and 0.0% over a 487-call gate.

Full evidence: `cleanup/c11-batch13-report.md`.

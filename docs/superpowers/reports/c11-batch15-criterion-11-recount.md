# C11 batch 15 — the double-count was real, and correcting it does not clear criterion 11

Branch `c11-work`, from `82c6d13`. Offline throughout: **$0.00, no provider contacted, no new
run.** The counter fix is `0a7dfc5`. **C11 does not close and no tag was created.**

## What was wrong

`g11-deepworld.ts` reported `semanticPassErrors: semanticErrors + narrateErrors`. Both counters
are raised by the same `catch` when a day-close throws, so **one bad night was reported as two**.
`semanticErrors` is incremented at exactly one site, inside that catch, and is therefore a
strict subset of `narrateErrors`. The corrected count is `narrateErrors`: nights whose close
threw, each counted once.

## What the run actually did

Re-derived from batch 14's own `g11.db` (133,698 events, 456 `llm_calls` — the count that
report states), read-only:

| caller | calls | failed |
|---|---:|---:|
| narrator | 5 | **1** (day 3, `No object generated: response did not match schema`) |
| semantic | 4 | **0** |

`chapters` holds days 0, 1, 2 and 4. Day 3 has no chapter.

## The re-score: 15/17, unchanged

`checkG11Report` over the tracked artifact with the corrected counter substituted:

```
BEFORE: 15/17      AFTER: 15/17
changed: 11.the-nightly-semantic-pass-runs-clean   ran=true errors=2 -> ran=true errors=1
```

Criterion 11's bar is `errors === 0`. **One is not zero.** There is no second failure hiding
behind the double-count — the arithmetic simply never reached the bar. Criteria 9 and 11 both
remain UNMET.

## The finding underneath

**The nightly semantic pass never errored.** The one failure belongs to the narrator, and
`narrate.ts` renders the chronicle (line 147) *before* it runs the semantic pass (line 153) —
so on day 3 the semantic pass did not fail, **it never ran**. Two readings follow, and neither
is a clean pass:

- **nights whose close errored** → `1` → criterion 11 FAILS. This is what is implemented.
- **errors of the semantic pass proper** → `0` → would read PASS, but only by reading "ran
  clean" off a night the pass never reached. `semanticPassRan` means "ran at least once", not
  "ran every night".

The second reading is a **ruling for the controller**, not an implementer's choice, and if
taken it needs a companion `semanticSkippedNights` reported beside it — on the pattern of
`semanticUnreadableNights`, reported and never gated — or the criterion goes silent about a lost
night.

## Also recorded

The day-3 failure is the decoder-format fault a third time (batch 14 concern 3, C8 L4): the
error dump contains a complete `title` and `text`. A repair pass would probably have saved the
night, and with it the criterion.

Four pins re-verified unmoved with empty diffs. Batch 14's report quotes four pin paths that do
not exist in the tree; the live files are `packages/engine/src/golden.test.ts`,
`packages/engine/src/g9.test.ts`, `packages/arbiter/src/g4.test.ts` and
`packages/agents/src/prompt/rulesOfBeing*.ts`. A `git diff` over a path that does not exist
returns empty and reads as a clean pin, so the pins were re-checked by grepping the four hash
literals instead.

# Continuity rehearsal — local evidence

Offline fixtures and the bounded real-mind run are reported separately below. Production remains unchanged. These are engineering and behavior observations, not evidence of audience retention.

## R1 integration fixture

`packages/town/src/continuityLoop.test.ts` joins the real scene coordinator, runtime plan queue, engine, SQLite log/memory databases and gateway scene relay. Scripted providers choose an agreement and an explicit exit plan. A later conditional fake decision changes the physical plan after an actual interruption; remaining ordinary turns wait and observe.

The test opens a public exchange, reconnects its viewer relay midway, accepts two independent promises, leaves the conversation with a craft/walk/give plan, and starts crafting. A fixture-seeded hunger change crosses the body-alarm threshold and produces one real `action_interrupted`. The next fake decision reads the interruption and chooses breakfast before walking and giving. The test restarts from disk while that revised walk is running. The recipient moves after the plan was chosen. The engine's existing approach behavior reaches the moved recipient and completes one transfer. The target-arrival action memory is stored, and a later ordinary prompt receives the actual give completion. The intermediate arrival need not win the eight-slot retrieval ranking. A private resolution names only the loaf promise and the actual transfer event; the bench promise remains open.

Measured/asserted boundaries:

- One public scene closes once; closure input and reconnect transcript omit the unique private-aside sentinel.
- Two distinct promise IDs survive restart; resolving one leaves the other open.
- Two physical walks start: the initial chosen destination, then the engine's approach to the recipient. One give starts and one item transfer occurs. No duplicate original walk after restart.
- The original log and replay have equal state hashes. Reconnect relay state/transcript match the connected relay, and a closed scene is absent on the next join.
- Each fake ordinary provider request creates exactly one call-log row. Scene fakes do not make paid requests. This checks duplicate ordinary call bookkeeping, not a live provider's billing.

The fixture does not pretend out-of-range giving is a refusal: the engine already knows how to approach. Its changed route is physical adaptation to the moved recipient. The conditional fake response demonstrates interruption-to-redecision wiring, not autonomous model judgment. Socket transport and visual bubble readability remain separate checks. No runtime goal or forced production plot was added.

## Failure found and fixed

A runtime checkpoint saved the running plan and queue but omitted whether the head had already been submitted. On mid-walk restart it submitted the same head again after arrival, producing an extra zero-length walk. Runtime snapshots now carry the head-in-flight marker, restored only when the body is still active (a pending stop is resubmitted). Separate queued-before-start and already-running restart tests pass.

A parent review also reproduced speech replacing a long physical action's start record. Completion pairing now keeps pending starts by verb and clears them on completion/interruption. Walk → speak → walk-complete retains the walk target and does not inherit the speech's zero-duration settled flag.

A further regression confirmed a different provenance limit: supported work can exceed the 44-tick perception window (showcase houses require 240 ticks). After restart, completion then lost its start parameters. `EventStore.actionStartBefore` now performs a single reverse lookup only when in-window pairing lacks a start, stopping at same-verb completion or interruption. No additional resident state/cache is persisted. The long-build restart test failed before this correction and passes after it.

A final independent review found two more boundary races. An old model answer could clear an action completion that arrived during its request. The clear now checks the completion cursor captured before dispatch. A periodic checkpoint could still contain a plan head that completed before a crash. Runtime snapshots now retain the completion cursor; restore reconciles matching completed steps from committed events, then matches any current activity before keeping an in-flight head. Three regressions cover the pending-answer race, an idle restore beyond the 44-tick perception window, and multiple completed steps followed by an already-running step. A fourth regression covers a restart during the engine’s walk-first take chain. Recovery matches the deferred `then` action, so it takes the item once and preserves the next queued walk. The full runtime/bridge/continuity subset passed 179 tests after these repairs.

## R2 eight-day boundary fixture

A second fixture steps the actual world for **11,880 ticks**: eight full simulated days plus the sixth hour. Wheat grows through stages1,2,3 across spring into summer. A grudge may fade at its existing seven-day boundary; the separate promise stays open with its day-nine reminder. Seventy later utterances compete with a formative source memory older than seven days; bounded recall still includes the source within eight slots. No timer-generated promise-broken event appears.

This is an offline engine/memory boundary test, not eight days of autonomous paid cognition or evidence of viewer return behavior. The source memories and provider choices are fixture data. It establishes no guarantee that real minds will choose this story.

## P2 eight-day food baseline

`foodHorizon.test.ts` adds two scripted residents and real forage/plant/harvest/eat actions. Eight forages yield 25 berries; one wheat crop yields three wheat. Seventeen meals use eight berries, eight starter bread and one wheat, leaving two wheat. The fixture disables hunger and awake-energy decay and supplies the farmer's starter bread. It verifies arithmetic and supported actions across the crop horizon, not autonomous preference, survival balance or audience engagement. No balance change follows from it.

## Verification

Latest extension: 54 tests across bridge, eventStore, continuityLoop and foodHorizon passed; focused Biome passed. This adds the actual interruption/redecision loop and food arithmetic to the earlier run below.

Combined affected run: **287 tests across10 files passed** (continuityLoop, runtime, bridge, retrieval, reflection, household seed/derivation, newborn, resolveCast and liveMinds). Town project typecheck passed. Final focused lint passed after one test-harness arrow formatting correction; town typecheck passed again.

The paid local day and event-based watchability instrumentation are complete and reported separately below. Human comprehension/broadcast review and descriptive return-visit evidence remain unmeasured. The final whole-workspace integration suite and release manifest remain separate checks.

## Real local day — 2026-09-21

A separate fresh orchard town ran with 12 real Luna minds for 1,560 ticks at 1,000 ms per tick (26 min 19 s including startup/shutdown). It stopped itself at the declared boundary. No production state was changed and no storyline or forced action was inserted. Generation of new images was disabled with a $0 art allowance; the shared inference ceiling was $15.

| Measured result | Recorded value |
| --- | ---: |
| Event-log rows | 9,331 |
| Public utterances, paired event mirrors removed | 485 |
| Scenes opened / closed | 37 / 37 |
| Closures by limit / voluntary leave / other ending | 19 / 17 / 1 |
| Completed non-speech actions | 407 |
| Halim completed actions | 21 |
| Explicit action-refusal events | 0 |
| Calls / failed attempts | 949 / 24 |
| Input + output tokens | 6,026,649 |
| Booked provider cost | $1.1166797763 |
| Unsettled reservations after shutdown | 0 |

All 12 residents spoke and completed physical actions. Examples include Dilara discovering and using a wooden-latch recipe, Halim taking wood and making planks after repeated conversations, indoor movement, two transfers, five written records, and a day chapter titled “Kamal Faces Leyla Plainly.” Expressive inspection/test marks do not establish that a bridge or latch was physically repaired. Resident-authored commitment resolutions remain beliefs rather than independent proof.

Scene context was available somewhere in town for 50.5% of ticks; this is not engagement or per-resident activity. Seventeen exact repeated utterances remain a diagnostic, not a semantic assessment. Every scene fit within the 100-line transcript limit. No return-visit or retention improvement was measured.

### Rehearsal failures and follow-up

The day exposed a real provider-contract failure: all 12 nightly reflections reached a nested `oneOf` schema rejected by OpenAI, producing 24 failed attempts and fallback diary entries. This invalidates a claim that the first run proved full nightly continuity. The source now uses a provider-supported `anyOf` union. A later copy-only probe ran the normal production reflection function against a readonly backup of Halim’s actual day: all ten reached calls succeeded without fallback, covering scene summarization, tie review, day summary, six relationship ledgers and autobiography. Conditional personality edits and new gist generation were not reached and are not claimed as live-tested. The original failed history is retained unchanged. See `2026-09-21-v3-model-probes.md`.

The run also exposed seeded houses appearing as 27 new construction milestones, disabled art still attempting admission, slow speech reveal, and repeated capped inspection conversations. Source corrections are covered by focused regressions and subsequent checks. This first process loaded the earlier code, so it is not evidence that those later changes already worked.

Evidence: ignored `real-day-1/{manifest,finished,final-metrics}.json`, world/mind/operations SQLite files and the run log under `.superpowers/sdd/2026-09-21-living-town-swe-todo/`. The read-only `scripts/audit-watchability.ts` reproduces the aggregate metrics without exporting private thought text.

## Final bounded experiment accounting

Five root-controlled local runs booked $1.1424164895 in total, with zero unsettled holds. This includes the real day, streaming comparison, arbiter reasoning comparison, scene-ending comparison and copy-only reflection probe. Production remained unchanged; local bookkeeping is not a claim of final provider-invoice reconciliation.

The scene-ending cue showed no improvement: revised 0/3 chose to leave versus baseline 1/3, and none of the six supplied a new physical plan. The lower-reasoning arbiter comparison was rejected because it lost one useful stock-transfer ruling. Streaming was also not adopted: earlier partial JSON did not consistently reduce complete validated response latency. These experiments do not establish human enjoyment, retention or autonomous shop adoption.

# Scene wrap and action handoff

Local investigation during the isolated real-day rehearsal. No running-world mutation or paid call was made by this investigation.

## Observed delay, not deadlock

The public event log records Halim repeatedly promising a frame inspection across scenes opened at ticks 367, 426 and 495. Those scenes close at ticks 424, 492 and 549 with `closeReason: capped`. Scene `scene_494_bc4c7282` includes the promise “I’ll start with the frame and hinges now” at tick 527, but no physical action followed during that scene.

Halim later takes wood at tick 620 (complete 621), crafts a plank at tick 671 (complete 700), then begins another craft at 704. His runtime at tick 720 has a queued `experiment` describing inspection of the frame and hinge points. These facts establish delayed follow-through; they do not establish a permanent handoff deadlock or a verified inspection result.

## Code path and bounded change

- `packages/agents/src/scene/coordinator.ts`: `takeFloor` commits a structured plan only when its author chooses `leave:true`. A capped close does not invent or execute a plan.
- `packages/agents/src/scene/sceneLlm.ts`: the prior last-turn cue requested a last spoken line, while the optional action handoff was described earlier in the prompt. The new cue offers leaving with supported physical steps, leaving without a new plan, or staying for a meaningful answer. It forbids invented inspection findings.
- The capped closure previously asserted “There was more to say.” The new closure reports the turn limit and requires unresolved matters to come from the actual public transcript.

The prompt placement may contribute to repeated promises; this is an inference, not a causal result. No new inspection verb, forced goal, cooldown, or mandatory action was added.

## Verification and paired probe

Regressions added to `sceneLlm.test.ts` check the final cue, neutral closure request and both model-selected leave/stay responses through the normal strict parser. The focused suite passed after the paid rehearsal ended. Existing coordinator tests cover author-only handoff and stale-response rejection.

Read-only fixture: `.superpowers/sdd/2026-09-21-living-town-swe-todo/real-day-1/halim-capped-probe-fixture.json` (ignored run evidence). It captures the actual last six public lines before tick 548, physical snapshot at tick 540, founder identity source, personality record, preceding physical events and both cues. It is a reconstructed probe, not a recorded provider request: the historical queued plan and exact original prompt were not persisted; current personality mood is not evidence of mood at tick 547. A paired probe should report schema validity, leave choice, supported queued actions, unsupported outcome claims, cost and latency. It must not count a stated intention as completed work.

## Paid paired result

The root-run bounded paired probe returned voluntary leave in one of three baseline responses and zero of three revised-cue responses; none of the six responses supplied a plan. This provides no measured handoff improvement and must not be reported as one. The optional cue is retained only because it makes the existing leave/plan contract explicit; the neutral closure removes a false assertion. A stronger behavioral intervention is not justified by these six calls. The reconstructed-context limitations above still apply.

## Watchability audit correction

During the running rehearsal, a read-only sample found 270 matching `scene_line`/`agent_spoke` pairs where the latter had a higher sequence at the same tick; 65 pairs had physical speech one tick earlier. These are interim counts, not the completed-day totals. The old script only matched speech preceding the scene line, so it double-counted the former group. Example: sequences 1307/1308 at tick 379 contain the same Dilara utterance.

`audit-watchability.ts` now consumes at most one exact speaker/text match per scene line within one tick in either direction, choosing the closest sequence. A dedicated script regression preserves unrelated speakers, different words, repetitions beyond that window, and unmatched duplicate lines. Matching is still a bounded inference from the paired event representation; the events have no shared utterance ID. The two dedicated metrics tests passed after the rehearsal.

The existing 180-tick daily talk budget limits only casual unnamed admission. Named speech can open another scene after that budget; joining a nearby scene and an already-open scene also remain possible. This explains why repeated direct questions can continue, but does not prove that a global conversation time cap would improve the town. A scene opens over any pair, so town-wide scene coverage can be high while most residents work. The report now explicitly calls this available context, not measured engagement or action. Commitment counts remain resident-authored beliefs/resolutions, not verified fulfilment. No 80-percent occupancy control or forced resident action was added.

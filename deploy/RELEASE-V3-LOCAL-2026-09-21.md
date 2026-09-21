# San Junipero v3 local candidate

Local implementation on `codex/sanjunipero-v3`. Production was inspected read-only and remains unchanged. No production image, push or deployment is part of this release.

## Source and data

- Baseline: `dc1df669` (approved audit and existing viewer work).
- Scene transport follow-ups: `800bbddf`, `155417f7`.
- Final implementation commit: `b3f18dc205b1c58e6636a8477557f618cca23bf2`.
- Workspace: `/Users/deadpackets/workspace/SanJunipero/.worktrees/interiors-redesign`.
- Protocol: 9. Old strict clients must reload. Historical binary compatibility is not promised.
- State changes: commitment resolution/evidence/reminder fields, plan-head-in-flight and completion-cursor checkpoint state, explicit scene handoff, shared spending reservations/limits, persistent observer run identity, seeded-building event provenance and strict building appearance recipes.

## What changed

| Boundary | Result |
| --- | --- |
| Decision → action | Completion wakes a resident without the previous idle-gap delay. Item/location outcomes are explicit. Physical plans survive conversations and restart. |
| Memory → tomorrow | Commitments have stable identity, reminders and resident-authored resolution. Reflection revises goals rather than silently replacing them. Retrieval retains bounded older formative context. |
| World → cognition | Roofed storage requires room access; work duration is truthful. Claims remain separate from physical effects. Social laws can be broken and witnessed. |
| Conversation → viewer | Snapshot, reconnect and historical scrub carry public scene context and transcripts. Private asides do not become public conclusions. |
| Viewer → town | Dock-only journal, mobile drawer, asset-loading barrier, compact balloons, faster text reveal, larger person targets, public usage and honest mind health. |
| Operations | Shared reservations cover callers and art; shutdown preserves billing and live writers; invalid schemas fail before dispatch. |

The approved warm-paper design and existing Luna minds remain. Streaming and lower arbiter reasoning were measured and rejected for adoption. Jev and comparative viewing designs remain deferred. Shop primitives reuse existing goods and transfers; no general economy was added. No forced plot, scheduled drama or compulsory relationship outcome was added.

## Evidence

One fresh local orchard day: 12 real minds, 1,560 ticks, 485 distinct public utterances, 37 closed scenes, 407 completed non-speech actions, including 21 by Halim. The original day caught a nightly reflection schema failure. A separate copy-only probe of the repaired normal reflection path completed ten calls without fallback. The failed original history remains intact.

All five paid runs together booked **$1.1424164895 of $100**. No outstanding or uncertain reservations and no paid process remain. A high conversation count is not proof of audience retention. Autonomous shop adoption, listening quality and paired GPU/battery gains remain unproven.

Evidence reports:

- `docs/reviews/2026-09-21-continuity-rehearsal.md`
- `docs/reviews/2026-09-21-v3-halim-trace.md`
- `docs/reviews/2026-09-21-v3-model-probes.md`
- `docs/reviews/2026-09-21-v3-streaming.md`
- `docs/reviews/2026-09-21-v3-viewer-verification.md`

## Local review

The existing scripted preview is at `http://127.0.0.1:8774/`. Recorded real-mind playback is at `http://127.0.0.1:8776/moment/0/06:15?inside=structure_cottage_59_44`. Playback makes no AI calls. A moment link first plays its short selected interval; “Run this day forward” continues playback.

Build before starting a viewer because the gateway caches the HTML shell:

```sh
pnpm --filter @sj/web build
pnpm exec tsx packages/town/scripts/review-rehearsal.ts \
  .superpowers/sdd/2026-09-21-living-town-swe-todo/real-day-1 8776
```

Read-only aggregate analysis:

```sh
pnpm exec tsx scripts/audit-watchability.ts \
  .superpowers/sdd/2026-09-21-living-town-swe-todo/real-day-1
```

The raw world/mind/operations databases and provider transcripts stay in the ignored execution directory. They contain private resident data and are not committed. The archive has the original run's pre-fix seeded-house milestones; fresh v3 worlds mark those as seeded and filter them from earned firsts.

## Recovery and further work

Recover the earlier source in a separate worktree and use a separate database. Do not point an earlier binary at v3 state or overwrite a production volume with rehearsal files. No destructive data cleanup is needed for review. Any later deployment must name this candidate, its own data decision and its spending limits; this document does not authorize it.

## Final verification

`pnpm check` exited 0 on the frozen implementation: **536 test files and 8,859 tests passed**. The test phase took 203.28 seconds. Typecheck, lint (0 errors), formatting and knip passed. Existing lint warnings remain. `pnpm --filter @sj/web build` passed with the existing large-chunk warning. Browser review reported no console errors on the inspected routes. Runtime checks use fake providers unless explicitly listed as paid evidence above.

The final independent review found and closed completion feedback loss during model awaits, stale-checkpoint duplicate actions and recovery during walk-first chains. The targeted runtime/bridge/continuity suite passed 179 tests before the full gate. Docs-only updates after this commit do not change runtime behavior.

# Launch fixes and private rehearsal

Goal: fix the four verified launch defects and avoid redundant renderer work, then observe a fresh Orchard town with real minds for 60 minutes.

Architecture: retain existing action, runtime, ledger and scene systems. Stop scheduling before shutdown, retain queued plans, and drain ordinary requests before closing databases. Reuse existing error backoff. Do not redesign simulation or change visual quality.

Spec: `/tmp/sj-launch-referee.md`, plus the owner's request for quality-preserving power improvements.

## Constraints

- Isolated branch `codex/interiors-redesign`; production stays untouched.
- Fresh private database, full founder roster, existing model route and spend guards. No secret contents read or printed.
- Focused regressions only, one test process at a time. No tests during the paid rehearsal.
- Preserve current viewer on 8774; private rehearsal uses a free separate port.
- Build before launch; monitor tick advancement, spend and errors. Stop the paid run after the bounded observation and retain its evidence.

## Work

- [x] Construction guidance: reproduce the invalid universal Orchard coordinate, remove the false instruction or supply a valid one, verify actual recipe door validation.
- [x] Conversation failure: reproduce swallowed provider errors, propagate after token cleanup, verify existing cooldown.
- [x] Shutdown: reproduce lost plans and omitted ordinary requests, preserve plans and drain/cancel pending work safely, verify checkpoints and ledger cleanup.
- [x] Renderer: remove measured redundant work without lowering visible quality; verify lifecycle and image output.
- [x] Private rehearsal: build, launch fresh Orchard with 12 founders and existing budget controls, observe 60 minutes, exercise restart, stop and report measured outcomes. Use a separate launcher because the stock shell script rotates/deletes old files.

## Verification and rehearsal result

- Final focused run: 533 tests passed across 15 backend/renderer files, with no unhandled errors (28.18 seconds). Delayed provider, embedding, and price requests are simulated; no paid call was made. Evidence: `/tmp/sj-final-verified.log`.
- Backend and web TypeScript checks pass; the web production build passes. Changed-file lint has zero errors (warnings remain). Journal/Folk opening and closing focus were checked in the browser with no console errors.
- Fixed replay at day 26 11:36, 1280x720 viewport and 2560x1440 canvas: draw calls fell from 1359 to 1348. This does not measure watts or battery life.
- The owner supplied the existing environment file on the project server. Its contents were never read or displayed. The isolated container mounts it read-only and exposes port 8099 only on loopback.
- Private rehearsal started 2026-09-17 17:07:42 UTC: fresh Orchard, 12 founders, $10 daily/lifetime cap, restart after 30 minutes, stop after 60. Source: `2251366d` plus Docker metadata exclusions. Evidence: server `/tmp/sj-rehearsal-2251366d/evidence/run-1789664850274`. Initial preflight passed 3/3; first indoor conversations completed. Completed at 18:07:42 UTC with exit 0. Final recorded spend $0.8238819501, 953 completed calls, 3 shutdown cancellations, zero pending reservations and 16 intact databases. Full report: `docs/REHEARSAL-2026-09-17.md`.

## Deviations

- Shutdown review also exposed detached memory writes, council closing, and birth/arrival work that could outlive their databases. These now participate in draining; cancellation does not permanently mark names or interrupted nights complete.
- Seven obsolete UI test prop signatures were repaired to make the web typecheck pass. Running those four old test files exposed 29 existing design/harness assertion failures (93 pass); they are not claimed green. Most reference removed selectors/copy; one requires browser localStorage unavailable in the current Node harness. This work does not certify the full historical UI suite.

- The first isolated startup stopped before any paid calls: macOS archive sidecars matched terrain image filenames. Docker now excludes `._*` and `.DS_Store`; the clean image ingested all artwork successfully.

## Follow-up

- Thread heartbeat `review-private-san-junipero-rehearsal` is paused after the completed run. No more paid runs are scheduled.
- Actual end: 2026-09-17 18:07:42 UTC (22:07:42 Dubai). Restart restored tick 597; final shutdown took 501 ms.
- The rehearsal viewer stopped with the paid run. No production service was changed.

## Post-rehearsal corrections

- The run lost one conversation-closing event at restart. Shutdown now commits queued announcements after asynchronous work settles, without advancing time.
- Regression testing exposed a thought-memory callback submitting after the bridge drained. Stopped bridges refuse new submissions, and turn application checks for shutdown after awaits.
- All 231 tests in the four affected files pass. TypeScript passes; changed-file lint has zero errors. These follow-up fixes were verified without another paid run.

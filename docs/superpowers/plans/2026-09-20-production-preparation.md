# Production preparation implementation plan

**Goal:** Prepare and verify a release candidate for a fresh production town with real minds.

**Architecture:** Retain the existing event log, SQLite mind stores, spend ledger, Docker image and backup service. Fix confirmed defects without adding a new deployment platform.

**Tech stack:** TypeScript, SQLite, React, Three.js, Docker Compose.

**Spec:** `CLAUDE.md`, `docs/REHEARSAL-2026-09-17.md`, `docs/REHEARSAL-2026-09-18.md`, and the owner's production-preparation request.

## Constraints

- Production stays stopped until the owner approves the prepared deployment.
- Never read or print credentials. Load the existing environment file through Node or Docker.
- Preserve spend history through a fresh-town reset.
- Run no test suite during a paid rehearsal. Stop a rehearsal that fails to advance for 15 minutes.
- Preserve the four untracked UI review pages and the local preview database.

## Work

- [x] Fix fresh reset in `packages/town/src/devWorld.ts`. Add a failing regression in `packages/town/src/persistence.test.ts` that preserves the operations database and its WAL while deleting resident memory.
- [x] Run the full type, lint, format, dependency and test checks, then build the viewer and a fresh Linux Docker image. Resolve failures before running minds.
- [ ] Run an isolated, bounded release rehearsal on port 8099. Verify tick progress, day transition, restart, indoor dialogue, database integrity and spend limits. Reuse prior Forge evidence and verify construction integration separately. Record limits honestly.
- [ ] Prepare deployment settings and backup/restore evidence. Verify configured credentials by presence only. Keep startup fresh-reset disabled and document the selected data volume and spending limits.
- [ ] Record release evidence, integrate the verified changes into the local town, and present the concrete production launch procedure for final approval.

## Deviations

The dependency scan needed the existing UI review entry registered in `knip.json`. One UI test counted four address-bar references instead of five after the approved house-entry change. Both were corrected, then all 8,656 tests passed across 515 files.

Off-server backup credentials are absent. The owner has been asked for the target bucket and production daily limit. These remain launch prerequisites, not inferred approvals.

The real Docker entrypoint failed the stop check: `pnpm` exited on SIGTERM before `serve.ts` handled shutdown. All 12 mind checkpoints lagged the world by 8 ticks. Run Node directly as PID 1, then repeat the container stop and resume checks before accepting the release.

# Release preparation, 20 September 2026

Production remains stopped. The local town includes the fixes. The rehearsal uses separate storage, loopback port 8099, and the server's existing environment file without displaying credentials.

## Changes

- A fresh-town reset now preserves `_ops.db`, `_ops.db-wal` and `_ops.db-shm`. Resident and narrator memory still resets. A regression failed on the missing ledger before the fix and passed after it.
- The real Docker rehearsal exposed a shutdown bug outside the unit-test harness. `pnpm` received SIGTERM and exited before the town drained. Node now runs directly as the container's main process, with the working directory kept at `packages/town`.
- Restarting during nightly reflection exposed a second shutdown bug. Memory-summary retries treated cancellation as a provider failure and slept past the five-second drain deadline. Reflection now receives the client's cancellation signal, cancels retry timers, waits for all summary requests to settle, and leaves a cancelled night unfinished for the next boot. Provider timeouts still use the existing fallback.
- The container health probe now rejects 15 minutes without tick progress, even if HTTP still returns 200. This flags a paused or stalled world without automatically restarting it.
- The overnight chronicle exposed a punctuation bug: closing quotation marks became the first token of the next sentence, so “They” and “He” were mistaken for invented residents. Sentence splitting now keeps closing quotes with the preceding sentence. The regression failed before the one-line fix, and all 226 narrator tests passed after it. Invented-name detection remains covered.
- Knip now recognizes the existing standalone UI review entry. The house-entry change's address-bar test now accounts for the additional navigation call.
- `deploy/compose.production.yaml` specifies the approved Orchard layout, 12 founders, interiors, construction, 16 lamps and minds on. It requires explicit spending limits and uses the existing fresh-volume override. `SJ_FRESH` stays pinned to zero.

## Release checks

| Check | Result |
|---|---|
| Full suite | 8,671 tests passed across 516 files, 197.64 seconds |
| Type checking | Passed |
| ESLint | Zero errors, existing warnings remain |
| Biome formatting | Passed |
| Knip | Passed |
| Viewer build | Passed, existing bundle-size warning remains |
| Linux Docker build | Final image passed, 565,629,371 bytes |
| Docker health probe | Advancing clock passed, stalled HTTP-200 clock rejected, resumed clock recovered |
| Production Compose validation | Passed with placeholder $10 daily and $50 lifetime limits, no service started |
| Browser inspection | Docker-served desktop and 390 px mobile views loaded with zero runtime errors and no mobile horizontal overflow |
| Admin access | Anonymous `/admin/clock` returned 401, configured bearer returned 200 |

The first full suite exposed one stale UI source-count assertion. It was corrected and the entire suite was run again. No test suite ran while the paid rehearsal was active. A final rerun initially hit sandbox socket restrictions (`listen EPERM`), was stopped, and was restarted with local networking permitted.

The final runtime is committed at `bb88d505`, with image `sj-release:bb88d505` on the server. Its image ID is `sha256:18acb6ab596b3bb1e61598e46912c819b3ad0fd33c5846ab6564301b6b831fe3`.

## AI rehearsal

The fresh-boot check uses the real container entrypoint with a $1 ceiling and one controlled restart. The boundary check resumes a copy of the previous AI town, with a separate $2 additional-spend ceiling, at 650 ms per simulation minute. It crosses midnight and continues into late morning, with another restart before midnight.

The accelerated boundary check is evidence of integration and persistence, not natural conversation pacing. The earlier one-hour real-time rehearsal remains documented in `REHEARSAL-2026-09-17.md`.

The first fresh-town run reached tick 104 with 23 successful calls and $0.0318201642 recorded spend. It produced six speech events, including two indoors with matching room context. All 16 databases passed integrity checks, but the container exited 1 on Docker stop and all 12 mind checkpoints lagged the world at tick 96. This failed shutdown evidence prompted the Docker entrypoint fix.

A complete copy of that stopped town restored at tick 104 with 12 residents and 27 structures. All 15 mind/operations database hashes matched. This proves the copy restored, not that the failed shutdown was acceptable.

The corrected image runs `node --import tsx src/serve.ts` as PID 1. Its first stop exited 0, logged the town's SIGTERM handler, and saved all 12 mind checkpoints at the world's final tick 139. No reservations remained. The evidence harness initially lacked write permission on its copied directory; ownership was corrected using the host user's actual UID before collecting the stop result.

Evidence is stored under `/tmp/sj-release-20260920/evidence` on the supplied server and `data/release-evidence-20260920` locally, outside Git.

The first boundary run stopped at tick 1325 during an active reflection. It recorded $0.1294105428 additional spend and failed to drain cancelled summary retries. The run was stopped, four regressions were added, and the retry logic was corrected. Repeat-run limits subtract that spend from the original rehearsal allowance.

The corrected boundary run completed at tick 2100 and exited 0. It advanced through 910 consecutive ticks, crossed midnight, slept and woke all 12 residents, and completed nightly reflection for every mind. The active-evening restart stopped in 520 ms and resumed at exactly tick 1326. The final stop took 506 ms. All 12 mind checkpoints matched tick 2100, all 16 databases passed integrity checks, and no spending reservations remained.

It produced 176 speech events, 120 indoors, with zero room-context mismatches. Seventeen social scenes opened and closed. The chapter's four citations all point to real events. The cast-filter alert led to the punctuation fix above, verified after the paid run stopped. The full overnight rehearsal therefore covers runtime `056a1e97`; the later narrator-only change has separate regression evidence.

The repeat made 527 calls, 518 successful and nine cancelled during controlled stops. Those cancellations produced reflection, scene and adjudication alerts, but did not prevent recovery, completed reflection or database closure. It added $0.5678574219 to the copied $0.8238819501 ledger. Total recorded additional spend across today's attempts was $0.7313712273, below the $3 combined ceiling. This is ledger spend, not an independent provider invoice reconciliation.

A whole-directory archive was copied off the server. Its SHA-256 is `6ae27cb2070def104a6d467b84c393937bbf20e0f5f2fab70079600b36ed172f`, verified on both hosts. Restoring that archive into separate storage resumed tick 2100 with 12 residents and 27 structures. All 15 mind/operations file hashes matched, and the restore ran without live AI. The archive is a manual recovery copy, not continuous production backup.

## Forge evidence

All 12 discovery-commission integration tests passed in this candidate. The full suite also covers construction, generated material ingestion and safe fallback. The last real paid material commission, its accepted wall maps, rejected roof fallback and browser application are documented in `REHEARSAL-2026-09-18.md`.

The boundary run recorded Bashir independently discovering a rope-basket recipe at tick 2033. It did not produce a new building commission. No test forces a resident to invent a pub or store. A controlled commission and a spontaneous discovery are different evidence. This release does not claim an autonomous discover-build-generate sequence unless it occurs in the observed run.

## Launch prerequisites

- Confirm the daily spending limit and lifetime ceiling.
- Supply an off-server backup bucket and credentials, then verify an actual remote restore. The server currently has neither Litestream bucket nor backup credentials configured.
- Resolve the production ledger source. Existing repository world files have no adjacent mind directory. The two located `_ops.db` files belong to old rehearsals and must not be mistaken for the production ledger.
- Approve the concrete deployment after the rehearsal and recovery results are reviewed. No production service has been started or changed.

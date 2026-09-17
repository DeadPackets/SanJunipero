# Private AI rehearsal, 17 September 2026

Completed 60 minutes. The run exposed a lost conversation-closing event at restart. Follow-up regression work exposed a late-action shutdown race. Both are fixed locally and covered by passing tests. This is evidence for the exercised paths, not a claim that every production feature is verified.

## Measured result

| Measure | Result |
|---|---|
| Observation | 17:07:42–18:07:42 UTC, 60 minutes |
| World | Fresh Orchard, 12 founders, 27 initial structures |
| Simulation | 1,190 minutes, no missing or duplicate tick events |
| Calls | 956 ledger entries: 953 completed, 3 shutdown cancellations |
| Recorded cost | $0.8238819501 against a $10 cap |
| Restart | Tick 597 restored exactly; shutdown took 548 ms |
| Final shutdown | 501 ms, container exit 0 |
| Outstanding reservations | 0 |
| Database integrity | 16 of 16 passed |
| Mind checkpoints | All 12 saved at tick 1190 |

All completed calls have reported prices. The three cancelled requests have no returned generation ID or reported price; their ledger cost is zero. This does not establish that the provider could not charge an interrupted request.

## What the town did

The log contains 317 completed actions, 43 building entries, 34 exits, 39 indoor destination choices, 8 meals, 11 stoking actions and 2 fishing actions. Residents slept and woke. The last stored world snapshot is tick 1140; later events remain in the log through tick 1190.

There were 603 spoken lines, including 321 indoors, and 51 conversations opened. The log contains 49 closures: one closure was lost at restart and one conversation was still active at final shutdown. The 49 recorded closures all contain summaries.

All 603 speech-room labels match the speaker's building entry/exit history at that event. A sampled claim that the cottage hearth was lit at tick 755 agrees with fuel lasting through tick 854. Bashir's fishing discussion was followed by completed fishing at ticks 710 and 774. This sampling does not certify every statement as factual.

## Fixes discovered by observation

1. Conversation `scene_575_bf1f4ccd` opened at tick 576 and lost its closing event at the restart. The coordinator completed after the clock stopped, leaving its announcement in memory. Shutdown now commits queued events after pending work settles, in one transaction, without advancing time. Replay and rollback checks cover the change.
2. A thought-memory write could finish after shutdown and submit speech to a queue that would never run. The stopped bridge now refuses late submissions immediately. The runtime checks its running state after awaited thought, speech and action work, preserving saved plans.
3. The first container startup failed before model calls because macOS archive sidecars matched terrain image filenames. Docker now excludes those files. The clean image imported 56 terrain tiles, 37 building/resident assets and 61 item assets.

The original paid-run evidence is preserved unchanged. The first two fixes were made after that run and verified with fake models; they have not been through another paid hour.

## Verification

- Before the run: 533 focused tests across 15 files passed; backend/web typechecks and the viewer build passed.
- After the two additional shutdown fixes: 231 tests across the engine loop, bridge, runtime and live-world files passed in 32.80 seconds. This count overlaps the earlier run and must not be added to it.
- Backend/web and live-test TypeScript checks pass. Changed-file lint has zero errors and 160 warnings. Diff whitespace checks pass.
- The private viewer rendered the town and reported no console errors at the initial visual check.

## Coverage limits

- No new building completed after founding. Real Art Forge image generation and generated building placement remain unverified by this rehearsal.
- The run covers 19 hours 50 minutes of simulation, so it does not cover a full day boundary, night reflection, long-term memory growth or population changes.
- Earlier historical UI suites still contain 29 design/harness assertion failures. They are not claimed green.
- Renderer changes skip unused point-light shadow updates and invisible picking draws. A fixed replay measured 1359 to 1348 draws per frame. Battery life and watts were not measured; visible quality settings were retained.

## Evidence and isolation

Remote evidence: `/tmp/sj-rehearsal-2251366d/evidence/run-1789664850274` on the user-provided project server. The stopped container is `sj-private-rehearsal-clean`. Local audit and regression outputs are under `/tmp/sj-private-rehearsal/`.

The paid image used source `2251366d` plus the Docker metadata exclusion committed as `f17e4354`. It loaded the existing server credential file by path; its contents were not displayed. The viewer bound to loopback. Production was not changed. The follow-up automation is paused and the rehearsal is no longer spending.

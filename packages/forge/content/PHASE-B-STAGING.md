# Phase B staging note (2026-08-16)

Phase B live calibration ran on branch asset-v2 and stopped at step 2 with
**BLOCKED-STRIPS**: gemini-3.1-flash-image renders a 2-row grid instead of a 1×5
horizontal strip on a square 1024 canvas (4/4 probe attempts, guided and unguided,
hardened prompt included). Controller escalation (image-to-video or wide-canvas
ruling) is pending — see the Phase B report in the session scratchpad
(`cleanup/asset-v2-phaseB-report.md`).

No generated art is committed here. All paid outputs (2 concept candidates — c1 is
the runner-chosen identity root, human ratification pending — plus 4 probe strip
raws and judge scores) live in the durable scratchpad under `c5/concept/` and
`c5/character-v3/`. They stage into `content/` only after human approval.

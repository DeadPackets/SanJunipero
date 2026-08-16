# Phase B staging note (2026-08-16)

Phase B2 (controller ruling on BLOCKED-STRIPS) unblocked strips via **rung 1:
wide canvas** — `size: '1536x512'` yields clean single-row 1×5 strips 4/4; with
the margin prompt clause and coarsen-to-fit placement, all 4 walk facings pass
every gate (guided won the A/B). Residual block: **ne + nw sleep cells fail the
palette gate** (jaccard 0.250 / 0.167 vs the 0.800 floor, 3 attempts each), so
gen-character-v3 exits BLOCKED — walk cycle itself is shippable pending human
review. Portraits held on a budget ruling. See the Phase B report in the session
scratchpad (`cleanup/asset-v2-phaseB-report.md`), Phase B2 section.

No generated art is committed here. All paid outputs (concepts, every strip/sleep
candidate raw + judge scores, 24 processed cells, 4 walk GIFs, distance matrices)
live in the durable scratchpad under `c5/concept/` and `c5/character-v3/`. They
stage into `content/` only after human approval.

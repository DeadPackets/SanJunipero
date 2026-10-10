# Watchable town proposal

Read [PROPOSAL.md](PROPOSAL.md) for the recommendation, three product directions, component changes, systemic changes, research and staged acceptance checks.

From the worktree root:

```sh
python3 -m http.server 8778 --bind 127.0.0.1 --directory docs/proposals/2026-09-21-watchable-town
```

Open http://127.0.0.1:8778/. Select A/B/C and play the 32-second study, or select individual beats. The Journal, story-follow toggle, public usage disclosure and B's place selector are interactive examples. They do not affect any town.

## Provenance and limits

- Exact dialogue and the latch crafting result come from the local real AI rehearsal, Day 0, ticks 414–473. The broader source excerpt is in `scene-evidence.json`, with original event sequence IDs.
- Room composition and map are illustrative canvas drawings. They are not historical coordinates, a proposed replacement renderer or final art.
- Character sprites and flat icons are copies of existing project assets. Local fonts are copied from the existing installed font packages. Nothing loads from an external CDN.
- Each direction presents the same excerpt. The 32-second edit skips elapsed world time and displays the sampled clock, so it is labeled Recorded. It is not a live director or an implementation of the proposal's delayed playback.
- Follow and journal state are in-memory demonstration state. Category names in the journal are visual examples, not functioning category navigation. No backend mutation or inference occurs.
- The paper and icon treatment preserves the existing identity. The main choice is the viewing model. This prototype cannot establish retention, autonomous follow-through or final renderer performance.

## Verification

Preview JavaScript syntax was checked. Browser review covered desktop A/B/C, source-backed consequence text, mobile captions at 390 × 844, and journal/follow controls. No production source was changed, so a production test-suite run would not validate this design proposal.

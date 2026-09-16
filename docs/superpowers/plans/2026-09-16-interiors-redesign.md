# Interiors redesign implementation plan

Goal: make indoor life readable and visually continuous with the approved town.
Architecture: share the existing Three renderer, draw only one active room, retain 2D character atlases and the existing InteriorScene interface. Room state comes from WorldStore. No new mind planner or furniture simulation.
Scope approved in conversation 2026-09-16. Branch codex/interiors-redesign, baseline codex/interiors-baseline (3cd12a38). Original worktree and 8773 remain unchanged.

- [x] Snapshot dirty town and create isolated worktree. Check: original branch unchanged, worktree clean.
- [x] Compare two throwaway compositions before implementation: open dollhouse and close cinematic room. Favor open dollhouse for quiet viewing and mobile readability.
- [x] Build room geometry/materials and active renderer in render/three/interiorRoom.ts and interior.ts. Feed actual structure dimensions, owner profile, beds, fuel and stored items. Use the existing WebGLRenderer. Check: real house, shared roof, shed and storehouse framing.
- [x] Wire StageMount, follow-through-doors, active-room captions and InteriorHUD. Check: enter/exit, resident selection, paused replay, active-room speech, keyboard escape, desktop and mobile.
- [x] Correct indoor drop destination and social hearing boundary. Preserve event schema and replay compatibility. Check: inspect use of existing structure location and hears function.
- [x] Build isolated web app, snapshot local SQLite with backup API, serve separate scripted town on 8774. Check: AI minds off, local 8773 still serves old bundle, no production changes.
- [x] Manual browser polish and save final branch commit. No test suites, typecheck, lint or release gates per user instruction.

Furniture stations are presentation of existing activities, not new agent choices. No claim that residents choose chairs or place decorative objects. Bed layout represents building capacity, not individual bed ownership. Room title, occupancy, real stored items and hearth status are visible in the HUD.

## Review result

Implemented on the isolated branch. Two throwaway compositions were compared in `/interiors/composition.html` on the study server. The open dollhouse was used. The separate service is on port 8774 with a copied SQLite database and AI minds disabled.

Manual browser checks covered a personal house, the larger farmhouse, sleeping and awake sprites, stored item quantities, return to town, replay following through doors, resident selection, Escape from Belongings, desktop framing and 390px mobile framing. Build completed successfully. No tests, typecheck, lint or release gates ran, as requested.

Validation limits: storehouse/shed geometry was reviewed in source but not individually checked in the browser. The copied history has no fueled indoor hearth event, so the lit/cold transition was not visually exercised. Indoor speech filtering and the engine fixes were inspected in source, not exercised with AI minds. Visual acceptance is pending the owner’s review.

## Deviations

Private houses show one main bed, with extra sleeping occupants represented by bedrolls; shared roofs show their full capacity. This avoids turning every personal home into a dormitory. Furniture is still presentation of existing verbs, with no new furniture simulation. Existing material slots can accept Forge maps; this work does not add a Forge generation workflow.

Branch, service and integration details are in `docs/INTERIORS-REDESIGN-2026-09-16.md`.

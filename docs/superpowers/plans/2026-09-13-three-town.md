# Full town renderer implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Render the live, replayable town with the approved Three.js appearance.

**Architecture:** Three.js renders the exterior beneath the existing transparent Pixi reading canvas. The existing camera, WorldStore, character interpolation, interior scenes and React controls retain their contracts. Material sets extend Forge metadata without changing event state.

**Tech Stack:** TypeScript, Three.js 0.186.0, Pixi 8, React 19, Vitest, Biome.

**Spec:** docs/superpowers/specs/2026-09-13-three-town.md

## Global Constraints

- Production stays stopped. No secrets, paid calls, or writes under data/.
- No whole-suite tests or knip. One vitest process at a time.
- Engine browser imports use existing safe subpaths.
- Existing asset records and event replay remain compatible.
- New visuals observe state. They do not create facts or change minds.

## Task 1: Materials from Forge

Files: shared material manifest and tests, forge material ingestion and tests, shared index, Forge documentation.
Interface: `parseMaterialSetManifest(meta: string | null)` returns a validated manifest or null. Manifest references immutable PNG asset IDs for color, normal, roughness and emission. Local ingestion validates matching map sizes before registration.

- [x] Write invalid-size, missing-map, unsupported-version, and legacy-meta tests.
- [x] Run the focused tests and confirm the new contract fails before implementation.
- [x] Implement additive metadata and a local ingestion path using existing codex registration.
- [x] Verify tests and document the exact local import command. No paid generation.

## Task 2: Full town geometry

Files: web render/three/{structures,terrain,materials,occlusion}.ts and tests.
Interfaces: `buildStructure(s: Structure, config: SimConfig): Group`; renderer owns disposal. Geometry stays within state footprint. Terrain chunks cover all terrain and refresh on changed tiles. Occlusion uses stable transparent materials with 0.65 s hold, 0.6 s fade and 0.8 s restore.

- [x] Test complete kinds, construction stage, rotated non-square footprints, lamp shadow clearance and fade continuity.
- [x] Implement shared geometry, bounded terrain chunks and visible resources using the approved prototype as reference.
- [x] Connect Forge material maps with color maps in sRGB and scalar maps in linear space.
- [x] Verify geometry and visibility tests with no browser required.

## Task 3: Viewer integration

Files: web render/three/world.ts, scene.ts, StageMount.tsx, characters.ts and projection tests.
Interfaces: `createThreeWorld(root, scene, store, chars, callbacks)` returns `{tick(dtMs), destroy()}`. It consumes the existing camera transform and interpolated sprite atlas frame. Three's camera must project tile centers to the same positions as Pixi labels.

- [x] Test projection at multiple zooms and camera positions.
- [x] Make the reading canvas transparent and place Three underneath. Disable duplicate outdoor art, shadow and lighting passes.
- [x] Wire selection, doors, pause, resize, replay resets and teardown. Keep furnished interiors and all React controls.
- [x] Verify typecheck and build, then inspect the actual local scripted town.

## Task 4: State-driven atmosphere and clearance

Files: web render/three/world.ts, environment.ts, characters.ts and tests.
Interfaces: environment reads `flames(state, config, tick)` and the shared day clock. Character world position comes from tile centers with bounded wall clearance.

- [x] Verify unlit lamps and expired fires produce no point light.
- [x] Implement sun/sky, real local lights, soft shadows, wind and rain driven by state and viewer motion settings.
- [x] Verify construction, removal, tile changes and growing maps refresh without whole-scene pop.
- [x] Run replay and scripted-path regression contracts.

## Task 5: Full viewer review

Files: tests and implementation files above, migration documentation.

- [x] Run focused web tests and shared/Forge contract tests serially.
- [x] Run root typecheck, eslint on changed code, Biome, and the viewer build as separate calls.
- [x] Start a local scripted world with its database outside data/ and no live mind import.
- [x] Inspect full town, close street, night, selection, room entry, replay, paper docking and broadcast.
- [x] Review the complete diff, fix material defects and record measured limitations.

## Decisions and deviations

- Keep furnished interior scenes functional in Pixi. Exterior migration must not discard them.
- Preserve grid navigation. A center-anchor correction and inset building walls supply clearance without invalidating existing doors or lanes.
- Work in /Users/deadpackets/workspace/SanJunipero-three on codex/three-town.

# Orchard Courts Implementation Plan

**Goal:** Implement approved option D as a physical starting town, with connected expansion courts and a polished Three.js view.

**Architecture:** Shared deterministic layout supplies terrain, structures, lamps, protected gardens and construction plots. Orchard is an explicit genesis layout so existing lattice histories retain their own rules. Engine construction reads standing rectangles and lays only the paths and footprints needed by a new court. The local town and production genesis consume the same template.

**Tech Stack:** TypeScript, existing event engine, Three.js, existing local gateway.

**Spec:** Approved D at http://127.0.0.1:8772/layout/#d and the user's subsequent implementation approval.

## Constraints

- No AI minds or production deployment.
- No tests, typecheck, lint or release gates, per the owner's standing instruction. Use the web build and manual observation.
- Preserve existing uncommitted work and databases. Use a separate orchard preview database.
- Keep approved house geometry, existing ownership, real collision and recorded events.
- Preserve the old layout for existing worlds. No migration of saved histories.

## Work

- [x] Shared layout: add `packages/shared/src/orchard.ts`, exporting a deterministic template, core plots and expandable courts. Add optional genesis layout/origin configuration without changing legacy defaults. Check: inspect rendered terrain and plotted footprints.
- [x] Simulation: wire orchard genesis, layout identity, construction reservations, safe access paths and world growth. Preserve legacy branches. Check: observe local construction and entrances, inspect live state.
- [x] Local integration: add orchard map support to town startup and environment selection. Seed real lamps and the bridge through existing structure events. Check: a fresh local town reports minds off and resumes the same layout.
- [x] Visual polish: refine the green, front paths, farm, orchard planting and camera framing in the real Three renderer. Check: daylight and night visual review, Folk/Land and director controls.
- [x] Build and open the full local UI for owner review. Record completed work and remaining verification limits in handover.

## Deviations

The eight-tile bridge symbol in D was a planning drawing. Use a three-tile physical river crossing with short paved approaches, within the existing bridge model. This keeps the arrival composition without inventing a new bridge type.


The owner requested a straight river during implementation. The three-tile channel now follows one fixed column, with straight banks and animated world-space water shading. Water flow and lighting remain active in paused replay, except with reduced motion enabled.

Manual replay after a server restart exposed an existing gateway-baseline bug: it received resumed terrain as the initial terrain. Local startup now gives the gateway the genesis terrain, allowing early construction events to replay correctly.

## Verification

The web production build succeeded. Manual browser inspection covered daylight and night, straight river banks and moving highlights, real Land thumbnails and place navigation, and the full UI with Director enabled. The local simulation completed its first additional house. Restart resumed the same database with minds off, and an early recorded moment loaded after restart. Automated tests, typecheck, lint and release gates were not run at the owner's request. Later expansion courts and full-map growth have not been exercised through a long simulation.

Preview: http://127.0.0.1:8773/ via local.sanjunipero.orchard, using /tmp/sj-three-town/orchard-review.db. Old lattice preview and its database remain on 8768. Production is unchanged.

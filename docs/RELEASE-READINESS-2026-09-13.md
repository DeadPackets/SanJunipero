# Production relaunch readiness

## Current owner-directed work

Owner visual approval: the B town and corrected rain motion were accepted with “This looks good, let's move on.” This is the visual baseline for relaunch preparation. The owner selected a fresh town, then reversed the archive policy and requested deletion of old history. Current work is local observation with AI minds disconnected. No production launch or reset is authorized by this visual approval. Test suites and release gates remain skipped at the owner's request.

B was selected and implemented in the full Three town. Characters now receive shadows with a small atlas fill. Rain, snow, ground ripples, and restrained storm light are scene effects with building clearance, pause/replay support, interior suppression, and reduced-motion handling. Rainy daylight uses brighter diffuse fill.

Discovery now commissions wall and roof material sets through the existing Forge queue. Sets contain generated base color and derived fine normal/roughness maps. They are applied to the existing 3D form without changing its footprint. Previously coined recipes request missing materials on startup. Image downloads retry after 1 and 4 seconds and retain working surfaces on failure.

The owner requested visual review instead of test suites or release gates for this pass. The viewer was built so it can be served. No test suite, typecheck, lint gate, paid generation, or production deployment was run for these changes. Existing assertions were adjusted for the new material contract but were not executed.

Current review: http://127.0.0.1:8768/. The full UI serves a fresh scripted town, without weather overrides or AI minds. The old weather-review proxy and its recorded history are no longer running.

Forge's live generation path is connected in code but has not been exercised against a paid provider in this pass. This is surface generation on the existing forms, not automatic custom mesh generation. The operational and history decisions below remain outside the requested two work items.

## Previous assessment, before B implementation

Decision: hold deployment. The Three town renders and the current fixes pass targeted checks, but automatic Forge building art is not wired to the new renderer. Character shading and weather also need a visual decision and integration. A zero-bug guarantee is not possible. The release should have reproducible checks, a rehearsal, and a tested rollback.

## Changes completed in this pass

| Problem | Change | Evidence |
|---|---|---|
| A character can face opposite its visible movement when leaving a crowd | Select the walking frame after crowd spacing and building clearance, using displayed ground motion | A new test failed with SE instead of SW before the change, then passed |
| A coined roofed building falls through to unroofed geometry and cannot open on click | Three rendering and entry use effective configuration from the displayed state's laws | Invented recipe geometry test, existing entry tests, typecheck |
| Changed recipes leave old geometry cached | Geometry key includes roofed state and construction duration | Recipe invalidation test |
| Failed material download replaces valid fallback art | Load all maps before assignment, retain fallback on failure, ignore disposed and superseded requests | Failure/retry, incomplete set, disposal, and stale snapshot tests |

Material retry happens on a subsequent application, such as an asset update or geometry rebuild. Automatic network recovery is not implemented.

## Art Forge: the present contract and the missing connection

- Discovery currently commissions a whole-building PNG with `class: building` and the new kind name.
- Three uses procedural geometry and looks for `material:<kind>:wood` or `material:<kind>:roof`, with generic slot fallbacks. It does not display the discovery PNG.
- A new roofed recipe can now produce a generic 3D house within its recorded footprint. This does not mean its custom Forge design appears.
- Material sets already support base color, normal, roughness, and emissive maps. The local import contract is documented in `packages/forge/MATERIALS.md`. That importer is not an automatic discovery pipeline.

Recommended contract: keep simulation-owned footprints, use a validated building form with named material slots, and let Forge author surface textures and emission masks. Light sources should come from explicit windows, lamps, and hearths. An emission mask makes a surface glow but does not itself create illumination on nearby objects in this renderer. A whole-building PNG has baked perspective and shading and cannot be treated as a wall texture.

The current House C form can be the safe fallback. Later forms can add variety without changing collision dimensions. Custom mesh generation is a separate asset pipeline, not a capability obtained just by switching to Three.

Required seam check: invent a roofed kind, apply its law, construct it, complete it, open its room, receive delayed art, fail a map download, recover, reconnect, and replay before and after the law. Test the entire sequence with fake providers and a separate database before a paid rehearsal.

## Five release gates

| Gate | Work remaining | Pass condition |
|---|---|---|
| 1. Visual direction | Integrate the selected character shading and weather treatment into the real day/night, pause, replay, interior, and reduced-motion paths | Owner reviews the real town in sun, moonlight, rain, snow, and storm. No rain through roofs, flashed faces, or new light glare |
| 2. Forge integration | Connect discovery to the chosen 3D/material contract, retain fallback and expose failure status | The synthetic invented-building sequence above passes, including asset failure and replay |
| 3. History policy | Choose fresh town or preserved history. Existing logs retain old footprints, and unfinished work can read changed construction durations | Fresh genesis passes, or a copied history resumes and replays with documented compatibility. Original history remains recoverable |
| 4. Viewer and performance | Run full repository gates and a scripted browser rehearsal for director, broadcast, papers/docking, sound, interiors, scrub, and reconnect. Measure cold load and sustained performance on the target MacBook Pro | Zero uncaught errors in the rehearsal, controls remain usable, and measured frame time, memory, and loading behavior meet an agreed target. No performance certification has been made in this pass |
| 5. Operational rehearsal | Verify packaged configuration, budget guards, health/tick advancement, backup, and rollback. Then run an explicitly authorized bounded rehearsal with minds | A 60-minute staging observation records advancing ticks and no unresolved errors. Backup restore is exercised. Paid rehearsal and production go remain explicit operator actions |

The older handover also requires a fresh genesis for its founder-sex change. Preserving history therefore needs an explicit compatibility plan rather than merely resuming with new code.

## Visual comparison

Local study: http://127.0.0.1:8770/

| Option | Character treatment | Weather treatment |
|---|---|---|
| A, reference approach | Flat lit sprite, no received shadows | Screen rain |
| B, recommended | Small fill from the existing art, received shadows and local lights | World rain with depth, roof clearance, and ground ripples |
| C, painted | Stronger fill and less contrast from local lighting | Sparse rain and more mist |

This is an isolated fake scene using the current house builder and atlas. It approximates the current approach for comparison, not a pixel-exact capture of the production renderer. No shading or weather redesign has been applied to the town yet. B remains a direction study, not a completed snow/storm system.

Files are in `/tmp/sj-atmosphere-study/`. The rebuilt full town is at http://127.0.0.1:8768/ using the existing local scripted database. No production actions or paid generation calls were made.

## Verification recorded

- 230 tests passed across 13 targeted files: character animation, crowd placement, entry helpers, and the Three renderer modules.
- Repository typecheck passed.
- ESLint passed for the seven files changed in this pass.
- Web build passed. Main client bundle is 1,368.56 kB, 396.42 kB gzip. The existing 500 kB chunk warning remains.
- Full town loaded in the in-app browser with director on and advancing time.
- Local snapshot at tick 6225: seven 3 by 3 houses, one turned 3 by 4 farmhouse, 16 lamps, zero structure overlaps, zero blocked doors. Thirteen livestock remain simulated and hidden from the Three view.
- A separate read-only review found no introduced correctness issue in these fixes.

These are targeted results. They do not replace full repository checks, end-to-end Forge verification, target-device performance measurements, or production rehearsal.


Fresh relaunch preparation is recorded in `deploy/FRESH-RELAUNCH.md`. Discard old history under the updated owner policy, preserve the spending ledger, and keep AI minds disconnected. Production work waits until after local observation. Production has not been changed.

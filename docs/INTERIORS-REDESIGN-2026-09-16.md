# Interior redesign review branch

## Open the preview

- Review town: http://127.0.0.1:8774/
- Occupied room replay: http://127.0.0.1:8774/moment/7/00:15?inside=structure_house_45_41
- Sleeping resident replay: http://127.0.0.1:8774/moment/6/21:44?inside=structure_house_45_41
- Original approved town remains on http://127.0.0.1:8773/.

Branch: `codex/interiors-redesign`.
Worktree: `/Users/deadpackets/workspace/SanJunipero/.worktrees/interiors-redesign`.
Baseline: `codex/interiors-baseline`, commit `3cd12a38b35efc6fe7205459a3a37665bb844d31`.

## What changed

Interiors use the existing Three.js renderer, with one room active at a time. Cutaway rooms use real building dimensions, personal-home palettes, window openings, timber or stone floors, beds, furniture and real fuel-dependent hearth lighting. Residents retain the approved pixel atlases. Furniture placement represents existing activities; there are no new mind choices or persistent indoor coordinates.

A compact room header shows actual occupancy, activity, hearth status and stored items. Belongings aggregates exact quantities. Following a resident moves between indoor and outdoor views, including replay. Room links preserve the structure ID. Captions and sound use the active room's participants; outdoor overlays are suppressed indoors. Furniture routes reuse the existing interior path helper.

Indoor dropping now uses the existing structure item location instead of placing belongings outside. Social need recovery uses the shared hearing predicate, respecting building boundaries. Neither change adds events or changes the replay schema.

Current private houses have one main bed and extra bedrolls when additional occupants sleep. Shared roofs use the building capacity for bed count. Stored item meshes are generic bundles of actual item records; exact quantities are in Belongings. Interior floor/wall material slots support the existing material importer, but no new Forge generation workflow was added.

## Local service

The preview uses a SQLite backup of the approved local town, stored at `/tmp/sj-interiors/preview.db`. It runs independently with scripted behavior and `SJ_LIVE=0`; AI minds remain off. No production state was changed, and no provider generation was called.

Launch agent: `local.sanjunipero.interiors`.
Launcher and plist: `/tmp/sj-interiors/serve.mjs`, `/tmp/sj-interiors/service.plist`.
Logs: `/tmp/sj-interiors/server.log`, `/tmp/sj-interiors/error.log`.
Static files: this worktree's `packages/web/dist`.

After a web build, restart the preview service because the gateway caches the index:

```sh
pnpm --filter @sj/web build
launchctl kill SIGTERM gui/$(id -u)/local.sanjunipero.interiors
launchctl kickstart gui/$(id -u)/local.sanjunipero.interiors
```

## Checks and limits

The web build completed successfully. Manual browser review covered the personal house, larger farmhouse, real inventory counts, sleeping sprite pose, return to town, resident selection, following through entry/exit during replay, Belongings Escape/focus, desktop framing and 390px mobile framing. No tests, typecheck, lint or release gates ran, per owner instruction.

The copied history contains no fueled indoor hearth event. Hearth state is wired, but its lit/cold transition has not been visually exercised. Indoor caption speech, storehouse/shed presentation and engine drop/social changes need targeted review before production. Existing unrelated minds/runtime findings remain in `MINDS-INTERIORS-REVIEW-2026-09-15.md`.

## Integration and rollback

This branch is not merged into the approved town. To reject the design, keep using port 8773; its source and database were not replaced. The preview service can be stopped with `launchctl bootout gui/$(id -u)/local.sanjunipero.interiors`.

The original working tree had uncommitted approved work. A temporary Git index captured that complete tracked/untracked source state in the baseline commit without changing the original index or branch. The redesign is committed on top of that baseline. Before later integration, inspect the original working tree and checkpoint its current approved changes. Apply only redesign commits after the baseline; do not blindly merge over the dirty original tree or overwrite subsequent work.


## Town backdrop and room polish — 2026-09-16

Applied the owner's six follow-up requests on the same isolated branch. The live town now renders behind a dimmed cutaway. Both views consume the same exterior sun/sky lighting state, including weather and lightning. The light follows an east-to-west arc; fractional render time smooths movement between simulation minutes and snaps to paused/replay positions. This is visual interpolation only and does not change the event log.

Interiors reuse the exterior's plaster/board surface generator and personal-home palette. Floors have staggered planks, grain, fasteners and subtle bump detail; rugs and bedding have woven texture. Personal details now cover storage cupboards, workshop tools, plants, apothecary jars, books and a reading chair, textile spools/loom and smithing tools. Reading/textile homes use a different bed and desk arrangement. Storehouses omit dining benches, and farmhouses have a larger table and timber bracing. Furniture remains decorative presentation of existing activities, not new simulation inventory or agent affordances.

Belongings uses the registered item icon assets, exact quantities and a responsive inventory grid with material/provision/tool colors. Unknown kinds retain a labeled fallback. Exterior cast rails are hidden indoors; the mobile Town control has an accessible label. Unlit interior hearths skip their six point-light shadow views.

Manual review covered Amara at dawn and rainy midday, Nadia and Farida in morning light, Yusuf asleep under moonlight, 390px mobile framing, item pictures/counts and closing inventory with Escape. The shared direction and interpolation were reviewed in source. Web build completed; no tests, typecheck, lint or gates ran. The browser reported an existing Pixi addChild deprecation warning but no JavaScript errors during the visual review. No AI minds, production actions or paid art generation were used.


## Indoor lanterns, heavy blur and Nadia direction correction — 2026-09-16

Added two wall lanterns and real warm point lights to rooms. Lights fade with the same living-awake occupancy rule as exterior window emission, and snap to recorded state on seeks or pauses. Daylight reduces their strength. One lantern casts softened shadows; fixtures do not cast self-blocking shadows. Hearth lighting remains fuel-dependent. This adds presentation only, not new fuel consumption or mind choices.

The exterior composer now applies two pairs of separable Gaussian blur passes only while a room is active. The room and UI render afterward and remain sharp. Returning to town disables all blur passes. Local build completed, with no test suite or release gates. Visual review at day 7, 00:15 showed Amara awake, both lanterns casting warm light and a heavily blurred city; the later empty-room frame showed the lanterns off. Browser error log was empty.

Nadia's approved atlas had its NE/NW standing/walk rows mislabeled. Corrected only her manifest references for idle, contact-a, passing-a, contact-b and passing-b. No pixel art was regenerated or altered. Sleep, SE/SW poses, proportions and anchors are unchanged. The preview's newest registered manifest matches the committed source. All four walk poses were stepped through in a temporary `/nadia-facing/` study on 8772, using the actual served atlas. This correction is shared by indoor and outdoor rendering through the existing manifest reader.


## Street lights, directions and story ribbon — 2026-09-17

Corrected Amara/Yusuf's reversed rear direction references without altering sprite pixels. Each has ten corrected manifest entries (idle and four walk poses in NE/NW); sleep is unchanged.

Street lamps previously competed with higher-priority fire/torch sources for eight camera-nearest point lights. All twelve orchard lamp posts now have persistent point lights controlled by existing fuel state, independent of residents and camera selection. Lamp lights do not add point-shadow passes; the existing sun and four pooled fire shadow lights remain. New and removed lamp structures create/dispose their lights. No fuel rules or AI behavior changed.

Replaced the old dark story strip with a compact journal ribbon: approved Chronicle icon, pixel title, warm paper, quiet chapter state, portrait story cards, on-screen badge, activity meter and a real Chronicle button. The ribbon follows the almanac's theme, fills the bottom safe area, and uses its own available width to reduce cards when docked. The on-screen story is ordered first so narrow layouts keep it visible. Replay and interior views retain their existing hide behavior.

The gateway now sends its initial empty story frame. Previously an empty initial signature matched the cache sentinel and no message was sent, leaving the strip absent after a fresh service restart.

Checks: web build successful; actual registered Amara/Yusuf direction previews inspected; live ribbon, Chronicle action and docked layout inspected; 390x844 dark layout fits with 390px document width and footer bottom at 844px; night replay at day 11 03:03 shows pools of light throughout the town when zoomed out. Active story styling reviewed with explicitly labeled sample content in an isolated HTML fixture because this scripted town currently has no active story threads. No tests, typecheck, lint or release gates ran, per owner instruction. AI minds remain off.

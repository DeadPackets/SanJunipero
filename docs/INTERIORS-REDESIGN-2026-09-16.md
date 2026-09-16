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

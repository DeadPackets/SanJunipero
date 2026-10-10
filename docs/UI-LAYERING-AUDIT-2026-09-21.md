# UI layering audit — 21 September 2026

Decision: use one page-level priority table, preserve real world depth inside the renderers, and elevate a disclosure's owner when it opens. No portal manager or new UI framework is needed.

Scope: the mounted `App` tree, all production CSS and inline `z-index` declarations, Three.js/Pixi composition, journal pages, interior UI, broadcast-only UI, loading/error surfaces, pointer targets, and keyboard ownership. Review-only mock pages are not production UI. Browser-injected overlays are not part of the application.

## Work and checks

1. Inventory the render trees and stacking contexts → compare every production `z-index` declaration with the table below.
2. Reproduce conflicts → browser paint/hit tests, including the usage panel crossing the interior header.
3. Correct priorities and placement → CSS regression tests, geometry tests, renderer-layer tests.
4. Correct input ownership → modal, journal, disclosure, and loading-screen tests.
5. Exercise the built local town → desktop/interior/docked/mobile/dialog checks; record limits below.

## Page-level order

The contract is `packages/web/src/ui/stacking.css`, imported by the shared chrome stylesheet. `.app` is an isolated stacking context. Do not add a stacking context to the map wrapper: its DOM labels must remain above the sibling replay effects. Both canvases occupy the world layer; their DOM order keeps transparent Pixi above Three.js.

| Priority | Surface | Must be above | Must be below |
|---|---|---|---|
| 0 `world` | Three.js picture, transparent Pixi canvas | Page background | Every DOM UI surface |
| 1 `world-effect` | Replay grade and cut dip | Canvas picture | Labels, speech, navigation |
| 10 `world-label` | Building/construction hover, person hover, nameplates | Picture and replay effects | Speech, selected actions, navigation |
| 11 `status` | Resident work/thought/sleep tokens | Picture | Conversation and speech |
| 12 `conversation` | Participant rings and between-turn caption | Resident decoration | Spoken words, selected actions |
| 13 `speech` | Pixel speech/thought balloons, reactions | Ambient labels and captions | Selected actions, navigation |
| 14 `world-action` | Selected person's action ring and keyboard focus targets | World annotations | Town chrome and panels |
| 20 `chrome` | Almanac, camera bookmark, room header, controls, journal button, live return | World annotations | Open reading panels and disclosures |
| 25 `notice` | Keepsake unlock, replay narration, broadcast captions/ticker | World and ordinary chrome | User-opened panels and popovers |
| 29 `scrim` | Journal dimmer, where used | World and ordinary chrome | Journal |
| 30 `panel` | Desktop journal; legacy drawer | World and ordinary chrome | Open disclosures and dialogs |
| 40 `popover` | Open timeline/usage owner, room belongings owner, journal menu/story pocket owner | Headers, achievements, desktop journal | Mobile journal and dialogs |
| 45 `debug` | Explicitly enabled FPS diagnostics | Normal town UI | Mobile journal, Controls, native dialog |
| 50 `mobile-dialog` | Full-screen mobile journal | All normal town UI | Controls priority, though Controls cannot open through it; native modal |
| 60 `help` | Controls sheet | Normal town UI | Native modal; boot screen |
| 70 `skip` | Focused skip link | Normal app chrome | Boot screen; unavailable when background is inert |
| 80 `boot` | Loading, retry, no-script screen outside React app | Application | Browser-native top layer; application cannot open dialogs while boot is active |
| Browser top layer | Native conversation transcript dialog and `::backdrop` | All CSS layers | Browser UI |

A number inside a component does not override its parent's place in this table. The only remaining local numeric CSS priorities are the timeline card (1), usage card (2), belongings card (2), small mark tooltip (2), and keepsake emblem art (1). They order siblings inside their owner's context, not the page.

## Component inventory

| Component / family | Owner and behavior | Audit result |
|---|---|---|
| Terrain, buildings, residents, foliage, water, physical shadows | Three.js scene depth; Pixi fallback entity depth sort | Physical occlusion is separate from UI priority; preserve it |
| Weather, flash, bloom, light pools | Three.js render passes; Pixi screen layers | Pixi atmospheric passes must precede reading layers |
| Interior floor/walls/furniture/residents/lighting | Interior scene, town blurred behind it | Preserve interior depth; outdoor reading/weather layers hidden by existing lifecycle |
| Building/private/public/construction hover | Map DOM child, decorative and pointer-transparent | Bound to measured free map area; below navigation |
| Person hover name button | Map DOM child, clickable | Bound to measured free map area; below navigation |
| Nameplate / selected person actions / keyboard figures | App-level anchored elements | Explicit priorities added; actions beat speech, not navigation |
| Speech and thought balloons | Map DOM child; noninteractive | Bound to top/right/bottom safe insets; hide if no readable space fits |
| Resident activity tokens | Map DOM child; noninteractive | Separate from conversation priority |
| Conversation presence | Map DOM child; noninteractive | Keep rings; caption yields during matching visible speech and returns between turns |
| Almanac/date/time/weather/playback/theme | App grid item | Ordinary chrome until an owned disclosure opens |
| Camera/director/follow bookmark | Child of almanac | Inherits almanac priority; existing dock geometry retained |
| Timeline moment card | Fixed child of almanac | Raise whole almanac, not just the card; existing viewport height cap and outside dismissal |
| Public cost/token disclosure | Absolute child of almanac | Raise whole almanac; local card priority cannot escape parent |
| Room header/resident buttons | App grid item | Same normal navigation level as almanac; separate grid row |
| Room belongings | Absolute child of room header | Raise room header while open; user-opened inventory beats transient notices |
| Sound/thought/help controls, sound cue text and slider | Control pod | Ordinary chrome; tooltips remain within owner |
| Journal opener/menu | Signpost owner | Raise owner only while expanded |
| Stories pocket / story cards | Signpost owner | Raise owner while open; scroll within viewport height |
| Desktop journal: Folk, Chronicle, Land, Rule | Paper owner | One panel context; internal tabs, cards, portraits, follow buttons, lists and sheets stay inside it |
| Folk profiles/relationships graph | Paper owner, graph has its own canvas | Does not escape paper or cover app dialogs |
| Loading/error messages inside journal pages | Paper owner | Inherit panel priority; no global overlay |
| Mobile journal | Fixed full-screen Paper | Background siblings inert while modal; restore on close or wide breakpoint |
| Living conversation summary and transcript opener | App ordinary chrome | Summary width constrained to undocked map space |
| Conversation transcript | Native `dialog.showModal()` | Browser handles top layer and focus; background shortcuts must not consume Escape |
| Keepsake/achievement popup | App notice | Below explicit panels/popovers; width constrained to undocked map space |
| Replay tint, dip, narration | App siblings | Tint/dip affect picture, narration is readable notice |
| Return to now | App navigation | Above map and replay effects |
| Controls / help sheet | App high-priority nonmodal sheet | Retains outside-click dismissal; cannot open behind/through modal journal or transcript |
| FPS overlay | App diagnostics | Deliberate opt-in debug layer; below modal journal |
| Skip link / live speech announcer | App accessibility | Skip only visible on focus; announcer is visually hidden |
| First frame, asset progress/retry, no-script | Outside app context | Above app; underlying app inert during loading |
| Render-error fallback | PageBoundary replaces app | No competing live app layers remain |
| Broadcast DirectorCue, SceneCard, StoryStrip, LowerThird, Ticker | App chrome and notice layers | Source-reviewed; same named contract; broadcast visibility rules retained |
| BeatCard, ShotBoard, DossierRail, old drawer, stage-exit | Retained components/styles, not mounted by current App | Source-reviewed and assigned named levels; not claimed as exercised live |

## Confirmed defects and fixes

| Before | After / evidence |
|---|---|
| Room header covered the middle of the usage disclosure. Child `30` was trapped inside almanac `21`, below room `24`. | Whole almanac rises to popover level. At three sampled points the browser now hits the usage card; previously the upper sample hit the room header. |
| Person hover `24` could cover top bar `21`; placement used full viewport. | Hover level is below chrome and placement respects measured top/right/bottom bounds. |
| Selected action ring had no explicit level; its transform made a level-0 context. | Action level is above speech and below navigation. |
| Nameplate priority depended on source order and animation/transform contexts. | Explicit world-label level. |
| Replay cut dip `27` covered controls `25`; replay grade `18` tinted DOM words at `8`. | Both effects are below all readable DOM world UI. |
| Pixi fallback screen flash/weather/lights/bloom painted after its labels and bubbles. | Separate reading container paints last and mirrors the world camera. |
| Resident tokens and conversation indicators shared `7`. | Distinct priorities; conversation owns the higher level. |
| A below-speaker balloon and conversation caption both occupied the same foot area. | Matching caption yields while speech is visible; rings remain, caption returns between lines. |
| Speech below a speaker could exceed the available bottom edge; hover labels could sit behind the dock. | Geometry bounded to measured available space, with a no-fit path. |
| Keepsake `30` could cover stories `25` and belongings inside room `24`. | Open disclosures beat notices; keepsake width excludes the dock. |
| Mobile journal declared itself modal without making background inert. | Background interaction is suspended for the mobile modal lifecycle. |
| Native transcript Escape could also invoke town's Escape ladder. | Global town shortcuts defer to native modal ownership. |
| Loading screen left hidden UI keyboard-active and had a lower priority than Controls. | App root inert until loader dismissal; loader gets explicit boot priority. |

## Verification record

Initial browser reproduction: 1280 × 720, recorded local day, cottage interior, usage disclosure open. `elementFromPoint` within the upper third of the disclosure returned `interior-hud`; after the fix all three sampled points resolve inside `usage-meter-paper`. Computed owner priorities are 40 for open almanac and 20 for closed room header.

Desktop visual check: cottage interior plus docked Folk journal at 1280 × 720. The paper begins below the almanac, room header contracts to the available map width, and world annotations remain below both surfaces.

Responsive, keyboard, and final command results are recorded below.

## Boundaries and deviations

- This is a priority and input audit, not a new visual style or simulation redesign.
- Safe insets reserve top/bottom bands and the desktop dock. They are not a general solver for collisions among every pair of world labels. Labels can still compete with each other in a dense crowd; the priority contract decides what wins.
- Review-only mock CSS and browser-injected overlays are excluded from the production priority contract.
- Automated geometry tests cover no-fit and edge cases. Source review of rare broadcast/legacy states is identified separately from browser checks; there is no claim that every possible dynamic scene was visually exercised.
- No production deployment or paid model calls are part of this change.

## Completed verification

- Frontend suite: **185 files, 3,176 tests passed**. Final disclosure/loader/FPS/priority follow-up: **6 files, 59 tests passed** after the last input changes.
- Workspace `pnpm typecheck` and `pnpm knip` passed. Web ESLint: **0 errors**, 1,497 existing warnings. `biome format packages/web/src`: **401 files checked**, no changes required. `git diff --check` passed.
- Production web build passed. The existing >500 kB chunk warning remains; this audit does not claim a bundle optimization.
- Mobile at **390 × 844**: Folk journal filled the viewport. DOM inspection showed each background sibling inert and the journal active. `?` and `D` did not expose or operate background controls. Escape closed the journal, restored normal siblings, and kept the closing journal inert.
- Desktop at **1280 × 720**: selected Yusuf's action ring remains readable over the rainy town; almanac, attached camera indicator, and Return to now stay above world UI.
- Final built page: opened a timeline moment, then Controls with `?`. Browser hit test selected Controls above the card. One Escape closed Controls and preserved the moment card and its focus.
- Loader accessibility check exposed only the loading screen while assets were pending.
- Native transcript Escape ownership is covered by regression tests and source inspection; it was not opened in the final recorded-day browser check. Rare achievements, every weather/time combination, and legacy/broadcast-only scenes were not exhaustively replayed.
- Local scripted town (**8774**) and read-only recorded AI day (**8776**) were rebuilt/restarted. No inference or production deployment was enabled.

Disclosure dismissal now also respects keyboard focus: leaving Usage or Belongings closes that popup, so opening another control does not leave an older panel above it. Escape handlers honor already-handled events, mobile/native modal ownership, and the higher Controls sheet.

Final independent source review found no further correctness blocker in the combined diff. Browser-specific mobile close focus was checked by the primary audit (focus returned to Journal); the independent reviewer did not repeat that browser check.

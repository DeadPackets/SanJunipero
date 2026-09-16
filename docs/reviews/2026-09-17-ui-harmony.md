# UI harmony review — 17 September 2026

Decision pending: choose a coordinated design, or a combination of components, before applying visual changes to the town. The existing arrangement is the starting point. Only the six verified behavior fixes below were applied on `codex/interiors-redesign`.

Preview: http://127.0.0.1:8774/client/harmony.html

## Why the UI feels disjointed

The almanac, roster, story ribbon, utility controls, and journal use different surface colors, border weights, spacing, and type scales. Dark mode does not cover the whole interface. Chronicle and journal entry points compete at the bottom. The roster repeats information available in Folk. These are design choices to resolve together, rather than patching each widget with another CSS override.

The prototypes share one palette and surface treatment across all components. They reuse approved flat icons and resident artwork, with Manrope for reading and Silkscreen for landmarks. No new dependencies or generated assets were needed.

## Three directions

| Direction | Layout and components | Tradeoff |
|---|---|---|
| A — Village journal | Familiar edges, warm paper, centered clock, one story/journal ribbon, compact character cards | Closest to the current experience |
| B — Garden frame | Inset green surfaces, clock tile, labeled controls, category navigation, resident list | More visible navigation and easier scanning |
| C — Evening observatory | Slate surfaces, compact top bar, quiet journal button, horizontal controls, portrait album | More space for the town, fewer always-visible entry points |

Recommendation: A's layout and palette with B's resident list. The seven independent selectors cover layout, palette, timeline, bottom navigation, utility controls, Folk presentation, and the map portrait rail. Docking, active story, and journal visibility can also be previewed. Copy my combination produces a shareable selection.

Panel records and control states are labeled samples. The backdrop is the local town. The preview does not operate the live town's clock or sound, and stores only its own preferences. Its iframe hides its own native chrome for comparison; it does not change the user's town tab.

## Verified bug report

Three independent passes: Hunter, Skeptic, Referee. Seven reported findings; six confirmed (five Medium, one Low); one dismissed. Scope: the web UI, its scene integration, navigation, replay presentation, and related state hooks. This is not a claim of zero remaining bugs across the simulation.

| ID | Severity | Before | After |
|---|---|---|---|
| 1 | Medium | Dragging a centered journal added a half-width left shift | Drag and dismissal translate only vertically |
| 2 | Medium | Historical profiles could show a later live thought | Replay hides the live-only thought and explains why |
| 3 | Medium | Find this place moved the exterior camera while leaving the room open | The action exits the interior before centering |
| 5 | Medium | Paused panning omitted newly visible people from keyboard navigation | All living residents have targets; the existing frame loop controls visibility |
| 6 | Medium | An old discovery choice masked a new world-item pick | Selection belongs to the specific pick, including a repeat pick of the same item |
| 7 | Low | Escape did nothing from journal search | Unconsumed Escape passes through; typing shortcuts stay blocked |

## Verification and limits

- Production bundle build completed. Existing large-bundle warning remains. No tests, lint, typecheck, or test gates were run, following the owner's visual-review preference.
- Browser: typing into Folk search and pressing Escape closes the sheet.
- Browser: from Nadia's room, Land → Amara's house → Find this place exits the interior, closes the journal, and removes `inside` from the address.
- Browser: in one paused snapshot, camera zoom/recenter changed visible keyboard targets from four to twelve. All twelve nodes remained mounted; offscreen targets were hidden.
- Desktop and 390 × 844 preview layouts were inspected. Full-preview controls were moved above the scene to avoid covering the clock. Portrait rail height was bounded to avoid utility overlap. Mixed component selection and Copy my combination were exercised.
- Drag transforms, replay thought guard, and discovery selection were reviewed in source. They were not exercised end-to-end with synthetic live thoughts or discoveries; AI minds remain off.
- The original 8773 town and production were not changed. The local 8774 review server remains `SJ_LIVE=0`.

The referee rated Escape Medium confidence before implementation because search controls can consume Escape themselves. The actual populated search field was checked after the fix and closed correctly; `defaultPrevented` remains respected.

<details>
<summary>Dismissed finding</summary>

BUG-4: the mobile bottom drawer, grip and scrim are hidden. This implements the owner's explicit request to remove that mobile surface. It was not restored.

</details>

Full independent reasoning: [Referee report](2026-09-17-ui-referee.md).

## Preview sources

The throwaway prototype lives outside product source at `/Users/deadpackets/.codex/visualizations/2026/09/13/01a09a98-25b9-7071-96b1-50198b2ec453/town-panels/harmony/index.html`.

After a web build clears `dist`, run `python3 /tmp/sj-publish-harmony.py` to republish the preview and its images/fonts under the local review server. The publisher creates a same-origin copy so the preview needs only the 8774 server.

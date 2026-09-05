# Pre-launch UI review — `packages/web`

Reviewed 2026-09-05 against a scripted town (`SJ_LIVE=0`) at 1280×800, 1440×900 and 390×844,
plus a reduced-motion pass at 1440. Method: two isolated assessment agents (design-vs-DESIGN.md,
and detector + a11y + React-perf), synthesised against a hands-on browser pass and pixel
sampling. The Impeccable detector's six findings were verified in context: five `side-tab` hits
are false positives on a documented redundant-encoding system, one `layout-transition` hit is
real and fixed below.

**Line references are to the code as found**, at base commit `519b8f27`. Fixes land in five
commits on `worktree-agent-a43592a0b679ffd90`, which was then merged up to `v2` (`853afe43`).

Three fixes moved during that merge, because v2 had moved the code they lived in: the law
notice's live region followed the notice from `pages/Laws.tsx` up into `Paper.tsx`, and the
moments player's arrow keys, pointer capture and per-frame commit followed the transport out of
the sheet and into `stage/Transport.tsx`. Two fixes were dropped because v2 had already reached
the same defect and landed a better answer — the run export's deferred revoke (`handToBrowser`)
and the auto-cut listeners (rewritten as a store, already passive).

## Score

| Dimension | Score | The finding that set it |
|---|---|---|
| Accessibility | 3 → 4 | dozens of invisible keyboard tab stops in two graph views |
| Performance | 2 → 4 | every mouse sample of a scrub re-rendered the whole app |
| Responsive | 2 → 4 | the bonds page put 480px of content in a 326px phone sheet |
| Theming / consistency | 3 → 4 | six bare sizes and two off-system shapes |
| Implementation integrity | 4 | no dead code, no `any`, no TODO, no leaked listener |
| **Total** | **14 → 20** | |

This is a disciplined codebase. Its own DESIGN.md is stricter than most shipped design systems
and three test files enforce it. Almost every defect below is the system **not being applied**
somewhere, not the system being wrong. Six of the eight blockers are places where a documented
law has a hole in its coverage.

**One further blocker surfaced when this branch merged up to v2** and is fixed here: v2 put a
weekday in the paper's dateline, which took the date from 157px to 207px in a track only 157px
wide. With `white-space: nowrap` and no overflow rule the date's own text painted 50px outside
its box and over the first tab, at every width from 1024 to 1600 — `MONDAY · DAY 0 · SPRING`
overprinting `TODAY`. The head now reflows to two rows wherever the sheet is at its 760px cap,
which is the complement of the 1920px rule that widens it. (`ui/chrome.css:1771`.)

**Counts: 9 blockers found, 9 fixed. 24 should-fix found, 24 fixed. 12 taste items raised, 0
changed — they are under Owner picks.**

---

## Blockers

| # | What | Where (as found) | Fix |
|---|---|---|---|
| B1 | Two place-name layers print on top of each other. The legend never joined the one occupancy table: it reads no other layer's boxes and publishes none of its own, so a landmark plate and the toponym beside it composite into an unreadable stack. Visible at zoom 1 on a fresh town. | `render/landmarks.ts:345` `place()`, `render/tooltip.ts:104` | Read `scene.tags.occupied('landmarks')` into `placeLandmarks`' avoid list and publish the placed rects back — the rule bubbles, acts and the footprint plate already keep. |
| B2 | The bonds page is 480px wide inside a 326px sheet at 390. The legend chips, the view switcher and the section head all run off the right edge with no way to reach them. `react-force-graph` writes its own canvas width and an `auto` grid track sizes to the canvas, not the sheet. | `ui/chrome.css:1592` `.bonds-sheet` | `grid-template-columns: minmax(0, 1fr)` plus `min-width: 0` on the section and the graph box. |
| B3 | Dozens of invisible keyboard tab stops. Each bond graph holds its only keyboard path in a `clip-path: inset(50%)` list of one button per node, and no `:focus-within` rule exists anywhere in the sheet. A sighted keyboard user tabs through forty stops with nothing on screen. WCAG 2.4.7 / 2.4.11. | `paper/pages/BondsGraph.tsx:281`, `paper/pages/BondOrbit.tsx:85`, `ui/chrome.css:1047` | `.sr-roll:focus-within` un-clips the list and styles it as real controls. |
| B4 | The operator's page presents a broken channel as permanent loading. `useAdminRead` drops every failed read on the floor, so `data` stays `null` forever and all three sections wear "Reading the ledger…" with nothing behind them. | `paper/pages/AdminOps.tsx:72` | Track the refusal; render `OutOfReach` with a retry. |
| B5 | Six pages print an empty state over a broken wire, which DESIGN.md:289 forbids by name. `settle()` sets `loaded: true` on a refusal too, so a dropped read says "Nobody has written of them yet" and "No one remembers who began this" as facts about the town. | `paper/pages/Person.tsx:97,130,224`, `paper/pages/Building.tsx:66`, `paper/pages/Folk.tsx:100` | Branch on `data === null && failed` before the empty branch, the shape `Chronicle.tsx:159` already uses. |
| B6 | The subject ring offers Home to a person who owns no building, and `App.tsx:220` returns without a word when it is pressed — contradicting the ring's own doc comment that nothing is offered an arm that does nothing. | `stage/SubjectRing.tsx:22`, `App.tsx:220` | `ringVerbsFor(kind, enterable, hasHome)`, read through the store the same way `enterable` is. |
| B7 | A refused `/api/timeline/marks` draws a bare scrub strip with zero marks and not one word — indistinguishable from a town with no days in it. | `paper/pages/Days.tsx:194` | A `role="status"` note beside the control, which still scrubs. |
| B8 | A timeline mark of kind `chapter` picked up the paper's own unrelated `.chapter { margin: 0 }` rule. Nine `.mark <kind>` modifier classes exist and none has a rule; one of them collides. | `paper/pages/Days.tsx:132`, `ui/chrome.css:662` | `data-kind`, not a class name. |

## Should-fix

### Motion and jank

| # | What | Where | Fix |
|---|---|---|---|
| S1 | Four hover-outs lag 150ms. The duration sits on the base rule, so the pointer leaving is a lie for 150ms — the exact defect `chrome.css:957` was written to prevent, on four controls it never listed. | `chrome.css:611` `.moment-card`, `:296` `.feed-jump`, `:368` `.mark-glyph`, `:1433` `.paper-tab` | `transition-duration: 0s` on the base, `var(--t-fast)` on `:hover`. |
| S2 | `.paper-tab`'s duration is in neither a `no-preference` guard nor any `reduce` block — the one duration in 1,907 lines with no guard on either side. | `chrome.css:1433` | Wrap the hover duration in `no-preference`. |
| S3 | The day-strip playhead eases `left` while a finger drags it — the lag its sibling `.player-head:650` carries a comment forbidding. | `chrome.css:390` | Drop the transition. |
| S4 | Three layout properties animated: `width` on the need bars (five per person page), `left`/`top` on the sun, both relaying out every frame. The sun's runs on the world tick. | `chrome.css:210`, `:1167` | `transform: scaleX()` with `transform-origin: left`; a `translate` driven by two custom properties. |
| S5 | The 30ms stagger is a literal written twice, and `untokenisedDurations()` never scans `animation-delay`, so the one scanner meant to catch this cannot see it. | `chrome.css:305`, `:1123`, `ui/motion.ts:158` | `--stagger: 30ms` in `:root`, derived from `MOTION.enter.stagger`; test re-pinned. |
| S6 | One keyframe, two durations: `panel-in` runs at `--t-med` on `.bond-detail` and `--t-fast` on `.roster-expanded`. | `chrome.css:539` vs `:771` | Both at `--t-med`, the table's *enter*. |
| S7 | Two transition layers have no timing function at all, so one layer falls back to `ease` while its sibling uses `--ease-enter`. | `chrome.css:210`, `:611` | Name the ease on both layers. |
| S8 | The nameplate enters at `--t-fast`; a mark arriving is *enter* in the motion table. | `chrome.css:1076` | `--t-med`. |

### Performance

| # | What | Where | Fix |
|---|---|---|---|
| S9 | Both scrub tracks commit every pointer sample through to the route, and the route re-renders the stage, the sky bar and up to forty figures. A 1000Hz mouse fires eight samples per frame, so eight full renders draw one. | `paper/pages/Days.tsx:161`, `paper/pages/Moments.tsx:205` | `useFrameCoalesced` — one commit per frame, keeping the last sample. |
| S10 | The filmstrip's open day is an object rebuilt by every poll of `/api/moments`, and the effect keyed on it sent the playhead back to the start of the day mid-playback. | `paper/pages/Moments.tsx:252,261` | Key on the day's id and its first tick. |
| S11 | The stream ticker reads `scrollWidth` inside its animation loop, forcing a synchronous layout on every frame it runs. | `stage/Broadcast.tsx:90` | Measure once in the effect body; it only changes when `text` does. |
| S12 | The bond graph's resize observer commits a fresh object on every observation, including ones that measured the same box. | `paper/pages/BondsGraph.tsx:157` | Compare before setting. |
| S13 | Two idle listeners that never call `preventDefault` hold the scroll thread. | `ui/autoCut.ts:37-38`, `stage/KeyMap.tsx:66` | `{ passive: true }`. |

### Accessibility

| # | What | Where | Fix |
|---|---|---|---|
| S14 | Heading level jumps `h2` → `h4`. Every other page in the same tabpanel uses `h3`. | `paper/pages/BondsGraph.tsx:380,527,558` | `h3`. |
| S15 | `role="tabpanel"` has no accessible name; the tabs carry ids nothing points back to. | `paper/Paper.tsx:234` | `aria-labelledby={paper-tab-${current}}`. |
| S16 | `aria-busy` on a role-less element exposes no busy state. `Skeleton.tsx:1` documents this exact defect and fixes it with `role="status"`. | `paper/pages/BondsGraph.tsx:472,546` | `role="status"`. |
| S17 | An accepted law write is never announced — `role` is swapped to `undefined` on success. Swapping `role` on a live element also risks the alert not firing at all. | `paper/pages/Laws.tsx:216` | A permanent `role="status"`, with `aria-live="assertive"` only on a refusal. |
| S18 | `aria-expanded` with no `aria-controls`; the panel it expands has no id. | `ui/roster/RosterRowView.tsx:80`, `paper/pages/RosterList.tsx:65` | Give the panel an id and point at it. |
| S19 | The signpost arms' `aria-controls` names the tabpanel, which the tabs already own. What the arms open is the dialog, which had no id. | `paper/Signpost.tsx:29` | `id="paper"` on the dialog; arms point there. Two tests re-pinned. |
| S20 | `role="slider"` handles Left/Right but not Up/Down, which the ARIA slider pattern requires. | `paper/pages/Days.tsx:94`, `paper/pages/Moments.tsx:163` | Fold the vertical arrows into the same branches. |
| S21 | A matrix column's full name is reachable only by mouse hover (`title` on `<abbr>`), which touch does not expose and AT reads unreliably. | `paper/pages/LevelMatrix.tsx:30` | A `stage-sr` span beside the abbreviation. |
| S22 | The moments list renders an empty `<ol aria-label="The days the town kept">` while its read is still out, so loading is indistinguishable from an empty shelf. | `paper/pages/Moments.tsx:322` | A `Skeleton`. |

### Consistency

| # | What | Where | Fix |
|---|---|---|---|
| S23 | Words set at the 12px stamp floor, which DESIGN.md:42 reserves for stamps and pixel chips. The ring's four verbs and the director's cue are Manrope words. | `chrome.css:1107`, `:1202` | `--f-2`. |
| S24 | Two off-system shapes in a sheet whose signature is the square pixel slab: a 20px pill on the ring arms and a 3px softening on the paper grip. | `chrome.css:1110`, `:1386` | `border-radius: 0`. |
| S25 | `--frame-tight` is spelled out as its literal value at seven sites, and one invented 2px ledge step is spelled out at two more. | `chrome.css:172,202,387,487,816,843,1629`; `:719,753` | Use the token; add `--ledge-sm` for the shorter step. |
| S26 | A dead declaration: both layers of the signpost's focus shadow are the same colour, so the 6px spread paints the 2px one out entirely. | `chrome.css:1285` | Keep one layer. |
| S27 | Six bare `font-size` literals and five bare paddings, all in the broadcast block, which no test covers — `chromeType.test.ts` reads the `--f-\d+` ladder and the block uses none of it. | `chrome.css:1857,1860,1864,1866,1879,1882,1885,1888,1903` | Named tokens in `:root`; the type-floor test's resolver widened to `--f-[a-z\d-]+`, so the broadcast frame and the signpost now fall **under** the 12px floor law instead of outside it. |
| S28 | Four box sizes duplicate a ladder value as a literal. | `chrome.css:972`, `:646`, `:1370`, `:373`, `:1472` | `--s-8`, `--s-5`, `--s-5`, `--s-6`, `--s-1`. |
| S29 | A dead CSS selector no file has ever carried. | `chrome.css:421` `.room-empty` | Deleted. |
| S30 | Four lines of DESIGN.md have drifted from the sheet: a missing Folk tab, `--measure` stated as 68ch when it is 62ch, a line count from 500 lines ago, and "the seven branches" when there are more. | `packages/web/DESIGN.md:153,176,206,290` | Corrected. |
| S31 | The run export revokes its object URL in the same task as the click; some browsers cancel the download. | `paper/pages/AdminOps.tsx:377` | Revoke a task later. |
| S32 | `setPointerCapture` on `e.target`, so a press landing on a tick or the head captures to the child. | `paper/pages/Days.tsx:158`, `paper/pages/Moments.tsx:202` | `e.currentTarget`. |
| S33 | Operator errors surfaced raw: `Failed to fetch` from the browser, and a bare HTTP status as prose. Neither names a problem or a recovery. | `paper/pages/AdminOps.tsx:52,58` | Sentences that name both. **The wording is mine — see Owner picks.** |

---

## Owner picks

Taste calls I did not make. Each is a real observation; none has one right answer.

1. **Help button label.** Before: `aria-label="What the town answers to"` — a noun phrase on the
   one button whose reason for existing is that `?` named nothing. After: `"Open what the town
   answers to"`. (`stage/HelpButton.tsx:15`. With `aria-haspopup="dialog"` and `aria-expanded`
   already there, the disclosure semantics arguably carry it; that is why I left it.)
2. **Thoughts button label.** Before: `aria-label="Thought bubbles"` — a noun on a switch.
   After: `"Show thought bubbles"`, letting `aria-pressed` carry the state.
   (`stage/ThoughtsButton.tsx:70`.)
3. **The ring's Home verb.** Before: `Home` — the only arm that is a bare noun; its peers are
   `Follow`, `Story`, `Look inside`. After: `Go to their home`. (`stage/SubjectRing.tsx:16`.)
4. **The blind-browser card has no next step.** Before: `This browser cannot draw the town.`
   After: `This browser cannot draw the town. It needs WebGL — try Chrome, Safari or Firefox.`
   (`ui/firstFrame.ts:6`. A terminal error with no recovery is the only one in the product.)
5. **My operator error wording.** Before: `` `the channel answered ${res.status}` `` and
   `err.message`. After: `the key was refused — check the operator token` / `the operator channel
   did not answer — check it is running, then try again`. I wrote these to close a real defect;
   the voice is the owner's to set. (`paper/pages/AdminOps.tsx:52,58`.)
6. **The signpost arm's motion band.** Before: `--ease-tap` (the 90ms press curve) stretched over
   `--t-fast` (150ms) from the shared hover block. After: either `--t-tap` here, or
   `--ease-enter`. `chromeCss.test.ts:137` pins the tap curve on purpose, so I changed neither.
   (`chrome.css:1272`, `:965`.)
7. **Chronicle › Today is 60% white until a day closes.** Before: the lead column shows one
   italic line and 1,400px of empty sheet while the feed column beside it runs long. After:
   either let the feed take the full width until an edition exists, or give the lead an empty
   state with a shape. (`paper/pages/Chronicle.tsx:155`.)
8. **Laws › Admin with no token** is a two-line italic note over roughly 400px of blank sheet.
   The invariant says a viewer must see nothing to guess at, which this honours — but it reads as
   an unfinished page rather than a closed door. (`paper/pages/AdminOps.tsx`.)
9. **Unnamed structures render the world label `BUILDING`.** Three of them are on screen at once
   on a fresh town. Before: the kind as the name. After: either no label until a name exists, or
   a name the town gives it. This reads as placeholder copy to a viewer. (World data, not chrome.)
10. **The key map does not dim the town; the paper does.** Deliberate — `chrome.css:1854` says the
    town keeps living and a click that misses the sheet still reaches it. But two dialogs with two
    behaviours is a coin-flip for a viewer. Pick one.
11. **Five loading states wear the empty-state class.** `feed-empty` is italic prose; `Skeleton`
    and `.skeleton-row` exist for exactly this, and `chrome.css:969` states the rule — "a loading
    surface has a SHAPE, not a spinner". (`AdminOps.tsx:145,264,346`, `Folk.tsx:26`,
    `BondsGraph.tsx:472`.) I added `role="status"` to all of them but did not change the shape.
12. **The law notice leads with the machine path**: `` `${row.path} — asked; it lands at the next
    tick.` `` — while `chrome.css:817` states the opposite rule for the same data, that the human
    title leads and the path is the subtitle. (`paper/pages/Laws.tsx:199`.)

13. **The ring's arms sit on top of the figure they surround.** The four verbs stand at 12, 3, 6
    and 9 on a 124px circle, and a person standing in a crowd disappears behind the Home and
    Story slabs. `after/ring-1440.png` shows it. Widening the arms to `--f-2` (see below) makes
    it marginally worse. Options: a larger ring radius, or arms that only draw a slab where they
    would otherwise sit over a body.

### Changed under the project's own written law, and reversible

`--f-1` → `--f-2` on the ring's four verbs and the director's cue (S23). DESIGN.md:42 says a
*word* starts at `--f-2` and the 12px floor belongs to stamps; both were words. If the owner
wants the smaller mark back, this is a two-line revert in `chrome.css`.

---

## Considered and rejected

| What | Why not |
|---|---|
| `role="application"` → `role="img"` on the canvas mount (`render/StageMount.tsx:250`) | `application` is the honest role for a widget that must consume arrow keys, `+`, `-` and Home, which this does. Its subtree is an empty Pixi canvas, so there is no browse-mode content being suppressed. A focusable `img` that handles keys is the worse contradiction. |
| `outline: none` on the key-map dialog (`chrome.css:1810`) | Documented and correct: the dialog takes focus only so a screen reader announces it, and the first Tab lands on `close`, which rings. |
| Removing "dead" class names `fps-now`, `room-present`, `room-holds`, `family`, `roster`, `provenance` | Structural hooks with no rule. `bs-lead` looked the same and is pinned by `paper.test.ts:270`. Churn with no viewer gain. |
| The five `side-tab` detector hits | All false positives on a documented redundant-encoding system (colour plus a rail, WCAG 1.4.1), each commented at its own line. |
| The unbounded reader cache (`ui/useEndpoint.ts:101`) | Real, but slow: one retained response body per person visited, for the session. Out of scope for a UI pass; worth a line in the backlog. |
| The scrubber `setState` inside `requestAnimationFrame` (`Moments.tsx:287`) | Already gated to an actual tick change, not a per-frame commit. |

---

## What is working

- **The token system is real and enforced.** Three test files derive CSS from `motion.ts`, pin
  the seven-step type ladder, and fail on a non-fade motion outside a reduced-motion guard.
  Almost every defect above is a hole in that coverage, not a wrong decision.
- **44px reach is handled more carefully than most shipped products** — three pseudo-element
  expanders via `--reach-44` so a 5px grip and a 12px track keep their drawn size.
- **Every listener, timer, rAF and observer has cleanup.** No `any`, no `@ts-ignore`, no TODO,
  no commented-out code, no `console.log` in 15,000 lines.
- **Contrast is sampled off the render, not computed from token pairs** — the one method that
  catches text over art.

## Screenshots

`review-shots/before/` and `review-shots/after/`, 1280 / 1440 / 390 for the stage, all four
signpost arms, every tab under them, and the key map; plus a reduced-motion pass at 1440.
`after/` additionally carries the subject ring, a person's ledger (the need bars) and the day
strip, which the before pass did not reach.

The 390 bonds page is the clearest pair: `before/paper-folk-bonds-390.png` (sheet scrollWidth
496 against a 326 client width, chips cut off) against `after/paper-folk-bonds-390.png`
(326 / 326, everything wrapped and reachable).

## Gate

`npm run -s typecheck` · `npx eslint packages/web/src --quiet` · `npx biome format` ·
`npx knip` · `npx vitest run packages/web` — all green. 2,361 web tests after the v2 merge
(1,953 before it).

`packages/town` and `packages/live` carry 12 failures that arrive with v2 and are not this
branch's: both trees are byte-identical to `853afe43`. The clearest is
`adminLaws.test.ts:96`, which expects 400 for `needs.hungerDecayPerTick` and gets 202 — the
test lags v2's own whitelist. The other 11 are `liveWorld.test.ts`'s arbiter cases.

Tests whose literals moved because a fix moved them, each said in its own commit:
`paper.test.ts` (`aria-controls="paper"`, ×2), `SubjectRing.test.ts` (the ring fixture owns a
house, plus a new test for the gated Home arm), `chromeCss.test.ts` (the stagger token),
`SkyArc.test.ts` (the sun's translate), `chromeType.test.ts` (the resolver widened, plus a new
assertion that the drawn sizes are named), `expand.test.ts` and `landmarks.test.ts` (new props
and a `tags` stub on the scene).

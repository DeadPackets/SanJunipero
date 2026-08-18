# GATE G12c — THE USER REVIEW, CLOSED LINE BY LINE

The review's own consequence clause: *"the C12 gate fails if any U-id is unaddressed or
explicitly deferred without a user-visible reason."* This document is the evidence, and
**a demonstration is evidence, not an assertion that a task ran.**

## Run it

```
pnpm install --frozen-lockfile
pnpm typecheck
pnpm vitest run packages/web/src/render/g12c.test.ts     # the canvas   — 34
pnpm vitest run packages/web/src/ui/g12c.test.ts         # the chrome   — 38
pnpm vitest run packages/gateway/src/g12c.test.ts        # town + U25 + read-only proof — 11
pnpm vitest run                                          # everything   — 241 files / 2971
pnpm --filter @sj/web build
```

Split by package for the D-41 reason: `@sj/web` is private, DOM-typed and bundler-resolved, so
a gateway test cannot import its modules without breaking `tsc -b`.

## Verdict

**19 of 23 in-scope U-ids are CLOSED WITH EVIDENCE. 4 are OPEN and named.**
U1, U2 and U26–U31 are the society lane's and were never in this gate's scope.

## The evidence, per U-id

| U-id | what the user said | the measured or shown fact that answers it |
|---|---|---|
| **U3** | *"doesn't look like a triple A town… it just looks like chaos"* | **11 structures**, not the 4 the screenshot showed; **0 doors without a road** (`frontages`); `danglingRoadEnds` `[]`; stage fill at the fit stop **≥ 0.45**; one rank-1 centre named. Terrain and buildings come from ONE `makeCityTemplate` call, asserted on the source. **CLOSED** |
| **U4** | *"interiors are way too low quality, way too under detailed"* | The shell draws, `FURNITURE_OCCUPANCY` is total over `CITY_FURNISHING_KINDS`, a body sorts inside a bed. **And it is a code-painted POLYGON, which the gate asserts.** Seen in the browser at "THE SHED": a bare floor diamond, two walls, one furniture pile. **OPEN — see below.** |
| **U5** | *"roads read ghost-faint at 1×"* | The split rim carries **0.14+ luma delta**, and the single shoulder tone it replaced still fails the same check — so the measure is not vacuous. **CLOSED** |
| **U6** | grass repeat visible on a regular grid | `latticePeak` on a synthesised 16px grid is **> 0.35**; on a non-repeating field it is **< 0.35**. Both directions asserted. **CLOSED** |
| **U7** | farmland/plaza reads as a blob | A 2×2 patch outlines to exactly **one ring of 8 vertices** — the 4 interior edges are gone; a donut still outlines to **2** rings, so holes are not smoothed away. **CLOSED** |
| **U8** | *"characters walk behind buildings… I need a review of the layering"* | A body on the tile in front of the door draws in front of the building for **all 11 structures — 0 disagreements**. `depthOrder` identical over **20 shuffles**. A pinwheel does not throw. **Exactly 2 files** may write a zIndex; `literalZIndexOffenders` `[]`. **CLOSED** |
| **U9** | *"the borders of the characters aren't 100% accurate"* | `hitTightness` of the capsule is under the ceiling at **scales 1, 1.5, 2 and 3**. **CLOSED** |
| **U10** | *"tooltips are out of place"* | **40 sampled anchors**, every one inside the viewport; two owners never overlap; and the world's own place names now de-conflict through the same rule. **CLOSED** |
| **U11** | door hotspots render as dark rectangles | `doorLocalRect` clears **24 px in both axes at every `ZOOM_STOP`**; `entities.ts` contains no `doorZIndex`; the door is `addChild`-ed to its building. **CLOSED** |
| **U12** | *"lackluster… no information at a glance"* | All **five required fields non-empty for every living person**; a day-5 town renders different states from a day-0 one; the list stays whole in every reachable expander state. **CLOSED** |
| **U13** | *"'Asleep' and 'Resting' mean the same thing"* | `statusLiteralOffenders` over the whole bundle is `[]`; the state words and the condition words are **disjoint sets**; the sleeping founder reads `Asleep` and the string `resting` appears nowhere in his row. **CLOSED** |
| **U14** | *"the timeline is missing MARKS; the font is hard to read"* | `marksFrom` returns marks on a mature fixture; `changed` outweighs `built`; dense marks coalesce; every timeline size is **≥ 12 px**. **CLOSED** |
| **U15** | *"bonds does not represent relationships and its tags are weird"* | **Six levels**, all reachable; a level **falls** under decay (measured over 20 000 ticks); parent, child and sibling are distinguished; `relationLine` is total over **type × level**. **CLOSED** |
| **U16** | *"an element sits ON TOP of the letterbox"* | The three boxes **partition the stage exactly at five heights**; `straddlers` is `[]` for the placed layout **and finds a crossing rail when one is planted**; the letterbox does not engage with nothing playing. **CLOSED** |
| **U17** | *"world laws are super technical"* | `LAW_COPY` total over `TOGGLABLE_PATHS`; **no dot-path and no underscore** in any title or sentence; the whole law surface passes the R4 machine-word scan. **CLOSED** |
| **U18** | *"text boxes are not vibrant, not stylized, not clear enough"* | No world-text module asks for `monospace`. **Every world-text pair clears AA in BOTH light bands** — the viewer's ratio through the night multiply, not the material's. No alpha on a bubble node. Nine-slice tiles exactly at 4 lengths. **CLOSED** |
| **U19** | *"I zoom way too much by accident"* | 30 trackpad events advance **exactly one stop**; a **500-event random walk** never leaves the stop set; the transit eases and lands exactly. A world label is the reader's size at every stop. **CLOSED** |
| **U20 / U21** | *"controls out of the way… I must be able to move or hide them"* | `hudReducer` reaches a fully hidden layout and returns; the keyboard way back is registered in `App.tsx`; the dock is not itself dockable; the layout round-trips through storage. **CLOSED** |
| **U22** | *"controls at the bottom to let me do what I want"* | `actionFor` is total over every id the bar can produce across **6 lenses × live/past × inside/outside**; every control has a spoken label and **no pictographic character**. **CLOSED** |
| **U23** | *"missing transitions and that extra shine"* | One `MOTION` table, total and inside the 300 ms ceiling; **no raw duration anywhere in the sheet**; `sceneReducer` completes and retargets without restarting; **all twelve finish lines pass — nine of which failed on the landed sheet.** **CLOSED** |
| **U24** | *"a very far distance from being that ready"* | **R2, R4, R7 and R8 pass with numbers — every machine-checkable line.** R2 closed on a **broadcast layout** (`?broadcast=1`): 7.00 / 7.00 / 8.00 / 8.00 px against a 5.4 px floor at the true 0.25, read off the shipped sheet, `captionShortfall` `[]`. R1's two failure modes are fixed and guarded (the load `TypeError`; the subject-less frame). **R1, R3, R5 and R6 keep a human verdict** — their decidable halves are measured, and each is one named step in `twitch-readiness.md`. **OPEN — see below.** |
| **U25** | *"all of the humans were sleeping inside of one house"* | Five huts, **five distinct owners**, five distinct doors; `founders.test.ts` drives 400 real ticks with every founder kept spent and lands **five distinct `insideId`s**. **CLOSED** |
| **P22** | personality is an output, not an input | `authoredIdentityOffenders` `[]`; `substanceOf` reads the LOG; two people with identical genesis and different logs render differently. **CLOSED** |

## WHAT IS OPEN, AND WHY — stated, not counted

### U4 — interiors. OPEN.

Accepted once, and **the user reopened it.** What is landed is a code-painted polygon in
`interiorScene.ts`: a floor diamond, two wall planes, contact shadows, and furniture sprites
from the item library. Seen in the browser this batch — "THE SHED" is a bare floor with one
pile of art on it, and it is not what *"way too under detailed"* was asking to change.

**Real mapped rooms need a renderer C12b owns**, and until that renderer exists the forge
cannot make an interior tileset class either — there is nothing for it to generate *for*. The
gate asserts the absence of any interior tileset, so U4 can be reassessed the moment one lands.

### U24 — Twitch readiness. OPEN on a HUMAN VERDICT, and nothing else.

**Five of the eight pass. None fail.** Every line a machine can decide is decided:

- **R2 CLOSED.** Not by raising the desktop — 22 px chrome on a 1920 stage is absurd for the
  person in front of it, and the desktop shortfall stays pinned at 3.00–4.00 px on purpose.
  Closed by a **second composition**: `?broadcast=1` removes fourteen operator surfaces from
  the frame and leaves the picture, a 28 px clock and a 28/32 px caption, with the town's own
  speech doubled to 32 px by a whole multiple so the nearest-sampled atlas stays exact.
  **7.00 / 7.00 / 8.00 / 8.00 px against 5.4.** Read off the shipped stylesheet, so a token
  change moves the number rather than passing quietly.
- **R1's two failure modes are fixed**, both found by looking: the load-time `TypeError` on a
  destroyed scene's ticker, and a broadcast that opened on empty grass because `/api/heat` is
  legitimately `[]` in a town where nobody speaks. Both are guarded by tests.
- **R3 and R5 keep a human verdict**, but their decidable halves are now measured — the frame
  always names its subject (200 consecutive quiet ticks, 0 subject-less), and a death, a birth
  and a build are pairwise distinct in icon, pixels, sentence and timeline mark. One collision
  recorded: a birth and a narrator "first" share the `spark` glyph.
- **R6 cannot be measured from an agent lane, and that is now proved rather than assumed**:
  `requestAnimationFrame` did not fire once in 45 s in a tab reporting
  `document.visibilityState: 'hidden'`. A frame rate from a tab that is not painting is fiction.

**The four steps a person has to run are written out, with what to record, in
`twitch-readiness.md`.** U24 stays OPEN until they are run.

### Out of this gate's scope entirely

- **U1, U2** and **U26–U31** — society, psychology, genetic drives, mode collapse, repeated
  experiments. **C8 owns them.** Nothing in C12a touches the mind.
- **Any art-resolution item** — the forge lane owns those. Its 128 px items class is finished
  art **the gateway does not yet load**: the flip is one line (`DEFAULT_LIBRARY_ROOT`) and it
  was correctly left for the user.

## The read-only proof

- `packages/engine/src/golden.test.ts` and `g2.test.ts` are **byte-identical to the commit this
  branch forked from**. Not to `main`'s tip — main has moved on and its `g2.test.ts` is 122
  lines shorter, and a branch cannot be blamed for a file somebody else edited.
- **0 files** changed under `packages/engine/src`, `packages/arbiter`, `packages/agents/src` or
  `packages/forge` across the whole branch.
- `packages/shared/src/cityTemplate.ts` **is** changed on this branch, by C12a task 61. It is
  the contested file the merge train has to reconcile, and it is **frozen from batch 6's base
  `e681f8c` onward** — asserted, rather than pretended away.

# The Signpost UI

The town is the whole viewport. Every mark over it is a thing **of** the town — a signpost, a
plate, a ring, a sheet of paper, a stamp, a caption. There are no bars, no sidebars, no dock and
no minimap. You watch; when you want to know, you ask the town, and a sheet of paper comes up
while the town keeps living behind it.

Everything below is read off the built world. `ui/chrome.css` is the one sheet; `ui/motion.ts` is
the one motion table; `paper/pageModel.ts` is the one page table. Tests pin each of them.

## Tokens

All in `:root` at the top of `ui/chrome.css`.

| Role | Token | Value |
|---|---|---|
| paper, lit | `--cream` | `#FFF6E9` |
| paper | `--parchment` | `#F6E8D5` |
| paper, shaded | `--sand` | `#E8D5BC` |
| ink | `--ink` | `#43394A` |
| ink, quiet | `--ink-quiet` | `#5F5568` — 6.57:1 on cream, 4.91:1 on sand |
| ground, dark | `--deep` / `--night` | `#241F2B` / `#322B38` |
| cream, quiet | `--cream-quiet` | `#C4B8AE` — 8.28:1 on deep |
| the one accent | `--honey` / `--honey-l` | `#F2C879` / `#F8DCA2` |
| alarm | `--ember` | `#E8785A` |
| state | `--sage` `--rose` | `#93B573` `#C47876` |
| the feed's zebra | `--parchment-zebra` | `#F1E1CC` — the sand-over-parchment composite, computed once |

`--water`, `--stone`, `--panel` and `--accent` were read by no rule in the sheet and are gone.

De-emphasis is **a colour, never `opacity`** — a transparency's ratio is unknowable at the call
site. The signature shape is the pixel slab: `--frame` = a 2px ink ring over a 4px stepped
`--ledge` in `--deep`. Under `forced-colors: active` the browser drops every `box-shadow`, so the
sheet rebuilds those edges as `2px solid CanvasText`.

**Two ladders, and nothing off them.** Spacing is `--s-1: 2px` through `--s-8: 40px` on a 2px base
(4px cannot spell the hairline pads the chips are built from). Type is `--f-1: 12px` through
`--f-7: 28px` — seven steps, where 12.48, 12.8 and 13 used to be three. `--f-1` is the floor and
belongs to stamps and pixel chips; a *word* starts at `--f-2`.

Sheet geometry: `--paper-w: min(78%, 760px)`, `--paper-h: min(66%, 100dvh - 96px)`; under 640px
`--paper-w-narrow: 96%`, `--paper-h-narrow: 80%` (78% of a 390px phone is 304px, which no roster
row fits in). The town behind it dims by `--dim: 0.28`. Every mark that hangs off an edge takes
`--mark-inset: clamp(16px, 3vmin, 40px)`, guarded by `max(…, env(safe-area-inset-*))` — a 4% inset
was 15.6px on a landscape phone and 57.6px at 2560, and under the notch on both.

## Type

| Face | Token | Where |
|---|---|---|
| Silkscreen | `--font-px` | the pixel face: the nameplate, section heads, chips |
| Press Start 2P | `--font-sign` | the signpost's arms only: 16px is twice its 8px grid, a 14px cap, and every stroke lands on the plank's own pixels |
| Manrope | `--font-body` | paper body, ring arms, roster names, place names, and the two letter-spaced marks — the stamp (0.14em) and the cue (0.18em, uppercase) |
| Fraunces | `--font-title` | paper headings |
| system mono | `--font-data` | law paths, stamps, every column of figures |

Silkscreen at 13px had an 8px cap on the arms and read as a smear over the wood; Press Start 2P
at an integer multiple of its grid is the one place the sheet uses it (`render/textFaces.ts` also
draws with it on the canvas).

**Silkscreen has no lowercase**, so it may not carry a name or a place: a roster row and a
`.place-name` are Manrope 600, and "Amara's house" is not "AMARA'S HOUSE".

Self-hosted through `@fontsource`, never a CDN link. **Nothing renders below 12 CSS px** —
`ui/chromeType.test.ts` is the law, and it outranks any smaller number a sketch asks for.

## The six marks on the stage

`packages/web/src/stage/`. Each is DOM, absolutely positioned inside `.app`, placed against the
camera every frame by **one** rAF loop (`stage/anchor.ts`, `joinStageLoop`) that writes
`style.transform` directly — a camera at 60fps through React state would re-render the whole
overlay sixty times a second.

| Mark | What it is | Where |
|---|---|---|
| `Signpost` | four arms on a post: Folk · Chronicle · Found · Laws, each plank cut to its word | bottom-right, `--mark-inset` |
| `HelpButton` | one 44px `?` on a honey slab, opening the key map | bottom-left, `--mark-inset` |
| `Nameplate` | `.stage-plate`, the picked figure's name on a wooden plate | 60px under the anchor, clear of the ring's lowest arm |
| `SubjectRing` | four verbs at 12/3/6/9 o'clock: Follow · Story · Bonds · Home | round the picked figure |
| `QuietStamp` | `DAY n · SEASON · HH:MM · LIVE\|REPLAY\|OFFLINE` | top-right, `--mark-inset`; opens the session, then on input, gone 3s later |
| `DirectorCue` | `DIRECTOR · NAME`, letter-spaced | bottom-centre, `--mark-inset`, never reaching the arms |
| `SpeechLive` | a visually-hidden `aria-live` line of every utterance | anywhere, once |
| `SkyArc` | the sun's road: `DAY n · SEASON` · the arc · `STORM 4°` | the top edge, `--mark-inset`, permanent |

**The sun arc is the one permanent mark.** `ui/skyModel.ts` puts one traveller on one curve —
the sun from 05:00 to 21:00, then the moon over the same road — and the boundary is
`dayPhaseFromTick`'s own, so the arc and the light on the town cannot disagree about when it got
dark. The token's position says the hour before the words beside it are read; the words are the
day, the season, the weather kind and the temperature, in `WEATHER_GLYPH`'s 8×8 pixels rather
than an emoji. It eases its position on the world's tick and runs no loop at all. Below 900px the
arc flattens and the position stops meaning anything, so the road goes and the two chips close
up. The quiet stamp sits 30px under it, still owning the wire's own word.

**The hover is a footprint plate.** `render/plate.ts` draws it and `ui/plateModel.ts` decides
its words: a cream pixel slab welded to the thing's own ground point — `placeTag` is asked for
`below` and only leaves the footprint when the view has no room there. Three rows at most, 22
characters each: `kind` in Silkscreen capitals, `name` in the face that has lowercase, and
`quiet` on a **parchment band** — de-emphasis is a different paper, because `--ink-quiet`
measures 3.57:1 on cream under the deep-night multiply where the ink on parchment holds 4.67:1.
A building answers what it is, whose it is (`structure.owner`, never `builtBy`) and who is
inside; a person answers their name and the one word for what they are doing. A row with nothing
to say is not drawn.

Speech itself is drawn **in the canvas**, not the DOM: `render/bubbles.ts` draws a 2px ink box on
a 4px radius with a three-step stair tail, washed toward the speaker's own colour at 15%.
**The box grows to the sentence and nothing is cut** — it wrapped at 210 world px and stopped at
two lines, so a spoken line arrived as "Sit down, Sa…" and the other 66 characters were seen by
nobody. `BUBBLE_MAX_PX` is 420 and there is no line ceiling at all; the only bound left is
`sanitizeSpokenText`'s own 240 characters, and a longer line is held longer (3.5s + 40ms a
character). Everybody the camera can see gets a box; at zoom 0.25 everything collapses to a `…`
pill. Wider boxes collide far more often, so `MAX_STACK_STEPS` is 6 rather than 3 — past that
`onLeash` hides a bubble rather than let two composite.

**One occupancy.** `render/tooltip.ts` is the label layer and owns the only table of taken screen
space, keyed by who owns the boxes (`bubbles`, `plate`). Everybody writes theirs and reads
everybody else's, so no two labels can composite. The plate is DOM over the canvas, so it
publishes its box in view coordinates — otherwise a bubble pushed below a figure lands on it.

## The paper

`packages/web/src/paper/`. One sheet, one dialog, rising from the bottom edge.

| Arm | Tabs |
|---|---|
| Folk | People · Bonds · Families |
| Chronicle | Today · Firsts · Chapters · Moments · Days |
| Found | Things · Places |
| Laws | World · Admin |
| a person | Story · Bonds · Ledger |
| a place | Provenance · Inside |

`paper/pageModel.ts` is the only place that table exists. Four ways down: the close word, Escape,
a click on the town, and the grip. Focus enters the tab strip on open, moves with the arm, and
returns to the opener on close.

**The sheet is a dated front page.** The head is a masthead — Fraunces 700 at `--f-7`, centred,
the one place the type is the ornament — over a dateline rule: a 2px line above and a hairline
below, `DAY n · SEASON` at one end and the clock at the other (`paper/stamp.ts:dateline`), with
**the tabs running along it as the section line**. They are still the same tablist: same roles,
same one tab stop, same arrow keys, same close word at the end. Every arm wears it, not the
Chronicle alone.

Chronicle › Today is laid out as the front page it now looks like: the day's edition is the lead
story and the live feed is the column beside it, split at `44rem` of the sheet's **own**
container — below that they stack, because two columns of a 760px sheet are two gutters. The
lead drops its slab and its frame and takes a Fraunces drop cap; its section heading stays in
the tree as a visually-hidden `h3`, because the edition's own headline is what a sighted reader
sees.

**Bonds is one vertical sheet**, never two pictures crammed side by side. The whole town's graph
first — every edge drawn twice, a deep casing then the colour on it, at 3px and 5px rather than
1.5 and 3, because a hairline over a night ground crossing a slab is not a connection anyone can
follow; names carry ink on all four sides. Then **one person's orbit**: ego-centric, and the ring
radii ARE `ui/relationGraph.ts`'s `LEVEL_DISTANCE`, so distance is the number the town graph is
laid out with rather than a drawing. Each spoke carries three channels at once — the dash is the
family tie, the colour is which way it is going, the weight is how much of it there is — and a
stranger gets a node and **no line**, the same rule the town graph follows. Then the **level
matrix**: a fixed grid where every pair has one address, the level as a fill and the warmth as a
number beside it so the ladder survives without colour, and an empty cell is two people who have
never met. Clicking a node in the town graph, or a name down the matrix, moves the orbit; the
orbit's own head opens that person's page. Names are HTML over the plot, not SVG text — a glyph
inside the viewBox is 10px on a 300px phone.

**The grip follows the finger.** `pointerdown` captures the pointer and suppresses the sheet's
transition; every `pointermove` writes `transform: translate(-50%, y)` straight to the DOM — 1:1
down, rubber-banded to a third upward — and eases `.town-dim` with it, so the town brightens under
your thumb. On `pointerup`, `gripDismiss(down, speed)` puts it away past `GRIP_CLOSE_PX` (40px) or
above `GRIP_FLING_PX_MS` (0.5 px/ms), and otherwise hands the spring back to the CSS. Under
reduced motion the tracking stays — it is direct manipulation, not decoration — and the spring is
the sheet's own instant snap.

## Breakpoints

One media query in 1,383 lines was a width-only 640px, and **height is what a landscape phone runs
out of**. Several now, and the sheet's own lists read the sheet rather than the window.

| Query | What it is for |
|---|---|
| `max-width: 640px` | the sheet takes 96% × 80%; the arms move to the top edge as a 2×2 block |
| `max-width: 480px` | the head becomes a grid — title and close on one row, tabs scrolling along the next |
| `641–1000px` | with the sheet open the arms take the top-left corner, 2×2: the sheet at the left edge leaves 146px beside it at 768 and the longest arm is 192px |
| `641–1400px` | the sheet steps left far enough to clear the arms, statically, so nothing moves when it opens |
| `max-height: 620px` | the sheet takes `100dvh - 64px` and 96% of the width; the post is hidden; the arms lie in a row above it |
| `min-width: 1920px` | `--paper-w` to 1040px; the signpost's `--px` to 3 — three screen pixels per drawn one, and the label to 24px (`scale: 1.5` resampled the 2× layer and left the outline one row thick, then two) |
| `hover: none` | no lift survives the tap; the mark tips open on focus; the close word drops `· Esc` |
| `forced-colors: active` | every `box-shadow` edge comes back as `2px solid CanvasText` |
| `@container` on `.paper-sheet` | roster reservations above 26rem, two roster columns above 46rem |

**With the sheet open the signpost stays whole at every width** — 0 px² of overlap measured at
320, 375, 390, 768, 844×390, 1024, 1440 and 2560, against 36,352 px² (100% hidden) at ≤390 before.

## Motion

`ui/motion.ts` holds the table; the CSS custom properties are derived from it and a test fails if
the two disagree.

| Motion | ms | Ease | What |
|---|--:|---|---|
| tap | 90 | `cubic-bezier(.3,0,.2,1)` | a press answering |
| reveal | 150 | `cubic-bezier(.2,0,0,1)` | a hover, a chip, the plate |
| move | 180 | `cubic-bezier(.4,0,.2,1)` | camera, zoom, the ring's pop |
| enter | 240 | `cubic-bezier(.2,0,0,1)`, 30ms stagger | a page arriving |
| scene | 300 | `cubic-bezier(.4,0,.2,1)` | the sheet's rise, an interior, a day |
| ambient | 1200 | linear | scenery: breathing, drift |

**Nothing that answers an input runs longer than 300ms.** Anything past the ceiling carries a row
in `MOTION_EXEMPT` with its reason, and a test asserts every long motion in the product has one.
Under `prefers-reduced-motion: reduce` everything becomes a fade or nothing at all — the sheet
does not slide, the ring does not pop, the plate does not fade in. Every duration lives inside a
`no-preference` guard or carries its own `reduce` switch-off; `chromeCss.test.ts` fails on a
non-fade motion outside one.

**A transition reads the duration of the state it goes TO.** The 0s belongs on the base rule and
the 150ms on `:hover`, or every hover-out lies about where the pointer is for 150ms.

One stagger, one depth: `--stagger-i` on `:nth-child(1…6)` and
`animation-delay: calc(var(--stagger-i, 6) * 30ms)`, so nothing past the sixth item arrives all at
once.

## Accessibility floor

- **Every pointer path has a key.** `S` signpost · `Tab` chrome · `Enter` act · `Esc` down ·
  `F` fullscreen · arrows/`+`/`-`/`Home` camera · `D` director · `?` **the key map** — which
  now has a pointer path of its own, the 44px corner button, because a key nothing on screen
  names is an affordance only a viewer who already knew could find ·
  `Shift+P` the frame meter. `?` is where a person looks for the list, so the list is what it
  opens; the meter is an instrument and took the chord.
- **And every key has a pointer path.** Two fingers are the touch screen's wheel
  (`render/camera.ts:zoomPinch`) — `touch-action: none` on the stage takes the browser's own
  page-zoom away, so without a pinch the six stops have no way in at all on a phone.
- **One Escape ladder**, and nothing else in the tree listens for it: `useStageKeys` asks,
  `ui/interaction.ts:escapeStep` answers — keys → paper → interior → pick → fullscreen.
- **The camera keys and the stage keys are disjoint sets**, asserted by test, so no key fires twice.
- Focus ring: **2px `--ink`, 2px offset, square**. Ember measured 2.40:1 on parchment and 1.84:1
  on honey — below SC 1.4.11 on every ground the chrome sits on; ink is 9.06 / 10.20 / 7.63 / 6.92.
  `--honey` stays on `.stage-figure` and the ring's arms, the only two painted on `--deep`.
- **Every pointer target is 44px.** A bar that must keep its drawn size — the 5px grip, the 12px
  player track, the 22px day track, the 26px day mark — gets its 44px from a transparent
  pseudo-element instead of growing.
- `aria-live` for speech (one line per 800ms, newest kept) and for paper state.
- Text over art is ≥ 12 CSS px and carries **its own ground**: a 4-way 1px `--deep` halo, or a
  plate. Cream on the daylight tile is 1.40:1, so the halo is load-bearing rather than decorative.
  Pixel-sampled at 1440 in daylight, **every glyph pixel of the stamp and the cue has ink within
  2px of it**; `ui/contrast.test.ts` asserts the four shadow offsets, and a token-pair test cannot
  see this — it must be sampled. The signpost's arm is the exception: its ground IS the plank, so
  the label is `--deep` ink painted on the wood with a 1px `--honey-l` cut edge under it, no halo.
  Sampled off the render at 375–2560 and DPR 2: **7.66:1 idle, 10.19:1 hovered, 5.46:1 on the
  pressed plank**, worst grain pixel under a glyph 5.46:1 (`~/handoff/cleanup/stage8/fix-signpost.md`).
  Canvas world text held it only after the atlas was split: Pixi bakes a `dynamicFill` atlas
  white and applies the fill as a per-glyph tint, and that tint was dropped below the call site
  — every world glyph rendered white, **1.1:1 over its own slab**
  (`~/handoff/cleanup/stage7/i7-report.md`, D4). `render/textFaces.ts` now installs **one atlas
  per ink** (`WORLD_INKS`, three of them) with `dynamicFill: false`, so the ink is baked and
  there is no tint step to lose; `createWorldLabel` resolves the family from the style's fill,
  and a fill with no atlas falls back to a canvas glyph, which draws its own colour.
- **A page never prints an empty state over a broken wire.** `Read<T>` carries `failed`, and
  the seven branches that would otherwise say "the town has not done this yet" say
  `OUT_OF_REACH` and offer the read again. An empty state is news about the town; this is news
  about the wire, and they are not the same sentence.
- The signpost's arms are a **disclosure set**: `aria-expanded` + `aria-controls="paper-sheet"`,
  never `aria-pressed`. Hover lifts an arm 1px onto a warmer plank; the open arm sits 1px down on
  a darker one — three drawn rasters, two channels each, no filter: a brightness filter took the
  label to 1.53:1 and flickered 1.2 → 0.94 → 1.2 when a pressed arm was pressed. The focus ring
  is honey inside deep (9.6:1 between its own two rings), because the ground under it is the town.
- **The signpost is drawn at native pixel size** — `scripts/gen-signpost.py` writes an 88×18 plank
  (three states) and an 8×16 post tile from the honey ramp of `MASTER_PALETTE`, and the sheet shows
  every drawn pixel as `--px` screen pixels (2, or 3 above 1920px) through `border-image` slices
  at the nailed end and the point, so a plank is as long as its word and the grain between repeats
  rather than stretches. Planks sit 18 drawn pixels in a 22-pixel row: 4 of post between them.
- The document opens with a visually-hidden `<h1>`, a skip link to `#signpost`, and a `<main>`
  round the stage. `Figures` leaves the tab order entirely while the paper is open.
- The ring is a `role="menu"` labelled with the subject's name; the plate is `aria-hidden` because
  it is a visual echo of it.

## Invariants

- **One-way glass.** The UI never writes into a mind. Laws › Admin is the only write path in the
  product, it is marked as the operator's page out loud, and it offers no control at all without a
  token. A viewer who wanders onto it sees nothing to guess at.
- **A viewer is never shown an id.** A hover names a builder only when the builder is a person in
  this town; genesis signs its own work with a runner who is nobody, and that is left unsaid.
- **Rendering law untouched**: 2:1 dimetric `sx=(dx-dy)*16`, `sy=(dx+dy)*8`; the fixed zoom stops
  `0.25 0.5 1 2 3 4`; NEAREST everywhere.
- **Determinism untouched.** Nothing in the chrome moves the world.
- The first viewport is the town at zoom 1, centred, with the director cutting from there.
- **Two `<img alt="">` are deliberate.** A person's portrait sits beside their name, and the
  discovery art is ornament on a card whose `aria-label` already carries the whole record.
- **The town-dim is a pointer-only dismissal**, `aria-hidden` with no role. Escape is the keyboard
  path and the close word is the pointer's other one; a third named control for the same act would
  be noise in the tab order.

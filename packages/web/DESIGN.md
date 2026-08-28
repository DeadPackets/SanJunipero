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
| state | `--sage` `--rose` `--water` `--stone` | `#93B573` `#C47876` `#7FB0C9` `#ABA198` |

De-emphasis is **a colour, never `opacity`** — a transparency's ratio is unknowable at the call
site. The signature shape is the pixel slab: `--frame` = a 2px ink ring over a 4px stepped
`--ledge` in `--deep`.

Sheet geometry: `--paper-w: min(78%, 760px)`, `--paper-h: 66%`; under 640px `--paper-w-narrow: 96%`,
`--paper-h-narrow: 80%` (78% of a 390px phone is 304px, which no roster row fits in). The town
behind it dims by `--dim: 0.28`.

## Type

| Face | Token | Where |
|---|---|---|
| Silkscreen | `--font-px` | the pixel face: signpost arms, the nameplate, section heads, ids |
| Press Start 2P | `--font-display` | identity moments only |
| Manrope | `--font-body` | paper body, ring arms, and the two letter-spaced marks — the stamp (0.14em) and the cue (0.18em, uppercase) |
| Fraunces | `--font-title` | paper headings |
| system mono | `--font-data` | law paths, ids |

Self-hosted through `@fontsource`, never a CDN link. **Nothing renders below 12 CSS px** —
`ui/chromeType.test.ts` is the law, and it outranks any smaller number a sketch asks for.

## The six marks on the stage

`packages/web/src/stage/`. Each is DOM, absolutely positioned inside `.app`, placed against the
camera every frame by **one** rAF loop (`stage/anchor.ts`, `joinStageLoop`) that writes
`style.transform` directly — a camera at 60fps through React state would re-render the whole
overlay sixty times a second.

| Mark | What it is | Where |
|---|---|---|
| `Signpost` | four arms on a post: Folk · Chronicle · Found · Laws | bottom-right, 4% inset |
| `Nameplate` | `.stage-plate`, the picked figure's name on a wooden plate | 60px under the anchor, clear of the ring's lowest arm |
| `SubjectRing` | four verbs at 12/3/6/9 o'clock: Follow · Story · Bonds · Home | round the picked figure |
| `QuietStamp` | `DAY n · SEASON · HH:MM · LIVE\|REPLAY\|OFFLINE` | top-right, 3% inset; on input, gone 3s later |
| `DirectorCue` | `DIRECTOR · NAME`, letter-spaced | bottom-centre, 4% inset |
| `SpeechLive` | a visually-hidden `aria-live` line of every utterance | anywhere, once |

Speech itself is drawn **in the canvas**, not the DOM: `render/bubbles.ts` draws a 2px ink box on
a 4px radius with a three-step stair tail, washed toward the speaker's own colour at 15%. Two
lines then `…`; the nearest three speakers get a box and everyone else a `…` pill; at zoom 0.25
everything collapses to the pill.

**One occupancy.** `render/tooltip.ts` is the label layer and owns the only table of taken screen
space, keyed by who owns the boxes (`bubbles`, `plate`). Everybody writes theirs and reads
everybody else's, so no two labels can composite. The plate is DOM over the canvas, so it
publishes its box in view coordinates — otherwise a bubble pushed below a figure lands on it.

## The paper

`packages/web/src/paper/`. One sheet, one dialog, rising from the bottom edge.

| Arm | Tabs |
|---|---|
| Folk | People · Bonds · Families |
| Chronicle | Today · Chapters · Moments · Days |
| Found | Things · Places |
| Laws | World · Admin |
| a person | Story · Bonds · Ledger |
| a place | Provenance · Inside |

`paper/pageModel.ts` is the only place that table exists. Four ways down: the close word, Escape,
a click on the town, and a grip drag of more than `GRIP_CLOSE_PX` (40px). Focus enters the tab
strip on open and returns to the opener on close.

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
does not slide, the ring does not pop, the plate does not fade in.

## Accessibility floor

- **Every pointer path has a key.** `S` signpost · `Tab` chrome · `Enter` act · `Esc` down ·
  `F` fullscreen · arrows/`+`/`-`/`Home` camera · `D` director · `?` the frame meter.
- **One Escape ladder**, and nothing else in the tree listens for it: `useStageKeys` asks,
  `ui/interaction.ts:escapeStep` answers — paper → interior → pick → fullscreen.
- **The camera keys and the stage keys are disjoint sets**, asserted by test, so no key fires twice.
- Focus ring: 2px `--honey`, 2px offset. Every pointer target is at least 40px tall; a signpost
  arm is 44px.
- `aria-live` for speech (one line per 800ms, newest kept) and for paper state.
- Text over art is ≥ 12 CSS px with an ink halo or a plate behind it; 4.5:1 minimum, measured
  against the night ground as well as the day one. **This holds for every DOM mark and is asserted
  by `ui/contrast.test.ts`. It does NOT currently hold for canvas world text** — see the open
  defect in `~/handoff/cleanup/stage7/i7-report.md`: a bitmap glyph renders white rather than the
  ink it asks for, measured at 1.1:1 over its own slab.
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

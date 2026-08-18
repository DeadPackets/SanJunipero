# C8 delta from C12a — what the review lane changed, and what it hands on

C12a "The Review" (Phases L–R, tasks 59–94, gate G12c) owns presentation. Anything it found
that belongs to the engine, the mind or genesis is booked here rather than built there.

## U25-ENGINE (carried, not ours)

The viewer half is closed at Task 60. A tired founder now walks to the door of the hut they
own, because `homeIntent()` reads `Structure.owner` through the new `homeOf()` instead of the
`FOUNDERS_HOME_ID = 'structure_cottage'` constant that routed all five to one door.

The engine half is open: a *mind* preferring the roof it owns, rather than a dev script routing
it. C11 batch-10 controller ruling R-E already books it — *"structure ownership half landed
(legal, not witnessed) → C8 carry."* Ownership is legal fact in `Structure.owner`; no agent
perceives it, values it, or defends it. C12 does not simulate that in the viewer.

MEASURED at Task 60: on the real town before the fix, **0 of 5** founders ever got indoors
(the hardcoded id does not exist in the template town at all); on the scripted one-cottage
fixture the same line produced the user's "all sleeping inside one house". After the fix, five
founders sleep under five distinct roofs.

## Template coordinate and semantic changes (R2 condition)

R2 lets C12a edit `cityTemplate.ts` on condition that every coordinate or semantic change is
ledgered for C8. Genesis reads this template, so these are changes to the town genesis builds.

### Task 61 — the town gets a centre, two facing ranks, and roads that arrive somewhere

All coordinates are template-relative (`dx,dy`), inside `CITY_W 34 × CITY_H 30`.

| Thing | Before | After | Why |
|---|---|---|---|
| `HUT_ORIGINS` | `[14,4] [17,4] [20,4] [23,4] [26,4]` — five in one straight line | `[14,4] [18,4] [22,4]` north rank, `[19,7] [23,7]` south rank | a street, not a row; the ranks are staggered so no door faces a door |
| well | `dx 20, dy 13` — beside the square | `WELL_AT dx 17, dy 12` — inside `PLAZA`, on `PLAZA_CENTRE.dx` | a centre that reads as a centre |
| fire pit | `dx 20, dy 15` — beside the square | `FIRE_PIT_AT dx 17, dy 16` — inside `PLAZA`, same axis | the two face each other across the tile you stand on |
| shed A | `dx 16, dy 17` | `dx 18, dy 17` — the workshop, on the south approach | frontage |
| shed B | `dx 16, dy 21` — an identical twin 4 rows away | `dx 27, dy 21` — the field barn, at the far end of the farm headland | two sheds doing different jobs in different districts |
| storehouse | `dx 13, dy 12` | unchanged | already fronted the main street |
| wagon | `dx 5, dy 16` | unchanged | already fronted the bank path |
| north approach | `dx 17, dy 7..11` | `dx 15, dy 7..11` | the centre line is now where the well stands |
| south approach | `dx 17, dy 17..19` | `dx 19, dy 17..19` | same, for the fire pit |
| homes yard | `dy 6, dx 14..31` — ended in grass at both ends | `dy 6, dx 14..22` — both ends stop at a hut door | no road ends in grass |
| homes back lane | — | `dy 9, dx 16..23` — new; the south rank's doors open onto it | frontage for the second rank |
| farm headland | `dy 20, dx 7..27` — ended in grass at the west | `dy 20, dx 5..27` — west end meets the bank path, east end stops at the barn door | no road ends in grass |
| growth plots, homes | `[29,5] [30,5] [29,7] [30,7]` | `[16,5] [17,5] [20,5] [21,5]` — the gaps in the north rank | the old plots were off the shortened yard |
| growth plots, market | `[18,17] [19,17]` | `[15,17] [16,17]` | `[18,17]` is now the workshop |

**Unchanged:** structure count (11, inside the ruled 8–12), `FOUNDER_IDS` and their order — so
hut *n* still belongs to founder *n*, only the coordinates moved. `PLAZA`, `PLAZA_CENTRE`,
`DISTRICTS`, the river/bank/path columns, and every furnishing set are untouched.

**The one semantic change:** the square's paving is now laid AROUND its two monuments —
`cityRoadTiles()` cuts the well and fire-pit tiles out of the `PLAZA` rect. So the plaza's
interior is no longer uniformly `cross`; the two tiles that abut a monument read as `t-no-n`
and `t-no-s`, and the plaza's north-west and south-east corners are `t-no-w` / `t-no-e` where
the approaches arrive. Anything downstream that assumed "every plaza tile is a road" must read
the road set instead.

Both goldens (`f487a26b`, `6f2529fb`) are byte-identical across this change, which Task 61
proves rather than assumes — `cityTemplate` is outside the golden path.

**For C8:** genesis lays a different-shaped town. Any C8 fixture that pins a hut, well, shed or
road coordinate must re-read it from the template, never re-type it.

## Ownership is emitted, not just authored

`structure_planned` now carries an `owner` field when the template assigns one. The engine
folds it into `Structure.owner`. The scripted fixture emits no `owner` key at all, so every
landed gate's event stream is byte-identical.

## C12a batch 2 (Phase N + the plaza regression) — what it hands on

Phase N is presentation only: no engine, arbiter, agent, narrator or forge file moved, and
`cityTemplate.ts` was not edited in this batch. Three things it found belong to other lanes.

### ART-17 — the built-form fallback is a bridge, and Task 17 is the road

`buildingArt()` now reports `url: null` for a kind with no codex record, and the renderer
draws a palette-true volume instead of the forge's checkerboard (controller ruling R1). This
is generic over kind, so it will quietly absorb every future structure the art lane has not
reached. **C12b Phase D Task 17 still owns the real sprites for well, bridge, fire pit,
grave, wagon and standing stone.** When they land, the fallback disappears for those kinds
with no code change — the volume is destroyed the moment a record resolves.

Task 17 also inherits one line from Phase N: **every enterable kind's art needs a doorway on
its south frontage.** The viewer draws a sill on the door tile rather than a plate on the
wall precisely because it cannot know where the art's own doorway is. A `door` field on the
v4 building manifest would let the viewer defer to the art; it is deliberately NOT added
here, because no art declares one yet.

### TOWN-PLAN — the fire pit is standing behind the workshop

Template `FIRE_PIT_AT (dx 17, dy 16)` is diagonally adjacent to shed A, the workshop, at
`(dx 18, dy 17)`. The shed is one tile south-east, so it is correctly drawn IN FRONT, and its
1.85× sprite covers the whole tile behind it. A fire pit is 0.4 tiles tall. The result, seen
live: the town's second monument is invisible at every zoom, and only its landmark label
shows where it is.

This is a plan question, not a rendering one — the depth sort is right and the art is the
right size. Whoever next owns the template should move the workshop off the fire pit's
north-west diagonal, or move the fire pit onto the plaza's own centre line clear of it.

### DEPTH — the overlap rank is a presentation rule with a physical claim in it

`depth.ts` says a body standing on a structure's own ground is drawn IN FRONT of it, never
inside it. That is true because a body that is genuinely indoors leaves the town map
(`rendersOnMap`) and is drawn by the interior sub-scene. **If C8 ever lets an agent occupy a
structure's tile while remaining on the town map** — a roofless pen, a scaffold a builder
climbs — that rule needs revisiting, and the counted depth fallback is where it will show up.


---

## C12a BATCH 3 — what Phases M and O hand on

### ART — the C13 furniture library is drawn at half the scale of the people

The interior room is a 3x3 grid of 2x2-tile slots; the library draws furniture at
`spritePx` 16-24, and a body draws at `CHAR_TARGET_PX = 52`. Live, a sleeping founder was
THREE TIMES the length of the bed he was lying in, and three 24 px objects rattled around a
192 px floor. `interiors.furnishingScale` takes the one integer factor that keeps the biggest
library sprite inside a slot — 2 today — which brings a bed to 48 px against a 52 px figure.

That closes the gross mismatch, but it is a viewer-side correction to an ART decision. A
sleeper still overhangs the bed's foot slightly, and 2x nearest-neighbour inside a 3x room
zoom is 6x effective — chunkier than the smoothly downscaled hi-res characters beside it.
**Whoever next owns the library should consider drawing bed, table, bench and loom at the
size a 52 px person actually uses**, at which point `furnishingScale` returns 1 and this
correction disappears with no call-site change.

### ART — `interior-floor` has no material in any root

`interiorScene` resolves `resolveMaterial(records, 'interior-floor')` and hot-swaps the floor
to a continuous material the moment one exists, exactly as the outdoor ground does. No root
supplies one, so the floor ships as a palette-true plane with board seams. The path is wired
and, like the farmland half of U7, unexercised until the art lands.

### WORLD — nothing is ever stored in a structure, so a room's holdings are untested live

`roomCard.holds` lists items whose `loc` is `{t:'structure', id}`, merged by kind and capped
at eight with an honest count of the rest. The dev world at day 4 holds **zero items in any
structure** — `state.items` is empty — so the holdings grid is proven by unit test and has
never been seen. It becomes real the first time a founder puts grain in the storehouse.

### WORLD — the dev town's provenance reads "Raised by script"

`/api/structure/:id/provenance` returns `builderId: 'script'` for every showcase building,
because the founders fixture raises them. The room card names the builder faithfully, so it
says "Raised by script, Day 0". The card is right; the fixture's builder id is the thing that
reads oddly to a viewer. Worth a real name — or a genesis builder — whenever the founders
fixture is next opened.

### CAMERA — a clamped rectangle around a diamond world still shows the corners

`clampCamera` keeps the world's BOUNDING BOX covering the viewport. The map is a diamond
inside that box, so at the box's own edge a viewer sees a dark wedge outside the map. That is
the world's shape, not a runaway camera: the town can no longer be pushed off screen, and
three full-width drags now stop at the corner with the town still in view. If a later map is
non-square or the world grows, this is the rule to revisit.

### CONVENTION — two files whose names differ only in case cannot both exist

macOS resolves paths case-insensitively, so a plan that names `controlBar.ts` (the model),
`ControlBar.tsx` (the component) and `ControlBar.test.ts` (its test) specifies a trio that
cannot coexist: the test overwrote the model's test, and the component's import resolved to
the model. Later phases naming a `foo.ts` / `Foo.tsx` pair should give the tests distinct
stems, as `controlBar.test.ts` / `controlBarView.test.ts` now do.

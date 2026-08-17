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

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

Filled in by Task 61's own commit, with the before/after coordinate table. Genesis lays a
different-shaped town after it; any C8 fixture that pins a hut, well or shed coordinate must
re-read it from the template rather than re-type it.

## Ownership is emitted, not just authored

`structure_planned` now carries an `owner` field when the template assigns one. The engine
folds it into `Structure.owner`. The scripted fixture emits no `owner` key at all, so every
landed gate's event stream is byte-identical.

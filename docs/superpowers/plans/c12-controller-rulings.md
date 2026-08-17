# CONTROLLER RULINGS — C12 re-plan (2026-08-17)

Draft ACCEPTED as the basis: cleanup/2026-08-17-12-deep-presentation-v2.DRAFT.md, 94
tasks (58 carried with numbers UNCHANGED so every prior ruling still cites correctly,
36 new), full U-id coverage table, 7 unimplementables each given the nearest true thing.

## THE FINDING — "it looks like chaos" was literally true

**The 11-building city template is instantiated NOWHERE.** `makeShowcaseMap().structures`
is read by no running code — only by tests. What renders is `founders.ts:30-37`
`TOWN_STRUCTURES`: **six** hand-placed fixtures. And under `SJ_DEV_MAP=showcase` only the
TERRAIN swaps, anchored at {x:0,y:9}, while buildings sit at fixture coordinates — **the
roads and the buildings are from two different towns.** The user was judging an overlay
of two unrelated maps. No amount of art would have fixed that.

**U25 root-caused in the same file:** `FOUNDERS_HOME_ID = 'structure_cottage'` and
`homeIntent()` never reads `agentId`. Everyone sleeps in one house because the fixture
routes every founder to one door. Not bed selection, not missing beds.

Three more source-verified defects that justify the scope: the depth sort has **three
independent faults** including an exact tie (a body at (20,22) and a 2×2 hut both compute
42021), a rounded depth against an unrounded position, and a footprint treated as a
scalar — so U8 is a topological rewrite, not a patch. The wheel handler takes **one
integer zoom step per event** with no accumulation, gate, or animation. `bonds.ts:61`
labels **any two people who ever spoke** `friend`, with `strength = history.length`
unsigned.

## R1 — THE SCHEDULING CALL (their Q7): SPLIT C12. Ship the review lane NOW.

Phases L–R depend on NOTHING from C11, close the entire user review, and end at a real
gate. Therefore:
- **C12a "The Review"** = Phases L–R, tasks 59–94, gate **G12c**. Executes IMMEDIATELY,
  in parallel with C11's close, off main.
- **C12b "Broadcast & Features"** = carried tasks 1–58 (Phases A–K + J), gates G12a/G12b.
  Executes after C11 merges.
This is the highest-value scheduling decision available: the user sees a repaired town in
days instead of after 94 tasks, and it is exactly the fan-out they asked for.

## R2 — town plan ownership (their Q1)

**C12a OWNS THE TOWN'S PLAN** and may edit `cityTemplate.ts`. A town that reads as a
designed place is a presentation deliverable. CONDITIONS: genesis tests stay green; any
coordinate or semantic change is ledgered for C8; and the template must actually be
INSTANTIATED by the dev world — closing U3 means the viewer renders the real town, not a
stub.

## R3 — the dev fixture is editable data (their Q9): YES

Refusing this would ledger all of U25 to the engine and leave the user looking at a
broken town for another chunk. Edit it, and mirror the ownership half to C8 per batch-10
ruling R-E ("structure ownership half landed, legal not witnessed").

## R4 — personality display (their Q11)

Under the neutral-start ruling the DEFAULT arm has no authored personality, so **Task 83
renders personality ONLY from run-produced evidence.** If the runtime seeds a personality
from an authored prompt, the panel SUPPRESSES it in the default arm and labels it
scenario content in the `authored` arm. No panel ever presents authored text as though
the person became it.

## R5 — faces under neutral start (their Q12): ACCEPT (b)

Deterministic palette-swapped bust per agent via the landed `swapColors` rig — no model
call, no cost. **Derive the palette from the SAME seed as the genetic temperament**, so
appearance and disposition come from one genome. Real portraits stay a v1.x item; a
shared bust for everyone would have been mode collapse visible in the UI.

## R6 — zoom and doors (their Q2/Q3): BOTH RATIFIED

**P18** five zoom stops including 0.5 with damped transit — correct for pixel art, and it
fixes U19's accidental over-zoom. **P9d REPEALED**: the door becomes a CHILD of its
building sprite, which kills the depth-sort tie and the door hit-target defect in one
move, and retires the DOOR_Z_OVER_BUILDING special case.

## R7 — remaining questions

- **Q4 relationship wording:** the BONDS PANEL uses the user's plain vocabulary
  (strangers / acquaintances / friends / hatred; romantic incl. spouse, sibling,
  parent-child) because they asked for it by name. The CHRONICLE keeps C10's
  observational register ("kept house") — the narrator describes, it never asserts an
  inner state. Two surfaces, two registers, both correct.
- **Q5 Moments composition:** the rail goes INSIDE or BELOW the letterbox, never over it.
  A letterbox is a frame; nothing overlaps a frame.
- **Q6 "Between things"** for awake-with-nothing-to-do: ACCEPTED — honest and evocative,
  and it names the state the society lane is trying to fill.
- **Q10 the five emergence-feel constants** that decide when two people read as "Friends"
  are DISPLAY thresholds, not physics. Keep them in the viewer as named constants and
  TUNE THEM AGAINST A REAL RUN before G12c — never guessed.
- All 7 unimplementables and their substitutes ACCEPTED, including the measured capsule
  with `hitTightness ≤ 1.35` for U9 and the deterministic detected fallback for
  pinwheel depth cycles, counted at the gate.

## R8 — G12c gate law

G12c does not pass with any U-id unaddressed, any open BLOCKER or MAJOR, or any depth
fallback count above its stated budget. The gate cites the before/after evidence table.

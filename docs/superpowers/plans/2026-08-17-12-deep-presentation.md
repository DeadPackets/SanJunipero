# Deep Presentation (C12) Implementation Plan — **v2**, re-planned against the user review

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** DRAFT v2. Not ratified, not committed to `docs/superpowers/plans/`. Written on branch
`c12-replan` off local `main` @ **`5e33a7c`** — the landed viewer *including* the `ui-blockers`
round (DPR fix, world-text floors, timeline labels, chrome type floors, `--ink-quiet`, the
Chronicle badge fix). **C11 IS NOT MERGED INTO MAIN** — verified in source at `5e33a7c`:
`packages/engine/src/state.ts:4` still reads `TileId = 0|1|2|3|4|5|6|7`, and `chunkOf`,
`chunksTouched`, `world_grown`, `fertilityAt` and `dayPhaseFromTick` do not exist. C11 lives on
`c11-work` (`a251c9a`), G11a green / G11b red, no `gate-g11` tag. Ruling 1 of the v1 review
stands: **C12 execution begins after `c11-work` merges.**

**Goal:** Close the 2026-08-17 user review. Make the town read as a designed *place*, make bodies
sort and click correctly against it, make the camera obey the hand on it, make every panel say
something a viewer can use at a glance, and give the whole thing the transitions and finish that
separate a demo from a product — then build the C12 feature layer on that foundation.

**Architecture:** Unchanged from v1 and still binding. Everything here is a **reader**, in three
planes that no task crosses: (1) the *renderer* — Pixi layers, pure mapping functions from world
state to pixels, viewer-side RNG only; (2) the *gateway* — read-only endpoints over the world DB,
the mirror and `narrator.db`, plain SELECTs; (3) the *ops plane* — narrator detectors that write
narrator tables and nothing else. **One exception is introduced by this re-plan and named
explicitly: `packages/gateway/src/founders.ts` and `packages/gateway/src/devWorld.ts` are DEV
FIXTURE DATA, not world law, and Tasks 59–60 edit them** (see Global Constraint P20).

**Tech Stack:** TypeScript ESM, Node 24, pnpm workspaces, Vitest (node environment — **no jsdom**),
Pixi v8, React 19, Zod 4, better-sqlite3 v13, `sharp` via `@sj/forge` (server-side only),
OpenRouter image + `google/gemini-3.7-flash` vision (Phase D only).

**Spec (binding), in precedence order:**
1. `cleanup/user-review-2026-08-17.md` — **U1–U25. Lanes 2–7 (U3–U25) are this plan's spine.**
   Lane 1 (U1, U2) belongs to the SOCIETY DESIGN lane and is not planned here; this plan's panels
   are shaped to *express* what that lane will produce (see §"What the society lane owes us").
2. `cleanup/c12-ui-pass-amendment.md` — Phase K, Tasks 53–58, already ratified as binding.
3. `cleanup/2026-08-17-12-deep-presentation.DRAFT.md` — the v1 plan, Tasks 1–52, **plus its
   CONTROLLER PLAN REVIEW RULINGS, which remain binding except where §"Amendments to Tasks 1–58"
   below names a change.**
4. `docs/superpowers/specs/2026-08-16-deep-presentation-addendum.md` §1–§29.
5. `cleanup/ui-audit-report.md` (35 measured defects), `cleanup/ui-blockers-report.md` (what
   already landed and what it deliberately left).

---

## §0 — WHAT CHANGED FROM v1, AND WHY

The v1 plan is 52 tasks of *feature*, plus a 6-task UI pass bolted on at the end. The user's verdict
was that the frontend is "really, really, really lackluster" against a AAA bar. Reading the review
against the landed source produced one structural conclusion:

> **The review's items are not polish on top of C12's features. They are the foundation those
> features stand on.** A character dock (Task 31) built on a depth sort that puts people behind
> buildings is a prettier version of the same defect. A minimap (Task 9) of a town that is not a
> designed place is a small picture of chaos. A clip exporter (Task 34) records the camera the
> user cannot control.

So v2 makes three structural changes:

**1. The review lanes execute FIRST.** New Phases L–Q (Tasks 59–92) run before the v1 feature
phases. The v1 execution order becomes: **L → M → N → O → P → Q → A → B → C → D → E → F → G → H →
I → K → J/R.** The full order table is §"Execution order" below.

**2. Task numbers 1–58 do not move.** Every controller ruling, every carry-item placement and every
gate line in v1 and in the Phase K amendment cites tasks by number. New tasks are numbered **59+**,
exactly as the Phase K amendment numbered itself 53+ and for the same reason. Where the review
changes a v1 task, it is listed by number in §"Amendments to Tasks 1–58" and the change is stated
there, not by silently rewriting the task.

**3. The gate pair becomes a triple.** G12a (automated) and G12b (human-evidenced) stay. **G12c is
new: the review gate.** It fails if any U-id cannot be demonstrated on a live world. Task 93.

---

## §1 — LANDED-REALITY FINDINGS (verified in source at `5e33a7c`, not inferred)

These five findings are the evidence the new phases are built on. Each is a file and a line, read on
this branch. **A controller reading nothing else should read this section.**

### F-1 (answers U3's "verify WHICH map"): the dev viewer renders NEITHER template. It renders a 6-structure hand-placed stub, on either map.

- `packages/gateway/src/devWorld.ts:40` — `export const DEV_MAP_DEFAULT: DevMapKind = 'scripted'`.
  The **default** dev world uses `makeFixtureMap()` (`packages/engine/src/scripted.ts:40-52`), which
  is a bare 64-wide field: `x <= 3` river, `x >= 61` forest, **grass everywhere else**. No plaza, no
  roads, no paths, no bank. Nothing about it is a town.
- `SJ_DEV_MAP=showcase` swaps only the **terrain**: `devWorld.ts:43` calls `showcaseTerrain()`,
  which is `makeShowcaseMap(anchor).terrain` — the tiles only.
- **`makeShowcaseMap().structures` is never read outside tests.** Verified by grep across
  `packages/`: the only non-test references to `makeShowcaseMap` are in `showcaseMap.test.ts` and
  `g10.test.ts`. The city template's **eleven** buildings are rasterised nowhere into a running
  world.
- What actually renders as buildings is `packages/gateway/src/founders.ts:30-37`,
  `TOWN_STRUCTURES` — **six** structures, hand-placed at fixture-map coordinates:
  `storehouse (20,20)`, `shed (23,20)`, `hut "structure_cottage" (30,20)`, `wagon (26,25)`,
  `scaffolding (34,23)`, `standing_stone (15,28)`. **One hut.** That is the screenshot the user was
  looking at, to within a miscount.
- Worse on `SJ_DEV_MAP=showcase`: the template's tiles are anchored at `{x:0, y:9}`, putting its
  plaza around `(15..19, 21..25)` and its huts at `y=13` — while the six fixture structures stay at
  their fixture coordinates. **The buildings and the roads are from two different towns.**

> **PLAIN ANSWER TO U3'S QUESTION: yes, the stub is part of the problem, and it is a large part.**
> The user has never seen `makeCityTemplate`. Fixing "show the real town" (Task 59) is a necessary
> first move — and it is *not sufficient*, because the template itself has never been reviewed as a
> place by anyone (Tasks 61–62).

### F-2 (answers U25, root-caused): all five founders sleep in one house because the dev script sends them there by name.

`packages/gateway/src/founders.ts:40` — `export const FOUNDERS_HOME_ID = 'structure_cottage'`, and
`homeIntent()` at `:76-89` reads `state.structures[FOUNDERS_HOME_ID]` for **every** agent, with no
reference to `agentId`. There is exactly one hut in `TOWN_STRUCTURES`, and every tired founder is
routed to its door.

- It is **not** a bed-selection bug: nothing in the dev path selects a bed at all.
- It is **not** "the map lacks beds": `packages/shared/src/cityTemplate.ts:138-146` furnishes every
  hut with a bed, and `packages/web/src/render/interiors.ts` reads that furnishing set.
- The engine **does** model ownership: `packages/engine/src/state.ts:27` and `:34` carry
  `owner?: string` on structures and items, and `cityTemplate.ts:164-171` assigns one hut per
  founder. The dev fixture simply never sets it and never reads it.

**Split of ownership, as the brief asks:**
- **VIEWER/FIXTURE HALF — ours, Tasks 59 and 60.** Give the dev town five owned huts and make
  `homeIntent` walk a founder to the door of the hut whose `owner` is their own id. This is data and
  a three-line predicate in `packages/gateway/src`, and it is what the user will see fixed.
- **ENGINE HALF — NOT ours; ledgered.** A *mind* choosing its own roof is engine/agents work, and
  C11's own batch-10 controller ruling already books it: *"structure ownership half landed (legal,
  not witnessed) → C8 carry"* (`cleanup/c11-batch10-controller-rulings.md`, R-E). Task 60 step 5
  writes the U25 engine half into `c8-delta-from-c12.md` citing that ruling, and **does not fake it
  in the viewer.**

### F-3 (answers U8): the depth sort is wrong three separate ways, and no patch fixes all three.

`packages/web/src/render/iso.ts:16-18` — `depthKey(x, y) = (x + y) * 1000 + x`.

| # | Defect | Evidence | Reproduction |
|---|---|---|---|
| a | **A multi-tile building is one scalar; a footprint is a range.** `entities.ts:40-42` gives a structure `depthKey(x+w-1, y+h-1)` — its nearest corner. A 2×2 hut at (20,20) is `42021`. | `characters.ts:280` gives a body `depthKey(round(x), round(y)) + 1`. | A character at **(19,22)** — south-west of the hut, visibly in front of it — computes `41020` and is drawn **behind** the hut's sprite. |
| b | **The `+x` tiebreak decides ties by x, not by kind.** | same lines | A character at **(20,22)** computes exactly `42021` — an *exact tie* with the hut. Pixi's sort is stable, so the winner is child-insertion order: a coin flip that the viewer sees as flicker. |
| c | **A body's depth is rounded while its position is not.** `characters.ts:278-280` positions from the interpolated `pos` and sorts from `Math.round(pos.x/y)`. | same | Mid-glide, a walker's depth snaps a whole row before its sprite gets there — the pop the user reads as "walking behind things". |

Compounding all three: building sprites are **~1.85× wider than their own ground diamond** by house
law (P9a), so they visually overhang tiles they do not occupy. **No scalar depth key can be correct
for an overhanging sprite against a point entity.** U8's "full review, not a patch" is the right
call and the fix is a real topological order (Task 70), not a tweak to `depthKey`.

Two more layering faults in the same container: `scene.ts:166-168` makes **one** flat
`sortableChildren` container hold shadows, bodies, buildings, doors, items, crops, emotes, name tags
and speech bubbles, competing for the same integer space — bubbles claim `1e9`
(`bubbles.ts:124`), tags `1e9 - 1` (`nameTags.ts:13`), emotes and per-body tags take
`sprite.zIndex + 1`, which is *the next depth row's* number. And `entities.ts:46-48` sorts a door at
`structureZIndex(s) + 1`, i.e. **above its own building**, so a body standing in the doorway is
painted over by a dark rectangle.

### F-4 (answers U11 + U19 + U9): three concrete shapes behind three complaints.

- **U11, the "dark rectangular artifacts":** `entities.ts:244-250`. The door is a `Graphics`
  `roundRect(-5, -13, 10, 13, 3)` filled `DOOR_FILL = 0x43394a` (ink) at `alpha 0.5`. It is
  literally a dark rounded rectangle, drawn above its building, at **10 × 13 world px** — under the
  24 px pointer minimum (audit M5) and under a character's 52 × 72 click box.
- **U9, "the borders of the characters aren't accurate":** `charAnim.ts:18-24`. `HIT_AREA_W = 52`,
  `HIT_AREA_H = 72`, a **rectangle** with feet at (0,0) rising 72 px. It is wider than the figure at
  every pose, 72 px tall over a ~52 px sprite, and it swallows the whole column above the head.
- **U19, "I zoom way too much by accident":** `scene.ts:263-268`. `onWheel` takes **one integer zoom
  step per wheel event** — `cur + (deltaY < 0 ? 1 : -1)` — with no delta accumulation, no time gate
  and no animation. A trackpad emits dozens of wheel events per flick, so one gesture walks
  `ZOOM_MIN → ZOOM_MAX` instantly. `setZoom` also anchors on the **screen centre**
  (`scene.ts:215-222`), not the pointer, so zoom does not go where the viewer is looking. And
  nothing clamps the camera: `panBy` and the drag handler at `:238-249` add pixels without bound, so
  the town can be pushed entirely off screen.

### F-5 (answers U13 and U15): the exact synonym, and why "Friends" is meaningless.

- **U13's synonym pair is one line.** `packages/web/src/ui/rosterModel.ts:32`:
  `doing: a.activity !== null ? gerund(a.activity.verb) : 'resting'`. A sleeping founder has
  `asleep === true` **and** `activity === null`, so `RosterPanel.tsx:47-48` renders the badge
  `asleep` and the badge `resting` **side by side on the same card**. Three more "rest" words are in
  play: `InspectorPanel.tsx:155` `'at rest forever'`, `:187` `'resting'`, and the roster footer
  `'rest in the town's memory'`.
- **U15's "weird tags" are structural, not cosmetic.** `packages/shared/src/bonds.ts:3` —
  `BOND_KINDS = ['partner','kin','friend','rival','owe','work']`, **one kind per pair**, collapsed
  by `BOND_KIND_PRECEDENCE` at `:39`. So:
  - `friend` is assigned by `gateway/src/bonds.ts:61` to **any two agents who spoke within earshot
    once**. Every pair who has ever exchanged a word is "Friends". There is no level.
  - `strength` is `d.history.length` (`bonds.ts:85`) — a raw interaction *count*, unsigned. Two
    people who came to blows forty times have "strength 40".
  - `kin` (`:78`) collapses **parent–child and sibling into one word**, and there is no sibling
    detection at all.
  - `partner` (`:75`) is `co_slept` — the romantic/spouse axis exists but is labelled "Kept house"
    (`bondsModel.ts:16`).
  - **"Strangers" cannot be expressed**: a pair with no interaction simply has no row, and
    `toBondGraph` builds its node list from bond endpoints (`bondsModel.ts:54`), so an unconnected
    person is not even drawn.

  U15 therefore needs a **two-axis model** — structural TYPE × valenced LEVEL — computed over the
  history the endpoint already returns. Tasks 83–84.

---

## §2 — WHAT THE SOCIETY LANE OWES US (U1/U2 — read, not planned here)

Lane 1 is the other lane's. This plan does not touch it. But the review's controller analysis names
five mechanisms that lane is expected to produce, and **the panels in Phase P are built so each one
has somewhere to land the day it exists.** Stated as a contract, so neither lane has to guess:

| Society-lane mechanism (U2 analysis) | Where this plan already puts it |
|---|---|
| Per-person attachment replacing the `social` scalar | Task 83's `bondWarmth` reads `history`; a per-person affinity field, when it exists, becomes an additional term with **no shape change** (`BondWarmthInput.affinity?: number`). |
| Drives that activate when survival is satisfied (boredom, curiosity, status, legacy) | Task 79's `Drive` chip class is defined and rendered now, with an **empty** drive set; a drive named by the engine renders as a chip with no viewer change. |
| Social consequence — shunning, debts that bite, refusal | Task 83's `BOND_VALENCE` table already carries the negative half, and Task 84's level ladder already renders `strained` and `hatred`. |
| `constructs.minParticipants` — things that require two people | v1 Task 24 (Constructs panel) unchanged; Task 81's roster row shows *who a person is with*, so a joint act is visible on the roster the moment one happens. |
| 20 % of acts are walking | Task 76's overview stop and Task 80's `placeOf` make distance legible; Task 62's landmarks make it *designed*. |
| **NEUTRAL START (controller ruling, second user mandate)** — genesis is name + age + a rolled genetic temperament; personality and background are produced by play. Authored founders become a named second arm. | **P22**, and Phase P is scoped to it: Task 83 (`substanceOf`/`becomingOf` + the authored-field ban), Task 82 (the expanded view as a run-produced biography), Tasks 84–85 (bonds as the primary evidence of emergent society, shown as growth), Task 86 (marks favour moments where somebody *changed*). |
| A rolled genetic temperament that differs per agent | Task 83's `Temperament` is read as an **optional** field and rendered as a small set of inherited-leaning chips clearly marked as what a person was *born* with, never as achievement. Absent today ⇒ the chips simply do not render, and `substanceOf` does not count them. |

**Nothing in Phase P renders a placeholder for a mechanism that does not exist.** Each hook above
is an optional input that is absent today and simply never matches — the same discipline v1 used for
C11's optional fields.

---

## Global Constraints

Every task's requirements implicitly include this section. **P1–P14 are carried from v1 verbatim in
force**; only the ones this re-plan changes are restated. P15–P21 are new.

- **P1. Read-only by construction.** Zero writes to `events` or any world table; zero engine RNG;
  **no task may modify a file under `packages/engine/src`, `packages/arbiter/` or
  `packages/agents/src`** (excepting `packages/agents/src/live/*` gate scripts). Goldens
  **G1 `f487a26b`** and **G2 `6f2529fb`** must be byte-identical at every commit; C11's pins
  (`GOLDEN_G2_HASH 665a8249…`, forge `stateHash 482f1203…`, `BLOCK1_SHA256 28c1fce0…`) join them
  once C11 merges. A task that moves any of them **STOPS and reports**.
- **P2. UI QUALITY MANDATE (verbatim, user directive 2026-08-16, applies to every task):** *"The UI
  is what the entire project leans on. It doesn't matter how amazing our AI backend is if our
  frontend looks bad."* Any agent doing SJ frontend work must invoke and follow `ui-ux-pro-max`,
  `frontend-design`, `vercel-react-best-practices`, `make-interfaces-feel-better`. Bar: "feels like
  a AAA studio designed it". **Write a design-token plan before implementing** (surface, colour,
  type, space, motion, state — committed into the `chrome.css` header, C10 precedent). Design
  language: pixel-art-native UI, palette from the town art, bitmap-feel headings + readable body;
  `image-rendering: pixelated` only for world art. Motion 150–300 ms, `prefers-reduced-motion`
  honoured. Accessibility non-negotiable: keyboard nav, visible focus, WCAG AA, aria labels.
- **P3. Living-documentary law.** No points, quests, leaderboards, meters, streaks, achievements,
  scores. `GAMIFICATION_BAN` (`progress|score|level|quest|points|badge|streak|rank|xp`) plus the
  machinery-vocabulary regex is asserted over **every** new string. No AI/tool/prompt vocabulary
  anywhere viewer-facing.
  **v2 note:** the bond LEVEL ladder of Task 83 is a *ladder of words for a relationship*, not a
  score. It is asserted against `GAMIFICATION_BAN` like everything else, it never renders a number,
  and it can go **down**.
- **P4. Presentation flags are viewer settings, never world law.** Exported config const + a
  Settings-panel flag persisted per-viewer (localStorage). Nothing here enters `config_changed`.
- **P5. Viewer-side randomness only**, and only where nothing in the world depends on it.
- **P6. Node test environment — there is no jsdom.** `vitest.config.ts` includes
  `packages/*/src/**/*.test.ts` and sets no environment. Consequence: **logic goes in pure
  functions**; React surfaces are covered through `react-dom/server` with `createElement` (never JSX
  in a test — D-13 precedent); anything touching `document`, `matchMedia`, `navigator` or Pixi is a
  thin adapter with no logic in it.
- **P7. The browser graph is pinned.** `packages/web/src/browserGraph.test.ts` asserts the complete
  set of externals against `BROWSER_SAFE_IMPORTS`. **No new npm dependency may enter `@sj/web`.**
  `@sj/engine` only through subpaths (`/state`, `/fold`, `/laws`).
- **P8. The narrator read law (D-20).** The gateway reads `narrator.db` through plain readonly
  SELECTs and **never imports `@sj/narrator`**. Every new table/column joins `NARRATOR_READ_TABLES`
  and the drift test. A narrator DB predating a table answers `[]`, never a 500.
- **P9. Renderer conventions are house law — AMENDED BY P16 AND P18.** (a) Building sprites anchor
  at the **base diamond** and overflow upward/sideways by design (~1.85×): no camera, minimap, PiP
  or clip framing may "correct" it. (b) A structure's `hitArea` is its **footprint diamond**,
  re-cut whenever the sprite scale moves. (c) Roads are a ribbon **over** a ground base, never
  instead of it. (d) ~~Doors sort at `structureZIndex(s) + 1`~~ — **REPEALED by P16 and Task 73**:
  a door is a **child of its building sprite**, so it inherits its parent's depth and cannot be
  sorted against it. (e) ~~Integer camera scale only, `ZOOM_MIN 1 … ZOOM_MAX 4`~~ — **AMENDED by
  P18.**
- **P10. The tone director stills the renderer.** Every new emitter, animator, audio voice and PiP
  window registers with the tone director and is suppressed under grave tone
  (`toneReducer`/`isGrave`, `GRAVE_HOLD_TICKS = 60`). The chronicle ticker is the single named
  exception (§25). **v2 addition:** every transition introduced in Phase Q also registers, and grave
  tone selects its `quiet` variant rather than skipping the transition.
- **P11. Art law (Phase D).** Everything user-visible is **generated** through C13's vision gate —
  never code-painted. A measurement may **veto, never rescue**; the seam metric is edge-strip tone
  (`SEAM_TOLERANCE = 14`); vision-QA thresholds are read **per-criterion over the population**;
  repair rounds always start from the **ORIGINAL raw**.
  **v2 clarification, and it is load-bearing for Phases L and M:** *code-painted* means a
  **finished, user-visible surface** painted in `Graphics` calls. It does **not** ban geometry,
  masks, silhouettes or lighting maths that a generated material fills — that is exactly what
  `groundField.ts` already does and what the controller accepted. Tasks 63–67 add **shapes and
  shading that generated materials fill**; every finished pixel of colour still comes from
  generated art or a MASTER_PALETTE token.
- **P12. Naming law.** Viewer copy never presents a taxonomy word as the town's own coinage without
  provenance. `name: null` renders exactly `a gathering not yet named`; a named construct renders
  its provenance quote **verbatim**.
- **P13. Cost.** No per-task budget cap (standing user directive). **Spend reporting is mandatory** —
  per-asset and per-run ledger rows, printed in the batch report. The `$5/asset` anomaly stop stays.
  **Never read `.env` or `OPENROUTER_API_KEY`**; live scripts are invoked with the env file by the
  runner.
- **P14. Every hover has a touch twin.** Each hover affordance registers in the affordance registry
  (Task 46) with its long-press equivalent; G12a asserts the registry is total. 44 px minimum on
  every interactive element.

### New in v2

- **P15. THE REVIEW IS THE SPINE.** Every task in Phases L–Q names the U-id it serves in its
  heading. A task with no U-id in Phases L–Q is a planning error. G12c (Task 93) walks the coverage
  table and **fails on any U-id that cannot be demonstrated live**. "Explicitly deferred" is only
  available with a user-visible reason written into the gate report, per the review's STANDING
  CONSEQUENCE.
- **P16. THE LAYER CONTRACT.** There is exactly **one** table that decides what is drawn over what,
  `packages/web/src/render/layers.ts`, and **no module outside it may write a literal `zIndex`.**
  Eight named layers (see Task 69). Depth sorting happens **inside one layer only** (`entities`),
  through `depthOrder` (Task 70) — never through an ad-hoc scalar. A decoration that belongs to an
  object is a **child of that object's sprite**, never a sibling with a nearby number. A CSS/TS scan
  test enforces it: no `\.zIndex\s*=` outside `layers.ts` and the two files it authorises.
- **P17. ONE STATUS VOCABULARY.** `packages/web/src/ui/status.ts` is the single source of every word
  the chrome uses for what a person is doing or how they are. Exactly **one STATE word** per person
  per surface (priority table, first match wins) plus zero or more **CONDITION chips** from a
  disjoint vocabulary. A scan test fails on any status literal appearing in `packages/web/src`
  outside `status.ts` — including the banned synonyms `resting`, `awake`, `idle`, `at rest`,
  `sleeping`.
- **P18. CAMERA LAW, amended (supersedes P9e).** Camera scale is **damped and continuous in
  transit, exact at rest**. Rest stops are `ZOOM_STOPS = [0.5, 1, 2, 3, 4]` — integers plus one
  reciprocal-of-integer overview stop, so NEAREST sampling is exact at every stop. Between stops the
  scale is interpolated over `ZOOM_SETTLE_MS = 180` and **lands exactly on the stop**; nothing reads
  a non-stop scale as a resting value. Zoom anchors on the **pointer** when there is one and on the
  screen centre otherwise. The camera is **bounded**: the world's bounding box may never leave the
  viewport (Task 76).
- **P19. NOTHING OVERLAPS THE PICTURE FRAME.** When the letterbox is engaged, `--letterbox-h`
  defines a *picture safe area*, and every piece of chrome is laid out **inside a grid row**, never
  absolutely positioned across it. A test asserts the computed geometry: no chrome element's box
  intersects a letterbox band. This is U16's "fix the composition, not just the z-index" as a
  mechanical rule.
- **P20. THE DEV FIXTURE IS DATA, AND WE MAY EDIT IT.** `packages/gateway/src/founders.ts` and
  `packages/gateway/src/devWorld.ts` are the **dev/showcase fixture**, not world law: they are
  loaded by `startDevWorld` only, they emit through the same public `emit` surface any script uses,
  and genesis does not read them. Tasks 59–60 edit them. **The guard is mechanical, not
  editorial:** every commit in Phases L–R re-runs `g6.test.ts`, `g10.test.ts`, `founders.test.ts`,
  `devWorld.test.ts` and the golden suite, and any pin movement STOPS the task (P1).
- **P21. EVERY NEW SURFACE SHIPS ITS THREE STATES.** Empty, loading and error, written for a **mature**
  world, not a cold start (audit M6). A surface merged without all three is incomplete, and Task 56
  no longer has to retrofit it.
- **P22. NO AUTHORED IDENTITY ON ANY SURFACE (controller ruling, 2026-08-17, second user mandate).**
  The **default experiment is a neutral start**: identity at genesis is roughly *name + age + a
  rolled genetic temperament*, and everything else — personality, background, skill, standing,
  wanting — is **produced by the run**. The five authored founders survive as a **named second
  arm**, not as the shape the UI assumes. Consequences, binding on every panel:
  1. **No surface may render an authored personality, background or trait field.** If a panel reads
     one today it is named and changed by Task 83.
  2. **Every person-facing surface must be honest and dignified on sim-day 0**, when a person is
     genuinely a blank — an empty state that says *this person has not lived yet*, never a
     placeholder pretending to content ("Their mind is quiet.", "Still learning everything." — the
     two literals the audit found at R3 — are exactly the failure).
  3. **Every person-facing surface must visibly gain substance by day 5** without a code change.
     A surface whose day-0 and day-5 renderings are indistinguishable is a defect, and Task 83's
     `substanceOf` is the measurement the gate reads.
  4. **Difference between people must come from run-produced state**, so the user can run the
     experiment repeatedly and see different towns. Any viewer-side derivation that would make two
     agents look alike regardless of what they did is a defect (this is what kills mode collapse
     *in the display*; the simulation half is the other lane's).
  5. **Change is the subject.** Where the data supports it, a surface shows *what moved* — a
     relationship that warmed, a skill that arrived, a day someone became different — not only a
     current value. Tasks 82, 85 and 86 own this.

---

## Execution order

Batches are ~5 tasks. The order is not negotiable between phases, because each phase is the
foundation of the next.

| # | Phase | Tasks | U-ids | Why here |
|---|---|---|---|---|
| 1 | **L — The town is a place** | 59–65 | U3, U5, U6, U7, U25 | Nothing else can be judged until the viewer is looking at the real town. Also closes the U25 bug, which is fixture data in the same two files. |
| 2 | **M — Interiors that look lived in** | 66–68 | U4 | Needs L's owned huts to have five rooms worth entering. |
| 3 | **N — Layering, hit testing, tooltips** | 69–74 | U8, U9, U10, U11 | Every later sprite, chip and tag sorts and clicks through this contract. |
| 4 | **O — Camera and controls** | 75–78 | U19, U20, U21, U22 | The control bar is where Phase P's panels are reached from. |
| 5 | **P — The panels** | 79–89 | U12, U13, U14, U15, U16, U17, U18 | Built on N's tooltips and O's bar. Re-scoped by P22: these panels reveal *emergent* identity, not authored identity. |
| 6 | **Q — Transitions and finish** | 90–93 | U23, U24 | Finish is applied to a finished surface, never before it. |
| 7 | A–C | 1–15 | — | v1 renderer foundations, big map, bodies in motion. |
| 8 | D | 16–21 | — | The art pool (the one spending lane). |
| 9 | E | 22–26 | — | Inspector + registries. Task 22 now consumes P17/P19/Task 82. |
| 10 | F–H | 27–45 | — | Broadcast, clips, arcs, study. |
| 11 | I | 46–50 | — | Phone + share. |
| 12 | K | 53–58 | — | The whole-surface UI pass, now sweeping *behind* the review work rather than substituting for it. |
| 13 | **J/R — the gates** | 51, 52, **94** | all | G12a automated, G12b human, **G12c the review gate**. |

**Deferral rule.** If a batch stalls on C11, the controller may re-sequence *within* a phase but not
across the L→Q boundary: Phases L–Q depend on **nothing from C11**, which is the point of putting
them first. Verified: no task in 59–92 consumes `TileId 8|9|10`, `chunkOf`, `world_grown`,
`fertilityAt`, `dayPhaseFromTick`, `FaunaKind` or `afflictions` as a *required* input.

---

## File structure (new files only; v1's table stands unchanged for Tasks 1–58)

| File | Responsibility |
|---|---|
| `packages/gateway/src/devTown.ts` | the dev town as **one** data source: terrain + structures + owners, derived from `makeCityTemplate` (Task 59) |
| `packages/web/src/render/layers.ts` | **P16** — the eight named layers and the only `zIndex` authority (Task 69) |
| `packages/web/src/render/depth.ts` | `DepthBox`, `inFrontOf`, `depthOrder` — the topological sort (Task 70) |
| `packages/web/src/render/hitShapes.ts` | `bodyHitPolygon`, `doorHitPolygon`, `HIT_PRIORITY` (Tasks 72–73) |
| `packages/web/src/render/tooltip.ts` | one anchored, collision-aware tag placer for map, door and interior (Task 74) |
| `packages/web/src/render/roomShell.ts` | interior walls, back plane, threshold and floor field (Task 66) |
| `packages/web/src/render/camera.ts` | `ZOOM_STOPS`, `zoomReducer`, `zoomScaleAt`, `cameraBoundsOf`, `clampCamera` (Tasks 75–76) |
| `packages/web/src/ui/ControlBar.tsx` + `controlBar.ts` | the bottom control bar and its pure model (Task 77) |
| `packages/web/src/ui/hudLayout.ts` + `HudDock.tsx` | move/hide/persist for every floating control (Task 78) |
| `packages/web/src/ui/status.ts` | **P17** — `STATE_WORD`, `CONDITION_WORD`, `statusOf`, `conditionsOf` (Task 79) |
| `packages/web/src/ui/place.ts` | `placeOf` — where a person is, in words (Task 80) |
| `packages/web/src/ui/roster/*` | `rosterRow.ts`, `RosterRow.tsx`, `RosterExpanded.tsx` (Tasks 81–82) |
| `packages/web/src/ui/becoming.ts` | **P22** — `substanceOf`, `becomingOf`, the authored-field ban scan (Task 83) |
| `packages/web/src/ui/bondModel2.ts` | `bondTypeOf`, `bondWarmth`, `bondLevel`, `bondArc`, `relationLine` (Task 84) |
| `packages/web/src/ui/timelineMarks.ts` | durable mark source for the scrubber, change-weighted (Task 86) |
| `packages/web/src/ui/lawCopy.ts` | the authored plain-English law dictionary (Task 87) |
| `packages/web/src/render/textFaces.ts` | Pixi BitmapFont installation for the pixel faces (Task 88) |
| `packages/web/src/ui/motion.ts` | **U23** — one transition vocabulary, durations, easings, reduced-motion (Task 90) |
| `packages/web/src/ui/g12c.test.ts` + `packages/web/src/render/g12c.test.ts` + `packages/gateway/src/g12c.test.ts` | GATE G12c, split by package for the D-41 reason (Task 94) |

---

# Phase L — THE TOWN IS A PLACE *(U3, U5, U6, U7, U25)*

The user is looking at a six-building stub on a blank field (F-1). This phase makes the viewer look
at the designed town, then makes that town worth looking at.

### Task 59: The town the viewer actually sees — one data source *(U3, and half of U25)*

**Files:**
- Create: `packages/gateway/src/devTown.ts`, `packages/gateway/src/devTown.test.ts`
- Modify: `packages/gateway/src/founders.ts`, `packages/gateway/src/founders.test.ts`,
  `packages/gateway/src/devWorld.ts`, `packages/gateway/src/devWorld.test.ts`

**THE LANDED-REALITY FINDING THIS TASK EXISTS FOR:** F-1. `makeShowcaseMap().structures` is read by
no running code. `SJ_DEV_MAP=showcase` lays the template's **tiles** and then places six
hand-authored buildings from a different town on top of them. The dev default (`'scripted'`) does
not even do that.

**Interfaces — Produces:**
```ts
export type DevStructure = {
  id: string; kind: string; x: number; y: number; w: number; h: number
  owner: string | null            // null = public; the template's own USER RULING 1 assignment
  flammable: boolean
}
export type DevTown = { terrain: TileId[][]; structures: DevStructure[]; anchor: { x: number; y: number } }

/** Deterministic, collision-free, and readable in a log. Two calls are byte-equal. */
export function devStructureId(kind: string, x: number, y: number): string   // `structure_${kind}_${x}_${y}`

/** The ONE derivation. Terrain and structures come from the SAME makeCityTemplate() call, so
 *  they can never again describe two different towns. */
export function devTown(anchor?: { x: number; y: number }): DevTown

/** 'scripted' keeps the frozen G6 fixture set byte-for-byte; 'showcase' serves the real town. */
export function townStructuresFor(map: DevMapKind): readonly DevStructure[]
```
- **Consumes:** `makeCityTemplate`, `CityStructure` (`@sj/shared`); `SHOWCASE_ANCHOR`,
  `makeShowcaseMap` (`./showcaseMap.js`).

**Implementation (the whole function — it is short and it is the point):**
```ts
export function devTown(anchor = SHOWCASE_ANCHOR): DevTown {
  const template = makeCityTemplate(anchor)
  const { terrain } = makeShowcaseMap(anchor)          // the SAME anchor, so tiles and walls agree
  const structures = template.structures.map((s: CityStructure): DevStructure => {
    const x = anchor.x + s.dx, y = anchor.y + s.dy
    return {
      id: devStructureId(s.kind, x, y),
      kind: s.kind, x, y, w: s.w, h: s.h,
      owner: s.owner,
      flammable: s.kind !== 'standing_stone' && s.kind !== 'well',
    }
  })
  return { terrain: terrain as TileId[][], structures, anchor }
}
```

- [ ] **Step 1: Write the failing tests** — `packages/gateway/src/devTown.test.ts`:
  - `devTown().structures` has **length 11**, and its kind multiset is exactly
    `{hut: 5, storehouse: 1, shed: 2, well: 1, fire_pit: 1, wagon: 1}` — driven from
    `cityStructures()` so a template edit fails here rather than drifting.
  - Exactly **five** structures have a non-null `owner`, they are all `kind: 'hut'`, and the owner
    set equals `new Set(FOUNDER_IDS)` — one hut each, nobody twice.
  - Every structure's tiles lie inside `0..SHOWCASE_W-1 × 0..SHOWCASE_H-1`.
  - **No structure stands on a road or water tile**: for every `s`, every tile of
    `showcaseStructureTiles` reads `GRASS_TILE` or `EARTH` in `devTown().terrain`. (This is the
    assertion that would have caught the two-towns bug.)
  - `devStructureId` is injective over the 11 structures, and `devTown()` deep-equals `devTown()`.
  - `townStructuresFor('scripted')` is **byte-identical to the frozen `TOWN_STRUCTURES` array**
    (a literal snapshot in the test, so the G6/G10 fixture cannot move by accident).
  - `townStructuresFor('showcase')` equals `devTown().structures`.
- [ ] **Step 2:** Run `pnpm vitest run packages/gateway/src/devTown.test.ts` — FAIL.
- [ ] **Step 3: Implement.** `founders.ts` gains `townStructuresFor` and `makeFoundersOnTick` takes
  a new option `{ structures: readonly DevStructure[] }` (defaulting to `TOWN_STRUCTURES`, so every
  existing caller and every existing test is unchanged). The `tick === 1` block emits
  `structure_planned` with the extra `owner` field when it is non-null, then `structure_completed`.
  `devWorld.ts` passes `townStructuresFor(map)`.
- [ ] **Step 4: Verify.** `pnpm vitest run packages/gateway` PASS; **`g6.test.ts`, `g10.test.ts`,
  `founders.test.ts`, `devWorld.test.ts` and the golden suite green UNMODIFIED** — they are the
  proof the scripted fixture did not move (P20). `pnpm typecheck` 0. Boot
  `SJ_DEV_MAP=showcase pnpm dev:world` and record the printed structure count: it must say **11**.
- [ ] **Step 5: Commit** `fix(gateway): the dev town is one town — eleven buildings on the roads that serve them`.

### Task 60: Five owned huts, and a founder who walks to their own door *(U25)*

**Files:** Modify `packages/gateway/src/founders.ts`, `founders.test.ts`; Create
`docs/superpowers/plans/c8-delta-from-c12.md` (the ledger entry; Task 52 appends to it later).

**THE BUG, ROOT-CAUSED:** F-2. `FOUNDERS_HOME_ID = 'structure_cottage'` is a constant, and
`homeIntent(state, agentId)` never reads `agentId` when choosing a building. Every tired founder
walks to the same door because the fixture told them to.

**Interfaces — Produces:**
```ts
/** The hut this person owns, or null. Ownership is a fact of the world (Structure.owner,
 *  engine/state.ts:27) — this reads it, it does not invent it. */
export function homeOf(state: WorldState, agentId: string): Structure | null

/** REPLACES the FOUNDERS_HOME_ID lookup. Same signature, same return shape, so every caller
 *  and every existing test is unchanged. */
export function homeIntent(state: WorldState, agentId: string): { verb: string; params: Record<string, unknown> } | null

/** Showcase spawns: each founder starts at their own door, so the first frame reads as a town
 *  of five households rather than five strangers on a lawn. */
export function foundersFor(structures: readonly DevStructure[]): readonly FounderDef[]
```
- **Consumes:** Task 59 `DevStructure`, `devTown`; `Structure.owner` (`@sj/engine/state`).

**Implementation:**
```ts
export function homeOf(state: WorldState, agentId: string): Structure | null {
  for (const s of Object.values(state.structures)) {
    if (s.owner === agentId && s.stage === 'complete') return s
  }
  return null
}

export function homeIntent(state: WorldState, agentId: string) {
  const a = state.agents[agentId]
  if (a === undefined) return null
  if (a.insideId !== undefined) {
    return a.needs.energy > LEAVE_HOME_ABOVE ? { verb: 'exit', params: {} } : { verb: 'sleep', params: {} }
  }
  if (a.needs.energy >= GO_HOME_BELOW) return null
  // An unhoused person keeps the landed behaviour and heads for the shared roof; an owner
  // goes to their own. Nobody is left with nowhere to sleep.
  const home = homeOf(state, agentId) ?? state.structures[FOUNDERS_HOME_ID] ?? null
  const door = home === null ? null : doorTile(state, home)
  if (door === null) return null
  return Math.abs(a.x - door.x) <= 1 && Math.abs(a.y - door.y) <= 1
    ? { verb: 'enter', params: { structureId: home!.id } }
    : { verb: 'walk', params: { x: door.x, y: door.y } }
}
```

- [ ] **Step 1: Write the failing tests** —
  - `homeOf` on a fixture with five owned huts returns **a different structure id for each of the
    five founders**, and `null` for an unowned agent.
  - `homeOf` ignores a hut still under construction (`stage !== 'complete'`).
  - **THE U25 REGRESSION TEST, stated as the user stated it:** step a scripted world of five
    founders and five owned huts until every founder has `insideId !== undefined`; assert
    `new Set(founders.map(f => state.agents[f].insideId)).size === 5`. On today's code this fails
    with size 1.
  - `homeIntent` for an owner one tile from **their own** door returns `enter` with **their own**
    `structureId`, and from four tiles away returns `walk` to their own door.
  - An agent who owns nothing still returns the shared-roof intent (no regression for the scripted
    fixture, whose huts have no owners).
  - `foundersFor(devTown().structures)` gives each founder a spawn on their own hut's door tile, all
    five spawns distinct, all on a walkable tile.
- [ ] **Step 2:** Run `pnpm vitest run packages/gateway/src/founders.test.ts` — FAIL (the multi-house
  assertion must fail with `size === 1`; **paste that output into the batch report** — it is the
  proof the bug is what F-2 says it is).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** Full gateway suite + `pnpm typecheck` 0; goldens byte-identical; boot
  `SJ_DEV_MAP=showcase SJ_DEV_INTERIORS=1 DEV_FAST_FORWARD=810 pnpm dev:world`, run to the first
  sleep cycle, and record the five distinct `insideId` values in the batch report.
- [ ] **Step 5: Commit** `fix(gateway): five founders, five roofs — a tired person walks to their own door`,
  and in the same commit write the **engine half** into `c8-delta-from-c12.md`:
  > **U25-ENGINE (carried, not ours).** The viewer half is closed at Task 60. The engine half —
  > a *mind* preferring the roof it owns, rather than a script routing it — is open. C11 batch-10
  > controller ruling R-E already books it: *"structure ownership half landed (legal, not
  > witnessed) → C8 carry."* C12 does not simulate it in the viewer.

### Task 61: The town template, designed as a place *(U3)*

**Files:** Modify `packages/shared/src/cityTemplate.ts`, `packages/shared/src/cityTemplate.test.ts`,
`packages/gateway/src/showcaseMap.test.ts`, `packages/gateway/src/g10.test.ts`

**THE COMPLAINT:** "doesn't have an actual genuine structure. It just looks like chaos." Read as a
plan, the current template is not chaos — but it is a **grid with no centre and no frontage**. Five
identical huts in a straight line at `dy: 4` (`cityTemplate.ts:160`), a 5×5 plaza with a well and a
fire pit sitting *beside* it rather than *in* it, a storehouse on the plaza's west edge, two
identical sheds 4 rows apart, and one road running the full 34-tile width. Nothing faces anything.

**The five design moves, each stated as an invariant a test can check:**

| Move | Rule | Invariant |
|---|---|---|
| **A centre that reads as a centre** | the well and the fire pit stand **inside** the plaza rect, on its axis, not outside it | `inRect(PLAZA, well)` and `inRect(PLAZA, firePit)`, and both share `PLAZA_CENTRE.dx` or `.dy` |
| **Frontage** | every structure's door tile is **orthogonally adjacent to a road or path tile** | for all `s`: some 4-neighbour of `doorTile(s)` is in the road set |
| **A street, not a row** | the five huts sit in **two facing ranks** across a shared yard road, offset so no two doors are collinear beyond a rank | ranks of 3 and 2 at `dy 3` and `dy 8`, yard road at `dy 6`; `HUT_ORIGINS` asserted exactly |
| **Paths that lead somewhere** | every road tile is reachable from `PLAZA_CENTRE` **and** every road stub terminates at a structure door, a map edge, or the riverfront path — no road that ends in grass | `roadReach` covers the road set; a `danglingRoadEnds(t)` helper returns `[]` |
| **Districts you can point at** | the four `DISTRICTS` rects each contain ≥ 1 structure or ≥ 1 named terrain feature, and no two overlap | asserted over `DISTRICTS` |

**Interfaces — Produces:**
```ts
export const HUT_ORIGINS: readonly (readonly [number, number])[]   // two ranks, re-authored
export const WELL_AT = { dx: 17, dy: 12 } as const                 // on the plaza's north axis
export const FIRE_PIT_AT = { dx: 17, dy: 16 } as const             // on the plaza's south axis
/** A road tile with exactly one road neighbour that is not a door, an edge or the bank path. */
export function danglingRoadEnds(t: CityTemplate): { dx: number; dy: number }[]
/** Every structure's door, and the road tile it opens onto. */
export function frontages(t: CityTemplate): Array<{ kind: string; door: { dx: number; dy: number }; onto: { dx: number; dy: number } }>
```
- **Consumes:** nothing new. **CAUTION:** `cityTemplate.ts` is `@sj/shared` and genesis reads it.
  It is **not** in the golden path (the goldens fold `makeFixtureMap`), but that must be *proved*,
  not assumed — Step 4.

- [ ] **Step 1: Write the failing tests** in `cityTemplate.test.ts` — the five invariants above,
  each as its own named test; plus: the structure count stays in the ruled **8–12** band; every hut
  still carries the full `HUT_FURNISHINGS` set including a bed; `makeCityTemplate()` is still pure
  (two calls deep-equal, no RNG); `templateFits(CITY_ANCHOR_DEFAULT, WORLD_SIZE_GENESIS)` still true;
  and `growthPlots()` still returns ≥ 8 plots, each orthogonally adjacent to a road.
- [ ] **Step 2:** Run `pnpm vitest run packages/shared/src/cityTemplate.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Re-author `HUT_ORIGINS`, `cityRoadTiles` and `cityStructures` to satisfy
  the invariants. **Do not widen the schema and do not add a field** — this is a data edit inside the
  shapes that already exist, so nothing downstream re-types.
- [ ] **Step 4: Verify.** `pnpm vitest run` FULL SUITE green — in particular
  `packages/engine/src/golden.test.ts` and `g2.test.ts` byte-identical, which is the proof that
  `cityTemplate` is outside the golden path. `showcaseMap.test.ts` and `g10.test.ts` green (they
  assert plaza/road/door invariants and are the regression net). `pnpm typecheck` 0.
- [ ] **Step 5: Commit** `feat(shared): the town gets a centre, two facing ranks and roads that arrive somewhere`.

### Task 62: Landmarks, and a first frame that reads *(U3)*

**Files:** Create `packages/web/src/render/landmarks.ts`, `landmarks.test.ts`; Modify
`packages/web/src/render/scene.ts`, `packages/web/src/ui/chrome.css`

**Why this is separate from Task 61:** a good plan is not a legible picture. At the default zoom the
viewer sees roofs and roads and cannot tell the plaza from a wide street. This task adds the *reading
aids* a real town has: a marked centre, a hierarchy of building silhouette, and place names that
appear at overview zoom and get out of the way when you go in.

**Interfaces — Produces:**
```ts
export type Landmark = { id: string; name: string; x: number; y: number; rank: 1 | 2 | 3 }
/** Derived from what is standing, never authored twice. rank 1 = the centre, 2 = a district
 *  anchor, 3 = a notable single building. */
export function landmarksOf(state: WorldState): Landmark[]
/** Landmark labels appear only at the overview stop and fade out on the way in — a label at
 *  4× is clutter, a label at 0.5× is the map legend. */
export const LANDMARK_SHOW_BELOW_SCALE = 1.5
export function landmarkAlpha(scale: number): number
/** A building's visual weight: public buildings read heavier than dwellings, so the eye finds
 *  the civic centre first. Applied as a rim/ledge treatment, never a tint that changes the art. */
export const SILHOUETTE_RANK: Record<string, 1 | 2 | 3>
```
- **Consumes:** Task 59's owned structures, Task 69's layer table (`layers.overlay`).

- [ ] **Step 1: Write the failing tests** — `landmarksOf` on the Task-59 town returns the fire pit
  as the single `rank: 1` landmark and names it `the fire pit`; returns one rank-2 per district that
  has a structure; returns `[]` on an empty world; is deterministic and sorted by rank then id;
  **every name passes `GAMIFICATION_BAN` and contains no machine vocabulary** (no `structure_`, no
  kind slug with an underscore); `landmarkAlpha(0.5) === 1`, `landmarkAlpha(1.5) === 0`, and it is
  monotonic between; `SILHOUETTE_RANK` is total over the eleven template kinds (a new kind with no
  rank is a compile error via `Record<CityKind, …>`).
- [ ] **Step 2:** Run `pnpm vitest run packages/web/src/render/landmarks.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Labels draw in the `overlay` layer (P16) at the type scale's
  `--fs-chip` in CSS px, `eventMode = 'none'`. Silhouette rank is a 1 px ink rim + one-step ledge on
  the building sprite, from the palette — **no new art, no tint of the generated art** (P11).
- [ ] **Step 4:** Suite + typecheck PASS; web build succeeds.
- [ ] **Step 5: Commit** `feat(web): the town names its own centre, and the eye finds it first`.

### Task 63: Roads that carry at 1× *(U5)*

**Files:** Modify `packages/web/src/render/groundField.ts`, `groundField.test.ts`,
`packages/web/src/render/ground.ts`

**THE COMPLAINT (controller observation, same lane as U3):** roads read ghost-faint at 1×. The
mechanism is measurable: `groundField.ts:209-210` gives the road a single shoulder colour
`ROAD_SHOULDER = 0xb89d7e`, and the road surface itself is a material sampled in world space, so at
scale 1 a one-tile ribbon is 32 × 16 px of a 256 px material — a nearly flat average that lands
within a few luma points of the grass beside it.

**Interfaces — Produces:**
```ts
/** WCAG-style relative luminance of a MASTER_PALETTE colour, 0..1. */
export function luma(rgb: number): number
/** The floor a road must clear against the ground it runs through, so a path is visible as a
 *  path at the widest zoom. Measured, not guessed: the value the gate asserts. */
export const ROAD_GROUND_LUMA_DELTA_MIN = 0.14
/** The rim darkens where a road meets a non-road, and lightens on the far side, so the ribbon
 *  carries an edge at any zoom. Two colours, both palette members. */
export const ROAD_SHOULDER_DARK = 0x8A7256
export const ROAD_SHOULDER_LIGHT = 0xD9C49F
/** Mean sampled tone of a material, cached per url — the number the delta is measured against. */
export function materialTone(url: string, sample: ImageLike): number
export function roadReadsAt(roadTone: number, groundTone: number): boolean   // delta >= the floor
```
- **Consumes:** the landed `roadShoulderPolys`, `ROAD_UNDER`.

- [ ] **Step 1: Write the failing tests** — `luma` matches the WCAG formula on three known hexes to
  1e-6; `roadReadsAt` is false for the **currently shipped pair** (road material mean vs grass
  material mean, both read from the shipped PNGs in the test — this is the failing assertion that
  proves the complaint); true after the shoulder change; `ROAD_SHOULDER_DARK` and
  `ROAD_SHOULDER_LIGHT` are both MASTER_PALETTE members; the two-tone shoulder is emitted **only on
  edges facing a missing arm** (the landed `SHOULDER_T` rule is preserved — a rim at every join was
  the old "cobble islands" bug and must not come back); a straight 20-tile run still produces
  exactly two continuous rim bands and zero interior wedges.
- [ ] **Step 2:** Run `pnpm vitest run packages/web/src/render/groundField.test.ts` — FAIL.
- [ ] **Step 3: Implement.** The shoulder becomes two polys per exposed edge: `ROAD_SHOULDER_DARK`
  on the road side, `ROAD_SHOULDER_LIGHT` one pixel outboard. Both are palette tokens filling shapes
  — no painted art (P11).
- [ ] **Step 4:** Suite + typecheck PASS; capture a 1× screenshot of a 20-tile run and paste the
  measured `roadTone − groundTone` delta into the batch report.
- [ ] **Step 5: Commit** `fix(web): a road you can see from the widest view`.

### Task 64: A ground with no visible repeat *(U6)*

**Files:** Modify `packages/web/src/render/groundField.ts`, `groundField.test.ts`

**THE COMPLAINT:** the grass material repeats visibly on a regular grid. The mechanism:
`scene.ts:77` fills every ground shape with `{ texture: tex, matrix: new Matrix() }` — an identity
matrix, so a 256 px material tiles on an axis-aligned 256 px lattice across the whole map. Terrain
v2 removed *tile*-frequency pattern and introduced *material*-frequency pattern in its place. The
eye finds a 256 px grid as easily as a 32 px one.

**Interfaces — Produces:**
```ts
/** The material lattice is broken by giving each ground LAYER its own fill transform: a small
 *  rotation and a translation, both derived from the layer id so two runs agree, applied to the
 *  fill matrix rather than to the geometry. Nothing moves; only where the material is sampled. */
export const MATERIAL_ROTATIONS_DEG: readonly number[] = [0, 7.5, -5, 12]
export function materialMatrix(layerId: string, index: number): Matrix
/** A second, coarser variation pass: each ground layer is filled TWICE — once with the material
 *  and once with the same material at 2.37× scale and 0.22 alpha, offset. Two incommensurate
 *  periods do not produce a visible lattice. 2.37 is irrational-enough that the least common
 *  multiple exceeds the map. */
export const OCTAVE_SCALE = 2.37
export const OCTAVE_ALPHA = 0.22
/** The test's own detector: autocorrelation peak of a rendered strip at the material period. */
export function latticePeak(pixels: Uint8ClampedArray, w: number, h: number, period: number): number
export const LATTICE_PEAK_MAX = 0.35
```
- **Consumes:** `MATERIAL_REPEAT_PX`, `materialUv`.

- [ ] **Step 1: Write the failing tests** — `materialMatrix('grass', 0)` is deterministic and
  differs from `materialMatrix('earth', 1)`; the rotation is drawn from `MATERIAL_ROTATIONS_DEG` by
  index, so the set is bounded and auditable; `latticePeak` returns ~1.0 on a synthetic buffer that
  is a perfect 256 px tiling and < 0.1 on white noise (the detector is calibrated before it is
  trusted); **`latticePeak` of the shipped grass material tiled by an identity matrix exceeds
  `LATTICE_PEAK_MAX`** (the failing assertion that proves the complaint) and is under it after the
  change; `OCTAVE_ALPHA` composited twice never pushes a pixel outside the material's own tone range
  by more than 6 %.
- [ ] **Step 2:** Run `pnpm vitest run packages/web/src/render/groundField.test.ts` — FAIL.
- [ ] **Step 3: Implement.** The octave pass is one extra `Graphics.fill` per ground layer on the
  same mask — **at most 8 extra fills for the whole map bake**, which is a bake-time cost, not a
  frame cost.
- [ ] **Step 4:** Suite + typecheck PASS; re-run the bake timing and record it (the bake is already
  once-per-dirty-frame; a regression here is a real cost).
- [ ] **Step 5: Commit** `fix(web): two periods that never line up — the ground stops repeating`.

### Task 65: Farmland and plaza with edges *(U7)*

**Files:** Modify `packages/web/src/render/groundField.ts`, `groundField.test.ts`; Create
`packages/web/src/render/patches.ts`, `patches.test.ts`

**THE COMPLAINT:** the farmland/plaza patch reads as an amorphous blob. The mechanism: a patch is
just the union of its tiles' diamonds, filled with one material. A real field has a **boundary** —
a headland, a furrow direction, a fence line — and a plaza has a **kerb**.

**Interfaces — Produces:**
```ts
/** The outline of a set of tiles, as screen-space polylines, with interior edges removed.
 *  Pure, deterministic, and the same function serves farmland, plaza and any future patch. */
export function patchOutline(tiles: ReadonlyArray<{ x: number; y: number }>): number[][]
/** Furrows: parallel lines across a patch, in the direction of its longer axis, spaced in
 *  TILE units so they read as ploughing rather than as a texture. */
export const FURROW_SPACING_TILES = 1
export function furrowLines(tiles: ReadonlyArray<{ x: number; y: number }>): number[][]
export const KERB_COLOR = 0xABA198       // --stone
export const HEADLAND_COLOR = 0x8A7256   // the road shoulder's dark, so a field edge and a
                                         // road edge are the same language
```
- **Consumes:** Task 63's shoulder colours; `tileToScreen`.

- [ ] **Step 1: Write the failing tests** — `patchOutline` of a single tile is one 4-point diamond;
  of a 2×2 block is **one** 8-point outline with **no interior segment** (assert the segment count
  exactly); of two diagonally touching tiles is **two** outlines, not one; of an L-shape traces the
  concave corner correctly; `furrowLines` of a 4×2 patch runs along the 4 axis and yields 2 lines,
  and of a 2×4 patch yields 4 along the other axis; both functions are order-independent (shuffle
  the input, same output); `KERB_COLOR` and `HEADLAND_COLOR` are MASTER_PALETTE members.
- [ ] **Step 2:** Run `pnpm vitest run packages/web/src/render/patches.test.ts` — FAIL.
- [ ] **Step 3: Implement.** The plaza (road-mass tiles, `isRoadMass`) gets a `KERB_COLOR` outline;
  farmland gets a `HEADLAND_COLOR` outline plus furrows at `OCTAVE_ALPHA`-scale opacity. Both are
  drawn into the **ground bake**, so they cost nothing per frame.
- [ ] **Step 4:** Suite + typecheck PASS; attach a 1× and a 3× capture of the plaza and one field.
- [ ] **Step 5: Commit** `feat(web): a field has a headland and a plaza has a kerb`.

---

# Phase M — INTERIORS THAT LOOK LIVED IN *(U4)*

**THE COMPLAINT:** interiors are "way too low quality, way too under detailed." Verified in
`packages/web/src/render/interiorScene.ts`: a room is a flat cream diamond (`INTERIOR_FLOOR
0xf6e8d5`) with a 2 px rim, one shaded far row, and up to five furniture sprites. There are **no
walls**. `interiors.ts` even carries a `placement: 'wall'` meta (`interiorScene.ts:130`) whose only
effect is a 0 px offset, because there is nothing to hang anything on.

### Task 66: The room shell — walls, a back plane, a threshold *(U4)*

**Files:** Create `packages/web/src/render/roomShell.ts`, `roomShell.test.ts`; Modify
`packages/web/src/render/interiorScene.ts`

**Interfaces — Produces:**
```ts
export const WALL_H_TILES = 3            // a room's walls rise three tile-heights behind the floor
export const WALL_KINDS = ['back-left', 'back-right'] as const
export type WallKind = (typeof WALL_KINDS)[number]

/** The two back walls of a dimetric room, as screen polygons relative to the room origin.
 *  Pure geometry — the fill is a generated material or a palette token (P11). */
export function wallPolys(slots: number, slotTiles: number, wallH: number): Record<WallKind, number[]>
/** Where a wall-placement furnishing hangs: on the wall plane behind its slot, at eye height. */
export function wallMount(slot: { x: number; y: number }, slots: number): { sx: number; sy: number; wall: WallKind }
/** The doorway: a gap cut in the front-facing edge, on the same face the exterior door sits on,
 *  so entering and leaving are the same place. */
export function thresholdPoly(slots: number, slotTiles: number): number[]
/** Light falls from the doorway and from any furnishing with providesLight; the floor carries a
 *  soft pool per source. Returns pools, never pixels. */
export function floorPools(items: ReadonlyArray<{ slot: { x: number; y: number }; light: boolean }>, slots: number):
  Array<{ sx: number; sy: number; radius: number; alpha: number }>
export const DOORWAY_POOL_ALPHA = 0.18
export const HEARTH_POOL_ALPHA = 0.26
```
- **Consumes:** `ROOM_SLOTS`, `SLOT_TILES`, `slotToScreen` (existing, exported for the test).

- [ ] **Step 1: Write the failing tests** — `wallPolys(3, 2, 3)` returns exactly two polygons; each
  is a closed quad; the two share exactly one edge (the room's far vertex column) and neither
  overlaps the floor diamond (assert by point-in-poly on the floor's centroid); `wallMount` for
  slot `(0,0)` lands on `back-left` and for `(2,0)` on `back-right`, and both are **above** the
  floor's far edge in screen y; `thresholdPoly` sits on the **near** face and its centre matches the
  floor's near vertex; `floorPools` returns one pool per light source plus exactly one doorway pool,
  every alpha ≤ `HEARTH_POOL_ALPHA`, and `[]` plus the doorway pool for a room with no lit
  furnishing; every function is pure and deterministic.
- [ ] **Step 2:** Run `pnpm vitest run packages/web/src/render/roomShell.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Walls draw in a new `roomWalls` sub-layer **behind** the floor;
  the floor gains the continuous-material treatment the outdoor ground already has
  (`resolveMaterial(records, 'interior-floor')`, falling back to `INTERIOR_FLOOR` when the art is
  absent — the landed hot-swap law). `placement: 'wall'` furnishings finally mount on a wall.
- [ ] **Step 4:** Suite + typecheck PASS; `interiorScene` existing tests green; web build succeeds.
- [ ] **Step 5: Commit** `feat(web): a room has walls, a doorway and light that falls from them`.

### Task 67: Furniture that touches the floor, and bodies that lie *in* the bed *(U4)*

**Files:** Modify `packages/web/src/render/interiorScene.ts`, `interiorScene.test.ts`; Modify
`packages/web/src/render/depth.ts` (Task 70 creates it)

**THE DEFECT:** `interiorScene.ts:132` sorts furniture at `zIndex = slot.x + slot.y` and bodies at
`slot.x + slot.y + 0.5` — so **a sleeping body always draws in front of the bed it is in**, and two
furnishings in the same diagonal tie. Nothing casts a shadow, so every object floats.

**Interfaces — Produces:**
```ts
/** The interior reuses the SAME depth authority as the town (Task 70). A slot is a 1×1 box in
 *  slot space; a body in a bed is a box INSIDE the bed's box, which `inFrontOf` resolves as
 *  "neither in front" — so the tie is broken by an explicit rule instead of by +0.5. */
export type OccupancyMode = 'in' | 'at' | 'beside'
/** 'in' (a bed, a chair) draws the body BETWEEN the furniture's back and front halves;
 *  'at' (a table, an anvil) draws the body behind it; 'beside' is plain depth order. */
export const FURNITURE_OCCUPANCY: Record<string, OccupancyMode>
export function occupancyOf(kind: string): OccupancyMode
/** Contact shadow: an ellipse under every object, sized from its footprint, so nothing floats. */
export const CONTACT_SHADOW_ALPHA = 0.22
export function contactShadow(widthPx: number): { rx: number; ry: number; alpha: number }
```
- **Consumes:** Task 70 `depthOrder`, Task 69 `layers`.

- [ ] **Step 1: Write the failing tests** — `occupancyOf('bed') === 'in'`, `'chair' === 'in'`,
  `'table' === 'at'`, `'shelf' === 'beside'`, and `FURNITURE_OCCUPANCY` is **total over
  `CITY_FURNISHING_KINDS`** (a kind added to the template with no mode fails here);
  a sleeping occupant in a bed sorts **after the bed's back half and before its front half** —
  asserted on the produced order array, not on a number; two furnishings on the same diagonal
  produce a **stable, id-ordered** result across two calls; `contactShadow(24)` is wider than tall
  and its alpha equals `CONTACT_SHADOW_ALPHA`; a room with no occupants renders the same order twice.
- [ ] **Step 2:** Run `pnpm vitest run packages/web/src/render/interiorScene.test.ts` — FAIL.
- [ ] **Step 3: Implement.** A furnishing with `occupancy: 'in'` is drawn as **two sprites from one
  texture** — a back half and a front half split at the manifest's own mid-line — which is the only
  honest way to put a body inside a bed in a painter's-algorithm renderer.
- [ ] **Step 4:** Suite + typecheck PASS; capture a sleeping founder in a bed and a founder at a
  table.
- [ ] **Step 5: Commit** `feat(web): furniture stands on the floor, and a sleeper is in the bed rather than on it`.

### Task 68: What this room is *(U4, and audit R7)*

> **AMENDED BY C12a batch 3.** This task consumes Task 79's `statusOf` and Task 80's
> `placeOf`, neither of which had landed. `interiorModel.ts` carries the three state words it
> needs — `Asleep`, a gerund of the current verb, and `Between things` for awake with nothing
> to do (ruling R7, Q6) — chosen to obey P17 in advance, so **Task 79 REPLACES
> `ROOM_STATE_*`/`roomStateOf` rather than auditing them.** The card shows no "where they
> are" line, because inside a room the answer is the room; Task 80 adds nothing here.

**Files:** Modify `packages/web/src/ui/InteriorBar.tsx`, `InteriorBar.test.ts`; Create
`packages/web/src/ui/interiorModel.ts`, `interiorModel.test.ts`

**THE GAP (audit R7, measured):** an interior shows "a bare cream diamond, 4 props, and *No one is
in just now*", while the chronicle already knows "The storehouse is finished" and the provenance tag
already knows who built it.

**Interfaces — Produces:**
```ts
export type RoomCard = {
  title: string                 // "Amara's hut" | "the storehouse" — owner-aware, P12-clean
  built: string | null          // "Raised by Yusuf, Day 3" — from /api/structure/:id/provenance
  lives: string[]               // names, from Structure.owner and from who sleeps here
  holds: Array<{ kind: string; qty: number; iconUrl: string | null }>   // items whose loc is this structure
  present: Array<{ id: string; name: string; state: string }>           // Task 79 STATE words
  empty: string                 // the P21 empty line, written for a mature world
}
export function roomCard(state: WorldState, structureId: string, records: AssetRecord[], provenance: Provenance | null): RoomCard
```
- **Consumes:** Task 60 `homeOf`/`Structure.owner`, Task 79 `statusOf`, Task 80 `placeOf`, the
  landed `/api/structure/:id/provenance`.

- [ ] **Step 1: Write the failing tests** — `roomCard` for an owned hut titles it
  `"Amara's hut"` with a typographic apostrophe and for a public building `"the storehouse"`;
  `built` is `null` (not the string "null", not "unknown") when provenance is absent, and the panel
  omits the line rather than printing a blank; `holds` lists only items whose `loc` is this
  structure and merges duplicate kinds by summing `qty`; `present` uses Task 79's STATE words and
  **never** the words `resting`/`awake` (P17 scan); a storehouse with 40 item kinds renders at most
  `ROOM_HOLDS_MAX = 8` rows plus an honest "and 32 more"; the empty line for a furnished but
  unoccupied room says nobody is in *now* and never that nothing has happened yet (M6); every
  string passes `GAMIFICATION_BAN`.
- [ ] **Step 2:** Run `pnpm vitest run packages/web/src/ui/interiorModel.test.ts` — FAIL.
- [ ] **Step 3: Implement.** The bar becomes a card: title, one provenance line, a who-lives-here
  row of portrait busts, and a holdings grid.
- [ ] **Step 4:** Suite + typecheck PASS; the three states (P21) are all reachable in the dev world.
- [ ] **Step 5: Commit** `feat(web): a room tells you whose it is, who built it and what it holds`.

---

# Phase N — LAYERING, HIT TESTING, TOOLTIPS *(U8, U9, U10, U11)*

U8 asks for a **full depth-sort review, not a patch**. F-3 is that review: three independent
defects, in a container that also mixes eight kinds of thing into one integer space. This phase
replaces the mechanism.

### Task 69: The layer contract — one table, one authority *(U8)*

**Files:** Create `packages/web/src/render/layers.ts`, `layers.test.ts`; Modify
`packages/web/src/render/scene.ts`, `entities.ts`, `characters.ts`, `bubbles.ts`, `nameTags.ts`,
`ambient.ts`, `weatherFx.ts`, `interiorScene.ts`

**THE DEFECT:** `scene.ts:166-168` creates **one** `sortableChildren` container for everything.
Shadows, bodies, buildings, doors, items, crops, emotes, per-body name tags, the shared hover tag
and speech bubbles all compete in one integer space, and they resolve their conflicts with magic
numbers written at eight different call sites: `1e9` (`bubbles.ts:124`), `1e9 - 1`
(`nameTags.ts:13`), `1e8` (planned for particles), `structureZIndex + 1` (`entities.ts:47`),
`sprite.zIndex ± 1` (`characters.ts:282-294`). Every one of those numbers is a guess about what
somebody else chose.

**Interfaces — Produces:**
```ts
export const LAYERS = [
  'ground',        // the baked terrain field
  'groundDecal',   // patch outlines, furrows, overlay tints, build-site stakes, footprint rings
  'shadow',        // every contact shadow, for every body and every structure
  'entities',      // THE ONLY depth-sorted layer: bodies, structures, items, crops, fauna
  'overhead',      // tree canopies and anything drawn over everything on its own tile
  'worldText',     // name tags, hover tags, landmark labels
  'bubbles',       // speech and thought
  'overlay',       // debug counters, selection rings, the FPS badge
] as const
export type LayerName = (typeof LAYERS)[number]
export type LayerSet = Readonly<Record<LayerName, Container>>

/** Creates the eight containers as children of `world` in LAYERS order, sets
 *  `sortableChildren` on `entities` and NOWHERE ELSE, and returns them. */
export function createLayers(world: Container): LayerSet

/** P16's mechanical guard. Given a module's source text, returns every offending line.
 *  The only files allowed to assign a zIndex are layers.ts itself and the two files Task 70
 *  authorises (entities.ts and characters.ts assign the depth INDEX inside `entities`). */
export const Z_ASSIGN = /\.zIndex\s*=/
export const Z_AUTHORISED: readonly string[] = ['render/layers.ts', 'render/entities.ts', 'render/characters.ts']
export function literalZIndexOffenders(files: ReadonlyArray<{ path: string; source: string }>): string[]
```
- **Consumes:** nothing.

- [ ] **Step 1: Write the failing tests** — `createLayers` against a stub `Container` adds exactly
  8 children in `LAYERS` order; **only** `entities` has `sortableChildren === true`;
  `literalZIndexOffenders` finds the offending line in a synthetic file and returns `[]` for an
  authorised path; **and the real scan**: read every `.ts`/`.tsx` under `packages/web/src/render`
  and `packages/web/src/ui` off disk and assert `literalZIndexOffenders(...)` is `[]` — this test
  **fails today at six known call sites**, and the list of six goes in the batch report as the
  before-state.
- [ ] **Step 2:** Run `pnpm vitest run packages/web/src/render/layers.test.ts` — FAIL, six offenders.
- [ ] **Step 3: Implement.** Every module that used a magic number now `addChild`s to the layer it
  belongs to. Bubbles → `bubbles`. Hover and per-body tags → `worldText`. Shadows → `shadow`.
  Emotes → `worldText`. Doors → **children of their building sprite** (Task 73). Particles and
  ambient fauna → `groundDecal` (under) or `overhead` (over), each stated in one line of comment.
- [ ] **Step 4:** Full web suite + typecheck PASS; web build succeeds; the scan test is green.
- [ ] **Step 5: Commit** `refactor(web): eight named layers, and one place that decides what is over what`.

### Task 70: The depth sort, rewritten *(U8)*

**Files:** Create `packages/web/src/render/depth.ts`, `depth.test.ts`; Modify
`packages/web/src/render/entities.ts`, `characters.ts`, `iso.ts`

**THE THREE DEFECTS THIS REPLACES:** F-3(a) a footprint is a range, not a scalar; F-3(b) the `+x`
tiebreak produces exact ties between a body and a building; F-3(c) a body's depth is rounded while
its position is not.

**The model.** Every drawable in `entities` declares the **ground it stands on**, in *tile-edge*
coordinates — a tile `(x, y)` spans `[x − 0.5, x + 0.5] × [y − 0.5, y + 0.5]`. A body's box follows
its **interpolated** position with no rounding, which is what removes the pop.

**Interfaces — Produces:**
```ts
export type DepthBox = {
  id: string
  x0: number; y0: number; x1: number; y1: number   // tile-EDGE coordinates, floats
  /** screen AABB of the DRAWN sprite (which may overhang the footprint by ~1.85×).
   *  Broad phase only — it decides whether two things can visually overlap, never who wins. */
  sx0: number; sy0: number; sx1: number; sy1: number
}

/** `a` is strictly nearer the viewer than `b`. In dimetric, screen-y grows with x + y, so
 *  "nearer" is "past the far edge on either world axis". Strict: touching edges do not count
 *  as behind, they count as level, and level is broken by the scalar seed. */
export function inFrontOf(a: DepthBox, b: DepthBox): boolean {
  return a.x0 >= b.x1 || a.y0 >= b.y1
}

export function screenOverlap(a: DepthBox, b: DepthBox): boolean {
  return a.sx0 < b.sx1 && b.sx0 < a.sx1 && a.sy0 < b.sy1 && b.sy0 < a.sy1
}

/** The stable seed: the nearest corner, exactly the scalar C10 shipped — kept as the tiebreak
 *  so the new order degrades to the old one wherever the old one was already right. */
export function depthSeed(b: DepthBox): number { return (b.x1 + b.y1) * 1000 + b.x1 }

/** Above this many drawables in one frame, the topological pass is skipped and the seed order
 *  is used. Culling (v1 Task 8) keeps the live count far below it; the cap exists so a
 *  pathological frame degrades instead of stalling. */
export const DEPTH_BUDGET = 256

/** Painter's order, back to front, as ids. Deterministic: two calls on the same input are
 *  identical, and the input order does not matter. */
export function depthOrder(boxes: readonly DepthBox[]): string[]
```

**Implementation of `depthOrder` — Kahn over overlap edges, seeded by the scalar:**
```ts
export function depthOrder(boxes: readonly DepthBox[]): string[] {
  const seeded = [...boxes].sort((a, b) => depthSeed(a) - depthSeed(b) || (a.id < b.id ? -1 : 1))
  const n = seeded.length
  if (n > DEPTH_BUDGET) return seeded.map((b) => b.id)

  const after: number[][] = seeded.map(() => [])   // i must be drawn BEFORE each j in after[i]
  const indeg = new Array<number>(n).fill(0)
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = seeded[i]!, b = seeded[j]!
      if (!screenOverlap(a, b)) continue           // cannot occlude ⇒ no constraint
      const aFront = inFrontOf(a, b), bFront = inFrontOf(b, a)
      if (aFront === bFront) continue              // level, or mutually diagonal ⇒ seed decides
      if (bFront) { after[i]!.push(j); indeg[j]!++ } else { after[j]!.push(i); indeg[i]!++ }
    }
  }

  // Ready nodes are taken in SEED order, so with no constraints the output IS the seed order.
  const out: string[] = []
  const ready: number[] = []
  for (let i = 0; i < n; i++) if (indeg[i] === 0) ready.push(i)
  while (ready.length > 0) {
    ready.sort((p, q) => p - q)
    const i = ready.shift()!
    out.push(seeded[i]!.id)
    for (const j of after[i]!) if (--indeg[j]! === 0) ready.push(j)
  }
  // A cycle is possible when three oversized sprites overlap in a pinwheel. It is not a crash
  // and it is not a guess: the survivors are appended in seed order, which is the behaviour
  // this replaces, and the gate counts how often it happens (it should be zero).
  if (out.length < n) for (let i = 0; i < n; i++) if (indeg[i]! > 0) out.push(seeded[i]!.id)
  return out
}
```

- **Consumes:** Task 69 `layers.entities`.

- [ ] **Step 1: Write the failing tests** — the whole of F-3, as assertions:
  - **F-3(b), the exact tie:** a 2×2 hut at `(20,20)` and a body at tile `(20,22)`. Assert the body
    is **after** the hut in `depthOrder`. On the landed `depthKey` both compute `42021`; write that
    number into the test's comment so the regression is legible.
  - **F-3(c), no pop:** walk a body from `(20,21)` to `(20,22)` in 20 sub-steps and assert the
    body/hut relative order flips **exactly once**, at the sub-step where the body's back edge
    (`py − 0.5`) first reaches the hut's front edge (`21.5`) — and that the flip position is
    *independent of the number of sub-steps* (run it again at 200 and get the same crossing).
  - **F-3(a), the ring walk:** eight bodies on a ring of radius 3 around the hut. Assert the four
    on the south/east arc are after the hut and the four on the north/west arc are before it.
  - `inFrontOf` is **irreflexive** and, for any two non-overlapping boxes, **antisymmetric**.
  - Two diagonally adjacent tiles produce **no** edge (broad phase) and fall back to seed order.
  - **The pinwheel:** three deliberately oversized overlapping boxes in a cycle produce a
    permutation of all three ids exactly once each, with no throw and no duplicate.
  - `depthOrder` on 300 boxes returns all 300 ids (the `DEPTH_BUDGET` fallback path) and is
    measurably faster than the topological path — record both timings.
  - Determinism: shuffle the input 20 times, get the same output 20 times.
- [ ] **Step 2:** Run `pnpm vitest run packages/web/src/render/depth.test.ts` — FAIL.
- [ ] **Step 3: Implement.** `entities.ts` and `characters.ts` stop assigning `zIndex` from
  `depthKey` and instead **publish a `DepthBox` each frame**; one owner (`StageMount`'s frame tick)
  calls `depthOrder` over the live, culled set and writes `sprite.zIndex = index`. `depthKey` stays
  exported for the minimap and is marked `@deprecated for sorting` in one line, because C10 tests
  still import it.
- [ ] **Step 4:** Full web suite + typecheck PASS; `entities.test.ts` and `characters.test.ts` green;
  measure the per-frame cost of `depthOrder` at the dev world's live entity count and record it
  against the 60 fps budget.
- [ ] **Step 5: Commit** `fix(web): a building is a footprint, not a number — the depth sort answers to geometry`.

### Task 71: Occlusion proof — the walk-around, on the real town *(U8)*

**Files:** Create `packages/web/src/render/occlusion.test.ts`

**Why a whole task:** U8 asks for a review, and a review that leaves no artefact is an opinion. This
task produces the artefact: a pure, headless proof that runs on every commit, over the **eleven real
buildings of the Task-59 town**, not a fixture.

**Interfaces — Produces:**
```ts
/** Every tile within `radius` of a structure's footprint, and whether geometry says a body
 *  standing there is in front of it. This is the ORACLE — computed from screen positions and
 *  the sprite's own drawn extent, independently of depthOrder, so the test is not the
 *  implementation checking itself. */
export function expectedInFront(s: DepthBox, tile: { x: number; y: number }): boolean | 'level'
```

- [ ] **Step 1: Write the failing tests** —
  - For each of `devTown().structures`, walk every tile within radius 4 of its footprint. Assert
    `depthOrder` agrees with `expectedInFront` on every tile where the oracle is decisive, and that
    the disagreement set is **empty**. Print the disagreement set on failure with tile coordinates —
    a future regression must name its own tile.
  - The same walk with the body **mid-step** between each pair of adjacent tiles: assert the order
    is monotonic along the path (it flips at most once per structure per traversal, never twice).
  - A body standing **on** a structure's own door tile is in front of that structure.
  - A body standing **inside** a structure's footprint (mid-transition through a doorway) is in
    front of it, never inside it.
  - Two bodies on the same tile order stably by id and never swap between frames.
- [ ] **Step 2:** Run `pnpm vitest run packages/web/src/render/occlusion.test.ts` — FAIL (it must
  fail against the landed `depthKey`; **paste the disagreement count into the batch report as the
  measured size of U8**).
- [ ] **Step 3:** No implementation — Task 70 is the implementation. If this test still fails,
  **the fix goes in `depth.ts`, never in the oracle.**
- [ ] **Step 4:** Green. Record the before/after disagreement counts.
- [ ] **Step 5: Commit** `test(web): the walk-around proof — nobody passes behind a building they are standing in front of`.

### Task 72: Hit shapes that match what is drawn *(U9)*

**Files:** Create `packages/web/src/render/hitShapes.ts`, `hitShapes.test.ts`; Modify
`packages/web/src/render/characters.ts`, `charAnim.ts`, `entities.ts`

**THE DEFECT:** `charAnim.ts:18-19` — the click target is a **52 × 72 rectangle** with feet at
`(0,0)`. The drawn figure is ~26 px wide at the shoulders and ~52 px tall. So the box is roughly
**twice the silhouette's area**, it claims a 20 px column of empty sky above the head where the name
tag lives, and it reaches 26 px to each side, which is how it steals the door (audit M5).

**Interfaces — Produces:**
```ts
/** Local sprite space, feet at (0, 0), body rising to negative y. A capsule, not a box:
 *  a foot diamond the width of the stance, a torso column the width of the shoulders, and
 *  a head cap. Every dimension is measured off the v4 manifest's own figure height, so a
 *  taller sheet gets a taller capsule with no second table. */
export const STANCE_W = 20, SHOULDER_W = 28, HEAD_W = 18
export const FOOT_H = 8, TORSO_TOP = 0.66, HEAD_TOP = 0.94   // fractions of figure height
export function bodyHitPolygon(figureH: number, scale: number): number[]

/** The minimum any pointer target may be, in SCREEN px, at any zoom (audit m4 + P14). When the
 *  capsule at the current zoom is smaller than this, it is inflated about its own centroid —
 *  so a tiny sprite is still clickable without a permanently oversized box at 4×. */
export const HIT_MIN_PX = 24
export function inflateToMin(poly: number[], minPx: number, scale: number): number[]

/** Area ratio of the hit polygon to the drawn silhouette's bounding box. The number U9 is
 *  about, and the number the gate asserts. */
export function hitTightness(poly: number[], figureW: number, figureH: number, scale: number): number
export const HIT_TIGHTNESS_MAX = 1.35
```
- **Consumes:** `CHAR_TARGET_PX`, the v4 `CharacterAtlasManifest.figureH`.

- [ ] **Step 1: Write the failing tests** — `bodyHitPolygon` returns a closed polygon of 8 points;
  its widest span equals `SHOULDER_W` at `TORSO_TOP` and `STANCE_W` at the feet; it contains the
  point 4 px above the feet on the centre line and **does not contain** the point 30 px above the
  head (where the name tag sits) nor the point 26 px to the side at foot height (where a
  neighbouring door sits); `hitTightness` for the **landed 52 × 72 rectangle exceeds
  `HIT_TIGHTNESS_MAX`** (the failing assertion that proves U9) and is under it for the capsule;
  `inflateToMin` at scale 0.5 produces a polygon whose screen bounding box is ≥ `HIT_MIN_PX` in both
  axes, and at scale 4 changes nothing; the polygon scales correctly (Pixi scales `hitArea`, so the
  local polygon is divided by scale exactly as `hitRect` did — assert the screen-space result is
  scale-invariant).
- [ ] **Step 2:** Run `pnpm vitest run packages/web/src/render/hitShapes.test.ts` — FAIL.
- [ ] **Step 3: Implement.** `characters.ts` replaces `new Rectangle()` with a `Polygon`, mutated in
  place on scale change exactly as `setHitScale` does today.
- [ ] **Step 4:** Suite + typecheck PASS; live check: hover the gap between two adjacent founders and
  confirm neither tag fires.
- [ ] **Step 5: Commit** `fix(web): you click the person, not the air around them`.

### Task 73: The door is part of the building *(U11, and audit M5)*

**Files:** Modify `packages/web/src/render/entities.ts`, `entities.test.ts`; Modify
`packages/web/src/render/hitShapes.ts`

**THE DEFECT:** F-4. The door is a `Graphics` rounded rect in ink at 50 % alpha, **10 × 13 world
px**, drawn as a **sibling** of its building at `structureZIndex + 1` — so it paints over anyone
standing in the doorway, and its 10 × 13 target loses every contest with a 52 × 72 body box.

**The fix is structural, and it removes three problems at once:** the door becomes a **child of its
building sprite**. A child inherits its parent's depth, so it can never sort against it (U11's dark
rectangle over a body is impossible by construction, and P9d is repealed). Pixi hit-tests children
before parents, so the door wins the click against its own building *without* a priority table. And
a child scales with the sprite, so the door is re-cut for free when the art swaps.

**Interfaces — Produces:**
```ts
/** The door's frontage rectangle in the PARENT's local space, derived from the building's
 *  manifest feet point and footprint — not from two hardcoded pixel constants. */
export const DOOR_W_TILES = 0.55, DOOR_H_TILES = 0.85
export function doorLocalRect(footprint: { w: number; h: number }, scale: number): { x: number; y: number; w: number; h: number }

/** Priority when two hit-testable things genuinely overlap in screen space. Lower wins.
 *  A door beats a body BECAUSE a door is a destination and a body has a whole panel of its
 *  own; a body beats a building because a building's story is one popover. */
export const HIT_PRIORITY: Readonly<Record<'door' | 'agent' | 'item' | 'crop' | 'structure', number>> =
  { door: 0, agent: 1, item: 2, crop: 3, structure: 4 }
export function resolveHit(candidates: ReadonlyArray<{ kind: keyof typeof HIT_PRIORITY; id: string }>): string | null
```
- **Consumes:** Task 69 (the door is no longer a scene child), Task 72 `HIT_MIN_PX`.

- [ ] **Step 1: Write the failing tests** — `doorLocalRect` for a 1×1 footprint at scale 1 returns
  a rect **at least `HIT_MIN_PX` in both axes** (it is 10 × 13 today — the failing assertion), and
  scales inversely with the sprite scale so the screen size is constant; `resolveHit` picks the door
  when a door and an agent overlap, the agent when an agent and a structure overlap, and `null` for
  an empty list; **the door is a child**: a structural test reads `entities.ts` and asserts the door
  is added via `sprite.addChild` and that `entities.ts` contains no `doorZIndex` (the function is
  deleted, and its deletion is the test); the landed door/zIndex assertions in `entities.test.ts`
  are **rewritten, not deleted**, to assert child-of-parent instead.
- [ ] **Step 2:** Run `pnpm vitest run packages/web/src/render/entities.test.ts` — FAIL.
- [ ] **Step 3: Implement.** The door's *appearance* stops being a dark rectangle: it is the
  building art's own doorway when the manifest declares one, and otherwise a **palette-token
  threshold plate** — a 2 px ink lintel over a `--deep` recess with a `--honey` step, in the same
  9-slice pixel language the chrome uses — plus the existing hover lift. No new generated art is
  commissioned here; v1 **Task 17** already commissions the structure set and gains one line
  requiring a doorway in every enterable kind's art (see §Amendments).
- [ ] **Step 4:** Suite + typecheck PASS; live check: stand a founder on a door and click it — the
  room opens, not the inspector (audit M5's repro, inverted into a pass).
- [ ] **Step 5: Commit** `fix(web): a door belongs to its building — and it is a door, not a dark rectangle`.

### Task 74: Tooltips that land where they point *(U10, and audit M8)*

**Files:** Create `packages/web/src/render/tooltip.ts`, `tooltip.test.ts`; Modify
`packages/web/src/render/nameTags.ts`, `characters.ts`, `entities.ts`, `bubbles.ts`

**THE DEFECTS:** (1) the shared tag is positioned at `sprite.y - sprite.height` (`entities.ts:190`)
— for a building anchored at its base with a 1.85× sprite, that is somewhere above the roof and to
nobody's knowledge where; (2) the door tag uses `door.y - DOOR_H` (`:257`), a different rule;
(3) per-body tags use a third rule (`characters.ts:293`); (4) nothing clamps to the viewport, so a
tag on a screen-edge sprite is drawn off-screen; (5) nothing de-conflicts, so a tag and a bubble
composite into an unreadable pile (audit M8); (6) the tag survives an interior transition because
a destroyed sprite never fires `pointerout` — handled ad hoc at `entities.ts:333`.

**Interfaces — Produces:**
```ts
export type Anchor = { sx: number; sy: number; halfW: number; topY: number }   // world space
export type Placed = { sx: number; sy: number; side: 'above' | 'below' | 'left' | 'right' }

/** One rule for every tag in the product. Prefers above-centre; flips below when the anchor's
 *  top is within `EDGE_PAD` of the viewport top; slides horizontally to stay inside; and
 *  offsets vertically by `STACK_STEP` for each occupied box it would otherwise overlap. */
export const TAG_GAP_PX = 6, EDGE_PAD_PX = 8, STACK_STEP_PX = 4
export function placeTag(a: Anchor, size: { w: number; h: number }, view: { x: number; y: number; w: number; h: number }, occupied: ReadonlyArray<{ x: number; y: number; w: number; h: number }>): Placed

/** The anchor for each hoverable class — the ONE place a "where does its label go" answer
 *  lives. A building's anchor is the top of its DRAWN sprite, which is why it needs the
 *  sprite bounds and not the footprint. */
export function anchorForSprite(sprite: { x: number; y: number }, bounds: { width: number; height: number }): Anchor

/** A single owner for every world tag, so two of them can never be up at once by accident
 *  and a torn-down sprite cannot leave one behind. */
export type TagOwner = 'hover' | 'door' | 'selection'
export type TooltipLayer = {
  show(owner: TagOwner, text: string, a: Anchor): void
  hide(owner: TagOwner): void
  hideAll(): void
  destroy(): void
}
export function createTooltipLayer(layers: LayerSet, view: () => { x: number; y: number; w: number; h: number }): TooltipLayer
```
- **Consumes:** Task 69 `layers.worldText`, Task 72 `bodyHitPolygon` (the anchor's `halfW` is the
  capsule's shoulder width, so a tag is centred on the *figure*, not on the sprite's padding).

- [ ] **Step 1: Write the failing tests** — `placeTag` centres above the anchor with a `TAG_GAP_PX`
  gap in the ordinary case; flips to `below` when the anchor is `EDGE_PAD_PX` from the top and the
  tag would clip; slides right when the anchor is at the left edge and never leaves the view on any
  side (assert over 40 sampled anchor positions including all four corners); stacks by exactly
  `STACK_STEP_PX` per overlapping occupied box and stops overlapping after at most 3 steps;
  `anchorForSprite` for a base-anchored 1.85× building returns a `topY` **above the drawn roof** and
  an `sx` at the sprite's centre; `createTooltipLayer` with two owners showing at once keeps both
  boxes disjoint; `hideAll()` clears every owner (this is the M8 fix, and the interior transition
  calls it); a tag is never shown for an empty string.
- [ ] **Step 2:** Run `pnpm vitest run packages/web/src/render/tooltip.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Speech bubbles register their boxes as `occupied` so a tag never
  composites on a line of dialogue. The interior transition calls `hideAll()` on `entering`.
- [ ] **Step 4:** Suite + typecheck PASS; live check M8's repro (hover a door, enter, Escape) and
  confirm no orphan tag.
- [ ] **Step 5: Commit** `fix(web): every label points at the thing it names, and stays on the screen`.

---

# Phase O — CAMERA AND CONTROLS *(U19, U20, U21, U22)*

### Task 75: Smooth, damped, bounded zoom *(U19)*

**Files:** Create `packages/web/src/render/camera.ts`, `camera.test.ts`; Modify
`packages/web/src/render/scene.ts`, `scene.test.ts`, `packages/web/src/render/cameraNav.ts`

**THE DEFECT:** F-4. One integer step per wheel *event*, no accumulation, no time gate, no
animation, anchored on the screen centre. A trackpad flick is thirty events.

**The law this obeys and the law it amends:** P18. Rest stops stay exact so the pixel grid stays
exact; the *transit* between them is animated. `0.5` joins the stop set because a reciprocal of an
integer samples NEAREST exactly — every 2 world px become 1 screen px with no resampling — and
because the audit measured the settlement occupying **under 15 %** of the stage at the old
`ZOOM_MIN = 1` (R8).

**Interfaces — Produces:**
```ts
export const ZOOM_STOPS = [0.5, 1, 2, 3, 4] as const
export type ZoomStop = (typeof ZOOM_STOPS)[number]
export const ZOOM_SETTLE_MS = 180
/** One notch of a mouse wheel is 120; a trackpad sends many small deltas. Steps fire on
 *  ACCUMULATED delta crossing the threshold, and the accumulator decays between gestures, so
 *  one flick is one step and a deliberate scroll is a deliberate step. */
export const WHEEL_STEP_DELTA = 120
export const WHEEL_GESTURE_GAP_MS = 140
/** No second step may fire inside this window however hard the wheel is spun. This is the
 *  line that makes "I can't control my zoom at all" impossible. */
export const ZOOM_STEP_COOLDOWN_MS = 200

export type ZoomState = {
  stop: ZoomStop            // where it is going, and where it will be at rest
  from: number              // the scale it left
  startedMs: number
  accum: number             // wheel delta since the gesture began
  lastWheelMs: number
  lastStepMs: number
}
export function initialZoom(stop?: ZoomStop): ZoomState

/** Pure. Returns the next state; identical input, identical output. */
export function zoomWheel(prev: ZoomState, deltaY: number, nowMs: number): ZoomState
export function zoomTo(prev: ZoomState, stop: ZoomStop, nowMs: number): ZoomState

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3)
/** The scale to apply this frame. EXACTLY `prev.stop` at and after `startedMs + ZOOM_SETTLE_MS`
 *  — the pixel law holds at rest, and only at rest. */
export function zoomScaleAt(s: ZoomState, nowMs: number): number
export function zoomSettled(s: ZoomState, nowMs: number): boolean
```

> **AMENDED BY C12a batch 3, from measurement in the page.** `zoomWheel` as written below
> never zooms a real mouse. "One notch is 120" is a convention, not a fact — Chrome commonly
> reports 100 and some mice 53 — and with a gesture reset each notch arrives alone, below the
> threshold, and is discarded: five deliberate 100-delta notches leave the camera at stop 1.
> A gesture's FIRST event is therefore itself a step, above a `WHEEL_MIN_DELTA` dead zone;
> `WHEEL_STEP_DELTA` governs continued travel inside one gesture and the cooldown governs the
> rate. The thirty-event flick still advances exactly one stop, because the cooldown holds.

**Implementation of the two functions the complaint lives in:**
```ts
export function zoomWheel(prev: ZoomState, deltaY: number, nowMs: number): ZoomState {
  // a new gesture starts with a clean accumulator, so a flick cannot inherit the last one
  const fresh = nowMs - prev.lastWheelMs > WHEEL_GESTURE_GAP_MS
  const accum = (fresh ? 0 : prev.accum) + deltaY
  const cooling = nowMs - prev.lastStepMs < ZOOM_STEP_COOLDOWN_MS
  if (cooling || Math.abs(accum) < WHEEL_STEP_DELTA) {
    return { ...prev, accum, lastWheelMs: nowMs }
  }
  const dir = accum < 0 ? 1 : -1                        // wheel up zooms in
  const i = ZOOM_STOPS.indexOf(prev.stop)
  const next = ZOOM_STOPS[Math.min(ZOOM_STOPS.length - 1, Math.max(0, i + dir))]!
  if (next === prev.stop) return { ...prev, accum: 0, lastWheelMs: nowMs }
  return {
    stop: next, from: zoomScaleAt(prev, nowMs), startedMs: nowMs,
    accum: 0, lastWheelMs: nowMs, lastStepMs: nowMs,
  }
}

export function zoomScaleAt(s: ZoomState, nowMs: number): number {
  const t = (nowMs - s.startedMs) / ZOOM_SETTLE_MS
  if (t >= 1) return s.stop                              // EXACT at rest — the pixel law
  if (t <= 0) return s.from
  return s.from + (s.stop - s.from) * easeOutCubic(t)
}
```
- **Consumes:** nothing. **Produces for:** Tasks 76, 77, 78; v1 Tasks 9, 32, 46 (`PINCH_SNAP_RATIO`
  is re-expressed against `ZOOM_STOPS` — see §Amendments).

- [ ] **Step 1: Write the failing tests** —
  - **THE COMPLAINT, AS A TEST:** feed **thirty** `deltaY: -12` events over 100 ms (a trackpad
    flick) and assert the zoom advanced **exactly one stop**. On the landed `onWheel` this advances
    three (clamped) — write that in the comment.
  - Two deliberate mouse notches (`-120`) 300 ms apart advance **two** stops; the same two 50 ms
    apart advance **one** (`ZOOM_STEP_COOLDOWN_MS`).
  - `zoomScaleAt` is continuous, monotonic across the transit, equals `from` at t=0 and **exactly**
    `stop` at `ZOOM_SETTLE_MS` and at `ZOOM_SETTLE_MS + 10_000`.
  - `zoomSettled` is false at 179 ms and true at 180 ms.
  - The stop set is never left: 50 zoom-out events from `0.5` stay at `0.5`; 50 in from `4` stay at
    `4`; **no state ever holds a scale outside `ZOOM_STOPS` once settled** (assert over a 500-event
    random walk with a seeded RNG).
  - A gesture reversal mid-transit (`zoomWheel` in the opposite direction at t=90 ms) starts from
    the **current interpolated** scale, so the camera never jumps.
  - Every function is pure: same inputs twice, same outputs.
- [ ] **Step 2:** Run `pnpm vitest run packages/web/src/render/camera.test.ts` — FAIL.
- [ ] **Step 3: Implement.** `scene.ts` gains `setZoomAt(stop, screenX, screenY)` which keeps the
  **world point under the pointer** fixed rather than the screen centre, and a ticker step that
  applies `zoomScaleAt` each frame. `onWheel` becomes six lines: read `deltaY`, call `zoomWheel`,
  store. The DOM half has no logic (P6).
- [ ] **Step 4:** Suite + typecheck PASS; `scene.test.ts` and `cameraNav.test.ts` green; web build
  succeeds; live check on a trackpad **and** a wheel mouse, both recorded.
- [ ] **Step 5: Commit** `fix(web): zoom you can steer — one gesture, one step, and it eases into place`.

### Task 76: The camera knows the edges, and there is a view of the whole town *(U19, and audit R8)*

> **AMENDED BY C12a batch 3, from measurement.** Two of this task's stated numbers are
> arithmetically incompatible and the parenthetical describes a town that does not exist.
> The real settlement is 23 x 18 tiles: **528 x 256 px of ground, 584 x 376 px AS DRAWN**
> (a building sprite overhangs its own ground upward). Therefore:
> - `fitStop` and `stageFill` both answer to the DRAWN box (`drawnBoundsOf`), not the
>   footprint. Fitting the footprint chose 3x and cut the roofs off the stage.
> - `stageFill` at the landed 1x is **0.1444** — which is the audit's "under 15 %",
>   reproduced rather than asserted. At the new first frame (`fitStop` = 2 on 1728 x 880)
>   it is **0.5776**, against `STAGE_FILL_MIN` 0.45.
> - `fitStop` returns whatever the box it is handed fits at. The FIRST FRAME hands it the
>   SETTLEMENT — that is what "a view of the whole town" means, and it is the only reading
>   under which the fill floor is met. Handed the terrain box it still returns 1 on the
>   48 x 48 map and 0.5 on a 128 x 128 one, as the task says.
> - `FIT_MARGIN_PX` is **24**, not 48: Task 77's bar takes 56 px off the stage, and at 48
>   the fit fell a whole stop back to the small overview R8 is about.

**Files:** Modify `packages/web/src/render/camera.ts`, `camera.test.ts`, `packages/web/src/render/scene.ts`

**THE DEFECT:** nothing clamps the camera. `scene.ts:238-249` and `panBy` add pixels without bound,
so the town can be pushed entirely off screen with one drag and there is no way back except
`Center`. And `ZOOM_MIN = 1` was the widest view available: the audit measured the settlement at
**under 15 % of a 1728 × 880 stage**, the rest blank field.

**Interfaces — Produces:**
```ts
/** The world-space box the map occupies, from the terrain array. Recomputed on terrain change,
 *  never stored. */
export function cameraBoundsOf(terrain: TileId[][]): { minX: number; maxX: number; minY: number; maxY: number }
/** Clamp a camera position so the world box always covers the viewport; when the world is
 *  SMALLER than the viewport at this scale, it is centred instead of clamped, which is the
 *  only sane reading of "in bounds" for a small map. */
export function clampCamera(pos: { x: number; y: number }, scale: number, bounds: ReturnType<typeof cameraBoundsOf>, screen: { w: number; h: number }): { x: number; y: number }
/** The stop at which the whole settlement is on screen with a margin. Used for the overview
 *  control and for the first frame. */
export const FIT_MARGIN_PX = 48
export function fitStop(bounds: ReturnType<typeof cameraBoundsOf>, screen: { w: number; h: number }): ZoomStop
/** The fraction of the stage the settlement's own bounding box occupies. The number R8 is
 *  about, and the number the gate asserts on the first frame. */
export function stageFill(structureBounds: ReturnType<typeof cameraBoundsOf>, scale: number, screen: { w: number; h: number }): number
export const STAGE_FILL_MIN = 0.45
```
- **Consumes:** Task 75 `ZOOM_STOPS`, Task 59's town.

- [ ] **Step 1: Write the failing tests** — `cameraBoundsOf` on a 48×48 map returns the dimetric
  extent (`minX = −h·TILE_W/2`, `maxY = (w+h)·TILE_H/2`, exact); `clampCamera` at scale 4 refuses a
  position that would show blank on the right and returns the nearest legal one; at a scale where
  the world is smaller than the viewport it **centres** and is idempotent; a 500-step random pan walk
  never produces a position where the viewport shows the outside of the world box; `fitStop` on the
  Task-59 town at 1728×880 returns `1` (not `0.5` — the town is 34×30 and 1× already fits with
  margin) and on a 128×128 world returns `0.5`; **`stageFill` on the landed first frame is below
  `STAGE_FILL_MIN`** (the failing assertion that proves R8) and at or above it after the first-frame
  change.
- [ ] **Step 2:** Run `pnpm vitest run packages/web/src/render/camera.test.ts` — FAIL.
- [ ] **Step 3: Implement.** The first frame centres on the **structures' centroid** at `fitStop`,
  not on the terrain array's centre (`scene.ts:299` centres on the middle of a 48×48 grid, which on
  a town anchored at `y: 9` is not the town). Every pan, drag and follow tick runs through
  `clampCamera`.
- [ ] **Step 4:** Suite + typecheck PASS; capture the first frame and record the measured
  `stageFill`.
- [ ] **Step 5: Commit** `feat(web): the town cannot be lost off the edge, and the first frame is of the town`.

### Task 77: The bottom control bar *(U22)*

**Files:** Create `packages/web/src/ui/controlBar.ts`, `controlBar.test.ts`,
`packages/web/src/ui/ControlBar.tsx`, `ControlBar.test.ts`; Modify `packages/web/src/App.tsx`,
`packages/web/src/ui/chrome.css`, `packages/web/src/ui/CameraHud.tsx`

**THE ASK, verbatim:** *"I should also have controls at the bottom to let me do what I want."*
Today the only floating control is a 3-button `.camera-hud` pinned bottom-right
(`chrome.css:322-327`), and the lens nav is in the top bar 900 px away.

**Interfaces — Produces:**
```ts
export const CONTROL_GROUPS = ['time', 'camera', 'lens', 'view'] as const
export type ControlGroup = (typeof CONTROL_GROUPS)[number]
export type ControlItem = {
  id: string
  group: ControlGroup
  label: string                 // the spoken label; also the tooltip
  glyph: string                 // an 8×8 pixel glyph id — NEVER an emoji (P3, the landed law)
  state?: 'on' | 'off'          // a toggle renders aria-pressed; absent = an action
  disabled?: boolean
  disabledReason?: string       // shown, not merely implied — an honest refusal
}
/** The bar's contents are DERIVED from what the viewer can currently do, so the bar can never
 *  advertise a control that does nothing. */
export function controlItems(ctx: {
  lens: Lens; live: boolean; zoom: ZoomStop; following: string | null
  insideId: string | null; overlay: OverlayKind; playing: boolean
}): ControlItem[]
export type ControlAction =
  | { kind: 'lens'; lens: Lens } | { kind: 'zoom'; to: ZoomStop } | { kind: 'fit' }
  | { kind: 'live' } | { kind: 'follow'; agentId: string | null } | { kind: 'overlay'; to: OverlayKind }
  | { kind: 'exit-interior' } | { kind: 'hud'; op: 'hide' | 'show' | 'move' }
export function actionFor(item: ControlItem): ControlAction
export const CONTROL_BAR_H = 56
```
- **Consumes:** Tasks 75, 76; v1 Task 10 `OverlayKind`; `Lens` from `route.ts`.

- [ ] **Step 1: Write the failing tests** — `controlItems` on the map lens returns one item per
  group and **never an empty group**; the `exit-interior` item appears **only** when `insideId` is
  non-null; zoom-out is `disabled` with a `disabledReason` at `0.5` and zoom-in at `4`, and the
  reason string is human-framed and passes `GAMIFICATION_BAN`; `actionFor` is **total over every id
  `controlItems` can produce** (iterate every context combination in a small product and assert no
  throw and no `undefined`); the rendered bar through `react-dom/server` has one `<button>` per
  item, every one **≥ 44 px** by its class (P14), every one with a spoken label, `aria-pressed` on
  exactly the toggles, and **no `\p{Extended_Pictographic}` anywhere**; the bar's markup passes
  `GAMIFICATION_BAN`; the bar carries `role="toolbar"` with roving tabindex and Left/Right move
  between items.
- [ ] **Step 2:** Run `pnpm vitest run packages/web/src/ui/controlBar.test.ts packages/web/src/ui/ControlBar.test.ts` — FAIL.
- [ ] **Step 3: Implement.** `.camera-hud` is **retired into** the bar's `camera` group — one
  control surface, not two (audit m8's lesson about three hierarchy levels wearing one class). The
  bar is a grid row of `<main>`, not an absolute overlay, so P19 holds by construction.
- [ ] **Step 4:** Suite + typecheck PASS; web build succeeds; walk the bar with the keyboard only.
- [ ] **Step 5: Commit** `feat(web): a bar at the bottom with the controls a viewer reaches for`.

### Task 78: Controls the viewer can move, and hide *(U20, U21)*

**Files:** Create `packages/web/src/ui/hudLayout.ts`, `hudLayout.test.ts`,
`packages/web/src/ui/HudDock.tsx`, `HudDock.test.ts`; Modify `App.tsx`, `chrome.css`,
`packages/web/src/ui/ControlBar.tsx`

**THE ASK:** *"I need more controls that are out of the way so I can still observe the town"* and
*"be able to MOVE/HIDE the controls to get an unobstructed view."*

**Interfaces — Produces:**
```ts
export const DOCK_SLOTS = ['bottom', 'top', 'left', 'right', 'hidden'] as const
export type DockSlot = (typeof DOCK_SLOTS)[number]
export const DOCKABLE = ['controlBar', 'cameraHud', 'timeline', 'statusStrip', 'fps', 'minimap'] as const
export type Dockable = (typeof DOCKABLE)[number]

export type HudLayout = Readonly<Record<Dockable, DockSlot>>
export const DEFAULT_HUD: HudLayout
/** Persisted per viewer (P4). Unknown keys dropped, bad JSON → defaults, never throws. */
export function loadHud(storage: Storage): HudLayout
export function saveHud(storage: Storage, l: HudLayout): void

export type HudEv =
  | { kind: 'dock'; what: Dockable; to: DockSlot }
  | { kind: 'hide-all' } | { kind: 'show-all' } | { kind: 'reset' }
export function hudReducer(prev: HudLayout, ev: HudEv): HudLayout

/** The escape hatch that makes hiding safe: however much is hidden, ONE always-present
 *  affordance brings it back, and the keyboard shortcut works from anywhere. */
export const HUD_TOGGLE_KEY = 'h'
export const HUD_PEEK_PX = 12       // a hidden dock leaves a 12px grab handle, never nothing
export function hiddenCount(l: HudLayout): number
export function isFullyHidden(l: HudLayout): boolean
```
- **Consumes:** Task 77.

- [ ] **Step 1: Write the failing tests** — `hudReducer` docks one item without moving the others;
  `hide-all` hides every `Dockable` **except** the reveal handle's own owner, and
  `isFullyHidden(hudReducer(DEFAULT_HUD, {kind:'hide-all'}))` is true; `show-all` restores exactly
  `DEFAULT_HUD` (round-trip); `reset` from any state equals `DEFAULT_HUD`; `loadHud` on `'{}'`
  equals `DEFAULT_HUD`, on `'{"controlBar":"nope"}'` drops the bad slot, on `'not json'` returns
  defaults without throwing; a round-trip through a fake `Storage` is stable; **the un-trap
  assertion:** for every reachable layout, at least one element with a keyboard-reachable control
  is rendered (assert on the markup produced from 20 sampled layouts) — *a viewer can never hide
  the way back*; the rendered dock handle is a real `<button>` ≥ 44 px with a spoken label; drag
  logic lives in a reducer over `{kind:'drag', to: DockSlot}`, so P6 holds and no test needs a DOM.
- [ ] **Step 2:** Run `pnpm vitest run packages/web/src/ui/hudLayout.test.ts packages/web/src/ui/HudDock.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Docking is **slot-based, not free pixel dragging** — a free-dragged
  panel is a panel a viewer can lose, and four slots plus hidden covers every case the ask names.
  `H` toggles; the handle persists at `HUD_PEEK_PX`.
- [ ] **Step 4:** Suite + typecheck PASS; web build succeeds; live check: hide everything, press
  `H`, get it all back.
- [ ] **Step 5: Commit** `feat(web): move the controls, or put them away — the town is what you came for`.

---

# Phase P — THE PANELS *(U12, U13, U14, U15, U16, U17, U18)*

**Re-scoped by P22.** The default experiment starts everyone neutral, so these panels cannot show
what a person *is*; they show what a person **has become**, and they must be dignified on day 0 and
visibly richer on day 5 with no code change.

### Task 79: One status vocabulary *(U13)*

**Files:** Create `packages/web/src/ui/status.ts`, `status.test.ts`; Modify
`packages/web/src/ui/rosterModel.ts`, `RosterPanel.tsx`, `InspectorPanel.tsx`,
`packages/web/src/ui/interaction.ts`

**THE DEFECT, exactly:** F-5. `rosterModel.ts:32` sets `doing: … : 'resting'` while
`RosterPanel.tsx:47` renders a separate `asleep` badge, so **a sleeping founder's card carries both
"asleep" and "resting"** — the user's own example. Four more "rest" words are in flight
(`InspectorPanel.tsx:155` "at rest forever", `:187` "resting", the roster footer, and `awake`).

**Interfaces — Produces:**
```ts
/** STATE: exactly ONE per person per surface. First match wins, in this order. */
export const STATES = ['gone', 'collapsed', 'asleep', 'working', 'walking', 'talking', 'eating', 'idle'] as const
export type State = (typeof STATES)[number]
export const STATE_PRIORITY: readonly State[] = STATES   // the array IS the priority; one table

export const STATE_WORD: Readonly<Record<State, string>> = {
  gone:      'No longer living',
  collapsed: 'Collapsed',
  asleep:    'Asleep',
  working:   'Working',        // overridden by the verb's own gerund when there is one
  walking:   'Walking',
  talking:   'Talking',
  eating:    'Eating',
  idle:      'Between things', // NOT "resting", NOT "awake", NOT "idle" — those are the collision
}

/** CONDITION: zero or more, from a DISJOINT vocabulary. A condition is never a state, so it can
 *  never duplicate one. */
export const CONDITIONS = ['unwell', 'hurt', 'hungry', 'cold', 'thirsty', 'spent'] as const
export type Condition = (typeof CONDITIONS)[number]
export const CONDITION_WORD: Readonly<Record<Condition, string>>

/** DRIVE (P22 hook): what a person seems to WANT, once the society lane emits it. Empty today,
 *  and an empty set renders nothing at all — never a placeholder chip. */
export const DRIVES = [] as const
export type Drive = string
export function drivesOf(a: AgentView): Drive[]

export function statusOf(a: AgentView): State
/** The word to print: the verb's own gerund when the person is acting, else STATE_WORD. */
export function stateWord(a: AgentView): string
export function conditionsOf(a: AgentView): Condition[]

/** P17's mechanical guard. Any of these appearing as a user-facing literal outside status.ts
 *  is the synonym bug coming back. */
export const BANNED_STATUS_LITERALS: readonly string[] =
  ['resting', 'Resting', 'awake', 'Awake', 'idle', 'Idle', 'at rest', 'sleeping', 'Sleeping']
export function statusLiteralOffenders(files: ReadonlyArray<{ path: string; source: string }>): string[]
```
- **Consumes:** `AgentBody` (landed); C11's optional `thirst`/`afflictions` (absent ⇒ those
  conditions never match).

- [ ] **Step 1: Write the failing tests** —
  - **THE USER'S EXAMPLE, AS A TEST:** for a sleeping agent with `activity === null`,
    `stateWord()` returns exactly one word, it is `'Asleep'`, and
    `conditionsOf()` does **not** contain anything meaning rest. Then render `RosterPanel` through
    `react-dom/server` for that agent and assert the markup contains `'Asleep'` **exactly once** and
    the substring `'resting'` **zero times**. On today's code that markup contains both.
  - `statusOf` fires **each row of `STATES` exactly once** on a fixture per row, and priority is
    asserted directly: a collapsed sleeper is `collapsed`; a walking talker is `talking`; a dead
    agent is `gone` whatever else is true.
  - `STATE_WORD` and `CONDITION_WORD` are **total** over their unions (a `Record`, so an omission
    is a compile error) and their **value sets are disjoint** (asserted, so a condition can never
    become a synonym of a state).
  - Every word passes `GAMIFICATION_BAN` and contains no machine vocabulary and no digit.
  - `drivesOf` returns `[]` today for every fixture, and the roster renders **no drive element at
    all** for an empty set (P22.2 — an empty chip rail is a placeholder).
  - **The real scan:** read every `.ts`/`.tsx` under `packages/web/src` off disk and assert
    `statusLiteralOffenders(...)` is `[]`. This fails today at the five known sites; the list goes
    in the batch report.
- [ ] **Step 2:** Run `pnpm vitest run packages/web/src/ui/status.test.ts` — FAIL.
- [ ] **Step 3: Implement.** `rosterModel.gerund` moves into `status.ts` unchanged (it is the T7
  gerund ruling and must not be re-litigated). Every call site imports from `status.ts`.
- [ ] **Step 4:** Full web suite + typecheck PASS.
- [ ] **Step 5: Commit** `fix(web): one word for what a person is doing — "Asleep" and "Resting" stop being the same person`.

### Task 80: Where they are, in words *(U12)*

**Files:** Create `packages/web/src/ui/place.ts`, `place.test.ts`

**THE ASK:** U12 requires **WHERE THEY ARE** on every roster row. Nothing in the product computes
it. `agentRuntime.ts:57` has a `nearestStructureKind` for the *mind*, in `@sj/agents`, which P1
forbids the viewer from importing — so this is a viewer-side reimplementation, and the test says so.

**Interfaces — Produces:**
```ts
export type Place = { words: string; kind: 'inside' | 'at' | 'on' | 'out' }
export const AT_RADIUS_TILES = 2

/** First match wins:
 *  1. indoors            → "inside Amara's hut" | "inside the storehouse"   (owner-aware)
 *  2. within AT_RADIUS   → "at the well" | "by Yusuf's hut"                 (nearest structure)
 *  3. a named terrain    → "on the river bank" | "in the forest" | "in the fields"
 *  4. nothing near       → "out past the edge of town"
 *  Never a coordinate, never a structure id, never a kind slug with an underscore. */
export function placeOf(state: WorldState, agentId: string): Place
export function structureWords(state: WorldState, s: Structure): string    // "Amara's hut" | "the well"
export const TERRAIN_WORDS: Readonly<Record<TileId, string | null>>        // null = unnamed ground
```
- **Consumes:** Task 59's owned structures; `Structure.owner`; `TileId` (0..7 today; a wider union
  when C11 lands simply adds rows to `TERRAIN_WORDS`, which is a `Record` so an omission is a
  compile error).

- [ ] **Step 1: Write the failing tests** — an agent with `insideId` set to an owned hut yields
  `"inside Amara's hut"` with a **typographic apostrophe** (`’`, matching the landed `OWNS` const);
  inside a public building yields `"inside the storehouse"`; standing 1 tile from the well yields
  `"at the well"` and 2 tiles yields `"at the well"` and 3 tiles does **not**; ties between two
  equidistant structures resolve **deterministically by id** (assert twice); standing on water-edge
  earth yields the bank phrase and in open grass with nothing near yields the out-of-town phrase;
  `TERRAIN_WORDS` is total over `TileId`; **no output contains a digit, an underscore, or the
  substring `structure_`** (asserted over 200 sampled positions on the Task-59 town); `placeOf` for
  an unknown agent id returns the out-of-town place rather than throwing.
- [ ] **Step 2:** Run `pnpm vitest run packages/web/src/ui/place.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Suite + typecheck PASS.
- [ ] **Step 5: Commit** `feat(web): a person is somewhere, and the somewhere has a name`.

### Task 81: The roster row — a character roster, not a list *(U12)*

**Files:** Create `packages/web/src/ui/roster/rosterRow.ts`, `rosterRow.test.ts`,
`packages/web/src/ui/roster/RosterRow.tsx`, `RosterRow.test.ts`; Modify
`packages/web/src/ui/RosterPanel.tsx`, `RosterPanel.test.ts`, `packages/web/src/ui/chrome.css`

**THE ASK, verbatim:** *"TOWNSFOLK TAB — redesign as a video-game character roster. Required per
row: portrait · name · current status · a MOOD STATUS ICON · WHERE THEY ARE."* Today
(`RosterPanel.tsx`) a card is a bust, a name, and three badges — one of which duplicates another
(F-5) — and the audit measured **~60 % of each card blank** with the lower 45 % of the panel empty
(R1).

**P22 shapes this row.** Every field below is **run-produced**. On sim-day 0 the row is
name + age band + status + place + a neutral mood — complete, dignified, and visibly a person who
has not lived yet. By day 5 the same row carries a mood that moved, a place that means something,
and the "with" field populated. No field is authored, and none is a placeholder.

**Interfaces — Produces:**
```ts
export type RosterRow2 = {
  id: string
  name: string
  ageWords: string                    // "grown" | "elder" — a band, never a number (P3)
  portrait: { url: string } | { bust: BustStyle } | { token: string }   // three honest fallbacks
  mood: Expression                    // v1 Task 2's moodOf — the ONE face table, reused
  state: string                       // Task 79 stateWord — exactly one
  conditions: Condition[]             // Task 79 — a disjoint vocabulary
  place: Place                        // Task 80
  with: string[]                      // names of people within earshot — run-produced company
  substance: number                   // Task 83 — 0 on day 0, rising with what they have done
}
export function rosterRows2(state: WorldState, records: AssetRecord[], bonds: BondsResponse | null, nowTick: number): RosterRow2[]

/** Sorting is a viewer preference, never a ranking (P3): by name, by where they are, or by who
 *  is doing something right now. No "best", no order badge, no number on a card. */
export const ROSTER_SORTS = ['name', 'place', '活'] as const   // see test: the third id is 'active'
export type RosterSort = 'name' | 'place' | 'active'
export function sortRoster(rows: RosterRow2[], by: RosterSort): RosterRow2[]

/** The mood icon is drawn, never an emoji (the landed law). 16×16 pixel glyph per Expression. */
export const MOOD_GLYPH: Readonly<Record<Expression, ReadonlyArray<readonly [number, number, string]>>>
```
- **Consumes:** v1 **Task 2** `Expression`/`moodOf`/`portraitUrl` — **and this creates a hard
  ordering dependency: v1 Task 2 must execute before Task 81.** See §Amendments, which moves Task 2
  into Phase P's batch as a prerequisite.

- [ ] **Step 1: Write the failing tests** —
  - `rosterRows2` returns **every one of U12's five required fields non-empty for every living
    agent**, on a day-0 fixture where the agent has done nothing at all (P22.2). Assert field by
    field, so a regression names the field it dropped.
  - **The day-0 / day-5 arc (P22.3):** build two fixtures of the same agent, one at tick 0 and one
    after a scripted five days, and assert `substance` strictly increased, `with` went from empty to
    non-empty, and the rendered markup **differs**. A row that renders identically on both is the
    defect this test exists for.
  - `portrait` prefers the codex portrait, falls back to the v4 bust, then to the initial token —
    never to a broken image; asserted on all three availabilities.
  - `mood` uses `moodOf` and never a second table (assert by calling `moodOf` in the test and
    comparing).
  - `state` is exactly one string and passes the Task 79 scan; `conditions` may be empty.
  - `sortRoster` is stable and total over `RosterSort`; sorting **never** changes the set;
    `'active'` puts people with an activity first and is not a ranking (no index is rendered —
    asserted on the markup).
  - `MOOD_GLYPH` is **total over `EXPRESSIONS`** and every fill is a MASTER_PALETTE hex; no glyph
    is byte-identical to another (seven faces that look alike is the same defect as one face).
  - The rendered row through `react-dom/server`: one `<button>` ≥ 44 px, a full spoken label naming
    all five fields, `GAMIFICATION_BAN` clean, no `\p{Extended_Pictographic}`, and **no number
    anywhere in the visible text** (`substance` drives layout, it is never printed).
- [ ] **Step 2:** Run `pnpm vitest run packages/web/src/ui/roster/rosterRow.test.ts packages/web/src/ui/roster/RosterRow.test.ts` — FAIL.
- [ ] **Step 3: Implement.** The row is a **grid**, not a stack of badges: a 48 px portrait rail, a
  name+state column, a mood glyph, and a place line — the four-column shape a game roster uses,
  which is what makes it scannable at a glance. The panel scrolls one column on narrow layouts.
- [ ] **Step 4:** Suite + typecheck PASS; web build succeeds; capture the roster on a day-0 world
  and on a day-5 world and put both in the batch report side by side.
- [ ] **Step 5: Commit** `feat(web): the townsfolk roster — a face, a name, what they are doing, how they are, and where`.

### Task 82: The row expands into who they have become *(U12, P22)*

**Files:** Create `packages/web/src/ui/roster/RosterExpanded.tsx`, `RosterExpanded.test.ts`,
`packages/web/src/ui/roster/expand.ts`, `expand.test.ts`; Modify `RosterPanel.tsx`, `App.tsx`,
`packages/web/src/ui/route.ts`, `route.test.ts`

**THE ASK, verbatim:** *"Clicking a row EXPANDS into the full view."* Today clicking calls
`onPick` (`RosterPanel.tsx:33`), which pushes a route and **replaces** the list with the inspector —
which is why the audit found a back-button class of bug and why C10 needed three separate ways back
(`route.ts:50-75`).

**The controller ruling makes this the most important panel in the product:** it is where a
run-produced biography is legible. It answers *what have they done, who do they know and how well,
what are they good at, what do they seem to want* — none of which is authored.

**Interfaces — Produces:**
```ts
/** Expansion is a state of the LIST, not a navigation. One row open at a time; Escape closes it;
 *  the list never unmounts, so there is no "back" to get wrong. */
export type ExpandState = { openId: string | null }
export type ExpandEv = { kind: 'toggle'; id: string } | { kind: 'close' } | { kind: 'next' } | { kind: 'prev' }
export function expandReducer(prev: ExpandState, ev: ExpandEv, ids: readonly string[]): ExpandState

/** The becoming, as sections. Every section is RUN-PRODUCED and every one is allowed to be
 *  empty on day 0 with copy that says so honestly (P22.2). */
export type Becoming = {
  lived: string           // "Six days in the town." — the one authored-shaped sentence, and it
                          //  is arithmetic, not a trait
  done: Array<{ words: string; day: number }>        // what they have actually done, from the log
  knows: Array<{ id: string; name: string; level: BondLevel; type: BondType; words: string }>
  good: Array<{ words: string }>                     // skill BANDS in words, never xp (§11/§23)
  wants: Array<{ words: string }>                    // drives — empty until the society lane emits
  changed: Array<{ day: number; words: string }>     // P22.5 — the days this person became different
}
export function becomingOf(input: BecomingInput): Becoming
export const SECTION_EMPTY: Readonly<Record<keyof Becoming, string>>
```
- **Consumes:** Task 83 `substanceOf`; Task 84 `bondLevel`/`bondTypeOf`; v1 Task 22
  `skillPhrase`/`afflictionPhrase`/`bars` (**Task 22 is amended, not duplicated** — the expanded row
  renders v1 Task 22's model, and the inspector route stays as the deep-link target).

- [ ] **Step 1: Write the failing tests** —
  - `expandReducer` toggles open and closed; opening a second row closes the first; `close` from
    any state clears; `next`/`prev` move within `ids` and **wrap**; an id not in `ids` is ignored
    rather than opening nothing-shaped state.
  - **THE BUG THAT CANNOT COME BACK:** for **every** reachable `ExpandState`, the rendered markup
    still contains every row of the list (assert the row count). Expansion cannot remove the way
    back, because the way back is never gone.
  - `becomingOf` on a **day-0** fixture returns every section empty and every `SECTION_EMPTY` line
    present; each line names *this person has not done it yet*, not *the town has not started*
    (M6); **none of the six literals from audit R3 appear** ("Their mind is quiet.", "Still learning
    everything.") — asserted by substring.
  - `becomingOf` on a **day-5** fixture returns `done` non-empty and ordered by day descending,
    `knows` sorted by level then name, `good` in bands with **no digit**, `changed` non-empty.
  - `wants` is `[]` today and its section **does not render at all** when empty (P22.2).
  - **P22.4:** two agents with identical genesis but different logged behaviour produce **different**
    `Becoming` objects (assert deep-inequality) — the display cannot flatten them.
  - Every string passes `GAMIFICATION_BAN`; `good` contains no number and no "level".
  - The rendered expansion has `aria-expanded` on the row button, is keyboard reachable, and returns
    focus to its own row on close.
- [ ] **Step 2:** Run `pnpm vitest run packages/web/src/ui/roster/expand.test.ts packages/web/src/ui/roster/RosterExpanded.test.ts` — FAIL.
- [ ] **Step 3: Implement.** `?agent=<id>` continues to open the standalone inspector for deep
  links; the roster's own expansion is a **third** state of the same lens and writes
  `?open=<id>` so it is shareable too. `backToRoster`/`navToLens` are unchanged.
- [ ] **Step 4:** Suite + typecheck PASS; `route.test.ts` green with every landed route still
  round-tripping; web build succeeds.
- [ ] **Step 5: Commit** `feat(web): a row opens into who this person has become, without losing the list`.

### Task 83: Becoming — the substance measure, and the authored-identity ban *(P22, U12)*

**Files:** Create `packages/web/src/ui/becoming.ts`, `becoming.test.ts`; Modify
`packages/web/src/ui/InspectorPanel.tsx`, `InspectorPanel.test.ts`

**THE MANDATE THIS TASK EXISTS FOR:** the default arm starts everyone neutral, so *nothing in the
UI may display an authored personality field*. This task (a) finds every place that does, (b)
converts the one legitimate case into a display of **change**, and (c) gives the gate a number for
"is this surface gaining substance".

**What the audit and the source found, named as the brief requires:**

| Site | What it reads | Disposition |
|---|---|---|
| `InspectorPanel.tsx:229-252`, the **Character** tab | `/api/agent/:id/personality` → `{version, day, doc, edit}` | **KEEP, RE-FRAME.** This is already a *versioned, evolving* document with a diff — it is the best evidence of becoming in the product. It is renamed and re-presented as **"How they have changed"**, it leads with the **latest** doc and the **most recent edit**, and on a world with only `version 1` it says so plainly instead of presenting v1 as a character sheet. |
| `InspectorPanel.tsx:170` | `'Their mind is quiet.'` as the thought placeholder | **REMOVE** (P22.2). Replaced by the honest day-0 line from `SECTION_EMPTY`. |
| `InspectorPanel.tsx:199` | `'Still learning everything.'` as the skills placeholder | **REMOVE** (P22.2). |
| `InspectorPanel.tsx:180` | `Health {a.hp}` — a raw stat | already v1 **Task 22**'s removal; unchanged. |
| `InspectorPanel.tsx:200` | `level {level(xp)}` — a numeric level | already v1 **Task 22**'s removal; unchanged. |
| `packages/gateway/src/founders.ts` `FOUNDERS` | authored names + ages, the second arm | **ALLOWED** — name and age are exactly what the ruling keeps at genesis. Asserted: the fixture carries no trait, background or personality field. |

**Interfaces — Produces:**
```ts
/** How much a run has actually made of this person, 0..1. NOT a score and never rendered as a
 *  number (P3) — it drives layout density and the gate's day-0/day-5 assertion, nothing else.
 *  Every term is run-produced; genesis facts (name, age, temperament) contribute ZERO by
 *  construction, which is what makes it a measure of becoming rather than of being. */
export type SubstanceInput = {
  actsDone: number; daysLived: number; bondsAtOrAbove: number
  skillBands: number; personalityVersions: number; changeDays: number
}
export const SUBSTANCE_WEIGHTS: Readonly<Record<keyof SubstanceInput, number>>
export function substanceOf(i: SubstanceInput): number

/** The ban, mechanically. Returns every viewer file that reads a field from this list. */
export const AUTHORED_IDENTITY_FIELDS: readonly string[] =
  ['traits', 'background', 'backstory', 'archetype', 'persona', 'bio', 'origin']
export function authoredIdentityOffenders(files: ReadonlyArray<{ path: string; source: string }>): string[]

/** The re-framed Character tab: what moved, newest first, with the diff that shows it. */
export type ChangeEntry = { version: number; day: number; edit: string; diff: DiffLine[] }
export function changeLog(rows: ReadonlyArray<{ version: number; day: number; doc: string; edit: string }>): ChangeEntry[]
export const CHANGE_EMPTY = 'Nothing about them has changed yet — they have only just arrived.'
```
- **Consumes:** the landed `diffLines`; Task 79 `drivesOf`.

- [ ] **Step 1: Write the failing tests** —
  - `substanceOf` of the all-zero input is **exactly 0**; it is monotonic non-decreasing in every
    term; it is bounded in `[0, 1]` over 1000 sampled inputs; and **age and name do not appear in
    `SubstanceInput` at all** (asserted on the key set — genesis facts cannot inflate it).
  - `changeLog` orders newest first; for a single-version input it returns one entry whose `diff` is
    empty and the panel renders `CHANGE_EMPTY` rather than the v1 doc as a profile.
  - For a three-version input the diff between consecutive versions is the landed `diffLines`
    output (call it in the test and compare — one differ, not two).
  - **The real scan:** `authoredIdentityOffenders` over every file under `packages/web/src` returns
    `[]`; and a second scan asserts the two removed literals ("Their mind is quiet.", "Still
    learning everything.") appear **nowhere** in `packages/web/src`.
  - `InspectorPanel` rendered through `react-dom/server` for a **day-0** agent contains the honest
    empty lines and **no** authored-looking profile prose.
- [ ] **Step 2:** Run `pnpm vitest run packages/web/src/ui/becoming.test.ts packages/web/src/ui/InspectorPanel.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Full web suite + typecheck PASS.
- [ ] **Step 5: Commit** `feat(web): the panels show who a person has become, and nothing they were handed`.

### Task 84: Bond types and bond levels — the model *(U15, P22)*

**Files:** Create `packages/web/src/ui/bondModel2.ts`, `bondModel2.test.ts`; Modify
`packages/gateway/src/lineage.ts` (**v1 Task 23 creates it — see §Amendments for the ordering**)

**THE ASK, verbatim:** *"It must express LEVELS — strangers, acquaintances, friends, hatred — AND
TYPES — romantic (spouse counts as romantic), sibling, parent-child."* F-5 shows why the landed
model cannot: **one** kind per pair, collapsed by precedence, with `strength` as an unsigned
interaction count; `friend` is assigned to any two people who once spoke in earshot; `kin` fuses
parent–child with sibling; and "strangers" is inexpressible because an unlinked person is not even
a node.

**The model: two independent axes over the history the endpoint already returns.**

```ts
// ── TYPE: structural, from facts the world records. A pair has AT MOST one. ────────────────
export const BOND_TYPES = ['partner', 'parent', 'child', 'sibling', 'none'] as const
export type BondType = (typeof BOND_TYPES)[number]
export const BOND_TYPE_WORD: Readonly<Record<BondType, string>> = {
  partner: 'Partners', parent: 'Parent', child: 'Child', sibling: 'Siblings', none: '',
}
/** Directional, because "parent" and "child" are the same edge read from two ends. */
export function bondTypeOf(aId: string, bId: string, lineage: LineageResponse, bonds: BondsResponse): BondType

/** The user's ruling: "romantic (spouse counts as romantic)". A partnership is presented as
 *  romantic AND its evidence is shown, so the naming law (P12) still holds — the town is never
 *  told it invented a word it did not. */
export function partnerEvidence(b: Bond): string | null   // "They have shared a roof since Day 12."
export const SPOUSE_NIGHTS = 14   // shared roofs after which the line reads "since Day N", not "lately"

// ── LEVEL: valenced, decayed, and it can go DOWN. ─────────────────────────────────────────
export const BOND_LEVELS = ['strangers', 'acquaintances', 'friendly', 'close', 'strained', 'hatred'] as const
export type BondLevel = (typeof BOND_LEVELS)[number]
export const BOND_LEVEL_WORD: Readonly<Record<BondLevel, string>> = {
  strangers: 'Strangers', acquaintances: 'Acquaintances', friendly: 'Friends',
  close: 'Close', strained: 'Strained', hatred: 'Hatred',
}
/** Signed weight per recorded act. The negative half is what makes a level a relationship
 *  rather than a counter, and it is why "hatred" is reachable. */
export const BOND_VALENCE: Readonly<Record<string, number>> = {
  spoke: 1, teach: 2, give: 3, co_slept: 4, born: 0, attack: -8,
}
export const WARMTH_HALF_LIFE_TICKS = 2880    // one sim-day; a friendship needs keeping up
export function bondWarmth(history: readonly BondEvent[], nowTick: number): number
export const LEVEL_THRESHOLDS: ReadonlyArray<{ at: number; level: BondLevel }> = [
  { at: -12, level: 'hatred' }, { at: -3, level: 'strained' }, { at: 2, level: 'strangers' },
  { at: 8, level: 'acquaintances' }, { at: 20, level: 'friendly' }, { at: Infinity, level: 'close' },
]
export function bondLevel(warmth: number): BondLevel

// ── P22.5: the ARC. What this relationship has DONE, not only where it stands. ─────────────
export type BondArc = { from: BondLevel; to: BondLevel; direction: 'warming' | 'cooling' | 'steady'; sinceDay: number }
export function bondArc(history: readonly BondEvent[], nowTick: number, windowTicks?: number): BondArc

/** The sentence a viewer reads. Type first when there is one, level always, arc when it moved. */
export function relationLine(type: BondType, level: BondLevel, arc: BondArc, names: [string, string]): string
```
- **Consumes:** the landed `BondsResponse.history` (unchanged — **this is a pure reader, and no
  engine or gateway type moves**); v1 **Task 23** `/api/lineage` for parent/sibling.
  **`agent_born` payload discrepancy, found and named:** `gateway/src/bonds.ts:77` reads
  `{ id, motherId, fatherId }` while v1 Task 23's interface says `parents`. Task 84 step 1 asserts
  the **actual** payload shape off a scripted birth and Task 23 is amended to match it, not the
  other way round.

- [ ] **Step 1: Write the failing tests** —
  - **THE COMPLAINT, AS A TEST:** two agents who spoke **once** are `strangers`, not `friendly`.
    On the landed model they are `kind: 'friend'` and the legend says "Friends" — write that in the
    comment.
  - Every level is reachable: one fixture history per level, each asserted exactly.
  - **Hatred is reachable and friendship is losable:** a pair at `close` who then fight twice drops
    to `strained`, and a third fight reaches `hatred`. A pair at `friendly` who do nothing for four
    sim-days decays to `acquaintances` (`WARMTH_HALF_LIFE_TICKS`), and the level **went down** —
    asserted as an inequality, which is the P3 proof that this is not a score.
  - `bondTypeOf` returns `parent` from the parent's side and `child` from the child's for the same
    edge; returns `sibling` for two agents sharing **at least one** parent and `none` for cousins;
    `partner` for a `co_slept` pair; and when a pair is **both** kin and partners the **kin** type
    wins with a one-line comment saying why (a family fact outranks an inferred one).
  - `partnerEvidence` returns a dated sentence at or above `SPOUSE_NIGHTS` and an undated one below,
    and **never** the word "married" unless the world recorded it (P12).
  - `bondArc` on a warming history reports `warming` with the day the level last changed; on a flat
    history reports `steady`; on a decaying one reports `cooling`.
  - `relationLine` is **total over `BondType × BondLevel`** (iterate the product — 30 cases, all
    non-empty, all `GAMIFICATION_BAN`-clean, none containing a digit except a day number).
  - `bondWarmth` is deterministic and order-independent within a tick.
- [ ] **Step 2:** Run `pnpm vitest run packages/web/src/ui/bondModel2.test.ts` — FAIL.
- [ ] **Step 3: Implement.** `bondsModel.ts` keeps `toBondGraph` for C10's tests and re-exports the
  new level colour table; the six old `BOND_KIND_LABEL` strings are **retired from the UI** but the
  `BondKind` union in `@sj/shared` is **not touched** (the gateway writes it, and P1 keeps us out of
  that argument).
- [ ] **Step 4:** Suite + typecheck PASS; C10's bond tests green.
- [ ] **Step 5: Commit** `feat(web): relationships have a kind and a temperature, and the temperature can fall`.

### Task 85: The bonds lens, redrawn *(U15, P22)*

**Files:** Modify `packages/web/src/ui/SocietyLens.tsx`, `SocietyLens.test.ts`,
`packages/web/src/ui/BondDetailPanel.tsx`, `BondDetailPanel.test.ts`, `chrome.css`

**THE DEFECTS:** the graph draws only people who have an edge (`bondsModel.ts:54`), so on a young
town it is "1728 × 880 of empty dot-grid and one italic sentence" (audit R4); the legend's off state
is a dimming (audit M4); one line colour carries one kind; and nothing shows change.

**The redraw, and each choice is a rule:**

| Encoding | Carries | Why not the alternative |
|---|---|---|
| **Every living person is a node, always** | strangers exist and are visible | a graph that hides the unconnected cannot express "strangers", which U15 demands |
| **Edge length** | LEVEL — close pairs sit near, strained pairs sit far | length is the one channel a force graph gives for free and it reads pre-attentively |
| **Edge mark** (solid / dashed / double stroke) | TYPE | colour alone can never be the only signal (D-25), and six hues cannot all clear AA |
| **Edge colour** | direction of the ARC — warming, cooling, steady | three states, three palette tokens, all AA-clear on the dot grid |
| **Legend "off" is a struck-through chip with a mark** | filter state | audit **M4**: the ask was a *mark*, not a dimming — the contrast fix landed, the encoding did not |

**Interfaces — Produces:**
```ts
export function toRelationGraph(bonds: BondsResponse, lineage: LineageResponse, people: PeopleIndex, nowTick: number):
  { nodes: BondNode[]; links: RelationLink[] }
export type RelationLink = {
  id: string; source: string; target: string
  type: BondType; level: BondLevel; arc: BondArc
  distance: number      // the force-graph link length, from LEVEL
  dash: readonly number[] | null; strokeCount: 1 | 2; color: string
  words: string         // relationLine, for the tooltip and the spoken label
}
export const LEVEL_DISTANCE: Readonly<Record<BondLevel, number>>
export const TYPE_STROKE: Readonly<Record<BondType, { dash: readonly number[] | null; strokeCount: 1 | 2 }>>
export const ARC_COLOR: Readonly<Record<BondArc['direction'], string>>
/** The lens's own legend, which must now explain TWO axes without becoming a manual. */
export function relationLegend(): Array<{ axis: 'level' | 'type' | 'arc'; swatch: string; words: string }>
```
- **Consumes:** Task 84; v1 Task 23 `/api/lineage`.

- [ ] **Step 1: Write the failing tests** — `toRelationGraph` on a world with **zero** bonds returns
  **one node per living person** and zero links (audit R4's ask, as an assertion);
  `LEVEL_DISTANCE` is strictly monotonic from `close` (shortest) to `hatred` (longest) and
  `strangers` has no link at all; `TYPE_STROKE` is total over `BondType`; two different types are
  distinguishable **without colour** (assert the `(dash, strokeCount)` pairs are pairwise distinct);
  `ARC_COLOR` values are MASTER_PALETTE members and each clears **3:1** against the lens background
  (compute it, don't assert a hex); `relationLegend` covers all three axes and every string passes
  the copy scans; the legend's off chip renders a **strike mark element**, not an opacity (assert on
  the markup, closing M4); `BondDetailPanel` shows the arc sentence and the evidence line and
  **contains no filled bar** (the landed strength bar is a meter — P3 — and it is replaced by the
  level word plus the dated history the panel already has).
- [ ] **Step 2:** Run `pnpm vitest run packages/web/src/ui/SocietyLens.test.ts packages/web/src/ui/BondDetailPanel.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Suite + typecheck PASS; capture the lens on a day-0 town (five strangers) and a
  day-5 town, side by side in the batch report — **that pair of pictures is the U15 evidence.**
- [ ] **Step 5: Commit** `feat(web): a society you can read — who is family, who is close, and which way it is going`.

### Task 86: The chronicle timeline — durable marks, weighted toward change *(U14, P22)*

**Files:** Create `packages/web/src/ui/timelineMarks.ts`, `timelineMarks.test.ts`; Modify
`packages/web/src/ui/Timeline.tsx`, `Timeline.test.ts`, `packages/web/src/ui/chrome.css`,
`packages/gateway/src/api.ts`, `api.test.ts`

**THE DEFECTS:** U14 asks for **marks for important events** and says the font is **hard to read and
too small**. `Timeline.tsx:76-77` derives marks from `store.recentEvents()` — a **400-entry ring
that only holds what arrived since the viewer connected** — so on a mature world the audit measured
`.mark` count **0** against 28,897 recorded events (M10). The `ui-blockers` round fixed the label's
1.00:1 contrast and the 9.92 px size to the 12 px floor; **the floor is not a reading size**, and
the marks were left explicitly open.

**Interfaces — Produces:**
```ts
/** Marks come from the RECORD, not from the ring. One request, cached, refreshed on chapter
 *  arrival — never recomputed per frame. */
export type Mark = { tick: number; kind: MarkKind; words: string; weight: number }
export const MARK_KINDS = ['death', 'birth', 'built', 'first', 'chapter', 'changed', 'quarrel', 'joined'] as const
export type MarkKind = (typeof MARK_KINDS)[number]
export const MARK_GLYPH: Readonly<Record<MarkKind, ReadonlyArray<readonly [number, number, string]>>>

/** P22.5 — a mark for a day SOMEBODY CHANGED outranks a mark for a thing that merely happened.
 *  This is the weighting the controller ruling asks for, expressed as a table. */
export const MARK_WEIGHT: Readonly<Record<MarkKind, number>> = {
  changed: 16, first: 16, death: 14, birth: 14, joined: 12, quarrel: 12, chapter: 10, built: 8,
}
export const MARK_MIN_WEIGHT = 8
/** At most one mark per this many ticks per kind, so a busy day is a mark and not a smear. */
export const MARK_COALESCE_TICKS = 60
export function coalesceMarks(marks: readonly Mark[], span: number): Mark[]
export function marksFrom(sources: { chapters: Chapter[]; milestones: MilestoneRow[]; moments: Moment[]; changes: ChangeDay[] }): Mark[]

/** GET /api/timeline/marks — plain SELECTs over the world DB and the narrator tables (P8),
 *  typed-empty when a source is absent, NEVER a 500. */
export type MarksResponse = { marks: Mark[]; throughTick: number }
```
- **Consumes:** the landed `/api/chapters`, `/api/moments`, `/api/milestones`; Task 83's
  `changeLog` days (the personality-version days are exactly "a day somebody changed").

- [ ] **Step 1: Write the failing tests** —
  - **THE COMPLAINT, AS A TEST:** `marksFrom` on a scripted mature world returns **> 0** marks. The
    landed `Timeline` returns 0 on the same world; the test asserts both, so the fix is measured.
  - `coalesceMarks` collapses three deaths inside `MARK_COALESCE_TICKS` into one mark whose words
    say how many, and keeps two deaths 61 ticks apart as two.
  - A `changed` mark outranks a `built` mark at the same tick when only one fits (assert the
    survivor by `MARK_WEIGHT`).
  - `MARK_GLYPH` is total over `MARK_KINDS`; every glyph is distinct; every fill is MASTER_PALETTE.
  - `/api/timeline/marks` against a DB with no narrator tables returns `{marks: [], throughTick: N}`
    with **200**, and against a scripted fixture returns exact marks.
  - **Legibility, measured not asserted by eye:** every timeline text element resolves to
    `--fs-meta` or larger from the Task 53 scale, and the day label's computed contrast against the
    cream slab is ≥ 4.5:1 (the `ui-blockers` fix is re-asserted here so it cannot regress).
  - The track is ≥ **24 px** tall (audit m4) and every mark is a ≥ 24 px pointer target with a
    spoken label; keyboard `Home`/`End`/arrows still scrub (the landed slider behaviour is preserved
    — assert it).
- [ ] **Step 2:** Run `pnpm vitest run packages/web/src/ui/timelineMarks.test.ts packages/web/src/ui/Timeline.test.ts packages/gateway/src/api.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Suite + typecheck PASS; capture the scrubber on a mature world with its marks.
- [ ] **Step 5: Commit** `feat(gateway+web): a scrubber with somewhere to aim — the days the town changed, marked`.

### Task 87: World laws in plain words *(U17)*

**Files:** Create `packages/web/src/ui/lawCopy.ts`, `lawCopy.test.ts`; Modify
`packages/web/src/panels/WorldLaws.tsx`, `WorldLaws.test.ts`,
`packages/web/src/panels/lawsModel.ts`, `chrome.css`

**THE DEFECT:** `lawsModel.ts:14` — `LAW_PATHS = Object.keys(TOGGLABLE_PATHS).sort()` — so the panel
prints **machine dotted paths** (`spoilage.days`, `movement.earshotRadius`) and
`formatLawValue` falls through to `JSON.stringify` for anything that is not a boolean or a number.
That is also the mechanism of audit **M2**: `spoilage.days` is an object, so its value renders as a
408 px unwrappable blob that collapses the label column into one character per line and clips 77 px
off the viewport.

**Interfaces — Produces:**
```ts
export type LawCopy = {
  title: string            // "How long food keeps"
  sentence: string         // "Bread and stew spoil after a few days. Grain keeps much longer."
  unit: string | null      // "days" | null
  /** A value formatter that knows the law's own shape. This is what fixes M2: an object-valued
   *  law renders as its own small table, never as JSON. */
  render: (value: unknown) => Array<{ label: string; value: string }>
}
/** Total over TOGGLABLE_PATHS by construction: a law added to the engine with no copy is a
 *  COMPILE ERROR here, not a machine path leaking onto a screen. */
export const LAW_COPY: Readonly<Record<keyof typeof TOGGLABLE_PATHS, LawCopy>>
export function lawCopyFor(path: string): LawCopy | null
/** Grouping, so 17 rows read as four subjects rather than an alphabetical dump. */
export const LAW_GROUPS = ['the body', 'the land', 'the weather', 'living together'] as const
export function lawGroupOf(path: string): (typeof LAW_GROUPS)[number]
```
- **Consumes:** `TOGGLABLE_PATHS` (`@sj/engine/laws`, already imported by `lawsModel.ts`).

- [ ] **Step 1: Write the failing tests** — `LAW_COPY` is **total over `Object.keys(TOGGLABLE_PATHS)`**
  (drive the assertion from the engine's own object, so a new law fails here); no `title` or
  `sentence` contains a dot-path, an underscore, a camelCase identifier, or a digit; every sentence
  is ≥ 4 words and ≤ 25; **`LAW_COPY['spoilage.days'].render(<the real config value>)` returns a
  row per key with a formatted number and no `{`, `}` or `"` anywhere** (M2, closed at the source);
  `lawGroupOf` is total and each group has ≥ 2 laws; every string passes `GAMIFICATION_BAN`; the
  rendered panel contains **no element wider than its container** (assert the CSS: the value column
  is `min-width: 0` with `overflow-wrap: anywhere`, and `.law-path` no longer sets
  `word-break: break-all` — the two lines that produced the vertical label).
- [ ] **Step 2:** Run `pnpm vitest run packages/web/src/ui/lawCopy.test.ts packages/web/src/panels/WorldLaws.test.ts` — FAIL.
- [ ] **Step 3: Implement.** The machine path stays available as a small monospace subtitle for the
  operator, **below** the human title — the operator needs it and the viewer does not have to read
  it first.
- [ ] **Step 4:** Suite + typecheck PASS; capture the panel at 1280 and 1920 and confirm no clipping.
- [ ] **Step 5: Commit** `feat(web): the town's rules, said in words a viewer can read`.

### Task 88: Text boxes with a voice *(U18)*

**Files:** Create `packages/web/src/render/textFaces.ts`, `textFaces.test.ts`; Modify
`packages/web/src/render/bubbles.ts`, `bubbles.test.ts`, `nameTags.ts`, `characters.ts`,
`packages/web/src/ui/chrome.css`

**THE DEFECTS, three of them and all measurable:**
1. **World text is not in the town's typeface.** `bubbles.ts:69`, `nameTags.ts:31` and
   `characters.ts:180` all construct `BitmapText` with `fontFamily: 'monospace'`. The pixel faces
   *are* loaded (`main.tsx` imports `@fontsource/press-start-2p` and `@fontsource/silkscreen`, and
   the audit confirmed them computed on live chrome elements) — but no `BitmapFont` is installed, so
   every word the world says is rendered in the browser's default mono.
2. **A bubble is a plain rounded rect.** `bubbles.ts:74-79`: `roundRect(…, 4)` in cream with a 1 px
   ink stroke and a 3-point tail. The chrome has a whole 9-slice pixel-frame language
   (`--px-cream`, `--ledge`, `--grain`) that the world's own speech does not use.
3. **A thought is expressed as `alpha: 0.55`** (`bubbles.ts:11`) — the exact de-emphasis-by-
   transparency habit the `ui-blockers` round removed from 24 chrome sites because its contrast is
   unknowable. It is still here, on the surface where legibility matters most.

**Interfaces — Produces:**
```ts
/** Install the town's faces as Pixi bitmap fonts, once, after the webfonts resolve. Two-line
 *  adapter with no logic (P6); the logic is the table below. */
export const FACE_PX = 'sj-px'          // Silkscreen — labels, names, chips
export const FACE_BODY = 'sj-body'      // the readable face — sentences people say
export const FACE_SIZES = [12, 14, 16, 20] as const
export async function installFaces(doc: { fonts: FontFaceSet }): Promise<void>
export function faceFor(role: 'name' | 'speech' | 'thought' | 'label'): { family: string; size: number }

/** A bubble is a 9-SLICE, like every other slab in the product. Nine rects from one frame
 *  texture, so it stretches without smearing at any length. */
export const BUBBLE_SLICE = 10
export function nineSlice(w: number, h: number, slice: number): Array<{ sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number }>

/** The tail points AT the speaker, from whichever side the bubble was placed on (Task 74). */
export function tailPoly(side: Placed['side'], w: number, h: number): number[]

/** A thought is a DIFFERENT SHAPE and a DIFFERENT INK, never a lower alpha. */
export const THOUGHT_FILL = 0xF6E8D5      // --parchment, so it is visibly a different material
export const THOUGHT_INK = 0x5F5568       // --ink-quiet: measured 5.83:1 on parchment
export const THOUGHT_SCALLOP_R = 3        // the cloud edge, drawn as a mask over the same frame
export const SPEECH_FILL = 0xFFF6E9
export const SPEECH_INK = 0x43394A        // --ink: 10.2:1 on cream
```
- **Consumes:** Task 69 `layers.bubbles`/`layers.worldText`, Task 74 `placeTag`, v1 Task 53's scale.

- [ ] **Step 1: Write the failing tests** —
  - **The typeface, as a source test** (a font cannot be installed in the node environment):
    scan `bubbles.ts`, `nameTags.ts` and `characters.ts` and assert **no occurrence of
    `fontFamily: 'monospace'`** and at least one of `FACE_PX`/`FACE_BODY` in each. This fails today
    at three sites.
  - `faceFor` is total over its four roles; every returned size is a member of `FACE_SIZES` and
    ≥ the landed `WORLD_TEXT_PX` floor (the `ui-blockers` floor is preserved, never lowered).
  - `nineSlice(64, 32, 10)` returns exactly 9 rects, they **tile the destination exactly** (sum of
    areas equals `w × h`, no overlap — assert both), and the four corners are unscaled.
  - `tailPoly('above', …)` points downward and `tailPoly('below', …)` upward; total over the four
    sides.
  - **The alpha ban:** `bubbles.ts` contains no `alpha` assignment on a thought node (source scan),
    and the computed contrast of `THOUGHT_INK` on `THOUGHT_FILL` is **≥ 4.5:1** (compute it with the
    WCAG formula in the test, the same way `contrast.test.ts` does).
  - `wrapBubble` behaviour is unchanged (the landed tests stay green) but `WRAP_CHARS` is
    re-derived from the face's measured advance rather than a hardcoded 24 — assert the derivation
    on two face sizes.
- [ ] **Step 2:** Run `pnpm vitest run packages/web/src/render/textFaces.test.ts packages/web/src/render/bubbles.test.ts` — FAIL.
- [ ] **Step 3: Implement.** `installFaces` is awaited in `main.tsx` before `createScene`; if the
  webfonts never resolve, the landed monospace remains as the fallback and the world is still
  readable — a font that fails to load must never blank the dialogue.
- [ ] **Step 4:** Suite + typecheck PASS; web build succeeds; capture a speech bubble and a thought
  wisp side by side at 1× and 3×.
- [ ] **Step 5: Commit** `feat(web): the town speaks in its own typeface, out of a frame that belongs to it`.

### Task 89: The moments composition — the rail leaves the picture alone *(U16)*

**Files:** Modify `packages/web/src/App.tsx`, `packages/web/src/ui/MomentsLens.tsx`,
`MomentsLens.test.ts`, `packages/web/src/ui/DirectorMode.tsx`, `packages/web/src/ui/chrome.css`;
Create `packages/web/src/ui/frame.ts`, `frame.test.ts`

**THE DEFECT, measured in the stylesheet:** `chrome.css:748-756` puts `.moments-lens` at
`z-index: 18` with `.moments-rail` at `top: 0.8rem; bottom: 0.8rem` — **full stage height** — while
`chrome.css:831-834` puts `.director` at `z-index: 15` with two 12 %-tall `.letterbox` bands at top
and bottom. The rail is therefore drawn **on top of both letterbox bars**, which is exactly the
user's "an element sits ON TOP of the letterbox". `App.tsx:208-213` renders `DirectorMode` and
`MomentsLens` as siblings in the same `<main>`, so nothing in the layout knows they are one view.

**The fix is the composition, per U16, and P19 makes it a rule.** The bottom letterbox band stops
being dead space and **becomes the filmstrip**: the rail's cards lay out horizontally inside it. The
picture is then genuinely unobstructed, and the letterbox earns its 12 %.

**Interfaces — Produces:**
```ts
export type Frame = { x: number; y: number; w: number; h: number }
export type FrameLayout = { picture: Frame; bandTop: Frame; bandBottom: Frame }
export const LETTERBOX_FRACTION = 0.12
/** The one geometry function. Chrome is placed into a band or into the picture — never across
 *  the boundary between them. */
export function frameLayout(stage: { w: number; h: number }, letterboxed: boolean): FrameLayout
/** P19's mechanical guard: given the placed boxes, returns every element that straddles a band
 *  edge. The gate asserts this is empty. */
export function straddlers(boxes: ReadonlyArray<{ id: string } & Frame>, l: FrameLayout): string[]
/** The filmstrip: cards laid out along the bottom band, scrolled horizontally, with the open
 *  day centred. Pure — the DOM half only applies the offsets. */
export const STRIP_CARD_W = 168, STRIP_GAP = 8
export function stripLayout(count: number, openIndex: number, bandW: number): { offsets: number[]; scrollX: number }
```
- **Consumes:** Task 77 `CONTROL_BAR_H` (the bar and the bottom band cannot both own the bottom —
  under the letterbox the bar docks **into** the band, which `frameLayout` returns).

- [ ] **Step 1: Write the failing tests** — `frameLayout({w:1728,h:880}, true)` returns two bands of
  exactly `round(880 * 0.12)` and a picture between them, and the three boxes **partition the stage
  with no overlap and no gap** (assert areas sum exactly); `frameLayout(…, false)` returns
  zero-height bands and a full-stage picture; **`straddlers` finds the moments rail as laid out
  TODAY** (feed it the measured `top: 0.8rem; bottom: 0.8rem` box — the failing assertion that
  proves U16) and returns `[]` after the change; `stripLayout` centres the open card, is stable
  when `openIndex` is unchanged, clamps `scrollX` at both ends, and returns `count` offsets spaced
  `STRIP_CARD_W + STRIP_GAP` apart; `stripLayout(0, …)` returns empty offsets and does not throw;
  the rendered lens has the rail inside the bottom band (assert the class/role structure, not the
  pixels) and **`MomentsLens` no longer renders when `DirectorMode` is absent and vice versa** —
  they become one component tree, asserted on the markup.
- [ ] **Step 2:** Run `pnpm vitest run packages/web/src/ui/frame.test.ts packages/web/src/ui/MomentsLens.test.ts` — FAIL.
- [ ] **Step 3: Implement.** `<main>` becomes a CSS grid with three named rows
  (`band-top / picture / band-bottom`) whose heights come from `--letterbox-h`, and every floating
  surface is placed into a row. **Also closes audit M7:** the letterbox and the camera move engage
  only when a day is actually playing — `DirectorMode` takes a `letterboxed` prop from
  `momentId !== null || televised`, and an empty Moments lens is a filmstrip with an honest empty
  line and no camera move.
- [ ] **Step 4:** Suite + typecheck PASS; web build succeeds; capture the lens with a day playing
  and with none.
- [ ] **Step 5: Commit** `feat(web): the filmstrip lives in the letterbox, and the picture is the picture`.

---

# Phase Q — TRANSITIONS AND FINISH *(U23, U24)*

U23 says the missing thing is *"special touches to make it really feel polished — TRANSITIONS, and
extra final touches to give it that extra shine."* The brief says it is **a real task, not a
footnote**, so it is four.

### Task 90: One motion vocabulary *(U23)*

**Files:** Create `packages/web/src/ui/motion.ts`, `motion.test.ts`; Modify
`packages/web/src/ui/chrome.css`

**THE PROBLEM:** motion exists but it is not a system. `chrome.css` carries `--t-fast: 150ms`,
`--t-med: 240ms`, `--t-slow: 300ms` and one easing, and then eleven surfaces each pick their own
combination in their own rule, with four hand-written keyframes (`rise-in`, `panel-in`, `feed-in`,
`box-in`). Nothing names what a duration is *for*, so nothing can be consistent, and the canvas side
(interior fade, follow lerp, glide) shares none of it.

**Interfaces — Produces:**
```ts
/** Motion is named by WHAT IT IS, so two surfaces doing the same thing move the same way. */
export const MOTIONS = ['tap', 'reveal', 'enter', 'move', 'scene', 'ambient'] as const
export type MotionName = (typeof MOTIONS)[number]
export type Motion = { ms: number; ease: string; stagger?: number }
export const MOTION: Readonly<Record<MotionName, Motion>> = {
  tap:     { ms: 90,  ease: 'cubic-bezier(0.3, 0, 0.2, 1)' },                 // a press answering
  reveal:  { ms: 150, ease: 'cubic-bezier(0.2, 0, 0, 1)' },                   // a hover, a chip
  enter:   { ms: 240, ease: 'cubic-bezier(0.2, 0, 0, 1)', stagger: 30 },      // a panel arriving
  move:    { ms: 180, ease: 'cubic-bezier(0.4, 0, 0.2, 1)' },                 // camera, zoom, dock
  scene:   { ms: 300, ease: 'cubic-bezier(0.4, 0, 0.2, 1)' },                 // lens, interior, day
  ambient: { ms: 1200, ease: 'linear' },                                      // breathing, drift
}
/** The ceiling the UI mandate sets. `ambient` is exempt BECAUSE it is never a response to an
 *  input — it is scenery, and the test states the exemption rather than hiding it. */
export const MOTION_CEILING_MS = 300
export const AMBIENT_EXEMPT: readonly MotionName[] = ['ambient']

/** Reduced motion is not "no motion": it is INSTANT ARRIVAL. A viewer who opted out still needs
 *  to see that something changed, so opacity survives and translation does not. */
export function reduced(m: Motion): Motion            // { ms: 0 } for movement, ms/3 for opacity
export function motionCss(name: MotionName, props: readonly string[]): string
/** The canvas half reads the same table — one vocabulary, two runtimes. */
export function easeFn(name: MotionName): (t: number) => number
export function progress(name: MotionName, startedMs: number, nowMs: number): number
```
- **Consumes:** Task 75 `easeOutCubic` (re-exported, one easing implementation).

- [ ] **Step 1: Write the failing tests** — `MOTION` is total over `MOTIONS`; every non-exempt
  duration is ≤ `MOTION_CEILING_MS` and ≥ 90; `reduced` returns `ms: 0` for a movement property and
  a nonzero opacity duration; `motionCss('enter', ['opacity','translate'])` emits both properties
  with one duration and one easing and **no `all`** (a blanket transition is how a surface animates
  something it did not mean to); `easeFn` is monotonic on `[0,1]` with `f(0)===0` and `f(1)===1` for
  every name; `progress` is clamped to `[0,1]` and is exactly 1 at and after the duration;
  **the CSS scan:** parse `chrome.css` and assert **every** `transition-duration` and
  `animation-duration` value is a `--t-*` token from this table (no raw ms anywhere), and that
  every animated rule is inside a `prefers-reduced-motion` guard or uses only opacity.
- [ ] **Step 2:** Run `pnpm vitest run packages/web/src/ui/motion.test.ts` — FAIL.
- [ ] **Step 3: Implement.** The three landed `--t-*` tokens are re-derived from `MOTION` and two
  are added (`--t-tap`, `--t-ambient`), so the stylesheet and the canvas cannot disagree.
- [ ] **Step 4:** Suite + typecheck PASS; every existing animation still runs.
- [ ] **Step 5: Commit** `feat(web): one vocabulary of motion, and both runtimes speak it`.

### Task 91: Scene transitions *(U23)*

**Files:** Modify `packages/web/src/App.tsx`, `packages/web/src/render/StageMount.tsx`,
`packages/web/src/render/interiorScene.ts`, `packages/web/src/render/scene.ts`,
`packages/web/src/ui/chrome.css`; Create `packages/web/src/ui/sceneTransition.ts`,
`sceneTransition.test.ts`

**THE GAP:** the four transitions that matter most are the four that are hardest cuts today.
Changing lens swaps a subtree instantly (`App.tsx:206-232`). Entering an interior has a 260 ms fade
(`interiorScene.ts`) but the **town behind it** does not move, so it reads as a card appearing
rather than a camera going in. Following someone snaps the zoom (`DirectorMode.tsx:55`
`scene.setZoom(DIRECTOR_ZOOM)` — an instant integer jump). And day/night crosses in one step.

**Interfaces — Produces:**
```ts
export const SCENES = ['lens', 'interior', 'follow', 'daybreak', 'nightfall'] as const
export type SceneName = (typeof SCENES)[number]
export type SceneState = { name: SceneName; phase: 'idle' | 'out' | 'in'; startedMs: number; from: string; to: string }
export function sceneReducer(prev: SceneState, ev: { kind: 'go'; name: SceneName; to: string; atMs: number } | { kind: 'tick'; atMs: number }): SceneState
/** out then in, never both at once — a crossfade of two live scenes doubles the frame cost and
 *  reads as a smear at this pixel density. */
export const SCENE_OUT_MS = 120, SCENE_IN_MS = 180   // sums to MOTION.scene
/** Grave tone gets the QUIET variant of every transition, not the absence of one (P10). */
export function sceneMotion(name: SceneName, grave: boolean): Motion
export function sceneAlpha(s: SceneState, nowMs: number): { out: number; in: number }
```
**The four transitions, each specified:**

| Transition | What moves | Why |
|---|---|---|
| **lens** | the outgoing panel fades and slides 8 px toward its edge; the incoming arrives from its own edge with `MOTION.enter`'s 30 ms stagger on its rows | a lens change is a change of *subject*; the direction tells the viewer which way they moved |
| **interior** | the camera **pushes in** to the door tile over `SCENE_OUT_MS` while the veil rises, then the room arrives; leaving reverses **to the same camera position** | this is the difference between "a card appeared" and "I went inside" |
| **follow** | the zoom eases to the follow stop through `zoomTo` (Task 75) instead of `setZoom`, and the camera's existing lerp does the pan | the landed snap is the single most jarring motion in the product |
| **daybreak / nightfall** | the clock tint crosses over `MOTION.ambient`, and the light pools fade in ahead of it | v1 Task 5 owns the ramp; this owns the *crossing* |

- **Consumes:** Task 90 `MOTION`, Task 75 `zoomTo`, the landed `advanceInterior`/`INTERIOR_FADE_MS`
  (which is **replaced** by `sceneReducer`, not run beside it).

- [ ] **Step 1: Write the failing tests** — `sceneReducer` goes `idle → out → in → idle` and reaches
  `idle` at exactly `SCENE_OUT_MS + SCENE_IN_MS`; a second `go` during `out` **retargets without
  restarting** (assert `startedMs` unchanged and `to` updated) so a viewer mashing the lens bar does
  not stutter; `sceneAlpha` never has both `out > 0` and `in > 0` at the same instant; `sceneMotion`
  under grave tone returns a longer, quieter motion and **never** `ms: 0`; `SCENES` is total in
  `sceneMotion`; under reduced motion the reducer still passes through `out`/`in` phases but
  `sceneAlpha` is a step function (the state machine is identical, only the curve changes — so
  reduced motion cannot desynchronise anything).
- [ ] **Step 2:** Run `pnpm vitest run packages/web/src/ui/sceneTransition.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Suite + typecheck PASS; record a screen capture of all five transitions and attach
  it; measure the frame cost of the interior push-in (it is the one that moves the camera and the
  veil together).
- [ ] **Step 5: Commit** `feat(web): going somewhere looks like going somewhere`.

### Task 92: The finish pass *(U23)*

**Files:** Modify `packages/web/src/ui/chrome.css` and the components the checklist names; Create
`packages/web/src/ui/finish.test.ts`

**WHAT THIS IS:** U23's *"extra final touches to give it that extra shine"*, turned into a
checklist with a test per line, so "polish" is not a vibe somebody claims. Every line below is a
known finish defect in the landed surface or a known AAA affordance it lacks.

| # | The touch | The test |
|---|---|---|
| 1 | **Optical alignment** — every icon+label pair is baseline-aligned, not box-aligned | CSS scan: every `.badge`, `.chip`, `.legend-chip`, control-bar item declares `align-items: baseline` or an explicit optical offset token |
| 2 | **Tabular figures everywhere a number ticks** — the clock, the day, counts | CSS scan: every selector rendering a live number declares `font-variant-numeric: tabular-nums` (the strip and player already do; the rest do not) |
| 3 | **No layout shift on state change** — a badge appearing must not reflow its row | the roster row and the control bar reserve their state slot; asserted on the rendered markup's class contract |
| 4 | **Focus is never clipped** — the two `overflow: hidden` containers already use inset rings; every new one must too | CSS scan: any selector with `overflow: hidden` that contains a focusable descendant sets `:focus-visible { outline-offset: -2px }` |
| 5 | **Press has weight** — every control moves 1 px and loses a shadow step on `:active` (the landed `.cam-btn` does; nothing else does) | CSS scan over every control class |
| 6 | **Hover is 150 ms in and instant out** — a hover that fades out lies about where the pointer is | CSS scan: hover transitions declare `transition-duration: var(--t-reveal)` on the base and `0s` on `:hover` |
| 7 | **A loading surface has a shape, not a spinner** — skeleton slabs at the real row height | every panel with an async fetch renders a skeleton of the correct row count (P21) |
| 8 | **Nothing pops in** — the ground bake, portraits and building art all cross-fade on hot-swap (the codex hot-swap currently hard-swaps the texture) | `applyBuildingArt` and the character sheet swap animate over `MOTION.reveal`; asserted on the swap path |
| 9 | **The cursor tells the truth** — `grab`/`grabbing` on the stage (landed), `pointer` on every clickable, `not-allowed` on a disabled control with a reason | CSS scan |
| 10 | **Sound of silence** — a world with nothing happening still breathes: the ambient layer, the clock, and one moving thing are always present | the ambient population is non-zero for every season × phase (v1 Task 4's function, asserted here as a finish line) |
| 11 | **Text never widows** — every title uses `text-wrap: balance`, every paragraph `pretty` | CSS scan |
| 12 | **The scrollbars are the town's** — styled to the palette, always visible on a scrollable region so a viewer knows there is more | CSS scan on the four scroll containers |

- [ ] **Step 1: Write the failing tests** — one `it()` per row above, each parsing `chrome.css` or
  rendering the named component. **Record how many of the twelve fail on the landed sheet** — that
  number is the honest size of "finish", and it goes in the batch report.
- [ ] **Step 2:** Run `pnpm vitest run packages/web/src/ui/finish.test.ts` — FAIL.
- [ ] **Step 3: Implement**, row by row, smallest first.
- [ ] **Step 4:** Suite + typecheck PASS; web build succeeds.
- [ ] **Step 5: Commit** `feat(web): the last five percent, twelve lines of it, each with a test`.

### Task 93: Twitch-ready — the readiness audit *(U24)*

**Files:** Create `docs/superpowers/reports/twitch-readiness.md`,
`packages/web/src/ui/broadcastReady.test.ts`

**THE ASK:** the user acknowledged the gap and stated it plainly: *"it really feels a very far
distance from being that ready."* This task measures the distance instead of asserting it is gone.

**Interfaces — Produces:**
```ts
/** The conditions an unattended broadcast must hold. Each is measurable, and the report gives
 *  the measured value beside the requirement — not a checkmark. */
export type ReadinessLine = { id: string; requirement: string; measured: string; pass: boolean }
export const READINESS: readonly string[] = [
  'R1  ten unattended minutes with no empty frame, no error toast, no stalled camera',
  'R2  every caption legible at 1080p downscaled to a 480px-wide mobile Twitch player',
  'R3  a viewer joining at any second understands who they are looking at within 10s',
  'R4  nothing on screen is a machine word, an id, or a number without a unit',
  'R5  a death, a birth and a build each read differently without sound',
  'R6  the frame rate holds >= 58fps for the whole ten minutes with everything live',
  'R7  no layout at 1280x800, 1440x900 or 1920x1080 clips, overlaps or scrolls horizontally',
  'R8  the stream survives a socket drop and a reconnect without lying about the clock',
]
export function readinessReport(lines: readonly ReadinessLine[]): string
```
- **Consumes:** v1 Tasks 28–33 (the broadcast layer) — **so this task executes in Phase Q but its
  R1/R5/R6 lines are re-measured after Phase F**, and Task 94 (G12c) cites the later measurement.
  Stated here so nobody measures once and calls it done.

- [ ] **Step 1: Write the failing tests** — the machine-checkable half, now: **R4** as a scan over
  every string the broadcast surfaces can render (ids, `structure_*`, dotted paths, bare integers
  without a unit — the same regex family as `GAMIFICATION_BAN`); **R7** as the layout assertions at
  the three widths; **R8** as the disconnect state (audit **M9**: the tick badge still reads
  `Now · Day 0 · 19:31` while the socket is down — assert the badge takes its `waking`/`past` state
  and the strip marks its figures stale); **R2** as a computed minimum caption size at a 0.44 scale
  factor.
- [ ] **Step 2:** Run `pnpm vitest run packages/web/src/ui/broadcastReady.test.ts` — FAIL (M9 fails
  today).
- [ ] **Step 3: Implement** the machine-checkable half. The human half (R1, R3, R5, R6) is a
  protocol in the report, run at G12b.
- [ ] **Step 4:** Suite + typecheck PASS; write the report with **measured values in every row**,
  including the ones that fail — a readiness report whose only content is passes is not a
  measurement.
- [ ] **Step 5: Commit** `docs+test(web): how far from Twitch-ready, measured in eight numbers`.

---

# Phase R — THE REVIEW GATE

### Task 94: GATE G12c — every U-id, demonstrated *(all of U3–U25)*

**Files:** Create `packages/web/src/ui/g12c.test.ts`, `packages/web/src/render/g12c.test.ts`,
`packages/gateway/src/g12c.test.ts`, `docs/superpowers/reports/g12c-protocol.md`. Split by package
for the D-41 reason: `@sj/web` is private, DOM-typed and bundler-resolved, so a gateway test cannot
import its modules without breaking `tsc -b`. Each file's header names the other two.

**The gate law, from the review's STANDING CONSEQUENCE:** *"the C12 gate fails if any U-id is
unaddressed or explicitly deferred without a user-visible reason."*

- [ ] **Step 1: Write the suite.** Every line is a gate criterion, not a suggestion. Each names its
  U-id, so a failure is reported in the user's own vocabulary.
  - **U3** — `devTown().structures.length === 11`; every structure's door is road-adjacent;
    `danglingRoadEnds()` is `[]`; `stageFill` on the first frame ≥ `STAGE_FILL_MIN`;
    `landmarksOf` names a rank-1 centre.
  - **U4** — `wallPolys` returns two non-degenerate walls; `FURNITURE_OCCUPANCY` is total over
    `CITY_FURNISHING_KINDS`; a sleeping body orders between a bed's halves; `roomCard` returns a
    title, a provenance line and a holdings list on the Task-59 storehouse.
  - **U5** — `roadReadsAt(roadTone, grassTone)` is true for the shipped materials.
  - **U6** — `latticePeak` of a baked strip < `LATTICE_PEAK_MAX`.
  - **U7** — `patchOutline` of the plaza is a single closed outline with no interior segments.
  - **U8** — **`occlusion.test.ts`'s disagreement set is empty over all eleven structures**;
    `depthOrder` is deterministic over 20 shuffles; the pinwheel does not throw; `depthOrder`'s
    measured per-frame cost at the live entity count is recorded.
  - **U9** — `hitTightness` ≤ `HIT_TIGHTNESS_MAX` for every founder sheet's figure dimensions;
    the capsule excludes the name-tag column and the neighbouring-door point.
  - **U10** — `placeTag` keeps every one of 40 sampled anchors inside the viewport; two owners never
    overlap; `hideAll` clears.
  - **U11** — `doorLocalRect` ≥ `HIT_MIN_PX` in both axes at every `ZOOM_STOPS` value; `entities.ts`
    contains no `doorZIndex`; the door is a child of its building sprite.
  - **U12** — every one of the five required fields is non-empty for every living agent on a day-0
    fixture; the day-0 and day-5 renderings **differ**; `expandReducer`'s every reachable state
    still renders the whole list.
  - **U13** — `statusLiteralOffenders` over all of `packages/web/src` is `[]`; the sleeping-founder
    markup contains `Asleep` once and `resting` zero times; `STATE_WORD` and `CONDITION_WORD` value
    sets are disjoint.
  - **U14** — `marksFrom` on a mature fixture returns > 0 marks; a `changed` mark outranks a `built`
    mark; every timeline text element is ≥ `--fs-meta`; the track is ≥ 24 px.
  - **U15** — a pair who spoke once is `strangers`; every one of the six levels is reachable; a
    level **falls** on decay and on conflict; `bondTypeOf` distinguishes parent, child and sibling;
    `relationLine` is total over `BondType × BondLevel`; the lens draws a node per living person
    with zero bonds.
  - **U16** — `straddlers` is `[]` for the placed layout; `frameLayout`'s three boxes partition the
    stage exactly; the letterbox does not engage with nothing playing (M7).
  - **U17** — `LAW_COPY` is total over `TOGGLABLE_PATHS`; no title or sentence contains a dot-path;
    `spoilage.days` renders as rows with no JSON punctuation (M2).
  - **U18** — no `fontFamily: 'monospace'` in the three world-text modules; `THOUGHT_INK` on
    `THOUGHT_FILL` ≥ 4.5:1; no alpha-based de-emphasis on a thought node; `nineSlice` tiles exactly.
  - **U19** — thirty trackpad events advance exactly one stop; a settled scale is always a member of
    `ZOOM_STOPS`; a 500-event random walk never leaves the stop set; `clampCamera` never shows
    outside the world box.
  - **U20/U21** — `hudReducer` reaches a fully hidden state and returns from it; **for every
    reachable layout a keyboard-reachable way back is rendered**; the layout round-trips through
    storage.
  - **U22** — `actionFor` is total over every id `controlItems` can produce; every control is
    ≥ 44 px with a spoken label and no pictographic character.
  - **U23** — `MOTION` is total and within the ceiling; the CSS scan finds no raw duration;
    `sceneReducer` completes and retargets without restarting; **all twelve finish lines pass**.
  - **U24** — the four machine-checkable readiness lines pass and the report carries a measured
    value in **every** row including the human ones.
  - **U25** — the five-distinct-`insideId` assertion passes on a scripted five-hut world; the
    engine half is present in `c8-delta-from-c12.md` with its citation.
  - **P22 (the neutral-start mandate)** — `authoredIdentityOffenders` is `[]`; the two R3 placeholder
    literals appear nowhere; `substanceOf`'s input contains no genesis fact; two agents with
    identical genesis and different logs render differently.
  - **Read-only proof** — full repo suite green; **G1 `f487a26b` and G2 `6f2529fb` byte-identical**;
    `git diff --name-only <base>..HEAD` touches nothing under `packages/engine/src`,
    `packages/arbiter` or `packages/agents/src`.
- [ ] **Step 2:** Run the three files — FAIL. **Every failure must be a real gap, never a typo.**
- [ ] **Step 3:** Fix the gaps **in the owning task's file**, never by weakening a gate line.
- [ ] **Step 4:** Write `g12c-protocol.md`: the runnable command lines first, then a **per-U-id
  evidence table** — for each of U3–U25, the capture or the measurement that demonstrates it, and
  for anything deferred, **the user-visible reason**, because the review's own consequence clause
  requires one. Run it with the controller.
- [ ] **Step 5: Commit** `test+docs: GATE G12c — the user review, closed line by line`.

---

## Amendments to Tasks 1–58

Task numbers do not move (§0). These are the changes the review forces on v1 tasks, stated here so
an executor reading a v1 task knows to read this too.

| Task | Amendment |
|---|---|
| **2** (portraits + `moodOf`) | **MOVED EARLIER — it is a hard prerequisite of Task 81**, which needs `Expression` and `moodOf` for the roster's mood icon. Execute Task 2 in Phase P's first batch, before 81. Its content is unchanged. |
| **5** (day ramp, shadows) | Shadows now draw into `layers.shadow` (P16), not into the `ambient` under-layer, and the day/night crossing hands off to Task 91's `daybreak`/`nightfall` scene. |
| **8** (new tiles, camera bounds, culling) | `cameraBounds`/`minZoomFor` are **superseded by Task 76's `cameraBoundsOf`/`fitStop`**; Task 8 keeps the three new tiles and the culling predicate, and the culled set becomes `depthOrder`'s input (Task 70). |
| **9** (minimap, bookmarks) | The minimap becomes a `Dockable` (Task 78) and its default slot is `hidden` — U20 asks for controls *out of the way*. `MINIMAP_PX_PER_TILE` unchanged. **C12a batch 3: `DOCKABLE` ships without `minimap` and without the retired `cameraHud`, because a dockable the renderer cannot place is a setting that does nothing. Task 9 ADDS `'minimap'` to `DOCKABLE` and `hidden` to `DEFAULT_HUD` when the widget lands — one line each, plus its own case in the renderer.** |
| **10** (overlay lenses) | Overlay tints draw into `layers.groundDecal` (P16); the overlay switch moves into the control bar's `view` group (Task 77). **C12a batch 3: `OverlayKind` does not exist yet, so `ControlCtx` carries no `overlay` field and `ControlAction` has no `overlay` member. Task 10 adds both, plus one item per overlay in the `view` group; `actionFor`'s totality test covers them the moment they appear in `controlItems`.** |
| **13** (construction stages) | The stake decal draws into `layers.groundDecal`; the `hitArea` re-cut rule is unchanged but now also re-cuts the **door child** (Task 73). |
| **15** (conversation staging, selection) | Selection rings draw into `layers.overlay`; the new `hoverLabel` cases route through Task 74's `TooltipLayer`, not through a second tag path. |
| **17** (structure art) | **One line added to every enterable kind's commission:** the art must contain a legible doorway on the south frontage, at ≥ `DOOR_W_TILES × DOOR_H_TILES` of the footprint, so Task 73's threshold plate is a fallback rather than the normal case. |
| **22** (inspector depth) | Unchanged in substance and still owns the `hp`/`level` removals. **Re-homed:** its model is what Task 82's expansion renders, and its own panel remains the `?agent=` deep-link target. Its `bars` gain the P22 day-0 empty state. |
| **23** (`/api/lineage`) | **Interface corrected against landed reality:** `gateway/src/bonds.ts:77` reads `agent_born` as `{ id, motherId, fatherId }`, not `{ parents }`. Task 23's response shape keeps `parentOf`, and its reader is written against the actual payload. It is also a **prerequisite of Task 84** (sibling detection), so it executes in Phase P's batch. |
| **29–32** (broadcast) | Every broadcast surface is placed by Task 89's `frameLayout` (P19) and is a `Dockable` (Task 78). The PiP window is a `layers.overlay` child. |
| **31** (character dock) | The dock's chip is the **same component** as Task 81's roster row at a smaller detent — one row design, two homes, per the v1 dock precedent. `activityIcon` is derived from Task 79's `State`, not from a second table. |
| **46** (touch) | `PINCH_SNAP_RATIO` is re-expressed against `ZOOM_STOPS` (Task 75): a pinch snaps to the nearest stop, including `0.5`. `touchReducer`'s zoom action carries a `ZoomStop`, not `1|2|3|4`. |
| **47** (portrait layout) | The bottom sheet and the control bar are both bottom-anchored; the sheet docks **above** the bar, and `frameLayout` owns the split. |
| **53** (the type system) | **Scope widened by U14 and U18:** the scale now covers **world/canvas text** as well as chrome — `FACE_SIZES` (Task 88) must be a subset of the chrome scale's rungs, and the timeline's labels move to `--fs-meta`, not to the 12 px floor. |
| **54** (contrast) | Gains `THOUGHT_INK`/`THOUGHT_FILL`, `ARC_COLOR` and the control bar's disabled state; `.badge.ill` (**M3**, 3.12:1) is resolved here as the colour decision the `ui-blockers` report deferred. |
| **55** (defect remediation) | **M2, M4, M5, M7, M8, M9, M10 and m4 are now owned by named review tasks** (87, 85, 73, 89, 74, 93, 86, 86 respectively). Task 55's remaining scope is the MINOR set and anything the review tasks did not reach. |
| **56** (navigation coherence) | The shared navigation primitive is **Task 82's `expandReducer`** for in-list drill-down plus the landed `route.ts` reducers for lens navigation; Task 56 verifies rather than invents it. |
| **57** (richness) | R1, R2, R3, R4, R7 and R10 are now owned by Tasks 81/82, 68, 85 and 62. Task 57's remaining scope is R5, R6, R8, R9. |
| **58** (UI pass verification) | Its before/after table gains the review's own measurements: the occlusion disagreement count, `stageFill`, `latticePeak`, `hitTightness`, the status-literal offender count, the mark count, and the finish-line pass count. |
| **51 / 52** (G12a / G12b) | Unchanged, plus: G12a runs Task 94's machine half; **G12b does not pass with an open U-id**, and its protocol document links Task 94's evidence table. |

---

## U-ID COVERAGE TABLE

Every U-id in lanes 2–7 maps to at least one task. **U1 and U2 are the society-design lane's and are
deliberately absent** — §2 states what this plan owes them instead.

| U-id | The ask, in one line | Owning task(s) | Supporting | The gate line that proves it |
|---|---|---|---|---|
| **U3** | the town must read as a designed PLACE; verify which map renders | **59, 61, 62** | 63, 64, 65, 76 | 11 structures; every door road-adjacent; no dangling roads; `stageFill ≥ 0.45`; a named centre |
| **U4** | interiors stop looking under-detailed | **66, 67, 68** | 88 | two walls; occupancy total; a sleeper inside the bed; a room card with title + provenance + holdings |
| **U5** | roads read ghost-faint at 1× | **63** | 62 | `roadReadsAt(road, grass)` true on the shipped materials |
| **U6** | grass repeat visible on a regular grid | **64** | — | `latticePeak < LATTICE_PEAK_MAX` on a baked strip |
| **U7** | farmland/plaza reads as an amorphous blob | **65** | 63 | plaza outline is one closed loop, no interior segments |
| **U8** | FULL depth-sort review — nobody wrongly passes behind | **69, 70, 71** | 67, 8 | the walk-around disagreement set is **empty** over all 11 structures |
| **U9** | click borders on characters are not accurate | **72** | 73 | `hitTightness ≤ 1.35`; the capsule excludes the tag column and the neighbour's door |
| **U10** | tooltips are out of place | **74** | 69, 72 | 40 sampled anchors stay in view; two owners never overlap; `hideAll` clears |
| **U11** | door hotspots are dark rectangular artifacts | **73** | 17, 69 | door ≥ 24 px at every stop; `doorZIndex` deleted; the door is a child of its building |
| **U12** | Townsfolk becomes a video-game character roster, expanding on click | **80, 81, 82** | **2**, 79, 83, 84 | five required fields non-empty on day 0; day-0 ≠ day-5 markup; every expand state still renders the list |
| **U13** | audit the status vocabulary, collapse synonyms | **79** | 68, 81 | offender scan `[]`; `Asleep` once and `resting` zero times on a sleeping founder |
| **U14** | chronicle timeline lacks marks; the font is too small | **86** | 53 | marks > 0 on a mature world; `changed` outranks `built`; every label ≥ `--fs-meta`; track ≥ 24 px |
| **U15** | bonds must express LEVELS and TYPES | **84, 85** | **23**, 83 | one conversation = strangers; six levels reachable; a level **falls**; parent/child/sibling distinguished; a node per living person |
| **U16** | Moments is lackluster; the summary sits on the letterbox | **89** | 77, 90 | `straddlers` empty; the three frame boxes partition the stage; no letterbox with nothing playing |
| **U17** | world laws are too technical | **87** | 53 | `LAW_COPY` total over `TOGGLABLE_PATHS`; no dot-path in any title; `spoilage.days` renders as rows |
| **U18** | text boxes are not vibrant, stylized or clear | **88** | 53, 54, 74 | no `monospace` in the three world-text modules; thought ink ≥ 4.5:1; no alpha de-emphasis; nine-slice tiles exactly |
| **U19** | smooth, damped, bounded zoom | **75, 76** | 46 | 30 trackpad events = 1 stop; settled scale always a stop; a 500-event walk never escapes; camera clamped |
| **U20** | more controls that are out of the way | **78** | 77, 9 | a fully hidden layout is reachable **and** returnable |
| **U21** | move/hide the controls for an unobstructed view | **78** | 77 | every reachable layout still renders a keyboard-reachable way back |
| **U22** | a proper bottom control bar | **77** | 78, 89 | `actionFor` total over every producible id; every control ≥ 44 px, spoken, no pictographs |
| **U23** | transitions and finish, as a real task | **90, 91, 92** | 5, 75 | `MOTION` total and in-ceiling; no raw duration in CSS; `sceneReducer` retargets without restarting; **12/12 finish lines** |
| **U24** | Twitch-ready gap, stated plainly | **93** | 29–33 | 4 machine lines pass; **every** readiness row carries a measured value, passes and failures alike |
| **U25** | all founders sleep in one house — root-cause it | **59, 60** | — | five distinct `insideId` on a five-hut world; the engine half ledgered with its citation |
| *all* | the review gate | **94** | — | G12c fails on any unaddressed U-id, or any deferral without a user-visible reason |

**Task count: 94 total — 58 carried from v1 + Phase K, 36 new (59–94).**
**Phases: L, M, N, O, P, Q, R (new) + A, B, C, D, E, F, G, H, I, J, K (carried).**

---

## Self-review

**1. Review coverage.** Walked `user-review-2026-08-17.md` line by line. Every U-id in lanes 2–7 has
an owning task and a gate line, tabulated above. U1 and U2 are the society lane's; §2 records what
this plan owes that lane rather than silently ignoring it. The STANDING CONSEQUENCE's deferral rule
is implemented as P15 and enforced at Task 94 step 4.

**2. v1 coverage is not lost.** Tasks 1–58 are carried in force with their controller rulings. The
§Amendments table lists **20** v1 tasks the review changes, each by number, and none is deleted. The
Phase K amendment's Tasks 53–58 keep their scope minus the seven audit defects the review tasks now
own — restated explicitly in the Task 55/57 amendment rows so nothing falls between them.

**3. Placeholder scan.** No "TBD", no "similar to Task N", no "add appropriate error handling", no
unspecified test. Every constant has a value. Every new function has a signature. **Style note,
declared deliberately:** this plan continues v1's ratified house style — exact signatures, exact
constants and exact test assertions, with full code blocks reserved for the load-bearing algorithms
(`depthOrder`, `inFrontOf`, `zoomWheel`, `zoomScaleAt`, `homeIntent`, `homeOf`, `devTown`, the
`STATE_WORD`/`BOND_VALENCE`/`LEVEL_THRESHOLDS`/`MOTION` tables). Where the skill asks for a code
block and this plan gives a signature plus its exact assertions, that is the ratified precedent, not
an omission.

**4. Type consistency, checked across phases.**
`Expression`/`moodOf` — one union, v1 Task 2, used in 81 and 31 (amended to reuse 81's row).
`State`/`Condition` — Task 79, used in 68, 81, 82, and 31's `activityIcon` (amended).
`Place` — Task 80, used in 81 and 82.
`BondType`/`BondLevel`/`BondArc` — Task 84, used in 82's `Becoming.knows`, 85, and 94.
`DepthBox` — Task 70, used in 67, 71, 73 and v1 Task 8's culling output.
`LayerSet`/`LayerName` — Task 69, used in 62, 67, 70, 73, 74, 88 and amended Tasks 5, 10, 13, 15, 29–32.
`ZoomStop`/`ZoomState` — Task 75, used in 76, 77, 93 and amended Task 46.
`Motion`/`MotionName` — Task 90, used in 91, 92 and Task 75's easing (one `easeOutCubic`).
`Frame`/`FrameLayout` — Task 89, used in amended Tasks 29–32 and 47.
`DevStructure` — Task 59, used in 60, 62, 68, 80.
`Mark`/`MarkKind` — Task 86 only.
`Becoming`/`substanceOf` — Task 83, used in 81 and 82.
No name is used with two shapes; no later task references a type no earlier task defines.

**5. Dependency ordering, checked.** Three cross-phase prerequisites were found and each is written
into the §Amendments table rather than left implicit: **v1 Task 2 before Task 81** (portraits and
`moodOf`), **v1 Task 23 before Task 84** (lineage for siblings), and **Task 70 before Task 67**
(the interior reuses the town's depth authority). Task 93's R1/R5/R6 depend on Phase F and are
explicitly re-measured after it.

**6. What I checked in source rather than assumed.** The five findings in §1, each with a file and
a line, on this branch at `5e33a7c`: the map the dev world renders and the six-structure stub; the
single hardcoded home id; the three depth defects and the exact tie value `42021`; the door
rectangle's `10 × 13` and the character box's `52 × 72`; the wheel handler's per-event integer step;
the `'resting'` literal beside the `asleep` badge; the single-kind bond model with `strength =
history.length`; the `z-index: 18` rail over the `z-index: 15` letterbox; `fontFamily: 'monospace'`
in all three world-text modules; and `TileId = 0|1|2|3|4|5|6|7`, which is how I know C11 is not
merged.

---

## UNIMPLEMENTABLE AS THE REVIEW WRITES IT — found, and each given an honest answer

Seven things cannot be built exactly as stated. **None is refused; each is given the nearest true
thing, and the difference is written down so nobody discovers it at the gate.**

1. **Pixel-perfect character hit borders (U9).** Pixi has no per-pixel hit testing, and adding one
   would mean reading back the atlas per pointer move. **Answer: Task 72's capsule**, measured
   against the silhouette by `hitTightness` with a stated ceiling of **1.35**, down from the landed
   rectangle. "100% accurate" becomes "within 35 % of the drawn figure, measured" — and the number
   is in the gate so it can be tightened later by changing one constant.

2. **A depth sort that is always right with 1.85× overhanging sprites (U8).** House law P9a lets a
   building's art overhang tiles it does not stand on. Three such sprites can form a pinwheel with
   no consistent painter's order — that is a property of the painter's algorithm, not of this
   implementation. **Answer: Task 70 detects the cycle and degrades to the seed order
   deterministically**, and Task 71 counts how often it happens (expected: zero on the Task-59 town,
   and the gate records the count). The alternative — a depth buffer or per-row sprite slicing —
   is a renderer rewrite and is not proposed.

3. **Truly continuous zoom with exact pixel art (U19).** A non-integer, non-reciprocal scale
   resamples NEAREST art and produces uneven pixels — the defect B1 was just fixed to avoid.
   **Answer: P18** — damped and continuous **in transit**, exact at rest, on five stops including
   the `0.5` overview the audit's R8 asked for. If the controller wants free zoom, it is one
   constant (`ZOOM_STOPS`) and a knowingly accepted loss of crispness; **recommendation: keep the
   stops.**

4. **"Strangers" as a drawn relationship (U15).** A stranger pair is the *absence* of a bond;
   drawing an edge for every non-relationship is O(n²) edges and reads as a mesh. **Answer: Task 85
   draws every living person as a node** (which also closes audit R4) and states "strangers" in the
   legend as *the people with no line between them*. The word appears, the concept is visible, and
   the graph stays readable.

5. **Real thumbnails on the Moments filmstrip (U16).** A true frame capture needs a second headless
   renderer; v1 already deferred it (Open Question 1 of the C10 plan) and nothing has changed.
   **Answer: Task 89 keeps the composed pixel motif**, now at filmstrip size where it reads as a
   card rather than as an 8 px glyph, and v1 Task 50's OG postcard is the shareable image.

6. **District names on an arbitrary map (U3).** `DISTRICTS` is template vocabulary at a fixed
   anchor; a grown or genesis map has no such rects. **Answer: Task 80's `placeOf` names places from
   *what is standing there*** (nearest structure, then terrain), which works on any map, and Task
   62's landmarks name the centre from the same derivation. A district label is only shown where a
   template anchor is known.

7. **Four of the eight Twitch-readiness lines (U24).** "Ten unattended minutes that stay watchable",
   "a viewer understands within 10 s", "a death reads differently without sound" and "≥ 58 fps for
   ten minutes" are not machine-decidable. **Answer: Task 93 measures the four that are and writes
   the other four as a timed human protocol with a measured value in every row** — including the
   failing ones, which is the difference between a readiness report and a claim.

---

## Open questions for the controller

1. **Task 61 edits `packages/shared/src/cityTemplate.ts`, which genesis reads.** Redesigning the
   town changes the town the *simulation* builds, not only the one the viewer shows. It is outside
   the goldens (Task 61 step 4 proves it) and inside P1's letter (shared is not engine/arbiter/
   agents), but it is world content. **Ruling needed: does C12 own the town's plan, or does the
   world lane?** If the world lane, Task 61 becomes a written brief to them and Tasks 59/62/63/64/65
   proceed unchanged — U3 is then only *partly* closable by C12, which the gate must record.

2. **P18 amends P9e — ratify the five-stop zoom.** `ZOOM_STOPS = [0.5, 1, 2, 3, 4]` with damped
   transit, replacing "integer camera scale only, `ZOOM_MIN 1 … ZOOM_MAX 4`". `0.5` is the
   reciprocal of an integer so NEAREST stays exact, and it is what answers audit R8's 85 %-empty
   first frame. Accept, or hold `ZOOM_MIN = 1` and accept the empty first frame.

3. **P9d is repealed by Task 73** — a door becomes a **child** of its building sprite rather than a
   sibling at `structureZIndex + 1`. This is what makes U11's dark rectangle over a body impossible
   by construction and gives the door hit priority for free. Ratify the repeal.

4. **U15's "romantic" wording versus a deliberate editorial choice.** C10 chose `partner →
   "Kept house"` precisely to *observe* rather than to *claim*. The user's ruling says "romantic
   (spouse counts as romantic)". Task 84 resolves it by labelling the type **Partners** and always
   showing its evidence ("They have shared a roof since Day 12"), never the word "married" unless
   the world recorded it. **Confirm that reading**, or rule the plainer "Romantic" label and accept
   that the viewer is being told an inference.

5. **Task 89 puts the Moments rail INSIDE the bottom letterbox band.** The alternative is a rail
   beside a narrower picture. The band version makes the letterbox earn its 12 % and leaves the
   picture whole; the beside version keeps the rail vertical and scannable at more cards. **Pick
   one** — it is a visible composition decision and I would rather it be ruled than discovered.

6. **Task 79's word for "awake, with nothing to do" is "Between things".** It has to be plainly not
   sleep, plainly not machine vocabulary, and it appears on every roster row. Candidates considered
   and rejected: "Idle" (machine), "Resting" (the collision we are removing), "At ease" (arch),
   "Still" (reads as an adverb). **Taste call, user-visible, one constant.**

7. **Scale, and whether Phases L–Q are their own chunk.** 94 tasks. The controller declined the
   C12a/C12b split, but **this is a different seam**: Phases L–Q (36 tasks) depend on **nothing from
   C11**, they close the entire user review, and they end at a gate (G12c) that is meaningful on its
   own. Phases A–K depend on C11 and are feature work. **Option: ship L–Q as C12-review under G12c
   now, while `c11-work` finishes, and keep A–K as C12-feature under G12a/G12b.** This is the
   highest-value scheduling question in the document.

8. **Related, and cheap: Phases L–Q can start immediately.** Verified: no task in 59–92 requires
   `TileId 8|9|10`, `chunkOf`, `world_grown`, `fertilityAt`, `dayPhaseFromTick`, `FaunaKind` or
   `afflictions`. C11 is red at G11b with no tag. **Confirm whether the review lane starts now or
   waits for the merge.**

9. **P20 — confirm that `founders.ts` and `devWorld.ts` are editable dev fixture.** Tasks 59 and 60
   change them. The mechanical guard is the frozen suite (`g6`, `g10`, `founders`, `devWorld`,
   goldens) re-run on every commit. If the controller reads them as world law instead, U25's viewer
   half becomes unfixable in this lane and the whole of U25 ledgers to the engine.

10. **`SUBSTANCE_WEIGHTS`, `LEVEL_THRESHOLDS`, `WARMTH_HALF_LIFE_TICKS`, `BOND_VALENCE` and
    `MARK_WEIGHT` are plan-authored feel constants.** They decide when two people become "Friends"
    and whether a friendship survives a quiet week. Under the neutral-start mandate they are
    **load-bearing on what the user perceives as emergent personality**. Ruling 7 of v1 ratified an
    analogous set as presentation feel; these are more consequential and should be ruled explicitly.
    Recommendation: ratify as drafted, tune by amendment after the first neutral-start run.

11. **P22 versus the personality document (Task 83).** The Character tab reads
    `/api/agent/:id/personality`, a versioned doc with diffs. Under neutral start, **is `version 1`
    authored or is it produced by the run?** If the agent runtime seeds v1 from an authored prompt,
    then displaying v1 violates P22.1 and Task 83 must suppress it until `version >= 2`. **This is a
    question for the society lane and I cannot answer it from the viewer.** Task 83 is written to
    lead with the *latest* version and the *most recent edit*, which is safe either way, but the
    v1-suppression rule needs a ruling.

12. **Who has a face under neutral start (U12 requires a portrait per row).** The 7-expression
    portrait sets exist for the five founders only. In the neutral-start arm the cast is not the
    founders, so **every row falls back to the v4 sprite bust** — and if the rig is shared, five
    people look alike, which is exactly the mode collapse the user is trying to avoid, appearing in
    the display rather than in the simulation. v1 ruling 9 accepted the bust for born agents as a
    v1 answer; it is a weaker answer when the bust is the *only* answer. **Options: (a) accept;
    (b) a deterministic palette-swapped bust per agent from their genetic temperament, composed with
    the landed `swapColors` rig — no model call, no cost, and it makes people visibly different from
    the first frame; (c) commission portraits per run.** **Recommendation: (b)**, and it is small —
    but it is a visible product decision on the flagship surface and it should be ruled, not
    assumed.

---

## Execution handoff

Plan complete. **Not ratified, not committed** — this is a draft for controller review at
`cleanup/2026-08-17-12-deep-presentation-v2.DRAFT.md`, on branch `c12-replan` off local `main`
@ `5e33a7c`. Nothing was implemented, nothing was committed, no live call was made, `.env` and
`OPENROUTER_API_KEY` were never read, and no subagent was used.

On ratification, the two execution options are unchanged from v1:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, two-stage review between tasks,
   batches of ~5 as the house template already runs.
2. **Inline Execution** — `superpowers:executing-plans`, batch execution with checkpoints.

**Ratification into `docs/superpowers/plans/` is the first commit of Phase L's first batch**, and it
must carry this file **plus** `cleanup/user-review-2026-08-17.md` and
`cleanup/c12-ui-pass-amendment.md`, because the plan argues from all three.






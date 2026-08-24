# C8 plan — v4 → v5 delta

`c8-plan-v5` off `c8-plan-v4` @ `50d1bfc`, re-verified against `main` @ **`645a8d9`** (merge train 3 — 311 files / 4637 tests / tsc 0).
Input: `docs/superpowers/plans/2026-08-23-01-genesis-rehearsal-v4.DRAFT.md` (8 948 lines), `c8-v3-to-v4-delta.md`.
Output: `docs/superpowers/plans/2026-08-24-01-genesis-rehearsal-v5.DRAFT.md` (9 523 lines).

**66 tasks, 15 phases, unchanged.** No task added, deleted, renumbered or moved. **Said loudly because two came close and neither was:** T19 loses its build hook and survives with three; T44's finding was falsified outright and it survives as the bootstrap the deployment still needs. **One commit changes owner** — the canon move goes from T14 Step 0 to T12 Step 0 — and that is the only work this revision relocates.

**Why v5 exists:** v4 was written against `cd845bc`. Between there and `645a8d9`, fourteen lanes landed. **`cityTemplate.ts` became a plotter, `build` stopped taking a coordinate, the world lost its size, a bridge opened the far bank, every invention became a credited record, and every kind the world can create gained art and a gate.** **Fourteen of v4's 66 tasks name a signature, a value or a mechanism that no longer exists.** A plan that does that is worse than no plan, which is why v4's own delta exists.

**The three worst, ranked by what they would have cost:**

| | Task | Why it is the worst of its kind |
|---|---|---|
| **1** | **T20** | It **compiles, goes green, and silently deletes the landed build road from every prompt.** Step 3 rewires `agentRuntime.ts:444` to pass `reachableMakeables` where `groundForBuilding()` is passed today; the parameter is optional, the line still renders, and **no test in the repository catches it.** It re-creates the exact zero-production defect Phase D exists to fix, from inside the task that fixes it |
| **2** | **T22** | **Two independent failures on one task.** Its refusal test can never see its refusal — `build.validate(…, {kind:'barn', x, y})` is refused for the parameter shape before `minHands` is consulted — **and** its three heavy kinds have no committed art against a gate that now covers every recipe key, so the commit that adds them reds `packages/forge`. A third fault nobody would have predicted: **`long_bridge` is a plotted kind and would be claimed onto a land plot** |
| **3** | **T44** | **The whole task rests on a finding merge train 3 falsified.** `DEFAULT_ART_ROOT`, the `artRoot` option, `BUILDING_ART_DIRS`, `ingestBuilding`, `tryIngest`, `upsert` and `latestByKind` were all deleted; `ingestProductionArt(db)` takes a database and nothing else. All four of its test bodies fail to compile, and its Step 3 configures a mechanism that no longer exists |

---

## Global constraints

| # | Change | Why |
|---|---|---|
| **C3** | **REWRITTEN.** Re-read all four pins at `645a8d9`: **forge moved to `da065752…`** (three `mapGrowth` keys deleted from `DEFAULT_CONFIG`) and **BLOCK1 moved to `4205d892…`** (one line of block 1, the `build` capability). G1 and G2 unmoved | Two pins moved for reasons unrelated to any rename, which is the thing v4's closing paragraph did not anticipate |
| **C3** | **The census re-derived: ELEVEN full literals across SEVEN files, TWELVE grep lines.** v4 said *"nine across six"*; **v4's own grep against `cd845bc` returns thirteen across eight** | T29 and T51 both assert the count. A wrong count is a false red at the launch gate — the same class of defect as a missed copy |
| **C3** | **`agents/src/live/g11checkpoint.test.ts:15` STRUCK from the copy list.** It is a frozen `G11Fingerprint` fixture carrying a value **two forge pins out of date**, and nothing compares it to `stateHash(DEFAULT_CONFIG)` | v4 called it the forge pin's third copy. It is a decoy; re-pinning it changes nothing and leaves the reader believing the checkpointer is pinned when it is not |
| **C3** | The twelfth grep line — **`arbiter/src/g4.test.ts:208`, a prefix inside a test name** — named, and excluded from the census | It has no assertion behind it, so it cannot go red; a regen that leaves it ships a test whose name says one hash and whose body checks another |
| **C3** | **v4's closing paragraph restated.** *"C8 inherits whatever the rename lane leaves"* becomes *"C8 inherits whatever the four literals say on the tip it executes against"*, with the `first-night` lane named as the live case | The rename lane landed and is not what moved either pin |
| **C14** | **REWRITTEN IN FULL** for the plotter: the lattice constants and the 86.1626 px floor; `GENESIS_WANTED` as a list of buildings and not positions; **no districts**; **no `cityFreePlots`**; **`CITY_ANCHOR_DEFAULT` is `{x: 43, y: 56}` and derived, not `{x: 48, y: 56}`**; `CITY_DWELLING_KINDS` is **four** kinds including `house`; the six signature facts; plat ground versus walk ground | v4 described a placed town with typed coordinates. None of it is there |
| **C14** | **NEW opening paragraph: `build` takes `{kind}` and there is no code path from the params to the position.** Measured — 225 coordinates refused, one site | It is the fact every Phase D task must read before it writes a line |
| **C30** | **AMENDED.** The rename is a landed fact, not a precondition. `CITY_DWELLING_KINDS` is `['cottage','farmhouse','cabin','house']` — **four, not three**. Task 1's `hut` grep becomes a regression guard whose answer is zero | v4 wrote it as a scheduling gate on a lane that has since merged |
| **C32** | **NEW — the layout glass.** `TOWN_LAYOUT_VOCABULARY` bans `plot`/`plots`/`block`/`blocks`/`ring`/`rings`/`lattice`/`plat`/`platted`/`frontage` from every authored surface a mind reads; `scanForLayoutLeak` enforces it | A landed law with no constraint in v4, and C8 writes five new agent-visible strings |

---

## Tasks amended — 16 of 66, one line each

| Task | Amendment | Why |
|---|---|---|
| **T1** | **Step 0 goes from four preconditions to six**: the tip is `645a8d9`; the copy grep uses the **current** four prefixes and **must print 12**; **new** — `PlottedBuildParams` must exist; **new** — `makeablesLine` must take a second parameter and `agentRuntime` must pass `groundForBuilding()` into it. Each is a STOP, and each stale-branch value is named | v4 checked a tip fourteen lanes stale and could not detect either of the two seams Phase D now rests on |
| **T1** | **Step 2's content gate is KEPT and now PASSES**, and gains three counts it must record — 103 nodes, 52 social, the five-era histogram | OD16 closed by a merge; a gate that has started passing is the cheapest one there is, and T12/T13/T14 are all written against those three numbers |
| **T1** | `git mv` repointed to the v5 filename; the roadmap's executed order gains the 2026-08-23/24 sprint and `first-night` | v4's filename and order were stale |
| **T10** | `world.ts:102-106` → **`103-106`** | Off by one; 102 is a comment about bread |
| **T12** | **`era: z.number().int().min(1).max(5)` → `z.enum(ERAS)`**, with `era-mismatch` and `unreachable` comparing through **`ERA_ORDER`** and never lexically | The landed tree writes `- era: handwork`. A numeric schema rejects all 103 nodes at parse time, and `'arrangement' < 'handwork'` is true in JavaScript and false in the world |
| **T12** | **NEW Step 0: the canon move from `packages/arbiter/src/canon.ts` to `packages/shared/src/canon.ts`, taken over verbatim from T14** | Making the era a name makes T12 the first task needing `ERAS`, and T12 runs first. Leaving the move in T14 makes T12 import `@sj/arbiter` from `@sj/engine` — **the cycle C12 forbids, because `@sj/arbiter` depends on `@sj/engine`** |
| **T13** | **UNBLOCKED. 104 → 103 nodes; `[27,31,18,16,12]` → `handwork 8 · arrangement 26 · works 35 · machinery 22 · industry 12`; 11 social → 52**; the era is transcribed as a name; Step 0 prints all three counts | The re-author landed. v4's period grep returns nothing on the landed file — run, not assumed |
| **T13** | **New row: exactly five nodes are reachable on the first morning, and they are `GENESIS_CODEX`'s five with its parents** | The re-author enforces the frontier rather than claiming it; the row makes that a test rather than a README |
| **T14** | **`expect(r.era).toBe(ERAS[byId.get(r.id)!.era - 1])` STRUCK.** `ERAS[<string> - 1]` is `ERAS[NaN]` is `undefined` — **and a row copying `undefined` into the codex would have compared equal to it and passed.** Replaced by an identity carry plus a histogram, and `ERA_ORDER` for the parent-rank row | The vacuous-guard family exactly, in the one place a wrong era reaches the adjudication prompt |
| **T14** | **New row: `codexEntriesFromTree` has no caller outside its own module and test.** Its Step 0 becomes a one-line assertion that T12 moved the canon | **OD18.** A landed user ruling says the tree is a yardstick and never a gate; seeding 103 nodes into `CodexStore` makes it the gate. **An executor who wires it has answered a controller's question with a commit** |
| **T19** | **The fourth hook is DELETED.** `nearestBuildSpot` and `wouldBuildRefuse` are removed; three hooks ship, and the build road is asserted rather than built | `PlottedBuildParams` is `.strict()` over `{kind}`, so the scan returns `null` for every tile in a town — **and `groundForBuilding` has already landed and does the job**, wired at `agentRuntime.ts:444` |
| **T19** | Four new rows: the ground is a door tile on a road; it is null in a townless world; a named coordinate is refused in world words; and the shared `#scan` breaks ties by `(y, x)` and rolls no die | The landed guarantee restated in the package that could most easily regress it |
| **T20** | **The second parameter becomes a SUPERSET, and `ReachableMakeables` gains `ground`.** Two starred regression rows assert the landed sentence is still emitted, byte for byte | v4's Step 3 replaces the second argument outright, **which compiles, goes green, and deletes the build road from every prompt.** The most dangerous single line in v4 |
| **T21** | **`PerceptionStructure` → `PerceivedStructure`** (`perception.ts:83`) | There has never been a `PerceptionStructure`; v4's signature typechecks as never — the fifth instance of that shape across three delta documents |
| **T21** | Two new rows: the joint-build line and resume hint leak no layout vocabulary (C32), and the resume names no coordinate | `buildSiteOf` reads `ownSite` first, so *"carries it on from where it stands"* is true by construction |
| **T22** | **`{kind, x, y}` → `{kind}` throughout; the fixture becomes a town; `siteAt(state, 61, 68)` becomes `theSite(state)`** | The coordinate refusal fires before `minHands`, so v4's assertion would have read the wrong refusal and never reached the sentence the task exists to write |
| **T22** | **Heavy kinds `barn`/`pump_house`/`long_bridge` → `storehouse` (3 hands) and `shed` (2). `long_bridge` DELETED.** New Step 1b builds a `readdirSync` art fixture; new rows assert every seed kind has a committed cell in both facings and that no seed kind is a span | Three kinds with no art against a gate covering every recipe key; and **`isPlottedKind(kind) = kind !== BRIDGE_KIND`**, so `long_bridge` would claim a land plot. **OD19** — the recommendation is taken provisionally so the task is executable |
| **T22** | Step 3 states where the hand check goes — **after the params shape, before `buildSiteOf`**; Step 4 adds an explicit run of `structureArt.test.ts` and `ingestArt.test.ts` | A refusal after the claim reserves ground for a beam nobody can lift, and `claimInWorld` reads *free* off what stands, so the reservation is not visible to unwind |
| **T24** | **New box: item 3 is now the largest source of Discovery Records in the run**, because inverting the expressive test widens the door every minted word comes through. `isExpressive(intent)` unchanged | The record fires from **both** codification paths (`codifyExpressive` inside `adjudicate`, never through `codify()`), and `discoveryHeadline` deliberately omits `intent` so the glass holds. **OD21** |
| **T29** | **The re-pin list corrected line by line**, `g9.test.ts` added to the Files line, **`g11checkpoint.test.ts` struck**, `g4.test.ts:208`'s test name named as an honesty edit that never goes red | Every line number in v4's box had moved, and one of its three forge "copies" is a decoy |
| **T33** | **`first_house` STAYS `first_house`.** v4's revert to `first_hut` is deleted | `tier1.ts:68` is `first_house` on `main`, and `g11.milestones.test.ts:57`, `narrate.test.ts:252` and `milestones.test.ts:60` name it too — v4's amendment would have gone red against four landed tests |
| **T44** | **REWRITTEN.** `deploy/art/` is not created and `ingestArt.ts` is not modified; `bootstrap(db, opts?)` takes no root; the four test bodies are replaced — a half-written cell **throws and names the directory**, and an unreadable art directory still boots the world | **Merge train 3 deleted every symbol v4's tests named.** The art is committed and boots 25 of 25. What is still unproved is *"a cold arm64 box comes up with pictures"*, and that is what the task now does |
| **T44** | Reports and does not fix: `packages/forge/scripts/recell-buildings.ts` still documents `SJ_ART_ROOT`, a mechanism that was deleted | Merge train 3's concern 4, in a package C8 does not own |
| **T50** | **The sixteen criteria are NOT amended.** A box is added recording that **criterion 5 got stronger without moving** — a zero can now only mean the minds would not — plus three gaps as OD20/OD21 and one reported column, and the note that **G8 must not gain a bridge criterion** | *"A gate whose criteria move to match what the code now does has measured nothing."* Recommend; the controller rules |
| **T51** | **Check 9's expected count corrected to eleven literals across seven files, twelve grep lines**, with the eleven enumerated and the decoy named as a must-not-appear | v4's *"nine across six"* would have STOPped on a correct tree |
| **T60** | **The `first_hut`-id exception is RETIRED** and replaced by the general rule that no task in this plan renames a milestone kind | The rename lane already paid the cost and moved the history; the exception has no subject |
| **T62** | **The `as InteriorKind` amendment becomes a VERIFY, not an APPLY.** `grep -rn "as InteriorKind" packages/` returns nothing; `isInteriorKind` is at `interiors.ts:91` and already guards `interiorOf` at `:98`. New note: **`shed` is now a buildable seed kind, so its stale interior layout could become reachable** | v4 was right and the tree already agrees with it. The amendment describes a tree that has been fixed |
| **T56** | `verbs.ts:118-121` → **`119-123`**; `verbs.ts:396` → **`397`** (declared at `:368`) | Citation drift |
| **T63** | `server.ts:160` → the line number dropped; there is no `interiorKinds` in `server.ts` | The citation no longer resolves |

**Plus four citation corrections applied across the document:** `interiors.ts:42-55` → `:42` builds it and `:54` is `roomFurnishings`; `cityTemplate.ts:38` → `:116` for `CityFurnishingSchema`; `groundField.ts:12-15` → `:13-15`; and **twelve lines carrying a superseded pin literal**, updated to the current four everywhere except C3's deliberate stale-branch table.

---

## Open decisions

| # | State |
|---|---|
| **OD2** | CLOSED by the setting lane (carried from v4) |
| **OD6** | CLOSED by the layout lane (carried from v4) |
| **OD16** | **★ CLOSED BY A MERGE.** Both drafts are on `main` at `docs/superpowers/content/`, re-authored, and **v4's own period grep returns nothing on either.** The tree is 103 nodes / 52 social with the era written as a **name**; the four canon story facts are ruled and carried into T3, T4 and T13. **The blocker comes out of T13 and out of Task 1's precondition table**; the gate is kept and now passes |
| **OD17** | **★ CLOSED BY A GREP.** `warmth.insulation.garment` is 12 at `config.ts:310`, and **six independent places on `main` say so** including the contradicting `c11.findings.test.ts:75`. No lane has moved it. **The coat stays struck, the bundle is four**, and the general clause — a bundle *value* is re-grepped at the moment the bundle is opened — is adopted as standing practice |
| **OD18** | **★ NEW, and the largest open item. Does the 103-node tree reach the arbiter, or only the scoreboard?** T14 seeds every node into `CodexStore`, whose `frontier()` feeds the adjudication prompt and whose `withinAdjacency()` gates codification; the user ruling of 2026-08-23 says the tree is a **yardstick, never a gate**, and that the nine-nobody-anticipated **are the result**. **Recommendation: the codex keeps `GENESIS_CODEX`'s thirteen; the tree becomes a scoring instrument read only by T49's report.** T14 builds the function and a test asserts nothing calls it |
| **OD19** | **★ NEW, and it blocks T22's commit.** `barn`, `pump_house` and `long_bridge` have no committed art against a gate covering every recipe key; `long_bridge` is also a plotted kind. **Recommendation, taken provisionally so T22 runs: `storehouse` (3 hands) and `shed` (2), both with committed cells in both facings, both already standing in the town; `long_bridge` deleted.** Option (a) commissions six cells and restores v4's names, and changes only T22's table. Option (c) — ship with no art and take the red — is named only so it is visibly rejected |
| **OD20** | **★ NEW. G8's criterion 5 passes on crafting alone**, and `craft` takes a recipe name, never a coordinate — it was not in batch 14's zero-use table and was never blocked. **Recommendation: split it. Gate `builds ≥ 1 across the run` as its own row and keep the sum.** A tightening derived in writing before the run, which C23 permits explicitly |
| **OD21** | **★ NEW. The Discovery Record exists and G8 reads none of it.** **Recommendation: report, never gate** — `discoveries: { total, byKind, byFinder }` plus the identity `discoveries.length === craftsCodified + wordsMinted`, which is the assertion that keeps the two codification paths from drifting. No baseline exists, and a threshold with no baseline is what C23 forbids. `byFinder` is a free mode-collapse signal |

---

## Contingent on the live `first-night` lane — nine tasks, named and not guessed

`first-night` is fixing a cast that collapses in the street on night one, a dev world with no mason, and two lying counters. **It is the one lane authorised to move G1.** A section at the end of the plan names each row and what changes; in one line each:

**T29** (may inherit a moved G1) · **T50 criterion 2** (currently unreachable — do not weaken it) · **T66** (whether `illness` needs `fatigue`'s rescue-window qualification) · **T55** (the rescue window's whole subject) · **T23** (`a.ill` fires before the hunger rungs) · **T59** (its entire purpose is that age must not read as illness) · **T62** and **T63** (no interior has ever been reached) · **T19/T20** (the lane's scripted mason must not become C8's).

**The honest expectation: T59, T66 and T50's criterion 2 are the three that will need words changed**, because all three make a claim about what illness is.

---

## Flagged, not solved

**Nothing gives a mind a reason to build a bridge.** The ruling is delivered — a deck opens the far bank on the tick it completes — but `CLAIM_RING_LIMIT` is 24 and the east bank holds hundreds of plots before the town needs the west. The only pressure is a refusal that will not fire for a very long time. **This is a society-design lever, not a plan edit**, and **G8 must not gain a bridge criterion**: a criterion nothing in the world motivates measures the author's hope.

---

## What did not change

G8's sixteen criteria, every one of them, including criterion 2 and criterion 3's demotion to REPORTED — **the three recommendations above are recommendations and the gate is unamended.** Phase D2's document position and the lever order enforced by it. The regen budget — one re-pin, in Phase F, still unspent, because both pins that moved were moved by other lanes on their own evidence. C29's setting law and every period test under it. The 66/15 structure and every task number. **And seven of v4's nine interface corrections, which were re-checked against `645a8d9` and all still hold** — row 4 is half-stale and row 9 is a no-op, and both are recorded above.

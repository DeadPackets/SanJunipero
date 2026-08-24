# C8 plan — v5 → v5b delta

`c8-plan-v5b` off `c8-plan-v5` @ `ee5d1c5`, re-verified against `main` @ **`645a8d9`**.
Input: `docs/superpowers/plans/2026-08-24-01-genesis-rehearsal-v5.DRAFT.md` (9 523 lines), `c8-v4-to-v5-delta.md`.
Output: `docs/superpowers/plans/2026-08-24-02-genesis-rehearsal-v5b.DRAFT.md` (9 980 lines).

**66 tasks, 15 phases, unchanged** — `grep -c "^### Task "` = 66, distinct numbers = 66, `grep -c "^## Phase "` = 15. No task added, deleted, renumbered or moved. **One task gains a Step 0** (T21, for OD22) and **one gains a Step 1c** (T22, the printed fixture).

**Why v5b exists, in one line each:**

1. **The four open decisions are ruled**, all four as recommended, and written into the tasks rather than appended to them.
2. **C-2 is discharged** — the described `siteUnderConstruction` step is printed in full.
3. **★ v5's C-1 limit was lifted and the plan was compiled.** **91 source-text claims were put to `tsc --noEmit` or to `tsx`; 80 survived and 11 did not.**
4. **The ~30 token-swept tasks were re-derived**, T32 and T49 first, and **six of the eleven failures came out of that pass**.

---

## ★ THE COMPILATION LEDGER — 91 CLAIMS, 80 SURVIVED, 11 DID NOT

Method: probe files in a scratchpad — **nothing under `packages/` was written** — importing the shared checkout, which was proved byte-identical to `645a8d9` by `git archive` + `diff -rq` (only `tsconfig.tsbuildinfo` and a `gateway/data` dir differ). Typechecked with `node node_modules/typescript/bin/tsc -p <probe>/tsconfig.json` under the repo's TS 5.9.3, and executed with `node node_modules/.pnpm/tsx@4.23.12/node_modules/tsx/dist/cli.mjs`.

| # | Task | The claim | Verdict |
|---|---|---|---|
| **1** | **T21** | *"`stepBuild` emits `structure_progressed` per builder per tick … 0.6 of a day for five"* | **★★ FAILED, and it is the largest finding. In a town two bodies cannot raise one building.** → **OD22** |
| **2** | **T32** | Step 2 seeds the codex from `codexEntriesFromTree()` | **FAILED — it violates OD18 and reds T14's own guard from inside this plan** |
| **3** | **T2** | `startingSkills: z.record(z.enum(SKILL_TRACKS), …)` | **FAILED — zod 4 enum-keyed records are EXHAUSTIVE; `.parse({farming:3})` returns 11 issues** |
| **4** | **T11** | `foldAll(initialState(DEFAULT_CONFIG, g.terrain), g.events, DEFAULT_CONFIG)` | **FAILED — neither name exists; the landed `foldAll()` takes no arguments** |
| **5** | **T22** | `stepBuild(state, DEFAULT_CONFIG, 'amara')` ×3 | **FAILED — `stepBuild.length === 2`; TS2554 on all three rows** |
| **6** | **T22** | Step 4: a seed kind with no art *"is where it goes red"* in `structureArt.test.ts` | **FAILED — `worldStructureKinds({…}).includes('barn')` is `false`; a seed kind is invisible to that gate** |
| **7** | **T25** | *"read `events` and the `agents_body` history from the world DB"* | **FAILED — there is no `agents_body`, anywhere, and a body is folded state** |
| **8** | **T44** | `bootstrap(freshCodex(), {root: '…/buildings-partial'})` rejects with `/buildings-partial/` | **FAILED twice — an absent root returns `[]` and throws nothing, and `bootstrap` cannot forward a root** |
| **9** | **T44** | *"20 cells across 14 kinds"* (3 places) | **FAILED — 20 cells across THIRTEEN kinds** |
| **10** | **C14(f)** | *"The world has no size"* | **FAILED as phrased — `DEFAULT_CONFIG.world.size` is alive and is `{w:128,h:128}`** |
| **11** | **T49** | *"the seamcheck … made into six live assertions"* | **FAILED — the list beneath it has eleven** |
| 12–91 | — | see below | **SURVIVED** |

**The 80 that survived, by group.** T32's whole landed surface (`replayLatest` terrain-third, `createWorldTick` arity 3, `EngineBridge` with no window, the derived `DEFAULT_RECENT_WINDOW_TICKS`, `watchBirths` arity 3, `applyLaw`, `checkSpend(db, {})`, `createLawsAdmin` opts, `SeamArbiter`, 94 genesis events, 128 terrain rows) — **12**. T49's printed schema, parsed and round-tripped under zod 4.4.3 including `.strict()` rejecting an extra key — **1**, plus the four ruled blocks proved parseable — **4**. T11's arithmetic and constants (15 loaves, 42 bar, 0.035, 60, 0.840, 4.20, 6-day bread, 11 structures, `cityStructures().length` 11, `cityRoadTiles()` arity 0 / 1178 tiles / `{dx,dy,to}`, `isRoadTile` non-vacuous, every loaf clocked, all five loaves privately owned, `mapGrowth` one key) — **15**. Every `@sj/*` import in every plan code block (`CITY_ANCHOR_DEFAULT` `{43,56}`, `DAYS_PER_YEAR` 364, `MINUTES_PER_DAY` 1440, `FOUNDER_IDS`, `FOOD_KINDS`, `HERB_KIND`, `PALE_MUSHROOM`, `isFoodKind`, `isRoadTile`, `cityRoadTiles`, `cityStructures`, `CodexStore`, `migrateArbiterTables`, `FounderId`, `SimConfig`, `RngStream`) — **16**. T2/T4's `SKILL_TRACKS` ↔ `DEFAULT_CONFIG.skills.tracks` agreement (identical, 12 tracks) and `xpLevelDivisor` 100 — **2**. T22/OD19's art (`listCommittedBuildings()` = 20, `storehouse`+`storehouse-se`, `shed`+`shed-se`, `isPlottedKind` true for both, `long_bridge` plotted) — **6**. T44's two ingest arities — **2**. T19/T20's seam (`makeablesLine(m, groundForBuilding?)` at `prose.ts:266`, the wiring at `agentRuntime.ts:444`, the exact sentence, `bridge.groundForBuilding()`, `bridge.makeables()`) — **5**. T14's `GENESIS_CODEX` = 13 and `CodexStore.{insert,frontier,withinAdjacency}` — **2**. The pin census — **12 grep lines**. T66's `DEATH_CAUSES` nine — **1**. And **131 `file:line` citations, all in range, none missing** (`cites.py`).

---

## The four rulings, written in

| # | Ruling | Where it landed |
|---|---|---|
| **OD18** | **ACCEPTED.** The codex keeps `GENESIS_CODEX`'s thirteen; the tree is a scoring instrument in T49's report; T14 builds the function and **a test asserts nothing calls it** | **T14's box rewritten** from *"until it is ruled"* to RULED; the guard's name goes `OD18 IS UNRULED` → `OD18 IS RULED, AND THIS IS THE RULING`; **a second row added asserting the LIVE codex is the canon's 13 and not the tree's 103**, because a guard that only says *"nothing calls the seed"* is satisfied by a supervisor that inserts 103 rows by hand; **T32 Step 2 rewritten**; T14 Step 3's *"the actual insert is done by the supervisor in T32"* struck; **T49's schema gains the `tree` block, which is the tree's one consumer** |
| **OD19** | **ACCEPTED.** `storehouse`/`shed`; **`long_bridge` deleted** | T22's box goes from *"taken provisionally"* to **RULED, option (a) closed**; and one correction that does not move the ruling — fault 2's *"reds the gate"* is **false**, the gate cannot see a seed kind at all, which is worse and is why T22's own coverage row is what binds |
| **OD20** | **ACCEPTED, as a TIGHTENING, and recorded as one** | T50 gains **criterion 17 — `production.builds ≥ 1`** (16 → 17), with a box stating in as many words that **the bar went up, not down**, and why that is the only direction a criterion may move after the code changes; T49 gains a `zero-builds` failure and the row that proves the split bites (a town that crafted 21 times and built nothing passes 5 and fails 17); T50 Step 1 and T51 check 1 both go *"sixteen"* → *"seventeen"* |
| **OD21** | **ACCEPTED.** Report; never gate | T49's schema gains `discoveries: {total, byKind, byFinder, craftsCodified, wordsMinted}` sourced from the landed `discovery_made` events; two rows — one asserting a zero still passes, one asserting the ledger identity `total === craftsCodified + wordsMinted` (`discovery-ledger-drift`); T24's box RULED; T51's not-gated table gains a row |

**Plus the ratified G8 verdict's third gap**, which the controller ratified with the rest: `mapChange: {ringsStanding, plotsClaimed, worldGrowths}` in T49, **reported and never gated**, and a T50 REPORTED row covering all six new columns. **G8 gains no bridge criterion** — restated where it stood.

---

## Tasks amended — 13 of 66, one line each

| Task | Amendment | Why |
|---|---|---|
| **T2** | **`z.record(z.enum(SKILL_TRACKS), …)` → `z.partialRecord(…)`** | **Executed: zod 4.4.3's enum-keyed record is exhaustive.** `FounderSchema` would have rejected T2's own `VALID` fixture and every founder in T3 and T4 at parse time. The tree already knows — `forge/src/terrainManifest.ts:16` uses `partialRecord` one line below a deliberate exhaustive `record` |
| **T11** | **`foldAll(initialState(…), g.events, DEFAULT_CONFIG)` → `foldAll()`, in both describe blocks**, with a note naming `genesis/world.test.ts:22` | Neither `initialState` nor a three-argument `foldAll` exists in `packages/`; the file these blocks are appended to already has a no-argument `foldAll` over `genesisState(config, terrain)` |
| **T11** | A measured box: every number in the larder table executed, plus `standing_stone` already has a committed SW cell and is a dev-town kind, so this task commissions nothing | *"A count in a plan is a claim"* — v5's own C-5 lesson, applied to a table nobody had run |
| **T21** | **NEW Step 0 — OD22's join path, PRINTED**: `joinableSite`, two one-line call sites in `buildSiteOf` and `stepBuild`, five test rows, its own commit | **T21's headline arithmetic is false in a town.** Printed rather than described, so option (a) costs an afternoon |
| **T21** | The header's *"per builder per tick"* qualified: true of the fold and of the sited branch, true of a town **only after Step 0** | The sentence was right about the mechanism and wrong about the world it runs in |
| **T22** | **`stepBuild(state, DEFAULT_CONFIG, id)` → `stepBuild(state, id)`, three rows** | `stepBuild.length === 2`; TS2554 on every one |
| **T22** | **NEW Step 1c — `siteUnderConstruction` and its five helpers, printed in full** (~60 lines), and **it throws with OD22's name** if it finds two sites | **C-2.** *"No step may describe what to do without showing how"* |
| **T22** | Step 4's *"this is where it goes red"* replaced by the measured truth: **`worldStructureKinds` cannot see a `SEED_STRUCTURES` key**, so the binding row is this task's own | An executor waiting for a red that never comes ships a kind the world can create and cannot draw |
| **T22** | *"20 cells, 14 kinds"* → **13 kinds** | Measured |
| **T25** | **`agents_body` struck.** Fold the `events` log and **reuse the landed `FullNeedTally`** (`g11report.ts:274`) at the same `FULL_NEED_SAMPLE_TICKS` | **There is no `agents_body` table.** And two accumulators for one number is how the live tax and the reported tax come to disagree |
| **T29** | **New: `g2.test.ts:33`'s `Previous value` comment is LOAD-BEARING** — `g12c.test.ts:142` asserts the file still contains `665a8249…` | A regen that tidies the superseded-value comments reds an anti-vacuity guard in another package, with a message about picking a different value |
| **T32** | **Step 2 seeds `GENESIS_CODEX`, not `codexEntriesFromTree()`**, plus a compile box recording that every other landed signature holds and that `tickLoop.paused` is T31's | **OD18.** This is the defect the ~30-task re-derivation existed to find |
| **T44** | Test 3 rewritten to write a half-cell into a `mkdtempSync` root and assert against `listCommittedBuildings` directly, **executed** (`buildings/shed: cell.png is missing`); a companion row records that an **absent** root is silent; `bootstrap` keeps its no-root signature; *"14 kinds"* → 13 | v5's row was vacuous and unimplementable: `if (!existsSync(root)) return []`, and `ingestProductionArt(db)` takes no root |
| **T49** | Schema gains `discoveries`, `tree` and `mapChange`; five new test rows; a source table for all three; *"six live assertions"* → **eleven** | OD18, OD20, OD21 and the ratified verdict. The schema is `.strict()`, so a ruling with nowhere to land is a ruling that does not land |
| **T50** | **Criterion 17 added; the tightening box; criterion 7 footnoted with OD22**; Step 1 asserts seventeen | OD20, and the honesty rule the controller asked to be on the record |
| **T51** | Check 1 *"sixteen"* → *"seventeen"*; two rows added to the not-gated table | Follows OD20 and OD21 |

**Plus two global corrections:** **C14(f)** — *"the world has no size"* becomes *"the world has no CEILING"*, because `DEFAULT_CONFIG.world.size` is alive at `{w:128,h:128}` and `world.test.ts:38` asserts it; and the header's v5b box, which states the compilation count and OD22 up front.

---

## Open decisions

| # | State |
|---|---|
| **OD18** | **★ RULED 2026-08-24 — ACCEPTED as recommended.** Yardstick, never a gate |
| **OD19** | **★ RULED 2026-08-24 — ACCEPTED as recommended.** `storehouse`/`shed`; `long_bridge` deleted; no longer provisional |
| **OD20** | **★ RULED 2026-08-24 — ACCEPTED as recommended.** Criterion 17, recorded as a tightening |
| **OD21** | **★ RULED 2026-08-24 — ACCEPTED as recommended.** Report, never gate |
| **OD22** | **★★ NEW, AND IT BLOCKS T22.** Two bodies cannot raise one building in a town. **Recommendation: take the join path, printed as T21 Step 0.** Option (b) — delete `minHands` and the joint-build clause — is named as a real answer with its cost. Option (c) — ship the sentence anyway — is named only so it is visibly rejected. **G8 criterion 7 is unpassable until this is ruled** |
| OD2, OD6, OD16, OD17 | CLOSED (carried) |

---

## The pin census, re-derived independently at `645a8d9`

```
$ git grep -n "f487a26b\|00d72434\|da065752\|4205d892" 645a8d9 -- 'packages/**/*.ts' | wc -l
12
```

**ELEVEN full literals across SEVEN files, TWELVE grep lines. v5's numbers, confirmed from the tip rather than from v5's table.** The twelfth line is `arbiter/src/g4.test.ts:208`, a prefix inside a test name. `agents/src/live/g11checkpoint.test.ts:15` carries `a90bd747…` in a frozen `G11Fingerprint` fixture — **two forge pins stale, compared to nothing, a decoy and not a copy, exactly as v5 said.** The wider grep `git grep -nE "[0-9a-f]{64}"` returns **19** lines; the other seven are six `Previous value:` comments and that decoy, and **one of the six is asserted by `g12c.test.ts:142`** — new in v5b, and now in T29.

---

## What did not change

The 66/15 structure and every task number and document position. **G8's other sixteen criteria, including criterion 2 and criterion 3's demotion.** The regen budget — one re-pin, Phase F, still unspent; OD22's fix changes site resolution and not a fold, and its own step asserts both goldens. C29's setting law and every period test under it. The `first-night` contingency section — **still nine tasks, refreshed with three facts and no guesses**, and the honest expectation that T59, T66 and criterion 2 are the three that will need words. Every one of v5's fourteen stale-task amendments, all re-checked and all still correct — **v5's diagnosis was right in every case; what v5b adds is the eleven it could not have found without running anything.**

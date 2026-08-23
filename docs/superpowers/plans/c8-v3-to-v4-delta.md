# C8 plan — v3 → v4 delta

`c8-plan-v4` off `main` @ `cd845bc`. Input: `c8-plan-v3` @ `51a98a2`, ratified by `c8-v3-controller-rulings.md`.
Output: `docs/superpowers/plans/2026-08-23-01-genesis-rehearsal-v4.DRAFT.md`.

**66 tasks, 15 phases, unchanged.** No task added, deleted, renumbered or moved. 45 of 66 are byte-identical to v3.

**Why v4 exists:** v3's genesis prose was written against a neolithic canon that merge train 6 replaced with modern-day countryside. Settling the setting now avoids doing C8's genesis twice.

---

## Global constraints

| # | Change | Why |
|---|---|---|
| **C3** | Re-read all four pins at `cd845bc`; **added the five copies v3 did not name** — `gateway/src/g12c.test.ts:87/90/101/102`, `agents/src/live/g11checkpoint.test.ts:15`, `engine/src/g9.test.ts:588-589` (which assert by reading other test files as source text) | v3 named two copies of G1 and none of the rest. A re-pin that misses four leaves red tests in three packages |
| **C3** | Added the closing paragraph: **C8 inherits whatever pin values the rename lane leaves on `main` and re-derives none** | The rename lane moves the forge pin on its own authority |
| **C14** | **Rewritten in full** for the landed town: eleven structures, four districts, roads, four dwelling masses; plus the three signature facts (`cityRoadTiles()` takes no argument and yields `dx`/`dy`; `doorTile` takes a structure and returns nullable; `PLAZA*` are template-relative) | v3 described the old five-identical-homes town and three helper signatures that no longer hold |
| **C29** | **NEW — the setting law.** Contemporary rural; nothing pre-industrial in a mind-facing string; `FORBIDDEN_FRAMING` bans "tool"; the one-way glass bans `custom`/`market`/`council`/`festival`/`faith` over `CANON` | The whole reason for v4 |
| **C30** | **NEW — the home kind is `house`**, never `hut`, never `cabin` (a live fixture kind). C8 spends no regen on the rename | The parallel lane lands before C8 executes |
| **C31** | **NEW — a `main...HEAD` scope assertion is scaffolding and comes down at merge** | Setting-lane R4; the sixth member of the "guard that became false" family |

---

## Tasks amended — 21 of 66, one line each

| Task | Amendment | Why |
|---|---|---|
| **T1** | Step 0 goes from two preconditions to four: tip is now `cd845bc`; the pin grep gains the all-copies command; **new** — the `house` rename must have landed; **new** — the canon must be the contemporary one. Each is a STOP | v3 checked a tip two trains stale and could not detect either of the two new blockers |
| **T1** | Step 2 gains **the content period gate** with its own grep and an explicit "this is not an executor's edit" STOP | Both frozen content drafts are neolithic (OD16) |
| **T1** | `git mv` repointed to the v4 filename; the roadmap's executed order gains the setting, layout, forge and rename lanes | v3's filename and order were stale |
| **T3** | Amara gains a `preIndustrial` test row over `backstory`, `secret`, `exampleLines`, `values`, `beliefs` | The signed draft is a hedge-healer's life; a faithful transcription would put it in a prompt |
| **T4** | **`fertileYears` destructure corrected from a tuple to `{ from, to }`** | It is an object at `config.ts` ReproductionSchema; v3's `const [lo, hi]` yields two `undefined`s and every comparison is `false` |
| **T4** | New row asserting `SKILL_TRACKS` equals `DEFAULT_CONFIG.skills.tracks`; the period row is required per founder file; `smithing`/`brewing` period-checked and kept, with the reason | Two lists of twelve names in two packages, never asserted equal |
| **T9** | **`sexOf` import corrected to `../systems/reproduction.js`** | It has never been in `mortality.ts` |
| **T9** | **`doorTile(state, house)` not `(state, house.id)`, and it returns `Point \| null`** — plus a STOP on a null door | The landed signature; v3's call typechecks as never |
| **T9** | New row: founders' doorsteps must not land on the three unowned fixture dwellings | The town now has eight dwellings and only five are owned |
| **T10** | `ENDOWMENT_TOOLS` → **`ENDOWMENT_KIT`, derived from `FOUNDER_KIT`** rather than typed, with a source-level test that no item id is retyped | `waterskin` is a period name the cross-lane rename retires (setting-lane R3); a second hand-typed copy orphans its codex record |
| **T10** | The `world.ts` loop snippet corrected to the landed `houseIdByOwner.get(founder)` shape; prose says "implement", never "tool" | v3 indexed a `hutIndexes` array that does not exist; `FORBIDDEN_FRAMING` bans the word |
| **T11** | **`cityRoadTiles()` call corrected** — no argument, `dx`/`dy`, anchor added, plus a non-empty guard on the road set | v3's road set was empty, so the "stands on no road" assertion passed vacuously |
| **T11** | The standing stone's **C29 exemption** stated, with its one binding limit (never explained); the twelfth-structure note added | A prehistoric stone in a modern valley is correct; a reader would otherwise think it breaks the layout lane's pinned eleven |
| **T12** | **Node-id regex widened to `/^[a-z0-9_-]+$/`**, with its own test row | Four of the canon's thirteen ids carry `_` and would fail to parse |
| **T12** | Fixture ids `fire`/`hearth` → `farming`/`work_rota`; bad-unlock fixture `Weapon:Spear` → `Machine:Pump` | A neolithic fixture is how neolithic ids reach real content |
| **T13** | **BLOCKED** — a Step 0 period grep, a `preIndustrial` test row, a row asserting every `GENESIS_CODEX` id is a node, and the counts re-framed as a truncation guard rather than a target | The 104-node draft opens `stone-tools`, `cordage`, `hide-curing`, `pit-kiln`, `fired-pottery` |
| **T14** | **REWRITTEN.** `CODEX_ERAS` and the derived `PRACTICED_AT_GENESIS` replaced by the landed `ERAS` and `GENESIS_CODEX`; `frontier()` reads as `string[]`; `withinAdjacency` fixtures become `work_rota`/`foundry`; four new rows including the frontier-is-an-arrangement one | v3's era names, known set and derivation all came from the canon train 6 deleted |
| **T14** | **The canon moves to `@sj/shared` first, as its own commit**, with a `CANON` sha256 assertion | `@sj/arbiter` depends on `@sj/engine`, so the engine importing the canon where it lives is the cycle C12 forbids. Measured, not assumed |
| **T14** | **Open Decision 2 closed** — the genesis frontier is the canon's, not C8's to propose | The setting lane derived it and `setting.test.ts` already asserts the agreement |
| **T19–T21** | `house` throughout; **`buildTicks` → `durationTicks`** in the progress-band derivation and both perception fixtures | `StructureRecipeSchema` has always been `durationTicks` |
| **T22** | **`SeedStructure` re-shaped field-for-field with `StructureRecipeSchema`** (`durationTicks`, field order) | v3's `??` would have returned two differently-shaped objects |
| **T22** | Heavy kinds **`granary` → `barn`, `kiln` → `pump_house`**, each with its physical reason; new row forbidding a kind the canon puts out of reach | A kiln is the single most recognisable thing the new canon denies |
| **T24** | **`isExpressive(attempt)` — one argument**, in three places | The landed signature is `isExpressive(intent: string): boolean` |
| **T24** | The tailoring phrase *"the loom"* → *"the needle"* | It names the skill, not the machine, and a needle is what a contemporary hand at that track holds |
| **T29** | **REWRITTEN. Bundle member (3), the coat, is STRUCK — `garment` is already 12** (C11 Task 37b), and **v3's proposed test directly contradicts the landed `c11.findings.test.ts:75`**. Five members become four; one row added pinning `garment === 12` | An executor writing v3's row would have found it red against a landed test and could have "fixed" it by pushing `garment` past 12, undoing a measured C11 finding. **OD17** |
| **T29** | The re-pin step **names all nine copies of the four pins**, with the two traps (`g9.test.ts`'s source-text assertions, `g11checkpoint.test.ts`'s fixture `configHash`) called out | v3 named two |
| **T29** | Two non-members added: `warmth.insulation.garment`, and the rename lane's `structures.*Kinds` / `construction.house*` keys. Plus a note that `skills.tracks` is not renamed for period reasons | Two lanes re-pinning the same hash is a merge conflict on a golden |
| **T33** | **`TIER1` → `TIER1_DEFS` and `.id` → `.kind`** | The export is `TIER1_DEFS` at `tier1.ts:52` and entries are keyed `kind`. v3's row could not run |
| **T33** | `first_house` reverted to `first_hut` in the milestone-kind assertion | A milestone kind is a primary key in recorded databases; T60 documents the exception |
| **T51** | Check 9's grep gains the all-copies command and states the expected count of nine across six files | A missed copy is a stale hash nothing currently runs |
| **T55** | **New Step 0: build `packages/engine/src/testFixtures.ts`** — nine builders, its own four tests, a test-only assertion, its own commit | v3's T55, T58, T59, T60 and T62 all import nine helpers from `scripted.ts`, **which is the G1 golden's actor set and exports none of them** |
| **T56** | **`WANT_SATISFIED_BY` derived from `FOOD_KINDS`**, excluding `herb` (0.05 nutrition) and `pale_mushroom` (the one that kills) | v3 typed `meat` and `grain`, which are not ids; the real ones are `rabbit_meat`, `venison`, `wheat` |
| **T56** | **`thirst` is deliberately EMPTY**, with the reason and a test; `givingLine` returns null on an empty list | `drink` validates a place, not an item. A waterskin quenches nobody, so v3's road was a false road |
| **T56** | `cold` reduced to `['garment']`; a per-cause **`WOULD`** closing clause added | `gourd`, `cloak` and `firewood` do not exist; a coat does not "feed" anybody |
| **T57–T61** | `house` throughout; fixture imports retargeted to `testFixtures.js` | The rename and the fixture module |
| **T60** | **`first_elder_death` is a `TIER1_DEFS` row, not a "SemanticFirst union" member**, written out; plus the `first_hut`-id exception and its reason | There is no such union; `SemanticFirstRow` is an LLM-pass DB row |
| **T62** | **`roomFurnishingsFor`'s `as InteriorKind` cast replaced with `isInteriorKind`**, with its own test | `cottage`, `cabin` and `farmhouse` are not `InteriorKind`s; `roomFurnishings` returns `undefined` and `.map` throws |
| **T62** | Three stale `file:line` citations corrected (`interiors.ts:38`→`42-55`, `cityTemplate.ts:33`→`38`, `state.ts:66`→`67`) | Train 6 moved them |
| **T63** | `house` in the `interiorKinds` fixtures; `server.ts:157`→`160` | The rename and train 5 |
| **T64** | `house` throughout | The rename |

---

## Open decisions

| # | State |
|---|---|
| **OD2** | **CLOSED by v4.** The genesis frontier is `GENESIS_CODEX`, landed and canon-agreeing. T14 imports it |
| **OD5** | Still open, and now about a `wagon` the layout lane removed from the town |
| **OD6** | **CLOSED by v4.** The occluding shed is gone; `cityTemplate.ts` stays C8-frozen |
| **OD16** | **NEW, and the largest open item.** Both frozen content drafts are period-wrong. Recommendation: commission the tree now (blocks T13/T14, Phase B) and the founders before run C (blocks T3/T4 and one arm); the stated alternative is dropping the authored arm from v1 |
| **OD17** | **NEW.** T29's bundle loses the coat: already 12, and v3's test contradicts a landed one. Recommendation: strike it, the bundle is four, and confirm that a bundle **value** is re-grepped from the tip when the bundle is opened |

---

## What did not change

G8's sixteen criteria, including criterion 2 (zero unforced deaths, every day, all three runs) and criterion 3 demoted to REPORTED. Phase D2's document position and the lever order enforced by it. The regen budget — one re-pin, in Phase F, unspent as of this draft. The 66/15 structure and every task number.

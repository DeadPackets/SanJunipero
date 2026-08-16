# Living World (C9) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land every pre-v1 emergence lever ruled in on 2026-08-16 — structure interiors + earshot occlusion, item ownership with maker's marks and witnessed theft, biology-only reproduction (co-sleep partnership inference → seeded conception → gestation → child born at age 12 as a full live mind), unbounded population with an operator spend alert, scarcity dials (spoilage, harsher winters, tool wear), core-verb inscription, mystery events, elder-aging polish, humanizer speech rules + per-persona budgets, refusal path hints, arbiter live wiring expansion (unknown-verb routing, live codification, expert crafts), the three probe bugs (BudgetGuard reservation, reflection-on-exhaustion fallback, bridge drain), and runtime world-law toggles for every C9 feature — `config_changed` events, operator dashboard, viewer "World Laws" panel (user ruling 2026-08-16) — then pass GATE G9.

**Order:** C9 executes after C6/C7 and BEFORE C8. C8's draft plan is audited (Task 26), never edited here.

**Architecture:** All world mechanics are engine physics: new Tier-1 verbs (`enter`, `exit`, `stow`, `inscribe`), new event types folded purely, new midnight systems (`spoilage`, `reproduction`, `mystery`) drawing only from named RNG streams at event creation. Ownership and interiors ride on optional event-payload fields so old logs still parse; the golden fixture is regenerated once, deliberately, in its own task. Mind-side work lives in `@sj/agents` (prompt blocks, budgets, spend monitor, child-mind pipeline + hybrid naming, arbiter routing) and `@sj/arbiter` (durability effects, canon line). World-law toggles (user ruling 2026-08-16): active overrides live in `WorldState.laws` (hashed), flips exist only as `config_changed` events at tick boundaries, the operator edits them through a localhost+token gateway admin channel, and viewers get a read-only "World Laws" panel — the only C9 code in `@sj/gateway`/`@sj/web`. No `@sj/supervisor` package is created — C8 owns it and wires what C9 exports.

**Tech Stack:** TypeScript ESM, Node 24 LTS, pnpm workspaces, Vitest, better-sqlite3 v13, Zod 4, Vercel AI SDK 7 + OpenRouter (`deepseek/deepseek-v4-flash-0731`).

**Spec:** `docs/superpowers/specs/2026-08-15-san-junipero-design.md` + C9 addendum `2026-08-16-living-world-addendum.DRAFT.md` (companion to this plan — mechanics, config keys, event vocabulary, G9 criteria live there and are binding).

---

## Global Constraints

- TypeScript, ESM (`"type": "module"`), Node 24 LTS, pnpm workspaces, strict tsconfig.
- Test runner: Vitest. TDD per task. Commit per task minimum.
- SQLite via `better-sqlite3` v13, WAL mode, one DB file `data/town.db`.
- All LLM calls: Vercel AI SDK 7 + `@openrouter/ai-sdk-provider@^3`, model pinned `deepseek/deepseek-v4-flash-0731`.
- Zod 4 for every schema; new object schemas `.strict()`; new event-payload fields on existing events are `.optional()` so recorded logs keep parsing.
- Determinism law: randomness drawn ONLY at event-creation time by named RNG streams (`reproduction`, `mystery` are new), recorded in payloads; `fold(events)` stays pure and RNG-free.
- **Golden regen is a single deliberate event** (Task 16 only). Every other task keeps the current golden suite green; a task that unexpectedly changes the hash STOPS and reports.
- No world text ever references AI/tools/prompts. New refusal strings, verdict suffixes, SPEECH_RULES, and mystery prose all pass `FORBIDDEN_FRAMING`.
- One-way glass intact: no new write path from narrator/observatory into world or minds; spend alerting writes `alerts` rows only.
- packages/agents changes are allowed and expected (this chunk owns prompt work). packages/supervisor is NOT created here.
- Live-API tasks (Task 28 only) start with a hard USD cap; `process.exit(1)` past the cap.
- Baseline: `main` @ d0d3562. NOTE: two C4-probe leftovers to verify at Task 19 (arbiterSeam may not exist on main — it is a C8-draft interface, adopted here).

## File Structure

| File | Responsibility |
|---|---|
| `packages/shared/src/config.ts` | new config sections: structures, reproduction, spoilage, seasons, tools, mystery, crafting.expert*, aging.elder* |
| `packages/engine/src/interiors.ts` | `doorTile(s, state)`, `sameInterior(a, b)`, occupancy helpers |
| `packages/engine/src/verbs.ts` | new verbs `enter`/`exit`/`stow`/`inscribe`; ownership in `give`/`take`/`craft`/`harvest`/`fish`/`forage`; walk-inside refusal; craft refusal hint |
| `packages/engine/src/state.ts` | `AgentBody.{sex, insideId?, pregnant?, parents?}`, `Item.{owner?, crafterMark?, spoilage?, durability?}`, `Structure.inscription?`, `WorldState.pairNights` |
| `packages/engine/src/events.def.ts` + `fold.ts` | 12 new events + payload extensions per addendum §14 |
| `packages/engine/src/perception.ts` | occlusion, interior sight, `seen` channel, owner/mark names, spoiling flag, age bands, inscriptions |
| `packages/engine/src/systems/{spoilage,reproduction,mystery}.ts` | new midnight/daily systems |
| `packages/engine/src/data/{names,mysteries}.ts` | authored name lists + mystery table (initial conditions) |
| `packages/arbiter/src/verdict.ts` + `codify.ts` | `spawn_item` durability option, tool wear on codified recipes, expert-craft maker's mark; canon line for mysteries |
| `packages/agents/src/prompt/rulesOfBeing.ts` | `SPEECH_RULES` block; CAPABILITIES additions (enter/exit/stow/inscribe, ownership language, stow replaces "no way to shelve") |
| `packages/agents/src/prompt/assemble.ts` | render `wordBudget`; IdentityCore extension |
| `packages/agents/src/runtime/arbiterSeam.ts` | Adjudicator seam (adopted from C8 draft Task 12) + unknown-verb routing + codify-live flow |
| `packages/agents/src/llm/client.ts` (+ `callLog.ts`) | reservation-based budget guard |
| `packages/agents/src/reflection.ts` | budget-exhaustion mechanical fallback |
| `packages/agents/src/runtime/bridge.ts` | `drain(reason)` |
| `packages/agents/src/llm/spendMonitor.ts` | daily-spend projection + alert |
| `packages/agents/src/family/{derivePersona,memorySeed,watchBirths,socialName}.ts` | child-mind pipeline + hybrid naming (user ruling 2026-08-16) |
| `packages/engine/src/laws.ts` | `TOGGLABLE_PATHS`, `effectiveConfig`, `applyLaw` queue (user ruling 2026-08-16) |
| `packages/gateway/src/adminLaws.ts` | localhost+token admin listener; law command → `applyLaw` (user ruling 2026-08-16) |
| `packages/web/src/{admin/LawsDashboard,panels/WorldLaws}.tsx` | operator edit surface + read-only viewer panel (user ruling 2026-08-16) |
| `packages/engine/src/live/` — none | G9a is a normal Vitest suite; G9b script at `packages/agents/scripts/g9-livingworld.ts` |

---

### Task 1: Config schema additions

**Files:** Modify `packages/shared/src/config.ts`; test `packages/shared/src/config.test.ts` (extend).

**Interfaces — Produces (binding for every later task):** all keys/defaults from addendum §13, as new `.strict()` sections `structures`, `reproduction`, `spoilage`, `seasons`, `tools`, `mystery` plus `crafting.expertLevel/expertDifficulty` and `aging.elderEnergyDecayMultiplier`, each `.prefault({})` so `DEFAULT_CONFIG = SimConfigSchema.parse({})` keeps working. Every C9 feature section carries an enable flag defaulting `true` — `reproduction.enabled`, `aging.deathOfOldAgeEnabled`, `spoilage.enabled`, `tools.wearEnabled`, `mystery.enabled`, `occlusion.enabled`, `ownership.enabled`, `inscription.enabled` (user ruling 2026-08-16, addendum §19). Also `export const SPAWN_AGE_YEARS = 12` in `@sj/shared` (world law constant, NOT config).

- [ ] **Step 1:** Failing test: parse `{}` → assert every new default (e.g. `reproduction.gestationDays === 72` (user ruling 2026-08-16), `structures.privateKinds` deep-equals `['hut']`, `spoilage.days.fish === 2`); assert unknown keys inside a new section reject (`.strict()`).
- [ ] **Step 2:** Run `pnpm vitest run packages/shared/src/config.test.ts` — FAIL.
- [ ] **Step 3:** Add the sections per addendum §13.
- [ ] **Step 4:** Test + `pnpm typecheck` PASS; run full engine suite — golden hash MUST be unchanged (config additions are inert until systems land).
- [ ] **Step 5:** Commit `feat(shared): C9 sim-config sections (interiors, reproduction, spoilage, seasons, tools, mystery, expert crafts)`.

### Task 1b: Road tile and config-priced terrain costs

> EXECUTED in batch 1 (05cc218). Entry added by the 2026-08-16 plan repair (audit A0): the task
> was reconstructed from deep-world addendum §3, the v1-core findings ledger, and the C10 plan
> (which pins `ROAD_TILE = 7`) because the ratified plan text carried no Task 1b. Steps below
> describe what was built.

**Files:** Modify `packages/engine/src/state.ts` (`TileId` widens `0..6` → `0..7`), `path.ts`
(`terrainCostFor`, `findPath(..., config?)`), `events.def.ts` (`TerrainChanged.tile` `.max(6)` →
`.max(7)`), `fold.ts` + `verbs.ts` (thread config into walk pathing), `packages/shared/src/config.ts`
(new `pathing` section), `packages/web/src/render/ground.ts` (`TILE_COLORS` gains a `7` entry);
tests `path.test.ts`, `config.test.ts`.

**Interfaces — Produces:**
```ts
export type TileId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7            // 7 = road, the id the C10 plan pins as ROAD_TILE
export function terrainCostFor(config: SimConfig): Record<TileId, number>  // pure; 7 → config.pathing.roadCost
export const TERRAIN_COST: Record<TileId, number>             // = terrainCostFor(DEFAULT_CONFIG), retained for existing callers
```
C10 owns the named `ROAD_TILE` constant and the road texture; C9 lands the tile id, its price, and
a placeholder colour in `TILE_COLORS` only.
Config: new `.strict().prefault({})` section `pathing` holding **`roadCost: 0.6` ONLY** — per audit
A3, `pathing.maxNodes` / `pathing.regionSize` are C11's keys and must NOT be added here.

- [x] **Step 1:** Failing tests: `terrainCostFor(DEFAULT_CONFIG)[7] === 0.6`; costs `0..6`
  byte-identical to the old const; a monotone route across road tiles is preferred over grass;
  `pathing` rejects unknown keys.
- [x] **Step 2–4:** FAIL → implement → PASS; `pnpm typecheck` green; G1 + G2 hashes unchanged (no
  fixture map contains tile 7).
- [x] **Step 5:** Commit `feat(engine): road tile 7 and config-priced terrain costs`.

**Recorded caveat (batch 1):** the A\* Manhattan heuristic is inadmissible once a tile costs < 1,
so road preference is guaranteed only on monotone routes (which the tests pin). Correcting the
heuristic would move existing paths and both goldens — left alone, flagged for C11's pathing task.

### Task 2: Structure interiors — doors, enter/exit, insideId

**Files:** Create `packages/engine/src/interiors.ts` + `interiors.test.ts`; modify `state.ts` (`insideId?: string` on AgentBody — optional, absent-until-first-use for hash stability), `events.def.ts` + `fold.ts` (`agent_entered`/`agent_exited`), `verbs.ts` (verbs `enter`, `exit`; `walk` refuses while inside: `'you are indoors; step outside first'`), `intent.ts` untouched, `index.ts` exports.

**Interfaces — Produces:**
```ts
// interiors.ts
export function doorTile(state: WorldState, s: Structure): { x: number; y: number } | null // pure; south-center, clockwise fallback
export function insideOf(state: WorldState, agentId: string): string | null
export function sameInterior(state: WorldState, aId: string, bId: string): boolean
```
Verb semantics per addendum §1: `enter {structureId}` requires complete + kind ∈ `config.structures.enterableKinds` + within reach of door + not inside; emits `agent_moved`(door) + `agent_entered`. `exit` emits `agent_exited`. Fold: `agent_entered` sets `insideId`, `agent_exited` deletes it. Engine ejects occupants on `structure_destroyed`/`fire_ignited`-driven destruction: fold of `structure_destroyed` clears any `insideId` referencing it (emit-free state repair is NOT allowed — instead `fireSystem`/destruction paths emit `agent_exited` first; fold throws if a structure with occupants is destroyed without prior exits, keeping event streams honest).

- [ ] **Step 1:** Failing tests: door derivation (plain hut → south-center; blocked south → clockwise fallback; fully walled → null); enter/exit round-trip sets/clears `insideId` and parks the body on the door tile; enter refused for construction-stage, non-enterable kind (`standing_stone`), out of reach; walk-while-inside refused; destruction with an occupant: system emits exit-then-destroy, fold-only destroy with occupant throws.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Suite + typecheck PASS; golden hash unchanged (no existing scripted actor enters anything). **Step 5:** Commit `feat(engine): structure interiors — doors, enter/exit verbs, insideId occupancy`.

**Also landed here (audit A2, batch 1):** `Structure.owner?: string` — **absent = public**, NOT the
literal `owner: string | null` the deep-world POST-REVIEW RULING 1 wording implies, because
`stableStringify` drops `undefined` keys but hashes `null`, so the literal form would stamp
`owner: null` on every existing structure and move G1/G2 on the spot. `build` sets
`owner = builderId` behind `config.ownership.enabled`; `structure_planned` gains an optional
`owner`. No behavioural rule rides on it — entering or sleeping in another agent's hut stays legal
and is merely witnessed. The G2 fixture pins `ownership.enabled: false` so batch-1 goldens stay
byte-identical; **Task 16 removes that pin** (see Task 16 Step 0).

### Task 2b: Sleep is indoors-only — the bed law

> EXECUTED in batch 1 (0ca0427). Entry added by the 2026-08-16 plan repair (audit A0): the task
> was reconstructed from deep-world POST-REVIEW RULINGS 1 ("sleep law checks kind + indoors only")
> and the C10 plan ("sleep-in-bed is C9 Task 2b's law") because the ratified plan text carried no
> Task 2b. Steps below describe what was built.

**Files:** Modify `packages/shared/src/config.ts` (`structures` section gains `sleepIndoorsOnly`,
`sleepableKinds`), `packages/engine/src/verbs.ts` (`sleep.validate`); tests `config.test.ts`,
`interiors.test.ts`; pin the flag off in the pre-C9 bare-world fixtures (`g2.test.ts`,
`worldTick.test.ts`, `agentRuntime.test.ts`).

**Interfaces — Produces:** config `structures.sleepIndoorsOnly: true` (a §19-style C9 feature flag,
default true) and `structures.sleepableKinds: ['hut']`. Law: `sleep` is refused unless the agent is
inside (`insideId`, Task 2) a **complete** structure whose `kind ∈ structures.sleepableKinds`.
Diegetic refusal, exact string: **`'there is no bed here; find somewhere to lie down'`**.
**Collapse excepted** — an agent with `collapsedSinceTick !== null` may sleep anywhere; the
collapsed-sleep recovery flow and the G2 Idler rescue arc depend on it. **Ownership is NOT
checked** (deep-world RULINGS 1, verbatim). `structures.sleepIndoorsOnly` and `ownership.enabled`
both join `TOGGLABLE_PATHS` in Task 15b.

- [x] **Step 1:** Failing tests: sleep inside a complete hut allowed; outdoors refused with the
  exact string; inside an incomplete hut refused; collapsed agent sleeps anywhere; flag off →
  pre-C9 behaviour restored.
- [x] **Step 2–4:** FAIL → implement → PASS; typecheck green; G1 + G2 hashes unchanged.
- [x] **Step 5:** Commit `feat(engine): sleep needs a roof — indoors-only bed law, config-gated`.

**Recorded measurement (batch 1):** over the 3-day G2 run the law ON yields 13 sleeps / 14
collapses / 72752 events, OFF yields 21 sleeps / 2 collapses / 65550 events — and **both hash to
`7263dde9…`**. The pin is therefore not needed to hold the hash; it is needed to stop a hut-less
pre-C9 fixture becoming a collapse farm and silently invalidating its own documented narrative.
Corollary for every later task: a matching golden hash is weaker evidence of "no behavioural
change" in this codebase than it looks.

### Task 3: Perception — occlusion, interior sight, witnessed channel

**Files:** Modify `packages/engine/src/perception.ts` + `perception.test.ts`; `events.def.ts` (`agent_spoke` +`insideId?`), `verbs.ts` (speak onComplete records speaker's `insideId`).

**Interfaces — Produces:** `PerceptionPacket` gains `seen: SeenEvent[]` (empty this task; filled by Task 5); hearing rule and interior sight exactly per addendum §1 (`hears(state, speakerEv, hearer)` pure helper exported for tests). `PerceivedAgent` unchanged for outsiders — inside agents simply absent.

- [ ] **Step 1:** Failing tests: inside↔inside same hut hear at any interior arrangement; inside→outside heard only at Chebyshev ≤ 1 of door; outside→inside symmetric; both outside = radius 8 unchanged (regression rows); insider sees co-occupants + structure items and NOT the meadow; outsider does not see insiders; adjacent-peek at contents still works.
- [ ] **Step 2–4:** FAIL → implement → PASS; golden unchanged (perception is a projection, not state). **Step 5:** Commit `feat(engine): earshot occlusion and interior sight`.

### Task 4: Item ownership — core rules

**Files:** Modify `packages/engine/src/state.ts` (`Item.owner?`, `Item.crafterMark?`), `events.def.ts` + `fold.ts` (`item_owner_changed`, `item_taken`; `item_spawned` +`owner?`+`crafterMark?`), `verbs.ts` (give transfers owner; take claims unowned / emits `item_taken` for owned-by-other; harvest/fish/forage/craft spawn with `owner`), test `packages/engine/src/ownership.test.ts` (new).

**Interfaces — Produces:** ownership law per addendum §2. `item_taken` payload `{itemId, kind, takerId, ownerId, x, y}` — pure witness record, no fold effect. Death: extend `worldTick.ts` `dropHeldItems` test only (owner must survive the drop — no code change expected).

- [ ] **Step 1:** Failing tests: forage → owner = forager; take unowned → `item_moved` + `item_owner_changed{owner:taker}`; give → both events, owner = receiver; take owned-by-other → `item_moved` + `item_taken`, owner UNCHANGED; dead owner's dropped item keeps owner; stowed/given items keep `crafterMark` forever.
- [ ] **Step 2–4:** FAIL → implement → PASS; golden hash: scripted G2 actors DO take/give — if the hash moves, STOP and report (expected: unchanged because new payload fields are optional and `item_owner_changed`/`item_taken` are new emissions... they ARE new emissions in existing scripted flows, so the hash WILL move → per Global Constraints this is the one pre-approved exception: mark the suite `it.todo` for the hash row and hand the regen to Task 16, which un-todos it. Note this in the task report.)
- [ ] **Step 5:** Commit `feat(engine): item ownership — acquisition, transfer, witnessed taking`.

### Task 5: Perception — ownership prose + `seen` entries

**Files:** Modify `packages/engine/src/perception.ts` + tests.

**Interfaces — Produces:** `PerceivedItem` and inventory entries gain `ownerName?`, `crafterMarkName?` (resolved via `state.agents[...].name`, dead agents included); `seen` fills from recent `item_taken` events where the take position is within sight and taker ≠ self: `{kind:'item_taken', takerName, ownerName, itemKind}`.

- [ ] Steps: failing tests (owner name on visible + held items; theft seen by in-sight third party; invisible beyond sight; self-take not echoed) → implement → PASS → commit `feat(engine): perception surfaces ownership and witnessed takings`.

### Task 6: `stow` verb

**Files:** Modify `packages/engine/src/verbs.ts` + `verbs.test.ts`.

**Interfaces — Produces:** `stow {itemId, structureId}` — holding item; structure complete; inside it or within `nearRect`; same-interior law applies; emits `item_moved` to `{t:'structure', id}`; owner unchanged. Registered in `VERBS`.

- [ ] Steps: failing tests (stow from inside and from adjacent outside; refused mid-construction / out of reach / not holding) → implement → PASS → commit `feat(engine): stow verb — shelve held items in structures`.

### Task 7: Maker's mark — expert crafts

**Files:** Modify `packages/engine/src/verbs.ts` (craft), `packages/arbiter/src/codify.ts` (`verbFromRecipe` spawn effects), `packages/arbiter/src/verdict.ts` untouched here; tests in both packages.

**Interfaces — Produces:** output items carry `crafterMark = agentId` when the crafter's level on the recipe's skill track ≥ `config.crafting.expertLevel` at craft time. Arbiter recipes: same rule using `recipe.skillCheck.track`; recipes with `skillCheck.difficulty ≥ config.crafting.expertDifficulty` are "expert crafts" (constant exported `isExpertRecipe(recipe, config)`).

- [ ] Steps: failing tests (level-5 carpenter's plank carries mark; level-1 doesn't; codified-recipe output same; mark survives give/steal per Task 4 test extension) → implement → PASS → commit `feat(engine+arbiter): expert maker's mark on crafted items`.

### Task 8: Spoilage system

**Files:** Create `packages/engine/src/systems/spoilage.ts` + test; modify `state.ts` (`Item.spoilage?: {spawnDay, days}`), `events.def.ts`/`fold.ts` (`item_spoiled` removes item; `item_spawned` +`spoilage?`), `verbs.ts` (food-spawning verbs set `spoilage` via helper `spoilageFor(state, kind, config)`), `worldTick.ts` (register system), `perception.ts` (`spoiling: boolean` when ≤ 1 day left).

- [ ] Steps: failing tests (fish spoils at midnight after day 2; bread in storehouse lasts 12 days not 6 — multiplier from CURRENT location at check time; wheat survives 59 days; non-food never spoils; perception flags a turning fish) → implement → PASS (hash handled by Task 16 note) → commit `feat(engine): food spoilage with preserving structures`.

### Task 9: Tool wear on codified recipes

**Files:** Modify `packages/arbiter/src/verdict.ts` (`spawn_item` effect +`durability?: number().int().positive().max(200)`), `packages/arbiter/src/codify.ts` (`verbFromRecipe.onComplete` wears each `held_item` requirement stack by `config.tools.wearPerUse`), `packages/engine/src/{state,events.def,fold}.ts` (`Item.durability?`, `item_worn` decrements, `item_broke` removes; `item_spawned` +`durability?`); tests both packages.

- [ ] Steps: failing tests (arbiter-spawned rod carries durability; each codified-recipe use emits `item_worn`; durability 1 → use → `item_broke` and item gone; Tier-1 verbs never wear anything) → implement → PASS → commit `feat(arbiter+engine): tool durability and wear on codified recipes`.

### Task 10: Harsher seasons dials

**Files:** Modify `packages/engine/src/systems/needs.ts` (winter `hungerDecayMultiplier`), `verbs.ts` fish (`fishCatchMultiplier` in winter); tests.

- [ ] Steps: failing tests (winter hunger decay = base × 1.25 exactly, other seasons unchanged; winter fish chance halved — assert via seeded rng sequence) → implement → PASS → commit `feat(engine): winter scarcity dials`.

### Task 11: Reproduction I — sex, co-sleeping, partnership

**Files:** Create `packages/engine/src/systems/reproduction.ts` + test; modify `state.ts` (`AgentBody.sex: 'f'|'m'` with fold default `'f'` when payload omits; `WorldState.pairNights: Record<string, {nights: number; lastNightDay: number; formedTick: number | null; dissolvedTick: number | null}>` initialized `{}` in `genesisState`), `events.def.ts`/`fold.ts` (`agent_spawned` +`sex?`; `co_slept`), `worldTick.ts` (register before agingSystem), `scripted.ts` (scripted actors get explicit sexes).

**Interfaces — Produces:** `pairKey(a, b)` = sorted join `'|'` (exported). Midnight pass: for each private structure, each unordered pair asleep inside → `co_slept {aId, bId, day}`; fold updates `{nights, lastNightDay}` with the 7-day-gap reset (gap > `partnerWindowDays` → nights = 1). `isPartnered(state, a, b, config)` = nights ≥ `coSleepNightsToPartner`.

**Dissolution semantics (BINDING — AMENDMENT 2026-08-16 pm2, audit A1):** the pair row carries
partnership *transitions*, not only current state. Both new fields are **nullable and stamped only
on transition**, so a never-partnered pair keeps today's row shape and hashes identically.

```ts
export type PairRow = { nights: number; lastNightDay: number; formedTick: number | null; dissolvedTick: number | null }
export function partnershipOf(state: WorldState, a: string, b: string): PairRow | undefined
```
- `formedTick` stamps at the tick `nights` first reaches `config.reproduction.coSleepNightsToPartner`.
- `dissolvedTick` stamps at the midnight the `partnerWindowDays` gap resets `nights` to 1 while
  `formedTick !== null`.
- Re-partnering re-stamps `formedTick` and clears `dissolvedTick` back to `null`.
- `partnershipOf` is the exported read path so C11's tier-2 "first breakup" / "first affair"
  detector queries transitions without reaching into `pairNights`. Without these fields that
  detector has no data.

- [ ] Steps: failing tests (two asleep in one hut at midnight → `co_slept`; awake occupant excluded; storehouse (non-private) never counts; nights 1→2→3 across consecutive midnights → partnered; 8-day gap resets to 1; three occupants → three pairs, deterministic order; **`formedTick` stamps exactly at the threshold tick and not before; `dissolvedTick` stamps at the gap-reset midnight; a never-partnered pair keeps both fields `null`; re-partnering re-stamps `formedTick` and nulls `dissolvedTick`; `partnershipOf` returns the row and `undefined` for strangers**) → implement → PASS → commit `feat(engine): co-sleeping ledger and mechanical partnership inference`.

### Task 12: Reproduction II — conception, gestation, birth at 12

**Files:** Extend `packages/engine/src/systems/reproduction.ts` + test; create `packages/engine/src/data/names.ts` (~40 names/sex, era-neutral, authored); modify `state.ts` (`pregnant?: {sinceDay, byId}`, `parents?: [string, string]`), `events.def.ts`/`fold.ts` (`agent_conceived`, `agent_born`).

**Interfaces — Produces:** conception rule per addendum §3 (partnered + co-slept tonight + f/m + fertile window + not pregnant → `reproduction` stream roll < `conceptionChancePerNight`). Birth: `day - sinceDay ≥ gestationDays` (default 72 — user ruling 2026-08-16) → **registry** name+sex rolled from `reproduction` stream over `data/names.ts` (naming is hybrid per user ruling 2026-08-16: the engine's roll is the permanent registry name; the mother's social name for the child is mind-side, Task 25) → `agent_born {id: mintId(state,'agent'), name, sex, motherId, fatherId, x, y}`; fold builds AgentBody with `ageDays = SPAWN_AGE_YEARS * 365`, full needs, empty skills, `parents` set, mother's `pregnant` cleared. Mother inside a hut → child born inside (insideId set via a following `agent_entered`? NO — fold of `agent_born` places the child at mother's x/y with mother's `insideId` copied; one event, one body).

- [ ] Steps: failing tests (conception fires only for partnered co-slept fertile f/m pair — six negative cases; roll recorded deterministic under fixed seed; gestation counts days not ticks; born child: age 12 years, parents set, mother un-pregnant, same interior as mother; two pregnancies never stack) → implement → PASS → commit `feat(engine): seeded conception, gestation, birth at age twelve`.

### Task 13: Inscription verb

**Files:** Modify `packages/engine/src/verbs.ts` (`inscribe {structureId, text}` — adjacent or inside, complete structure, text 1..280, duration 3), `state.ts` (`Structure.inscription?: {text, by}`), `events.def.ts`/`fold.ts` (`structure_inscribed` sets/overwrites), `perception.ts` (`hasInscription` at sight; `inscription` text when adjacent/inside); tests.

- [ ] Steps: failing tests (inscribe hut from outside-adjacent and from inside; standing stone inscribable; overwrite keeps only latest in state while both events persist in the log; text visible adjacent, only flag at range 10) → implement → PASS → commit `feat(engine): inscription — persistent public text on structures`.

### Task 14: Mystery events

**Files:** Create `packages/engine/src/systems/mystery.ts`, `packages/engine/src/data/mysteries.ts` (~10 authored entries `{kind, scope: 'global'|'located', prose}` — prose passes FORBIDDEN_FRAMING), test; modify `events.def.ts`/`fold.ts` (`mystery_event` — fold no-op returning state unchanged... fold must return state: return `{...state}`? NO — return `state` identical; add to fold switch with payload parse only), `perception.ts` (global → feltEvents tag for awake agents; located → `seen` entry within sight), `worldTick.ts` (register).

- [ ] Steps: failing tests (daily roll via `mystery` stream at a fixed hour; hit → exactly one table entry chosen deterministically; global felt by awake only; located seen within radius only; fold leaves state hash unchanged) → implement → PASS → commit `feat(engine): seeded mystery events the world never explains`.

### Task 15: Elder aging polish

**Files:** Modify `packages/engine/src/systems/needs.ts` (elder `energyDecay × elderEnergyDecayMultiplier`), `perception.ts` (`PerceivedAgent.ageBand` via existing `ageBand()`), tests.

- [ ] Steps: failing tests (elder decays 1.2× exactly; adult unchanged; perceived agent carries `ageBand`) → implement → PASS → commit `feat(engine): elders tire faster and read as old`.

### Task 15b: World laws — `config_changed` event + runtime overrides (user ruling 2026-08-16)

**Files:** Create `packages/engine/src/laws.ts` + `laws.test.ts`; modify `state.ts` (`WorldState.laws: Record<string, unknown>` init `{}` in `genesisState` — covered by the state hash), `events.def.ts` + `fold.ts` (`config_changed {path, value}`; fold validates against the whitelist and sets `laws[path]`, throws on non-whitelisted path or type mismatch), `worldTick.ts` (tick wrapper derives `ctx.config = effectiveConfig(base, state.laws)` per tick, memoized on `laws` identity; drains the `applyLaw` queue at the tick boundary BEFORE systems run, emitting `config_changed`), `index.ts` exports.

**Interfaces — Produces:**
```ts
export const TOGGLABLE_PATHS: Record<string, z.ZodType>   // addendum §19 whitelist: 8 enable flags + reproduction/spoilage/mystery/winter dials
export function effectiveConfig(base: SimConfig, laws: Record<string, unknown>): SimConfig  // pure, memoized
export function applyLaw(queue: LawQueue, path: string, value: unknown): void               // enqueue; drained at tick boundary
```
- [ ] Steps: failing tests (flip lands as `config_changed` at the NEXT tick boundary, never mid-tick; fold rejects `movement.sightRadius` (not whitelisted) and a string for a boolean flag; `effectiveConfig` overrides exactly the flipped path; state hash differs after a flip — laws are hashed; snapshot round-trip preserves `laws`; replay of a log containing flips reproduces the identical hash) → implement → PASS → commit `feat(engine): world-law overrides via config_changed events (user ruling 2026-08-16)`.

### Task 15c: Gate every C9 feature behind its flag (user ruling 2026-08-16)

**Files:** Modify `packages/engine/src/systems/{spoilage,reproduction,mystery,aging,needs}.ts`, `perception.ts` (occlusion + ownership surfacing), `verbs.ts` (`inscribe` diegetic refusal `'your hands find no way to mark this'`; ownership emissions in give/take/spawners), `packages/arbiter/src/codify.ts` (wear behind `tools.wearEnabled`); tests per addendum §19 off-state table.

- [ ] Steps: failing tests — one row per addendum §19 off-state semantic (reproduction off → zero repro events while co-sleepers sleep on; death-of-age off → `agent_aged` continues, no old-age deaths; spoilage off/on re-enable spoils overdue at next midnight; wear off; mystery off; occlusion off → radius-8 through walls while interior sight remains; ownership off → no owner events, inert existing owners, prose stops surfacing; inscribe refused with the exact string) → implement (every check reads the per-tick effective config) → PASS → commit `feat(engine+arbiter): C9 features individually toggle-able at runtime`.

### Task 16: Golden regen — the single deliberate event

**Files:** Modify golden fixture(s) under `packages/engine/src` (whatever `replay`/golden suites pin), un-`todo` the hash rows parked by Tasks 4/8.

- [ ] **Step 0 (batch-1 debt — do this FIRST, before any hash is collected):** REMOVE the two C9
  feature pins batch 1 put in the G2 fixture's local `G2_CONFIG` const
  (`packages/engine/src/g2.test.ts`): **`ownership.enabled: false`** (Task 2 / audit A2) and
  **`structures.sleepIndoorsOnly: false`** (Task 2b). Both were added only to hold the golden byte-
  identical while the goldens were frozen; regen is the moment they come off. If they survive this
  task, G2 silently stops exercising C9's ownership and bed laws for the rest of the project.
  Removing them changes both the G2 hash and the run's behaviour (measured in batch 1: 13 sleeps /
  14 collapses ON vs 21 / 2 OFF) — that is expected and absorbed here. Re-read G2's documented
  narrative afterwards and confirm it still describes the run.
- [ ] **Step 1:** Run the full engine suite; collect the new stable hash across THREE consecutive runs (must be identical — flushes out any nondeterminism the new systems introduced).
- [ ] **Step 2:** Regenerate the fixture via the existing harness command; assert replay-from-genesis == replay-from-snapshot == live fold.
- [ ] **Step 3:** Full monorepo suite green; `pnpm typecheck` green.
- [ ] **Step 4:** ONE commit `test(engine): golden regen for C9 world physics (deliberate, single event)` — nothing else in the diff.

### Task 17: SPEECH_RULES + CAPABILITIES + word budgets

**Files:** Modify `packages/agents/src/prompt/rulesOfBeing.ts` (append `SPEECH_RULES` const; CAPABILITIES: add enter/exit/stow/inscribe lines, ownership sentence "some things are someone's — all can see whose", REPLACE the "no way yet to shelve" paragraph with stow guidance), `packages/agents/src/prompt/assemble.ts` (`IdentityCore.voiceCard.wordBudget?: {typical: number; burst: number}` rendered `You usually say about N words at a time; when truly moved, up to M.`), tests (`assemble.test.ts`, new `rulesOfBeing.test.ts`).

**SPEECH_RULES content (diegetic, frozen after this task):** distilled humanizer rules — vary length turn to turn; one word can answer; fragments are honest; unfinished sentences allowed; answer what was just said in its own words; most talk is plain — never a polished saying each time you speak; no trios of anything; grand words rarely.

- [ ] Steps: failing tests (system prompt contains SPEECH_RULES after CAPABILITIES; block passes FORBIDDEN_FRAMING; wordBudget renders when present, absent renders nothing — byte-stable otherwise; snapshot of block-1 bytes updated ONCE here and asserted frozen) → implement → PASS → commit `feat(agents): humanizer speech rules and per-persona word budgets`.

### Task 18: Refusal prose teaches a path

**Files:** Modify `packages/engine/src/verbs.ts` (experiment fallback + craft unknown-recipe strings per addendum §9), `packages/agents/src/runtime/agentRuntime.ts` (append `" — perhaps someone nearby knows the craft."` when a Verdict is `impossible/insufficient_skill` before `#writeActionMemory`), tests.

- [ ] Steps: failing tests (exact strings; suffix applied at prose time only — stored ruling unchanged, asserted via rulings row) → implement → PASS → commit `feat(engine+agents): refusals hint at a path`.

### Task 19: Arbiter seam adoption (C8 Task 12, pulled forward)

**Files:** Create `packages/agents/src/runtime/arbiterSeam.ts` + `arbiterSeam.test.ts`; modify `agentRuntime.ts` (optional `adjudicator?: Adjudicator` ctor dep; freeform branch routes to it when present, falls back to today's `experiment` submit when absent).

**Interfaces — Produces (verbatim from C8 draft Task 12 — C8's copy becomes verify-only, see Task 26):**
```ts
export type Adjudicator = (intent: string, ctx: AgentCtx) => Promise<Verdict>
export function buildAgentCtx(bridge: EngineBridge, agentId: string): AgentCtx
```
- [ ] Steps: port C8 draft Task 12's test verbatim (map-verdict executes Tier-1; impossible-verdict writes refusal memory) → FAIL → implement → PASS (`arbiterSeam.test.ts` + `agentRuntime.test.ts`) → commit `feat(agents): arbiter seam — freeform intents route to adjudicate`.

### Task 20: Arbiter wiring expansion — unknown-verb routing + live codification

**Files:** Modify `packages/agents/src/runtime/arbiterSeam.ts` + `agentRuntime.ts`; modify `packages/arbiter/src/prompt.ts` (canon line: "unexplained happenings in the world have no known mechanism and cannot be ruled upon"); tests in agents (mock adjudicator + `MockLanguageModelV4` pattern) and one arbiter round-trip test with a fake LLM.

**Interfaces — Produces:** (1) submit rejection reason `unknown verb: X` → runtime re-frames as freeform `"X <params flattened>"` → adjudicator (once per turn; a second failure falls back to refusal memory). (2) `attempt` verdict → `arbiter.codify(recipe)` → `bridge.submit({verb: recipe.id})`; export `wireArbiter(runtime, arbiter)` convenience used by G9b and later C8's supervisor.

- [ ] Steps: failing tests (unknown-verb → adjudicate called with flattened intent; attempt → codify called then recipe verb submitted; **call-count assertion**: same intent twice → adjudicate LLM path once (second resolves via rulebook stub); canon line present in assembled arbiter prompt) → implement → PASS → commit `feat(agents+arbiter): unknown-verb routing and live codification`.

### Task 21: BudgetGuard pessimistic reservation

**Files:** Modify `packages/agents/src/llm/callLog.ts` (add `llm_reservations` table + `reserve/release/sumReserved` in one exported transaction helper), `client.ts` (`invoke`: transactional check `booked + reserved + expected > budget → BudgetExceededError` else reserve; release in finally), config knob `expectedCallCostUsd` (client opt, default 0.005); test.

- [ ] Steps: failing tests (5 concurrent `object()` calls against a budget sized for 2 expected → ≤ 2 admitted, `BudgetExceededError` for the rest, `sumReserved` returns to 0 after settle; crash-safety: release happens on throw; single-call behavior unchanged) → implement → PASS → commit `fix(agents): budget guard pre-books expected cost — no concurrent overshoot`.

### Task 22: Reflection survives budget exhaustion

**Files:** Modify `packages/agents/src/reflection.ts` + test.

**Interfaces — Produces:** every LLM step of nightly reflection catches `BudgetExceededError` (and `NoObjectGeneratedError`) → mechanical fallback: day summary = truncated verbatim day-log digest stored as the day node, facts skipped, autobiography line `'A long day; too weary to make sense of it.'`, no personality edit, alert `reflection_fallback`. Reflection NEVER rejects for budget reasons.

- [ ] Steps: failing test (client stub throwing BudgetExceededError → reflection resolves, day node exists with verbatim content, alert row written, no facts/personality rows) → implement → PASS → commit `fix(agents): reflection degrades to mechanical summary on exhausted budget`.

### Task 23: Bridge drain

**Files:** Modify `packages/agents/src/runtime/bridge.ts` + test.

**Interfaces — Produces:** `drain(reason = 'the moment passes'): number` — resolves every queued submit `{ok: false, reason}`, clears the queue, returns count. Idempotent.

- [ ] Steps: failing test (submit with stopped loop → promise pends; `drain()` → resolves `{ok:false,...}`; count correct; second drain returns 0) → implement → PASS → commit `fix(agents): bridge.drain flushes queued intents at shutdown`.

### Task 24: Spend monitor

**Files:** Create `packages/agents/src/llm/spendMonitor.ts` + test; export from `packages/agents/src/index.ts`.

**Interfaces — Produces:**
```ts
export type SpendProjection = { usdPerSimDay: number; windowRealMinutes: number; sampledCalls: number }
export function projectDailySpend(db, opts?: { windowRealMinutes?: number; now?: number }): SpendProjection
export function checkSpend(db, opts?: { thresholdUsdPerSimDay?: number /* default 10 — user ruling 2026-08-16; configurable */ }): SpendProjection & { alerted: boolean }
```
`checkSpend` inserts an `alerts` row `kind:'spend_projection'` + console line when over threshold. Wall-clock↔sim mapping: 1 sim-day = 1 real hour, so window-spend × (60/window) = $/sim-day.

- [ ] Steps: failing tests (seeded `llm_calls` rows in/out of window → exact projection; threshold crossing inserts exactly one alert per check; under threshold none) → implement → PASS → commit `feat(agents): projected daily spend with operator alert`.

### Task 25: Child-mind pipeline

**Files:** Create `packages/agents/src/family/derivePersona.ts`, `family/memorySeed.ts`, `family/watchBirths.ts`, `family/socialName.ts` + tests; export from index.

**Interfaces — Produces:**
```ts
export function derivePersona(child: { id, name, sex }, parents: [ParentPersona, ParentPersona]):
  { identity: IdentityCore; personality: PersonalityDoc }   // deterministic blend seeded by child.id (addendum §3)
export function buildHouseholdSeed(store: EventStore, opts: { childId, motherId, fatherId, homeStructureId, upToTick, max?: number }):
  Array<{ text: string; importance: number; tags: string[] }>  // PUBLIC record only: world events at the home + parents' public acts, phrased second-hand
export function watchBirths(bridge: EngineBridge, store: EventStore, spawn: (born: AgentBornPayload) => void): () => void  // onTick scan; C8 supervisor + G9b harness consume

// socialName.ts — hybrid naming (user ruling 2026-08-16): the engine's registry name is permanent
// world state; the mother's next turn after the birth is prompted with it ("what do you call her?"
// line appended to her now-prose), and a structured mind-side naming call right after that turn
// records her chosen name in a `social_names` ops table {agentId, socialName, namedBy, tick}.
// Social name may diverge from the registry name; wiki/UI surfaces show both (C6/C8 delta, Task 26).
export function promptBirthLine(born: AgentBornPayload): string
export function captureSocialName(llm: LlmClient, db, ctx: { born, motherPersona }): Promise<string | null>  // null if mother dead/unresponsive — name stays unset
```
- [ ] Steps: failing tests (same child id → byte-identical persona twice; traits provably drawn from both parents; seed entries all trace to event ids and NEVER quote a parent `memories` row — construct a trap: plant a parent-private memory text, assert absent; watchBirths fires spawn exactly once per `agent_born`; birth line appears in the mother's next now-prose only; `captureSocialName` writes one `social_names` row and tolerates divergence from the registry name; dead mother → no row, no throw) → implement → PASS → commit `feat(agents): child minds — derived persona, public-record seed, birth watcher, hybrid social naming (user ruling 2026-08-16)`.

### Task 25b: Gateway — world-law admin channel + laws in the viewer protocol (user ruling 2026-08-16)

**Files:** Create `packages/gateway/src/adminLaws.ts` + test; modify the gateway snapshot/delta serializer (snapshot gains a `laws` block; `config_changed` events flow as deltas) and `@sj/shared` protocol schema.

**Interfaces — Produces:**
```ts
export function createLawsAdmin(opts: { submitLaw: (path: string, value: unknown) => void; token: string; host?: string /* default '127.0.0.1' */ }): http.Server
// POST /admin/laws {path, value} — 401 without `Authorization: Bearer <SJ_ADMIN_TOKEN>`, 400 on non-whitelisted path (validated against TOGGLABLE_PATHS before enqueue), 202 on accept (lands at next tick boundary)
```
Auth boundary per addendum §19 (decided, argued there): localhost bind by default AND bearer token on every request; public exposure is an explicit Caddy opt-in. `submitLaw` is injected — the gateway never imports the engine; C8's supervisor (or the G9b harness) connects it to `applyLaw`. The read-only viewer ws is untouched by the admin listener (separate port, separate server).

- [ ] Steps: failing tests (401/400/202 matrix; wrong host bind refused unless overridden; snapshot contains current `laws`; a `config_changed` delta reaches a connected mock viewer) → implement → PASS → commit `feat(gateway): world-law admin channel and laws in the viewer protocol (user ruling 2026-08-16)`.

### Task 25c: Web — operator Laws dashboard + viewer "World Laws" panel (user ruling 2026-08-16)

**Files:** Create `packages/web/src/admin/LawsDashboard.tsx`, `packages/web/src/panels/WorldLaws.tsx` + component tests (existing web test setup; no Playwright per C6 ruling).

**Interfaces — Produces:** `WorldLaws` (all viewers, read-only submenu): every toggle/dial with current value + change history derived from received `config_changed` deltas and the snapshot `laws` block. `LawsDashboard` (operator-only route, hidden unless an admin token is present in local session config): current value + edit control per flag; submit POSTs to the Task 25b endpoint; optimistic UI forbidden — the value updates only when the `config_changed` delta arrives (the event log is the truth, addendum §19).

- [ ] Steps: failing tests (WorldLaws renders values + history from a scripted delta sequence; dashboard renders an edit per whitelisted flag, disables on missing token, does NOT update value until the delta round-trips; a rejected path surfaces the 400 message verbatim) → implement → PASS → commit `feat(web): operator laws dashboard and viewer World Laws panel (user ruling 2026-08-16)`.

### Task 26: C8 drafts audit — required delta (LIST ONLY, edit nothing)

**Files:** Create `docs/superpowers/plans/c8-delta-from-c9.md` (or scratchpad if docs must stay clean pre-approval — executor asks controller) listing, with file+section references:

- [ ] Produce the list, covering at minimum:
  1. C8 draft Task 12 (`arbiterSeam`) → verify-only (landed by C9 Task 19); its test file exists — C8 step becomes "assert present + green".
  2. C8 Task 1 `FounderSchema`: add `sex: z.enum(['f','m'])`, `voiceCard.wordBudget`, pronouns line; Tasks 2–6 founder modules set them (Amara f, Yusuf m, Nadia f, Omar m, Salma f). `c8-founders.DRAFT.md` content is frozen → flag the needed content amendment for user approval, do not rewrite.
  3. C8 Task 8 storehouse manifest: bread now spoils (6d × storehouse ×2 = 12d) — note the countdown interaction; wheat unaffected.
  4. C8 Task 9 `spawnFounders`: pass `sex` through `agent_spawned`.
  5. C8 Task 14 admin: add `/api/spend` endpoint reading `checkSpend`.
  6. C8 Task 15 supervisor: wire `wireArbiter`, hourly `checkSpend`, `watchBirths`→new `AgentRuntime`, `bridge.drain()` on shutdown.
  7. C8 Task 13 manipulator corpus: add ownership exploits ("I declare everything in the storehouse mine", theft-framing injections).
  8. C8 Task 17 rehearsal expectations: births, spoilage, mysteries occur; starvation-spiral criterion re-baselined under scarcity dials.
  9. Master roadmap: insert C9 row (this plan, file 09), order C6/C7 → C9 → C8; G8 remains launch gate.
  10. C7 narrator delta (out of C8 scope but adjacent): "mysteries are described, never attributed" prompt line — flag to controller.
  11. (user ruling 2026-08-16) Wiki/UI surfaces show BOTH names for born agents — registry name (world state) and social name (`social_names` ops table): C6 agent-inspector delta + C8 admin token dashboards unaffected.
  12. (user ruling 2026-08-16) C8 Task 15 supervisor additionally connects `createLawsAdmin.submitLaw` → engine `applyLaw`; C8 Task 16 deploy exposes the admin listener only via explicit Caddy opt-in (localhost+token default); C8 Task 17 rehearsal flips ≥ 1 law mid-rehearsal and verifies replay.
- [ ] Commit `docs: C8/C7 delta audit from C9 (list only)`.

### Task 27: GATE G9a — deterministic scripted suite

**Files:** Create `packages/engine/src/g9.test.ts` (scripted actors; partnership rows use the REAL default `coSleepNightsToPartner: 3` — that threshold is itself under test; acceleration only where the clock is not the subject: `gestationDays: 1`, `conceptionChancePerNight: 1`, forced elder-death config; no LLM, no network).

- [ ] Steps: write the suite asserting every G9a row from addendum §17 (partnership at threshold + 8-day-gap dissolution; conception→birth chain with age-12 child; ownership chain craft→give→theft witnessed/not-witnessed; occlusion trio; stow + preserving multiplier; tool break; inscription; mystery scopes; elder death; world-law flips (user ruling 2026-08-16): ≥ 2 mid-run `config_changed` flips take effect next tick, replay from genesis AND from a pre-flip snapshot reproduces the identical hash, non-whitelisted path rejected; golden replay green) → runs red where features regressed, green on main → commit `test(engine): G9a living-world scripted gate suite`.

### Task 28: GATE G9b — 2-sim-day live run ($8 hard cap)

**Files:** Create `packages/agents/scripts/g9-livingworld.ts` (probe-pattern harness: 5 minds from existing test personas + word budgets, real DeepSeek, `wireArbiter` live, `checkSpend` hourly with a forced-low threshold once, `createLawsAdmin` wired to `applyLaw`, `bridge.drain` at end). Staged birth (user ruling 2026-08-16): gestation stays at the default 72 sim-days, which cannot complete inside the 2-sim-day window — genesis therefore seeds a pre-partnered couple with `pregnant.sinceDay` **backdated** so the term completes on day 1 (deterministic initial-conditions fixture, no config cheat). Also `packages/agents/src/live/g9report.ts` (+ `G9ReportSchema`) and `g9.livetest.ts` mirroring the `g3.livetest.ts` pattern.

- [ ] **Step 1:** Failing livetest: load `data/g9-report.json`, schema-parse, assert every G9b criterion from addendum §17 (2 sim-days, 0 crashes, drain count reconciles, child mind ≥ 5 turns + persona names parents + seed all-public, mother's social name captured and logged beside the registry name (user ruling 2026-08-16), ≥1 live codification + 0-arbiter-call repeat, the novel-intent route firing live (§17.4 restated, user-approved 2026-08-17: a live codification OR an unknown-verb/unknown-recipe routing that reaches the arbiter, with no proposal dying as refusal prose), spend ≤ cap + one expected-call, 0 lost reflections, hourly projections + forced alert at the $10/sim-day default's forced-low stand-in, word-budget medians ordered, ownership phrase in prose, ≥ 1 mid-run law flip via the admin channel visible in the World Laws history + post-run replay hash identical (user ruling 2026-08-16)).
- [ ] **Step 2:** Run the script (single execution, hard `$8` cap, `process.exit(1)` over cap) → emits report JSON + transcript to scratchpad ledger.
- [ ] **Step 3:** `pnpm vitest run packages/agents/src/live/g9.livetest.ts` — PASS. Any red row → STOP, report to controller (gate failures go to the human, per roadmap).
- [ ] **Step 4:** Commit `test(agents): GATE G9 live run — living world green` and hand the report + transcript to the controller for gate sign-off.

---

## Self-Review

- Every user ruling from the brief maps to a task: interiors/occlusion (2,3), ownership+marks+theft+inheritance-edge (4,5,6,7), reproduction/birth-at-12/child-mind + hybrid naming (11,12,25), unbounded population + $10/sim-day spend alert (24; population has no cap anywhere), scarcity (8,9,10), writing-as-core-verb argued in addendum §6 + built (13), mystery (14), aging/death-of-age (15 + already-landed C2 physics), refusal hints (18), humanizer + budgets (17), arbiter expansion (19,20), three probe bugs (21,22,23), world-law toggles + dashboard + viewer panel (15b,15c,25b,25c — user ruling 2026-08-16), C8 audit (26), gates (27,28); roads + the bed law (1b, 2b — added by the 2026-08-16 plan repair,
  audit A0). **Task count: 34.**
- Determinism: new streams `reproduction`/`mystery` only; spoilage/partnership/doors/occlusion roll-free; law flips only as hashed `config_changed` events at tick boundaries (Task 15b), replay-asserted at both gates; golden regen isolated to Task 16 with the Task 4/8 hash parking explicitly called out (the one messy spot — flagged in both tasks rather than hidden).
- No placeholders: every task names exact files, interfaces, refusal strings, defaults; content tables (names, mysteries) are authored in-task.
- Scope check: no supervisor package, no narrator code, no newcomer arrivals, no persona content rewrites — those stay C8/C7 (Task 26 lists the deltas instead). Gateway/web changes are limited to the two law surfaces the 2026-08-16 user ruling commissioned; the viewer channel stays read-only by construction (admin listener is a separate localhost+token server).
- User rulings 2026-08-16 applied throughout: $10/sim-day spend threshold, 72-sim-day gestation (G9b births via a backdated-pregnancy fixture, not a config cheat), hybrid registry/social naming, runtime feature toggles.
- Known tensions left for the controller: (a) Tasks 4/8 golden-hash parking violates the letter of "keep golden green per task" — accepted as the price of a single deliberate regen; (b) SPEECH_RULES changes the block-1 cache prefix once; (c) 72-day gestation means no organically-conceived birth can appear inside any 2-sim-day window — long-run rehearsal (C8) is where organic births will first be observed.

---

## AMENDMENT (2026-08-16 pm2, controller — from the C11 milestone framework)

**T11/T12 interface requirement (binding):** relationship rows MUST expose partnership
DISSOLUTION semantics — `formedTick` and `dissolvedTick` (null while active) on the
partnership row, with dissolution derived from the same co-sleep signal going quiet and/or
hostile-interaction pattern between partners. C11's tier-2 milestone detector ("first
breakup", "first affair") consumes these fields; without them it has no data. Add to the
pre-execution plan-audit checklist for Tasks 11/12.

---

## AMENDMENT (2026-08-16 — Task 28 code assignment)

**Task 28 (G9b) — two pieces of gate-required code the task list never assigned.** Both shipped
during G9b execution; recorded here so the plan owns them:

- **D-28-1 → commit `0daa146`** `feat(agents): minds perceive ownership and witnessed takings`.
  `packages/agents/src/runtime/bridge.ts` + `src/prompt/prose.ts`: the mind-facing packet gains
  `ownerName`/`crafterMarkName` on items and a `seen` channel, and the prose renders both.
  §17.7 ("an ownership phrase in the prose a mind actually read") is unmeetable without it —
  the engine had surfaced the fields since Tasks 4–5, but nothing outside the engine read them.
- **D-28-2 → commit `92987dd`** `feat(agents): a named experiment reaches the arbiter like freeform`.
  `packages/agents/src/runtime/agentRuntime.ts`: `experiment {description}` is the same door as
  freeform when an adjudicator is wired. CAPABILITIES offers both; only freeform reached the
  arbiter, so a mind that followed CAPABILITIES literally had its attempt written off as refusal
  prose — which §17.3/§17.4 count against.

---

## AMENDMENT (2026-08-17 — GATE G9 closed on user ruling)

**§17.3 is CLOSED BY USER RULING, not by a live pass, and G9 closes with it.** Five G9b runs
adjudicated novel intents and none codified. Run 5 isolated the last cause: the adjacency frontier
reached the arbiter and five `attempt` verdicts came back, and every one was destroyed by the
deterministic `withinAdjacency` gate because nothing bound `recipe.canon` to the ids the context
had listed. The user ruled, verbatim:

> "Add it, but no need for a run. The run will naturally happen in the next stages of testing."

The fix is commit `c8d267b` — one instruction line in the byte-stable adjudication prefix binding
`canon` to the two id lines already in the context — covered by prompt-assembly assertions and the
Esen adjudicator fixture. **No sixth G9b run was made and no live call was spent on this batch.**
Live verification of §17.3 transfers to the C8 dress rehearsal, whose criteria must now include a
codification check (`c8-delta-from-c9.md` §8 amendment). Task 28 stands complete at 8/8 with
§17.3 closed on the ruling and §17.4 as restated.

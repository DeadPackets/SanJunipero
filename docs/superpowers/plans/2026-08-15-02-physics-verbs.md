# C2 — Physics & Tier-1 Verbs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The deterministic world: terrain, movement, needs, health, aging, skills, weather, crops, wildlife, fire, structures, all Tier-1 verbs, perception, and the `submitIntent` API — gated by a 3-sim-day scripted headless run (G2).

**Architecture:** Everything extends C1's event-sourced kernel. A `createWorldTick(config, rng)` factory returns the `TickHandler`; per tick it runs the system pipeline (weather → fire → crops/wildlife → needs → health → aging → action progression → collapse/death), each system reading state, drawing from named RNG streams, and emitting `.strict()`-validated events that `fold` applies. Agent intents enter via `submitIntent` and become tick-progressed actions. Perception is a pure function over state + recent events.

**Tech Stack:** Same as C1 (Node 24, TS ESM, Vitest, better-sqlite3, Zod 4). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-15-san-junipero-design.md` §3 (world engine), §4 (Tier-1/Tier-2 split — this chunk ships Tier-1 + an `experiment` stub that returns "not yet possible" until C4). Roadmap: `2026-08-15-00-master-roadmap.md` (C2 block + C1 carry-forward section — its 3 hardening items are Tasks 2 here).

## Global Constraints

- Determinism law unchanged: randomness ONLY at event-creation via named streams (`weather`, `fire`, `crops`, `wildlife`, `health`, `combat`, `aging`, `ids` is NOT a stream — ids come from `state.counters`); `fold` stays pure and RNG-free; unknown event types throw.
- ALL new event payload schemas use `.strict()`. The 4 C1 event schemas are migrated to `.strict()` in Task 3.
- Every tunable number lives in `SimConfig` (Task 1) — a hardcoded constant in a system module is a review defect. Tests inject fast configs; never run >200 ticks in a unit test (the G2 gate test is the only long run).
- Entity IDs are minted deterministically from `state.counters.nextEntityId` (read by decision layer, written into the event payload, incremented by fold on entity-creating events).
- WorldState stays plain-JSON (arrays/objects/numbers/strings/bool/null) — Task 2's stableStringify guard enforces this loudly.
- The pinned golden hash WILL change when WorldState's shape changes (Task 3) and again at the gate (Task 14). Regenerating it is a deliberate act: each regeneration gets its own commit whose message says why.
- Worktree gotcha: EnterWorktree branches from stale origin/main — first action after creating the worktree is `git merge main --ff`.
- TDD per task: failing test first (RED evidence), implement, GREEN, full suite + `pnpm typecheck`, commit per task.

## Interfaces produced (C3+ consume — binding)

```ts
// @sj/shared
SimConfig, DEFAULT_CONFIG, SimConfigSchema (zod, .strict(), full-default parse of {})
// @sj/engine
createWorldTick(config: SimConfig, rng: RngStreams):
  (state: WorldState) => WorldTickResult            // WorldTickResult = { state: WorldState; events: PendingEvent[] }
submitIntent(state: WorldState, config: SimConfig, agentId: string, verb: string,
  params: Record<string, unknown>): IntentResult    // pure validate+start
//   type IntentResult = { ok: true; events: PendingEvent[] } | { ok: false; reason: string }
composePerception(state: WorldState, config: SimConfig, agentId: string,
  recentEvents: SimEvent[]): PerceptionPacket                            // pure
VERBS: Record<VerbKind, VerbDef>
// VerbDef (actual, ratified by final review 2026-08-15): { kind; validate; duration;
//   onStart?; onComplete; results?; interruptible; skill?; rngStream? } — onStart/results
//   are optional engine extensions beyond Task 5's text; rngStream was ledger-ratified at T10.
// (TickHandler is a separate type: TickLoop's onTick ctx callback — not this chunk's produce.)
type PendingEvent = { type: string; payload: unknown }                   // engine appends via tick loop
```

---

### Task 1: SimConfig

**Files:** Create `packages/shared/src/config.ts` (+ re-export from index). Test `packages/shared/src/config.test.ts`.

**Interfaces produced:** `SimConfigSchema` (zod `.strict()`, every field `.default()`ed so `SimConfigSchema.parse({})` === `DEFAULT_CONFIG`), `type SimConfig = z.infer<...>`, `DEFAULT_CONFIG`.

Exact default values (binding — these are the dress-rehearsal starting points):

```ts
needs: {
  hungerDecayPerTick: 0.035,        // 100→0 in ~2 sim-days
  energyDecayAwakePerTick: 0.093,   // ~18 waking hours
  energyRegenAsleepPerTick: 0.25,   // ~7h sleep to full
  socialDecayPerTick: 0.018,        // ~4 days
  socialRegenConversingPerTick: 0.5,
  warmthEqualizeFactorPerTick: 0.05,
  debuffThreshold: 30, collapseThreshold: 5,
  deathAfterZeroHungerTicks: 1440,
  eatRestoreHunger: 60,
}
movement: { baseTicksPerTile: 1, debuffTicksPerTile: 2, sightRadius: 12, earshotRadius: 8 }
health: {
  maxHp: 100,
  injuryDamage: { minor: 10, serious: 30, grave: 60 },
  infectionChancePerInjuryPerDay: 0.2,
  contagionRadius: 4, contagionChancePerTick: 0.001,
  recoveryHpPerDay: 5, tendedRecoveryHpPerDay: 15,
  collapseHp: 15, deathHp: 0,
}
aging: { childUntilYears: 16, elderFromYears: 60,
         naturalDeathBaseChancePerDay: 0.0005, naturalDeathChancePerYearOver: 0.0002 }
skills: { tracks: ['farming','carpentry','cooking','medicine','fishing','foraging',
                   'brewing','masonry','tailoring','smithing','scholarship','art'],
          xpLevelDivisor: 100, maxLevel: 10 }   // level = min(maxLevel, floor(sqrt(xp/divisor)))
weather: { hourlyChangeChance: 0.15,
  kinds: ['sunny','cloudy','rain','storm','snow'],
  // per-season allowed kinds + base temperature °C:
  seasonTemps: { spring: 14, summer: 26, autumn: 10, winter: -4 },
  nightTempDelta: -6, rainTempDelta: -4, snowOnlyIn: 'winter',
  stormLightningFireChance: 0.02 }
crops: { wheat: { growthDays: 8, stages: 4, seasons: ['spring','summer'], yield: 3 } }
wildlife: { fishMax: 100, fishRegenPerDay: 5, fishCatchBase: 0.4,
            deerMax: 20, deerRegenPerDay: 1, forageYieldBySeason: { spring: 2, summer: 3, autumn: 2, winter: 0 } }
fire: { spreadChancePerTickAdjacent: 0.02, burnTicksToDestroy: 120, rainSpreadMultiplier: 0.2 }
construction: { hutTicks: 2880, hutMaterials: { wood: 10 } }   // 2 sim-days of work
```

**Steps:** (1) failing test: `parse({})` equals DEFAULT_CONFIG; `.strict()` rejects unknown keys; an override (`needs.hungerDecayPerTick: 1`) survives parse. (2) RED. (3) implement. (4) GREEN + suite + typecheck. (5) commit `feat(shared): sim-config schema with full defaults`.

---

### Task 2: C1 carry-forward hardening

**Files:** Modify `packages/shared/src/hash.ts`, `packages/engine/src/tickLoop.ts`, `packages/engine/src/replay.ts`. Tests in each module's test file.

Three fixes, each test-first:
1. `stableStringify` throws `TypeError` naming the offending constructor on Map/Set/Date/TypedArray/functions (anything non-plain: `Object.getPrototypeOf(v)` not `Object.prototype`/`Array.prototype`/`null`). Test: `expect(() => stableStringify({a: new Map()})).toThrow(/Map/)`; plain nested objects still fine; existing hash tests untouched.
2. `TickLoop.step()`: on txn throw, restore `#tick` and `#state` to pre-step values, then rethrow. Test: handler that throws on tick 3 → catch → `loop.tick === 2`, `loop.state` hash equals pre-step, store lastSeq unchanged; next `step()` works.
3. `replayLatest`: when both a checkpoint and events exist, assert `ckpt.tick === state.tick` after folding, else throw `Error(/rng checkpoint .* behind/)`. Test: manufacture divergence by appending an event via `store.append` after the last checkpoint → expect throw. (Legacy path: snapshot-rng fallback without checkpoint stays permitted, unchanged tests prove it.)

Commit `fix(engine): C1 carry-forward hardening (hash guard, txn coherence, ckpt assertion)`.

---

### Task 3: WorldState v2, terrain, strict event vocabulary base

**Files:** Rewrite `packages/engine/src/state.ts` (split: `state.ts` types + genesis, `fold.ts` reducer, `events.def.ts` payload schemas). Modify golden test (hash regen). Tests: `state.test.ts`, `fold.test.ts`.

**Interfaces produced (binding for all later tasks):**

```ts
type TileId = 0|1|2|3|4|5|6  // grass, dirt, water, forest, rock, sand, farmland
type AgentBody = {
  id: string; name: string; x: number; y: number; alive: boolean; asleep: boolean
  needs: { hunger: number; energy: number; warmth: number; social: number }
  hp: number; injuries: Array<{ kind: 'minor'|'serious'|'grave'; day: number }>
  ill: boolean; ageDays: number
  skills: Record<string, number>          // track → xp
  activity: null | { verb: string; ticksRemaining: number; params: Record<string, unknown>; path?: Array<[number,number]> }
  collapsedSinceTick: number | null
  zeroHungerSinceTick: number | null
}
type Structure = { id: string; kind: string; x: number; y: number; w: number; h: number;
  hp: number; maxHp: number; flammable: boolean; stage: 'construction'|'complete';
  progressTicks: number; builtBy: string | null; burning: boolean; burnTicks: number }
type Item = { id: string; kind: string; qty: number;
  loc: { t: 'tile'; x: number; y: number } | { t: 'agent'; id: string } | { t: 'structure'; id: string } }
type Crop = { id: string; kind: string; x: number; y: number; plantedDay: number; stage: number; withered: boolean }
type WorldState = {
  tick: number
  terrain: TileId[][]                      // [y][x]
  weather: { kind: string; temperatureC: number }
  agents: Record<string, AgentBody>
  structures: Record<string, Structure>
  items: Record<string, Item>
  crops: Record<string, Crop>
  wildlife: { fish: number; deer: number }
  counters: { nextEntityId: number }
}
genesisState(config: SimConfig, terrain?: TileId[][]): WorldState  // default: 32×32 all-grass (tests); wildlife at config max
mintId(state: WorldState, prefix: string): string                  // `${prefix}_${counters.nextEntityId}` — read-only helper
```

Event vocabulary base (this task implements fold branches + `.strict()` schemas; later tasks add their own the same way — the full list per task is in that task): migrate C1's `tick_advanced`, `agent_spawned` (payload gains `name`, spawn defaults: needs all 100, hp 100, ageDays from payload), `agent_moved`, `need_changed` (need enum grows to 4) to `.strict()`; add `entity_counter_advanced`-free design: every entity-creating event carries its `id` and fold bumps `counters.nextEntityId` to `max(current, numericPart+1)`.

Core tests (verbatim-required): genesis shape + defaults; fold purity re-verified against the new nested shape (deep no-mutation test using stateHash before/after — closes C1's deferred gap); `.strict()` rejection of an extra payload key; counter bump on spawn.

**Golden hash regen #1:** the C1 golden test's synthetic day still runs (spawn/move/need events exist); regenerate `GOLDEN_DAY_HASH`, commit message must state: "regen golden hash: WorldState v2 shape".

Commit `feat(engine): world state v2, terrain, strict event base`.

---

### Task 4: Items & structures fold branches

**Files:** Extend `events.def.ts`, `fold.ts`. Test `fold.items.test.ts`.

Events (all `.strict()`): `item_spawned {id, kind, qty, loc}`, `item_moved {id, loc}`, `item_qty_changed {id, delta}` (fold removes item at qty ≤ 0), `structure_planned {id, kind, x, y, w, h, maxHp, flammable, builderId}` (stage 'construction', hp 1), `structure_progressed {id, ticks}` , `structure_completed {id}` (hp → maxHp), `structure_damaged {id, amount}` (destroy at 0 → removed, drops nothing v1), `structure_destroyed {id}`.

Tests: item lifecycle to auto-removal at 0; structure plan→progress→complete; damage to destruction removes it; overlapping-footprint plan rejected by fold (throw — placement validation is fold-level law, not just intent-level).

Commit `feat(engine): items and structures`.

---

### Task 5: Action framework + submitIntent + walk (A*)

**Files:** Create `packages/engine/src/verbs.ts` (registry + types), `packages/engine/src/intent.ts` (`submitIntent`), `packages/engine/src/path.ts` (A*). Events: `action_started {agentId, verb, params, duration}`, `action_progressed {agentId, ticks}`, `action_completed {agentId, verb, results?}`, `action_interrupted {agentId, reason}`. Tests: `path.test.ts`, `intent.test.ts`.

**VerbDef (binding):**
```ts
type VerbDef = {
  kind: VerbKind
  validate(state, config, agentId, params): string | null          // null = ok, string = in-world reason
  duration(state, config, agentId, params): number                 // ticks
  onComplete(state, config, agentId, params, rng): PendingEvent[]  // outcome events (draws rng HERE)
  interruptible: boolean
  skill?: { track: string; xp: number }
}
```
`submitIntent` is pure: validate → return `action_started` (+ `agent_woke` if asleep and verb ≠ sleep). The tick pipeline (Task 8's integration) decrements `activity.ticksRemaining`, emits `action_completed` + `onComplete` events at 0, and `skill_gained {agentId, track, xp}` if the verb has skill.

A*: 4-directional, terrain costs `{grass:1, dirt:1, sand:1.2, farmland:1, forest:2, rock:3, water: impassable}`, structures' footprints impassable, Manhattan heuristic, deterministic tie-break (prefer lower y then lower x — NO randomness). `walk` verb: params `{x, y}`; path computed at validate; duration = pathLen × ticksPerTile (debuffed if any need < debuffThreshold); movement emits `agent_moved` per tile via per-tick progression, re-pathing NOT needed v1 (static obstacles mid-walk → `action_interrupted {reason:'blocked'}`).

Tests (concrete): A* around a wall yields the known 12-step path on a fixture map; water never entered; deterministic tie-break asserted (two equal paths → always same one); submitIntent on dead/collapsed agent → `{ok:false}`; walk completes in exactly pathLen ticks at full health and 2× when hunger=20; blocked mid-walk interrupts.

Commit `feat(engine): action framework, submitIntent, A* walk`.

---

### Task 6: World tick pipeline + needs + sleep/eat + collapse/death

**Files:** Create `packages/engine/src/worldTick.ts` (`createWorldTick` — the pipeline shell with system order: weather → fire → crops → wildlife → needs → health → aging → actions → collapse/death; systems land across Tasks 6–13, absent systems are no-ops), `packages/engine/src/systems/needs.ts`. Verbs: `sleep` (open-ended until `agent_woke`; energy regen while asleep), `wake`, `eat {itemId}` (validates food item held; `eatRestoreHunger`; consumes qty 1). Events: `agent_slept`, `agent_woke`, `agent_collapsed {agentId}`, `agent_died {agentId, cause}`.

Rules (exact): decay per Task 1 constants; warmth moves `warmthEqualizeFactorPerTick` of the gap toward `clamp01(50 + 2×(temperatureC − 10))×100/100`-scaled comfort target (i.e. target = clamp(0,100, 50 + 2×(tempC − 10))); collapse when hunger OR energy < collapseThreshold OR hp < collapseHp → activity interrupted, `collapsedSinceTick` set, agent immobile until a need rises above threshold (another agent's `give`+`eat`-adjacent flow or tend); death when `zeroHungerSinceTick` exceeds `deathAfterZeroHungerTicks`, or hp ≤ deathHp. Dead agents: `alive=false`, all further intents rejected, body remains (an item is NOT created v1).

Tests use fast config (e.g. hungerDecay 5/tick): decay applies only to living+awake (energy) agents; sleep regens energy and suppresses energy decay; eat restores and consumes; collapse interrupts a walk; death only after sustained zero hunger — the exact tick is asserted; dead agents ignored by decay.

Commit `feat(engine): world tick pipeline, needs, sleep/eat, collapse and death`.

---

### Task 7: Health — injury, infection, contagion, recovery, tend

**Files:** `packages/engine/src/systems/health.ts`; verb `tend {targetId}` (medicine skill, adjacency required). Events: `agent_injured {agentId, kind}`, `agent_infected {agentId}`, `agent_fell_ill {agentId}`, `agent_recovered {agentId}`, `hp_changed {agentId, delta}`.

Rules: injuries subtract `injuryDamage[kind]` hp once; each injury rolls infection daily (stream `health`) until healed-day (day+3); infection → `ill`; ill agents roll contagion per tick against others within `contagionRadius`; recovery: +recoveryHpPerDay (tended: tendedRecoveryHpPerDay, tend lasts that day), ill clears when hp back to max. Daily rolls happen at the dawn tick (hour 6, minute 0) — one roll point per day keeps runs short and deterministic to assert.

Tests (fast config, forced rolls via seeded streams — pick seeds by trial in-test and assert exact outcomes): injury damage exact; infection occurs on the known seed and not on another; contagion only within radius; tended recovery beats natural; hp floor triggers collapse (Task 6 integration).

Commit `feat(engine): health system and tend`.

---

### Task 8: Aging

**Files:** `packages/engine/src/systems/aging.ts`. Events: `agent_aged {agentId}` (daily at midnight, ageDays+1), `agent_died {cause:'old_age'}` via `aging` stream roll for elders per Task 1 formula.

Tests: ageDays increments exactly at midnight tick; elder death chance = base + perYearOver×(years−60) asserted by seed; child/adult/elder banding helper `ageBand(config, ageDays)` exported (C5's rigs + C3's prompts need it).

Commit `feat(engine): aging and natural death`.

---

### Task 9: Weather & seasons

**Files:** `packages/engine/src/systems/weather.ts`. Event: `weather_changed {kind, temperatureC}` — hourly roll (stream `weather`), kind from per-season allowed set (snow only winter; storm allowed all seasons), temperature = seasonTemp + nightDelta(if night) + rainDelta(if rain/storm/snow).

Tests: only-legal kinds per season across a seeded year of rolls (fast: roll function called directly per hour, not a full sim); temperature formula exact; `weather_changed` emitted only on actual change.

Commit `feat(engine): weather and seasons`.

---

### Task 10: Crops & wildlife + plant/harvest/fish/forage

**Files:** `packages/engine/src/systems/{crops,wildlife}.ts`; verbs `plant {x,y,kind}` (farmland tile required — and a `till {x,y}` verb converting grass/dirt→farmland, carpentry? no: farming skill), `harvest {cropId}` (stage = max → yield items, farming xp), `fish {x,y}` (adjacent water; catch chance `fishCatchBase`×(1+level/10), stream `wildlife`; decrements fish stock), `forage` (yield per season, forest tile adjacency). Events: `crop_planted`, `crop_grew {cropId, stage}` (daily at dawn if in-season), `crop_withered` (out-of-season or winter), `crop_harvested {cropId}`, `wildlife_changed {fish?, deer?}`, `terrain_changed {x, y, tile}`.

Tests: wheat matures in exactly `growthDays` sim-days of in-season dawns (fast config: growthDays 2); withers on season end; harvest yields exactly `yield` wheat items + xp; fishing seed-asserted catch and miss, stock floor at 0 (no catch when empty); forage winter yield 0; till converts tile.

Commit `feat(engine): crops, wildlife, and gathering verbs`.

---

### Task 11: Fire + build/craft

**Files:** `packages/engine/src/systems/fire.ts`; verbs `build {kind:'hut', x, y}` (materials check → `structure_planned`, then per-tick progression adds `structure_progressed` while agent works; carpentry xp), `craft` (v1 recipes: `{plank: {wood:1 → plank:2}}`, smithing/carpentry), `extinguish {structureId}` (adjacent, douses `burning`). Events: `fire_ignited {structureId, cause}` (lightning during storms via `stormLightningFireChance` per storm-hour per flammable structure, stream `fire`), `fire_spread {fromId, toId}` (adjacent flammable structures, per-tick chance × rain multiplier), `fire_extinguished {structureId, cause: 'doused'|'rain'|'burnout'}`, damage via `structure_damaged` per burn tick (maxHp/burnTicksToDestroy per tick).

Tests (fixture: 3 huts in a row, fast fire config): ignition on storm seed; spreads only to adjacent flammable; rain multiplier slows spread (statistical over seeded runs is FORBIDDEN — assert exact seeded outcomes at both multipliers); structure destroyed after exactly burnTicksToDestroy; extinguish stops damage; build consumes materials and completes after hutTicks of work, interrupt preserves progress.

Commit `feat(engine): fire, construction, crafting`.

---

### Task 12: Social & remaining verbs

**Files:** verbs `speak {text}` (instant; event `agent_spoke {agentId, text, x, y}` — earshot resolution is perception-side), `give {itemId, targetId}` (adjacent, item ownership validated), `take {itemId}` (tile/structure adjacency), `write {itemId?, text}` (creates/updates a `note` item with `text` in item payload — Item gains optional `text: string`), `read {itemId}` (instant; surfaces text via action_completed results), `teach {targetId, track}` (both idle+adjacent; grants `min(teacherXp×0.1, 50)` xp to target, scholarship xp to teacher), `attack {targetId}` (adjacent; opposed roll on `combat` stream weighted by health+energy; loser takes injury kind by margin: <0.2 minor, <0.5 serious, else grave; NEVER instant death — injuries+hp do that), `experiment {description}` (stub: always `{ok:false, reason:'You lack the knowledge to attempt this.'}` — C4 replaces).

Tests: give moves item ownership, non-adjacent rejected; speak event carries position; write→read round-trips text; teach xp math exact; attack seeded outcomes both directions, injury tier by margin, social decay regen during adjacency conversation (two agents within earshot both speaking within 10 ticks → both regen social — implement as: social regen tick applies when another living agent is within earshot and either spoke in last 60 ticks).

Commit `feat(engine): social, exchange, combat, and stub experiment verbs`.

---

### Task 13: Perception composer

**Files:** `packages/engine/src/perception.ts`. Pure function per the binding interface. Packet (binding for C3's prompts):

```ts
type PerceptionPacket = {
  time: SimTime
  self: { body: 'summary of needs/hp/injuries as structured numbers'; x; y; activity; inventory: Item[] }
  weather: { kind, temperatureC }
  visible: { agents: Array<{id,name,x,y,activityVerb|null,collapsed,asleep}>,
             structures: ..., items: ..., crops: ... }   // within sightRadius, no occlusion v1
  heard: Array<{ speakerId, name, text, distance }>       // agent_spoke within earshotRadius, from recentEvents
  feltEvents: string[]                                    // structured tags: 'rain_started','you_were_attacked',...
}
```

Information-asymmetry tests (these ARE the spec): agent at distance sightRadius+1 invisible, at sightRadius visible; speech at earshot+1 unheard; an event that happened out of range appears nowhere in the packet; two agents' packets from the same state differ correctly (A sees B's speech, C doesn't).

Commit `feat(engine): perception composer`.

---

### Task 14: GATE G2 — 3-sim-day scripted headless run

**Files:** `packages/engine/src/g2.test.ts` + `packages/engine/src/scripted.ts` (tiny deterministic policy actors: Farmer (till/plant/harvest/eat/sleep), Fisher (fish/eat/sleep/give surplus), Idler (wander/sleep — will starve unless given food), Builder (build hut then sleep-only)). Policies are pure functions `(perception) → Intent | null` — NO LLM, NO Math.random.

The gate test (uses DEFAULT_CONFIG, real constants, `step()` in a loop — ~4320 ticks, one test file allowed to be slow, tagged `@slow` but runs in CI):
1. Run 3 sim days on a 64×64 fixture map (river strip, forest edge, grass) with the 4 actors + starter items (wood ×12, wheat ×6 in a storehouse structure).
2. Assertions: Farmer + Fisher alive at end with hunger > 0 history never touching death; Idler collapses (no food access after starter share) and dies ONLY after `deathAfterZeroHungerTicks` past zero — exact tick asserted; Builder's hut completes; a scripted `fire_ignited` injected on day 2 spreads to an adjacent shed and burns out or is extinguished by scripted rain — structure count asserted; wheat planted day 1 reaches stage ≥ 2 (growthDays 8 means no maturity in 3 days — asserted NOT mature: season math is real).
3. Determinism: run the whole thing twice from the same seed → identical final `stateHash`; `replayFromGenesis` equals live; **new pinned constant `GOLDEN_G2_HASH`** (regen #2, its own commit line in the message).
4. Crash test: kill at tick 2000, recover, continue to 4320, hash equals uninterrupted run.
5. C1 golden suite still green untouched (except the Task 3 regen).

Gate evidence in the report: full suite output, the two pinned hashes, wall-clock of the G2 test.

Commit `test(engine): GATE G2 — 3-day scripted world run` + tag `gate-g2`.

---

## Self-review notes (done at authoring)

- Every constant referenced in Tasks 5–14 exists in Task 1's config block.
- Event names are unique across tasks; every event named in a later task has its fold branch in the task that introduces it.
- No task depends on a later task's interface; `worldTick` pipeline slots are no-ops until their system task lands.
- The only tests allowed to exceed 200 ticks are Task 14's gate.

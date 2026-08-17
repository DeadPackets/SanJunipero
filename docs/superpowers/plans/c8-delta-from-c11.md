# C8 / C12 delta audit from C11 — LIST ONLY, nothing here is implemented

Produced by C11 Task 40. This document edits no C8 file, rewrites no frozen content and
implements nothing: it is the edit list C8's plan author reads before writing a task, exactly
as `c8-delta-from-c9.md` was. Every row names the file, the line and what has to change.

It also carries the audit's own findings that are somebody else's work — the whitelist walls,
the fire-spread guard, the walk-gate law, the two milestone gaps and the heat table — because a
finding with no home is a finding that gets lost.

---

## 0. Headline — three things moved under C8's feet

1. **The world C8 rehearses in is no longer a bare meadow.** C11 Task 3 moved genesis authoring
   into `packages/engine/src/genesis/world.ts`. It builds the whole 128×128 valley from
   `(x, y)` arithmetic, bakes the city template into the ground, and emits eleven finished
   buildings, five owned huts, a well, a storehouse with stock, thirty founder items, fourteen
   animals and twenty forageable nodes — before anybody has taken a turn.
2. **A body now has four more ways to die and two more clocks to keep.** Thirst, the four
   afflictions, the fatigue ladder and the cold are all live at defaults.
3. **The ops plane has real callers for the first time**, and they are C11's gate runner
   (`packages/agents/scripts/g11-deepworld.ts`). C8's supervisor is the second caller and has
   to wire the same four seams or the production town runs dark.

---

## 1. C8's `genesis/` module becomes VERIFY-ONLY

**Was:** C8 authored the founders' town itself.

**Now:** `makeGenesisWorld(config, { anchor })` in `@sj/engine` is the single author. It is pure,
takes no RNG, and two calls with the same config are deep-equal — which is what lets replay
start from it.

**C8 edit:** whatever C8's plan says about laying out the town becomes a VERIFICATION task:
call `makeGenesisWorld`, fold it, and assert the shape (eleven structures, five huts owned by
`FOUNDER_IDS`, a well, a storehouse, `terrain` at `config.world.size`). Do not re-author.

**Load-bearing detail:** the founder kit is `FOUNDER_KIT` in the same file — axe, hoe, knife,
seed pouch, waterskin, three bread — spawned onto each founder's own hut shelf and **stamped
with `owner`** (C9 §2 ownership, genesis-emitted). C8's `spawnFounders` must not spawn a second
kit on top of it.

---

## 2. The storehouse manifest's spoilage decision is now FORCED

`c8-delta-from-c9.md` §3 left open whether genesis stock carries a spoilage clock.

**It is decided by construction.** `makeGenesisWorld` spawns every storehouse item through
`item_spawned` with `...spoilageFor(at0, kind, config)`, so wheat carries a 60-day clock at the
storehouse multiplier and the bread the founders hold carries a 6-day one. Nothing in the town
is exempt.

**C8 edit:** the manifest task stops asking the question and starts asserting the answer — the
storehouse's stock is `{ wood 20, stone 12, rope 4, cloth 4 }`, none of which spoils, and the
food that does spoil is in the founders' hands, not on the shelf.

---

## 3. The starvation-spiral re-baselining must be re-read

`c8-delta-from-c9.md` §8 re-baselined C8's rehearsal expectations against a bare meadow.

**Re-read every number in that section against a town that starts with five roofs, a well, a
storehouse and three loaves per founder.** Specifically:

- A founder cannot starve on day one: three loaves is three days of food in hand.
- A founder cannot die of thirst near town: the well is `well` at the template's `(20, 13)`
  offset, and `drink` takes it with no vessel.
- A founder CAN die of the cold outside in winter and CAN die of a fever nobody tends.
- **The rehearsal's failure mode has moved from starvation to attention.** The thing to watch
  is no longer "did they find food" but "did anybody answer the one who was ill".

## 3a. The energy budget is the tight one, and C8 should know the number

`needs.energyDecayAwakePerTick` is 0.093, so a body awake for a whole sim-day spends 134 of the
100 it has. A body on a 16-hour day ends it at ~10.7 energy — an hour from the collapse floor.
Sleeping eight hours is not a preference, it is the only schedule that closes. Measured in
`packages/engine/src/g11.test.ts` (G11a-D1). Any C8 tuning of the day's rhythm starts here.

---

## 4. The four ops-plane seams C8's supervisor must wire

Each of these had NO live caller before C11's gate runner, and each is a silent no-op if the
supervisor forgets it. The wiring is demonstrated end to end in
`packages/agents/scripts/g11-deepworld.ts`; C8 should copy the shape, not re-derive it.

| Seam | Call | What is lost if it is missed |
|---|---|---|
| `runConstructPass` | `@sj/arbiter/constructs` — once per sim-day, over the whole log | Nothing the town does together is ever recognized |
| `narrateDay` `world` seam | `{ config, state }` | Tier-2 milestones never run; no partnership, quarrel or parting is ever recorded |
| `narrateDay` `semantic` seam | `{ db, llm, records, spentUsdToday }` | Tier 2.5 never runs; the first god, the first joke and the first lie are never found |
| `makeArbiter` `vocabulary` | `{ itemKinds, structureKinds }` | Two thirds of the recipe sanity gate never bites |
| `reportDeadCalls` | once per day boundary | A tenth of the spend buys nothing and the ops surface still reads clean |

---

## 5. WHITELIST WALLS — where an arbiter-codified thing stops

The arbiter can codify a new noun. Whether the world can then DO anything with it depends on a
deterministic table, and most of those tables are closed. This is the sweep, with the extension
path where one exists. **v1 may accept second-class novelty deliberately — but it should be
deliberate.**

| Table | Where | Can a codified thing enter it? | Extension path |
|---|---|---|---|
| `FOOD_KINDS` / `isFoodKind` | `engine/verbs.ts` | **No** — a const set, plus `config.crops` | Add a crop row (frozen config) |
| `FOOD_NUTRITION` | `engine/verbs.ts` | **Open by default** — an unlisted kind is a full meal | None needed; the default is generous |
| `WEAPON_KINDS` / `weaponKindsFor` | `engine/verbs.ts` | **No, in practice.** The `weaponKinds?` column batch-4 opened is read off `config.crafting.recipes`, and a codified recipe lives in the RULEBOOK, not in config | Read the rulebook row's own declaration in `weaponKindsFor`, or move the reader to the seam |
| `VESSEL_KINDS` | `engine/verbs.ts` | **No** — a const set of two | A codified clay jug cannot hold water |
| `HUNTABLE_KINDS` / `FAUNA_KINDS` | `engine/verbs.ts`, `data/faunaDefs.ts` | **No** — consts | A codified beast cannot be hunted |
| `ITEM_CLASSES` (`any_meat`, `any_vegetable`) | `shared/items.ts` | **No** — a const record | A codified meat is not "any meat" and no stew will take it |
| Recipe tile vocabulary (`RECIPE_TILE_IDS`) | `engine/state.ts` | **No** — seven authored words | Correct as closed: a rule may not ask for ground the town has no word for |
| Requires-clause item vocabulary | `arbiter/sanity.ts` + `adjudicate.ts` | **YES** — `knownProducts` folds in every codified output | Already open; the one wall that is not a wall |
| Requires-clause structure vocabulary | same | **Partly** — extended by what the asker can see | Already open enough |
| `warmth.insulation` / `isWearable` | `shared/config.ts` | **No** — frozen config | A codified coat cannot be worn |
| `light.glowRadius` / `isKindleable` | `shared/config.ts` | **No** — frozen config | A codified lantern cannot be lit |
| `structures.recipes` / `buildableRecipe` | `shared/config.ts` | **No** — frozen config | A codified building cannot be raised |
| `HEAT_SOURCE_KINDS` | `engine/systems/warmth.ts` | **No** — a const set | A codified brazier warms nobody |
| `spoilage.days` | `shared/config.ts` | **No** — but absent means "keeps forever", which is safe | None needed |

**Recommendation for v1: accept second-class novelty, and say so.** A codified thing can be
made, held, given, stowed, named and written about; it cannot be eaten as food, worn, lit,
hunted, drunk from or built. Two of those walls are cheap to open and worth opening first:
`weaponKindsFor` reading the rulebook, and `FOOD_NUTRITION`'s open default extended to
`isFoodKind` behind a codified `edible: true` flag. The rest are frozen config and belong to
the next chunk's schema keystone.

---

## 6. `fire_spread` must check that both ends still exist (batch-2 ruling 5, root fix)

`packages/engine/src/systems/fire.ts`, the spread loop:

```ts
const from = ctx.state().structures[fromId]!      // non-null assertion on a stale id
```

`sources` is computed once, from ids; every emission inside the loop folds immediately, and the
burn loop below can delete a structure in the same tick. The assertion is the bug: a source the
fire has already consumed reaches `structuresAdjacent(from, to)` as `undefined`. The fold's own
guards then throw `fire_spread from unknown structure`.

**Fix (one line, code-only, golden-neutral because no golden fixture burns two adjacent
structures to destruction):** replace the assertion with a `continue`, and re-read `to` the same
way. The mitigation batch 2 landed — fixtures pin `weather.hourlyChangeChance: 0` and
`mystery.chancePerDay: 0` — stays, but it is a fixture habit, not a fix.

---

## 7. The walk-gate law is PERMANENT (batch-3 ruling 3)

`countsAsFootfall` counts a step only when the mover's `activity.verb === 'walk'`. G1's scripted
agents teleport with no activity, so G1 wears no ground and is frozen permanently rather than
pinned.

**This is a constraint on every future emitter, not a note.** Any new source of `agent_moved`
that is not a walk gets no ground wear by design; anything that gives G1's scripted agents an
`activity` moves the G1 golden. Write it into the next chunk's global constraints.

---

## 8. Two milestone gaps and one dead heat weight

**8a. `first_hut` / `first_bridge` can miss a structure planned on a day the pass never read**
(batch-7 F126). `detectFirsts` builds its own `structure_planned` → kind index from the events
it was handed and falls back to the injected `ctx.structureKind`. A hut planned on day 3 and
finished on day 5, narrated day by day, has no kind in the day-5 pass — so the injected lookup
is load-bearing and **every caller must supply it**. `narrateDay` does not.
**C8 edit:** `narrateDay` gains a `structureKind` passthrough from the world it already takes,
or the two firsts silently never fire on a long build.

**8b. No tier-1 first for a poisoning or for a body worn through** (batch-9 concern 3).
`first_infection` matches `agent_infected` and `agent_afflicted {kind:'illness'}`. There is no
row for `{kind:'poison'}` and none for `{kind:'fatigue'}`, so "the first poisoning" and "the
first body worn through" are firsts the ledger cannot record. Two data rows in
`narrator/src/milestones/tier1.ts`; no code.

**8c. `heat.ts` scores C11's sickness at zero** (batch-9 concern 2). `CONFLICT_WEIGHT` carries
`agent_infected: 1` and `agent_fell_ill: 1` — **neither has an emitter any more**. Neither table
has a weight for `agent_afflicted`, `affliction_worsened`, `affliction_recovered`,
`agent_tended`, `grave_placed` or `hp_changed`. A day in which somebody was poisoned, worsened
for three nights, was tended twice and was buried scores exactly the same heat as a quiet one.
Six rows in two tables; no code.

---

## 9. Structure ownership is real in the world and invisible to a mind

`Structure.owner` is stamped by `build` and by genesis, and it survives the owner's death. The
legal half of POST-REVIEW USER RULING 1 holds: `enter` checks kind, stage and doorway only, and
`sleep` checks `sleepIndoorsOnly` and `sleepableKinds` only — **sleeping in and entering another
body's hut is LEGAL**, as ruled.

**The witnessed half is missing.** `PerceivedStructure` carries `id, kind, x, y, w, h, burning,
stage, hasInscription?, inscription?, door?` and **no owner**; `ownerNames` is applied to items
and never to buildings, and no prose line names a hut's owner. No event marks entering somebody
else's roof. So a mind cannot tell whose door it is standing in, and nobody can resent it.

**This is a C11 §1/§9 pickup and it belongs on this list, not on C9's.** One optional
`ownerName?` on `PerceivedStructure`, gated on `ownership.enabled` and absent when unowned
(absent-until-first-use, so no packet changes for an unowned town), plus one prose clause.

---

## 10. Carry-item 2 — the `Verdict` / `AgentCtx` move trigger: NOT TRIGGERED

`packages/agents/src/runtime/arbiterSeam.ts` declares the structural minimum of `AgentCtx` and
`Verdict`; `packages/arbiter/src/adjudicate.ts` declares its own and the assignability is what
holds them together (ledger D-19-1). `@sj/arbiter` cannot import back because it depends on
`@sj/agents`.

**Consumers after C11: still two.** Task 30's expressive path (`arbiter/src/expressive.ts`)
imports only `LlmMessage` from `@sj/agents`; Task 32's recognizer (`arbiter/src/constructs.ts`)
imports only `assertQuotedName` and `LlmClient`. Neither touches the seam types. The two gate
runners under `packages/agents/scripts/` import `Adjudicator`/`Codifier`, but a script in the
same package is not a third package consumer.

**Verdict: leave them where they are.** The trigger is recorded here for C12: **move both to
`@sj/shared` the day a third PACKAGE imports them.** The likely third is C12's viewer or
inspector wanting to render a verdict.

---

## 11. Carry-item 3 — the four-seam audit: CLEAN

Every seam that derives effective config still derives it, and every constant C11 derived from
config has exactly one definition site.

| Seam | Derives `effectiveConfig`? |
|---|---|
| `fold` (`engine/fold.ts:66`) | yes |
| `submitIntent` (`engine/intent.ts:12`) | yes |
| `composePerception` (`engine/perception.ts:230`) | yes |
| `hears` (`engine/perception.ts:198`) | yes |
| `createWorldTick`'s `ctx.config` getter (`engine/worldTick.ts:127`) | yes, re-derived per read |
| `runConstructPass` (`arbiter/constructs.ts`) | yes — `deps.laws ?? lawsFromEvents(deps.events)` |
| every `lightLevelAt` / `visionRadiusAt` caller | yes — all four reach them through one of the above |

One definition site each, verified by grep over `packages/*/src`:
`dayPhaseFromTick` (shared/time.ts), `terrainCostFor` + `stepCostAt` (engine/path.ts),
`fertilityAt` (shared/fertility.ts), `lightLevelAt` + `visionRadiusAt` (shared/light.ts),
`chunkOf` (shared/chunk.ts), `thirstDecayPerTick` (shared/config.ts),
`ambientTempAt` + `insulationOf` + `isExposed` (engine/systems/warmth.ts),
`dominantDrain` + `deathAttribution` + `drainPerTick` (engine/systems/mortality.ts),
`warmthTarget` + `awakeEnergyDecay` (engine/systems/needs.ts).
**No second copy of any of them.** The `DEFAULT_RECENT_WINDOW_TICKS = 132` bug has not grown a
new hat.

---

## 12. Task 37(d) — hierarchical pathing: DEFER, with evidence

Task 37(d) (`pathing.regionSize`, a cached portal graph, region-level routing then local
refinement) was never implemented (batch-9 D9). `pathing.regionSize` is parsed by the schema and
**read by nothing**.

**Recommendation: defer past v1.** The evidence is the measurement, not an opinion:

| Measured on the 128×128 genesis town | Value |
|---|---|
| median world-tick compute, 12 agents, fauna at every cap | **0.05 ms** (budget 50 ms) |
| p99 | **0.395 ms** (budget 250 ms) |
| worst case observed | 1.77 ms |
| corner-to-corner A\* at the 6000-node budget | 6.6 ms, capped, 159-step usable partial |
| the same query at a 200-node budget | 0.54 ms, capped, 17-step partial |

The flat search is three orders of magnitude inside its budget, and the capped-partial path is
already the honest answer for an unreachable goal. Hierarchical pathing would change path
results and therefore needs a golden regen and a ruling of its own — a cost with no measured
benefit at this map size. **Revisit if `mapGrowth` ever reaches `maxSize` 192 with a dense town,
or if agent count passes ~40.**

---

## 13. The C8 cost plan, unchanged, plus one thing C11 measured

`cleanup/c8-cost-plan.md` L1–L4 are C8 plan input as written. C11 adds one measurement to L1:

**The client has no hard provider allow-list.** `defaultExtraBody` sends
`provider: { order, allow_fallbacks: true }`, and `allow_fallbacks` is a literal in the source
with no way through `LlmClientOpts` to turn it off. `providerOrder` is therefore a PREFERENCE.
L1's premise — that cache hits require same-provider routing — cannot be tested until the
client can send `allow_fallbacks: false`. **C8 edit: `LlmClientOpts` gains
`allowProviderFallbacks?: boolean` (default true, so nothing changes for any existing caller),
and `defaultExtraBody` reads it.** One field, no behaviour change at defaults.

---

## 14. The C12 hand-off

The §16 shared-interface list is unchanged, plus the A8 amendment block. C11 adds these to
C12's lane notes:

1. **Chunked ground.** `CHUNK_TILES = 32`, `chunkOf(x, y)`, `chunksTouched(coords)` in
   `@sj/shared`. A paved tile redraws its own chunk and not a 128×128 map.
2. **The light functions are shared on purpose.** `lightLevelAt`, `visionRadiusAt`,
   `lightBandAt`, `flamesAt` and `LIGHT_GLOW_RADIUS` are in `@sj/shared` so the render and the
   witness rule can never disagree about what a night looks like.
3. **`fertilityAt` is a distance function, never a stored gradient** — C12's overlay calls the
   same function the harvest does.
4. **Far-bank copy is fixed.** `FAR_BANK_PHRASE = 'across the river'` and
   `faunaSightingLine(kind, farBank)` — a herd you can see and cannot reach is described as
   visible, never as available (batch-4 ruling 6).
5. **`UNNAMED_CONSTRUCT_COPY = 'a gathering not yet named'`** is what the viewer reads where a
   name would be. A construct's TYPE is ours and never reaches a viewer surface a mind can see.
6. **`world_grown` moves every stored coordinate.** A viewer holding a camera position across a
   growth must translate it by the same `dx`/`dy` the fold applies, or the town appears to jump.
7. **The C12 art queue from `gate-g13`** is unchanged and carries forward as it stands.

---

## Carried, not deltas — things C8 and C12 should read but not act on

- **The fatigue ladder is a one-way ratchet.** One collapse mints a `fatigue` affliction;
  `agent_slept` clears the collapse COUNTER and leaves the affliction standing, and the only
  thing in the world that lifts one is a herb. A body that goes down once and never finds a
  herb dies of it inside two sim-days, whatever it does afterwards. Asserted in
  `packages/engine/src/g11.test.ts` (G11a-D1). **Whether a night's sleep should lift a rung is
  a DESIGN DECISION and is the controller's, not an implementer's.**
- **The garment flips no threshold in winter.** `isExposed` is a threshold on
  `ambient + insulation >= comfortBand`; with `comfortBand` 8, `insulation.garment` 2 and the
  winter band at −4 / −8 / −12, a coat changes nothing in winter. The only band where it
  decides is an autumn dusk (6 → 8). All three survivability rungs still close with the energy
  margin, because four walls are an absolute shield. `comfortBand` and the ambient table are
  FROZEN CONFIG, so this is reported and escalated, never tuned (batch-5 ruling 1).
- **Every forageable IS reachable, and the town still does not reach one.** Measured from a
  founder's own doorway on the folded genesis world: the nearest berry bush is **17 steps**, the
  nearest herb patch **20**, the nearest reed bed **25**, and every one of the twenty nodes has
  a finite path. The river is not the wall it looks like — the city template lays its own
  ground across x 48–50 through the town, so the west bank is walkable from the square. What is
  missing is not a route but a REASON: every node sits outside the founders' sight radius on the
  morning of day one, and nothing in a mind's context names where any of them is. Across five
  live 2-sim-day runs the town gathered **once**. Giving a mind the coordinates its own
  backstory says it has known for years was enough to make it try.
- **`extinguish` and `douse` both stand** (batch-3 ruling 1). Bare hands are the no-bucket
  fallback; the bucket line is the efficient one. If live evidence ever shows minds never douse
  because extinguish is free-equal, that is the trigger to revisit.
- **The fertility cap is inert at defaults** (batch-3 ruling 4): 1.375 < 1.5. A cap is a cap,
  not a promise. v1.x tuning candidate only.
- **Fauna entities and C9's `wildlife` counters both stand** (Q5, accepted debt). The trigger to
  collapse them is a single UI number drawing from both stores.
- **`agent_harmed` has no emitter**, so tier 2's `first_quarrel` and `first_reconciliation` can
  never fire. C11 gave `attack` an injury affliction with a `sourceId` so a death can be a
  killing; it deliberately did NOT also emit `agent_harmed`, because that would charge the hp
  twice. Whoever wants the quarrel milestones must decide which event carries the blow.

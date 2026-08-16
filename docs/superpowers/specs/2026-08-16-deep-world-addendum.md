# San Junipero — Spec Addendum: C11 "Deep World"

**Date:** 2026-08-16
**Status:** DRAFT — pending user review. Extends `docs/superpowers/specs/2026-08-15-san-junipero-design.md` and the C9 addendum (`2026-08-16-living-world-addendum.DRAFT.md`); nothing here overrides a locked decision except where a user ruling of 2026-08-16 explicitly says so.
**Chunk order:** C11 executes after C9 and C10 land, before C12, before C8. Companion: `2026-08-16-deep-presentation-addendum.DRAFT.md` (C12 renders everything C11 makes true).
**Scope authority:** v1-core-findings-ledger.md §A1/A2/A3/A5/A6 + §B1, under the §D rulings — 128×128 map, huntable engine fauna + ambient (ambient half delegated to C12), thirst as a survival clock slower than hunger, C11/C12 split — plus the social-constructs ruling of 2026-08-16 (§10).
**Level:** SPEC — systems, world laws, event types, config, interfaces, gate outline. The task-by-task plan is written after C9/C10 land.

**The philosophy in one sentence: this chunk deepens the physics — death has causes, water has weight, paths have history — and still authors no outcome.** Every system below is a cost, a clock, or a material; never a goal, a role, or a moral.

---

## 1. Full mortality model — hp + afflictions (ledger A1)

Binary `alive` becomes a body with hit points and named ailments. Death always has a cause, and the cause is world state, not narration.

### Body model

```ts
AgentBody.hp: number                  // 0..config.mortality.maxHp (100); death at 0
AgentBody.afflictions: Array<{ kind: AfflictionKind, severity: number, sinceTick: number }>
AfflictionKind = 'injury' | 'poison' | 'illness' | 'fatigue'
DeathCause = 'injury' | 'poison' | 'illness' | 'fatigue' | 'hunger' | 'thirst' | 'slain' | 'old_age'
```

| Mechanic | Rule |
|---|---|
| Damage | `agent_harmed {agentId, amount, source: 'attack'\|'fire'\|'accident', byId?}` — hp delta recorded in the payload (any roll drawn at emission from the `combat`/`fire` streams). Violence keeps its base-spec shape: opposed rolls, injuries before fatality. A serious hit also attaches an `injury` affliction. |
| Affliction drain | Pure per-tick fold arithmetic: each affliction drains hp at `mortality.drainPerTick[kind] × severity`. No RNG in fold, ever. |
| Illness progression | Midnight roll per afflicted agent (`illness` stream): worsen (`affliction_worsened {agentId, kind, severity}`) or turn toward recovery. Contagion: each midnight, each ill agent rolls `illness.contagionChance` per healthy agent within `illness.contagionRadius` sharing an interior or outdoors in range → `agent_afflicted {kind:'illness', sourceId}`. Genesis on/off + dial: **PENDING USER RULING, §13**. |
| Poison | Eating a `pale_mushroom` item (§9 forageables), or eating any item inside its final `spoiling` day (the C9 perception flag — spawnDay + days − 1; no C9 change needed), rolls `mortality.poisonChanceSpoiled` (`illness` stream, at the eat event) → `agent_afflicted {kind:'poison', itemId}`. C9's spoilage stops being cosmetic. |
| Fatal fatigue | The base-spec collapse ladder gets a floor: a collapse that ends without recovery (no rest/food before the next collapse) escalates a `fatigue` affliction one severity step; fatigue drains hp like any affliction. Cold (§6) feeds this path — cold drains energy, never hp directly. |
| Hunger/thirst clocks | Hunger 0 or thirst 0 → hp drains at `mortality.hungerHpDrainPerTick` / `mortality.thirstHpDrainPerTick`. The slow deaths are visible for sim-days before they land. |
| Death | hp reaches 0 → engine emits `agent_died` with **`cause: DeathCause`** (dominant drain source at the death tick, deterministic tiebreak: highest drain, then affliction seniority) and `byId?` when the fatal damage traces to an attacker. Injury death with an attacker = `cause:'slain'` — the witnessed murder event is the justice-emergence seed; no authored punishment. Old-age death (C2/C9 §11) adopts the same payload shape, `cause:'old_age'`. |
| Recovery | Four arcs, all mechanics: **rest** (sleeping multiplies hp regen `mortality.sleepRegenMultiplier`), **food** (fed above `fedThreshold` enables baseline regen), **herbs** (eating an `herb` item reduces the severity of the worst affliction by `herbRelief`), **`tend` verb** — `tend {targetId, itemId?}`: adjacent (same-interior rule from C9 §1 applies), duration 3, emits `agent_tended {tenderId, targetId, itemId?}`; target gains a recovery-multiplier window (reuses the C9 `tendedTick` pattern), an offered herb is consumed for double relief. Care is a cost paid by another body — bonds material, healer-role emergence, nothing authored. |
| Graves | On `agent_died`, the engine emits `grave_placed {agentId, name, x, y}` at the death tile (nearest free tile if occupied) → a 1×1 `grave` structure, permanent, inscribable (C9 §6 — epitaphs are theirs to write). The C9/Style-Bible grave tone rule applies unchanged. Deliberate simplification: no corpse object, no burial verb in v1 — the grave appears where the life ended. |

Deliberately NOT authored: funerals, mourning, inheritance (C9 §2 owns the property answer), quarantine, medicine as an institution, revenge, justice.

---

## 2. Thirst + water system (ledger A5, ruling D4)

Thirst is a survival clock, config-dialed **slower than hunger** (ruled). Water gets weight, containers, and work.

| Mechanic | Rule |
|---|---|
| Thirst stat | `AgentBody.thirst: 0..100`, decays at `thirst.decayPerTick` (default 0.6× the hunger rate). Debuff prose at the same ladder hunger uses ("your mouth is dry"); at 0 the §1 hp clock starts. |
| `drink` | Tier-1 verb. Sources: adjacent water tile (river/lake/channel), adjacent complete `well`, or a held `waterskin` with charges. Duration 1. Emits `agent_drank {agentId, source: 'water_tile'\|'well'\|'item', itemId?}`; restores `thirst.drinkRestore`; decrements a waterskin charge. |
| `fill` | Tier-1 verb: fill a held `waterskin` (`thirst.waterskinCharges`, default 4) or `bucket` (1 charge, heavy — the firefighting unit) at water/well. Emits `item_filled {itemId, charges}`. |
| Wells | New buildable structure kind `well` (build verb, material costs in `structures.recipes.well` — stone-heavy). A drink/fill source anywhere; the town can move water inland. |
| Irrigation → fertility | `dig_channel` verb: on grass/earth adjacent to water or an existing channel; duration 4; emits `tile_changed {x, y, to: TILE.channel, reason: 'channel'}`. Fertility is a pure function, no stored gradient: `fertilityAt(state, x, y)` = 1 + `fertility.waterBonus` scaled by distance ≤ `fertility.radius` (default 3) to the nearest water/channel tile, capped at `fertility.maxMultiplier` (default 1.5). Crop yield multiplies by it. Location value, land arguments, irrigation projects — all emergent from a distance function. |
| Firefighting | `douse {x, y}` verb: holding a filled bucket, adjacent to a burning tile/structure; emits `fire_extinguished {x, y, agentId, structureId?}`, clears the burning state, empties the bucket. Closes the C6 fire loop with agency — fire spread already exists; now so does the bucket line. |
| Bridges | New buildable structure kind `bridge`: road-over-water. Footprint 1×2 or 1×3, placeable only on water tiles orthogonally flanked by land/bridge; while `complete`, its footprint tiles are passable at **road cost** (`isPassable`/`terrainCostFor` consult structures — the one structure kind that grants passage instead of blocking it). The river forks the 128×128 map (§9), so the first bridge is an earned milestone — the narrator's firsts ledger will catch it; nothing prompts it. |

Deliberately NOT authored: water rights, well ownership, who digs, rationing in drought.

---

## 3. Roads by agents + desire paths (ledger A2)

C9 T1b made roads mechanically preferable (tile 7, `pathing.roadCost` 0.6). C11 makes them **buildable and historical**.

| Mechanic | Rule |
|---|---|
| `pave` | Tier-1 verb: on or adjacent to a grass/earth/path tile; consumes `roads.stonePerTile` (default 1 stone); duration `roads.paveDurationTicks` (default 6); emits `tile_changed {x, y, to: TILE.road, reason: 'paved', byId}`. No tool required in v1 (a shovel recipe is an arbiter matter). |
| Desire paths | `WorldState.traffic`: per-tile walk counters folded from `agent_moved` (pure arithmetic, no new events for the counting). Midnight law: a grass tile with traffic ≥ `desirePaths.wearThreshold` (default 120 crossings) → engine emits `tile_changed {to: TILE.path, reason: 'worn'}`. Traffic decays `desirePaths.decayPerDay` (default 10%) at midnight; a path tile whose traffic stays below `regrowThreshold` for `overgrowDays` (default 20) → `tile_changed {to: TILE.grass, reason: 'overgrown'}`. Trails appear where life flows and fade where it stops — zero authoring, fully deterministic (no RNG anywhere in this law). Path tiles cost `desirePaths.pathCost` (default 0.8) — better than grass, worse than road: heavily walked dirt is exactly what agents will want to pave. |
| Road-adjacent build preference | A **benefit, never a rule** (ruled): the build verb's perception context gains one line when the chosen site touches road/path ("carts and feet reach this spot easily") and hauling to/from road-adjacent sites inherits the existing move-cost advantage. No site scoring, no placement rule, no prompt nudge toward roads — the engine states the physics, the mind weighs it. |

Deliberately NOT authored: town planning, zoning, who pays for paving, road names.

---

## 4. Huntable fauna (ledger B1.6, ruling D2)

Engine fauna are **simple non-LLM entities**: they wander, flee, and can be hunted or fished. Zero LLM calls, zero minds. Ambient fauna (birds, butterflies, fireflies) are **renderer-only and delegated to C12 §9 in full** — they never enter world state. Domestication stays v1.x.

| Mechanic | Rule |
|---|---|
| State | `WorldState.fauna: Record<id, {kind: FaunaKind, x, y, alive}>`, `FaunaKind = 'deer' \| 'rabbit' \| 'fish'`. Fish entities are schools bound to water tiles. |
| Movement | One batched event per movement beat (`fauna.movePeriodTicks`, default 4): `fauna_moved {moves: [{id, x, y}]}` — destinations rolled from the `fauna` stream **at emission**, recorded in the payload; fold just applies coordinates. Wander within a home range; deer/rabbit flee (move away, double step) when an agent is within `fauna.fleeRadius` (default 4); fish drift within their water body. Batched to cap log growth; the event is also C12's render feed. |
| Population | Daily spawn/regen roll (`fauna` stream) up to `fauna.caps` per kind (`{deer: 8, rabbit: 12, fish: 6}` schools); spawns at habitat tiles (forest edge, meadow, water) → `fauna_spawned {id, kind, x, y}`. Winter halves spawn rolls (consistent with C9's harsher-seasons dials). |
| `hunt` | Tier-1 verb: target a deer/rabbit within reach (Chebyshev ≤ 1 — flee behavior makes closing that distance the actual hunt); requires a held knife (or any arbiter-codified weapon); skill check vs `fauna.huntDifficulty[kind]`, roll from the `fauna` stream at emission. Success → `fauna_killed {id, kind, byId, x, y}` + `item_spawned` (deer → `venison` ×2, rabbit → `rabbit_meat` ×1 — both in the C9 spoilage table; venison already is). Failure → the animal flees. |
| `fish` (upgraded) | The existing Tier-1 verb gains spot-awareness: yield chance multiplies by `fauna.fishSchoolBonus` (default 2×) when a fish school occupies a tile within 2 of the cast. Schools deplete one unit per catch and disband at 0 (`fauna_killed` on the school). C9's `fishCatchMultiplier` winter dial composes on top. |

Meat food line: `venison`/`rabbit_meat`/`fish` are food items (spoilage per C9 table); cooking upgrades are §7's business.

Deliberately NOT authored: hunting rights, herds as property, overhunting morality (the caps and regen ARE the ecology — deplete it and it is simply gone for a while).

---

## 5. Warmth/cold with clothing line (ledger B1.1)

Warmth exists in the base spec's needs but has no teeth. C11 gives cold a bite that **drains energy, never hp directly** — cold kills through the fatigue ladder (§1), keeping the ruled cause list closed.

| Mechanic | Rule |
|---|---|
| Ambient temperature | Deterministic table: `warmth.ambient[season][dayPhase]` modified by weather (storm −1 band, snow −2). No RNG. |
| Exposure | When ambient < `warmth.comfortBand`, warmth decays at `warmth.exposureDecayPerTick` unless mitigated: **indoors** (C9 `insideId`), **within `warmth.heatRadius` (default 2) of a lit hearth/fire_pit** (§6), or **clothed** (equipped garment insulation offsets bands). Warmth 0 → energy drain doubles → collapse → fatigue path. |
| Clothing line | Craft chain: `fiber` (forage) / `hide` (hunt byproduct: deer also yields 1 `hide`) → `cloth` (craft) → `garment` (craft, tailoring skill). `wear {itemId}` / `doff` verbs → `item_equipped {agentId, itemId, slot: 'body'}` / `item_unequipped {agentId, itemId}`; one body slot in v1. `warmth.insulation[kind]` per garment kind. Equipped garments are body state → C12 renders them as paper-doll layers (visual variety for free). |

Deliberately NOT authored: fashion, dress codes, who gets the warm coat.

---

## 6. Light — torch, lantern, hearth; night work; fire risk (ledger B1.2)

| Mechanic | Rule |
|---|---|
| Sources | Items: `torch` (craft: wood + fiber), `lantern` (arbiter-territory upgrade — longer burn). Structures: `fire_pit` (genesis, §9) and hearths inside huts count as lit while fueled. `stoke {structureId}` verb: consume 1 wood → `structure_fueled {structureId, burnsUntilTick}` (deterministic duration `light.fuelBurnTicks`). |
| Kindle/snuff | `kindle {itemId}` → `item_lit {itemId, burnsUntilTick}` (`light.torchBurnTicks`, default 240 = 4 sim-hours); expiry emits `item_burned_out {itemId}` (item consumed); `snuff` → `item_snuffed {itemId}` (torch keeps remaining fuel). |
| Night work | Work verbs (build, craft, till, pave, dig_channel) at night without a light source within `light.workRadius` (default 2) run at `light.nightWorkPenalty` duration (default 1.5×), with the debuff named in perception ("you fumble in the dark"). Never a refusal — the choice to burn fuel or burn time is theirs. |
| Fire risk | Each tick, a lit item held or dropped adjacent to a flammable tile/structure rolls `light.fireRiskPerTick` (default 0.0005, `fire` stream, rolled engine-side at emission) → existing `fire_ignited`. Light is safety and hazard in one object; §2's bucket line is the counterweight. |

Deliberately NOT authored: curfews, night watch, lamp-lighting duties.

---

## 7. Food variety (ledger B1.3)

A mild efficiency mechanic, never a cuisine score: the body tracks distinct food kinds eaten over a rolling `foodVariety.windowDays` (default 3, folded from eat events). Each distinct kind beyond the first adds `foodVariety.bonusPerKind` (default +5%) to eat restoration, capped at `foodVariety.maxBonus` (+20%). Monotony is a real cost; a shared stew at the fire pit is worth walking for — whether shared meals become a custom is the town's business. One seed recipe ships in the genesis rulebook (initial conditions, §9): `stew` (any meat + any vegetable + water at a lit hearth/fire_pit). Bread/berries/fish/meat/stew is the v1 food spread; everything beyond it is arbiter territory.

## 8. Forest regrowth (ledger B1.4)

Midnight law: each grass tile orthogonally adjacent to ≥ 1 forest tile rolls `regrowth.saplingChancePerDay` (default 0.02, `regrowth` stream) → `tile_changed {to: TILE.sapling, reason: 'seeded'}`. A sapling matures after `regrowth.saplingDays` (default 30) → `tile_changed {to: TILE.forest, reason: 'grown'}` (deterministic, from the seeding event's tick). Saplings are passable and choppable (yield 0 wood, clears the tile — clearing land is a real act). Wood scarcity becomes a cycle, not a one-way deforestation death; a town that clear-cuts its edge waits a season for the edge to creep back.

---

## 9. 128×128 map, growth as world law, genesis town (ledger A3/A6, ruling D1)

### Map baseline and growth

- **Genesis 128×128** (ruled) — the spec §10 world made real at full size: forking river with a lake, meadow, forest edge, rocky hill, standing stone. `world.size {w: 128, h: 128}` is genesis input.
- **Growth is a world-law event**: at midnight, when completed-structure count crosses the next multiple of `mapGrowth.structuresPerStep` (default 12) and growth is enabled, the engine emits `world_grown {edge: 'n'|'e'|'s'|'w', depth, tiles: TileId[][]}` — border strip terrain rolled from the `worldgen` stream **at emission and recorded in the payload** (replay-safe by construction). Edge cycles deterministically; `mapGrowth.step` default 16 rows/cols; hard cap `mapGrowth.maxSize` (default 192). Traffic and any per-tile arrays resize in fold. "The world grows as the town does" — a law, not an operator act. |

### Engineering requirements (binding contracts)

| Contract | Requirement |
|---|---|
| Chunked ground bake (for C12) | `CHUNK_TILES = 32`; `chunkOf(x, y) = (⌊x/32⌋, ⌊y/32⌋)` exported from `@sj/shared`. Any `tile_changed` or `world_grown` dirties exactly the chunks its coordinates touch; the C12 renderer rebakes **only dirty chunks** (a 128×128 map is 16 chunks; a 192×192 map is 36). This is the C11→C12 ground contract; C10's single-bake `rebakeGround` is superseded by the chunked bake in C12, same `RenderTexture` law otherwise. |
| A* budget | `pathing.maxNodes` (default 6000) caps expansion per query; on cap, return the partial path to the best frontier node with diegetic prose ("the way is unclear from here"). |
| Region caching | Hierarchical pathing: `pathing.regionSize` (default 16) tiles per region; cached portal graph between regions; a `tile_changed`/`world_grown` invalidates only the touched regions' cache entries. Long paths route region-level then refine locally. Perf gate line: §18. |
| Entity culling | Viewer-side (C12); the engine's only obligation is that fauna/forageable/tile deltas carry coordinates so the renderer can cull. Already true of every event above. |

### Designed genesis town — the ENGINE half (art is C12/C5-pipeline)

All placements are a deterministic authored fixture — initial conditions, not outcomes. Replaces the bare-meadow day zero of base-spec §10; C10's 48×48 showcase map remains a dev fixture only.

| Layer | Contents |
|---|---|
| Structures | Communal `fire_pit` (social anchor — heat + light + stew hearth), `well`, 3 starter huts, `storehouse` (~10 sim-days of supplies, unchanged countdown), workshop `shed`, `wagon` (lore prop, existing kind), `standing_stone` (the engine never explains it), plaza of road tiles + a short starter road spine east from the plaza (A2 grows it from there). Town sits near the river bend; the far bank has **no bridge** — that milestone is theirs. |
| Founder kits (×5, owned per C9 §2) | axe, hoe, knife, seed pouch, 3 sim-days of food, waterskin. |
| Communal stock (storehouse, unowned) | timber ×20, stone ×12, rope ×4, cloth ×4. |
| Forageable nodes | New entity class: `WorldState.forageables: Record<id, {kind, x, y, stock}>`, `ForageableKind = 'berry_bush' \| 'mushroom_patch' \| 'pale_mushroom_patch' \| 'herb_patch' \| 'clay_deposit' \| 'stone_outcrop'`. The `forage` verb targets a node: yields its item, decrements stock; `forageable_depleted {id}` at 0; daily regen roll (`forage` stream, not in winter — consistent with C9) → `forageable_regrown {id, stock}`. Genesis scatter authored: berries near meadow, mushrooms + pale mushrooms at the forest edge (perception says only "a pale mushroom" — which ones kill is knowledge the town earns and spreads, §1 poison), herbs by the river, clay at the bank, stone at the hill. `forageable_spawned {id, kind, x, y}` is the genesis + regen event. |
| Fauna genesis | Deer herd at the forest edge, rabbits in the meadow, fish schools in river and lake (§4 caps). |
| Rulebook seed | `stew` recipe (§7). Nothing else — the codex stays hungry. |

New TileIds (widening C9's 0..7): `8 path`, `9 sapling`, `10 channel`. `terrainCostFor` covers the widened union (path 0.8, sapling as grass, channel impassable-but-drinkable like water).

---

## 10. Social constructs — occur naturally, then get labelled (BINDING USER RULING 2026-08-16)

Ruling: **all social constructs (politics, religion, festivals, gatherings, parties, and more) must occur NATURALLY, then get LABELLED by the arbiter** — observer dynamic: "agents held their first festival and called it X." Extension ruling, same day: the recognition system must detect **all the milestones any society could have** — first fight, first relationship, first marriage, first breakup, and everything comparable. Two halves in the world's plane plus one framework outside it.

### 10.1 Half 1 — the tools (agent-side primitives; audited, gaps filled)

| Tool | Status | Spec |
|---|---|---|
| Time awareness | GAP — partial | The prompt context names the shared calendar explicitly every turn: "day N, dusk, early winter." `reconsider_at` (base spec §5) extends to accept absolute sim-times ("dusk on day 12"), so a mind can keep an appointment; plans and journals already persist intentions. Without shared future reference nothing can be *planned*, only spontaneous — this line is what makes "meet at the stone at dusk" possible. |
| Expressive novel verbs | GAP — policy | Generalizes the accepted-items law to actions. Unknown-verb routing exists (C9 §8.1); C11 adds the **adjudication policy**: an intent that is expressive with **no world mutation** — dance, sing, pray, mourn, salute, bow… — is a cheap approval. The arbiter codifies it as an expressive verb (duration, small energy cost, visible action + emote) emitting `agent_expressed {agentId, verb, targetId?, x, y}` — a witnessed world event, fold no-op (pure witness record, same class as C9's `item_taken`). Approved verbs enter the global rulebook accepted-verbs list; thereafter every mind uses them at zero LLM cost (C9 codify machinery, nothing new invented). |
| Ritual/symbolic items | EXISTS | The generative-items law (C9 §8 codification): offerings, totems, banners are `spawn_item` recipes. Cross-reference only. |
| Speech, exchange, teaching, writing | EXISTS | `speak` (earshot physics), `give`, `teach`, `inscribe` (C9 §6) — including **toponyms**: carving a name onto a place IS naming it; inscriptions are a name source for the recognizer below. |
| Gathering anchors | EXISTS (§9) | Fire pit, plaza, standing stone — initial conditions that make co-location natural, never scripted. |

### 10.2 Half 2 — the arbiter construct recognizer (ops-side; the C4 arbiter's production job)

- **Daily pass over the event stream, entirely outside world state.** Candidate detection is deterministic heuristics: recurring co-location of ≥ `constructs.minParticipants` at an anchor within `constructs.windowDays` + expressive/leisure act density (`agent_expressed`, shared meals, idle clustering) + shared speech tokens (recurring n-grams across speakers) + offerings (items moved/left at a site) + repeated deference to one voice (speech-turn patterns). Candidates go to one arbiter LLM call for type classification.
- **Registry** (arbiter/ops DB, `ConstructSchema`): `{ id, type: 'festival'|'faith'|'council'|'market'|'custom', name: string|null, nameProvenance: {eventSeq, quote, byId}|null, anchor: {x,y}|structureId|null, participants: string[], firstTick, recurrences: [{tick, participants}] }`. `custom` exists precisely so the taxonomy is open-ended — the arbiter may recognize construct types nobody seeded.
- **NAMING LAW (binding):** the arbiter recognizes the TYPE; the NAME comes **only from the agents' own utterances or inscriptions**, stored as a verbatim quote with event provenance. No coined name → `name: null`, and every viewer surface says so ("a gathering not yet named"). The town coins the word; we only quote it.
- **ONE-WAY GLASS (binding):** the taxonomy is arbiter/viewer vocabulary and never enters agent prompts, perceptions, or memory. Agents are never told they "have a festival." Labelling never causes behavior — asserted at the gate by a banned-vocabulary scan over prompt assembly.
- **Ops-plane events** (arbiter DB, agent-invisible, never in the world log or hash): `construct_recognized {constructId, type, anchor, participants, tick}`, `construct_named {constructId, name, provenance}`, `construct_recurred {constructId, tick, participants}`. They feed chronicle/narrator surfaces the way C7 milestones do.
- Subsumes the ledger's presentation-side "gathering detector": detection is arbiter-side now; **C12 only renders** (Constructs/Milestones panel — C12 addendum).
- Config `constructs.*` rides the C9 world-law machinery (paths whitelisted; flips land as `config_changed`; fold stores `laws` only — no world physics reads them; the recognizer reads effective config ops-side): `constructs.enabled: true`, `minParticipants: 3`, `minRecurrences: 2`, `windowDays: 7`, per-type toggles `constructs.types.{festival, faith, council, market, custom}: true`.

### 10.3 Milestone detection framework — three tiers, one registry (RULING EXTENSION 2026-08-16)

One registry, not a rival: **extends C7's `NarratorStore` milestones/firsts ledger** with a schema migration — `MilestoneRow = {kind, tier: 1|2|3, domain, label, day, tick, agentIds, constructId?, nameProvenance?}` (existing rows backfill as tier 1). C10's `/api/milestones` endpoint shape extends compatibly (additive fields). Detection is ops-plane (narrator for tiers 1–2, arbiter recognizer for tier 3); one-way glass and the naming law apply to **all** tiers.

| Tier | Mechanism | Seed catalog |
|---|---|---|
| **1 — engine firsts** | Deterministic, direct from event types; table-driven (`kind → event predicate` as data, extensible by config) | first structure completed / first hut / first harvest / first meal / first fish / first hunt / first tool crafted / first expert craft (C9 maker's mark) / first trade-`give` / first theft witnessed (`item_taken`) / first road paved / first bridge / first fire + first fire extinguished / first inscription / first item invented (accepted-items) / first verb invented (accepted-verbs) / first pregnancy / first birth / first child named (social name) / **first death per `DeathCause`** / first grave / population milestones (10, 25, 50…) / first `world_grown` / first winter survived (all alive at spring) / first year completed |
| **2 — pattern firsts** | Deterministic rules over the event stream + relationship rows; rule set as data where feasible | first conversation / first friendship (bond strength threshold) / first quarrel-fight (`attack` or hostile exchange between bonded agents) / first reconciliation (bonded interaction resumes after a quarrel gap) / first partnership (C9 co-sleep inference) / **first breakup** (partnership lapses per C9 §3's rolling window AND interaction pattern shifts — **declared C9-interface requirement:** C9 T11/T12 relationship rows must expose partnership dissolution as a queryable transition with formed/dissolved ticks, not just current state) / first affair (co-sleep overlap while partnered) / first orphan (both parents dead) / first grandparent (third generation via `agent_born.parents`) / first apprentice mastering a taught skill (teach event → skill threshold) / first social name adopted |
| **3 — construct firsts** | The §10.2 recognizer; **named only from the town's own speech** | first gathering / first party / first festival / first **wedding** (distinct from tier-2 partnership: the engine detects the *partnership*, the arbiter detects the *ceremony* if the town invents one — both are milestones, phrased differently) / first funeral / first song–dance–story (expressive verbs in performance context) / first offering + first ritual site / first council decision / first leader followed / first declared rule / first punishment or exile / first market day / first place named (toponym adoption) |

Framework laws: every milestone row is a **chronicle entry** (weight 16, observer voice: "The town held its first wedding — they call it a \<their word>"; unnamed tier-3: "…a ceremony not yet named"), **share-card material** (C12 §18), and a **Milestones panel entry** (C12 §16 — filterable by tier/domain, jump-to-moment). Tier-1/2 catalogs are extensible as data (new predicates without code where feasible, `milestones.catalog` config); the tier-3 list is open-ended by design (`custom`). Detection never enters agent prompts; names come only from the town.

---

## 11. New config keys (all defaults; `SimConfigSchema` sections, each with an enable flag; all flags + starred dials whitelisted in `TOGGLABLE_PATHS` per the C9 §19 pattern — admin dashboard + viewer World Laws panel)

```
mortality.enabled: true            mortality.maxHp: 100
mortality.drainPerTick: {injury: 0.05, poison: 0.12, illness: 0.08, fatigue: 0.04}   (× severity)
mortality.hungerHpDrainPerTick: 0.1   mortality.thirstHpDrainPerTick: 0.15
mortality.poisonChanceSpoiled: 0.35*  mortality.sleepRegenMultiplier: 3
mortality.fedThreshold: 40            mortality.herbRelief: 1
mortality.tendMultiplier: 2           mortality.graveEnabled: true
illness.dailyWorsenChance: 0.25*      illness.contagionChance: 0.06* (PENDING RULING §13)
illness.contagionRadius: 3            illness.contagionEnabled: true* (PENDING RULING §13)
thirst.enabled: true   thirst.decayPerTick: 0.6 × hunger rate*   thirst.drinkRestore: 60
thirst.waterskinCharges: 4
fertility.radius: 3    fertility.waterBonus: 0.5   fertility.maxMultiplier: 1.5   irrigation.enabled: true
roads.enabled: true    roads.stonePerTile: 1       roads.paveDurationTicks: 6
desirePaths.enabled: true   desirePaths.wearThreshold: 120*   desirePaths.decayPerDay: 0.1
desirePaths.regrowThreshold: 30   desirePaths.overgrowDays: 20   desirePaths.pathCost: 0.8
fauna.enabled: true    fauna.caps: {deer: 8, rabbit: 12, fish: 6}   fauna.movePeriodTicks: 4
fauna.fleeRadius: 4    fauna.huntDifficulty: {deer: 3, rabbit: 2}   fauna.fishSchoolBonus: 2
warmth.enabled: true   warmth.ambient: (season × dayPhase table)    warmth.comfortBand: …
warmth.exposureDecayPerTick: 0.3   warmth.heatRadius: 2   warmth.insulation: {garment: 2}
light.enabled: true    light.nightWorkPenalty: 1.5*   light.workRadius: 2
light.torchBurnTicks: 240   light.fuelBurnTicks: 480   light.fireRiskPerTick: 0.0005*
foodVariety.enabled: true   foodVariety.windowDays: 3   foodVariety.bonusPerKind: 0.05
foodVariety.maxBonus: 0.2
regrowth.enabled: true   regrowth.saplingChancePerDay: 0.02*   regrowth.saplingDays: 30
mapGrowth.enabled: true   mapGrowth.step: 16   mapGrowth.structuresPerStep: 12   mapGrowth.maxSize: 192
pathing.maxNodes: 6000   pathing.regionSize: 16   (pathing.roadCost stays C9's)
world.size: {w: 128, h: 128}   (genesis input, not toggleable)
structures.recipes: + well, bridge, grave (grave is engine-placed, never built)
constructs.enabled: true   constructs.minParticipants: 3   constructs.minRecurrences: 2
constructs.windowDays: 7   constructs.types.{festival,faith,council,market,custom}: true
milestones.catalog: (tier-1/2 predicate table as data — extensible without code)
```

## 12. New event vocabulary (all payloads Zod `.strict()`, fold extended; chronicle columns are the C12 render feed — the weights extend C10's `CHRONICLE_WEIGHTS`/`CHRONICLE_ICONS` shared module)

| Event | Payload | Fold effect | Weight | Icon | Chronicle label (human-framed) | Narrator vocabulary / humanizer notes |
|---|---|---|---|---|---|---|
| `agent_harmed` | `{agentId, amount, source, byId?}` | hp − amount | 8 | flame/cross | "\<Name> was hurt." | "hurt", "wounded" — never damage numbers |
| `agent_afflicted` | `{agentId, kind, severity, sourceId?, itemId?}` | affliction added/merged | 8 (illness), 6 (other) | leaf | "\<Name> has fallen ill." / "…was poisoned." | "sickness", "a bad turn" — never mechanics ("severity 2") |
| `affliction_worsened` | `{agentId, kind, severity}` | severity up | 5 | leaf | "\<Name> grows worse." | describe the body, not the model |
| `affliction_recovered` | `{agentId, kind}` | affliction removed | 6 | spark | "\<Name> is on the mend." | may credit visible care ("after days at her side") only when `agent_tended` events exist — detect, never invent |
| `agent_tended` | `{tenderId, targetId, itemId?}` | recovery window (tendedTick) | 5 | heart | "\<A> cared for \<B>." | "sat with", "nursed" — never "healer" as a title unless the town coins it |
| `agent_died` (ext.) | +`cause: DeathCause`, +`byId?` | existing + cause recorded | 20 | cross | per cause: "\<Name> starved." / "…died of thirst." / "…was slain." / "…died old and full of years." | cause is fact; meaning is the town's. `slain` chapters may name the witnessed attacker, never a verdict |
| `grave_placed` | `{agentId, name, x, y}` | grave structure created | 12 | cross | "A grave was made for \<Name>." | tone rule: stillness; epitaphs quoted verbatim if inscribed |
| `agent_drank` | `{agentId, source, itemId?}` | thirst restored, charge spent | — | — | not chronicled | routine bodily acts stay out of the feed |
| `item_filled` | `{itemId, charges}` | charges set | — | — | not chronicled | |
| `fire_extinguished` | `{x, y, agentId, structureId?}` | burning cleared, bucket emptied | 9 | flame | "\<Name> beat back the fire." | firefighting prose earns names — it was witnessed work |
| `tile_changed` | `{x, y, from, to, reason: 'paved'\|'worn'\|'overgrown'\|'channel'\|'seeded'\|'grown', byId?}` | terrain cell set; region cache + chunk dirtied | 4 (paved/channel), 0 (rest) | road | "\<Name> laid a stretch of road." / "A channel now carries water to the fields." | worn paths are never chronicled — they are noticed by viewers, which is the point |
| `world_grown` | `{edge, depth, tiles}` | map extended, arrays resized | 15 | star | "The world is wider than it was." | never explain why; the humanizer keeps it felt, not mechanical |
| `item_equipped` / `item_unequipped` | `{agentId, itemId, slot}` | equipped set/cleared | — | — | not chronicled | perception prose: "wrapped in a rough cloak" |
| `item_lit` / `item_snuffed` / `item_burned_out` | `{itemId, burnsUntilTick?}` | lit state / consumed | — | — | not chronicled | |
| `structure_fueled` | `{structureId, burnsUntilTick}` | fueled window | — | — | not chronicled | |
| `fauna_spawned` | `{id, kind, x, y}` | fauna added | — | — | not chronicled | |
| `fauna_moved` | `{moves: [{id, x, y}]}` | positions applied | — | — | not chronicled | |
| `fauna_killed` | `{id, kind, byId?, x, y}` | fauna removed (+ item_spawned rides separately) | 5 | spark | "\<Name> brought down a deer." | firsts ledger catches the first hunt; never "gained venison ×2" |
| `forageable_spawned` / `forageable_depleted` / `forageable_regrown` | `{id, kind?, x?, y?, stock?}` | node added / stock 0 / stock reset | — | — | not chronicled | perception: "the berry bushes are picked bare" |
| `agent_expressed` | `{agentId, verb, targetId?, x, y}` | none (pure witness record) | 2 | spark | "\<Name> danced." (label from the coined verb) | describe, never classify — "sang by the fire", never "performed a ritual" unless the town said so |

Ops-plane (arbiter/narrator DBs — never in the world log or state hash): `construct_recognized`, `construct_named`, `construct_recurred` (§10.2) and milestone rows (§10.3) surface in the chronicle at weight 16 with observer-voice labels ("The town held its first festival — they call it \<name>"; unnamed: "a gathering not yet named"), icon `star`.

Payload extensions: `agent_died` +`cause`+`byId?` (optional → old logs parse). Every chronicled row above also gets narrator heat-scoring eligibility; the §10.3 milestone framework is the systematic home for firsts — the narrator's existing ledger extends rather than competes.

## 13. OPEN QUESTION — illness contagion at genesis (PENDING USER RULING)

| Option | Behavior | Risk/payoff |
|---|---|---|
| **A. On, low dial (controller default)** ◀ | `illness.contagionEnabled: true`, `contagionChance: 0.06` | Plague arcs possible but slow; tend/herb/quarantine-by-choice emergence live from day 0; a wipe of a 5-person town is unlikely but not impossible |
| B. Off at genesis, flip later | `contagionEnabled: false`; operator flips the world-law toggle once population > ~10 | Zero early-wipe risk; costs the young town its most dramatic shared threat; the flip is an operator act, mildly against "world runs on physics alone" |
| C. On, medium dial (0.12) | Faster spread | Real wipe risk at population 5; not recommended before newcomers flow (C8) |

Either way the dial and flag are world-law toggles — the ruling sets the genesis value only.

## 14. Determinism & replay

- New named RNG streams: `illness`, `fauna`, `regrowth`, `forage`, `worldgen` (+ existing `combat`/`fire` reused). All rolls at event emission, recorded in payloads; `fold(events)` stays pure and RNG-free.
- The construct recognizer and milestone framework (§10.2/§10.3) are ops-plane: LLM-classified, non-replayed by design (same class as narrator output), never in world state or the hash. `agent_expressed` is the only world event §10 adds, and it folds to nothing. `constructs.*` config flips ride `config_changed` for one dashboard + replayable history, but no world physics reads them.
- Fully deterministic (zero rolls): thirst/warmth/light clocks, hp drains, desire paths, traffic, fertility, pave/channel, bridges, graves, map-growth *trigger* (the strip content rolls `worldgen`).
- Every flag/dial in §10 marked or listed flows through `config_changed` world-law events (C9 §19 machinery — C11 adds paths to `TOGGLABLE_PATHS`, invents no new mechanism).
- `world_grown` carries its terrain in the payload — replay from genesis and from any snapshot reproduces the identical map without re-rolling.
- Golden regen: one deliberate event, its own plan task (C9 §15 law).
- Fauna and forageables live in world state and the state hash; ambient fauna (C12) never do.

## 15. Boundary statements (no duplication)

- **C9 owns** (C11 touches nothing): interiors/occlusion, ownership/theft, reproduction/birth, spoilage mechanics (C11 only *reads* the existing spoiling window for poison), tool wear, inscription (graves reuse it), mysteries, world-law machinery, BudgetGuard fix, arbiter wiring, SPEECH_RULES. The mortality model *replaces* C9 §11's death-of-old-age loop closure with a superset — `cause:'old_age'` keeps its shape.
- **C10 owns**: tileset render pipeline, showcase map fixture, chronicle panel, bonds, moments, interiors rendering, status strip. C11 hands C10-shaped surfaces new data only (new TileIds, chronicle rows).
- **C12 consumes** the shared interface list below; ambient fauna, all art for §9's content pool, and every pixel of the systems above are C12's.
- **C8**: genesis fixture authoring moves to the C11 map/town module; C8's rehearsal runs on the 128×128 genesis town; founder kit ownership uses C9 §2. Edit list for C8's draft goes in the C11 plan's audit task.
- **C7**: the milestone framework (§10.3) *extends* `NarratorStore`'s firsts ledger via schema migration (tier/domain/provenance columns; existing rows backfill as tier 1) — no rival registry. C10's `/api/milestones` shape extends additively.
- **Declared C9-interface requirement** (for the C9 plan's audit list): T11/T12 relationship rows must expose partnership **dissolution** as a queryable transition (formed/dissolved ticks, not just current state) — tier-2 "first breakup" detection depends on it.

## 16. Shared C11 → C12 interface list (binding; declared identically in the C12 addendum)

**Events (world):** `tile_changed`, `world_grown`, `agent_harmed`, `agent_afflicted`, `affliction_worsened`, `affliction_recovered`, `agent_tended`, `grave_placed`, `agent_drank`, `item_filled`, `fire_extinguished`, `item_equipped`, `item_unequipped`, `item_lit`, `item_snuffed`, `item_burned_out`, `structure_fueled`, `fauna_spawned`, `fauna_moved`, `fauna_killed`, `forageable_spawned`, `forageable_depleted`, `forageable_regrown`, `agent_expressed`, `agent_died.cause/byId` (extension).
**Events (ops-plane):** `construct_recognized`, `construct_named`, `construct_recurred`.
**State/types:** `AgentBody.hp/thirst/afflictions/equipped`, `WorldState.fauna/forageables/traffic`, `TileId 8|9|10`, `FaunaKind`, `ForageableKind`, `AfflictionKind`, `DeathCause`, structure kinds `well|bridge|fire_pit|grave`, `ConstructSchema`, `MilestoneRow` (tiered extension of C7 milestones).
**Pure functions/consts (`@sj/shared`):** `fertilityAt`, `CHUNK_TILES`, `chunkOf`, widened `terrainCostFor`.
**Chronicle:** the §12 weight/icon/label rows (extend `CHRONICLE_WEIGHTS`/`CHRONICLE_ICONS`) + weight-16 observer-voice construct/milestone entries.
**Data surfaces:** traffic grid read-only for C12's heat overlay (C12 owns `/api/overlays/traffic`); construct registry read-only for C12's panel (C12 owns `/api/constructs`); `/api/milestones` extended shape (tier/domain/provenance, additive on C10's); fertility computed client-side via `fertilityAt` (no endpoint).

### A8 amendment additions (2026-08-16 evening ruling round — identical block in C11 §16 and C12 §1)

**Pure functions/consts (`@sj/shared`):** `lightLevelAt`, `visionRadiusAt`, `LIGHT_GLOW_RADIUS` (C11 §19 — C12 renders glow pools and dark-vignette from the same constants the physics uses).
**Perception field (agent-visible, diegetic):** perception packet `light: 'bright'|'dim'|'dark'` (C11 §19).
**Config (world-law, `TOGGLABLE_PATHS`):** `nightWitness.enabled` / `nightWitness.nightFactor` / `nightWitness.duskFactor`, `light.glowRadius.{torch,lantern,hearth,fire_pit}`.
**Ops-plane rows/types (narrator DB):** `semantic_first_detected` (`SemanticFirstRow`, C11 §20), `semantic_candidates`; `MilestoneRow.tier` widened to `1|2|2.5|3`; `arcs` + `arc_episodes` tables (`ArcRow`, `ArcEpisodeRow`, C12 §27); `lexicon` rows (`LexiconRow`, C12 §28).
**Ops config (narrator/gateway-side, not world-law):** `semanticFirsts.*` (C11 §20), `arcs.*` (C12 §27), `lexicon.*` (C12 §28), `study.publicData` (C12 §29), `broadcast.*` (C12 §25).
**Endpoints/routes (C12-owned, read-only):** `/api/arcs`, `/api/lexicon`, `/api/conversations`, `/api/agents/<id>/memory`, `/api/agents/<id>/heatmap`, `/api/study/export` (admin-token), `/data` (public study page, flag-gated), `/broadcast` route.
**Viewer contracts:** character-dock mood-derivation table over the 7-expression portrait sets (C12 §25, extends §11 `moodOf`); clip export WebM+GIF (C12 §26, ruled).
**C13 parallel-lane shared additions (manifest/schema only — C13 addendum):** `TilesetManifest.autotile` block (15-tile dimetric road connection set) + `roadAutotile(neighbors)` pure fn (`@sj/shared`); `FurnishingKind` widened by the furniture library + codex `meta.interior` placement fields (consumed by C10 T10/T11).

## 17. What is deliberately NOT authored (consolidated)

Funerals, mourning customs, inheritance, justice for the slain; medicine as institution, quarantine rules, healer as role; water rights, drought rationing; town planning, road ownership; hunting rights, husbandry; dress codes; curfews; cuisine as culture; land value as law; festivals, faiths, councils, markets, weddings, and every other construct — the engine gives tools and anchors, the arbiter labels *types* after the fact, and only the town coins names. Labelling never causes behavior. The engine prices things; the town decides what they mean.

## 18. GATE G11 — outline (C9 G9 style; full protocol written with the plan)

**G11a — deterministic scripted suite** (non-LLM actors, headless, $0):
- Thirst clock: an actor denied water dies on schedule under forced dials, `agent_died{cause:'thirst'}`; a drink resets the clock; well and waterskin sources both work.
- Mortality: pale-mushroom poison → affliction → tend + herb recovery; untreated illness worsens to death (`cause:'illness'`); scripted attack → injury → death `cause:'slain'` with `byId`, witnessed by a third actor; grave placed at the death tile; fatigue ladder kills a sleep-deprived actor; every cause in `DeathCause` produced at least once across the suite.
- Contagion: forced-high dial spreads across an interior; radius and interior rules honored; flag off → zero spread.
- Water works: fill → douse extinguishes a scripted fire; dig_channel raises `fertilityAt` and a harvest yields the multiplier exactly; a bridge completes over water and `findPath` crosses it at road cost.
- Roads: pave converts the tile and consumes stone; scripted walking wears a grass tile to path at exactly the threshold; an unused path overgrows on schedule; path/road costs ordered grass > path > road in `findPath` choices.
- Fauna: deer flees inside `fleeRadius`; hunt succeeds/fails per forced rolls; `fauna_killed` spawns venison + hide; fish-school bonus measurably raises catch rate; caps + daily regen honored; winter halving honored.
- Warmth/light: a cold night drains an unclothed outdoor actor to collapse while a clothed/hearth-side/indoor actor is untouched; night work penalty applies without light and not with a lit torch; a forced fire-risk roll ignites; torch burns out on schedule.
- Variety/regrowth: 3-kind diet beats monotony by the exact bonus; sapling → forest cycle completes; chopped sapling clears.
- Map: genesis 128×128 fixture folds; forced `world_grown` extends the map, resizes traffic, replays identically from genesis AND from a pre-growth snapshot (state hash equality); chunk-dirty list for a `tile_changed`/`world_grown` matches `chunkOf` exactly.
- Perf (gate line): on 128×128 with 12 agents + full fauna caps, median tick compute < 50 ms, p99 < 250 ms; a worst-case corner-to-corner path respects `pathing.maxNodes` and returns a usable partial; region cache invalidation correct after a mid-run pave.
- World laws: ≥ 2 C11 flags flipped mid-run via `config_changed`; behavior changes next tick; replay reproduces the flips; non-whitelisted path rejected.
- Constructs + milestones (scripted): an expressive verb adjudicated once then reused by a second scripted actor at zero LLM cost, `agent_expressed` witnessed per earshot/sight rules; the recognizer over an authored fixture stream (3 recurring gatherings + one spoken name) yields exactly one registry row, correctly typed, name matching the quoted utterance with correct provenance; a no-utterance fixture yields `name: null`; tier-1 firsts fire exactly once each (incl. one first-death-per-cause pair); tier-2 breakup fires on a scripted partnership lapse; `constructs.enabled` off → zero rows; **one-way glass scan:** no construct/milestone vocabulary in any prompt assembly across the suite.
- Golden regen: single deliberate event, green before/after.

**G11b — 2-sim-day live run** (5 minds on the genesis town, hard USD cap):
1. Zero crashes; tick budget held on 128×128 for the full run.
2. At least one mind drinks unprompted (thirst debuff → act); at least one forage/hunt/fish yields food that gets eaten.
3. A staged affliction (seeded fixture, day-zero ill founder) draws a visible response — tend, herb, or witnessed avoidance; recovery or death both pass, silence fails.
4. Chronicle shows only human-framed labels for every C11 event that fired (banned-vocabulary scan: no "hp", "severity", "affliction", "config").
5. Desire-path traffic accumulates along the real walking routes (≥ 1 tile crosses threshold under a dialed-down threshold for the window).
6. World Laws panel lists every C11 flag; one operator flip mid-run lands as `config_changed` and replays.
7. Spend ≤ cap + one reservation (C9 guard); zero lost reflections.
8. Constructs live: ≥ 1 expressive verb adjudicated live and reused by a *different* mind at 0 arbiter calls; the recognizer's daily pass runs clean; tier-1 milestones from the run appear in the extended ledger; IF a construct is recognized, its viewer copy obeys the naming law (a two-day window cannot force one — recognition is conditional, the machinery running is not).

## 19. Night-witness / light coupling (A8 ruling round, 2026-08-16 evening — extends §6)

The mechanical prerequisite for night crime and lantern deterrence (ledger A8.2): witness/vision
radius for sight-class perception — `visible.agents`, the `seen` channel's witness records
(`item_taken`, `attack`, `agent_expressed`, and every witnessed world event generally) — scales
with darkness and nearby light sources. Dark tiles shrink the witness radius; a lit lantern,
torch, hearth, or fire pit restores it locally. The engine prices *visibility*; it never authors
crime, guard duty, or curfews — whether anyone exploits the dark or hangs a lantern against it
is the town's business.

| Mechanic | Rule |
|---|---|
| Darkness factor | Deterministic from the sim clock: day `1.0`, dusk/dawn `nightWitness.duskFactor` (default 0.7), night `nightWitness.nightFactor` (default 0.35). No RNG, no weather coupling in v1 (deliberate — storms dim mood via §6/C12 grading, not physics; logged below). |
| Light sources | Exactly §6's lit set: a lit `torch`/`lantern` (held or dropped; `item_lit` and not yet `item_burned_out`/`item_snuffed`) and a fueled `fire_pit`/hearth (`structure_fueled`, within `burnsUntilTick`). Glow radii per kind: `light.glowRadius` `{torch: 3, lantern: 5, hearth: 3, fire_pit: 4}` (Chebyshev, from the item tile / structure footprint edge). Lantern stays arbiter-territory (§6) — day-0 deterrence is torch and hearth; the brighter lantern is something the town earns. |
| `lightLevelAt(state, x, y, tick)` | Pure function (`@sj/shared`): `1.0` during day; at dusk/night, `1.0` when `(x,y)` is within the glow radius of any lit source, else the phase's darkness factor. |
| Witness rule | A sight-class target (agent, or the tile of a witnessed event) at `(x,y)` is visible to viewer V iff `dist(V, (x,y)) ≤ round(baseSightRange × lightLevelAt(state, x, y, tick))` — `visionRadiusAt(state, viewer, x, y, tick)` exported. **Light at the TARGET tile restores visibility, not light at the viewer:** a torch does not let you see into the dark — it lets the dark see you. A thief carrying a lit torch is lit, and so is the theft; a lantern hung by the storehouse keeps its tiles bright, so theft there is witnessed at full day radius. That asymmetry IS the deterrence mechanic. |
| Earshot | Unchanged, deliberately: sound carries at night. A scream in the dark is heard and not seen — exactly the story shape the arc detector (C12 §27) threads. |
| Interiors | §1 occlusion is unchanged and outranks this law (walls block sight regardless of light). Within an interior at night: hearth lit → co-occupants see the whole room; unlit → the darkness factor applies to the interior's internal distances. The doorway-eavesdrop rule (§1) is hearing and stays light-independent. |
| Perception prose | The perception packet gains `light: 'bright' \| 'dim' \| 'dark'` at the agent's own position, rendered diegetically ("the night is close around you"; "the fire throws a circle of light"). Never a mechanics number. |
| Determinism | Fully deterministic — pure functions over state and clock, zero rolls. Witness composition already recomputes from state on replay; nothing new is recorded. |

Config (world-law pattern, §11 conventions; flags + starred dials whitelisted in `TOGGLABLE_PATHS`):

```
nightWitness.enabled: true      nightWitness.nightFactor: 0.35*   nightWitness.duskFactor: 0.7
light.glowRadius: {torch: 3, lantern: 5, hearth: 3, fire_pit: 4}
```

`nightWitness.enabled: false` → `lightLevelAt` returns 1.0 always (day rules around the clock); §6's night-work penalty is independent and keeps its own flag.

**G11 additions (G11a):** a scripted night theft at distance 6 goes unwitnessed where the identical day theft is witnessed; the same night theft beside a fueled fire_pit (within glow radius) is witnessed at full radius; a torch-carrying actor is visible at full radius at night while an unlit actor at equal distance is not; interior hearth-lit vs unlit visibility per the table; flag off → night behaves as day; replay reproduces identical witness sets. **(G11b):** at least one night tick shows `light: 'dark'` prose in a real perception log.

Deliberately NOT authored: night watch, curfews, guard rotas, "crime". The dark is a price change, not a plot.

---

## 20. Tier 2.5 — semantic firsts: the concept-emergence detector (A8 ruling round — extends §10.3's framework)

§10.3's tiers 1–3 detect *events, patterns, and constructs*. Tier 2.5 detects **concepts**: the
first time a mind's own words cross a threshold no event schema can see — god, death-fear, love,
justice, humor, metaphor, deceit, foresight, history. This is the study core (ledger A8.1): the
root spec §9 already names "first lie" in the firsts ledger; tier 2.5 is that promise made
systematic. Detection is an **ops-side LLM pass over speech + thought transcripts — narrator-side,
agent-invisible**. One-way glass and the naming law bind exactly as at every other tier.

### Detector contract

- **When:** part of the nightly narrator batch (after chapters), one batched pass over the day's `agent_spoke` utterances, turn `thought` fields, and journal entries. Only concepts **not yet detected** are scanned for — the catalog shrinks as firsts land, so cost decays toward zero.
- **Concept catalog** (`semanticFirsts.concepts`, data not code, extensible): `god_afterlife` (first thought/speech about a god, spirits, or what follows death), `fear_of_death`, `love_expression`, `justice_claim` (a fairness/desert assertion — "that was not right", "she earned it"), `joke` (intended humor, not accidental), `metaphor` (a thing described as another thing, beyond stock idiom), `lie` (contract below), `multi_day_plan` (a stated intention naming a future day or season), `past_reference` (an utterance recalling a specific shared event ≥ 2 sim-days old — "remember when…").
- **Verdict schema** (Zod `.strict()`, structured output): array of `{conceptKind, agentId, day, sourceKind: 'speech'|'thought'|'journal', eventSeq|memoryRef, quote, quote2?, provenance2?, confidence: 0..1, rationale}`. **Hallucination guard:** every `quote` must string-match the source transcript verbatim (validated mechanically, same class as C7's chapter event-id citation law); a non-matching quote voids the candidate.
- **Threshold:** `semanticFirsts.minConfidence` (default 0.8); below it the candidate is logged (`semantic_candidates` table) but is not a milestone. First accepted hit per conceptKind → `semantic_first_detected` ops-plane row; later hits per concept are recorded as recurrences, never re-milestoned.

### The LIE contract (spec'd carefully — drama + study gold, and the easiest to get wrong)

A lie is detected **only** when we hold both sides of the glass in contradiction:

1. **Both sides quoted:** a speech utterance AND the same agent's contemporaneous thought, memory, or journal entry, contradicting on the same claim. The verdict must carry verbatim provenance for BOTH (`quote` = the speech, `quote2` + `provenance2` = the inner record). One-sided suspicion is never a lie.
2. **Same topic window:** the inner record must be from the same conversation scene or within ±`semanticFirsts.lieTopicWindowTicks` (default 120 ticks = 2 sim-hours) of the utterance, or a same-day journal/memory row citing the same entities. The contradiction must be about the **same claim** (entity + predicate), not the same general subject.
3. **Ordering:** the inner record must be contemporaneous with or precede the speech. A thought that changes *after* speaking is a change of mind, not a lie.
4. **Exclusions:** irony/sarcasm and jokes (a `joke` hit on the same utterance voids the lie candidate), politeness formulas, self-deception (no contradicting inner record exists), honest error (the inner record agrees with the speech even if both are false against world state — the detector compares the agent against *itself*, never against ground truth; being wrong is not lying).
5. **Higher bar:** `semanticFirsts.lieMinConfidence` (default 0.9).

Viewer copy renders both quotes side by side — "said one thing; thought another" — with the
observer-voice milestone line. "Lie" is observer taxonomy (root-spec §9 vocabulary), never
injected into any prompt; the town gets no word for it until it coins one.

### Cost model, config, laws

- **Batched daily pass:** ~5 minds × ~200 utterances+thoughts/day ≈ 40–60k tokens through the narrator model → ≈ $0.01–0.02/sim-day at deepseek-v4-flash pricing, decaying as the catalog empties. Cap: `semanticFirsts.dailyBudgetUsd` (default 0.10); on cap the pass skips with an ops alert (never silently dropped).
- **Config** (narrator-side ops config — NOT world-law events, per the C12 presentation-flag ruling; no world physics reads any of it): `semanticFirsts.enabled: true`, `concepts` (catalog data), `minConfidence: 0.8`, `lieMinConfidence: 0.9`, `lieTopicWindowTicks: 120`, `dailyBudgetUsd: 0.10`.
- **Registry:** hits are milestone rows at **tier 2.5** — `MilestoneRow.tier` widens to `1 | 2 | 2.5 | 3` (additive; existing rows untouched). Every hit = high-weight chronicle entry (weight 16, observer voice: "For the first time, someone in the town spoke of a god." / "For the first time, one of them said one thing and thought another.") + share-card material (C12 §18) + Milestones panel row (C12 §16) with jump-to-moment and the provenance quote(s).
- **One-way glass:** the detector reads transcripts and writes narrator tables only; no output ever enters a prompt, perception, or memory. The banned-vocabulary gate scan extends to the concept taxonomy. **Naming law:** the detector labels concept *types* (observer vocabulary, exactly like construct types); the town's own words appear only as verbatim quotes with provenance.
- **Determinism:** ops-plane, LLM-classified, non-replayed by design (same class as the §10.2 recognizer and narrator output); never in world state or the hash.

**G11 additions (G11a, fixture-driven):** an authored transcript fixture containing one planted god-reference, one clean lie (both sides present, in-window), one change-of-mind (thought postdates speech), and one honest error (inner record agrees) yields exactly two hits (god, lie) with verbatim-matching quotes on both lie sides; a fabricated-quote fixture response is voided by the string-match guard; `semanticFirsts.enabled` off → zero rows; one-way-glass scan clean over the suite. **(G11b):** the nightly pass runs clean within budget on the live run; IF any hit lands, its viewer copy carries the provenance quote (conditional, like the construct line — the machinery running is gated, the first god is not schedulable).

---

## 21. Deliberate non-features (drama preservation — A8.6, recorded verbatim so future planners don't "fix" it)

**No paired atomic `trade` verb — exchange stays give+speech, so trust asymmetry (and betrayal)
exists; haggling and theft-after-a-deal are possible BECAUSE trade requires trust.** (Ledger
A8.6, user-accepted 2026-08-16 evening.)

The temptation this section exists to kill: some future planner sees two `give` events and a
speech log standing in for "a trade" and adds an atomic `trade {give, receive}` verb "for
robustness." That verb would make betrayal *impossible by construction* — the engine would
guarantee the exchange, and with it delete haggling drama, the half-paid debt, the seller who
takes the bread and walks, and the night-theft-after-a-deal arc (§19 + C12 §27) the whole A8
round exists to enable. The gap between promise and delivery is not a missing feature; it is
the entire market for trust, reputation, and the town's first commercial custom. Base-spec §1
already rules `give` "the only built-in exchange primitive" — this section records that the
ruling survived explicit re-examination under the A8 mandate and is closed, not pending.

---

## Deviations & assumptions (logged, not silently decided)

1. Cold kills via the fatigue ladder, not a `freezing` cause — the ruled cause list (A1) is closed; this keeps it closed while giving cold real teeth.
2. No corpse object / burial verb in v1: `grave_placed` fires at the death tile automatically. A `bury` relocation verb is arbiter territory.
3. Poison-from-spoilage uses C9's existing final-day `spoiling` window — C9's spoilage system text is unamended.
4. `fauna_moved` is batched per movement beat to protect log volume; the render feed and determinism are unaffected.
5. Fertility is a pure distance function (`fertilityAt`), not stored per-tile state — cheaper, hash-free, and the C12 overlay computes it client-side.
6. Bridge is a structure that grants passage (the sole inversion of structure blocking) rather than a tile — keeps `world_tiles` water truth intact and gives C12 a normal structure to render.
7. Map growth triggers on completed-structure count (visible, earned) rather than population — births (C9) would make population a lagging, noisier signal. Dial swap is a config edit if ruled otherwise.
8. `constructs.*` config rides the world-law event machinery even though no world physics reads it — one dashboard, one panel, replayable history; the registry itself stays ops-plane. The recognizer's LLM classification is non-replayed by design (narrator class), while its *inputs* (heuristic candidates) are deterministic.
9. Milestone detection extends `NarratorStore` (C7) rather than living in the arbiter, except tier 3 which the recognizer feeds — one registry, two writers, both ops-plane.

---

## CONTROLLER REVIEW RULINGS (2026-08-16 pm2)

1. **Cold death → cause `exposure` (deviation 1 PARTIALLY overruled):** keep the fatigue-ladder
   MECHANICS exactly as spec'd (no separate freezing system), but when cold is the dominant
   driver of the fatal ladder, `agent_died.cause` stamps `exposure`, not `fatigue`. Rationale:
   the milestone framework promises "first death per cause" in the observer voice — "froze on
   a winter night" and "worked themselves to collapse" are different stories. `DeathCause`
   gains `exposure`; chronicle/narrator vocabulary entries required. (User may veto at spec
   review.)
2. **Deviation on presentation flags ACCEPTED:** C12 presentation toggles live as viewer
   settings + ops config, NOT world-law events — world-law machinery for read-only surfaces
   would violate the read-only law.
3. **Deviation 8 ACCEPTED:** `constructs.*` config rides the `config_changed` world-law
   machinery (one dashboard, replayable history) even though fold ignores it.
4. **G11b conditional gate line ACCEPTED:** machinery-runs + conditional copy check; the first
   real festival lands post-gate by nature.
5. Cross-draft notes landed: C9 T11/T12 dissolution requirement (C9 draft AMENDMENT pm2);
   C10 Task 2 bake supersession seam (C10 draft AMENDMENT pm2).

---

## AMENDMENT LOG — A8 ruling round (2026-08-16 evening)

Under the A8 rulings (ledger §A8 + §D: broadcast = core v1, clips = WebM+GIF, C13 = new
parallel chunk, study = full pack), this addendum was amended. Existing sections §1–§18 are
untouched and unrenumbered; changes are strictly additive:

1. **§19 added — Night-witness / light coupling.** Sight-class witness radius now scales with
   darkness and local light (integrates §6's lit set). Why: ledger A8.2 names it the mechanical
   prerequisite for night crime and lantern deterrence — without it the ruled story-arc product
   (C12 §27) cannot produce its flagship "haggled at noon, stole at night" arc. New config
   `nightWitness.*` + `light.glowRadius`; new shared pure fns `lightLevelAt`/`visionRadiusAt`;
   perception packet gains `light`; G11 gate lines added inline in §19.
2. **§20 added — Tier 2.5 semantic firsts.** Extends §10.3's three-tier framework with an
   ops-side LLM concept-emergence detector over speech+thought transcripts (god/afterlife,
   death-fear, love, justice, joke, metaphor, lie, multi-day plan, past reference). Why: ledger
   A8.1 — the study core; root spec §9 already promised "first lie". `MilestoneRow.tier` widens
   to `1|2|2.5|3` (additive). Lie contract, cost cap, hallucination guard, and gate fixtures
   spec'd inline; one-way glass + naming law restated as binding.
3. **§21 added — Deliberate non-features.** A8.6 recorded verbatim: no atomic paired `trade`
   verb, ever — give+speech IS the exchange economy; the trust gap is the drama. Closed, not
   pending.
4. **§16 extended** with the "A8 amendment additions" shared-interface block, declared
   identically in the C12 addendum §1 (night-witness fns/config, tier-2.5 rows, C12 arc/lexicon/
   study/broadcast surfaces, C13 manifest additions).
5. **Deviations added (this round):** (10) weather does not modify the darkness factor in v1 —
   phase-only keeps §19 a two-dial law; a storm-gloom coupling is a one-line dial later if
   ruled. (11) Target-tile lighting (not viewer-side) governs visibility — chosen deliberately
   so carrying a torch exposes the carrier; the asymmetry is the deterrence mechanic, logged
   here because it will read as a bug to anyone who expects lantern-as-flashlight. (12)
   `semanticFirsts.*` is narrator-side ops config, not world-law events — consistent with
   controller review ruling 2 (presentation/ops flags stay out of the world log).

## POST-REVIEW USER RULINGS (2026-08-16 evening, final round — binding)

1. **Genesis huts: 5, OWNED (C13 deviation 2 RESOLVED, supersedes §9's 3-hut line):** the city
   template ships 5 starter huts, one per founder, each with `owner = <founderId>` at genesis.
   RIDER (user, verbatim intent): "we need building/item ownership or public buildings/items —
   make the huts owned by the agents." Consequence: STRUCTURE OWNERSHIP is formalized —
   `Structure.owner: agentId | null` (null = PUBLIC: storehouse, well, fire pit, plaza,
   bridges, roads). Craft/build sets owner = builder; genesis assigns as above. Ownership is
   mechanics, not morals: sleeping/entering another's hut stays LEGAL (sleep law checks kind +
   indoors only) but is a witnessed fact on an owned structure — intrusion drama emerges, is
   never forbidden. C9's item-ownership task must confirm the structure half or C11 §1/§9
   picks it up (plan-audit item).
2. **Contagion at genesis: ON, low dial** (§13 PENDING RULING resolved — keep spec defaults).
3. Tier `2.5` storage: REAL/text in the C7 migration (controller ruling confirmed).
4. Facing-law narrowing ACCEPTED (vision pre-filter may flag/reject; masters human-final).

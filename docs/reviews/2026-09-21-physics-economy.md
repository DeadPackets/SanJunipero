# Physical choices and the town economy

Source-only audit, 2026-09-21, `codex/viewer-experience`. No simulation, production, paid model calls or tests were run for this audit. Effective live settings and observed activity below come from [the minds report](2026-09-21-minds-visibility.md), not a fresh server query. The short production sample cannot establish long-run scarcity, occupations or economic stability.

## Verdict

The world already has meaningful physical constraints: stock, materials, production chains, ownership, food preservation, weather, fuel, shelter, construction work and solid building footprints. Replacing the engine or adding a market simulator is not justified by this review.

The larger limitation is that a new place or product does not automatically gain a useful role. A pub can exist, host people and cook existing food. Its invented ale does not automatically become drinkable; its proprietor does not acquire an order, price or delivery system. Repeated livelihoods need a small set of useful, reusable capabilities and commitments that lead to actual transfers. More chores alone would make watching worse.

## Effective pacing

The production report records three real seconds per simulation minute, hunger decay `0.01`, awake energy decay `0.065`, day-sleep threshold `60`, fuel duration `480` ticks and needs-caused mortality disabled. These override some library defaults. The following are arithmetic estimates from those settings, not observed resident routines.

| Process | Effective value | Real time at speed one |
|---|---|---|
| One simulation day | 1,440 ticks | 72 minutes |
| Awake energy from 100 to 60 | About 615 ticks, before modifiers | About 30.8 minutes |
| Hunger from 100 to zero without eating | 10,000 ticks, non-winter baseline | About 8.3 hours |
| One bread's maximum hunger restoration | 60 points, before clamp/food variety | Equivalent to 5 hours of baseline decay |
| Wheat maturity | Eight simulation days | 9.6 hours |
| New building plot interval | Ten simulation days | 12 hours |
| House construction | 240 work ticks | 12 minutes of uninterrupted single-worker work |
| Cottage / farmhouse construction | 6,480 / 8,640 work ticks | 5.4 / 7.2 hours before modifiers or extra workers |
| One fuel unit | 480 ticks | 24 minutes |

Thirst uses `0.8 × hungerDecay`; food restoration differs by kind, so berries restore half the bread amount. Sleep recovery and environmental modifiers change actual routines. The house override does not shorten every dwelling recipe. None of these values proves a bug, but their disparity matters: a viewer can see many conversations before one crop matures or another plot becomes available.

Sources: `packages/live/src/liveWorld.ts` (`LIVE_PHYSICS`), `packages/shared/src/config.ts`, `packages/engine/src/systems/{needs,thirst,crops}.ts`, `packages/engine/src/food.ts`, `packages/engine/src/verbs/craft.ts` (`buildTicks`).

## Existing choices worth preserving

| System | Actual consequence | Limit or tradeoff |
|---|---|---|
| Gathering and forestry | Named patches deplete and regrow; chopping changes forest to grass and yields wood; saplings mature later | Generic forest foraging bypasses patch stocks, detailed below |
| Farming and irrigation | Tilling, seasonal planting, crop growth, harvest and channel-fed fertility change output | Planting consumes no seed item; farming is a patient, optional project in the current food economy |
| Crafting | Inputs are consumed; stew needs meat, vegetables, a fueled fire and water; cloth, clothing, planks and torches have practical uses | Standard recipes mostly use fixed work duration; many skill tracks do not create exclusive occupations |
| Shelter and weather | Roofs, bed recovery, fueled hearths, garments and light affect bodies or work; room capacity is real | Moving to the depicted bed or storage spot is presentation/intent, not a second proximity gate for every indoor act |
| Preservation and property | Storage changes spoilage; ownership survives movement; theft can be witnessed; making leaves provenance; giving transfers title | Preservation is keyed to configured kinds, currently `storehouse`, not any room described as a cellar |
| Building and roads | Materials, reserved plots, solid footprints, entrances, work progress, cooperative builders and stone paving are enforced | Plot cadence and slow non-house recipes constrain visible expansion; they are explicit design choices |

Relevant sources: `engine/src/verbs/index.ts`, `engine/src/verbs/{craft,build}.ts`, `engine/src/systems/{forage,crops,spoilage}.ts`, `engine/src/{interiors,path,perception}.ts`, `shared/src/config.ts`. Existing tests describe irrigation (`g11.water.test.ts`), theft/property (`survival.test.ts`), interiors and pathing; they were read, not rerun here.

The minds can see recipes and ingredients, missing-material guidance, nearby sources, food, water, spoilage, ownership, full rooms, beds, hearths and unfinished construction progress. It would be incorrect to say these capabilities are absent from their prompts. `makeables()` does not expose build duration beside ingredient cost, which makes the large house/cottage time difference harder to evaluate before starting. Adding that fact is smaller than adding a planner.

## Physical inconsistencies and their evidence level

### 1. Object and person reach do not consistently respect walls

This is a source-confirmed validation gap, not a production incident reproduced during this audit.

`interiors.sameInterior()` states that people reach one another only from the same side of a wall. `tend` enforces it. However, `adjacentLivingTarget()` checks only coordinates and liveness; `give` uses that helper without a room check. Entry leaves the body's world coordinates at the door and changes `insideId`. Therefore an indoor resident and an outdoor resident at that door satisfy `give`'s spatial validation despite being in different spaces. The completion path also checks only item possession and recipient liveness.

Similarly, `itemWithinReach()` accepts a structure-held item when the actor is anywhere adjacent to that structure's footprint. It does not require the actor to be in that room. `take`, and reachable-food selection for `eat`, use it. `stow` rejects a different room for an actor already indoors, but permits an outdoor actor at any exterior side to put goods into the structure. `submitIntent()` has no general room barrier that repairs these cases.

Deterministic regression cases for a later implementation:

1. Put A inside a house and B outdoors at its door. A holds an item; submit `give` to B. Current validation accepts the different-room transfer.
2. Put food inside a completed house and A beside its rear wall. Submit `take` with the known item ID. Current reach validation accepts it without entry.
3. Put A outdoors beside that wall holding an item. `stow` accepts the house. Existing goods can therefore move through a wall even where no door is present.

Perception often hides these targets, which reduces ordinary occurrence but does not make the physical rule correct: remembered IDs and composed plans still exist. This is separate from theft. Taking someone else's accessible property should remain physically possible and socially consequential.

Smallest intervention: one room-aware item reach rule shared by `take`/`eat`/`stow`, and a same-room check for direct hand-to-hand actions. Decide explicitly whether door-side handoffs are allowed; do not silently permit every wall. Recheck location-sensitive transfers at completion. Preserve open-air containers and ordinary outdoor giving. Add focused different-room and same-room regressions before changing behavior.

Sources: `engine/src/verbs/index.ts` (`adjacentLivingTarget`, `give`, `itemWithinReach`, `take`, `stow`, `tend`, `enter`), `engine/src/verbs/common.ts` (`nearRect`), `engine/src/{intent,interiors}.ts`.

### 2. A forest tile is an inexhaustible seasonal berry source

This is an explicit existing rule with a scarcity inconsistency, not an accidental unreachable branch. `rulesOfBeing.ts` advertises foraging with no node ID when trees are nearby. `forage {}` validates only neighboring forest, then produces the season's berry quantity without consuming stock or changing terrain. Spring yields three berries every 60 work ticks; winter yields none. In contrast, named forage patches consume finite stock and regrow gradually.

A repeat of the same successful empty-parameter action beside unchanged forest therefore keeps producing berries. No test execution is needed to see the missing depletion event, but no claim is made that production residents currently exploit it. At baseline nutrition, the spring output represents up to 90 hunger restoration for three real minutes of work, before clamp, food variety and spoilage. This weakens farming, food trade and travel as necessities.

Smallest intervention if local scarcity is desired: resolve empty-parameter forage to a nearby stocked edible patch through the existing node path. Keep the friendly no-ID command, avoid a new resource scheduler, and retain a clear refusal when no patch has stock. Check old scripted fixtures before removing their forest fallback. If abundant food is intentional for a social town, document and keep it; do not add starvation to manufacture entertainment.

Sources: `engine/src/verbs/index.ts:1692`, `engine/src/systems/forage.ts`, `agents/src/prompt/rulesOfBeing.ts`, `shared/src/config.ts`, `engine/src/food.ts`.

### 3. Deliberate abstractions that should not be reported as defects

- Carrying and storage have no weight or stack-count limit in `Item`, `heldQty`, `take` or `stow`. This avoids hauling chores; adding encumbrance would need a demonstrated viewing benefit.
- Awake energy declines at the same baseline while standing, walking or working. Time already prices labor. Work-specific calorie accounting is not required for believable choices.
- Food's preservation deadline uses its current storage location rather than integrating exposure over time. The source documents this shortcut. It is predictable but not a detailed food-aging model.
- Chopping needs a tree and time, not an axe. Tool wear applies to durable held tools required by codified verbs; it is not a universal durability loop for every activity.
- People are not static obstacles in outdoor pathfinding. Buildings are. Avoiding resident gridlocks is useful; visual overlap is a separate renderer issue.

## Can a pub, store or novel product sustain a livelihood?

There is more capability than “a new texture,” but less than a general economy. The arbiter can create reusable verbs with consumed inputs, held-tool requirements, nearby building/fire requirements, skill checks and bounded outcomes. Outcomes can spawn items, transfer a held item, mark debt-like facts, heal, affect energy/social/warmth, name a place and emit witnessed performance. A musician or craftsperson can therefore have useful repeatable acts today. Do not overlook these existing effect types.

The key boundaries are:

| Intent | Works now | Missing general capability |
|---|---|---|
| Open a pub | Learn/build a roof with hearth, host conversations, cook existing stew, give it away | Novel ale is not automatically edible/drinkable; no generic consumable-use registry or service contract |
| Open a shop | Store owned goods, describe them, give or use codified transfers; theft remains possible | No quantity-aware agreed exchange/order settlement; `give` moves an entire item stack |
| Become a specialist | Gain skill, improve some success chances, teach, leave a crafter mark, perform codified work | Demand, recurring orders and completion evidence are mostly conversational rather than durable physical commitments |
| Invent a product | Spawn a persistent named item and later codify a use | Name/art alone do not add nutrition, vessel charges, warmth, preservation or arbitrary target effects |

No monetary wallet, currency balance or atomic barter primitive was found in the engine/shared schemas and verb paths reviewed. That is not a reason to introduce currency immediately. Two voluntary gifts can implement informal barter; marks and memories can represent debt. They do not ensure that a spoken sale fulfilled both sides. The minds report's promise-to-action gap is therefore economically relevant as well as theatrical.

A minimal next design would reuse those strengths: one bounded item-use definition for a genuinely requested new product, plus a small recorded commitment connecting an agreed good/quantity, recipient and actual transfer. Keep prices and motivations autonomous; avoid stock exchanges, shopkeeper scripts, occupational locks and universal task queues. Venue capability should be attached to a meaningful use, not inferred from its name or generated texture.

See [Forge and operations audit](2026-09-21-forge-operations.md) for the full idea → arbiter → recipe → building → interior → art path and existing safety boundaries. Sources here: `arbiter/src/{verdict,codify}.ts`, `engine/src/{food,state}.ts`, `engine/src/verbs/index.ts`, `shared/src/items.ts`.

## Smallest useful order of work

1. Repair room-aware physical reach. Check different-room giving and rear-wall storage against same-room and outdoor controls.
2. Surface real recipe duration and commitment fulfillment in perception/viewing. Check that a spoken delivery maps to an actual item transfer, not a narrator claim.
3. Decide whether stockless forest food fits the intended social town. Check one closed food loop with current live settings before tuning hunger or yields.
4. Prove one invented product's end-to-end utility, such as a pub serving an actually usable drink. Check ingredients, use effect, ownership, visible result and repeated customer choice.
5. Observe at least eight simulation days for the current wheat cycle. At speed one that is 9.6 real hours; collect completion/refusal counts and actual output/consumption rather than inferring livelihoods from dialogue.

These are recommendations only. No behavior, timing, scarcity, production state or live model policy was changed by this audit.

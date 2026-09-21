# Forge, invention and operations review

Reviewed 2026-09-21 in `codex/viewer-experience`. Local source inspection and mocked tests only. No production changes or paid calls.

## Verdict

Keep the deterministic engine and the invention bridge. The town can already invent a buildable alehouse, raise it, enter it, store things there and talk inside it. The largest gap is the meaning of a venue: an alehouse name and roof texture do not create brewing, serving, buying, opening hours or staff roles. The current bounded effect language cannot invent every missing mechanic.

Before expanding invention, close two operational seams: stop and drain image commissions with the rest of the minds, and make the town-wide spending reservation truly town-wide. These are narrower changes than replacing the architecture.

## A pub from idea to screen

| Step | Existing path | What it guarantees, and what it does not |
|---|---|---|
| Resident proposes an unfamiliar act | `agents/src/runtime/agentRuntime.ts`, `#adjudicateFreeform`; `arbiterSeam.ts`, `buildAgentCtx` | The arbiter receives real inventory, skills, position, visible places and people. It can map to an existing verb, refuse, or propose an attempt. Unknown verbs and `WANTS_DISCOVERING` reach this seam. A failed arbiter call becomes a failed attempt, not fabricated success. |
| The proposal becomes bounded physics | `arbiter/src/verdict.ts`, `OutcomeEffectSchema`; `sanity.ts`; `adjudicate.ts` | Strict schemas and sanity checks reject hollow recipes, impossible ingredients, entity-specific recipes and duplicate existing construction. Precedent reuse avoids paying for equivalent ideas. There is no arbitrary generated JavaScript execution. |
| A new building kind is learned | `arbiter/src/codify.ts`, `emitOutcomeEffects` | `learn_building` writes a `config_changed` event for `structures.recipes.<kind>`. Footprints are 1–4 tiles per axis. Ingredients, roof, hearth and bed are explicit. HP and work duration derive from the footprint/materials. It unlocks a recipe rather than instantly placing a pub. |
| Someone raises it | `engine/src/verbs/build.ts` | The ordinary construction verb uses the new effective recipe, checks resources and placement, and resumes unfinished work. Roads, doors, collision and construction duration still apply. Recent plot/resume guidance fixes already exist and should not be described as missing. |
| The room is usable | `engine/src/interiors.ts`; `engine/src/verbs/index.ts`, `move_inside`, `enter`, `stow`, `take` | Completed roofed kinds support entry, capacity and room identity. Indoor destinations are bed, hearth, table, storage and beside another person. Bed/hearth availability follows the learned recipe. Social interactions cannot cross walls. These are real engine actions, not renderer-only motion. |
| The appearance arrives | `live/src/discoveryArt.ts`; `discoveryCommission.ts`; `forge/src/buildingMaterials.ts`; `forge.ts` | The discovery queues wood and roof material commissions. Accepted images produce base-color, derived normal and roughness maps. Surface prompts explicitly exclude windows, doors and building silhouettes. The Three renderer applies the maps to procedural geometry. Art may fail while the building remains usable with its fallback materials. |
| Other minds learn it | `arbiter/src/adjudicate.ts`, `roster`; `agents/src/runtime/agentRuntime.ts`, perception assembly; effective world recipes | Every mind can receive the active minted-verb roster, and successful building unlocks enter the shared world rules. This is global mechanical availability, not evidence that knowledge spread through a conversation or apprenticeship. |
| Watchers see it | `gateway/src/discoveries.ts`; asset broadcasts; `web/src/render/three/{structures,materials,interiorRoom}.ts` | Discovery facts, building state and accepted art reach the viewer. Unknown roofed kinds receive a generic building and room. Personally authored home profiles are special cases, not a generative building-design system. |

The existing alehouse test in `arbiter/src/codify.test.ts` confirms a 2×2 roofed, hearth-equipped, bedless recipe becomes a folded world rule with derived HP/work. This is not evidence that an autonomous resident has completed the entire idea → successful venue operation → social adoption chain in a live run.

## Where new words stop becoming new functionality

| Gap | Code evidence | Smallest useful next design |
|---|---|---|
| Venue function is mostly roof/hearth/bed plus generic room actions | `learn_building` has no station, service, stock, access or transaction fields. `interiorRoom.ts` uses a fixed furnishing vocabulary and personal-home profiles. | Design one end-to-end venue, such as a shop with real stocked items and accepted exchanges. Derive the minimum reusable affordances from that case. Do not add a general business simulator first. |
| Invented products can exist without being consumable | `spawn_item` creates arbitrary kinds. `engine/src/food.ts`, `isFoodKind` accepts the fixed food registry or crop kinds. The drink verb accepts water sources/vessels. | A discovered drink's name or image must not imply hydration or intoxication. Add tested physical properties only when implementing that actual mechanic. |
| Rich geometry does not emerge from Forge materials | `discoveryArt.ts` commissions only `wood` and `roof` for new buildings. `buildingMaterialPrompt` requests seamless surfaces. The material maps do not encode floor plans or windows. | Separate appearance metadata from physical affordances. A bounded facade/roof/door/window recipe could vary procedural meshes while preserving collision and room semantics. This is a design proposal, not current capability. |
| New knowledge is globally available | `roster()` maps all active rulebook rows, and every runtime assembles it into perception. Building recipes are shared config. | Decide whether public availability is intended. If local learning matters, use witnessed discovery, teaching or a shared public record. Do not silently retrofit a large knowledge graph. |
| Discovery credit can precede a successful first use | Codification persists the rule and calls `onCodified`; the runtime then submits the minted action. World effects occur when that action completes successfully. | Distinguish “worked out a method”, “first successful use” and “first building completed” in the viewer. Avoid showing all three as a single unlock. |

A pub does not require hard-coded friendship, drama or customers. It does require a reason its physical actions differ from standing in a home. Residents can choose whether to use those actions. The simulation should not prescribe the social outcome.

## Operational findings

### 1. Image work is outside the shutdown drain

Evidence: `DiscoveryArtWatcher` and `CastArtWatcher` expose `settle()`. `liveWorld.ts` holds `art` and `faces` inside `attach`, but `stop()` waits for mind work, reflection, narration, recognition and population work only. `stopMinds()` aborts tracked `LlmClient` instances. Forge image requests use their own timeout signals in `forge/src/imageClient.ts` and `characterCommission.ts`, not those clients. The world and operations databases subsequently close.

Consequence: a commission can still finish, bill or attempt to register an asset after shutdown begins. Queued commissions can start after a mind stop because their queues are separate. A late database write can fail and leave incomplete art/accounting. This is a confirmed missing cancellation/drain path in source, not a reproduced production incident in this review.

Check before fixing: hold a fake image response, stop the town, then release the response. Assert no new request starts, any accepted charge is recorded, registration has a valid database lifetime, and shutdown terminates within its declared bound. The existing graceful-mind-stop rehearsal does not cover active Forge work.

### 2. The total spending ceiling is polled, not globally reserved

Evidence: `llm/src/callLog.ts`, `makeBudgetGuard`, queries `sumReserved` and `sumCostUsd` with `WHERE caller = ?`. `liveWorld.ts` passes the same lifetime cap into each caller client, then checks the all-caller ledger every 10 world ticks. `createDiscoveryArt` reads remaining all-caller spend and creates a separate in-memory `BudgetGuard`. Its serial queue only serializes discovery art. Faces use a separate queue.

Consequence: reservations protect concurrent calls within one caller, but they do not jointly reserve the remaining town balance across turn, reflection, narration, arbiter and art. Near a ceiling, several callers and art can spend against the same apparent remainder before the global stop observes the charges. The present ceilings are limits rather than forecasts.

Local reproduction, using an in-memory ledger and no model calls: `makeBudgetGuard(db, 'turn').reserve(0.75, 1, null)` and the same call for `'narrator'` both returned reservation IDs. The ledger held **$1.50 against the intended $1 town cap**. This confirms the cross-caller gap independently of provider timing.

Check before fixing: a mocked near-cap ledger with one turn, one narrator call and one image request held in flight. Assert the combined reservations plus recorded charges cannot exceed the agreed allowance, aside from a documented provider-price reconciliation policy. No paid concurrency probe is needed.

### 3. A daily-budget stop does not automatically resume tomorrow

Evidence: `stopMinds()` latches `stopped = true`, aborts clients and stops the booted minds. The spend observer returns immediately when stopped. There is no corresponding automatic restart in this runtime. Caller-specific rails can recover as their windows move, but a whole-town stop is different.

Consequence: after a global stop, the world can still serve HTTP and advance while minds stay off. Health based on time advancement correctly says the process is alive, but does not prove autonomous activity. The new public usage meter shows aggregate usage, not a verified “minds currently thinking” health state.

Recommendation: retain deliberate operator control for a hard stop, but surface the stop reason and state on the operator view and use truthful public wording. Automatic daily resumption would be a separate policy choice.

### 4. Deferred art has no periodic retry scheduler

Evidence: `watchCastArt` retries its deferred map on a later `onPerson` call. Boot calls `faces.onPerson` for the existing cast. Discovery art removes failed kinds from its in-memory known set, but tries again only when another discovery names them or boot replays learned building recipes.

Consequence: replenishing the budget alone does not guarantee a missing face or surface appears while an otherwise quiet process continues. This is not proof of a deadlock, but it is a retry trigger gap.

Recommendation: one bounded retry tick for pending commissions, sharing the shutdown and budget controls. Do not create a separate worker service unless measured volume demands it.

### 5. Persistence is strong per store, not one atomic multi-store transaction

Existing protection: world ticks and RNG state use the event-store transaction, snapshots support replay, runtime checkpoints save every 48 ticks and at clean shutdown, and `restorableSnapshot` rejects a mind snapshot ahead of the world tick. The previous release fixed container SIGTERM delivery, reflection cancellation and preserving `_ops.db` through fresh-town resets. Those fixes are present.

Residual seam: rulebook insertion/review queueing and the callback that announces discovery operate across arbiter and world stores. Runtime memories, world facts and spending also live in separate SQLite databases. A process death between these steps may leave a newly available rule without its expected public discovery event, or a memory/ledger record around an interrupted world transition. This is a crash-consistency hypothesis based on write ordering, not a reproduced corruption claim.

Check: injected process stops at the few cross-store boundaries, then resume and compare rules, event credit, pending model work and ledger entries. Prefer idempotent recovery of a small number of known facts over distributed transactions or a new database platform.

The owner declined automatic off-server backups. This review does not reintroduce a bucket as a launch requirement. A local filesystem failure can still destroy all colocated SQLite stores. That is an accepted durability tradeoff unless the owner changes it.

## Scale and boundedness

| Area | Existing controls | Remaining practical limit |
|---|---|---|
| Population | Default maximum is 20 minds, and live startup never sets a cap below the founding cast. Birth/arrival paths are bounded. | A raised cap increases model cost, room contention, scenes, memory and prompts. It is not a tested claim of support for hundreds of residents. The existing log warns that a birth beyond the runtime ceiling can have a body without a mind. |
| Land | `mapGrowthSystem` adds one owed edge at midnight, derives new terrain from world coordinates and states “No maximum”. | The land is not hard-capped. The full terrain/world state, snapshots, scans, viewer geometry and path search still grow. Chunked rendering alone does not bound simulation or network memory. |
| Paths | `pathing.maxNodes` defaults to 6,000 and the path code can return capped partial progress. | Large worlds can hit the search budget more often. Measure route completion and repeated refusals before raising it. Current safe placement and resume logic already exist. |
| History | Tick retention prunes selected high-volume event types and thins old snapshots. | Exact fine-grained replay outside retained windows is intentionally limited. Asset history and long-lived narrative/knowledge stores need their own growth measurements. |
| Invention vocabulary | Precedent reuse, sanity checks, retirement after 14 unused sim-days and rehydration of active charters exist. | `roster()` returns all active charters. Many frequently used verbs can still enlarge every mind's input. Novel “items” can outgrow their actual supported properties. |
| Viewers | Default maximum 500, cached snapshot JSON, 1 MiB socket backpressure threshold, drained-viewer resync and scrub throttling exist. | These are safeguards, not a 500-viewer load-test result. Public usage reads now share a 10-second cache. The all-assets preload raises each viewer's initial download/memory footprint. |

This lane measured the local catalog during the frontend work: 208 records, 180 latest named ready assets, 182 catalog/emote/fallback image URLs, 9,345,658 encoded bytes. Selected image dimensions imply about 98.01 MiB decoded RGBA before GPU copies and UI/font extras. This is a current-town measurement, not a sustainable-growth bound.

## Priorities

1. Make art obey stop/drain and record late charges. Verify with a held fake provider response.
2. Make all-caller budget claims atomic, including art. Verify with a near-cap concurrent fake workload.
3. Prototype one functional venue from discovery through repeated resident use. Verify actual inventory/state changes and observer evidence.
4. Make pending art and stopped-mind states observable and recoverable. Verify a rolling-day boundary and a restart.
5. Run long-duration growth and crash-boundary drills. Measure storage, prompt tokens, route failures, idle gaps and model work per resident before raising population/viewer limits.

No rewrite, microservices, generated executable rules or forced social events are justified by this inspection.

## Verification performed

130 existing tests passed across these six files:

- `packages/arbiter/src/codify.test.ts`
- `packages/live/src/discoveryCommission.test.ts`
- `packages/live/src/discoveryArt.test.ts`
- `packages/engine/src/systems/mapGrowth.test.ts`
- `packages/engine/src/interiors.test.ts`
- `packages/llm/src/rails.test.ts`

The first sandboxed run refused the Forge test's local HTTP listener with `EPERM`. The same suite passed with loopback permission. These tests use fake providers. They validate existing positive behavior, not the proposed venue design or all crash/shutdown cases above. The separate two-caller in-memory reservation probe reproduced the global-budget gap without changing tracked code.

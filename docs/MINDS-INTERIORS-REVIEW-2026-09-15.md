# Minds, simulation and interiors review

Decision: keep the existing architecture. Fix the specific connections below before restarting AI minds. Give interiors a visual upgrade after their occupants, speech, lights and contents agree with the world. Do not add furniture physics or a new planner to solve presentation problems.

This is a source review of the live bootstrap, agent runtime, perception and prompts, scene coordination, memory/reflection, engine actions/folding, Orchard construction/expansion, survival rules and interior rendering. Three independent reviews were reconciled with the call sites. Browser inspection covered a real furnished home and the repaired walk. No paid mind run, test suite, typecheck, lint or release gate ran. Findings about provider failures and shutdown are source-confirmed paths, not reproduced live incidents. Production is unchanged; the local town remains scripted with AI minds off.

## What is already connected

| Capability | Actual behavior |
|---|---|
| Enter and leave | Minds receive real doors and capacity; enter/exit changes `insideId` through engine events. |
| Shelter and sleep | Rooms affect warmth; sleeping in a bedded building changes energy recovery. |
| Hearth | Minds receive lit/cold state and can stoke the building's hearth. Fuel affects warmth and cooking. |
| Other people | Indoor occupants participate in perception, hearing, conversation and private-roof interaction. |
| Storage | Structure-held items exist in simulation and are exposed to minds and the Inside panel. |
| Individual furniture | Beds, chairs and tables are not individually addressable engine entities. There is no indoor coordinate system. The viewer chooses positions. |

The central chain is [perception](/Users/deadpackets/workspace/SanJunipero/packages/engine/src/perception.ts:487) → [mind prose](/Users/deadpackets/workspace/SanJunipero/packages/agents/src/prompt/prose.ts:1193) → [enter/exit validation](/Users/deadpackets/workspace/SanJunipero/packages/engine/src/verbs/index.ts:722) → [folded insideId](/Users/deadpackets/workspace/SanJunipero/packages/engine/src/fold.ts:806). [Bed recovery](/Users/deadpackets/workspace/SanJunipero/packages/engine/src/systems/needs.ts:23) and [indoor hearth warmth](/Users/deadpackets/workspace/SanJunipero/packages/engine/src/systems/warmth.ts:43) already use that state. Indoor walking is explicitly disallowed in the current model, not accidentally omitted.

The ordinary mind path also already has persistent memory/personality, current perception, structured actions/plans, engine validation, wake cadence, interruption handling, budget reservations and provider limits. The engine folds events as they are emitted and rechecks movement passability. Preserve these systems.

## Before AI minds resume

### 1. Building guidance can put a builder inside the planned footprint

[groundForBuilding](/Users/deadpackets/workspace/SanJunipero/packages/engine/src/verbs/build.ts:302) requests a 1×1 claim. [Orchard claims](/Users/deadpackets/workspace/SanJunipero/packages/engine/src/orchardTown.ts:122) calculate the door from that requested size. [The prompt](/Users/deadpackets/workspace/SanJunipero/packages/agents/src/prompt/prose.ts:507) then says the resident must stand there to start building. A larger house covers this location, and [construction validation](/Users/deadpackets/workspace/SanJunipero/packages/engine/src/verbs/build.ts:368) refuses to build over the resident.

For the first free SW plot at local `(25,15)`, the generic mark is `(25,16)`. A 3×3 house covers x=25..27, y=15..17 and has its door at `(26,18)`. The mark is inside it. Coordinates gain the world's origin offset, but the contradiction remains.

Small fix: derive an exterior work tile from the reserved plot, or expose a kind-specific build location. Check that the same plot is selected and the mark is outside every supported footprint while still within construction reach. Do not replace 1×1 with a larger constant without that check.

### 2. Clean shutdown loses queued plans and misses ordinary requests

[Live shutdown](/Users/deadpackets/workspace/SanJunipero/packages/live/src/liveWorld.ts:1120) stops minds before saving runtime snapshots. [Runtime.stop](/Users/deadpackets/workspace/SanJunipero/packages/agents/src/runtime/agentRuntime.ts:696) replaces the plan with `idlePlan()`. The subsequent checkpoint therefore overwrites a resident's unfinished plan with an empty one.

The same stop clears the ordinary in-flight flag. [The live busy counter](/Users/deadpackets/workspace/SanJunipero/packages/agents/src/live/liveMinds.ts:146) tracks scene requests, while the shutdown wait uses that count before closing databases. An ordinary turn can still finish after its ledger or memory database closes.

Small fix: stop scheduling without discarding the checkpoint state; include ordinary calls in the existing request-drain count, then save and close. Reuse the current snapshot format and bounded shutdown wait.

### 3. Scene failures bypass the existing error backoff

[SceneCoordinator](/Users/deadpackets/workspace/SanJunipero/packages/agents/src/scene/coordinator.ts:402) catches a failed line request and returns successfully without advancing the floor. [AgentRuntime](/Users/deadpackets/workspace/SanJunipero/packages/agents/src/runtime/agentRuntime.ts:875) records that as success, so its error/doze branch is skipped. A held conversation floor bypasses ordinary idle spacing, allowing another request on the next tick until the floor timeout.

Small fix: propagate the error after clearing the request token, so the existing runtime backoff and alert path handles it. No second retry manager is needed.

### 4. Conversation prompts omit current physical facts

[Scene prompt assembly](/Users/deadpackets/workspace/SanJunipero/packages/agents/src/scene/sceneLlm.ts:319) clears the normal perception, day log and retrieved memories. [Coordinator input](/Users/deadpackets/workspace/SanJunipero/packages/agents/src/scene/coordinator.ts:389) supplies energy and mood, but not the current location, work, injuries or inventory. [The scene instruction](/Users/deadpackets/workspace/SanJunipero/packages/agents/src/scene/sceneLlm.ts:82) also says the speaker's hands are idle, although only walking is interrupted when a scene starts.

Trigger: a resident speaks while building, crafting, injured or indoors. The prompt can contradict the simulation before the model writes anything.

Small fix: pass a compact physical-context block from existing perception and remove the unconditional idle claim. Keep conversation context bounded; a new memory system is unnecessary.

### 5. Two existing item/social rules ignore the room boundary

| Trigger | Wrong result | Small fix |
|---|---|---|
| Drop a held item indoors | [drop](/Users/deadpackets/workspace/SanJunipero/packages/engine/src/verbs/index.ts:2317) emits the retained outdoor x/y location, so it lands at the doorstep and disappears from indoor perception. | Use the existing structure item location indoors and update the settled predicate. |
| Speak in a nearby but separate house | [social recovery](/Users/deadpackets/workspace/SanJunipero/packages/engine/src/systems/needs.ts:40) checks distance and recent speech without the room boundary. | Reuse [hears](/Users/deadpackets/workspace/SanJunipero/packages/engine/src/earshot.ts:35) for the resident who spoke; retain the doorway exception and recency window. |

With current defaults, the social leak can give 0.5 points per tick for a 60-tick speech window, roughly 30 points despite the other resident being inaudible.

## Interior presentation fixes

| Problem | Evidence and effect | Small fix |
|---|---|---|
| Pinned following stops at the door | [setFollowed](/Users/deadpackets/workspace/SanJunipero/packages/web/src/render/interiorScene.ts:893) has no production caller. [Pinned claims](/Users/deadpackets/workspace/SanJunipero/packages/web/src/ui/directorCut.ts:81) outrank indoor cuts; the pinned camera falls back to outdoor coordinates. | Connect the existing setter, synchronize the resident's current room immediately, and retain entry/exit events for later crossings. |
| A manually opened room does not supply its cast to captions | [Room view](/Users/deadpackets/workspace/SanJunipero/packages/web/src/render/interiorScene.ts:853) hides exterior bubbles, while [LowerThird](/Users/deadpackets/workspace/SanJunipero/packages/web/src/stage/Broadcast.tsx:67) still filters by the director's shot cast. | Let the active room supply visible cast and sprite anchors to existing captions/bubbles. |
| Cold hearths still look lit | [Room light planning](/Users/deadpackets/workspace/SanJunipero/packages/web/src/render/interiorScene.ts:622) reads furniture art metadata, not fuel state. | Bind glow, flame and floor pools to the building's fuel state; keep the hearth geometry visible when cold. |
| Room scale ignores the recorded building | [roomSizeOf](/Users/deadpackets/workspace/SanJunipero/packages/web/src/render/interiors.ts:71) uses the current default recipe. | Feed recorded structure dimensions/facing into the existing room layout. |
| Activity and possessions do not shape the room view | [Occupant placement](/Users/deadpackets/workspace/SanJunipero/packages/web/src/render/interiorScene.ts:689) assigns perches by index and mostly shows idle/sleep. Real room-held items are not drawn. | Use existing activity to choose presentation poses/perches; display a bounded selection of actual stored items near storage. |

Indoor speech is not universally lost: director-selected indoor scenes can receive lower-third captions, and screen-reader speech remains present. The missing connection is the manually selected room and body-anchored speech. Do not replace the working dialogue or accessibility pipelines.

Observed in the local Amara house: Amara's sleeping state and stored inventory are real, but the room is oversized/cropped, repeats the same window/wall art, and still displays the outdoor director name. These are presentation problems, not evidence that minds cannot use shelter.

## Other bounded improvements

| Area | Finding | Recommendation |
|---|---|---|
| Future expansion | [Growth bounds](/Users/deadpackets/workspace/SanJunipero/packages/engine/src/orchardTown.ts:257) use roof edges plus 3 tiles, but [claim validation](/Users/deadpackets/workspace/SanJunipero/packages/engine/src/orchardTown.ts:234) requires the next court's complete road to be inside the map. Template algebra leaves a 4-column shortfall for ordinary eastward housing growth. | Include the occupied court's road/garden bounds in the existing ground box. |
| Reflection cost | [Fact extraction](/Users/deadpackets/workspace/SanJunipero/packages/agents/src/reflection.ts:171) calls the provider and writes facts, but the production path has no reader of `factsAbout` or the facts table. | Either use those facts through the existing recall path or stop extracting them. Do not create a second retrieval system by default. |
| Capability documentation | [INTERIOR_ACTS](/Users/deadpackets/workspace/SanJunipero/packages/web/src/render/interiorMap.ts:345) claims house hearth verbs are missing, despite their implemented support. | Correct the documentation before it causes duplicate engine work. |

The expansion shortfall is a future-growth constraint, not a claim that today's empty plots are unusable. A separately sited edge structure can work around it, but normal house growth should not require that accident.

## Visual uplift without a larger simulation

1. Fix active-room cast, labels, captions, follow-through-doors and fuel display. Check by opening an occupied home, following someone through its door and comparing a lit/cold hearth.
2. Preview two room shells before changing the main renderer: a restrained Pixi refresh and a Three.js cutaway using the town's materials. Keep the same 2D residents in both. Check the same furnished room at desktop and mobile sizes.
3. Prefer the Three.js cutaway if it matches the exterior's lighting and scale better. Keep one active room, hide irrelevant exterior labels, frame the whole room and use the approved resident-specific colors. Check that the room remains readable while people move and talk.
4. Add existing-state details: occupied beds, a cold hearth, food/tools in storage and poses appropriate to current work. Check each against the Inside panel and world state.

Do not add indoor navigation meshes, furniture inventories, individual bed reservations, another agent planner or a new event store for this uplift. Those would be separate simulation features, justified only by a specific action residents need to choose.

## Amara fix delivered

Her northeast/northwest passing frames contained front-facing artwork. This flipped her body twice in each rear walk cycle. A built-in imagegen edit used her original rear idle/contact art as references and produced a rear passing pose. The import uses 54 colors sampled from her original rear art, a 248-pixel figure height and the existing feet anchors.

Only four cells changed: passing-a-ne, passing-b-ne, passing-a-nw and passing-b-nw. The other 20 cells and manifest are unchanged. Reusing the one authored passing pose twice follows the current atlas contract. The original atlas, generated source, processed frame and [repair notes](/Users/deadpackets/workspace/SanJunipero/packages/forge/content/repairs/2026-09-15/README.md) are retained.

Both rear directions were inspected in the browser. The workspace atlas, local database asset and served HTTP asset match. The corrected sprite is live in [the local town](http://127.0.0.1:8773/). The backend and interior findings above are reviewed recommendations, not silently applied changes.

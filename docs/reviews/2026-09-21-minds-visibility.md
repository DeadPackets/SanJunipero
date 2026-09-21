# Minds, activity and the viewing experience

Read-only audit, 2026-09-21. No production mutations, paid calls, tests, migrations or restarts were performed for this audit. The observed production run began at 01:21:55 UTC. Source reviewed in `codex/viewer-experience`; production image was reported as `e018c0dc` by the parent task. This is an early-day sample, not a full-day behavior evaluation.

## Verdict

The minds are working. The product loses much of their work between simulation and presentation. There is also a real coherence gap between a spoken commitment and a later physical plan. A model or engine replacement would not, by itself, repair either problem.

The strongest next step is a complete observer contract: join an ongoing conversation, understand what is happening, see actual actions and intentions, retain missed words, and distinguish recorded facts from a speaker's claims. Keep deterministic physics and autonomous minds separate from this observer layer.

## What production actually did

At tick 618, the authenticated read-only clock reported `paused=false`, `speed=1`. Docker reported healthy. The action report held 124 starts, 121 completions, zero interruptions and three still running. There was no global mind hold or stalled clock.

At tick 636, the preceding 120 ticks contained 75 `agent_spoke` records, 67 `scene_line` records, 54 completed actions and 64 movement events. The two speech counts overlap: a conversational utterance produces both records. They must not be added.

At tick 712, the preceding 120 ticks contained 79 speeches, 55 indoors, averaging 97 characters. One two-person conversation delivered 12 lines in 13 simulation ticks. With the shipped three-second tick, that is about 39 seconds. A 91-character balloon uses approximately 11 seconds of typing and reading time. One balloon cannot show those 12 lines before that conversation has moved on. This is a throughput mismatch, not missing model output.

At tick 669, seven of twelve people were indoors. Eleven had `activity=null`, but that field does not mean eleven minds were doing nothing: conversation is coordinated separately. The active director shot was Bashir and Farida talking inside Farida's house.

At tick 636, 108 ordinary-turn thoughts had been saved. Only 42 met the global importance threshold of six. The other 66 can still appear for the selected person or scene cast, but are otherwise filtered from map bubbles. Scene-private asides are not part of this thought count.

### Finite accounting baseline

Measured at **2026-09-21 01:48:30.920 UTC**, world tick 791. The ledger contained **448 calls costing $0.4546985183**. This includes preflight and failures. It is not a spending projection.

| Caller | Calls | Input tokens | Cached input | Output tokens | Reasoning tokens | Mean latency | Cost |
|---|---:|---:|---:|---:|---:|---:|---:|
| Ordinary turn | 168 | 1,192,636 | 638,355 | 47,227 | 15,712 | 3,623 ms | $0.205905 |
| Conversation line | 229 | 1,094,966 | 833,079 | 41,883 | 19,768 | 2,805 ms | $0.131035 |
| Arbiter | 10 | 30,143 | 11,642 | 71,657 | 40,929 | 51,108 ms | $0.090432 |
| Conversation close | 24 | 24,831 | 0 | 4,864 | 2,351 | 2,751 ms | $0.011684 |
| Day-log compaction | 14 | 46,478 | 0 | 1,611 | 1,117 | 2,816 ms | $0.013415 |
| Preflight | 3 | 14,313 | 9,410 | 697 | 276 | 3,104 ms | $0.002227 |

Reasoning is reported separately for diagnosis and can be included in output usage. Do not add the two columns when calculating total tokens. Every non-arbiter call in this sample succeeded. Eight of ten arbiter calls succeeded; two reached the output limit without an answer after approximately 114 and 122 seconds.

The immediate problem is not a large bill. It is latency, coherence and making existing activity legible.

## Confirmed observer gaps

### 1. A new viewer does not receive ongoing scene state

`packages/gateway/src/server.ts`, hello handler around lines 396–424, sends snapshot, assets, moods, deciding minds, director, board and threads. It does not send open `scene` frames. `packages/gateway/src/scenes.ts` emits scene frames on opening, participant/kind changes and closing, but not on each line.

Consequently, a late viewer can receive a director shot for a current conversation while `WorldStore.shotScene()` is null. The conversation header, cast-aware presentation and context wait for the next structural change or close. The scene relay is also not primed at gateway startup, although director and threads are primed, so a scene opened before restart can be absent from subsequent relay updates.

Minimal fix: expose current open frames from the relay, prime it from persisted relevant scene events, and include current frames at hello and live resynchronization. Verify joining and reconnecting halfway through the same conversation. Persisted recent transcript catch-up is a separate small addition; the current `LivingScene` explicitly warns that earlier turns are unavailable.

### 2. Speech is discarded before the camera can show it

`packages/web/src/render/pixelBubbles.ts`, `spawn`, around lines 78–104:

- Rejects speech when no current on-screen anchor exists.
- Rejects another scene while the shot owns an open scene.
- Uses one active balloon for the whole town and a queue of twelve.
- Lets speech remove queued thoughts and replace an active thought.
- Drops the oldest queued line when full.

The active balloon also hides entirely at zoom 0.5 or lower. `agentAnchor.ts` cannot anchor someone indoors unless that exact room is open. `StageMount.tsx` consumes speech once at event arrival. A camera that enters that room afterwards cannot recover the discarded line.

Minimal fix: keep received dialogue as a bounded transcript independent of visibility; derive current on-screen dialogue from it. Use arrival timestamps and clear live versus recent labels. An off-screen speech token can offer a camera jump without pretending that the speaker is on screen. Do not make the simulation wait for reading speed.

### 3. Ordinary viewing suppresses existing context

`App.tsx` mounts `DirectorCue` only for broadcast mode. That component already describes the shot, why it matters and immediate milestone news. `StoryStrip` is also broadcast-only. Ordinary viewing mainly gets `LivingScene`, which is vulnerable to missing scene state above.

Minimal design direction: one compact grounded context line in normal viewing, plus a quiet list of current scenes. Keep completed scenes reachable from the journal. This can reuse recorded events and existing scene beats without a new paid narrator loop.

### 4. Thought presentation does not mean all thinking

`ui/thoughts.ts` uses importance six, selected-person and shot-cast exceptions. `StageMount.tsx` starts its seen-thought counter at the current store count, so thoughts received during asset setup do not later become map balloons. Gateway greeting does not backfill recent thoughts. `scene/coordinator.ts` keeps a line's private `aside` in its thread but broadcasts public `scene_line` without the aside and does not call the ordinary `onThought` publisher.

These are distinct choices. Any change should preserve privacy between minds. It is safe to expose a resident's authored aside to the observer, but not to another mind, and it should not overwrite the spoken line. Never synthesize a thought merely to fill silence.

## Mind cadence and action architecture

The current design already has the useful parts of an efficient autonomous-agent system:

1. Deterministic physics and event logging, with LLM calls outside the simulation tick.
2. Event-triggered waking, per-mind in-flight guards, a plan queue and a scheduled reconsideration time.
3. A separate turn-taking coordinator for conversations.
4. Persistent memories, relationships, personality and runtime state.
5. An arbiter that resolves existing rules before asking a model to create new capabilities.

Relevant source: `agents/src/runtime/agentRuntime.ts`, `agents/src/wake.ts`, `agents/src/scene/coordinator.ts`, `engine/src/tickLoop.ts`, `live/src/liveWorld.ts`.

The live idle gap is fifteen simulation minutes, or 45 real seconds at speed one. Boredom is forty ticks, or 120 real seconds. A body that completed a short single act can therefore remain still for a noticeable interval. These are explicit cadence choices, not provider failures. A queued multi-step plan continues through the deterministic plan pump without buying a fresh thought for each step.

Conversation opening stops participants who are walking. While in a scene, the floor holder gets a scene turn and ordinary listeners do not get ordinary action turns, except for urgent body/physical conditions. `SCENE_ANSWER` explicitly requests words rather than a new physical action. Twelve lines cap a two-person scene. Casual conversation has a three-simulation-hour daily budget, while directly addressed conversations can still open.

That separation prevents walking out of earshot and duplicated thinking. It does not freeze all physical activity: `#standStill` stops only walking, and the runtime pumps existing plans and pending intents before scene wake gating. The narrower gap is that a scene answer cannot author a new physical action or plan when a resident says “I'll do it now.” Existing work may continue. Improving that commitment handoff is more useful than increasing all call frequency.

Provider concurrency is already managed by an eight-slot adaptive shared gate (`llm/src/rateLimiter.ts`). A 429 reduces the cap and successful calls recover it. Normal turns wait up to twenty seconds at the queue; scene lines ten. This sample did not show queue failures. Do not add a second competing scheduler without evidence.

## Promises: saved, but weakly linked to action

Scene closure saves a summary to participants' memories and applies relationship deltas to their `TieStore`. Night reflection can add or settle ties. A tie stores person, kind, text, tick, settled tick and source. It has no due time, location, linked physical intent or completion evidence.

Normal turns read at most two ties per person. `AgentRuntime.#tiesByName`, around lines 1799–1820, iterates `TieStore.open()` in ascending database id order. A seeded kin tie can consume the first slot, and the oldest promise the second. Newer promises then disappear from the ordinary-turn tie block. That block is also keyed to the current perception's people, so an absent counterpart's commitment relies on memory retrieval or reflection.

Observed example: Bashir had an open partner tie and six open promises to Farida. The first, tick 381, concerned setting the fire and counting food. The latest, tick 734, concerned sorting wood and stacking it after supper. Ordinary tie rendering selects the partner tie and tick 381, not tick 734. His checkpoint had an empty plan and no reconsideration time. This does not prove a missed supper commitment: the sample is still before supper. It proves that the handoff is weak.

The pair's scenes at ticks 583, 630, 673, 702, 735 and 764 repeatedly discuss not touching food, checking portions, stacking logs and waiting for supper. This is repetitive discourse, but not total inactivity: Bashir completed nineteen take/stow/drop/move-inside actions between ticks 598 and 718; Farida completed a take at 750–751.

Minimal improvements to evaluate:

1. Prioritize recent unresolved promises in the existing prompt block; keep kin outside the two actionable slots. Check that a new promise reaches the next ordinary turn.
2. At a natural conversation exit, let the same mind author a short next plan or reconsideration time using existing legal intents. Check that the chosen plan reaches the existing plan pump.
3. Keep an optional due intention as a reminder, not a mandatory action. The mind can change its mind and record why. Check that an absent counterpart does not erase the reminder.
4. Deduplicate restatements of the same unresolved promise and link settlement to the specific promise. Currently settling one person/kind settles every open row of that kind. Check that paying one debt does not clear unrelated debts.

No automatic “promise means forced action” rule is appropriate. It would violate the project's autonomy boundary.

## The arbiter is the measured slow lane

The arbiter already performs exact rulebook lookup, semantic precedent lookup at cosine 0.92, then an expressive-action path or full novel-ruling path (`arbiter/src/adjudicate.ts`, around lines 402–550). Accepted charters become deterministic verbs and survive restart. Adding a generic cache would duplicate existing work.

It currently uses `xhigh` reasoning and a 20,000-token output ceiling (`llm/src/pins.ts`). In the finite sample, ten calls consumed about twenty percent of dollars and much more latency per call than normal thinking. The public intents included stacking ten pieces of wood beside a hearth and repairing a bridge with a plank. The wood intent was ruled as “common store” on two separate occasions. This deserves inspection of precedent matching and routine versus novel classification, not an assumption that all physical activity requires a large reasoning model.

Keep the arbiter responsible for physics extensions, legal capability mapping and validating new recipes. Keep it out of ordinary social choices. Candidate optimization: measure a lower-reasoning first pass on already captured ruling fixtures, escalating only failed/ambiguous novel recipes. Preserve validation, replay and the permanent-rule review trail. No paid comparison was performed here.

Global budget settings are not the only limits. Hard per-caller rolling-day rails include arbiter $3, conversation $16, narrator $3, scene close $1, and constructs/council/law compiler $0.05 each. None had tripped in the observed sample. A future rail can disable one subsystem while the town remains healthy. Show subsystem degradation in operator diagnostics and an honest public “thinking delayed” state, not silent idleness. Do not silently raise caps.

## Persistence, culture and physics complexity

Persistence is substantial and should be retained. Mind databases contain immutable raw memories, embeddings/search, gists, facts, relationship ledgers, summaries, journals, autobiography, ties, wants and personality versions. Runtime checkpoints preserve clocks, plan queues, current scenes and pending cognition. Saving occurs every 48 ticks and on settled shutdown. Arbiter databases persist rulings, charters, constructs and review state. Narrator databases hold daily chapters and milestones.

Traditions are recognized from repeated evidence, not invented by a director. `liveWorld.ts` performs the construct pass at day boundaries. `arbiter/src/constructs.ts` identifies recurrence and requires a real utterance/inscription for a named custom. Observer classification stays outside minds; quoted town names and descriptive habits can reach their prompts. A first-day sample cannot evaluate tradition emergence or long-term memory quality.

There are 26 ordered world systems in `engine/src/worldTick.ts`, including weather, fire, crops, wildlife/fauna, spoilage, needs, warmth, thirst, health, illness, paths, regrowth, reproduction, aging, actions and sight. That is broad simulation scope. The engine tick implementation itself is not an obvious complexity bottleneck: it has a clear ordered list, deterministic event folds and transactional rollback. The largest behavioral knot is the runtime/prose layer, with many accumulated situational rules and prompt branches.

Physical timescales vary materially by recipe. The actual production `house` recipe takes 240 work ticks, or twelve real minutes for one uninterrupted worker before modifiers. `SHOWCASE_CONFIG` overrides the library rate even with live minds. A cottage takes 6,480 ticks, or 5.4 real hours, and a farmhouse 8,640 ticks, or 7.2 hours. Do not use the library's default house rate to explain this production run. The larger recipes still require a long investment; whether to change those times is a product choice, not a bug fix.

Do not delete the simulation to fix a camera/transcript defect. For a future focused release, judge systems by visible consequence, understandable affordance and evidence of use. Surface work progress, show why an act cannot proceed, and represent completed actions before adding more invisible physical rules.

### Enabled production physics versus demonstrated use

The public websocket snapshot at **2026-09-21 01:53:50.343 UTC**, tick 897, held an Orchard world of 112 × 112 tiles, twelve residents, 27 structures, 56 items and three fauna. Weather was cloudy at 14 °C. A separate read at 01:57:02 UTC confirmed only these nonsecret flags: `SJ_LIVE=1`, `SJ_MAP=orchard`, `SJ_INTERIORS=1`, `SJ_BUILDERS=1`, `SJ_JOINT=0`, `SJ_BRIDGE=1`, `SJ_FOUNDERS=12`.

The snapshot carries base configuration and law overrides separately. Effective production laws set hunger decay to 0.01 per tick, awake energy decay to 0.065, daytime sleep threshold to 60, fuel burn to 480 ticks, spoiled-food poison chance to 0.05, and `desirePaths.enabled=false`. Reading only base configuration would give the wrong answer for these settings. `engine/src/worldTick.ts` uses `effectiveConfig(config, state.laws)`.

| System | Actual production configuration | Evidence of use or remaining limit |
|---|---|---|
| Interiors and physical actions | Interiors on; normal movement three tiles/tick; sight twelve, earshot eight, conversation radius two | Indoor speech, movement, item taking/stowing/dropping and completed acts were directly observed. Indoors is an active part of the mind interface. |
| Building and collaboration | Houses 240 work ticks; new plot every 14,400 ticks (ten simulation days); `SJ_BUILDERS=1`, `SJ_JOINT=0` | These two flags govern scripted founders. `founders.ts:738` returns before scripted builders when real minds are enabled. They neither prove that minds will build nor disable the real cooperative build verbs. No autonomous new building was verified in this sample. |
| Roads and growth | Roads enabled; one stone per tile, ten paving ticks; desire paths disabled; map growth enabled | Existing Orchard paths are surfaced by `devWorld.ts`. Map growth reacts at midnight to structural pressure near an edge, not to a wanderer. Current first-day sample cannot verify expansion. |
| Weather and fire | Weather changes hourly with chance 0.15; harsh conditions begin day 21; fire spread 0.02 per adjacent candidate/tick and burn duration 120; storm lightning fire chance 0.001 | Changing weather was present. No new fire, spread episode or mind response was verified here. Fire/lighting capability should not be counted as a shown story. |
| Needs, warmth and light | Hunger/energy effective values above; thirst enabled at 0.8 of hunger decay; warmth enabled with comfort threshold 8 °C; night work multiplier 1.5; fuel and fire risk enabled | Need/action fields and indoor work were present. This pass did not measure individual need-driven decisions, fuel exhaustion or cold response. `mortality.needsKill=false` prevents ordinary unmet needs from directly killing residents. |
| Food, tools and ecology | Spoilage and tool wear on; fish two days, berries three, bread six; storage doubles life, ground halves it; fauna, food variety, fertility and regrowth on | Three fauna were present but viewer livestock are deliberately hidden. No spoilage, tool break or sapling maturation was verified. Regrowth saplings take thirty days. Older fishing evidence is separate from this fresh run. |
| Injury and illness | Mortality enabled; poison chance 0.05; illness and contagion enabled, contagion chance 0.06 within radius three | The code and effective configuration support these systems. This sample does not establish that a spoken concern about illness corresponds to a real affliction. Grounded narration must check body state. |
| Family and aging | Reproduction on, gestation twenty days, fertile ages sixteen to 45; old-age mortality on with elder threshold sixty; population cap twenty | Founding relationships exist. No new pregnancy, birth or aging death can be claimed from a short first-day sample. These are long-horizon stakes, not an immediate pacing mechanism. |
| Customs and institutions | Construct detection on; minimum three participants and two recurrences within seven days; festival, faith, council, market and custom categories enabled | Persistence and the day-boundary detection path were inspected. No current-production tradition or institution was yet verified. A setting is not evidence of autonomous emergence. |

This is a rich physical medium, not an empty chatbot stage. The unanswered product question is whether residents understand and use its affordances enough to create consequential, visible change. Measure attempts, rejections, completed changes and later references to those changes before adding more systems. A routine controller could execute a mind-authored queue and stop on interruption using the existing plan pump; it should not invent household schedules or outcomes.

## Research and three viewing directions

These are design inferences from the research, not claims that the cited systems solve San Junipero's implementation.

[Park et al., Generative Agents](https://arxiv.org/abs/2304.03442) supports the value of observation, planning, memory and reflection for believable behavior. San Junipero already has these pieces. Their presence does not prove a town will be entertaining. The paper's party example starts with an authored intention, which should not become a hidden instruction to this town.

[Ryan, Curating Simulated Storyworlds](https://escholarship.org/uc/item/1340j5h2) makes the directly relevant distinction: simulation traces are raw material, and an audience still needs curation to understand a story. Its recounting approach fits the project's “physics, never outcomes” law better than forcing dramatic events.

[Clothier and Millard, Stories from the Bottom Up](https://eprints.soton.ac.uk/502632/) explores incremental composition of story patterns from simulated events. Applied here, an observer could connect an authored promise, preparation and a recorded outcome into a readable thread without directing the residents.

[Nelson et al., Declarative Optimization-Based Drama Management](https://www.kmjn.org/publications/DODM_IEEECGA-abstract.html) describes selecting interventions to optimize an authored story. It is a useful contrast, not the recommended architecture here: steering the world's outcomes for drama would change the premise the user approved.

| Viewing direction | What changes | Why choose it | Main constraint |
|---|---|---|---|
| Living documentary | One scene at a time, complete spoken turns, a grounded context line, quiet cues for other ongoing scenes | Best default for passive watching and continuity | Camera and dialogue clocks must be coordinated without slowing real minds |
| Follow a life | Selected resident, visible current action, their actual latest thought, unresolved intentions and relationship changes | Builds attachment and makes mundane work understandable | Must clearly distinguish thought, promise, ongoing action and completed fact |
| Town chapters | Short replayable sequences assembled from real events, with explicit “recorded earlier” labels and a live return | Makes brief visits rewarding even when the live town is asleep | Cannot pass replay or retrospective narration off as current events |

Recommendation: the living documentary as the normal live surface, with “follow a life” as an intentional selection. Town chapters can reuse the existing replay system as a separate mode. No new global planner, autonomous director that manipulates residents, RL camera or vector database is needed to establish whether this improves viewing.

## Verification targets before a larger redesign

1. Join an already active indoor conversation. The first visible frame has correct participants and recent transcript.
2. Follow one whole conversation. Every received line remains readable; the camera does not claim an unread queued line is being spoken now.
3. Observe a genuine authored commitment. The next relevant decision can see it, and completed action evidence is distinct from the speaker's claim.
4. Leave the viewer open for ten minutes. Record the share of time with understandable context, not just token/spend totals.
5. Compare one day using the existing model with the same event, latency and coherence metrics before considering an architectural replacement.

Potential concern checked and rejected: private scene asides do not leak through the current live caller. `coordinator.takeFloor` passes `threadFor(scene, agentId)`, and `scene.ts:397` removes every other speaker's aside before `sceneLlm.renderThread` sees it. The renderer relies on that contract, but the audited call path honors it.

Follow-up qualification: that conclusion covers individual speaking turns, not scene closure. `sceneLlm.closeMessage` supplies all private asides to the closing summarizer, whose single summary reaches every participant and overhearer through `coordinator.#close`. No actual generated disclosure was reproduced, but a prompt-only instruction to summarize what was said is weaker than separating private and shared inputs. See the skeptic report's continuity follow-up.

## Longer-history evidence, kept separate from today

The following figures are read from committed reports, not independently remeasured from the old databases in this audit. The model routes, physics and code differed. They reveal recurring failure classes but are not current-production metrics.

| Source | What was actually covered | Relevance and limit |
|---|---|---|
| `docs/REHEARSAL-2026-09-17.md` | A real 60-minute Orchard run, 12 residents, 1,190 simulation minutes, 956 calls, $0.823882, 603 speeches, 317 completed actions and 51 conversations | Indoor wiring worked and there were real physical consequences: Bashir's fishing discussion was followed by fishing at ticks 710 and 774. No building completed after founding. It did not reach a complete day boundary. |
| `docs/REHEARSAL-2026-09-20.md` | A copied town advanced 910 consecutive ticks, crossed midnight, reflected and woke all twelve, with controlled restarts. 176 speeches and seventeen scenes. | Supports memory/restart/day-boundary integration. The accelerated 650 ms cadence is unsuitable evidence for natural conversation pacing. Bashir independently discovered a rope basket; no autonomous new-building commission was observed. |
| `docs/superpowers/specs/v2/evidence.md` | A much older five-mind world covering 16.77 simulation days and 56 pooled mind-days | Reported 53% total time idle, 85% waking time idle, one resident reading the same note 417 times, one unnamed recognized custom, and four minted verbs. This demonstrates that memory and a tradition pipeline alone did not prevent loops. It is not evidence those old survival failures remain in today's release. |
| `docs/HANDOVER-2026-09-13.md`, pacing and emergence sections | Owner-approved historical pacing of 7.6 speeches, 4.8 action starts and 0.65 scene closures per real minute, and a new building roughly every 1.5 hours | Today's short speech window is about 13.2 speeches per real minute at speed one. More words alone would not address the mismatch. Earlier r49 reportedly built 0.98 structures per simulation day after a construction-affordance fix. |

The old evidence also described nightly personality and relationship writing as richer than routine daytime speech. Current `SceneVoice.known` does now pass relationship ledgers into conversation prompts, so that old missing wire should not be reported as still absent. The narrower present gap is commitment priority and timing, alongside scene/private-aside observer delivery.

The handover records two important historical mistakes: a character value about caring for the sick led to care for an unmarked illness, and a named example in a prompt was copied by several residents. The lesson is to check spoken claims against current physical evidence and avoid implanting particular plots as examples. It is not a reason to forbid imaginative or dishonest speech. Narration must distinguish “said” from “did.”

## Coverage and what remains unproven

| Area | Read and checked | Unproven by this pass |
|---|---|---|
| Wake/decision lifecycle | Runtime guard, wake reasons, plan pump, callback publication, live clocks, successful-call aggregates | Full current-day inactive-time distribution and long-run decision quality |
| Conversation | Opening/turn/closing flow, room separation, words-only scene decisions with existing work continuing, actual pair transcript, scene relay, late join | Diversity and meaningful relationship development over several current-production days |
| Memory and relationships | Storage schemas, runtime checkpoints, retrieval handoff, reflection, tie ordering and settlement | Current long-run recall quality, factual reliability of every memory, selective settlement correctness under all paths |
| Culture and laws | Construct detection/persistence/day boundary, named-custom provenance, law compilation seam | A present-production tradition, festival or social law emerging naturally |
| Model cost/performance | Finite ledger snapshot, exact per-caller usage, failures, pins, limiter, precedent lookup | Alternative-model cost/quality, end-to-end cache hit attribution and provider-invoice reconciliation |
| Viewer | Event-to-store-to-bubble chain, thought filters, anchors, narrative mode gates, initial socket sample | Browser-perceived coverage/reading rate across a representative full session |
| Physics interface | Ordered system list, action validation boundary, perception/prompt handoff, physical duration scale | Exhaustive review of all 26 systems; that belongs to the parallel world-architecture audit |

For a Jev comparison, use the finite baseline above rather than a daily projection or a headline cache percentage. No Jev implementation or benchmark was inspected by this subtask; the parent task owns that research. A candidate is useful only if it preserves autonomous choices, memory isolation, durable budgets, deterministic action validation and restart recovery while improving measured latency or cost. An integration that saves tokens but leaves scenes unjoinable and promises unremembered does not solve the current product problem.

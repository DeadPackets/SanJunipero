# San Junipero: a town worth returning to

Status: design proposal for selection. September 21, 2026. Local branch `codex/sanjunipero-v3`. No production change, inference call, or implementation of the proposed systems.

## Decision

Build **A: The living show** as the default experience. Borrow the short, clearly recorded catch-up chapters from C. Keep an explorable town available, but do not make finding the story the viewer’s job.

The product promise becomes: **“Get to know a town of autonomous people. Watch their choices change it.”**

The town is the stage. People, intentions and consequences are the content. The website and Twitch feed should show the same understandable scene. A journal gives depth after a viewer cares about someone.

This proposal reopens the viewing work deferred under V3/V4 of the existing engineering plan. It does not discard the v3 foundation. It also extends that plan where a clearer picture cannot repair repetitive behavior or an intention that never becomes action.

## What is failing, and what is already working

The previous implementation work proved many individual functions. It did not prove the complete experience of watching, understanding, caring and returning. Treating those as equivalent was a mistake.

| Evidence | Implication |
|---|---|
| One recorded AI day contains 485 public utterances, 407 completed non-speech actions and 37 closed conversations in 26 minutes 19 seconds. | The simulator is not simply empty. More polling or more words is not the first remedy. |
| 19 of those 37 conversations ended at a limit. | Inspect repetition, unresolved decisions and follow-through. A limit closure is a warning to review, not proof of a bad scene. |
| The desktop review measured a 150-pixel almanac at 720-pixel viewport height. | Time and controls consume attention before the characters establish a situation. |
| A viewer had to open Chronicle, a moment, a profile and Relationships to assemble one exchange’s context. | Useful facts exist, but the viewing path does not supply them when needed. |
| The live camera can resolve an all-indoor scene, while the replay moment branch can return a hold instead. | A story that happened indoors can become an incoherent replay. This is a repair, not a new design choice. |

V3 already has wants, retained goals, commitment identities, reflection, physical plans, scene transcripts, grounded narration, public usage totals and event replay. Reuse those. Do not add another planner, director, memory framework or simulation engine.

The current story grouping uses participant overlap and activity heat. It is useful for finding material, but it does not establish that two exchanges concern the same promise or project. That distinction matters if we ask viewers to follow a developing story.

## Three product directions

Open `index.html` through the local proposal server. Each direction uses the same recorded Dilara/Halim exchange, with an illustrative room and the actual resident sprites. The four-beat edit is intentionally compressed. It is not a simulation or a retention test.

| Direction | Default experience | Best fit | Main cost |
|---|---|---|---|
| A. The living show, recommended | One understandable scene fills the screen. A declared short delay supports context and readable exchanges. Longer protected scenes are labeled Recorded. | Twitch, hands-free watching, learning the cast | Selection and transitions must be reliable. Quiet periods remain real. |
| B. Town commons | A social diorama with a few readable places and developing situations. The visitor chooses where to look. | Exploration, ownership of favorites, a companion website | It still requires active discovery. A stream viewer cannot make those choices. |
| C. The storybook | Short recorded chapters with a beginning, a change and an open question. Current live town is a separate destination. | Returning viewers, sharing, clear narrative pacing | This changes the default promise from live observation to recorded storytelling. |

My recommendation is A as the product, with C as its return path. B can remain ordinary free-camera exploration. Do not implement three separate products or three independent camera systems.

The present paper colors, flat icons, expressive sprites and personal houses are assets worth keeping. Their placement and hierarchy are open to change. These previews test the product structure, not a replacement art pipeline.

## The first visit, without a tutorial

| Time after arrival | What the viewer sees | What it must establish |
|---|---|---|
| 0–5 seconds | The town loads into one place with the relevant residents already framed. A compact status says Live, Delayed, Recorded or Reconnecting. | Where am I, and is this happening now? |
| 5–15 seconds | One short public fact: “Dilara wants a wooden latch for her door.” Names are attached to the actual people. | Who is involved and why the moment matters. |
| 15–45 seconds | Arrival, work or an exchange. Speech has an identifiable speaker. The camera does not abandon a reply. | A choice I can understand, not unexplained text. |
| 45–90 seconds | A visible result, a new fact, or an honest unresolved state. | Something changed, or there is a specific reason to keep watching. |
| After interest forms | Follow this person/story, inspect the journal, read the exchange, or explore. | Depth is optional rather than required for comprehension. |

These intervals are prototype targets, not promises that autonomous residents will produce an event every 90 seconds. If no useful live situation exists, show the quiet town and offer a clearly recorded chapter. Never invent a developing story to fill the slot.

Remove the generic welcome message permanently. The first meaningful encounter should introduce the product.

## A complete scene, not a collection of overlays

One selected scene should own its camera, context, speaker display and transition. Extend the existing director decision so that each component consumes the same selection.

1. **Establish → check:** show the actual room or place, people and one relevant public fact before the first featured line.
2. **Engage → check:** show approach, acknowledgment and turn ownership from recorded state. A nearby resident is not automatically a participant.
3. **Develop → check:** hold the relevant people while a proposal, response, action or disagreement unfolds. Avoid jumping between unrelated simultaneous exchanges.
4. **Register change → check:** briefly show the supported consequence. “Made a latch” is different from “repaired her door.”
5. **Release → check:** let the last readable line or physical result finish, then move to another situation or a quiet view.

These are presentation phases, not a script the minds must perform. A scene can end with a refusal, uncertainty, silence or no agreement. A private conversation remains private to other residents even if an approved viewer surface reveals part of it.

The camera must not reposition bodies, invent gestures of consent, teleport participants or make them assemble for a shot. Better blocking comes from reachable room furniture and actions the residents actually choose. Camera framing follows those facts.

### During a conversation

Use the approved compact pixel balloon, fitted to its content. Keep one primary spoken line readable. Identify the speaker with name and placement, not color alone. Keep thought balloons visually distinct and off by default during a featured exchange unless the viewer opts in.

A small arrival cue can identify the scene before words appear. A response cue appears only when the system knows a turn or model request is pending. Do not label ordinary idleness as “thinking.” Do not animate fake typing during a stalled provider call.

Retain a recent-lines transcript for anything missed. On mobile or when balloons cannot fit, use one speaker-labeled caption area, without simultaneously duplicating the same sentence in two large panels.

The existing renderer can animate facing, a restrained acknowledgment or tool motion. Emotional reactions need an expressed or recorded basis. “He looked nervous” cannot be manufactured from a neutral utterance.

### Pacing and the live clock

There are two clocks already implicit in the product: world time and the time required to read a scene. Make their relationship explicit.

Raw Live cannot promise that every line will remain readable during bursts or after late arrival. Make that tradeoff explicit. Explore can stay at the live edge and disclose missed lines. The default Watch experience should use synchronized historical state with a short, visible delay, starting with a **30-second buffer as an experiment**, not a proven setting.

The town never pauses for viewers. Camera, bodies, actions, dialogue and time must all come from the same presentation tick. The director may use buffered events to choose a scene, but on-screen context must not reveal events after the displayed tick.

Test reading holds against the same bursty recording at 15 and 30 seconds of initial delay. If protected reading would exceed a proposed 45-second delay bound, change the visible state to Recorded scene and finish that scene using historical state. At its end, make one explicit transition back to the current program. Do not accumulate an invisible, indefinitely growing live queue. Provide a direct Live option at all times.

This is a real architectural decision: A offers a coherent program, with honest delay and recorded segments, rather than guaranteeing uninterrupted raw-live footage. It reuses the replay clock and event history. If the user prefers strictly live-only viewing, retain A’s hierarchy but accept omitted lines with a visible missed-exchange affordance. Neither approach can guarantee every simultaneous conversation is shown.

A cut should wait for the current response or a bounded reading hold. An urgent physical event may interrupt, with a clear transition and a way back. An endless conversation must not hold the camera forever. Budget exhaustion or inference delay needs an honest status, not a fabricated ending.

## The new screen hierarchy

| Component | Proposal | What it replaces or consolidates |
|---|---|---|
| Town and residents | Primary visual area, framed around the featured activity. Fixed isometric A perspective retained. | Wide empty view with tiny unrelated figures. |
| Top bar | One compact band for identity, day/time, weather and explicit Live, delayed or Recorded state. Keep public cost/tokens as one quiet expandable readout. | The large default timeline and multiple competing replay actions. |
| Scene context | One short title and one public causal fact, then reduced presence after orientation. | Separate director labels, generic “in conversation” text and repeated summaries. |
| Camera controls | One visible Watch/Explore state. In Explore, one return-to-director action. | Detached camera indicators and overlapping interior/camera headers. |
| Speech and activity | Consistent pixel balloons and activity tokens. Real actions visually affect objects. | Several independently styled labels that compete for the same location. |
| Journal | One docked panel on desktop. A full-height, dismissible sheet on mobile. Scene fit is recomputed when it opens. | Floating paper variants and manual overlap offsets. |
| Story follow | Follow a person or a supported developing situation. This changes the viewer’s feed, never a mind’s priorities. | A favorite indicator with no visible return benefit. |
| Keepsake | One brief, specific celebration after a verified first or milestone, then saved in the journal. | Generic achievement noise or constant repeated firsts. |
| Replay | One clear Recorded state, one timeline when requested and one return-to-live action. | Multiple competing replay controls. |

There should be one main reading task at a time. A keepsake waits while dialogue is being read. A menu takes input priority. A journal dock changes the usable camera frame, not the top bar’s width. The recently repaired semantic layering remains the foundation, but geometry also needs one owner for reserved screen regions.

### Journal, redesigned around curiosity

Keep the category colors and flat icons. Consider clearer names: Folk, Stories, Places, Customs. Naming is a selectable design detail, not a requirement to discard the approved labels.

| Page | First thing shown | Deeper information |
|---|---|---|
| Folk | A portrait, current supported intention/activity and recent meaningful change. | Relationship history, expressed interests, selected memories already permitted to viewers. |
| Stories | Developing situations, what changed and what remains unresolved. | Source-linked scenes and full transcripts. No heat-only “resolved” claims. |
| Places | Actual building/room image and its use by residents. | Ownership, contents, construction, who has visited and what happened there. |
| Customs / Rule | Firsts, resident-named practices, agreements and active or proposed rules. | Dates, recurrence, evidence, support and dissent, ratification, repeal and revisions. |

No artificial friendship percentages, character levels or inferred motives should be added for decoration. Where a numeric skill is real and useful, put it behind the activity it helps explain.

## Why someone comes back

The return loop needs persistent questions, recognizable people and visible change. It does not need daily login chores.

1. **Attachment → check:** following Dilara prioritizes her meaningful changes and scenes. It does not flood the viewer with every movement.
2. **Anticipation → check:** an actual invitation, promised inspection or unfinished project stays available until evidence changes its status.
3. **Payoff → check:** show a before/after difference, with the people responsible and the event that supports it.
4. **Memory → check:** a resident refers back, uses the object, changes a plan or returns to a place. A stored fact alone does not count as demonstrated growth.
5. **Recognition → check:** a keepsake or custom records something distinctive to this town. It remains viewable without having been online at the exact moment.

“Since you last visited” should offer at most three useful changes, one open situation and one short recorded chapter. No wall of unread dots. Avoid streaks, false urgency and rewarding the viewer for leaving a tab open.

For Twitch, the default must remain understandable without clicking. Community predictions and camera votes can be a later experiment around observable outcomes. They should not instruct residents, force a relationship or purchase adversity. Do not build custom voting infrastructure before testing whether people care about the situations.

## What must change beneath the UI

### 1. A public situation record

Project a small, rebuildable observer view from existing public events and stable identities. Use explicit commitment, project, construction, invitation or proposal links where available. Participant overlap alone is not a causal link.

The minimum useful record holds: identity, involved residents/place, publicly stated intention, latest supported change, unresolved status and source event references. Each assertion must be valid at the replay timestamp. Start with one supported object/project family rather than a general-purpose narrative graph.

A person saying “I finished” is a claim until supported by world state. A person privately abandoning a plan does not automatically publish that fact. A quiet thread can leave the featured feed without being marked resolved. Narration can phrase the facts, but it cannot become evidence for itself.

Implement this beside the existing observer projections. No second authoritative world database, quest engine or new LLM classifier on every tick.

### 2. Less intent talk, more chosen action

The latch excerpt exposes a useful boundary. Halim repeatedly offers to inspect the frame and hinges. The excerpt proves the words and Dilara’s crafting result. It does not prove an inspection.

Trace the actual plan and available verbs. Is the requested action supported? Was it chosen? Did it fail reach checks? Did the next turn repeat the promise instead of executing it? The repair depends on that answer.

Where an activity is useful, supply a small semantic action using the existing plan executor: inspect an object, deliver an agreed item, contribute to a named build, or prepare a shared table. The mind chooses it. Execution checks target, access and materials. Failure returns a useful fact instead of silently forcing success.

A created object is not enough. Require one complete chain: craft or obtain → use → observable world change → a later resident response. Use an existing functional affordance first. A latch in inventory earns a crafting result, not a claim that privacy or safety improved.

If an inspection can only report a condition already known to the engine, keep it that simple. Do not add hinge mechanics to support one conversation. If an action has no meaning in the current world, minds need to know that rather than promise it indefinitely.

### 3. A world with reasons to meet

A pub is useful if someone can host, offer food or drink, invite others, hold a gathering and choose not to attend. A beautiful empty shell is scenery. Pilot one functional shared venue before building a general retail economy.

Give residents access to complementary opportunities: skills, objects, knowledge, space and time. Keep these grounded in their established state. Avoid an identical perfect supply of everything in every house, but do not introduce starvation or compulsory trading just to manufacture conflict.

Initial conditions and geography may make contact easier. Residents must still choose friends, collaborators, routines and disputes. A tradition is a practice residents repeat and recognize, not a weekly event imposed by the viewer.

### A concrete town premise to test

Propose a **shared commons** for a fresh local experiment, using the same twelve residents. Keep personal homes and interests. Arrange three useful shared places around one walkable center: a workshop with useful tools, a kitchen/common table and a sheltered meeting space. Keep expansion land outside this core.

The intervention is access and usefulness, not a compulsory schedule. A resident can work alone, visit a shared tool, invite someone, sell or give an output, decline an invitation or change a plan. Aspirations remain resident-chosen. Do not insert “host tonight” into everyone’s prompts or assign the same community objective to the cast.

Compare this initial layout and inventory with the current comfortable, dispersed baseline in separate fresh local worlds. Do not rewrite existing residents’ history or silently remove their property. Keep model, call budget and run length matched. Count voluntary venue use, repeated encounters, distinct activity results and meaningful follow-through, then read the actual exchanges. One successful run is a demonstration, not proof of reliable emergence.

This is the deeper alternative to another facade pass: organize the medium around places that support choice and contact. Start with existing building and action primitives. No town-wide economic rewrite is required.

### 4. A smaller semantic burden for minds

Keep physical geography, doors, collision, ownership, materials and useful work. These give choices consequences. Let deterministic code handle the intermediate route and valid work steps after a resident chooses an activity.

| Keep physical | Simplify | Leave out of this redesign |
|---|---|---|
| Reach, travel and who can meet | Long uninteresting execution sequences, represented through plans and visible milestones | Per-footstep decisions, furniture rigid-body simulation, road wear |
| Room boundaries and privacy | Public venue interactions built from existing actions | A new general economy or hundreds of needs |
| Objects, transfers and construction | Grounded inspection and delivery activities | More decorative world systems without a chosen use |
| Interrupted work and meaningful failure | Repeated unavailable-action reasoning | A new engine, 3D residents, Jev adoption |

Do not globally speed time to cover dullness. Measure travel, model waiting, scene reading and work separately. They need different fixes. Work duration should be long enough for a visible process and a possible interruption, without making the only observable behavior a stationary sprite.

### 5. Better model use, measured against behavior

Spend reasoning on choices, social turns and meaningful failures. Continue deterministic plans without a new call for every step. Reconsider after relevant evidence changes, not because the viewer needs another bubble.

Streaming is an experiment with a specific latency question, not the centerpiece. Never execute partial JSON or treat provisional words as a public fact. Existing trials did not establish a consistent useful gain. Jev remains a separate experiment, as requested.

Evaluate semantic progress: new information, a choice, a refusal, an action taken or a consequence acknowledged. More tokens, more scenes and fewer silent ticks are diagnostic counters, not success criteria.

## Art, motion, sound and performance

Presentation should make physical acts readable. A held item, changing workpiece, completed latch or shared table tells a story with fewer words. Add a small set of reusable motions with proper facing and interruption behavior. Do not commission a large animation library before one complete scene works.

Keep personal homes and atmospheric weather. Design public rooms with readable work and conversation areas. A cutaway should show the actual occupied room while preserving the town’s time and weather context. Window light, work light and fire should reinforce use, not compete with faces and text.

Use sound for a few legible events: a footstep on stone, a tool strike, a latch, a soft milestone cue and weather with a controlled noise floor. Silence is an intentional option. The listening check must include headphones and quiet volume, since a technically running soundscape can still sound like static.

Stay with Three.js. First reduce offscreen work, repeated scene reconstruction and unnecessary UI updates. Lower idle rendering activity without lowering the quality of active scenes. Compare the same recording, viewport, hardware and settings before claiming a battery gain. DOM caption layout should not force a render of the whole journal on every tick.

Accessibility is part of the composition: adjustable caption size, named speakers, reduced motion, keyboard focus, pause/recorded viewing and readable contrast. At mobile widths, use a single column and a dedicated caption area. Never shrink desktop overlays until they are unreadable.

## Architecture and scope

```text
Residents choose intentions and actions
               ↓
Existing deterministic world and authoritative event log
               ↓
Existing public projections + a small causal situation projection
               ↓
Existing director selects one coherent scene
               ↓
One presentation decision
  camera / room / cast / context / current line / supported change
               ↓
Watch view       Journal       Recorded chapters
```

Nothing in the viewer sends story priorities to the minds. A story selection cannot alter a plan. Public narration cannot reveal private facts to residents. A chapter is a view over recorded state, not a rewritten world.

Repository seams to reuse:

| Work | Existing seam |
|---|---|
| Causal story identities | `packages/gateway/src/threads.ts`, `packages/shared/src/threads.ts`, existing commitment and event projections |
| Camera and scene ownership | `packages/web/src/ui/directorCut.ts`, `DirectorMode.tsx`, `stageCue.ts` |
| Scene context and transcript | `packages/web/src/stage/LivingScene.tsx`, gateway scene transport |
| Balloons and physical presence | `packages/web/src/render/pixelBubbles.ts`, `conversationPresence.ts` |
| Journal and return context | `packages/web/src/paper/game/`, existing keepsake and cursor code |
| Chosen semantic activities | Existing agent plan pump, scene exit plans, engine verbs and arbiter recipes |

Do not add a second narrator, parallel scene store or generic event bus. Extend the minimum existing interfaces needed for the first scene. Delete obsolete renderers once their chosen replacements cover their cases.

## Implementation sequence after design selection

This is a scope proposal, not a claim that these stages have shipped. Detailed SWE tasks should be derived from the selected direction.

### First prove the experience

1. **Trace one real story end to end → verify:** identify public intention, all dialogue, actual plans, physical results and unresolved claims. Use the latch and a second indoor relationship exchange. Label all missing evidence.
2. **Implement one coherent presentation → verify:** fix indoor replay selection, establish the scene, show compact context, hold the exchange and display only the proven result. Match live and replay locations.
3. **Repair the behavior boundary → verify:** reproduce one unsupported or repeated promised action, fix its plan/affordance path, and demonstrate acceptance, refusal, interruption and failure with tests.
4. **Show the same ten-minute recording to unfamiliar viewers → verify:** they can describe who wanted what, what changed and what remains open without opening the journal.
5. **Run a bounded autonomous rehearsal → verify:** the same mechanisms work on new choices rather than a specially chosen scripted success. Keep all provider spending inside the remaining approved budget.

### Then complete the product

1. **Integrate the selected shell and journal → verify:** desktop, mobile, indoors, replay and reconnect all preserve one scene and one input owner.
2. **Add causal following and return chapters → verify:** source-linked history survives restart, historical cutoffs and changed intentions without private-data leaks.
3. **Pilot one useful venue → verify:** residents autonomously choose to use, decline or abandon it. Scripted action execution alone does not pass.
4. **Polish movement, sound and performance → verify:** same-recording comparisons and real listening, with declared hardware and settings.
5. **Run a human viewing trial → verify:** capture comprehension and reasons to return before considering production. Production approval remains separate.

The first release should be deliberately narrow: one excellent default Watch experience, Explore, the journal and recorded catch-up. Defer audience control, complex commerce, narrated voiceovers, generalized seasonal campaigns and model replacement.

## Definition of success

The following are proposed acceptance checks. They are not measured results or guarantees of retention.

| Check | Proposed method | Failure means |
|---|---|---|
| First-minute comprehension | Five new viewers watch without instruction. Ask who is involved, what is unresolved and why it matters. Aim for at least four to answer accurately. | Rework context or scene selection before adding features. Small-sample usability evidence only. |
| Ten-minute meaning | Ask viewers to name a real change and a person they want to follow, with their reason. Compare the same recording in the current and proposed views, counterbalancing order. | The new UI is clearer but may still lack attachment or consequence. |
| Continuity | Review scenes with long replies, indoor moves, interruption, parallel exchanges and provider delay. | Presentation ownership or timing is still fragmented. |
| Truth | Every factual story claim has public evidence at its timestamp. Include a lie, a private aside, two unrelated promises and an abandoned plan. | Stop: the lens is inventing the town. |
| Semantic progress | Human-label a bounded new run for new information, choices, repetitions and physical follow-through. | Repair the behavior that produces repetition rather than hiding it under better art. |
| Return value | Revisit after another simulated day. Ask what changed for a followed person and which unresolved situation they remember. | History is stored but not presented as a continuing experience. |
| Performance | Compare the identical scene on the same MacBook and mobile device. Record frame-time distribution, CPU/GPU activity and asset memory. | No claim of efficiency gains until the matched comparison improves. |

Longer voluntary viewing and real return visits are later product outcomes to measure with consent. Session length alone can reward a confusing interface. Do not substitute it for understanding or enjoyment.

## Research informing the proposal

The sources below guide design choices, not retention forecasts.

- [Cheung and Huang, Starcraft from the Stands, CHI 2011](https://jeffhuang.com/papers/StarcraftSpectator_CHI11.pdf). Spectator research distinguishes difficulty understanding from lack of investment and describes suspense through information differences. Our inference: reveal relevant context, not every thought or the eventual answer.
- [Michael Booth, The AI Systems of Left 4 Dead, Valve](https://cdn.akamai.steamstatic.com/apps/valve/2009/ai_systems_of_l4d_mike_booth.pdf). Its pacing alternates intensity and recovery. Its director changes threats, so it is not direct evidence for a camera-only solution. Our inference: preserve coherent beats and breathing room without manufacturing adversity.
- [Park et al., Generative Agents](https://arxiv.org/html/2304.03442v2). Memory, reflection and planning supported evaluated believability and coordinated behavior in a bounded study. Our inference: test whether intentions survive into later behavior. The study does not prove indefinite cultural growth or watchability.
- [Cheung et al., The First Hour Experience](https://www.microsoft.com/en-us/research/publication/the-first-hour-experience-how-the-initial-play-can-engage-or-lose-new-players/). Its evidence concerns players and early engagement. Applying its emphasis on intrigue and information to passive spectators is a hypothesis, not a demonstrated transfer.
- [Xbox Accessibility Guideline 104](https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/104). Speaker identification, caption readability and configurable presentation support the single-speaker caption fallback and responsive text layout.
- [Twitch Channel Points Predictions](https://help.twitch.tv/s/article/channel-points-predictions?language=en_US). This establishes an available audience mechanism, not evidence that San Junipero needs it. Participation and eligibility constraints apply. Keep it a later experiment.

Local evidence: `docs/reviews/2026-09-21-continuity-rehearsal.md`, `docs/reviews/2026-09-21-v3-viewer-verification.md`, `docs/reviews/2026-09-21-system-audit.md`, the current v3 SWE plan and the proposal’s `scene-evidence.json`.

## What to decide now

Choose the default viewing model: A, B or C. My recommendation is A, including the explicit delayed/recorded playback contract, with C’s catch-up as a later part of the same experience.

The important approval is not the exact shade of paper. It is whether San Junipero should actively present a coherent, truthful scene to the viewer, rather than asking the viewer to discover why a town full of independent actions matters.

# San Junipero: a living town worth watching

Architecture, physics, minds and spectator audit. 21 September 2026.

## Decision

Keep the town, Three.js presentation, deterministic engine, event history and bounded arbiter. Change the unit of attention from individual acts and dialogue lines to resident intentions and their consequences. Make those consequences legible to a spectator who has just arrived.

The present design is viable, but its investment is uneven. Physical maintenance has more explicit machinery than keeping a promise. Conversations produce more words than the viewer can display. Cultural recognition can mistake traffic for a gathering. A prettier interface or cheaper model cannot repair those gaps alone.

My recommendation is to complete the existing hybrid: residents choose meaningful activities, existing code executes physical steps, a bounded decision model can handle selected judgments, and a generative model still creates plans, expression and new ideas. Named targets, action chaining and a plan executor already exist. The absent contracts concern continuity and presentation, not a need for a second planner. The observer selects and explains real events. It does not command drama.

## Evidence and limits

This review includes current source, earlier recorded rehearsals, read-only production inspection, live browser observation, primary-source research and independent specialist reviews. The inspected production run was active, with twelve residents. It was still its first simulation day during the measured sample. We did not change production or make paid research calls.

| Evidence | What it supports | What it does not establish |
|---|---|---|
| Production ledger at 01:48:30 UTC, tick 791 | 448 calls, $0.4546985183 recorded cost; ordinary turns averaged 3.6 seconds, scene lines 2.8 seconds, arbiter calls 51.1 seconds | Daily cost, Jev savings, or long-term quality |
| 120-tick speech window | 79 speeches in about six real minutes at speed one, 55 indoors | Thirteen minutes of continuous readable entertainment, or thirteen independent stories |
| Live browser and event traces | Indoor conversation and physical actions work; joining and display discard some context | Full-session retention or every viewer's experience |
| Local pure-function probes | False gathering detection and cross-caller budget reservation gaps | A resulting incident already happened in production |
| Existing mocked tests and historical rehearsals | Many engine, persistence and integration paths work | All new audit findings are fixed, or the product is engaging |

The reports below contain exact code paths, measurements and proposed checks. This is a broad system audit, not a claim that every line or every multi-day interaction has been exhaustively verified.

## 1. The product is more than a simulation

The goal is a continuing ensemble town: people viewers recognize, plans they remember, relationships that change, places with history, and unresolved situations worth returning to. The critical chain is:

```text
resident cares about something
  → makes a choice
  → acts or negotiates
  → encounters a consequence
  → remembers or revises the intention
  → another person responds
  → viewer understands what changed and what remains open
```

San Junipero has pieces of this chain. Its seams are weaker than its individual pieces. More ecology, faster inference or more lines of dialogue will not compensate for a broken handoff from one piece to the next.

Autonomy and constant spectacle are different promises. A resident may choose to rest, fail, avoid a conversation or repeat a routine. If those freedoms matter, the live world cannot guarantee a dramatic event every minute. The product can still provide a coherent live scene, a labeled recent chapter, and a clear reason to care about what happens next.

This is also a medium issue. A Twitch viewer watches a video frame, often on a phone. They cannot open the journal, click a resident or recover a missed balloon. The interactive website and passive broadcast should use the same facts, but they need different amounts of context on screen. Hidden journal depth cannot carry the whole broadcast.

## 2. The physical world: keep consequences, reduce micromanagement

There are 26 ordered world systems. They include weather, fire, crops, fauna, food spoilage, needs, warmth, thirst, illness, reproduction, aging and movement. This is a discrete rule simulation, not a general Newtonian physics engine. Three.js presents the world; replacing the renderer does not solve resident decisions or social continuity.

| Medium | Strength | Main loss or risk | Recommendation |
|---|---|---|---|
| Current tile world as the primary mental interface | Routes, construction and encounters have concrete spatial causes | Residents and viewers spend attention on low-level handling and travel | Keep the executor, simplify what minds must manage |
| Places and activities as the whole world | Easy to express meetings, work, invitations and arrival | Migration cost; weaker geography and incidental encounters; movement may feel decorative | Useful isolated comparison, not a justified rewrite |
| Semantic activities executed in the current world | Meaningful decisions with visible physical consequences | Two competing truths if logical activity and physical state diverge | Recommended, with the event log as the single authority |

For example, “help Farida stack the wood after supper” is a useful intention. The body can execute walk, enter, take and stow through the existing plan machinery. The mind should reconsider if Farida refuses, the wood is gone or something more important occurs. It should not need to rediscover the next routine step every few seconds.

Keep space, travel time, room boundaries, capacity, ownership, materials, useful tools, shelter, building progress and actual damage. They provide choices and consequences. Abstract their routine execution. Do not add harder hunger, more illness or extra disasters merely to generate activity. Production already softens survival, and unmet ordinary needs do not directly kill residents.

Some detail can stay as background world state without being repeated in every prompt or caption. A mechanic earns attention when it changes a resident's decision and a viewer can understand why. A hidden quantity that never changes a meaningful choice is a candidate for simplification after measurement, not an automatic reason to delete an otherwise working system.

Time needs deliberate product treatment. At a fixed three seconds per simulation minute, a day takes 72 real minutes and a 28-day year takes 33.6 real hours. Actual pacing varies: the gateway already supports faster time when everyone sleeps and slower time without viewers. These are calculations at 1×, not observed daily durations. Population aging, projects, memories and returning-viewer catch-up must work on the same intended timescale.

Recipe durations also differ: the live house recipe takes 240 work ticks, or twelve real minutes for one uninterrupted worker before modifiers. Cottages take 5.4 hours and farmhouses 7.2 hours at 1×. This may be intentional, but viewers need progress and residents need reliable resumable plans. An unfinished project can be a return reason; unexplained stillness cannot.

### Concrete physical inconsistencies

The physical audit found inconsistent wall enforcement in current source. Giving checks coordinate adjacency without requiring the same room. Taking structure-held items, and some outdoor storage actions, accept proximity to any side of the footprint. An actor with a known item ID can therefore satisfy reach beside a rear wall without entering. These paths were source-verified, not reproduced as incidents in the live town. Repair shared reach rules and recheck transfers at completion; ownership and the ability to steal accessible goods are separate questions.

Indoors already uses some room-level abstractions rather than a proximity check for every furnishing. That can be appropriate for this product. The essential requirement is consistency: what the mind can do, what the engine accepts and what the viewer sees should agree. A more detailed furniture collision model is not automatically better.

The economy also contains intentional abundance. Generic forest foraging produces seasonal berries repeatedly without depleting a patch, whereas named patches have finite stock. At current baseline decay, one bread can restore up to five real hours of hunger loss at 1×. Wheat takes 9.6 real hours to mature. These calculations do not prove broken balance, but they show why farming and food trade need not become necessities.

A comfortable social town is a valid choice. It means recurring activity must come from residents' interests, projects, exchanges and relationships rather than repeated survival emergencies. Do not add encumbrance, seed accounting, hunger pressure or monetary machinery unless a specific desired interaction needs it. Useful interdependence can come from an actual crafted item, a shared place or a voluntary promise, without making everyone grind for food.

## 3. Minds work, but speech and action can diverge

The architecture already has event-driven waking, per-mind in-flight guards, multi-step plans, reconsideration times, persistent memory, reflection, relationships and coordinated conversation turns. It does not buy an LLM call for every rendered footstep. Replacing it with another agent framework would duplicate functioning work.

The observed problem is narrower. Conversation opening stops walking, and the conversation turn contract asks for words rather than a new physical action. Existing work and queued plans can continue during conversation. At closure, summaries and relationship ties are stored. That does not necessarily create a next plan or a due reminder.

| Current gap | Consequence | Smallest useful correction |
|---|---|---|
| Ordinary prompts keep only two ties per visible person, oldest first | Kin and an old promise can exclude the new promise | Keep kin separately; prioritize unresolved actionable ties |
| Promises lack due conditions and linked action evidence | “After supper” can be remembered as prose without an actionable reminder | Extend the existing commitment record only as needed; feed it to the existing reconsideration path |
| Settling a person/kind can settle multiple records | One repayment can erase unrelated obligations | Settle a specific commitment with provenance |
| Every non-kin tie expires after seven days | A still-future promise can expire and be labeled broken | Distinguish forgetting, completion, cancellation, expiry and an actual missed promise |
| Conversation turns and physical plans are separate | “I will do it now” may lead to another words-only exchange | Let the resident choose a next action or plan at a natural exit |
| Routine turns can be 45 real seconds apart at 1× when idle | A short action followed by no plan can produce visible waiting | Prefer a coherent plan and meaningful wake conditions over global faster polling |

Bashir and Farida repeatedly discussed food and wood in the production sample. Bashir did perform nineteen take, stow, drop and indoor-movement actions in the inspected interval. It would be false to say they did nothing. The problem is repetition, weak intention priority and poor communication of progress. The sample was before supper, so it does not prove that an after-supper promise was broken.

A stored commitment should remind, not compel. Residents must be able to postpone, refuse, forget, change their minds or betray someone. Those choices become interesting when the other person can notice and respond. Automatically executing every spoken promise would replace agency with a script.

### Long-run memory has additional broken handoffs

The continuity pass found more than prompt tuning opportunities. These findings were independently checked against current source:

| Finding | Why it matters | Narrow correction |
|---|---|---|
| Nightly goal generation sees today's summaries but not the previous goals, then replaces the active list | A quiet day can drop a long project without an explicit decision to abandon it | Pass prior unresolved goals to the same reflection step; retain, revise or resolve each |
| Extracted facts and stored summary nodes have no normal retrieval consumers | Some paid memory work does not help later decisions; source memories remain searchable | Remove unused extraction or give it one specific source-linked consumer; do not add another memory framework |
| Only seven autobiography entries enter the normal prompt; recall searches source memories instead | Older identity-relevant history competes with recent context despite remaining stored | Test recall of defining events and unresolved commitments before increasing context size |
| Body age changes, but ordinary and scene identity prompts retain the initial age | A resident can physically become adult while the mind is still told its childhood age | Derive current age from authoritative body state in both paths |
| The personality-change gate can omit a bereavement-only day | A consequence that should permit reflection may not reach the edit proposal | Admit relevant witnessed events through the existing gate, preserving the option not to change |

Birth is also an abstraction: new bodies begin at age twelve. Inherited persona traits come from parental seed specifications, not their current learned personality versions. These are design policies, not missing infant physics. If learned cultural inheritance is desired, either teach through actual interactions or snapshot selected current parental state at birth, preserving deterministic replay.

Private knowledge needs an end-to-end check. The ordinary scene-turn path correctly removes other residents' private asides. The scene-close model, however, receives all asides before producing a public summary that also becomes shared memory. No actual leak was observed in this review, but a prompt instruction is weaker than excluding private material from the public-summary input.

## 4. Culture needs accurate evidence and transmission

The most serious emergence finding is a reproducible evidence error. The custom detector combines visits by place and day. Three people visiting separately at 06:00, 10:00 and 14:00, each leaving after a minute, are counted as a shared gathering. Repeating this for three days produces three gatherings even though they never meet.

The derived habit text can then enter minds' prompts and eventually describe a tradition. This creates a feedback loop from observer error into resident belief. Counting a busy location is useful; calling it a shared custom requires different evidence.

Keep these categories distinct:

| Category | Example | Authority |
|---|---|---|
| World fact | Three residents ate together at the same table | Engine events and actual co-presence |
| Resident belief or claim | Amara calls it their Thursday supper | Her recorded words or memory |
| Observer interpretation | This may be becoming a regular gathering | Explicitly tentative, linked to evidence |
| Social agreement | Two residents agreed to host next week | Their recorded assent, with scope |

Related tensions are deliberate policy choices, not all accidental bugs. Some laws physically refuse acts rather than allowing disobedience. A later conversation can automatically become a council about a tabled law. A proposer with everyone else unsure can pass a proposal. These choices should be revisited against the goal of voluntary institutions.

Likewise, speaking most is not proof that others defer to someone. Globally available discovered verbs are convenient mechanics, but they are not evidence of teaching or cultural transmission. A place should be able to gain several uses, and residents should be able to dispute its meaning.

The prompt also bans invented sayings, wordplay and several expressive forms while favoring silence. These restrictions were added to address real loops and fabricated conditions. Removing all grounding would reintroduce those failures. Replace universal voice suppression with dated factual grounding, individual expression and detection of repetition without new information.

LLMs do not need their weights to change for residents to develop. Persistent experience, revised goals, relationships and reusable skills can change later behavior. But storing a memory is insufficient: it must be retrieved at a relevant decision and affect what happens next. That is the growth to measure.

Several public indicators also use proxies. Speech frequency can increase a friendship score even if the words express disagreement. Story threads merge by overlapping cast and can close after two days without activity. Those are useful editorial signals, not objective affection or persistent identities for a specific promise. Daily narration has limited historical callback context. Link meaningful callbacks to prior events rather than assuming a heat score or valid citation proves the prose's interpretation.

## 5. The arbiter and Forge cannot turn every noun into a mechanic

The bounded arbiter is a strength. It checks existing rules and semantic precedent before a novel ruling, validates effects, and records reusable capabilities. It does not execute arbitrary generated JavaScript. Keep that boundary.

The current town can learn a buildable alehouse recipe, gather its materials, raise it, enter it, store objects and talk inside. Forge supplies wood and roof textures over procedural geometry. That is real construction, but a name and texture do not supply brewing, service, prices, opening hours or staff roles. An invented item name also does not automatically make it edible or drinkable.

A functional venue needs a small set of real affordances. Start with one venue end to end, such as a shop where a resident stocks actual items and chooses whether to accept exchanges. Reuse inventory, ownership and transfer. Add one missing primitive only when that example needs it. Do not build a universal economy or institution framework first.

The same distinction applies to appearance. Personally authored homes have special design profiles. New Forge buildings currently receive generic geometry and material variation. Richer generated facades need a bounded geometry recipe with doors, windows and footprint agreement; texture generation alone cannot create that structure.

The measured arbiter is also the slow lane: ten calls averaged 51 seconds, with two output-limit failures lasting roughly two minutes. Some intents were routine wood handling. Inspect why they reached expensive novelty adjudication, then compare narrower or lower-reasoning handling on recorded cases. An additional generic cache is not the answer: exact and semantic caches already exist.

## 6. Jev is useful, but not a complete resident brain

TypeSafe's current Jev 1.13 offers bounded choices and scoring rather than free-form generation. Its documented price is $0.042 per million input tokens, with free output. The vendor documents limitations in arithmetic, dates, indirection, irrelevant context and adversarial input. Keep exact calculations and validation in code. [Models](https://docs.typesafe.ai/models), [limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13).

| Responsibility | Best initial owner |
|---|---|
| Reach, eligibility, resource arithmetic, action execution | Existing deterministic engine |
| Interpret a relevant interruption; select among complete feasible actions | Jev candidate, evaluated before adoption |
| Create an ambition, plan, reflection, explanation or new social expression | Generative LLM |
| Give a new physical idea repeatable effects | Bounded arbiter and validators |
| Select and explain recorded events for viewers | Existing observer pipeline, improved for continuity |

“Jev brain, LLM mouth” is too restrictive. A choice model cannot select a new idea that no candidate generator supplied. A purely bounded controller can become a closed behavior tree with fluent dialogue. Preserve an explicit path to deliberation, including periodic reflection, even when routine choices have high confidence.

Use one committed intention for body and voice. Supply whole candidates such as action plus target and object. Independent answers for each parameter can form an invalid combination. Revalidate against current state before acting. Confidence is not proof that the candidate set was complete. [TypeSafe workflow guidance](https://docs.typesafe.ai/concepts/how-to-build-with-system-one), [confidence](https://docs.typesafe.ai/confidence).

Candidate creation has a cost. If an LLM must invent all options first, a Jev call may add work rather than replace it. If code supplies the options, it bounds what residents can consider. Compare against the existing deterministic wake rules before inserting inference into routine continuation. Pass only the resident's available knowledge, not the observer's omniscient town state.

At an assumed 2,000 billed input tokens per decision, 10,000 decisions cost $0.84. Twelve residents deciding once per real minute for 24 hours cost about $1.45 for Jev alone. Deciding every three seconds costs about $29.03. These exclude generative work, art and infrastructure. Cheap inference still rewards event-driven execution over polling.

The current finite run cost less than $0.46. Jev may help responsiveness and future scale, but money was not the immediate failure in that sample. No Jev benchmark from the deployment region or integrated town comparison has been run. The [detailed Jev report](2026-09-21-jev-research.md) separates vendor claims, arithmetic and proposed evaluation.

## 7. The viewer loses real activity

The gateway's initial greeting sends the world and director, but not the current open scene. Its scene relay also lacks startup priming. A newcomer can follow a conversation without receiving the state needed to explain it. Earlier dialogue is not backfilled into the current-visit transcript.

The map has one active balloon. Speech without a current visible anchor is discarded, another scene can be filtered out, and the queue drops older lines when full. In one production conversation, twelve lines arrived in about 39 seconds. A typical balloon takes about eleven seconds to type and remain readable. That display cannot keep up.

Do not slow the whole simulation to match a balloon. Keep a bounded transcript independent of camera visibility, show immediate speech as current, and label catch-up as recent. A camera entering a room should recover context. It should not display an old queue as if every line were being spoken now.

The director already has event weights, scene holds, hysteresis and quiet beats. The journal, story threads and narrator also exist. The needed work is to connect them coherently. Heat and dialogue keywords can help choose a shot, but they do not establish a causal story or prove a payoff occurred.

Recommended presentation modes, all using the same truth:

| Mode | What a watcher receives | Role |
|---|---|---|
| Living documentary | One legible scene, current action, relevant earlier fact and unresolved next step | Default passive view |
| Follow a life | One resident's authored intentions, actual progress and relationship changes | Attachment and exploration |
| Town chapters | Short sequences of real recorded events, clearly marked as earlier | Catch-up and worthwhile short visits |

These are concepts to compare using one recorded event history before committing to another visual redesign. The existing approved colors, homes, icons and town remain useful. The change is information hierarchy and continuity, not a new skin.

## 8. Gamification should deepen attachment

A study of 1,097 Twitch users associates viewing with information, affective, social and relaxation motives; social motives were the strongest subscription predictor in that study. It is correlational research about game streams, not proof of retention for an autonomous town. My inference is to invest in recognition, anticipation and shared moments before extra badges. [Sjöblom and Hamari](https://research.aalto.fi/en/publications/why-do-people-watch-others-play-video-games-an-empirical-study-on/).

| Viewer experience | Useful game-like treatment | Avoid |
|---|---|---|
| “I know these people” | Follow residents; concise changes since last visit | Forcing twelve profiles before anything makes sense |
| “I wonder if they will do it” | A real announced plan or unresolved promise | Manufactured cliffhangers or guaranteed outcomes |
| “I saw that happen” | Evidence-linked keepsakes and meaningful firsts | Rewarding every line, click or location visit |
| “We remember this place” | A location history with actual names, gifts and recurring uses | Declaring a tradition from a traffic counter |
| “I can discuss this with others” | Shareable scenes and optional audience predictions | Letting undisclosed audience pressure decide resident behavior |

The return loop should be: recognize someone, understand what they want, witness a consequence, anticipate the next choice, and catch up when returning. It is not a daily login chore or a quota of dramatic events.

Optional audience participation should initially affect the lens, such as which resident to follow. Letting viewers control residents, vote on disasters or inject instructions changes the premise and creates additional trust and moderation problems. It is not required to make the current town watchable.

## 9. What research actually supports

Tynan Sylvester's argument is directly relevant: implemented complexity has value when the audience can construct an understandable model from it. This supports selecting visible consequences, not adding systems by default. [The Simulation Dream](https://tynansylvester.com/2013/06/the-simulation-dream/).

Generative Agents supports the joint value of memory, planning and reflection. Its party coordination starts from a seeded intention and is not a demonstration of indefinite autonomous entertainment. [Paper](https://arxiv.org/abs/2304.03442).

Project Sid identifies speech/action incoherence and uses shared state to coordinate processes. Its institutional and religious experiments include supplied rules and seeded advocates. It does not prove civilization arises from unconstrained agents or that viewers will return. Borrow the coordination lesson, not its entire architecture. [Technical report](https://arxiv.org/html/2411.00114v1).

Valve's director controls threats to produce alternating intensity and relief. Our compatible lesson is pacing the presentation of genuine events. Injecting trouble because the stream is quiet would be a different product. [Valve's AI design presentation](https://cdn.akamai.steamstatic.com/apps/valve/2009/ai_systems_of_l4d_mike_booth.pdf).

These sources narrow the design hypotheses. None removes the need to watch real people watch this town.

## 10. Reliability findings separate from design choices

| Finding | Evidence level | Required correction or decision |
|---|---|---|
| Some object/person interactions bypass room boundaries | Source-confirmed; live occurrence not measured | Consistent room-aware reach and completion checks |
| Town-wide budget is checked periodically, while reservations are per caller | Reproduced locally: two callers each reserve $0.75 against an intended $1 ceiling | One atomic shared allowance, including image work; retain caller sub-limits |
| Forge queues are outside mind shutdown cancellation/drain | Confirmed source path; no production incident reproduced | Stop new art work and settle/account for in-flight work before closing stores |
| Global daily stop remains latched | Confirmed code behavior | Show truthful mind state and reason; automatic resumption is a policy choice |
| Deferred art waits for another trigger or restart | Confirmed retry design | Bounded retry integrated with the existing lifecycle |
| Unbounded land growth and growing stores/prompts | Confirmed design; exhaustion not measured | Measure growth before raising population or viewer limits |

Persistence and replay are substantial strengths. Current source includes prior graceful-stop, reflection-cancellation and ledger-preservation fixes. Cross-store crash consistency still deserves injected-failure checks at known boundaries, but this audit did not reproduce corruption. No new database platform or worker fleet is justified by the evidence.

The owner declined an off-server backup bucket. That accepted durability choice is not being reintroduced as an approval gate.

## 11. Recommended order

1. Repair truth and delivery. Fix current-scene catch-up, retain recent dialogue, correct false gathering evidence, fix commitment identity and goal continuity, synchronize prompt age, enforce room boundaries consistently, and close budget/art lifecycle gaps. Check with recorded events and fake providers.
2. Complete one causal loop. Use existing residents and a real intention, follow it through action or refusal, preserve the result, and show its later effect. Check continuity rather than a speech quota.
3. Compare three presentations of the same run. Wide town, living documentary and a recorded chapter. Check who a new viewer remembers, what they think is happening and whether that account matches events.
4. Trial one bounded Jev responsibility. Compare interruption decisions or candidate selection on recorded states, then a local fork if warranted. Check whole-system cost, latency, individuality and creative escape paths.
5. Expand only from observed limits. Add one functional venue or social affordance that residents repeatedly attempt. Check persistent use and consequences before a larger economic or institutional system.

The project already has broadcast readiness criteria, including ten unattended minutes, readable captions, reconnect truth and understanding a subject within ten seconds. Preserve those. A numerical font-size check does not itself prove human readability, and a test suite does not prove that a story matters.

For the next product comparison, use ten-minute sessions and ask: who interested you, what did they want, and what changed? Record actual returns later. Track scene-context coverage, lost dialogue, repeated exchanges without new information, relevant commitment retrieval, completed consequences and cost. Separate inability to act, lack of desire, forgetting, bad execution and hidden presentation. They need different fixes.

## Implementation status from the earlier local repair task

Local, uncommitted work includes dock-only journal behavior, mobile drawer handling, interior camera-header separation, the Controls title, current-asset loading, terrain/update optimizations, quieter procedural audio and a public aggregate usage meter. Focused automated checks were reported by their implementation lanes. The combined frontend build passed. The local-only service was restarted; its usage endpoint reports scripted zero usage, and the browser progressed from asset loading to the rendered town with the usage badge visible. Full interaction, mobile and listening review remain pending.

Character hover/click affordance, remaining balloon whitespace, live scene catch-up and a complete viewer-context redesign are not claimed fixed in this audit. No speculative mind, culture or physical-law change has been deployed. The expanded research request was handled before choosing those larger behavior changes.

## Companion evidence

- [Minds, live production and viewer delivery](2026-09-21-minds-visibility.md)
- [World rules, culture and detector reproduction](2026-09-21-world-architecture.md)
- [Physical affordances and economy](2026-09-21-physics-economy.md)
- [Memory, relationships and long-run continuity](2026-09-21-continuity-culture.md)
- [Forge, budgets, shutdown and growth](2026-09-21-forge-operations.md)
- [Medium and engagement research](2026-09-21-medium-and-engagement.md)
- [Jev capabilities, costs and pilot](2026-09-21-jev-research.md)
- [Independent challenge of the findings](2026-09-21-audit-skeptic.md)

# Medium and engagement review — 2026-09-21

Recommendation: test a place-and-activity model for agent decisions inside the existing visual town. Keep spatial consequences. Do not replace the renderer, invent a narrative director, or expand survival physics before this experiment.

Independent local code review and primary-source research. No production mutation, paid mind call, engine change or audience experiment was performed. Code observations below are facts; product recommendations and expected benefits are hypotheses, not measured retention gains.

## The product decision comes before the engine decision

An autonomous town, a beautiful aquarium and an entertaining live show are three different promises. The first can contain long uneventful periods; the second makes them pleasant; the third must help a late arrival understand people and unfinished situations. Keeping one fixed wide camera on autonomous motion does not satisfy the third promise by itself.

The recommended medium is a continuing ensemble town: stable residents, recognizable places, voluntary projects, repeat encounters and visible consequences. The town remains explorable, but the default viewing experience follows a legible situation. A viewer should understand what someone wants without inspecting twelve profiles or reading every model response.

| Option | What it makes easy | Cost or risk | Verdict |
|---|---|---|---|
| Continuous tile simulation as the primary interface | Construction, routes, reach, hazards, visible continuity | Agents and spectators spend attention on travel and body maintenance; proximity is a fragile substitute for shared intention | Retain its useful consequences, stop treating it as the whole product |
| Place/activity graph as the whole world | Appointments, gatherings, roles, access and commitments; deterministic arrival/completion times | Weaker geographical causality; travel can feel like teleportation; replacing existing state/replay has substantial unmeasured migration cost | Good isolated prototype, premature whole-world replacement |
| Hybrid: semantic decisions with physical execution | Residents choose people, places and activities; existing engine handles movement, materials and outcomes; camera presents scenes | Two representations can drift if both become authoritative | Recommended experiment; one authoritative event log and explicit mappings |

“Hybrid” need not mean two simulators. First offer an intention such as “join Yusuf at the workshop,” resolve it into existing walk/enter/interact actions, and preserve interruption reasons. A later change to offscreen movement is justified only if traces show navigation remains the bottleneck; it must preserve travel time, encounters and resource consequences consistently.

## What is actually simulated now

`packages/engine/src/worldTick.ts:186–214` registers 26 ordered systems, including weather, fire, crops, wildlife, fauna, spoilage, needs, warmth, thirst, health, illness, paths, reproduction, aging, action progress and sight. `worldTick.ts:246` invokes each system per world tick; individual systems can gate their own work. This count is not a CPU profile and does not mean all 26 do meaningful work every tick.

`worldTick.ts:49–103` already gives actions deterministic progress, moving-target pursuit and chained actions after travel. This is a useful executor beneath a higher-level intention. It is not necessary to ask an LLM how to advance every footstep or finish an already chosen work action.

| Keep authoritative | Abstract or hide from routine decisions | Remove from this product direction unless evidence earns it |
|---|---|---|
| Identity, dated memory, public events and replay | Routine travel as destination, arrival and interruption | New survival subsystems added only to make something happen |
| Rooms, access, reachable objects and building footprints | Body numbers as actionable conditions, while keeping raw debug state | Road wear as an engagement feature; Orchard already disables it |
| Material transfers, building progress, genuine damage | Off-camera repetitive work as truthful progress/completion | A classifier declaring culture or authority from counts alone |
| Relationships, witnessed commitments and consequences | Routine ecology and inventory minutiae outside relevant scenes | Extra model calls whose only output is restating current status |

The current rules already soften survival: `packages/shared/src/config.ts:5–26` sets hunger decay to 0.005 per tick, and `config.ts:460–488` defaults `needsKill` to false. `packages/town/src/devWorld.ts:326–327` disables desire paths for Orchard. Reintroducing scarcity, road wear or constant illness would contradict this direction rather than repair social depth.

Do not delete working physics merely because it is not shown every minute. A roof matters when it provides shelter; a scarce material matters when someone must choose whom to help. A mechanic earns its place when its consequence can change a decision and become understandable to a viewer; raw system count is not a quality metric.

## What primary sources support — and what they do not

Tynan Sylvester distinguishes the implemented simulation from the model the audience constructs. Hidden complexity can fail to contribute to experience, while sparse visible behavior can invite interpretation. This supports selecting understandable causes, not building a more complete world by default; it does not license this project to present invented dialogue as an agent's actual choice. [The Simulation Dream, author essay](https://tynansylvester.com/2013/06/the-simulation-dream/).

His GDC presentation prioritizes recognizable characters, low visual noise, lasting relevance, and loss followed by recovery. Applied here: the personally identifiable homes and persistent changes can matter more than detailed thirst calculations. The talk concerns a player-driven game; copying its presentation does not establish that unattended agents will sustain a show. [GDC 2017 slides](https://media.gdcvault.com/gdc2017/Presentations/Sylvester_Tynan_RimWorld_Contrarian_Ridiculous.pdf).

| Research or design example | Demonstrated result | Boundary for this town |
|---|---|---|
| Valve's Left 4 Dead director | Uses intensity feedback to alternate pressure and relief by changing threat populations | Borrow pacing awareness for camera/editing; importing threat injection would change the autonomy contract |
| Generative Agents | Memory, planning and reflection improve evaluated believability; seeded intentions lead to social coordination | Two simulated days and an invited party are not proof of a self-sustaining society or returning audience |
| Project Sid | Agent coordination and cultural transmission within authored environments and institutions | Strong capability evidence, but neither spontaneous civilization from nothing nor a retention study |

Valve describes both unbroken pressure and long inactivity as undesirable, then controls the environment to shape pacing. Our observation-only equivalent is to select among genuine situations and offer labeled catch-up during lulls; it cannot guarantee dramatic peaks without changing events. [Michael Booth, The AI Systems of Left 4 Dead, pp. 77–91](https://cdn.akamai.steamstatic.com/apps/valve/2009/ai_systems_of_l4d_mike_booth.pdf).

The Generative Agents study initializes one resident's party intention and another resident's crush; invitations and attendance develop from those seeds. Its evaluation also reports memory errors and embellishment. This suggests testing a resident's durable intention and grounded recall before adding many new world mechanics. It does not show that more generated dialogue alone improves a viewer's experience. [Park et al., sections 3.4, 6–7](https://arxiv.org/html/2304.03442v2).

Project Sid supplies its tax constitution, voting procedure, timed tax windows and election manager. Its religion experiment seeds motivated priests, and religious keywords are proxies for conversion. The authors explicitly identify weak intrinsic drives and limits on de novo institutional invention; their 1,000-agent runs also encounter server constraints. These are important qualifications: social scaffolding can enable autonomous decisions, but should not be described as institutions emerging without supplied structure. [Altera et al., sections 5.2–5.3, 7–8](https://arxiv.org/html/2411.00114v1).

None of these sources proves which design will retain this town's audience. They narrow the hypotheses worth testing.

## Autonomy needs consequences, not unrestricted prose

LLMs are useful here for interpretation, preference, negotiation, humor and choosing among meaningful possibilities. They are less useful as per-frame controllers or authorities over whether an event happened. A better model can produce a convincing pub conversation; it cannot create persistent stock, ownership or a remembered promise if the world never stores those facts.

A pub needs a location, usable items, people with reasons to visit, and actions whose effects survive the conversation. It does not initially need a commerce framework, a legal incorporation simulator or a model-generated physics plugin. `packages/arbiter/src/codify.ts:65–185` already supports bounded effects including items, transfers, naming places and learned building recipes.

| Genuine autonomous behavior | Authored affordance that can support it | Scripted outcome to avoid claiming as emergence |
|---|---|---|
| Someone invites a neighbor and accepts refusal | An invitation/arrival/decline action | Automatically assembling a cast because the stream is quiet |
| Residents repeat an encounter and give it a name | Memory, dated encounters, names and access to the location | Declaring a tradition after a counter reaches seven |
| People negotiate and voluntarily comply or defect | A stored agreement plus observable actions | Making an agreement physically impossible to violate |
| A resident chooses to reopen a disputed proposal | Persistent pending proposal and deliberate conversation intent | Replacing an unrelated conversation with a mandatory council |

The existing code crosses these boundaries in specific places, documented with reproductions in [the companion world review](2026-09-21-world-architecture.md). Fixing those seams is more defensible than claiming the whole engine is wrong. Likewise, global prohibitions on sayings, wordplay and repetition in `rulesOfBeing.ts:124–132` work against a culture-oriented product; replace them with grounded, character-specific expression and anti-loop checks, not a quota of jokes or words.

## The missing medium is selection and continuity

The normal client currently hides `.lower-third` (`packages/web/src/ui/harmony.css:11`), mounts `DirectorCue` and `SceneCard` only in broadcast (`App.tsx:541–545`), and uses a different `LivingScene` path. This is evidence that available narration and active-scene context do not reach all viewers equally. It is not evidence that exposing every existing card would create a coherent experience.

Use one presentation contract across town and broadcast: who is involved, the observable present action, the relevant earlier event, and the unresolved next step. Private motives should be labeled as the resident's expressed intention or thought; inferred motive should not be reported as fact. Keep the town visible and use its approved balloons and icons, with fewer simultaneous competing labels.

A quiet scene can be watchable when viewers know what is pending. Repeated anonymous walking cannot be repaired by adding “walking” captions. During a true lull, show an honest scene transition, a recent consequential moment explicitly labeled as replay, or a short return summary; never masquerade a replay as live.

## Gamification that gives viewers something to care about

| Viewer value | Concrete design | Integrity check |
|---|---|---|
| Attachment | Follow two residents; show what changed for them since the last visit | Every change links to dated events, not invented biography |
| Anticipation | Display an announced invitation, unfinished project or unanswered promise | Show who expressed it; do not guarantee completion |
| Discovery | Journal records a witnessed first, gift, shared creation or named custom | Evidence is inspectable; no reward for empty repetition |
| Shared interpretation | Audience predictions about a real open situation, with a later resolution | Predictions do not secretly steer resident decisions |
| Return value | A concise before/after catch-up with one live thread to follow | Summaries distinguish facts, quotes and unresolved questions |

These are optional spectator activities, not mandatory streaks, model XP or cosmetic badge spam. A milestone should commemorate a meaningful change and retain its provenance. A hypothetical “first shared meal” is useful only if both participation and the meal occurred; it must not be inferred from two visits to the same coordinates.

## Small experiment before a medium rewrite

1. Select one existing public place and a small cast for observation, without forcing attendance. Expose destination/activity intentions through existing deterministic actions; check that execution and interruptions remain truthful.
2. Give existing residents stable personal interests and memory access, then observe invitations, commitments and return visits. Check whether an action changes a later decision rather than merely producing more speech.
3. Present the same recorded run as wide town, scene-focused town and labeled catch-up. Check viewer comprehension against one identical event history, so rendering is not confused with better model behavior.
4. Run a separate live comparison only after the recorded one. Check unsolicited return intent and later actual returns, plus whether viewers can name a resident, an unfinished situation and one consequence.
5. Compare substantive consequences and successful commitments per model cost. Check failures separately: no opportunity, no desire, failed action, missed memory, or hidden presentation. Change only the layer responsible.

Suggested first comprehension probe: after ten minutes, ask three questions — who interested you, what do they want, and what changed? These are proposed product checks, not validated numeric success thresholds. Do not treat raw speech volume, badge count, agents spawned or event density as substitutes.

Decision after the experiment: keep continuous tiles if physical causality is central and scene selection is enough; favor the place graph if most valuable behavior depends on commitments and co-presence while navigation keeps failing; use the hybrid only while it remains one coherent world rather than two competing sources of truth.

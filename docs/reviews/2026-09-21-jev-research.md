# Jev and San Junipero

Research date: 21 September 2026. No Jev requests, model changes or production mutations were made.

## Verdict

Jev is a promising fast decision component. It is not a replacement for open-ended resident planning, invention, reflection or dialogue. The useful split is deterministic execution, inexpensive bounded judgment, and generative deliberation. Splitting everything into a Jev brain and an LLM mouth would lose capabilities the town needs.

## What is verified from primary sources

| Property | Official documentation | Consequence here |
|---|---|---|
| Output | Choice, Score and Noul, with probabilities; no free-form generation | Select a fully specified action candidate or classify evidence. Do not ask it to invent a plan or custom name |
| Price | Jev 1.13: $0.042 per million input tokens; output free | Include state, questions and options in cost estimates |
| Input | Text, including structured text; not images/audio | Use the authoritative simulation state, not screenshots |
| Context | Direct API: 64k request total, with state plus longest question limited to 32k | Keep each decision small anyway; provider wrappers may expose different limits |
| Version | `jev-1.13.0`, with moving latest/preview aliases | Pin and record a version for a reproducible pilot |
| Answer space | Choice supports up to 255 options | This is a ceiling, not a reason to enumerate every possible combination |
| Failure modes | Arithmetic, dates, indirection, irrelevant context and adversarial content | Compute quantities, eligibility, distance, timing and safety in code |

Sources: [System One](https://docs.typesafe.ai/concepts/system-one), [models and pricing](https://docs.typesafe.ai/models), [Choice](https://docs.typesafe.ai/primitives/choice), [documented limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13).

The launch advertises roughly 70–500 ms responses and large benchmark speed/cost gains. These are vendor measurements, including tests from the US West Coast, not measurements from this project's UAE server. The vendor's workflow comparisons use larger-model judgments as reference answers. They do not establish long-term town behavior or savings against our inexpensive, heavily cached model. [Launch evidence and qualifications](https://typesafe.ai/blog/introducing-system-one-models-and-jev).

Type-safe does not mean factually correct. Choice confidence is derived from the distribution over supplied options; it is not a proof that the action is correct or that all useful options were supplied. Do not reuse an arbitrary confidence threshold across different tasks. [Confidence documentation](https://docs.typesafe.ai/confidence).

## Fit by responsibility

| Responsibility | Recommended owner | Reason |
|---|---|---|
| Can this person reach the table, afford the item, carry the wood or enter this room? | Existing engine | Deterministic facts already have reliable answers |
| Execute a chosen walk/work sequence | Existing action and plan executor | Repeated inference adds neither agency nor value |
| Continue the current plan or reconsider a meaningful interruption? | Candidate Jev use | A bounded semantic judgment over current goals and known events |
| Which available action best serves this resident's current goal? | Candidate Jev use | Select among valid, fully specified candidates, including deliberation/other |
| Is this event relevant to a resident's existing promise? | Candidate Jev use | Semantic relevance can be cheaper than generative interpretation |
| Does a new intent match an existing known capability? | Candidate Jev use after existing caches | Useful ambiguity filter; exact/semantic precedent already exists |
| Choose a new ambition, reinterpret a relationship, compose a plan | Generative LLM | Requires proposing information absent from the fixed answer set |
| Invent a ritual, recipe, building purpose or explanation | Generative LLM plus arbiter validation | Candidate selection alone cannot invent the candidate |
| Say something | Generative LLM | Dialogue is generative, but must read the same committed intent as the body |
| Make a new physical rule executable | Arbiter plus deterministic validation | A classification is not a new effect implementation |
| Decide what to show viewers | Existing director, optionally assisted by Jev classification | Editorial choice may select real evidence but must not alter the residents |

Do not replace `LlmClient.object` by changing its model string. The current turn contract contains free-form thoughts, speech, plans and novel intents. Jev needs a separate bounded decision interface, with the same ledger, cancellation, budget and error discipline as existing calls.

## A coherent hybrid resident

1. A generative turn establishes or updates the resident's own goal and next intended actions, based only on what that resident knows.
2. The engine offers feasible actions from that goal and local affordances. Each candidate contains action, target and relevant parameters together.
3. Deterministic code executes routine steps. A bounded model judgment is used only when interpretation is needed.
4. A material change, an unsupported idea or a self-authored reconsideration calls the generative mind again.
5. Speech reads that same intent and actual action state. A spoken commitment can be proposed for the resident to remember; speaking is not proof that the promised action happened.

Do not ask independent Jev questions to pick an action, recipient and object and then assume their combination is coherent. Prefer a choice among whole legal intentions. Revalidate the chosen intention against the latest state when it commits.

Do not let a high-confidence routine choice permanently prevent creative deliberation. Periodic reflection and resident-authored goals must retain a path to generating genuinely new options. Otherwise the cheap controller becomes a closed behavior tree dressed in natural language.

This matches TypeSafe's recommended division: code owns deterministic workflow and effects, while the model answers narrow semantic questions. It does not require a new agent framework. [Workflow guidance](https://docs.typesafe.ai/concepts/how-to-build-with-system-one).

## Cost: what we can and cannot claim

Production snapshot at 2026-09-21 01:48:30 UTC, tick 791:

| Caller | Calls | Input tokens | Cached input subset | Output tokens | Recorded USD | Mean latency |
|---|---:|---:|---:|---:|---:|---:|
| Ordinary turn | 168 | 1,192,636 | 638,355 | 47,227 | 0.2059047045 | 3,623 ms |
| Scene line | 229 | 1,094,966 | 833,079 | 41,883 | 0.1310349942 | 2,805 ms |
| Arbiter | 10 | 30,143 | 11,642 | 71,657 | 0.0904318496 | 51,108 ms |
| Scene close | 24 | 24,831 | 0 | 4,864 | 0.0116844750 | 2,751 ms |

Total across all callers: 448 calls, $0.4546985183. Two arbiter calls exhausted their output ceiling. These figures describe this early run, not a daily forecast. Cached tokens are a subset of input; reasoning tokens are a subset of output and must not be added again.

Illustrative Jev arithmetic, assuming exactly 2,000 total billed input tokens per decision:

| Workload | Model cost only |
|---|---:|
| 1,000 decisions | $0.084 |
| 10,000 decisions | $0.84 |
| 12 residents, one decision per real minute, 24 hours | $1.45152 |
| 12 residents, one decision every 3 seconds, 24 hours | $29.0304 |

These exclude dialogue, planning, memory, arbiter calls, art, retries and infrastructure. They assume continuous operation and no idle slowdown. Cheap inference is not a reason to poll constantly.

Applying Jev's rate to the recorded ordinary-turn input alone gives about $0.0501 versus $0.2059 for the current complete turns. This is not an achievable savings claim: those current turns also generated speech, thoughts and plans that Jev cannot supply. Decomposition may require extra calls and input. Measure the complete hybrid, not one replacement price.

## Pilot before adoption

Use recorded states and a local fork, leaving production unchanged. Start with one narrow task, such as deciding whether an existing plan needs reconsideration. Keep the current engine and all validators.

- Include routine work, interruptions, ambiguous promises, unreachable targets, conflicting needs and situations requiring a new idea.
- Measure valid actions, consistency with the resident's knowledge and goal, missed meaningful interruptions, cost, and latency from the deployment region.
- Test the fallback path and coverage of the candidate set. Matching an old model's choice is not the only measure of quality.
- Replay short scenarios with the ordinary and hybrid controllers. Inspect consequences and repeated behavior, not just isolated classification accuracy.
- Expand only if it preserves individuality and follow-through. Keep generative planning and innovation even if the bounded controller is very accurate.

## Research that informs the architecture

Generative Agents provides evidence for observation, memory, planning and reflection working together. Its coordinated party example started with a seeded intention and does not demonstrate that an unconstrained town produces an entertaining show forever. [Paper](https://arxiv.org/abs/2304.03442).

Project Sid explicitly identifies divergence between speech and actions as a multi-agent failure mode. Its proposal uses shared agent state and coordinated concurrent processes. This supports a single committed intention for our body and voice, not copying its entire multi-module stack. [Technical report](https://arxiv.org/html/2411.00114v1).

Voyager demonstrates reuse of learned executable skills in Minecraft. The relevant idea is amortizing repeated execution; our existing plan queue and reusable arbiter rules already provide part of this. Its exploration curriculum should not be copied as a mandatory resident motivation. [Paper](https://arxiv.org/abs/2305.16291).

Experiments on LLM social conventions show that local interactions can produce shared conventions and collective bias. They support studying propagation and memory, not asserting that repeating a location count establishes a meaningful tradition. The experimental tasks are narrower than San Junipero. [Paper](https://arxiv.org/abs/2410.08948).

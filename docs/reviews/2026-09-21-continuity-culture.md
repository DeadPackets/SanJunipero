# Resident continuity and culture — 2026-09-21

Recommendation: repair the small continuity boundaries before adding more conversations, institutions or agents. The town stores substantial history, but storage, retrieval, current intentions and spectator story continuity are not the same system.

Read-only local audit on `codex/viewer-experience`. One in-memory SQLite reproduction; no paid calls, runtime edits or production mutation. Findings distinguish directly observed code behavior from risks that require a recorded multi-day run to measure.

## Verified clocks, not assumed audience time

`packages/shared/src/time.ts:4–13` sets 3,000 real milliseconds per baseline tick, one simulated minute per tick, 1,440 minutes per day, seven days per season and 28 days per year. Calendar years also determine body age (`packages/engine/src/systems/aging.ts:8–10`).

| Interval | Simulated duration | Baseline at constant 1× |
|---|---:|---:|
| Day | 1,440 ticks | 72 real minutes |
| Season / recent autobiography / stale tie | 7 days | 8.4 real hours |
| Year | 28 days | 33.6 real hours |
| Story silence closure | 2 days | 2.4 real hours |
| Birth gestation, default | 20 days | 24 real hours |

These are conversions, not production elapsed-time measurements. `packages/gateway/src/pacing.ts:30–74` already accelerates an all-asleep town by a default factor of four and slows an unwatched town; environment and operator settings can change both. Do not describe this as a fixed 72-minute day or propose night acceleration as a missing feature.

An implication to discuss: a returning viewer can miss substantial simulated history between visits. Likewise, a seven-day retention window means one season, while the 30-day value-edit cooldown exceeds a calendar year. Neither choice is automatically wrong, but their product meaning should be explicit.

## What is genuinely implemented

| Layer | Implemented behavior | Important boundary |
|---|---|---|
| Individual memory | Per-agent SQLite memories, tags, embeddings, full-text search, gists, recall, journals, autobiography and private ledgers | Persistent rows do not guarantee future retrieval |
| Personality | Fixed temperament; values/beliefs with evidence-backed version history; mutable mood, worries and goals | Some growth is model interpretation, not independently verified consequence |
| Relationships | Consent events and partnerships; private typed ties; public event-derived bonds and warmth | Public warmth is a proxy, distinct from either resident's belief |
| Generations | Conception, gestation, birth, derived persona, household history seed, aging, death and grave creation | A birth begins at age twelve; this is an explicit abstraction |
| Return context | Daily chapters, era summaries, biographies, event citations, ranked story threads and director scheduling | A hot thread is not a persistent causal account of one promise or project |

Keep these foundations. This is not a memoryless chatbot, and rebuilding memory, director or population systems from scratch would duplicate working infrastructure.

## 1. Intentions can disappear at the nightly handoff

Fact: `reflection.ts:220–238` calls `summarizeDay` with today's scene summaries, then replaces `personality.current.goals` with its `standing` array. `summarizeDayPrompt` at lines 375–410 receives no previous goals or explicit unresolved commitment list, and permits an empty result.

Inference: a project or promise that was not mentioned today can disappear from the current goals without completion, abandonment or refusal. Historical memory might later recover it, but the handoff itself cannot distinguish deliberate abandonment from a missing mention. More talk does not establish persistence.

Smallest correction: give this existing nightly step the previous standing goals and ask for retain/update/resolve decisions with evidence. Preserve an unchanged goal by default; do not introduce a second planner or a generic quest engine. Check a project that has an uneventful day between planning and completion.

## 2. Commitments lose identity, then expire as if broken

Fact: `memory/ties.ts:75–90` settles every open tie matching resident, other person and kind. It does not match an individual promise. New deltas insert rows rather than updating a specific existing tie; `runtime/agentRuntime.ts:1799–1813` shows at most two open ties per person in insertion order.

Fact: `memory/ties.ts:117–124` expires every non-kin tie after seven days, including promises, debts, alliances and secrets. `runtime/agentRuntime.ts:1719–1739` turns expiry into a memory of letting go. `shared/bonds.ts:155–159` maps promise expiry to `promise_broken`, even though the tie has no due date or fulfillment check.

In-memory reproduction, run through the existing TieStore with no model:

```text
Open: Bring a chair tomorrow.
Open: Help with the harvest next month.
Settle: Bring a chair tomorrow.
Actual: both promises settle at tick 1.

Open again: Help with the harvest next month.
Advance seven simulated days.
Actual: it expires and maps to promise_broken before next month.
```

This is implemented policy with a concrete loss of distinction, not evidence that every live promise was mishandled. Smallest correction: include the existing tie row ID in settlement, preserve distinct obligations, and separate “not recently recalled” from “kept/broken/abandoned.” Let temporary affect decay without silently expiring debt, alliance or a future promise.

A narrow check should open two promises to the same person, fulfill one, then cross seven days with the other still pending. Keep this as a deterministic state test; an extra classifier is not required.

## 3. Some paid memory products are write-only for normal thinking

Fact: `memory/retrieve.ts:112–238` searches the memories table through full text, vectors and tags. It does not search facts, summary nodes or autobiography. `MemoryStore.factsAbout` and `summaryNodes` have no production call sites in `packages`; audit scripts count their rows, but do not feed them into normal decisions.

Fact: nightly reflection stores extracted facts and scene/day summaries (`reflection.ts:171–232`). Scene summaries do feed that same night's day summary before storage, so their generation is not wholly unused. The distinct extracted-facts result has no equivalent downstream mind consumer in the examined flow.

Fact: only the last seven autobiography entries enter the normal personality prompt (`prompt/assemble.ts:127–140`). Older entries remain stored; the comment that recall can reach them is not supported by the current recall query, although source memories for those days can still be retrieved. `runtime/agentRuntime.ts:1617–1620` uses the same memory-only recall function.

Smallest correction: stop paying for a separate fact-extraction pass until it has a defined consumer, or deliberately include a few relevant source-linked facts in recall. Do not implement both retrieval and another summarizer just to justify an existing call. For autobiography, either retrieve selected old passages with their source dates or document honestly that raw memories, rather than old autobiography, are the recall path.

## 4. Retrieval forgets by competition, not deletion

The examined memory store does not purge old experiences. Retrieval caps each candidate pool at 50 and defaults to eight returned memories; tag candidates are ordered newest first. Recency has a half-life of twice the memory's importance in simulated days (`memory/retrieve.ts:36–38,184–237`).

Inference: an old defining event can remain in the database yet disappear from practical thought, especially when many newer memories share people/place tags. More conversations produce more competing rows. Embedding and text candidates can rescue the event, so this is a measurable risk rather than proof that old history is always lost.

Smallest correction: trace candidate source and retrieved IDs for a few known old commitments before tuning weights. Reserve a small explicit route for unresolved commitments and formative memories; do not raise the whole context budget. Check recognition and later action, not merely whether a retrieval score is high.

## 5. Growth gates can omit the events that should change someone

Personality preserves temperament and limits belief/value revisions to seven/30-day intervals after the first three days (`personality.ts:67–71,145–157`). Edits cite today's memories (`personality.ts:173–177`). These are useful anti-drift measures.

But `reflection.ts:101–107,261–265` asks for a change only after a sufficiently important action or newly open slight/grudge. The function explicitly does not catch death or collapse perceptions, which have flat importance three. A bereavement-only day may therefore never reach the edit proposal, and cumulative evidence from earlier days cannot be cited directly in the edit's evidence field.

Smallest correction: admit explicit consequential witnessed events and dated supporting memories through the existing gate, retaining the cooldown and “no change” option. A changed belief is not proof of development until it affects a later choice. Do not reward frequent rewrites.

## 6. The body ages, but its prompt identity does not

`engine/src/systems/aging.ts:13–35` increments age daily and applies old-age death probability. Ordinary prompt identity is assigned from the initial spec (`runtime/agentRuntime.ts:555`); `#withHands` at lines 1836–1839 refreshes skills only. `prompt/assemble.ts:107` prints that identity's age, and the scene voice likewise receives static `spec.identity` (`live/liveMinds.ts:170`).

Fact: this identity path does not track body age. A resident born at twelve can retain “Age: 12” in these prompts after the body becomes adult. Smallest correction: derive current prompt age from body age in both ordinary and scene assembly; keep authored backstory separate from present age.

Birth explicitly uses `SPAWN_AGE_YEARS = 12` (`shared/config.ts:774`, `engine/fold.ts:897`). Do not describe this as infant development or promise a baby-to-adult life simulation. At the default child threshold of sixteen, four 28-day years separate spawn and adulthood; at constant 1× that is 5.6 real days, before pacing adjustments.

## 7. Intergenerational culture is mostly seeded, not inherited experience

Birth persona derivation samples parental values, beliefs and voice traits (`family/derivePersona.ts:89–139`). The live birth path passes parents from `booted.cast` via `personaOf`, not the parents' current PersonalityStore versions (`live/newborn.ts:49–64`). Resume derives the same initial-persona path (`live/resolveCast.ts:112–117`), which preserves deterministic consistency.

Inference: a parent's learned belief changes do not enter this inherited persona path. Children can still learn through later interaction and public household memories. This limits one mechanism of cultural continuity; it does not establish that no transmission occurs.

The household seed uses a fixed list of public event types and the most recent 40 matching entries (`family/memorySeed.ts:40–161`). It can include parental speech, construction and deaths, with second-hand wording and event tags. It is bounded and grounded, but does not explicitly preserve the most consequential entries when recent routine speech fills the window.

Smallest correction if inherited experience is desired: snapshot the parents' current version IDs and selected dated household events at birth, so live and replay agree. Do not read mutable present-day parents when replaying an old birth. Alternatively keep traits as seed inheritance and make learned customs travel only through actual teaching; this is a product choice, not a missing genetics engine.

## 8. Affection and story continuity include deliberate proxies

Public friendship accrues from speech pairs within a time/distance window (`gateway/bonds.ts:89–104`); it does not analyze whether the words show friendship. Agent-local company warmth also increases on newly heard speech (`runtime/agentRuntime.ts:931–954`). Private ledgers and typed ties offer richer interpretation, but these numerical summaries should not be presented as an objective emotional truth.

Want levels also use bounded event proxies (`memory/wants.ts:6–45,138–166`): seven categories rise with time and reset when matching occasions occur. That provides pressure, not a hierarchy of competing moral values. A disagreement between values remains an LLM judgment grounded in the personality and situation, rather than a separately implemented deliberation system.

Gateway story threads merge on overlapping cast and close after two days without a payment (`gateway/threads.ts:110,257–276`; `shared/threads.ts:96`). A later encounter reopens as a new story; two unrelated matters involving the same pair can share one active thread. These are useful editorial heuristics, not persistent semantic identities for projects or relationships.

Daily narration receives today's digests plus the previous two chapter titles (`narrator/chronicle.ts:261–267`); era summaries do join chapter text later. There is no equivalent historical source packet for specific multi-day callbacks in the daily chapter call. Citation validation proves that cited event IDs exist, not that each prose claim follows from them.

The narrator also detects roles after three qualifying actions, groups from repeated shared scenes, and candidate rules from repeated eligible actions (`narrator/institutions.ts:4–13,81–174`). These are observer-side pattern labels, not proof that residents adopted a role, founded a group or agreed on a custom. They should remain distinct from resident-named, evidence-backed institutions.

Smallest correction: label bond/thread summaries as observations, and attach a relevant prior event or unresolved commitment when a real scene refers back to it. Preserve existing director holds, quiet beats and ranking. Do not add a second narrative controller or feed narrator interpretations back into minds as shared fact.

## Generational plumbing worth keeping

Arrivals occur at 09:00 after a deterministic 21–35-day gap when population capacity permits (`live/arrivals.ts:13–28,138–166`). Four authored travellers precede ID-derived newcomers (`live/resolveCast.ts:31–75`). Births, arrivals, deaths and departures participate in cast reconstruction, and child/arrival memory initialization has recovery paths.

These are real lifecycle capabilities, but they do not guarantee fresh social stakes. A newcomer assembled from existing voice cards may still become distinct through events; increasing arrivals without memory and commitment continuity would mostly increase the number of people to forget. Keep population caps and explicit grounding rather than adding residents to manufacture activity.

## Smallest useful continuity experiment

1. Record two distinct promises to the same resident; fulfill one and defer the other beyond seven days. Check identity-preserving state and honest viewer labels.
2. Carry one construction or social intention across an uneventful day. Check it remains pending without requiring daily restatement.
3. Revisit one meaningful event older than seven days. Check the resident recalls a supported detail and makes a later relevant choice.
4. Advance a child body across adulthood in a local deterministic fixture. Check ordinary and scene prompts report the same current age.
5. Replay a birth after a parent's documented belief change. Check the chosen inheritance policy is explicit and identical live/resumed.

These checks measure continuity, not human retention. The existing foundations are sufficient to run them; a new society framework is not a prerequisite.

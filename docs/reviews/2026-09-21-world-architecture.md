# World architecture review, 2026-09-21

Independent local code review. No production mutation, paid call or world-semantics change.
The reproduction below calls a pure detector against fabricated test events, not a town.

## Recommendation

Keep the event log, deterministic engine, physical action validation and bounded arbiter.
Revise the boundary between observations, resident beliefs and enforced social outcomes.
A rewrite has no demonstrated advantage over correcting these identifiable seams.

## Facts and implications

| Observed fact | Evidence | Implication / minimal replacement |
|---|---|---|
| Forbidden acts remain possible, but `require_before`, `common` and `tithe` return a hard refusal. | `packages/engine/src/socialLaws.ts:170-186`, `packages/engine/src/intent.ts:176-177` | A social agreement acts like a physical barrier. Normally record a witnessed violation instead. Hard enforcement should require an actual physical mechanism or resident action. This is a design recommendation, not an unapproved semantics change. |
| The next eligible conversation on a later day becomes a council about a tabled law automatically. | `packages/agents/src/scene/coordinator.ts:334-363` | Residents do not choose to reconvene. Require a resident to bring the pending proposal back into conversation. Retain the pending record and existing voting implementation. |
| The proposer plus all other participants answering `unsure` passes. An explicit test requires it. | `packages/agents/src/scene/scene.ts:302-316`, `scene.test.ts:321` | This is deliberate policy, not an accidental code error. Consider requiring at least one explicit supporting participant and describing who actually agreed, rather than calling it town-wide consensus. |
| Custom detection groups all visits to a location on a calendar day, not overlapping attendance. Room identity is not represented in `Presence`. | `packages/arbiter/src/constructs.ts:79-95`, `182-217` | Can report gatherings that never happened. Use completed scene participants or actual overlapping presence in the same room. Reproduction below confirms the gap. |
| The most talkative resident is treated as a signal of deference. | `packages/arbiter/src/constructs.ts:242-247`, `272` | Speech quantity is not evidence of authority. Omit this signal or require explicit evidence of another resident accepting a decision. |
| Classifier input contains counts and shared tokens, not complete conversations. Classification is performed only once per site. | `packages/arbiter/src/constructs.ts:296-308`, `433-441` | A traffic hotspot can receive an unjustified permanent cultural label. Prefer evidence-linked candidate observations and allow a place to support more than one activity. |
| Habit text tells every mind that people gathered, then after seven days declares it a tradition. | `packages/arbiter/src/constructs.ts:359-379`, `packages/agents/src/runtime/agentRuntime.ts:1453-1459`, `packages/live/src/liveWorld.ts:711-712` | The recognizer is not purely observer-side, despite comments elsewhere. Its conclusions can become shared memory. Keep observer taxonomy out of minds; feed only events they witnessed or learned about. A quoted resident-given name is different from an observer declaring a tradition. |
| Speech instructions forbid new sayings, proverbs, poetic expression, punchlines and wordplay, and prescribe silence as the normal state. | `packages/agents/src/prompt/rulesOfBeing.ts:118-140` | Inference: global restrictions flatten personality and discourage cultural expression. Keep anti-loop and factual-grounding requirements. Allow character-specific humor, recurring greetings and evidence-backed shared expressions. |
| Current health is explicitly used to deny past illness: healthy today means healthy yesterday. | `packages/agents/src/prompt/rulesOfBeing.ts:132` | Current state cannot invalidate recorded history. Ground present symptoms in present state and past symptoms in dated memories/events. Do not invent a new chronic condition. |

The speech restrictions respond to real failures. Tests describe fabricated persistent ailments
and self-repeating conversations (`packages/agents/src/prompt/rulesOfBeing.test.ts:406-427`).
Removing grounding altogether would restore those failures. The correction is narrower grounding,
not permission to invent medical history or force constant dialogue.

## Reproduction: visits are mistaken for gatherings

Run from the repository root:

```sh
node --import tsx --input-type=module <<'JS'
import { detectCandidates } from './packages/arbiter/src/constructs.ts'
import { DEFAULT_CONFIG } from './packages/shared/src/config.ts'
const events = []
let seq = 0
for (let day = 0; day < 3; day++) {
  for (const [i, id] of ['a', 'b', 'c'].entries()) {
    events.push({seq: ++seq, tick: day * 1440 + 360 + i * 240,
      type: 'agent_moved', payload: {id, x: 10, y: 10}})
    events.push({seq: ++seq, tick: day * 1440 + 361 + i * 240,
      type: 'agent_moved', payload: {id, x: 50 + i * 10, y: 50}})
  }
}
console.log(JSON.stringify(detectCandidates(events, DEFAULT_CONFIG)
  .map(({anchor, gatherings}) => ({anchor, gatherings})), null, 2))
JS
```

Measured output: one candidate at `(10,10)` with gatherings at ticks `360`, `1800`, `3240`.
Each lists participants `a`, `b`, `c`. Each person visits for one minute at 06:00, 10:00
or 14:00, then leaves. There is no shared attendance. No LLM participates in this failure.

## What already earns its cost

- Event log and deterministic folding: replay, causal accountability and recovery.
- Physical space, rooms, materials, resource ownership and construction: consequences residents can act upon.
- Budget checks and bounded, cached arbiter rulings: unknown actions can acquire repeatable mechanics without arbitrary executable code.
- Personal memory and relationships: continuity across encounters.
- Expressive acts have a cheaper route than full invention adjudication (`packages/arbiter/src/expressive.ts:1-153`). Make those acts visible before inventing more mechanics.

## Limits on emergent institutions

The world has individual ownership and whole-town laws, but no equivalent durable group ownership
or membership object (`packages/engine/src/state.ts:163`, `185`, `228-245`). Groups can exist in
speech, memory and marks. Their obligations have less explicit state than farming or building.
This can limit continuity, but does not prove that a general institution engine is needed.

The arbiter's executable effects are deliberately bounded: create items, gain skill, change health
or needs, mark, witness, name a place, transfer ownership or learn a building recipe
(`packages/arbiter/src/codify.ts:65-185`). That boundary is valuable. A pub may be a named building
where residents store, exchange, consume and talk. A new framework is not required just to call it
a pub. Add a primitive only after repeated real attempts expose a missing operation.

Survival is already tuned as background pressure. Hunger decay is `0.005` per tick, with an
explicit rationale against constant hunger-driven loops (`packages/shared/src/config.ts:5-26`).
More danger or scarcity is not automatically more social depth and could reverse that intent.

## Minimum next experiment

1. Keep the present simulation and renderer.
2. Correct contradictory speech grounding and recognizer evidence.
3. Discuss voluntary law enforcement and intentional reconvening before changing those semantics.
4. Present actual actions, conversations and consequences to viewers.
5. Compare remembered consequences, sustained personal projects, voluntary repeat encounters and distinct voices. Do not optimize merely for dialogue or council counts.

This review identifies architectural tensions and one reproduced detector error. It does not
claim that every quiet period is a backend fault or that these changes alone guarantee an
entertaining autonomous town.

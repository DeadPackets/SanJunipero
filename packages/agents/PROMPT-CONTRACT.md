# Prompt block contract

Consumed by C4 (Arbiter) and C7 (narrator). This file is the single source of
truth for how an agent's prompt is assembled in `@sj/agents` — the block order,
what may change and when, and the byte-stability the DeepSeek prefix cache
depends on.

## The six blocks

| # | Block | Content | Mutation cadence |
|---|---|---|---|
| 1 | Rules of being | `RULES_OF_BEING` — one exported constant, identical for every agent, second person, fully diegetic | never |
| 2 | Identity core | `IdentityCore` — name, age, backstory, frozen temperament, voice card | never |
| 3 | Personality | `PersonalityDoc` + autobiography paragraphs | at sleep only |
| 4 | Scene | relationship ledgers (people present) + retrieved `ScoredMemory[]` | per scene |
| 5 | Day log | append-only perception log `string[]` | append-only all day |
| 6 | Now | current perception prose (`perceptionToProse`) | every turn |

`assemblePrompt(blocks)` enforces nothing by itself — the gradient is a
contract between callers. It renders block order fixed and keeps content
byte-stable; callers must respect the cadence column above.

## system / messages split

```
system   = block 1 + DELIM + block 2 + DELIM + block 3
messages = [ { role: 'user', content: block 4 },
             { role: 'user', content: block 5 joined with '\n' },
             { role: 'user', content: block 6 } ]
```

The delimiter between the three system blocks is exactly:

```
\n\n---\n\n
```

Blocks 4–6 are separate user messages. The full serialization used for cache
and token estimation is `system + messages.map(m => m.content).join('')`.

## Cache expectation

Blocks 1–3 (the whole `system` string) are **byte-stable except at sleep**:
only a sleep-time personality edit may change block 3. Blocks 1 and 2 never
change for a given agent, so the model's cached prefix survives every turn and
every scene change. Changing block 4 (scene), block 5 (day log), or block 6
(now) must never reflow bytes inside blocks 1–3.

## Token estimate and compaction

- `estTokens` = `ceil(totalChars / 4)` over the full serialization.
- `needsCompaction` is true when the day-log block alone exceeds
  `DAYLOG_COMPACTION_TOKENS` (6000). This is the mid-day overflow signal.
- `compactDayLog(dayLog, summary)` returns
  `["Your mind wanders back over the day: " + summary, ...last 10 entries]`.
  Sleep is the real compaction (the log resets at dawn); this is the emergency
  summarize path.

## Human framing

No block, delimiter, or perception prose may reference the machinery behind
the agent. `FORBIDDEN_FRAMING` (exported from `rulesOfBeing.ts`) is the
enforcement regex; the assembler test asserts every rendered block and
`RULES_OF_BEING` itself pass it.

## PerceptionPacket

`prose.ts` exports a local mirror of C2's frozen `PerceptionPacket`
(`composePerception`'s return type). Until `@sj/engine` ships the composer, this
mirror is authoritative for `perceptionToProse` and the fixture packets in
`src/testutil/fixtures.ts`. The Task 12 EngineBridge reconciles the mirror with
the real engine type — do not drift from C2 Task 13's shape in the meantime.

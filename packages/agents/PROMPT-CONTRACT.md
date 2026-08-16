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
system   = block 1 + DELIM + capabilities + DELIM + block 2 + DELIM + block 3
messages = [ { role: 'user', content: block 4 },
             { role: 'user', content: block 5 joined with '\n' },
             { role: 'user', content: block 6 } ]
```

`capabilities` is the exported `CAPABILITIES` constant (static, identical for
every agent) — the Tier-1 verbs in world language. It sits inside the
byte-stable system prefix so it never disturbs the cache.

The delimiter between the system sections is exactly:

```
\n\n---\n\n
```

Blocks 4–6 are separate user messages. The full serialization used for cache
and token estimation is `system + messages.map(m => m.content).join('')`.

## Cache expectation

Blocks 1–3 plus `CAPABILITIES` (the whole `system` string) are **byte-stable
except at sleep**: only a sleep-time personality edit may change block 3.
Blocks 1, 2, and `CAPABILITIES` never change for a given agent, so the model's
cached prefix survives every turn and every scene change. Changing block 4
(scene), block 5 (day log), or block 6 (now) must never reflow bytes inside
blocks 1–3 or the capabilities section.

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

`prose.ts` exports the agents-local `PerceptionPacket` mirror. It carries the
engine's `composePerception` shape plus two self-state booleans (`asleep`,
`collapsed`) that the engine's `self` omits; `EngineBridge.reconcile` maps the
engine packet onto this mirror each perception. `perceptionToProse` renders
time, body state, the visible world, what the agent carries, heard speech, and
felt events into second-person fiction.

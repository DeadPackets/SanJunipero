# scene-proto — throwaway scene loop

Four scene registers, three seeds, real personas. Nothing here is imported by the repo and
nothing in the repo was touched.

```
node --env-file=/home/ubuntu/workspace/SanJunipero/.env --import tsx \
  /tmp/.../scene-proto/scene.ts          # all 4 registers x 3 seeds on GLM
SJ_REGISTERS=wants,invention  ...        # subset
SJ_ONLY=plain:A               ...        # one scene
SJ_STRONG='google/gemini-3.7-flash|Google AI Studio|B|wants' ...   # one scene on another model
```

`node_modules` is a symlink to `packages/llm/node_modules`, so `zod`, `ai` and
`@openrouter/ai-sdk-provider` resolve; the repo's own modules are imported by absolute path.
Run from the repo root so `tsx` resolves.

## What is real

| piece | source |
|---|---|
| personas, voice cards, word budgets | `packages/agents/src/live/founderMinds.ts` |
| `RULES_OF_BEING`, `SPEECH_RULES` | `packages/agents/src/prompt/rulesOfBeing.ts` |
| identity rendering (field order) | mirrors `renderIdentity` in `prompt/assemble.ts` |
| client, ledger, retry, budget | `packages/llm` `LlmClient`, caller `turn` |
| model pin | `pins.ts`: `z-ai/glm-5.3-flash`, Wafer then DeepInfra, temp 1, 600 out |

Only the scene layer is new: the seeds, the wants, the status move, the director and the arbiter.

## The loop

A scene is two minds, a place, a time, a seed of tension, and a relationship of 2-3 lines.
Turns alternate. On each turn the speaking mind gets:

- system: `RULES_OF_BEING` + its own identity block + `SPEECH_RULES` (+ the status-move rules in
  register 2)
- user: place, time, who is standing there, the relationship, what is in the air, its own private
  want, the last 6 lines oldest-first, "that last one landed hard" if the previous mind escalated,
  the exit rule, and the answer shape

It returns `{ line, aside (<=8 words), move: continue | leave | escalate }`; register 2 adds
`status: press | give way | deflect | tease`. `leave` ends the scene, otherwise it caps at 10
lines (6 in register 4).

## The four registers

1. **Plain village** — `SPEECH_RULES` as-is, no want, no status, no director.
2. **Wants and status** — explicit want plus a named status move each turn, Johnstone-style. Exit
   is "someone won or the pot boiled over". The aside is a feeling.
3. **Director-staged** — one game-master call first returns `{stakes, wantA, wantB, endingBeat,
   caption}`. It never writes dialogue. The minds receive the stakes and their own want, which
   read exactly like the hand-written ones, and are never told a director exists. `endingBeat` is
   held back entirely: it is the director's prediction, and whether the scene lands on it is the
   measurement. `caption` is for the viewer.
4. **Invention and ruling** — the first mouth must put something NEW into the world (a custom, a
   rule, a device, a game, a name for a place) and the second is told not simply to agree.
   Afterwards an arbiter voice, which heard only the words and none of the reasons, returns
   `{ruling: upheld|refused|amended, name, law, why, caption}`. The law is one plain sentence in
   their words, and it is the fact the town keeps.

## Files

- `scene.ts` — the whole thing, one file
- `transcripts.md` — all 16 scenes, grouped by register
- `glm.json`, `gemini-*.json`, `luna-*.json` — raw runs with per-scene latency and cost

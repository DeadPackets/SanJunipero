# The pinned provider that could not emit an action

GATE G11b, C11 Task 37b. A 4-sim-day live run on the genesis town scored **11 of 17**, against
16 of 17 for batch 11's 2-day run. The town took **4 acts in four days**, spoke **0 words**,
walked **0 tiles**, and all five founders died of hunger, thirst and cold.

This file is the attribution, kept because the finding outlives the batch.

## The symptom

The minds were thinking well. At t421 Omar thought *"Salma looks ill. I should tend to her"* and
Yusuf *"Salma looks unwell. Aye, I'll tend to her first."* At t6120 Nadia thought *"The hunger
gnaws at me... The bread at (68, 76) is within reach, but I am too weak to move."*

Every one of those intentions stayed a thought. Across ~400 turns the answers carried **only
`thought` and `importance`** — the two REQUIRED fields of `TurnSchema`. Every OPTIONAL field —
`speech`, `action`, `plan`, `journal`, `reconsider_at` — was absent. There were no parse
failures and no fallback turns: the answers were valid and empty of intent.

Two failed calls named the mechanism:

```
Upstream error from DeepInfra: Grammar error: Unimplemented keys: ["propertyNames"]
```

## The measurement

Three things differed from batch 11's run at once — the Task 37b config changes, 4 sim-days
instead of 2, and the provider pinned to DeepInfra with `allow_fallbacks:false`. A 12-call
probe ($0.0035) separates them. Same model id, same system prompt, 3 calls per cell:

| cell | `action` returned | `speech` returned |
|---|---:|---:|
| DeepInfra + real `TurnSchema` + the makeables line | 0 / 3 | 0 / 3 |
| DeepInfra + real `TurnSchema`, makeables line removed | 0 / 3 | 0 / 3 |
| DeepInfra + a schema with the `z.record` removed | 0 / 3 | 0 / 3 |
| **unpinned routing** + real `TurnSchema` + makeables | **3 / 3** | **2 / 3** |

1. **Not the prompt.** Removing the makeable-vocabulary line changes nothing on DeepInfra, and
   the unpinned routing emits an act every time *with the line present*.
2. **Not `propertyNames` alone.** Removing the `z.record` from `IntentSchema.params` does not
   bring the optional fields back. That key explains the two hard grammar errors and not the
   general omission.
3. **The provider.** DeepInfra's structured-output path returns required properties only.

Two independent DeepInfra runs show the same signature: 3 acts in 115 turns, and 4 in ~400.

## What follows

- **A provider that omits optional fields cannot run the turn caller** while `action`, `speech`
  and `plan` are all optional. This is the first blocker for any further live gate.
- **`IntentSchema.params` is a `z.record`**, which emits `propertyNames` and hard-fails
  grammar-based structured output. Worth fixing regardless of which provider is chosen.
- **Making `action` required**, with an explicit idle member, would make every provider emit
  one. That is a schema change and belongs to a chunk that may re-pin, not to C11.
- **A 12-call pre-flight probe costs $0.0035 and would have caught this before a 38-minute
  gate.** Any run that pins a provider should do it first.
- **Pinning also cost all prompt caching**: 0.0% cache-read share against 22.5% on the previous
  routing. Cost models derived from one routing are not portable to another.

## What the run does NOT say

It does not say whether R15 lowered the survival tax, which is what it was most wanted for. The
survival-tax figures are 100% (old classifier) and undefined (new) over four acts; they measure
nothing. It also says nothing about criterion 9 — nobody could coin an expressive verb in a run
with no speech in it.

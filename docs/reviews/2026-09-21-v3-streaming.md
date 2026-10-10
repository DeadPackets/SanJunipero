# V3 streaming probe

Decision: keep complete-response execution. Streaming adoption is not supported by this small comparison.

Three synthetic resident-local situations use the real StrictTurnSchema and current shared capability/speech prompts (4,450–4,479 input tokens). Each was sent once buffered and once streamed, alternating order. Same pinned mind model, explicit OpenAI endpoint, low reasoning, 4,096 output cap; no retries or world mutations. Prompt cache and stochastic output differ, so this is descriptive, not a causal performance estimate.

| Fixture | Buffered complete ms | Stream first text ms | Stream complete ms |
|---|---:|---:|---:|
| 1 | 2769 | 2151 | 2666 |
| 2 | 2010 | 768 | 2098 |
| 3 | 1611 | 1843 | 3367 |

All six complete responses passed the real turn schema. Reported total cost: $0.00299160; outstanding allowance: $0. Buffered median complete response: 2,010ms; streamed: 2,666ms. Streaming exposes incomplete JSON earlier, but those bytes cannot safely execute an action or publish a complete utterance. No partial response was executed or shown to viewers.

Halim's separately traced 31–32-tick pre-request idle gaps cannot be reduced by transport streaming. The v3 completion-to-decision handoff targets that gap directly. This probe does not measure regional production latency, retention, or long conversations. Revisit only if complete-turn timings in rehearsal identify provider delivery as the bottleneck.

Reproduce with `node --import tsx packages/llm/scripts/measure-streaming.ts <new-output-directory>` with an authorized credential already in the process environment. The script reserves up to $0.25/request against a $2 ledger, records final usage, and holds uncertain requests. Never commit credentials or paid run databases.

Sources: [OpenRouter streaming](https://openrouter.ai/docs/api_reference/streaming), [reasoning tokens](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens), [streaming errors](https://openrouter.ai/docs/api_reference/errors-and-debugging). Final billing can arrive after content; partial output is not proof of successful completion.

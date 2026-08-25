// Observed by scripts/probe.ts live run 2026-08-15 — not invented. Re-run the probe before changing.
export const MIND_MODEL = 'deepseek/deepseek-v4-flash-0731' as const
export const PROVIDER_ORDER: string[] = ['Wafer']
export const FALLBACK_MODELS: string[] = ['deepseek/deepseek-chat']
export const PRICE_PER_M = { input: 0.14, output: 0.28, cacheRead: 0.028 } as const

// A reasoning model was pinned and this parameter was never sent, so every call the project has
// ever made asked for the endpoint's default. Measured at Wafer with byte-identical prompts,
// `unset` bills the same +22-token thinking preamble as `effort:'high'` — the default IS the
// maximum. `minimal`/`low`/`medium`/`high` are indistinguishable from each other; only
// `enabled:false` moves anything, and it takes median turn output from 168 to 50.
export type ReasoningSetting =
  | { enabled: false }
  | { effort: 'minimal' | 'low' | 'medium' | 'high' }

// Per `LlmClient` caller. `null` sends no reasoning parameter, which is what every call did
// before the dial existed.
export const REASONING_BY_CALLER: Record<string, ReasoningSetting | null> = {}

export function reasoningFor(caller: string): ReasoningSetting | null {
  return REASONING_BY_CALLER[caller] ?? null
}

export type ModelPrices = { input: number; output: number; cacheRead: number }

// Per-served-model price pins; anything unlisted is costed at the pinned
// MIND_MODEL prices so a fallback-served call never books as zero.
export const PRICE_PER_M_BY_MODEL: Record<string, ModelPrices> = {
  [MIND_MODEL]: PRICE_PER_M,
}

// Observed by scripts/probe.ts live run 2026-08-15 — not invented. Re-run the probe before changing.
export const MIND_MODEL = 'deepseek/deepseek-v4-flash-0731' as const
export const PROVIDER_ORDER: string[] = ['Wafer']
export const FALLBACK_MODELS: string[] = ['deepseek/deepseek-chat']
export const PRICE_PER_M = { input: 0.14, output: 0.28, cacheRead: 0.028 } as const

export type ModelPrices = { input: number; output: number; cacheRead: number }

// Per-served-model price pins; anything unlisted is costed at the pinned
// MIND_MODEL prices so a fallback-served call never books as zero.
export const PRICE_PER_M_BY_MODEL: Record<string, ModelPrices> = {
  [MIND_MODEL]: PRICE_PER_M,
}

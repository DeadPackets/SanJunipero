// Observed by scripts/probe.ts live run 2026-08-15 — not invented. Re-run the probe before changing.
export const MIND_MODEL = 'deepseek/deepseek-v4-flash-0731' as const
export const PROVIDER_ORDER: string[] = ['Wafer']
export const FALLBACK_MODELS: string[] = ['deepseek/deepseek-chat']
export const PRICE_PER_M = { input: 0.14, output: 0.28, cacheRead: 0.028 } as const

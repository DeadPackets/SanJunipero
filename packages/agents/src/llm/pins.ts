// Observed by scripts/probe.ts live run 2026-08-15 — not invented. Re-run the probe before changing.
export const MIND_MODEL = 'deepseek/deepseek-v4-flash-0731' as const
export const PROVIDER_ORDER: string[] = ['Wafer']
export const FALLBACK_MODELS: string[] = ['deepseek/deepseek-chat']

export type ModelPrices = { input: number; output: number; cacheRead: number }

// $/M tokens from `/api/v1/models/<id>/endpoints`, which scripts/price-probe.ts re-reads. The
// price depends on WHO served the call, so the table is keyed by that and not by the model.
export const PRICE_PER_M_BY_PROVIDER: Record<string, ModelPrices> = {
  Wafer: { input: 0.28, output: 0.56, cacheRead: 0.07 },
  Baidu: { input: 0.14, output: 0.28, cacheRead: 0.028 },
  StreamLake: { input: 0.247016, output: 0.741048, cacheRead: 0.0078596 },
  DeepInfra: { input: 0.08, output: 0.18, cacheRead: 0.016 },
}

// The per-component maximum over every endpoint serving MIND_MODEL, peak legs included, so an
// unpriced back end can only ever OVER-report.
export const CEILING_PRICE_PER_M: ModelPrices = { input: 0.44, output: 1.32, cacheRead: 0.114 }

// The pinned route's real price. Kept as the name the rest of the tree imports.
export const PRICE_PER_M: ModelPrices = PRICE_PER_M_BY_PROVIDER.Wafer as ModelPrices

// For the case where a fallback MODEL answered rather than a different back end. An unlisted
// model is a different product, so it books at the ceiling and not at the pinned rate.
export const PRICE_PER_M_BY_MODEL: Record<string, ModelPrices> = {
  [MIND_MODEL]: PRICE_PER_M,
}

export type PriceSource = 'provider' | 'model' | 'ceiling'
export type PriceLookup = { prices: ModelPrices; source: PriceSource }

// The provider row wins. Anything unattributed or unpriced resolves to the ceiling and reports
// `ceiling`, so it can never silently book cheap.
export function pricesFor(model: string | undefined, provider: string | null | undefined): PriceLookup {
  const servedPinnedModel = model === undefined || model === MIND_MODEL
  if (servedPinnedModel && provider != null) {
    const row = PRICE_PER_M_BY_PROVIDER[provider]
    if (row !== undefined) return { prices: row, source: 'provider' }
  }
  if (model !== undefined) {
    const row = PRICE_PER_M_BY_MODEL[model]
    if (row !== undefined && !servedPinnedModel) return { prices: row, source: 'model' }
  }
  // The pinned model served by an unnamed back end: the ceiling is the only safe answer,
  // because `allow_fallbacks` means any of ~30 endpoints could have taken it.
  return { prices: CEILING_PRICE_PER_M, source: 'ceiling' }
}

// Unset bills the same thinking preamble as `effort:'high'` — the endpoint default IS the
// maximum — and the four effort rungs are indistinguishable; only `enabled:false` moves anything.
export type ReasoningSetting =
  | { enabled: false }
  | { effort: 'minimal' | 'low' | 'medium' | 'high' }

// Per `LlmClient` caller. `null` sends no reasoning parameter, which is what every call did
// before the dial existed.
export const REASONING_BY_CALLER: Record<string, ReasoningSetting | null> = {}

export function reasoningFor(caller: string): ReasoningSetting | null {
  return REASONING_BY_CALLER[caller] ?? null
}

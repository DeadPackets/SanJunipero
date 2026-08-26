// Observed by scripts/probe.ts live run 2026-08-15 — not invented. Re-run the probe before changing.
export const MIND_MODEL = 'deepseek/deepseek-v4-flash-0731' as const
export const PROVIDER_ORDER: string[] = ['Wafer']
export const FALLBACK_MODELS: string[] = ['deepseek/deepseek-chat']

export type ModelPrices = { input: number; output: number; cacheRead: number }

// $/M tokens, read from OpenRouter's own endpoint list for MIND_MODEL on 2026-08-26
// (`/api/v1/models/<id>/endpoints`, free and unauthenticated — scripts/price-probe.ts re-reads it).
//
// The old table was a single flat row of 0.14/0.28/0.028. That is Baidu's price, and it was
// correct for Baidu. `PROVIDER_ORDER` is only a PREFERENCE while `allow_fallbacks` is true, so
// the calls actually landed on Wafer, which charges exactly 2x on input and output and 2.5x on
// cache reads. 611 calls billed $0.89 and booked $0.43. The price depends on WHO SERVED the
// call, so the table is keyed by that and not by the model alone.
export const PRICE_PER_M_BY_PROVIDER: Record<string, ModelPrices> = {
  Wafer: { input: 0.28, output: 0.56, cacheRead: 0.07 },
  Baidu: { input: 0.14, output: 0.28, cacheRead: 0.028 },
  StreamLake: { input: 0.247016, output: 0.741048, cacheRead: 0.0078596 },
  DeepInfra: { input: 0.08, output: 0.18, cacheRead: 0.016 },
}

// The per-component maximum over every endpoint serving MIND_MODEL, including the peak leg of
// the two providers that price by time of day (DeepSeek and Alibaba both charge double in
// their own daytime windows). Anything not in the table above books here, so an unpriced back
// end can only ever OVER-report. Under-reporting is what cost us the last six months.
export const CEILING_PRICE_PER_M: ModelPrices = { input: 0.44, output: 1.32, cacheRead: 0.114 }

// The pinned route's real price. Kept as the name the rest of the tree imports.
export const PRICE_PER_M: ModelPrices = PRICE_PER_M_BY_PROVIDER.Wafer as ModelPrices

// Per-served-model price pins, for the case where a FALLBACK MODEL answered rather than a
// different back end for the pinned one. An unlisted model is a different product at a
// different price, so it books at the ceiling rather than at the pinned model's rate.
export const PRICE_PER_M_BY_MODEL: Record<string, ModelPrices> = {
  [MIND_MODEL]: PRICE_PER_M,
}

export type PriceSource = 'provider' | 'model' | 'ceiling'
export type PriceLookup = { prices: ModelPrices; source: PriceSource }

// Who serves it decides the price, so the provider row wins. A call nobody can attribute, or one
// served by a back end or a model we have never priced, resolves to the ceiling and reports
// `ceiling` so the caller can be loud about it. It must never silently book cheap.
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

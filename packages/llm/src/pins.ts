// TEST BRANCH: the GLM rehearsal. OpenRouter publishes no dated snapshot for this model, so
// the bare id is the only id there is; see the pins test for the dated-pin exception.
export const MIND_MODEL = 'z-ai/glm-5.3-flash' as const
// Single-homed by necessity, not by the load-balancing law: 19 of the 20 endpoints serving this
// model return a Turn with no action on 75-100% of calls. Wafer alone cleared 36/36 acts.
export const PROVIDER_ORDER: string[] = ['Wafer']
// Never add Together, Reka, DeepInfra, AkashML, Ambient or Mancer: each returns 100% well-formed
// Turns with `action: null` on 75-99% of calls, which only the pre-flight act bar catches.
// The fallback IS the pinned dated model; no alias ever answers for it.
export const FALLBACK_MODELS: string[] = []

export type ModelPrices = { input: number; output: number; cacheRead: number }

// $/M tokens. The price depends on WHO served the call, so the table is keyed by that and
// not by the model alone — two back ends for this one model differ 3x.
export const PRICE_PER_M_BY_PROVIDER: Record<string, ModelPrices> = {
  // Wafer's GLM tier, measured against its own bill: the $0.075 list tier refuses json_schema.
  Wafer: { input: 0.15, output: 0.5, cacheRead: 0.03 },
  Inceptron: { input: 0.13, output: 0.28, cacheRead: 0.03 },
  // Off the allow-list since providers2 (2026-08-30); the row stays so old ledger rows price.
  AtlasCloud: { input: 0.44, output: 1.32, cacheRead: 0.028 },
  // Tripled overnight 2026-08-31 (was 0.04494/0.08988/0.008988); confirmed against a real bill.
  Baidu: { input: 0.14, output: 0.28, cacheRead: 0.028 },
  StreamLake: { input: 0.247016, output: 0.741048, cacheRead: 0.0078596 },
  DeepInfra: { input: 0.08, output: 0.18, cacheRead: 0.016 },
}

// The per-component maximum over every endpoint serving MIND_MODEL, peak legs included, so an
// unpriced back end can only ever OVER-report.
export const CEILING_PRICE_PER_M: ModelPrices = { input: 0.44, output: 1.32, cacheRead: 0.114 }

// The pinned route's real price. Kept as the name the rest of the tree imports.
export const PRICE_PER_M: ModelPrices = PRICE_PER_M_BY_PROVIDER.Wafer!

// For the case where a fallback MODEL answered rather than a different back end. An unlisted
// model is a different product, so it books at the ceiling and not at the pinned rate.
const PRICE_PER_M_BY_MODEL: Record<string, ModelPrices> = {
  [MIND_MODEL]: PRICE_PER_M,
}

export type PriceSource = 'provider' | 'model' | 'ceiling'
export type PriceLookup = { prices: ModelPrices; source: PriceSource }

// The provider row wins. Anything unattributed or unpriced resolves to the ceiling and reports
// `ceiling`, so it can never silently book cheap.
export function pricesFor(
  model: string | undefined,
  provider: string | null | undefined,
): PriceLookup {
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

// TEST BRANCH: this model refuses `enabled:false` on every endpoint and answers worse under
// `effort:'minimal'`, so no caller below sets the field at all and the client omits it.
export type ReasoningSetting =
  | { enabled: false }
  | { effort: 'minimal' | 'low' | 'medium' | 'high' }

// What one caller's calls are pinned to, over and above the routing every call shares. An
// absent field leaves that dial exactly where it sat before the dial existed.
export type CallSettings = {
  reasoning?: ReasoningSetting
  maxOutputTokens?: number
  temperature?: number
}

// A ceiling is 2x that caller's measured p99, taken as it will NOW run. Reasoning tokens bill
// inside `max_tokens` here and cannot be turned off, so every ceiling carries them too.
const SETTINGS_BY_CALLER: Record<string, CallSettings> = {
  turn: { maxOutputTokens: 2000, temperature: 1 },
  // The five night calls and the sixth, the personality edit, whose p99 is 18x theirs.
  reflection: { maxOutputTokens: 3000 },
  'reflection.edit': { maxOutputTokens: 15000 },
  arbiter: { maxOutputTokens: 4000 },
  narrator: { maxOutputTokens: 22000 },
  preflight: { maxOutputTokens: 4000 },
  dream: { maxOutputTokens: 4000 },
  semantic: { maxOutputTokens: 5000 },
  constructs: { maxOutputTokens: 1500 },
}

const NO_SETTINGS: CallSettings = {}

export function callSettingsFor(caller: string): CallSettings {
  return SETTINGS_BY_CALLER[caller] ?? NO_SETTINGS
}

// The slowest sustained output rehearsal 4 measured, over every caller that answered.
const SLOWEST_OUTPUT_TOKENS_PER_S = 44
// The floor no caller goes under, however small its ceiling. An arbiter with no bound at all
// sat for 45 s and returned nothing.
export const MIN_REQUEST_TIMEOUT_MS = 30_000

/** A call may not outlive the time its own output ceiling needs to fill. Derived rather than
 *  pinned, so raising a ceiling above cannot silently start aborting honest answers. */
export function requestTimeoutMsFor(caller: string): number {
  const ceiling = SETTINGS_BY_CALLER[caller]?.maxOutputTokens
  if (ceiling === undefined) return MIN_REQUEST_TIMEOUT_MS
  return Math.max(MIN_REQUEST_TIMEOUT_MS, Math.ceil((ceiling / SLOWEST_OUTPUT_TOKENS_PER_S) * 1000))
}

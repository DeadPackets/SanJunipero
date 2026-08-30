// Measured on a live run, not chosen. Re-run scripts/probe.ts before changing it.
export const MIND_MODEL = 'deepseek/deepseek-v4-flash-0731' as const
// An allow-list that LOAD-BALANCES, not a priority order: measured 52/48 at production pace
// (providers2, 2026-08-30). Budget the second name at half the bill, not as a rare failover.
export const PROVIDER_ORDER: string[] = ['Baidu', 'Inceptron']
// Never add Together, Reka, DeepInfra, AkashML, Ambient or Mancer: each returns 100% well-formed
// Turns with `action: null` on 75-99% of calls, which only the pre-flight act bar catches.
// The fallback IS the pinned dated model; no alias ever answers for it.
export const FALLBACK_MODELS: string[] = []

export type ModelPrices = { input: number; output: number; cacheRead: number }

// $/M tokens. The price depends on WHO served the call, so the table is keyed by that and
// not by the model alone — two back ends for this one model differ 7x.
export const PRICE_PER_M_BY_PROVIDER: Record<string, ModelPrices> = {
  Wafer: { input: 0.28, output: 0.56, cacheRead: 0.07 },
  Inceptron: { input: 0.13, output: 0.28, cacheRead: 0.03 },
  // Off the allow-list since providers2 (2026-08-30); the row stays so old ledger rows price.
  AtlasCloud: { input: 0.44, output: 1.32, cacheRead: 0.028 },
  // Reconciled against the bill: these are the discounted rates charged, not the list rates.
  Baidu: { input: 0.04494, output: 0.08988, cacheRead: 0.008988 },
  StreamLake: { input: 0.247016, output: 0.741048, cacheRead: 0.0078596 },
  DeepInfra: { input: 0.08, output: 0.18, cacheRead: 0.016 },
}

// The per-component maximum over every endpoint serving MIND_MODEL, peak legs included, so an
// unpriced back end can only ever OVER-report.
export const CEILING_PRICE_PER_M: ModelPrices = { input: 0.44, output: 1.32, cacheRead: 0.114 }

// The pinned route's real price. Kept as the name the rest of the tree imports.
export const PRICE_PER_M: ModelPrices = PRICE_PER_M_BY_PROVIDER.Baidu!

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

// Unset bills the same thinking preamble as `effort:'high'` — the endpoint default IS the
// maximum — and the four effort rungs are indistinguishable; only `enabled:false` moves anything.
export type ReasoningSetting =
  | { enabled: false }
  | { effort: 'minimal' | 'low' | 'medium' | 'high' }

// What one caller's calls are pinned to, over and above the routing every call shares. An
// absent field leaves that dial exactly where it sat before the dial existed.
export type CallSettings = { reasoning?: ReasoningSetting; maxOutputTokens?: number }

// A ceiling is 2x that caller's measured p99, taken as it will NOW run: the answer alone
// where reasoning is off, the whole output where it stays on. Truncation is a hard failure.
const SETTINGS_BY_CALLER: Record<string, CallSettings> = {
  // Reasoning was 94% of a turn's output and bought nothing: with it off, parse held at 100%
  // and grounding rose. The answer alone has a p99 of 243 tokens.
  turn: { reasoning: { enabled: false }, maxOutputTokens: 500 },
  // The five night calls lose nothing without thinking. The sixth, the personality edit, does,
  // and its p99 is 18x theirs — hence a caller of its own rather than one shared ceiling.
  // 700 truncated the ledger writes; 1500 clears the longest of them.
  reflection: { reasoning: { enabled: false }, maxOutputTokens: 1500 },
  'reflection.edit': { maxOutputTokens: 13000 },
  arbiter: { maxOutputTokens: 8000 },
  narrator: { maxOutputTokens: 22000 },
  preflight: { maxOutputTokens: 2500 },
  dream: { maxOutputTokens: 2500 },
  // Reading one day back for its firsts is a lookup, not a judgement: thinking about it once
  // spent 31,179 reasoning tokens and still answered nothing. 4,000 stands on one call.
  semantic: { reasoning: { enabled: false }, maxOutputTokens: 4000 },
  // Picking one label out of five spent 14,072 output tokens, 99.5% of it reasoning; off, it
  // answers in 20. 500 and not 100: the schema returns one ruling per candidate.
  constructs: { reasoning: { enabled: false }, maxOutputTokens: 500 },
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

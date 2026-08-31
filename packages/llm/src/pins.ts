// Measured on a live bake-off, not chosen. Re-run scripts/probe.ts before changing it.
// OpenRouter publishes no dated snapshot for this model, so the bare id is the only id there
// is; see the pins test for the dated-pin exception.
export const MIND_MODEL = 'z-ai/glm-5.3-flash' as const
// Single-homed by necessity, not by the load-balancing law: probed on the nullable-act schema,
// 19 of 20 endpoints returned a Turn with no action on 75-100% of calls; Wafer cleared 36/36 acts.
export const PROVIDER_ORDER: string[] = ['Wafer']
// The fleet's second model. GLM only earns its premium where a mind must NAME what it acts on;
// DeepSeek wrote the best prose of the three, and a text-only caller cannot emit a blank act.
export const PROSE_MODEL = 'deepseek/deepseek-v4-flash-0731' as const
// Baidu lost the slot 2026-08-31: it tripled list price to parity and its shared-pool quota
// 429'd 95% of structured calls at Beijing peak; Inceptron probed 84/84 answered, p95 1.75s.
export const PROSE_PROVIDER_ORDER: string[] = ['Inceptron']
// Never add Together, Reka, DeepInfra, AkashML, Ambient or Mancer: on the nullable-act probe each
// returned 100% well-formed Turns, `action: null` on 75-99%; only pre-flight's act bar catches it.
// The fallback IS the pinned model; no alias ever answers for it.
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

// The per-component maximum over every endpoint the ledger has ever routed to, peak legs
// included, so an unpriced back end can only ever OVER-report.
export const CEILING_PRICE_PER_M: ModelPrices = { input: 0.44, output: 1.32, cacheRead: 0.114 }

// The pinned route's real price. Kept as the name the rest of the tree imports.
export const PRICE_PER_M: ModelPrices = PRICE_PER_M_BY_PROVIDER.Wafer!

// For the case where a fallback MODEL answered rather than a different back end. An unlisted
// model is a different product, so it books at the ceiling and not at the pinned rate.
const PRICE_PER_M_BY_MODEL: Record<string, ModelPrices> = {
  [MIND_MODEL]: PRICE_PER_M,
}

// Either fleet model prices by WHO served it; anything else is a different product.
const PINNED_MODELS: string[] = [MIND_MODEL, PROSE_MODEL]

export type PriceSource = 'provider' | 'model' | 'ceiling'
export type PriceLookup = { prices: ModelPrices; source: PriceSource }

// The provider row wins. Anything unattributed or unpriced resolves to the ceiling and reports
// `ceiling`, so it can never silently book cheap.
export function pricesFor(
  model: string | undefined,
  provider: string | null | undefined,
): PriceLookup {
  const servedPinnedModel = model === undefined || PINNED_MODELS.includes(model)
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

// GLM refuses `enabled:false` on every endpoint and answers worse under `effort:'minimal'`, so
// no caller on that half of the fleet names the field; the DeepSeek half keeps its own pins.
export type ReasoningSetting =
  | { enabled: false }
  | { effort: 'minimal' | 'low' | 'medium' | 'high' }

// What one caller's calls are pinned to, over and above the routing every call shares. An
// absent field leaves that dial exactly where it sat before the dial existed.
export type CallSettings = {
  reasoning?: ReasoningSetting
  maxOutputTokens?: number
  temperature?: number
  model?: string
  providerOrder?: string[]
  // Raises the derived request bound where the tail is prefill and not decode.
  minTimeoutMs?: number
}

// Wafer's tail is prefill and queueing, not decode: 14.7 s p95 and 41.0 s max on 300-token
// answers, so a bound derived from the output ceiling alone aborts honest answers and re-bills.
const ON_GLM = { model: MIND_MODEL, providerOrder: PROVIDER_ORDER, minTimeoutMs: 45_000 }
const ON_DEEPSEEK = { model: PROSE_MODEL, providerOrder: PROSE_PROVIDER_ORDER }

// A ceiling is 2x that caller's measured p99, taken as it will NOW run: the answer alone where
// reasoning is off, the whole output where it stays on. On GLM it can never be off, so each of
// those ceilings carries 2x87 tokens more of mandatory preamble. Truncation is a hard failure.
const SETTINGS_BY_CALLER: Record<string, CallSettings> = {
  // GLM's own turn p99 is 287 output tokens, preamble included. Temperature 1 is the sampling
  // the bake-off measured its voice and its 100% named-object act rate at.
  turn: { ...ON_GLM, maxOutputTokens: 600, temperature: 1 },
  // 700 truncated the ledger writes and 1500 cleared the longest of them; +174 for the preamble.
  reflection: { ...ON_GLM, maxOutputTokens: 1750 },
  // Sized around a thinking preamble larger than this model's, so neither of these moves.
  'reflection.edit': { ...ON_GLM, maxOutputTokens: 13000 },
  // A dream is prose, but it is a mind caller: one allow-list guards everything a mind thinks
  // through, and that one-line law is worth more than a stylist's dreams at 1% of the bill.
  dream: { ...ON_GLM, maxOutputTokens: 2500 },
  // Pre-flight's act bar gates exactly the pair the turn will run on. It never leaves that pair.
  preflight: { ...ON_GLM, maxOutputTokens: 2500 },
  // One long memory set down short at the night boundary. The ask is two or three sentences;
  // 200 leaves room for a long promise without letting a gist grow back into the row it replaces.
  'reflection.gist': { ...ON_DEEPSEEK, reasoning: { enabled: false }, maxOutputTokens: 200 },
  // The court writes permanent law, so it gets the mind model: a ruling's params carry the same
  // binding GLM fills 100% and DeepSeek blanked. Its mandatory reasoning bills inside the 4,000.
  arbiter: { ...ON_GLM, maxOutputTokens: 4000 },
  // Narrator prose is what its thinking buys, and 5.5% of the bill is what it costs.
  narrator: { ...ON_DEEPSEEK, maxOutputTokens: 22000 },
  naming: ON_DEEPSEEK,
  voice: ON_DEEPSEEK,
  // Reading one day back for its firsts is a lookup, not a judgement: thinking about it once
  // spent 31,179 reasoning tokens and still answered nothing. 4,000 stands on one call.
  semantic: { ...ON_DEEPSEEK, reasoning: { enabled: false }, maxOutputTokens: 4000 },
  // Picking one label out of five spent 14,072 output tokens, 99.5% of it reasoning; off, it
  // answers in 20. 500 and not 100: the schema returns one ruling per candidate.
  constructs: { ...ON_DEEPSEEK, reasoning: { enabled: false }, maxOutputTokens: 500 },
}

const NO_SETTINGS: CallSettings = {}

export function callSettingsFor(caller: string): CallSettings {
  return SETTINGS_BY_CALLER[caller] ?? NO_SETTINGS
}

/** Which of the fleet's models answers for this caller. An unpinned caller keeps the mind's. */
export function modelFor(caller: string): string {
  return SETTINGS_BY_CALLER[caller]?.model ?? MIND_MODEL
}

// The slowest sustained output rehearsal 4 measured, over every caller that answered.
const SLOWEST_OUTPUT_TOKENS_PER_S = 44
// The floor no caller goes under, however small its ceiling. An arbiter with no bound at all
// sat for 45 s and returned nothing.
export const MIN_REQUEST_TIMEOUT_MS = 30_000

/** A call may not outlive the time its own output ceiling needs to fill. Derived rather than
 *  pinned, so raising a ceiling above cannot silently start aborting honest answers. */
export function requestTimeoutMsFor(caller: string): number {
  const pinned = SETTINGS_BY_CALLER[caller]
  const floor = pinned?.minTimeoutMs ?? MIN_REQUEST_TIMEOUT_MS
  const ceiling = pinned?.maxOutputTokens
  if (ceiling === undefined) return floor
  return Math.max(floor, Math.ceil((ceiling / SLOWEST_OUTPUT_TOKENS_PER_S) * 1000))
}

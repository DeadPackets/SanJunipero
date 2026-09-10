// One model for the whole town since 2026-09-05, measured and not chosen: over r19 and r20 the
// GLM homes ran 15-20 s turns with timeouts all afternoon, while this one answered in 6.5 s with
// one failure in 948 (r21). OpenRouter publishes no dated snapshot of it, so the bare id is the
// only id there is; see the pins test for the dated-pin exception.
const LUNA = 'openai/gpt-5.6-luna'

/** A trial route is ONE word, the same key the price table uses, so a model can never be swapped
 *  onto the back ends pinned for the model before it. Those are an allow-list, so a model sent
 *  to a home that does not serve it is refused on every call it makes. */
function trialRoute(raw: string | undefined): { model: string; providers: string[] } | undefined {
  if (raw === undefined || raw.trim().length === 0) return undefined
  const at = raw.indexOf('@')
  const model = raw.slice(0, at).trim()
  const providers = raw
    .slice(at + 1)
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
  if (at < 0 || model.length === 0 || providers.length === 0)
    throw new Error(
      `SJ_MIND_ROUTE names a model and the back ends that may serve it, as model@Provider or ` +
        `model@ProviderA,ProviderB. Got '${raw}'.`,
    )
  return { model, providers }
}

const TRIAL = trialRoute(process.env.SJ_MIND_ROUTE)

export const MIND_MODEL: string = TRIAL?.model ?? LUNA
// One home, not two: the `openai` tier is the one that was measured, and `openai/fast` bills 2x
// for the same answer. Its strict decoder is why every schema passes `strictSchemaFaults`.
export const PROVIDER_ORDER: string[] = TRIAL?.providers ?? ['OpenAI']
// Everything the town cannot take back: the court's physics, the council's law, and the compiler
// that turns a law into a rule. These think hardest; nothing per-tick or per-turn is on this list.
export const RULING_CALLERS: readonly string[] = ['arbiter', 'council', 'law.compile']
// The callers a mind's own thinking goes through, and the only ones the per-mind rate counts:
// the chronicle, the court and the tier-2.5 pass are town work at any cast size.
export const PER_MIND_CALLERS: readonly string[] = [
  'turn',
  'turn.compact',
  'reflection',
  'reflection.edit',
  'dream',
  'scene',
]

// The fallback IS the pinned model; no alias ever answers for it.
export const FALLBACK_MODELS: string[] = []

// The fleet before 2026-09-05, named here only so its ledger rows still price by who served them.
const GLM = 'z-ai/glm-5.3-flash'
const DEEPSEEK = 'deepseek/deepseek-v4-flash-0731'

export type ModelPrices = { input: number; output: number; cacheRead: number }

/** One route: the model AND the back end that served it. Both together, because a provider
 *  charges a different price for each fleet model — DeepInfra is 0.075/0.25 on the mind model
 *  and 0.080/0.180 on prose, and keying by the name alone booked prose at the mind's rate. */
const route = (model: string, provider: string): string => `${model}@${provider}`

// $/M tokens by route. The first row is the fleet; the rest are the retired fleet's homes, read
// from /api/v1/models/{slug}/endpoints on 2026-09-03 except where a row names its own bill, and
// kept so a ledger written before the flip still reconciles against what it was charged.
export const PRICE_PER_M_BY_ROUTE: Record<string, ModelPrices> = {
  // Wafer's GLM tier, measured against its own bill: the $0.075 list tier refuses json_schema.
  // Re-reconciled 2026-09-03: reported/estimated ran 0.668 over 502 calls while DeepInfra ran
  // 0.99, so the old row over-booked Wafer by half and raised 1,232 price-divergence alerts.
  // Fitted to 3,046 reconciled bills in r23, not read off the list: uncached input bills at
  // 0.25, the list's 0.20 ran the estimator 10% under and raised a stale-pin alert every run.
  [route(LUNA, 'OpenAI')]: { input: 0.25, output: 1.2, cacheRead: 0.02 },
  [route(GLM, 'Wafer')]: { input: 0.1, output: 0.35, cacheRead: 0.02 },
  [route(GLM, 'DeepInfra')]: { input: 0.075, output: 0.25, cacheRead: 0.016 },
  [route(DEEPSEEK, 'DeepInfra')]: { input: 0.08, output: 0.18, cacheRead: 0.016 },
  [route(DEEPSEEK, 'Inceptron')]: { input: 0.13, output: 0.28, cacheRead: 0.03 },
  [route(DEEPSEEK, 'Baidu')]: { input: 0.065, output: 0.1299, cacheRead: 0.013 },
  // The same back end on the other fleet model, at more than twice the price. Dropped from the
  // mind path, kept so old ledger rows still reconcile; it tripled overnight 2026-08-31 (was
  // 0.04494/0.08988/0.008988) and that was confirmed against a real bill.
  [route(GLM, 'Baidu')]: { input: 0.14, output: 0.28, cacheRead: 0.028 },
  [route(DEEPSEEK, 'Morph')]: { input: 0.0987, output: 0.278, cacheRead: 0.0198 },
  // Off the allow-list since providers2 (2026-08-30); the rows stay so old ledger rows price.
  [route(DEEPSEEK, 'AtlasCloud')]: { input: 0.44, output: 1.32, cacheRead: 0.028 },
  [route(DEEPSEEK, 'StreamLake')]: { input: 0.247016, output: 0.741048, cacheRead: 0.0078596 },
}

// Priced before served: the ceiling below is the maximum over these rows, so a route with no
// row of its own could bill above it and the ledger would under-book the whole trial.
for (const provider of PROVIDER_ORDER)
  if (PRICE_PER_M_BY_ROUTE[route(MIND_MODEL, provider)] === undefined)
    throw new Error(
      `${route(MIND_MODEL, provider)} has no row in PRICE_PER_M_BY_ROUTE. Read the rate off ` +
        `/api/v1/models/${MIND_MODEL}/endpoints and add one before this route serves a call.`,
    )

// The per-component maximum over every endpoint the ledger has ever routed to, peak legs
// included, so an unpriced back end can only ever OVER-report.
export const CEILING_PRICE_PER_M: ModelPrices = { input: 0.44, output: 1.32, cacheRead: 0.114 }

// The pinned route's real price. Kept as the name the rest of the tree imports, and derived
// from the order rather than named, so a flip cannot leave the estimator quoting the old home.
export const PRICE_PER_M: ModelPrices = PRICE_PER_M_BY_ROUTE[route(MIND_MODEL, PROVIDER_ORDER[0]!)]!

export type PriceSource = 'provider' | 'ceiling'
export type PriceLookup = { prices: ModelPrices; source: PriceSource }

// A route row or the ceiling. Anything unattributed or unpriced resolves to the ceiling and
// reports it, so it can never silently book cheap: a back end nobody named could be `openai/fast`
// at twice the price, and no model-keyed row may guess otherwise.
export function pricesFor(
  model: string | undefined,
  provider: string | null | undefined,
): PriceLookup {
  const row =
    model === undefined || provider == null
      ? undefined
      : PRICE_PER_M_BY_ROUTE[route(model, provider)]
  return row === undefined
    ? { prices: CEILING_PRICE_PER_M, source: 'ceiling' }
    : { prices: row, source: 'provider' }
}

// Every pinned caller names an effort; `enabled:false` is what the retired DeepSeek half took and
// a caller's own override may still send.
export type ReasoningSetting =
  | { enabled: false }
  | { effort: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' }

// What one caller's calls are pinned to, over and above the routing every call shares. An
// absent field leaves that dial exactly where it sat before the dial existed.
export type CallSettings = {
  reasoning?: ReasoningSetting
  // r37: 8 of 33 rulings thought for the whole 28k ceiling and answered nothing, then were re-asked
  // the same way. A runaway is asked once more at this effort instead, and never identically.
  fallbackReasoning?: ReasoningSetting
  maxOutputTokens?: number
  temperature?: number
  model?: string
  providerOrder?: string[]
  // Raises the derived request bound where the tail is prefill and not decode.
  minTimeoutMs?: number
  // Re-asks after a BURST LIMIT only, which is refused in milliseconds and bills nothing. A stall
  // is not patient the same way: re-asking a 295 s bound this often would block for 20 minutes.
  rateLimitRetries?: number
  // How long this caller queues at the back end's admission gate before giving its ask up unsent.
  maxQueueWaitMs?: number
  // This caller's own ceiling for a rolling 24 hours. The town's daily budget is the total; this
  // is what stops ONE caller eating it, and tripping it holds that caller and nobody else.
  // Seeded at 2x the caller's share of rehearsal 11's ledger under the $3 day, floor $0.05.
  dailyUsd?: number
}

// Ninety seconds and not the old 70: this model's tail is its own thinking, not queueing, and
// r22's longest honest turn ran 60 s.
const ON_LUNA = { model: MIND_MODEL, providerOrder: PROVIDER_ORDER, minTimeoutMs: 90_000 }
// Three efforts. r21 spent 58% of its bill on reasoning tokens: a ruling thinks hardest, a turn
// or a line thinks, and a caller that only restates what it is handed does not — a gist reasoned
// for 2,100 tokens to write 300 and was a third of the whole bill until it stopped.
const JUDGES: CallSettings = {
  reasoning: { effort: 'xhigh' },
  fallbackReasoning: { effort: 'high' },
}
// Medium, on trial from r46. r45 spent 259 reasoning tokens on the mean turn and 280 on the
// mean line, and the ask is whether the town notices the difference.
const THINKS: CallSettings = { reasoning: { effort: 'medium' } }
const RESTATES: CallSettings = { reasoning: { effort: 'minimal' } }

// Rehearsal r3: all 21 refused reflection attempts were 429s, and every one had a mind call
// ANSWER within 5 s of it — a burst to wait out, not an outage. Six of these must land in a row
// before the night writes its gists, so two attempts left 1 night in 10 getting that far.
const WAITS_OUT_A_BURST = { rateLimitRetries: 3, maxQueueWaitMs: 60_000 }

/** The rail no caller goes under, however little rehearsal 11 saw it spend: a caller measured
 *  at a tenth of a cent still has to be able to answer the day it is actually needed. */
export const RAIL_FLOOR_USD = 0.05

// A ceiling is 2x that caller's measured p99 output, reasoning included (r21 at xhigh, r22 where
// the effort is now lower), and truncation is a hard failure. A rail is 4x what r22 measured the
// caller spending in a real day at speed 2, when thirty sim-days pass in one; a watched town at
// speed 1 runs the same thirty.
const SETTINGS_BY_CALLER: Record<string, CallSettings> = {
  // p99 3,486 and max 6,621 over 947 turns. One call ahead of you drains in a few seconds and an
  // idle turn is 15 sim-minutes apart, so 20 s of queue covers a wait one deep; past that the
  // mind is standing still and gives the ask up.
  turn: {
    ...ON_LUNA,
    ...THINKS,
    maxQueueWaitMs: 20_000,
    maxOutputTokens: 7500,
    temperature: 1.1,
    dailyUsd: 50,
  },
  // The day log folded short when it outgrows its block, mid-day. Restated, not judged: on the
  // turn's own pin it thought for 1,000 tokens per fold and wrote 104 of them into r21's ledger
  // under the turn's name, 5% of the bill and zero cache.
  'turn.compact': { ...ON_LUNA, ...RESTATES, maxOutputTokens: 1500, dailyUsd: 1 },
  // A night's ledger is the longest thought a mind has: p99 6,837, and 7,750 cut two of 255.
  reflection: {
    ...ON_LUNA,
    ...THINKS,
    ...WAITS_OUT_A_BURST,
    maxOutputTokens: 14_000,
    dailyUsd: 15,
  },
  'reflection.edit': {
    ...ON_LUNA,
    ...THINKS,
    ...WAITS_OUT_A_BURST,
    maxOutputTokens: 13_000,
    dailyUsd: 0.5,
  },
  dream: { ...ON_LUNA, ...THINKS, maxOutputTokens: 3000, dailyUsd: 0.2 },
  // Pre-flight's act bar gates exactly the route the turn will run on. It never leaves it.
  preflight: { ...ON_LUNA, ...THINKS, maxOutputTokens: 3000, dailyUsd: 0.3 },
  // One long memory set down short at the night boundary: two or three sentences, p99 628 with
  // the restating effort. Not 300: 27 of r13's 786 gists stopped mid-mark on that ceiling.
  'reflection.gist': { ...ON_LUNA, ...RESTATES, maxOutputTokens: 1500, dailyUsd: 13 },
  // The court writes what the town can never take back, so it thinks hardest: a ruling at max
  // spent 9,000 tokens thinking in r21 and overran a 10,000 ceiling twice.
  // r37: 25 good rulings topped out at 10,045 tokens; the 8 that hit 28,000 were runaways; the pin law keeps 2x the measured p99 (9,819).
  arbiter: { ...ON_LUNA, ...JUDGES, maxOutputTokens: 20_000, dailyUsd: 3 },
  council: { ...ON_LUNA, ...JUDGES, maxOutputTokens: 20_000, dailyUsd: RAIL_FLOOR_USD },
  'law.compile': { ...ON_LUNA, ...JUDGES, maxOutputTokens: 20_000, dailyUsd: RAIL_FLOOR_USD },
  // One line said out loud, paid by the mouth that says it. Same route as the turn, so the two
  // share one warm prefix. p99 1,127 over 523 lines; bounded at 60 s, under the scene's own
  // 90 s floor timeout, so the call dies before the floor takes the line away.
  // r24 heard medium here and it reasoned as long as high and doubled a tic. That was before the
  // speech rules were rewritten, so r46 asks the line again and speech.py answers it.
  scene: {
    ...ON_LUNA,
    ...THINKS,
    minTimeoutMs: 60_000,
    maxQueueWaitMs: 10_000,
    maxOutputTokens: 2500,
    temperature: 1.2,
    dailyUsd: 16,
  },
  // Two sentences and a short list of ties, once per scene: restated, not judged. p99 352.
  'scene.close': { ...ON_LUNA, ...RESTATES, maxOutputTokens: 1500, dailyUsd: 1 },
  // The day's chapter is what its thinking buys: 8,923 tokens on r22's longest.
  narrator: { ...ON_LUNA, ...THINKS, maxOutputTokens: 28_000, dailyUsd: 3 },
  naming: { ...ON_LUNA, ...RESTATES, maxOutputTokens: 8000, dailyUsd: RAIL_FLOOR_USD },
  voice: { ...ON_LUNA, ...RESTATES, maxOutputTokens: 8000, dailyUsd: RAIL_FLOOR_USD },
  // Reading one day back for its firsts is a lookup, not a judgement: thinking about it once
  // spent 31,179 reasoning tokens and still answered nothing. p99 677 without.
  semantic: { ...ON_LUNA, ...RESTATES, maxOutputTokens: 4000, dailyUsd: 1 },
  // Picking one label out of five spent 14,072 output tokens, 99.5% of it reasoning; without,
  // it answers in 20. The schema returns one ruling per candidate.
  constructs: { ...ON_LUNA, ...RESTATES, maxOutputTokens: 1500, dailyUsd: RAIL_FLOOR_USD },
}

/** Every caller with a pin of its own, in declaration order. The rate monitor reads this so a
 *  new caller on the mind's route cannot be added without the per-mind ceiling seeing it. */
export const PINNED_CALLERS: string[] = Object.keys(SETTINGS_BY_CALLER)

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
  const pinned = callSettingsFor(caller)
  const floor = pinned.minTimeoutMs ?? MIN_REQUEST_TIMEOUT_MS
  const ceiling = pinned.maxOutputTokens
  if (ceiling === undefined) return floor
  return Math.max(floor, Math.ceil((ceiling / SLOWEST_OUTPUT_TOKENS_PER_S) * 1000))
}

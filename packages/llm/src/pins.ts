// Measured on a live bake-off, not chosen. Re-run scripts/probe.ts before changing it.
// OpenRouter publishes no dated snapshot for this model, so the bare id is the only id there
// is; see the pins test for the dated-pin exception.
export const MIND_MODEL = 'z-ai/glm-5.3-flash' as const
// Two homes since the 2026-09-01 bake-off: DeepInfra cleared 60/60 acts under 8-way concurrency
// with no 429; every other GLM endpoint rate-limited, emptied, or failed the act schema.
// The order of these two buys nothing: with `allow_fallbacks:false` this list is an ALLOW-LIST
// and OpenRouter picks inside it. Flipping it 2026-09-03 changed no routing at all — 72 of 72
// mind calls still went to Wafer — so the mind route now sends the pair as `provider.only`,
// which naming an order would have disabled: OpenRouter drops sticky routing whenever one is
// named, and without stickiness a mind's 594-token identity prefix never cached once in r13.
// Worth doing, and measured: over 2.96 sim-days DeepInfra answered 610 calls at $0.0000857 each
// and failed none, while Wafer answered 502 at $0.000350 — 4.1x — and refused 155 more upstream.
// A refusal also dozes the mind six ticks, and 21 landed on scene lines, stopping a conversation
// mid-floor. Wafer stays first here only because PRICE_PER_M reads this slot and Wafer is who
// actually serves; changing that ahead of the routing would halve every estimate.
export const PROVIDER_ORDER: string[] = ['Wafer', 'DeepInfra']
// The fleet's second model. GLM only earns its premium where a mind must NAME what it acts on;
// DeepSeek wrote the best prose of the three, and a text-only caller cannot emit a blank act.
export const PROSE_MODEL = 'deepseek/deepseek-v4-flash-0731' as const
// A list of one name has nowhere to fall, and Inceptron alone refused 67% of scene closes over
// 3 sim-days. DeepInfra leads on the same model: $0.0882/M against $0.1402, 474 calls against 38.
// Two names were not depth enough either: on 2026-09-03 both were down at once — DeepInfra 0/6
// and Inceptron 1/6 at a 7.5 s median, probed with a real json_schema call at concurrency 6 —
// and the chronicle wrote nothing on either of two rehearsal days. Baidu and Morph took 6/6 and
// 5/6 in the same probe and neither is on the act-emitting ban list above.
export const PROSE_PROVIDER_ORDER: string[] = ['DeepInfra', 'Baidu', 'Morph', 'Inceptron']
// A ruling is permanent, so the court buys the model that reads one best: over 12 of world two's
// rulings it agreed 32/36, where GLM took 25/33 and DeepSeek v4-pro 26/36. No dated snapshot.
export const RULING_MODEL = 'openai/gpt-5.6-luna' as const
// One home, not two: the `openai` tier is the one that was measured, and `openai/fast` bills 2x
// for the same answer. Its decoder is why `StrictVerdictSchema` exists.
export const RULING_PROVIDER_ORDER: string[] = ['OpenAI']
// Everything the town cannot take back: the court's physics, the council's law, and the compiler
// that turns a law into a rule. Nothing per-tick or per-turn is on this list.
export const RULING_CALLERS: readonly string[] = ['arbiter', 'council', 'law.compile']

// No act-emitting caller may route to Together, Reka, AkashML, Ambient or Mancer: each
// returned `action: null` on 75-99% of otherwise well-formed Turns; only pre-flight's bar sees it.
// The fallback IS the pinned model; no alias ever answers for it.
export const FALLBACK_MODELS: string[] = []
// A gist emits no act and no schema, so the ban above does not reach it: on three live rows
// DeepInfra kept 4/4 marks with none invented, at 0.08/0.18 against Inceptron's 0.13/0.28.
// Inceptron second for depth only — 63 gists were lost to a one-name list with nowhere to fall.
export const GIST_PROVIDER_ORDER: string[] = ['DeepInfra', 'Baidu', 'Morph', 'Inceptron']

export type ModelPrices = { input: number; output: number; cacheRead: number }

/** One route: the model AND the back end that served it. Both together, because a provider
 *  charges a different price for each fleet model — DeepInfra is 0.075/0.25 on the mind model
 *  and 0.080/0.180 on prose, and keying by the name alone booked prose at the mind's rate. */
const route = (model: string, provider: string): string => `${model}@${provider}`

// $/M tokens by route. Read from /api/v1/models/{slug}/endpoints on 2026-09-03 except where a
// row names its own bill; a cacheRead nobody publishes is taken at the fleet's 0.2x of input,
// which over-books rather than under-books.
export const PRICE_PER_M_BY_ROUTE: Record<string, ModelPrices> = {
  // Wafer's GLM tier, measured against its own bill: the $0.075 list tier refuses json_schema.
  // Re-reconciled 2026-09-03: reported/estimated ran 0.668 over 502 calls while DeepInfra ran
  // 0.99, so the old row over-booked Wafer by half and raised 1,232 price-divergence alerts.
  [route(MIND_MODEL, 'Wafer')]: { input: 0.1, output: 0.35, cacheRead: 0.02 },
  [route(RULING_MODEL, 'OpenAI')]: { input: 0.2, output: 1.2, cacheRead: 0.02 },
  [route(MIND_MODEL, 'DeepInfra')]: { input: 0.075, output: 0.25, cacheRead: 0.016 },
  [route(PROSE_MODEL, 'DeepInfra')]: { input: 0.08, output: 0.18, cacheRead: 0.016 },
  [route(PROSE_MODEL, 'Inceptron')]: { input: 0.13, output: 0.28, cacheRead: 0.03 },
  [route(PROSE_MODEL, 'Baidu')]: { input: 0.065, output: 0.1299, cacheRead: 0.013 },
  // The same back end on the other fleet model, at more than twice the price. Dropped from the
  // mind path, kept so old ledger rows still reconcile; it tripled overnight 2026-08-31 (was
  // 0.04494/0.08988/0.008988) and that was confirmed against a real bill.
  [route(MIND_MODEL, 'Baidu')]: { input: 0.14, output: 0.28, cacheRead: 0.028 },
  [route(PROSE_MODEL, 'Morph')]: { input: 0.0987, output: 0.278, cacheRead: 0.0198 },
  // Off the allow-list since providers2 (2026-08-30); the rows stay so old ledger rows price.
  [route(PROSE_MODEL, 'AtlasCloud')]: { input: 0.44, output: 1.32, cacheRead: 0.028 },
  [route(PROSE_MODEL, 'StreamLake')]: { input: 0.247016, output: 0.741048, cacheRead: 0.0078596 },
}

// The per-component maximum over every endpoint the ledger has ever routed to, peak legs
// included, so an unpriced back end can only ever OVER-report.
export const CEILING_PRICE_PER_M: ModelPrices = { input: 0.44, output: 1.32, cacheRead: 0.114 }

// The pinned route's real price. Kept as the name the rest of the tree imports, and derived
// from the order rather than named, so a flip cannot leave the estimator quoting the old home.
export const PRICE_PER_M: ModelPrices = PRICE_PER_M_BY_ROUTE[route(MIND_MODEL, PROVIDER_ORDER[0]!)]!

// Keyed by the model where the model, not the back end, is what sets the price: the single-homed
// ruling model. A FLEET model may never be listed here — `pricesFor` reads this table only for a
// model the pins do not name, so such a row is dead. An unlisted model books at the ceiling.
const PRICE_PER_M_BY_MODEL: Record<string, ModelPrices> = {
  [RULING_MODEL]: { input: 0.2, output: 1.2, cacheRead: 0.02 },
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
  if (servedPinnedModel && provider != null && model !== undefined) {
    const row = PRICE_PER_M_BY_ROUTE[route(model, provider)]
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
  | { effort: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' }

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

// Wafer's tail is prefill and queueing, not decode: 14.7 s p95 and 41.0 s max on 300-token
// answers, so a bound derived from the output ceiling alone aborts honest answers and re-bills.
// 70 s and not 45: over r13 the turn's p99 was 38.9 s and its longest honest answer 43.5 s, with
// reflection at 41.2 s — the old bound sat inside the real tail and cut 35 answers off unbilled.
const ON_GLM = { model: MIND_MODEL, providerOrder: PROVIDER_ORDER, minTimeoutMs: 70_000 }
const ON_DEEPSEEK = { model: PROSE_MODEL, providerOrder: PROSE_PROVIDER_ORDER }
// Measured at this effort and no other: at 'low' it answered in 4.4 s p50 with every ruling on
// the schema. The ceiling is 2x the longest recipe the bake-off saw, reasoning included.
const ON_RULING: CallSettings = {
  model: RULING_MODEL,
  providerOrder: RULING_PROVIDER_ORDER,
  reasoning: { effort: 'low' },
  maxOutputTokens: 4000,
}

// Rehearsal r3: all 21 refused reflection attempts were Wafer 429s, and every one had a mind call
// ANSWER within 5 s of it — a burst to wait out, not an outage. Six of these must land in a row
// before the night writes its gists, so two attempts left 1 night in 10 getting that far.
const WAITS_OUT_A_BURST = { rateLimitRetries: 3, maxQueueWaitMs: 60_000 }

/** The rail no caller goes under, however little rehearsal 11 saw it spend: a caller measured
 *  at a tenth of a cent still has to be able to answer the day it is actually needed. */
export const RAIL_FLOOR_USD = 0.05

// A ceiling is 2x that caller's measured p99, taken as it will NOW run: the answer alone where
// reasoning is off, the whole output where it stays on. On GLM it can never be off, so each of
// those ceilings carries 2x87 tokens more of mandatory preamble. Truncation is a hard failure.
const SETTINGS_BY_CALLER: Record<string, CallSettings> = {
  // Not 2x the 287-token p99: a plan step on the wire is now the whole closed grammar, and a
  // full twelve-step turn measured 1,019 output tokens live, which 600 would have truncated.
  // One call ahead of you drains in Wafer's 14.7 s p95 and an idle turn is 60 s apart, so 20 s of
  // queue covers a wait one deep; past that the mind is standing still and gives the ask up.
  turn: {
    ...ON_GLM,
    maxQueueWaitMs: 20_000,
    maxOutputTokens: 1500,
    temperature: 1,
    dailyUsd: 3.31,
  },
  // 700 truncated the ledger writes and 1500 cleared the longest of them; +174 for the preamble.
  reflection: { ...ON_GLM, ...WAITS_OUT_A_BURST, maxOutputTokens: 1750, dailyUsd: 0.8 },
  // Sized around a thinking preamble larger than this model's, so neither of these moves.
  'reflection.edit': {
    ...ON_GLM,
    ...WAITS_OUT_A_BURST,
    maxOutputTokens: 13000,
    dailyUsd: 0.16,
  },
  // A dream is prose, but it is a mind caller: one allow-list guards everything a mind thinks
  // through, and that one-line law is worth more than a stylist's dreams at 1% of the bill.
  dream: { ...ON_GLM, maxOutputTokens: 2500, dailyUsd: RAIL_FLOOR_USD },
  // Pre-flight's act bar gates exactly the pair the turn will run on. It never leaves that pair.
  preflight: { ...ON_GLM, maxOutputTokens: 2500, dailyUsd: RAIL_FLOOR_USD },
  // One long memory set down short at the night boundary. The ask is two or three sentences;
  // 300 leaves room for a long promise without letting a gist grow back into the row it
  // replaces. Not 200: 27 of r13's 786 gists stopped mid-mark on that ceiling.
  'reflection.gist': {
    ...ON_DEEPSEEK,
    providerOrder: GIST_PROVIDER_ORDER,
    reasoning: { enabled: false },
    maxOutputTokens: 300,
    dailyUsd: 0.27,
  },
  // The court writes what the town can never take back, so it is the one place the fleet pays
  // for a stronger reader. Thinking is what buys the judgement; 4,000 covers it and the ruling.
  arbiter: { ...ON_RULING, dailyUsd: 0.18 },
  council: { ...ON_RULING, dailyUsd: RAIL_FLOOR_USD },
  'law.compile': { ...ON_RULING, dailyUsd: RAIL_FLOOR_USD },
  // One line said out loud, paid by the mouth that says it. Same route as the turn, so the two
  // share one warm prefix; bounded under the scene's own floor timeout, which drops a later
  // answer. 40 s and not 25: 14 lines aborted at 25 s against a measured p99 of 17.9 s.
  scene: {
    ...ON_GLM,
    minTimeoutMs: 40_000,
    maxQueueWaitMs: 10_000,
    maxOutputTokens: 300,
    temperature: 1,
    dailyUsd: 0.75,
  },
  // Narrator prose is what its thinking buys, and 5.5% of the bill is what it costs.
  // Two sentences and a short list of ties, once per scene. Prose, so it takes the prose pin.
  'scene.close': {
    ...ON_DEEPSEEK,
    reasoning: { enabled: false },
    maxOutputTokens: 600,
    dailyUsd: 0.06,
  },
  narrator: { ...ON_DEEPSEEK, maxOutputTokens: 22000, dailyUsd: 0.12 },
  naming: { ...ON_DEEPSEEK, dailyUsd: RAIL_FLOOR_USD },
  voice: { ...ON_DEEPSEEK, dailyUsd: RAIL_FLOOR_USD },
  // Reading one day back for its firsts is a lookup, not a judgement: thinking about it once
  // spent 31,179 reasoning tokens and still answered nothing. 4,000 stands on one call.
  semantic: {
    ...ON_DEEPSEEK,
    reasoning: { enabled: false },
    maxOutputTokens: 4000,
    dailyUsd: RAIL_FLOOR_USD,
  },
  // Picking one label out of five spent 14,072 output tokens, 99.5% of it reasoning; off, it
  // answers in 20. 500 and not 100: the schema returns one ruling per candidate.
  constructs: {
    ...ON_DEEPSEEK,
    reasoning: { enabled: false },
    maxOutputTokens: 500,
    dailyUsd: RAIL_FLOOR_USD,
  },
}

/** Every caller with a pin of its own, in declaration order. The rate monitor reads this so a
 *  new caller on the mind's route cannot be added without the per-mind ceiling seeing it. */
export const PINNED_CALLERS: string[] = Object.keys(SETTINGS_BY_CALLER)

const NO_SETTINGS: CallSettings = {}

/** `SJ_FLEET=luna`: the whole town on the ruling model, served by OpenAI, reasoning at xhigh
 *  (max on a ruling took 61 s and overran its ceiling twice in r21). Output ceilings and rails
 *  widen because a reasoning model spends its tokens before the answer. */
const FLEET: 'pinned' | 'luna' = process.env.SJ_FLEET === 'luna' ? 'luna' : 'pinned'
const LUNA_OUTPUT_ROOM = 6000
// A ruling at max reasoning spent 9,000 tokens thinking and hit a 10,000 ceiling twice in r21.
const LUNA_RULING_ROOM = 24_000
const LUNA_RAIL_FACTOR = 15
// Callers that only restate what they are handed: a gist reasoned for 2,100 tokens to write
// 300 in r21 and was a third of the whole bill. Nothing here decides anything.
const LUNA_NO_THOUGHT: readonly string[] = [
  'reflection.gist',
  'scene.close',
  'semantic',
  'constructs',
  'naming',
  'voice',
]

function onLuna(caller: string, pinned: CallSettings): CallSettings {
  const ruling = RULING_CALLERS.includes(caller)
  return {
    ...pinned,
    model: RULING_MODEL,
    providerOrder: RULING_PROVIDER_ORDER,
    reasoning: { effort: LUNA_NO_THOUGHT.includes(caller) ? 'minimal' : 'xhigh' },
    maxOutputTokens:
      (pinned.maxOutputTokens ?? 2000) + (ruling ? LUNA_RULING_ROOM : LUNA_OUTPUT_ROOM),
    minTimeoutMs: Math.max(pinned.minTimeoutMs ?? 0, 90_000),
    ...(pinned.dailyUsd === undefined ? {} : { dailyUsd: pinned.dailyUsd * LUNA_RAIL_FACTOR }),
  }
}

export function callSettingsFor(caller: string): CallSettings {
  const pinned = SETTINGS_BY_CALLER[caller] ?? NO_SETTINGS
  return FLEET === 'luna' ? onLuna(caller, pinned) : pinned
}

/** Which of the fleet's models answers for this caller. An unpinned caller keeps the mind's. */
export function modelFor(caller: string): string {
  if (FLEET === 'luna') return RULING_MODEL
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
  const pinned = callSettingsFor(caller)
  const floor = pinned.minTimeoutMs ?? MIN_REQUEST_TIMEOUT_MS
  const ceiling = pinned.maxOutputTokens
  if (ceiling === undefined) return floor
  return Math.max(floor, Math.ceil((ceiling / SLOWEST_OUTPUT_TOKENS_PER_S) * 1000))
}

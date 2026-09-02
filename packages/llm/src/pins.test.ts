import { expect, it } from 'vitest'
import { CLOSED_KEYS, PLAN_MAX_STEPS } from '@sj/shared'
import {
  CEILING_PRICE_PER_M,
  FALLBACK_MODELS,
  GIST_PROVIDER_ORDER,
  MIND_MODEL,
  MIN_REQUEST_TIMEOUT_MS,
  PRICE_PER_M,
  PRICE_PER_M_BY_PROVIDER,
  PROSE_MODEL,
  PROSE_PROVIDER_ORDER,
  PROVIDER_ORDER,
  RULING_CALLERS,
  RULING_MODEL,
  RULING_PROVIDER_ORDER,
  callSettingsFor,
  modelFor,
  pricesFor,
  requestTimeoutMsFor,
} from './pins.js'

it('pins are concrete', () => {
  expect(MIND_MODEL).toBe('z-ai/glm-5.3-flash')
  expect(PROVIDER_ORDER).toEqual(['Wafer', 'DeepInfra'])
  expect(GIST_PROVIDER_ORDER).toEqual(['DeepInfra'])
  // Dropped from the call path, kept in the price table: old ledger rows still reconcile against it.
  expect(PRICE_PER_M_BY_PROVIDER.Baidu).toBeDefined()
  // The one exception to the dated-pin law: OpenRouter publishes no dated snapshot of
  // glm-5.3-flash, only the bare id and a `:batch` variant, so there is no date to pin to.
  for (const id of FALLBACK_MODELS) expect(id, id).toMatch(/-\d{4}$/)
  expect(PRICE_PER_M).toEqual({ input: 0.15, output: 0.5, cacheRead: 0.03 })
})

it('every allowed provider is priced, and the first is what PRICE_PER_M reports', () => {
  for (const name of PROVIDER_ORDER) expect(PRICE_PER_M_BY_PROVIDER[name], name).toBeDefined()
  expect(PRICE_PER_M_BY_PROVIDER[PROVIDER_ORDER[0]!]).toEqual(PRICE_PER_M)
})

it('the ceiling is at least as expensive as every priced provider', () => {
  for (const [name, p] of Object.entries(PRICE_PER_M_BY_PROVIDER)) {
    expect(CEILING_PRICE_PER_M.input, name).toBeGreaterThanOrEqual(p.input)
    expect(CEILING_PRICE_PER_M.output, name).toBeGreaterThanOrEqual(p.output)
    expect(CEILING_PRICE_PER_M.cacheRead, name).toBeGreaterThanOrEqual(p.cacheRead)
  }
})

it('prices the pinned model by who served it', () => {
  expect(pricesFor(MIND_MODEL, 'Wafer')).toEqual({
    prices: PRICE_PER_M_BY_PROVIDER.Wafer,
    source: 'provider',
  })
  expect(pricesFor(MIND_MODEL, 'Baidu')).toEqual({
    prices: PRICE_PER_M_BY_PROVIDER.Baidu,
    source: 'provider',
  })
  // Two back ends for one model at prices that differ 3x. A model-keyed table cannot say this.
  expect(PRICE_PER_M_BY_PROVIDER.AtlasCloud!.input).toBeGreaterThan(
    PRICE_PER_M_BY_PROVIDER.Inceptron!.input * 3,
  )
})

it('an unpriced or unattributed route books at the ceiling, never at the pinned rate', () => {
  expect(pricesFor(MIND_MODEL, 'SomeNewProvider').source).toBe('ceiling')
  expect(pricesFor(MIND_MODEL, null).source).toBe('ceiling')
  expect(pricesFor(MIND_MODEL, undefined).source).toBe('ceiling')
  expect(pricesFor('deepseek/deepseek-chat', 'Wafer').source).toBe('ceiling')
  expect(pricesFor(MIND_MODEL, 'SomeNewProvider').prices).toEqual(CEILING_PRICE_PER_M)
})

// GLM refuses `enabled:false` on every endpoint and answers worse under `effort:'minimal'`, so
// no caller routed to it may name the field at all. DeepSeek's callers keep their pins.
it('★ no caller on the GLM half asks for a reasoning setting — that model refuses all of them', () => {
  for (const caller of ['turn', 'reflection', 'reflection.edit', 'dream', 'preflight'])
    expect(callSettingsFor(caller).reasoning, caller).toBeUndefined()
  for (const caller of ['semantic', 'constructs'])
    expect(callSettingsFor(caller).reasoning, caller).toEqual({ enabled: false })
  // The court is off that half of the fleet and its model takes the dial.
  for (const caller of RULING_CALLERS)
    expect(callSettingsFor(caller).reasoning, caller).toEqual({ effort: 'low' })
  // Narrator prose is what its thinking buys, and 5.5% of the bill is what it costs.
  expect(callSettingsFor('narrator').reasoning).toBeUndefined()
})

// GLM only earns its premium where a mind must NAME what it acts on. Text-only callers cannot
// emit a blank act, so they keep the model that wrote the best prose of the three.
it('★ the fleet: which model and which back end answers for each caller', () => {
  const fleet: Record<string, [string, string[]]> = {
    turn: [MIND_MODEL, PROVIDER_ORDER],
    reflection: [MIND_MODEL, PROVIDER_ORDER],
    'reflection.edit': [MIND_MODEL, PROVIDER_ORDER],
    dream: [MIND_MODEL, PROVIDER_ORDER],
    preflight: [MIND_MODEL, PROVIDER_ORDER],
    // The court writes permanent law, so it is the one place the fleet buys a stronger model.
    arbiter: [RULING_MODEL, RULING_PROVIDER_ORDER],
    council: [RULING_MODEL, RULING_PROVIDER_ORDER],
    'law.compile': [RULING_MODEL, RULING_PROVIDER_ORDER],
    narrator: [PROSE_MODEL, PROSE_PROVIDER_ORDER],
    naming: [PROSE_MODEL, PROSE_PROVIDER_ORDER],
    // The voice-comparison script must render the voice that ships, not the mind's model.
    voice: [PROSE_MODEL, PROSE_PROVIDER_ORDER],
    semantic: [PROSE_MODEL, PROSE_PROVIDER_ORDER],
    constructs: [PROSE_MODEL, PROSE_PROVIDER_ORDER],
    // No act and no schema, so the act-null ban frees it for the cheaper back end.
    'reflection.gist': [PROSE_MODEL, GIST_PROVIDER_ORDER],
  }
  for (const [caller, [model, order]] of Object.entries(fleet)) {
    expect(modelFor(caller), caller).toBe(model)
    expect(callSettingsFor(caller).providerOrder, caller).toEqual(order)
  }
})

// The act bar gates exactly one model on exactly one back end. Pre-flight measured anywhere else
// would pass a pair the turn never runs on, and the gate would be blind.
it("★ pre-flight runs the turn's own model on the turn's own back end", () => {
  expect(modelFor('preflight')).toBe(modelFor('turn'))
  expect(callSettingsFor('preflight').providerOrder).toEqual(callSettingsFor('turn').providerOrder)
})

// Wafer's tail is prefill, not decode: 14.7 s p95 and 41.0 s max on 300-token answers. A bound
// derived from the 1,500-token ceiling alone is 34.1 s — under the max, so the floor still rules.
it('★ a GLM caller is bounded by its provider tail, not only by its output ceiling', () => {
  expect(requestTimeoutMsFor('turn')).toBe(45_000)
  expect(requestTimeoutMsFor('reflection')).toBe(45_000)
  expect(requestTimeoutMsFor('constructs')).toBe(MIN_REQUEST_TIMEOUT_MS)
  // Above the floor the ceiling still rules: 2,500 tokens at 44 tok/s.
  expect(requestTimeoutMsFor('dream')).toBe(Math.ceil((2500 / 44) * 1000))
  expect(requestTimeoutMsFor('narrator')).toBe(Math.ceil((22000 / 44) * 1000))
})

// The turn is the one caller that samples freely: temperature 1 is what the bake-off measured
// its voice and its 100% named-object act rate at.
it('★ the turn samples at temperature 1, and no other caller pins one', () => {
  expect(callSettingsFor('turn').temperature).toBe(1)
  for (const caller of ['reflection', 'narrator', 'arbiter', 'preflight', 'semantic'])
    expect(callSettingsFor(caller).temperature, caller).toBeUndefined()
})

// Two models on two back ends bill side by side in one ledger, and neither may book at the
// ceiling: an over-report is as wrong as an under-report once the fleet is mixed.
it('★ both fleet models price by who served them, in the same ledger', () => {
  expect(pricesFor(MIND_MODEL, 'Wafer')).toEqual({
    prices: { input: 0.15, output: 0.5, cacheRead: 0.03 },
    source: 'provider',
  })
  expect(pricesFor(PROSE_MODEL, 'Inceptron')).toEqual({
    prices: { input: 0.13, output: 0.28, cacheRead: 0.03 },
    source: 'provider',
  })
  expect(pricesFor(PROSE_MODEL, null).source).toBe('ceiling')
})

// An uncapped call once spent 31,544 output tokens on one dead answer. Each ceiling clears 2x
// that caller's measured p99, so it stops a runaway and never truncates an honest answer.
it('every measured caller has an output ceiling above 2x its p99', () => {
  const p99 = {
    // GLM's own measured turn p99, the mandatory reasoning preamble included.
    turn: 287,
    reflection: 337,
    'reflection.edit': 6120,
    narrator: 10563,
    preflight: 1175,
    dream: 1035,
    constructs: 20,
  }
  for (const [caller, measured] of Object.entries(p99)) {
    expect(callSettingsFor(caller).maxOutputTokens, caller).toBeGreaterThanOrEqual(measured * 2)
  }
})

// 2x the p99 no longer bounds the turn: under the closed grammar a plan step carries all
// thirteen keys, so the schema's own maximum is what the ceiling has to clear, not the average.
it('★ the turn ceiling clears a full twelve-step plan in the closed grammar', () => {
  const step = JSON.stringify({
    verb: 'stow',
    params: Object.fromEntries(CLOSED_KEYS.map((k) => [k, k === 'x' || k === 'y' ? 62 : null])),
  })
  // Measured live against the pinned model 2026-09-02: a rendered turn ran 3.3 chars per token,
  // and everything outside the plan — thought, speech, journal, recall, act, scalars — 721 chars.
  const worstTokens = Math.ceil((step.length * PLAN_MAX_STEPS + 721) / 3.3)
  expect(worstTokens).toBeGreaterThan(900)
  expect(callSettingsFor('turn').maxOutputTokens).toBeGreaterThanOrEqual(
    Math.ceil(worstTokens * 1.3),
  )
})

// A ruling is permanent, so the court buys the model that reads one best rather than the
// cheapest. Bake-off 2026-09-02 over 12 of world two's own rulings, 3 calls each, hand-labelled:
// this model agreed 32/36 where GLM took 25/33 and DeepSeek v4-pro 26/36, at a quarter of GLM's
// latency and 6x under DeepSeek's price.
it('★ the three callers that write something permanent share one pin', () => {
  const court = callSettingsFor('arbiter')
  expect(court).toEqual({
    model: RULING_MODEL,
    providerOrder: RULING_PROVIDER_ORDER,
    reasoning: { effort: 'low' },
    maxOutputTokens: 4000,
  })
  for (const caller of RULING_CALLERS) {
    expect(callSettingsFor(caller), caller).toEqual(court)
    expect(modelFor(caller), caller).toBe(RULING_MODEL)
  }
  expect([...RULING_CALLERS]).toEqual(['arbiter', 'council', 'law.compile'])
})

// The turn and the scene are 99% of the calls and stay where the fleet's own bake-off put them:
// a strong pin on either would multiply the bill by the whole fleet, for no permanent record.
it('★ the strong pin reaches the permanent record and nothing else', () => {
  for (const caller of ['turn', 'scene']) {
    expect(modelFor(caller), caller).toBe(MIND_MODEL)
    expect(callSettingsFor(caller).providerOrder ?? PROVIDER_ORDER, caller).toEqual(PROVIDER_ORDER)
  }
})

// Its own row, keyed by the model: this one is not two-homed, and pricing it by the back end
// would book it at whatever the fleet's GLM costs there.
it('★ the ruling model prices at its own rate, never the fleet"s', () => {
  expect(pricesFor(RULING_MODEL, 'OpenAI')).toEqual({
    prices: { input: 0.2, output: 1.2, cacheRead: 0.02 },
    source: 'model',
  })
  expect(pricesFor(RULING_MODEL, null).source).toBe('model')
  expect(CEILING_PRICE_PER_M.output).toBeGreaterThanOrEqual(1.2)
})

// The night's one reasoning-on call has its own ceiling and its own ledger line. 13,000 was
// already sized around a larger preamble than this model writes, so only reflection moves.
it('★ reflection.edit is its own caller, with its own ceiling', () => {
  expect(callSettingsFor('reflection.edit').maxOutputTokens).toBe(13000)
  expect(callSettingsFor('reflection').maxOutputTokens).toBe(1750)
})

// 14,072 output tokens, 99.5% of it reasoning, to pick one label out of five. With reasoning off
// the same probe answered in 20 tokens on all five calls and recognized the same construct.
it('★ constructs answers without thinking, under a 500-token ceiling', () => {
  expect(callSettingsFor('constructs')).toEqual({
    model: PROSE_MODEL,
    providerOrder: PROSE_PROVIDER_ORDER,
    reasoning: { enabled: false },
    maxOutputTokens: 500,
  })
})

// Its p99 is one call, and that call failed after 31,179 reasoning tokens. 4,000 stands until
// rehearsal 4 gives it a real n.
it('semantic is left where it was', () => {
  expect(callSettingsFor('semantic').maxOutputTokens).toBe(4000)
})

// ★ r3: 21 of 46 reflection attempts were Wafer 429s, and every one had a mind call ANSWER within
// 5 s of it. Only the chain that must land six in a row to write its gists waits a burst out;
// `dream` is one chance-gated call whose whole product is a mood, and a gist is not on Wafer.
it('only the night chain that compounds waits a burst out', () => {
  expect(callSettingsFor('reflection').rateLimitRetries).toBe(3)
  expect(callSettingsFor('reflection.edit').rateLimitRetries).toBe(3)
  for (const caller of ['turn', 'preflight', 'arbiter', 'narrator', 'dream', 'reflection.gist'])
    expect(callSettingsFor(caller).rateLimitRetries, caller).toBeUndefined()
})

it('an unpinned caller keeps the routing it has always had', () => {
  expect(callSettingsFor('nobody-pinned-this')).toEqual({})
  expect(modelFor('nobody-pinned-this')).toBe(MIND_MODEL)
})

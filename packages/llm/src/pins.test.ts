import { expect, it, vi } from 'vitest'
import { CLOSED_KEYS, PLAN_MAX_STEPS } from '@sj/shared'
import {
  CEILING_PRICE_PER_M,
  FALLBACK_MODELS,
  GIST_PROVIDER_ORDER,
  MIND_MODEL,
  MIN_REQUEST_TIMEOUT_MS,
  PRICE_PER_M,
  PRICE_PER_M_BY_ROUTE,
  PROSE_MODEL,
  PROSE_PROVIDER_ORDER,
  PROVIDER_ORDER,
  RAIL_FLOOR_USD,
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
  expect(GIST_PROVIDER_ORDER).toEqual(['DeepInfra', 'Baidu', 'Morph', 'Inceptron'])
  // Dropped from the MIND path, kept in the price table: old ledger rows still reconcile.
  expect(PRICE_PER_M_BY_ROUTE[`${MIND_MODEL}@Baidu`]).toBeDefined()
  // The one exception to the dated-pin law: OpenRouter publishes no dated snapshot of
  // glm-5.3-flash, only the bare id and a `:batch` variant, so there is no date to pin to.
  for (const id of FALLBACK_MODELS) expect(id, id).toMatch(/-\d{4}$/)
  expect(PRICE_PER_M).toEqual({ input: 0.1, output: 0.35, cacheRead: 0.02 })
})

// Priced ON THE MODEL IT SERVES: adding a name to an order without a row for that model is how
// a prose call comes to be booked at the mind model's rate, or at the ceiling.
it('every allowed provider is priced on the model it serves, and the first is PRICE_PER_M', () => {
  for (const name of PROVIDER_ORDER)
    expect(PRICE_PER_M_BY_ROUTE[`${MIND_MODEL}@${name}`], `${MIND_MODEL}@${name}`).toBeDefined()
  for (const name of [...PROSE_PROVIDER_ORDER, ...GIST_PROVIDER_ORDER])
    expect(PRICE_PER_M_BY_ROUTE[`${PROSE_MODEL}@${name}`], `${PROSE_MODEL}@${name}`).toBeDefined()
  expect(PRICE_PER_M_BY_ROUTE[`${MIND_MODEL}@${PROVIDER_ORDER[0]!}`]).toEqual(PRICE_PER_M)
})

it('the ceiling is at least as expensive as every priced provider', () => {
  for (const [name, p] of Object.entries(PRICE_PER_M_BY_ROUTE)) {
    expect(CEILING_PRICE_PER_M.input, name).toBeGreaterThanOrEqual(p.input)
    expect(CEILING_PRICE_PER_M.output, name).toBeGreaterThanOrEqual(p.output)
    expect(CEILING_PRICE_PER_M.cacheRead, name).toBeGreaterThanOrEqual(p.cacheRead)
  }
})

it('prices the pinned model by who served it', () => {
  expect(pricesFor(MIND_MODEL, 'Wafer')).toEqual({
    prices: PRICE_PER_M_BY_ROUTE[`${MIND_MODEL}@Wafer`],
    source: 'provider',
  })
  expect(pricesFor(MIND_MODEL, 'Baidu')).toEqual({
    prices: PRICE_PER_M_BY_ROUTE[`${MIND_MODEL}@Baidu`],
    source: 'provider',
  })
  // Two back ends for one model at prices that differ 3x. A model-keyed table cannot say this.
  expect(PRICE_PER_M_BY_ROUTE[`${PROSE_MODEL}@AtlasCloud`]!.input).toBeGreaterThan(
    PRICE_PER_M_BY_ROUTE[`${PROSE_MODEL}@Inceptron`]!.input * 3,
  )
})

// ★ And the other half, which the provider-keyed table could not say either: ONE back end on
// TWO models. DeepInfra charges 0.075/0.25 for a mind's turn and 0.080/0.180 for prose, so
// every prose call it served was booked at the mind model's rate — output over, input under.
it('★ prices one back end differently on each fleet model', () => {
  const mind = pricesFor(MIND_MODEL, 'DeepInfra')
  const prose = pricesFor(PROSE_MODEL, 'DeepInfra')
  expect(mind.source).toBe('provider')
  expect(prose.source).toBe('provider')
  expect(mind.prices).toEqual({ input: 0.075, output: 0.25, cacheRead: 0.016 })
  expect(prose.prices).toEqual({ input: 0.08, output: 0.18, cacheRead: 0.016 })
  expect(mind.prices, 'a name alone cannot price a call').not.toEqual(prose.prices)
  // A back end priced on one model says nothing about it on the other: the ceiling answers.
  expect(pricesFor(MIND_MODEL, 'Morph').source).toBe('ceiling')
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
  for (const caller of ['semantic', 'constructs', 'scene.close'])
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
    // Two sentences and a short list of ties: prose, so it takes the prose pin.
    'scene.close': [PROSE_MODEL, PROSE_PROVIDER_ORDER],
    // No act and no schema, so the act-null ban frees it for the cheaper back end.
    'reflection.gist': [PROSE_MODEL, GIST_PROVIDER_ORDER],
  }
  for (const [caller, [model, order]] of Object.entries(fleet)) {
    expect(modelFor(caller), caller).toBe(model)
    expect(callSettingsFor(caller).providerOrder, caller).toEqual(order)
  }

  // `allow_fallbacks:false` walks `order` and stops at its end, so a list of one name has
  // nowhere to fall. Inceptron alone refused 67% of scene closes and the town lost its ties.
  const DEPTH_EXEMPT = new Set(['arbiter', 'council', 'law.compile', 'preflight'])
  for (const [caller, [, order]] of Object.entries(fleet)) {
    if (DEPTH_EXEMPT.has(caller)) continue
    expect(order.length, `${caller} has no second provider to fall to`).toBeGreaterThan(1)
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
  expect(requestTimeoutMsFor('turn')).toBe(70_000)
  expect(requestTimeoutMsFor('reflection')).toBe(70_000)
  expect(requestTimeoutMsFor('constructs')).toBe(MIN_REQUEST_TIMEOUT_MS)
  // A dream's 2,500 tokens need 56.8 s, which the route's own tail now covers.
  expect(requestTimeoutMsFor('dream')).toBe(70_000)
  // Above the floor the ceiling still rules: 13,000 tokens at 44 tok/s.
  expect(requestTimeoutMsFor('reflection.edit')).toBe(Math.ceil((13000 / 44) * 1000))
  expect(requestTimeoutMsFor('narrator')).toBe(Math.ceil((22000 / 44) * 1000))
})

// The two callers that speak in a persona's own voice sample freely: temperature 1 is what the
// bake-off measured that voice and its 100% named-object act rate at. Nothing else pins one.
it('★ the turn and the scene sample at temperature 1, and no other caller pins one', () => {
  expect(callSettingsFor('turn').temperature).toBe(1)
  expect(callSettingsFor('scene').temperature).toBe(1)
  for (const caller of ['reflection', 'narrator', 'arbiter', 'preflight', 'semantic'])
    expect(callSettingsFor(caller).temperature, caller).toBeUndefined()
})

// A scene line the coordinator has already given up on is a billed answer nobody reads. Its
// bound is under `FLOOR_TIMEOUT_MS` (45 s in @sj/agents), so the call dies before the floor does.
it('★ a scene line is bounded under the floor that will take it away', () => {
  expect(requestTimeoutMsFor('scene')).toBeLessThan(45_000)
  expect(callSettingsFor('scene').maxOutputTokens).toBe(300)
})

// Two models on two back ends bill side by side in one ledger, and neither may book at the
// ceiling: an over-report is as wrong as an under-report once the fleet is mixed.
it('★ both fleet models price by who served them, in the same ledger', () => {
  expect(pricesFor(MIND_MODEL, 'Wafer')).toEqual({
    prices: { input: 0.1, output: 0.35, cacheRead: 0.02 },
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
    // 114 live scene lines, 2026-09-02: p50 80, p95 116, max 148.
    scene: 135,
    'scene.close': 193,
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
  expect(court).toMatchObject({
    model: RULING_MODEL,
    providerOrder: RULING_PROVIDER_ORDER,
    reasoning: { effort: 'low' },
    maxOutputTokens: 4000,
  })
  // The rails differ by what each of the three was measured spending; the route does not.
  for (const caller of RULING_CALLERS) {
    const { dailyUsd: _rail, ...route } = callSettingsFor(caller)
    const { dailyUsd: _courtRail, ...courtRoute } = court
    expect(route, caller).toEqual(courtRoute)
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

// ★ A by-model row for a fleet model can never be read: `pricesFor` gates that table on the
// model NOT being pinned, so such a row reads as a fallback price that never fires.
it('★ prices a fleet model an unnamed back end served at the ceiling, never off a model row', () => {
  for (const model of [MIND_MODEL, PROSE_MODEL]) {
    expect(pricesFor(model, 'Nobody'), model).toEqual({
      prices: CEILING_PRICE_PER_M,
      source: 'ceiling',
    })
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
    dailyUsd: RAIL_FLOOR_USD,
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

it('★ SJ_FLEET=luna puts every caller on the ruling model, reasoning at xhigh', async () => {
  vi.stubEnv('SJ_FLEET', 'luna')
  vi.resetModules()
  try {
    const luna = await import('./pins.js')
    for (const caller of ['turn', 'scene', 'reflection', 'narrator', 'nobody']) {
      expect(luna.modelFor(caller)).toBe(RULING_MODEL)
      expect(luna.callSettingsFor(caller).providerOrder).toEqual(RULING_PROVIDER_ORDER)
      expect(luna.callSettingsFor(caller).reasoning).toEqual({ effort: 'xhigh' })
    }
    for (const caller of ['reflection.gist', 'scene.close', 'semantic']) {
      expect(luna.modelFor(caller)).toBe(RULING_MODEL)
      expect(luna.callSettingsFor(caller).reasoning).toEqual({ effort: 'minimal' })
    }
    expect(luna.callSettingsFor('arbiter').reasoning).toEqual({ effort: 'xhigh' })
    expect(luna.callSettingsFor('scene').maxOutputTokens).toBe(300 + 6000)
    expect(luna.callSettingsFor('arbiter').maxOutputTokens).toBe(4000 + 24_000)
    expect(luna.requestTimeoutMsFor('scene')).toBeGreaterThanOrEqual(90_000)
    expect(luna.callSettingsFor('turn').dailyUsd).toBeCloseTo(3.31 * 15)
  } finally {
    vi.unstubAllEnvs()
    vi.resetModules()
  }
})

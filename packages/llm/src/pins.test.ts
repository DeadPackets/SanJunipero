import { expect, it } from 'vitest'
import { CLOSED_KEYS, PLAN_MAX_STEPS } from '@sj/shared'
import {
  CEILING_PRICE_PER_M,
  FALLBACK_MODELS,
  MIND_MODEL,
  MIN_REQUEST_TIMEOUT_MS,
  PER_MIND_CALLERS,
  PINNED_CALLERS,
  PRICE_PER_M,
  PRICE_PER_M_BY_ROUTE,
  PROVIDER_ORDER,
  RAIL_FLOOR_USD,
  RULING_CALLERS,
  callSettingsFor,
  pricesFor,
  requestTimeoutMsFor,
} from './pins.js'

it('pins are concrete', () => {
  expect(MIND_MODEL).toBe('openai/gpt-5.6-luna')
  expect(PROVIDER_ORDER).toEqual(['OpenAI'])
  // The one exception to the dated-pin law: OpenRouter publishes no dated snapshot of this
  // model, only the bare id, so there is no date to pin to.
  for (const id of FALLBACK_MODELS) expect(id, id).toMatch(/-\d{4}$/)
  expect(PRICE_PER_M).toEqual({ input: 0.2, output: 1.2, cacheRead: 0.02 })
})

it('every allowed provider is priced on the model it serves, and the first is PRICE_PER_M', () => {
  for (const name of PROVIDER_ORDER)
    expect(PRICE_PER_M_BY_ROUTE[`${MIND_MODEL}@${name}`], `${MIND_MODEL}@${name}`).toBeDefined()
  expect(PRICE_PER_M_BY_ROUTE[`${MIND_MODEL}@${PROVIDER_ORDER[0]!}`]).toEqual(PRICE_PER_M)
})

it('the ceiling is at least as expensive as every priced provider', () => {
  for (const [name, p] of Object.entries(PRICE_PER_M_BY_ROUTE)) {
    expect(CEILING_PRICE_PER_M.input, name).toBeGreaterThanOrEqual(p.input)
    expect(CEILING_PRICE_PER_M.output, name).toBeGreaterThanOrEqual(p.output)
    expect(CEILING_PRICE_PER_M.cacheRead, name).toBeGreaterThanOrEqual(p.cacheRead)
  }
})

it('prices the fleet by who served it, and an unnamed back end at the ceiling', () => {
  expect(pricesFor(MIND_MODEL, 'OpenAI')).toEqual({ prices: PRICE_PER_M, source: 'provider' })
  // `openai/fast` bills 2x for the same answer, so a call nobody attributed may not book cheap.
  for (const provider of [null, undefined, 'SomeNewProvider']) {
    expect(pricesFor(MIND_MODEL, provider), String(provider)).toEqual({
      prices: CEILING_PRICE_PER_M,
      source: 'ceiling',
    })
  }
  expect(pricesFor('deepseek/deepseek-chat', 'Wafer').source).toBe('ceiling')
})

// ★ The fleet before 2026-09-05 wrote weeks of ledger. Its rows still price by the route that
// served them — one back end on two models charged two prices, so a name alone cannot say it.
it('★ a ledger written before the flip still reconciles by its own routes', () => {
  const glm = pricesFor('z-ai/glm-5.3-flash', 'DeepInfra')
  const deepseek = pricesFor('deepseek/deepseek-v4-flash-0731', 'DeepInfra')
  expect(glm).toEqual({
    prices: { input: 0.075, output: 0.25, cacheRead: 0.016 },
    source: 'provider',
  })
  expect(deepseek).toEqual({
    prices: { input: 0.08, output: 0.18, cacheRead: 0.016 },
    source: 'provider',
  })
  expect(pricesFor('z-ai/glm-5.3-flash', 'Wafer').prices).toEqual({
    input: 0.1,
    output: 0.35,
    cacheRead: 0.02,
  })
  // A back end priced on one model says nothing about it on the other: the ceiling answers.
  expect(pricesFor('z-ai/glm-5.3-flash', 'Morph').source).toBe('ceiling')
})

// One model on one back end for every caller: a mind's turn, its line, its night and the
// court all share one warm prefix and one allow-list, and the mix alert reads that list.
it('★ every pinned caller runs on the one fleet model at its one home', () => {
  expect(PINNED_CALLERS.length).toBeGreaterThan(10)
  for (const caller of PINNED_CALLERS) {
    expect(callSettingsFor(caller).model, caller).toBe(MIND_MODEL)
    expect(callSettingsFor(caller).providerOrder, caller).toEqual(PROVIDER_ORDER)
  }
  for (const caller of PER_MIND_CALLERS) expect(PINNED_CALLERS, caller).toContain(caller)
  expect([...PER_MIND_CALLERS]).toEqual(['turn', 'reflection', 'reflection.edit', 'dream', 'scene'])
})

// r21 spent 58% of its bill on reasoning tokens. A ruling thinks hardest, a turn or a line
// thinks, and a caller that only restates what it is handed does not: a gist reasoned for 2,100
// tokens to write 300 and was a third of the whole bill until it stopped.
it('★ three efforts: rulings judge, turns and lines think, restatements do not', () => {
  for (const caller of RULING_CALLERS)
    expect(callSettingsFor(caller).reasoning, caller).toEqual({ effort: 'xhigh' })
  for (const caller of [
    'turn',
    'scene',
    'reflection',
    'reflection.edit',
    'dream',
    'preflight',
    'narrator',
  ])
    expect(callSettingsFor(caller).reasoning, caller).toEqual({ effort: 'high' })
  for (const caller of [
    'reflection.gist',
    'scene.close',
    'semantic',
    'constructs',
    'naming',
    'voice',
  ])
    expect(callSettingsFor(caller).reasoning, caller).toEqual({ effort: 'minimal' })
  expect([...RULING_CALLERS]).toEqual(['arbiter', 'council', 'law.compile'])
})

// The act bar gates exactly one model on exactly one back end. Pre-flight measured anywhere else
// would pass a pair the turn never runs on, and the gate would be blind.
it("★ pre-flight runs the turn's own model on the turn's own back end", () => {
  expect(callSettingsFor('preflight').model).toBe(callSettingsFor('turn').model)
  expect(callSettingsFor('preflight').providerOrder).toEqual(callSettingsFor('turn').providerOrder)
})

// This model's tail is its own thinking: a bound derived from the answer ceiling alone would
// cut a long thought off and re-bill it, so a floor rules where the ceiling is small.
it('★ a caller is bounded by the route floor or by its own ceiling, whichever is longer', () => {
  expect(requestTimeoutMsFor('turn')).toBe(Math.ceil((7500 / 44) * 1000))
  expect(requestTimeoutMsFor('dream')).toBe(90_000)
  expect(requestTimeoutMsFor('constructs')).toBe(90_000)
  expect(requestTimeoutMsFor('narrator')).toBe(Math.ceil((28_000 / 44) * 1000))
  expect(requestTimeoutMsFor('nobody-pinned-this')).toBe(MIN_REQUEST_TIMEOUT_MS)
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
// bound is under `FLOOR_TIMEOUT_MS` (90 s in @sj/agents), so the call dies before the floor does.
it('★ a scene line is bounded under the floor that will take it away', () => {
  expect(requestTimeoutMsFor('scene')).toBe(60_000)
  expect(requestTimeoutMsFor('scene')).toBeLessThan(90_000)
})

// An uncapped call once spent 31,544 output tokens on one dead answer. Each ceiling clears 2x
// that caller's measured p99, reasoning included, so it stops a runaway and never truncates an
// honest answer. r21 at xhigh everywhere, r22 with the restating callers at minimal.
it('every measured caller has an output ceiling above 2x its p99', () => {
  const p99 = {
    turn: 3486,
    reflection: 6837,
    'reflection.edit': 575,
    narrator: 8923,
    preflight: 685,
    dream: 407,
    'reflection.gist': 628,
    scene: 1127,
    'scene.close': 352,
    semantic: 677,
    arbiter: 9819,
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
  // Measured live 2026-09-02: a rendered turn ran 3.3 chars per token, and everything outside
  // the plan — thought, speech, journal, recall, act, scalars — 721 chars.
  const worstTokens = Math.ceil((step.length * PLAN_MAX_STEPS + 721) / 3.3)
  expect(worstTokens).toBeGreaterThan(900)
  expect(callSettingsFor('turn').maxOutputTokens).toBeGreaterThanOrEqual(
    Math.ceil(worstTokens * 1.3),
  )
})

// A ruling is permanent, so the court thinks hardest and is given the room to: a ruling at max
// spent 9,000 tokens thinking in r21 and overran a 10,000 ceiling twice.
it('★ the three callers that write something permanent share one pin', () => {
  const court = callSettingsFor('arbiter')
  expect(court).toMatchObject({
    model: MIND_MODEL,
    providerOrder: PROVIDER_ORDER,
    reasoning: { effort: 'xhigh' },
    maxOutputTokens: 28_000,
  })
  // The rails differ by what each of the three was measured spending; the route does not.
  for (const caller of RULING_CALLERS) {
    const { dailyUsd: _rail, ...route } = callSettingsFor(caller)
    const { dailyUsd: _courtRail, ...courtRoute } = court
    expect(route, caller).toEqual(courtRoute)
  }
})

// The night's one edit call has its own ceiling and its own ledger line.
it('★ reflection.edit is its own caller, with its own ceiling', () => {
  expect(callSettingsFor('reflection.edit').maxOutputTokens).toBe(13_000)
  expect(callSettingsFor('reflection').maxOutputTokens).toBe(14_000)
})

// 14,072 output tokens, 99.5% of it reasoning, to pick one label out of five. Restating, the
// same probe answered in 20 tokens on all five calls and recognized the same construct.
it('★ constructs answers without thinking, under a small ceiling', () => {
  expect(callSettingsFor('constructs')).toEqual({
    model: MIND_MODEL,
    providerOrder: PROVIDER_ORDER,
    minTimeoutMs: 90_000,
    reasoning: { effort: 'minimal' },
    maxOutputTokens: 1500,
    dailyUsd: RAIL_FLOOR_USD,
  })
})

// ★ r3: 21 of 46 reflection attempts were 429s, and every one had a mind call ANSWER within
// 5 s of it. Only the chain that must land six in a row to write its gists waits a burst out;
// `dream` is one chance-gated call whose whole product is a mood.
it('only the night chain that compounds waits a burst out', () => {
  expect(callSettingsFor('reflection').rateLimitRetries).toBe(3)
  expect(callSettingsFor('reflection.edit').rateLimitRetries).toBe(3)
  for (const caller of ['turn', 'preflight', 'arbiter', 'narrator', 'dream', 'reflection.gist'])
    expect(callSettingsFor(caller).rateLimitRetries, caller).toBeUndefined()
})

it('an unpinned caller keeps the routing it has always had', () => {
  expect(callSettingsFor('nobody-pinned-this')).toEqual({})
})

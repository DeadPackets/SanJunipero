import { expect, it } from 'vitest'
import {
  CEILING_PRICE_PER_M,
  FALLBACK_MODELS,
  MIND_MODEL,
  PRICE_PER_M,
  PRICE_PER_M_BY_PROVIDER,
  PROVIDER_ORDER,
  callSettingsFor,
  pricesFor,
} from './pins.js'

it('pins are concrete', () => {
  expect(MIND_MODEL).toBe('deepseek/deepseek-v4-flash-0731')
  expect(PROVIDER_ORDER.length).toBeGreaterThan(0)
  // Never a floating alias: every model names the dated snapshot it was probed at.
  for (const id of [MIND_MODEL, ...FALLBACK_MODELS]) expect(id, id).toMatch(/-\d{4}$/)
  // Baidu's real charged rate, not its 0.14/0.28/0.028 list rate: the list would over-report
  // every call 3x.
  expect(PRICE_PER_M).toEqual({ input: 0.04494, output: 0.08988, cacheRead: 0.008988 })
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
  // Two back ends for one model at prices that differ 6x. A model-keyed table cannot say this.
  expect(PRICE_PER_M_BY_PROVIDER.Wafer!.input).toBeGreaterThan(
    PRICE_PER_M_BY_PROVIDER.Baidu!.input * 6,
  )
})

it('an unpriced or unattributed route books at the ceiling, never at the pinned rate', () => {
  expect(pricesFor(MIND_MODEL, 'SomeNewProvider').source).toBe('ceiling')
  expect(pricesFor(MIND_MODEL, null).source).toBe('ceiling')
  expect(pricesFor(MIND_MODEL, undefined).source).toBe('ceiling')
  expect(pricesFor('deepseek/deepseek-chat', 'Wafer').source).toBe('ceiling')
  expect(pricesFor(MIND_MODEL, 'SomeNewProvider').prices).toEqual(CEILING_PRICE_PER_M)
})

// The nightly pass once spent 31,179 reasoning tokens over 96 s to answer nothing at all. Only
// `enabled:false` moves this endpoint, so an effort rung here would be a placebo.
it('the semantic pass is pinned off the thinking preamble and under an output ceiling', () => {
  expect(callSettingsFor('semantic').reasoning).toEqual({ enabled: false })
  expect(callSettingsFor('semantic').maxOutputTokens).toBeLessThanOrEqual(4000)
})

// Over 12 matched pairs, reasoning was 94% of a turn's output; holding it off left parse at
// 100% and moved grounding from 75% to 92%.
it('the turn and the night are pinned off the thinking preamble', () => {
  expect(callSettingsFor('turn').reasoning).toEqual({ enabled: false })
  expect(callSettingsFor('reflection').reasoning).toEqual({ enabled: false })
  // Narrator prose is what its thinking buys, and 5.5% of the bill is what it costs.
  expect(callSettingsFor('narrator').reasoning).toBeUndefined()
})

// An uncapped call once spent 31,544 output tokens on one dead answer. Each ceiling clears 2x
// that caller's p99 in rehearsal 3, so it stops a runaway and never truncates an honest answer.
it('every caller that ran in rehearsal 3 has an output ceiling above its measured p99', () => {
  // The three callers at zero ran two or three times all run, so their p99 is only their max.
  const p99 = {
    turn: 266,
    reflection: 7846,
    arbiter: 3942,
    narrator: 10616,
    preflight: 0,
    dream: 0,
    semantic: 0,
  }
  for (const [caller, measured] of Object.entries(p99)) {
    expect(callSettingsFor(caller).maxOutputTokens, caller).toBeGreaterThanOrEqual(measured * 2)
  }
})

it('an unpinned caller keeps the routing it has always had', () => {
  expect(callSettingsFor('naming')).toEqual({})
})

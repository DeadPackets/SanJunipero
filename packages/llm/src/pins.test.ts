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
  // Design §1: never a floating alias. Every model this run may be served by names the dated
  // snapshot it was probed at, so nothing can swap under the town.
  for (const id of [MIND_MODEL, ...FALLBACK_MODELS]) expect(id, id).toMatch(/-\d{4}$/)
  // Wafer's real published price. The old pin here was 0.14/0.28/0.028 — that is BAIDU's price,
  // and booking Wafer's calls at it halved every cost the project ever reported.
  expect(PRICE_PER_M).toEqual({ input: 0.28, output: 0.56, cacheRead: 0.07 })
})

it('the pinned provider is priced, and is what PRICE_PER_M reports', () => {
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
  // Two back ends for one model at prices that differ 2x. A model-keyed table cannot say this.
  expect(PRICE_PER_M_BY_PROVIDER.Wafer!.input).toBe(PRICE_PER_M_BY_PROVIDER.Baidu!.input * 2)
})

// The failure mode the whole lane exists to close: a route nobody priced must not book cheap.
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

it('an unpinned caller keeps the routing it has always had', () => {
  expect(callSettingsFor('turn')).toEqual({})
})

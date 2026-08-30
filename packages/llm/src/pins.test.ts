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
  // Ruling 23: Baidu first, AtlasCloud second — 34/36 valid acts and no rate limit in 72 calls.
  expect(PROVIDER_ORDER).toEqual(['Baidu', 'AtlasCloud'])
  // Design §1: never a floating alias. Every model this run may be served by names the dated
  // snapshot it was probed at, so nothing can swap under the town.
  for (const id of [MIND_MODEL, ...FALLBACK_MODELS]) expect(id, id).toMatch(/-\d{4}$/)
  // Baidu's real charged price, reconciled against its bill in `llm-audit/raw/e5.json`. Its
  // LIST price is 0.14/0.28/0.028; booking the pin at that would over-report every call 3x.
  expect(PRICE_PER_M).toEqual({ input: 0.04494, output: 0.08988, cacheRead: 0.008988 })
})

it('every allowed provider is priced, and the first is what PRICE_PER_M reports', () => {
  // An unpriced name on the allow-list books at the ceiling, which over-reports every call it serves.
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

// E6, 12 matched pairs: reasoning was 94% of a turn's output and holding it off left parse at
// 100% and moved grounding from 75% to 92%. The night keeps it only for `proposeEdit`.
it('the turn and the night are pinned off the thinking preamble', () => {
  expect(callSettingsFor('turn').reasoning).toEqual({ enabled: false })
  expect(callSettingsFor('reflection').reasoning).toEqual({ enabled: false })
  // Narrator prose is what its thinking buys, and 5.5% of the bill is what it costs.
  expect(callSettingsFor('narrator').reasoning).toBeUndefined()
})

// An uncapped call once spent 31,544 output tokens on one dead answer. Each ceiling clears 2x
// that caller's measured p99, so it stops a runaway and never truncates an honest answer. Ruling
// 23's numbers, from `llm-audit/providers.md`: the answer alone where reasoning is off.
it('every measured caller has an output ceiling above 2x its p99', () => {
  const p99 = {
    turn: 243,
    reflection: 337,
    'reflection.edit': 6120,
    arbiter: 3904,
    narrator: 10563,
    preflight: 1175,
    dream: 1035,
    constructs: 20,
  }
  for (const [caller, measured] of Object.entries(p99)) {
    expect(callSettingsFor(caller).maxOutputTokens, caller).toBeGreaterThanOrEqual(measured * 2)
  }
})

// The night's one reasoning-on call shared reflection's 16,000 and its ledger line. Ruling 23
// gives it both of its own, so rehearsal 4 can price it.
it('★ reflection.edit is its own caller: reasoning on, its own ceiling', () => {
  expect(callSettingsFor('reflection.edit').reasoning).toBeUndefined()
  expect(callSettingsFor('reflection.edit').maxOutputTokens).toBe(13000)
  expect(callSettingsFor('reflection').maxOutputTokens).toBe(700)
})

// 14,072 output tokens, 99.5% of it reasoning, to pick one label out of five. With reasoning off
// the same probe answered in 20 tokens on all five calls and recognized the same construct.
it('★ constructs answers without thinking, under a 500-token ceiling', () => {
  expect(callSettingsFor('constructs')).toEqual({
    reasoning: { enabled: false },
    maxOutputTokens: 500,
  })
})

// Its p99 is one call, and that call failed after 31,179 reasoning tokens. 4,000 stands until
// rehearsal 4 gives it a real n.
it('semantic is left where it was', () => {
  expect(callSettingsFor('semantic').maxOutputTokens).toBe(4000)
})

it('an unpinned caller keeps the routing it has always had', () => {
  expect(callSettingsFor('naming')).toEqual({})
})

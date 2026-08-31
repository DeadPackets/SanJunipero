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
  expect(MIND_MODEL).toBe('z-ai/glm-5.3-flash')
  expect(PROVIDER_ORDER).toEqual(['Wafer'])
  // Dropped from the call path, kept in the price table: old ledger rows still reconcile against it.
  expect(PRICE_PER_M_BY_PROVIDER.Baidu).toBeDefined()
  // TEST BRANCH exception to the dated-pin law: OpenRouter publishes no dated snapshot of
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

// TEST BRANCH: `enabled:false` is refused by every endpoint of this model and `effort:'minimal'`
// measured worse than sending nothing, so no caller may name the field at all.
it('★ no caller asks for a reasoning setting, because this model refuses every one of them', () => {
  const callers = [
    'turn',
    'reflection',
    'reflection.edit',
    'arbiter',
    'narrator',
    'preflight',
    'dream',
    'semantic',
    'constructs',
  ]
  for (const caller of callers) expect(callSettingsFor(caller).reasoning, caller).toBeUndefined()
})

// The owner's order for the rehearsal: the turn is the one caller that samples freely.
it('★ the turn samples at temperature 1, and no other caller pins one', () => {
  expect(callSettingsFor('turn').temperature).toBe(1)
  for (const caller of ['reflection', 'narrator', 'arbiter', 'preflight'])
    expect(callSettingsFor(caller).temperature, caller).toBeUndefined()
})

// An uncapped call once spent 31,544 output tokens on one dead answer. Each ceiling clears 2x
// that caller's measured p99, so it stops a runaway and never truncates an honest answer.
it('every measured caller has an output ceiling above 2x its p99', () => {
  const p99 = {
    turn: 243,
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

// Reasoning cannot be switched off here and bills inside `max_tokens`, so 2,000 became 4,000.
it('★ the arbiter judges under a 4,000-token ceiling that its own reasoning bills inside', () => {
  expect(callSettingsFor('arbiter')).toEqual({ maxOutputTokens: 4000 })
})

// The night's one reasoning-on call has its own ceiling and its own ledger line.
it('★ reflection.edit is its own caller, with its own ceiling', () => {
  expect(callSettingsFor('reflection.edit').maxOutputTokens).toBe(15000)
  expect(callSettingsFor('reflection').maxOutputTokens).toBe(3000)
})

// The answer is 20 tokens; the rest of the ceiling is the preamble this model always writes.
it('★ constructs picks one label out of five, under a 1,500-token ceiling', () => {
  expect(callSettingsFor('constructs')).toEqual({ maxOutputTokens: 1500 })
})

// Its p99 is one call, and that call failed after 31,179 reasoning tokens.
it('semantic carries its reasoning inside its ceiling', () => {
  expect(callSettingsFor('semantic').maxOutputTokens).toBe(5000)
})

it('an unpinned caller keeps the routing it has always had', () => {
  expect(callSettingsFor('naming')).toEqual({})
})

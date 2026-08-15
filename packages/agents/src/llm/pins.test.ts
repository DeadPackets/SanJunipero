import { expect, it } from 'vitest'
import { MIND_MODEL, PROVIDER_ORDER, FALLBACK_MODELS, PRICE_PER_M } from './pins.js'

it('pins are concrete', () => {
  expect(MIND_MODEL).toBe('deepseek/deepseek-v4-flash-0731')
  expect(PROVIDER_ORDER.length).toBeGreaterThan(0)
  expect(FALLBACK_MODELS.length).toBeGreaterThan(0)
  expect(PRICE_PER_M).toEqual({ input: 0.14, output: 0.28, cacheRead: 0.028 })
})

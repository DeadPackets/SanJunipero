import { expect, it } from 'vitest'
import type { PublicUsage } from '@sj/shared'
import { usageLabel, usageMoney, usageTokens } from './usageModel.js'

const total = { calls: 1, usd: 0.004, inputTokens: 100, outputTokens: 50, cachedInputTokens: 80 }
const live: PublicUsage = { mode: 'live', updatedAt: 1, total, last24h: total }
it('shows small nonzero charges and compact token totals without double counting cache', () => {
  expect(usageMoney(0)).toBe('$0.00')
  expect(usageMoney(0.004)).toBe('<$0.01')
  expect(usageTokens(12500)).toBe('12.5k')
  expect(usageLabel(live)).toBe('<$0.01 · 150 tokens')
})
it('never presents a failed or absent read as zero spending', () => {
  expect(usageLabel(null)).toBe('Usage unavailable')
  expect(usageLabel(live, true)).toBe('Usage unavailable')
  expect(usageLabel({ mode: 'unavailable', updatedAt: 1, total: null, last24h: null })).toBe(
    'Usage unavailable',
  )
})

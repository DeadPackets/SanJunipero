import type { PublicUsage } from '@sj/shared'

export function usageMoney(usd: number): string {
  if (usd > 0 && usd < 0.01) return '<$0.01'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(usd)
}

export function usageTokens(tokens: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
    .format(tokens)
    .toLowerCase()
}

export function usageLabel(usage: PublicUsage | null, failed = false): string {
  if (failed || !usage || usage.mode === 'unavailable') return 'Usage unavailable'
  const status =
    usage.mindStatus === 'budget-stopped'
      ? 'AI paused · '
      : usage.mindStatus === 'delayed'
        ? 'AI delayed · '
        : ''
  return `${status}${usageMoney(usage.total.usd)} · ${usageTokens(usage.total.inputTokens + usage.total.outputTokens)} tokens`
}

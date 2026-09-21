import { z } from 'zod'

const UsageTotalsSchema = z
  .object({
    calls: z.number().int().nonnegative(),
    usd: z.number().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative(),
  })
  .strict()

export const PublicUsageSchema = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('unavailable'),
      updatedAt: z.number().int().nonnegative(),
      total: z.null(),
      last24h: z.null(),
    })
    .strict(),
  z
    .object({
      mode: z.enum(['live', 'scripted']),
      updatedAt: z.number().int().nonnegative(),
      total: UsageTotalsSchema,
      last24h: UsageTotalsSchema,
    })
    .strict(),
])
export type PublicUsage = z.infer<typeof PublicUsageSchema>

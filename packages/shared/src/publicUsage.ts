import { z } from 'zod'

export const MindStatusSchema = z.enum(['active', 'delayed', 'budget-stopped', 'disabled'])
export type MindStatus = z.infer<typeof MindStatusSchema>

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
      mindStatus: MindStatusSchema,
      updatedAt: z.number().int().nonnegative(),
      total: z.null(),
      last24h: z.null(),
    })
    .strict(),
  z
    .object({
      mode: z.enum(['live', 'scripted']),
      mindStatus: MindStatusSchema,
      updatedAt: z.number().int().nonnegative(),
      total: UsageTotalsSchema,
      last24h: UsageTotalsSchema,
    })
    .strict(),
])
export type PublicUsage = z.infer<typeof PublicUsageSchema>

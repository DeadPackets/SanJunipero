import { z } from 'zod'

export const EventEnvelope = z.object({
  seq: z.number().int().nonnegative(),
  tick: z.number().int().nonnegative(),
  type: z.string().min(1),
  payload: z.unknown(),
})
export type SimEvent = z.infer<typeof EventEnvelope>

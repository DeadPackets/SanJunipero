import { z } from 'zod'

export const EventEnvelope = z.object({
  seq: z.number().int().nonnegative(),
  tick: z.number().int().nonnegative(),
  type: z.string().min(1),
  payload: z.unknown(),
})
export type SimEvent = z.infer<typeof EventEnvelope>

export const GENESIS_BUILDER_ID = 'genesis'

export function isSeededStructureEvent(event: Pick<SimEvent, 'type' | 'payload'>): boolean {
  const payload = event.payload as Record<string, unknown> | null
  if (payload === null || typeof payload !== 'object') return false
  if (event.type === 'structure_planned') return payload.builderId === GENESIS_BUILDER_ID
  return event.type === 'structure_completed' && payload.seeded === true
}

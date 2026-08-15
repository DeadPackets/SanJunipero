import { z } from 'zod'
import { MINUTES_PER_DAY } from '@sj/shared'

export const IntentSchema = z.object({ verb: z.string().min(1), params: z.record(z.string(), z.unknown()).default({}) }).strict()
export const TurnSchema = z.object({
  thought: z.string().min(1),                                    // required; never enters world state
  speech: z.string().min(1).optional(),                          // heard by earshot physics
  action: z.union([IntentSchema, z.object({ freeform: z.string().min(1) }).strict()]).optional(),
  plan: z.array(IntentSchema).max(12).optional(),                // engine executes between turns
  journal: z.string().min(1).optional(),                         // deliberate act, costs sim time
  importance: z.number().int().min(1).max(10),                   // self-rating for memory
  reconsider_at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),  // sim-clock "HH:MM"
}).strict()
export type Turn = z.infer<typeof TurnSchema>

export const FALLBACK_TURN: Turn = { thought: 'My mind drifts. I stand quietly, lost in thought.', importance: 1 }

export async function parseTurnWithRepair(
  raw: unknown,
  repair: (issues: string) => Promise<unknown>,
  alert: (detail: string) => void,
): Promise<Turn> {
  const first = TurnSchema.safeParse(raw)
  if (first.success) return first.data
  const repaired = await repair(z.prettifyError(first.error))
  const second = TurnSchema.safeParse(repaired)
  if (second.success) return second.data
  alert(z.prettifyError(second.error))
  return FALLBACK_TURN
}

export function reconsiderTick(nowTick: number, hhmm: string): number {
  const [hh, mm] = hhmm.split(':')
  const minuteOfDay = Number(hh) * 60 + Number(mm)
  const candidate = Math.floor(nowTick / MINUTES_PER_DAY) * MINUTES_PER_DAY + minuteOfDay
  return candidate > nowTick ? candidate : candidate + MINUTES_PER_DAY
}

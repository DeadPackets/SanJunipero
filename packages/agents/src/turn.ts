import { z } from 'zod'
import { MINUTES_PER_DAY } from '@sj/shared'

export const IntentSchema = z.object({
  verb: z.string().min(1).describe('The exact word of the act, such as walk or eat.'),
  params: z.record(z.string(), z.unknown()).default({}).describe('Exactly what the act asks for, named by its keys.'),
}).strict()
export const TurnSchema = z.object({
  thought: z.string().min(1)
    .describe('What passes through your mind this moment. Yours alone; no one else ever hears it.'),
  speech: z.string().min(1).optional()
    .describe('Words you say aloud. Anyone within earshot hears them.'),
  action: z.union([IntentSchema, z.object({ freeform: z.string().min(1).describe('What you attempt, in your own words.') }).strict()]).optional()
    .describe('One act you begin now: its exact word as verb with what it asks as params, or freeform for a try at something new.'),
  plan: z.array(IntentSchema).max(12).optional()
    .describe('Up to twelve acts your body carries out one after another while your mind rests.'),
  journal: z.string().min(1).optional()
    .describe('Words you set down in your own book. Writing takes part of the hour.'),
  importance: z.number().int().min(1).max(10)
    .describe('How deeply this moment matters to you, one through ten.'),
  reconsider_at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional()
    .describe('A clock time such as 08:30 when you mean to return to your thoughts.'),
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

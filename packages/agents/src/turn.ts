import { z } from 'zod'
import { MINUTES_PER_DAY, type DayPhase } from '@sj/shared'

// An hour of the day is a plan for today; a day and a phase is an appointment. Without the
// second shape nothing can be arranged in advance, only remembered or improvised.
export const ReconsiderAtSchema = z.union([
  z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  z.object({ day: z.number().int().positive(), phase: z.enum(['day', 'dusk', 'night']) }).strict(),
])
export type ReconsiderAt = z.infer<typeof ReconsiderAtSchema>

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
  reconsider_at: ReconsiderAtSchema.optional()
    .describe('When you mean to return to your thoughts: a clock time today such as 08:30, or a day and a part of that day such as {"day": 12, "phase": "dusk"}. The parts of a day are day, dusk and night.'),
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

// Where each part of the day begins, as the one clock everybody shares. Read back through
// `dayPhaseFromTick` in the tests, so an anchor can never drift out of its own phase.
const PHASE_START_MINUTE: Readonly<Record<DayPhase, number>> = { day: 7 * 60, dusk: 19 * 60, night: 21 * 60 }

// The single resolution of "when", whichever way it was named (G4). An appointment already
// gone comes round again at the next occurrence of that part of the day, never in the past.
export function reconsiderTick(nowTick: number, at: ReconsiderAt): number {
  if (typeof at === 'string') {
    const [hh, mm] = at.split(':')
    const minuteOfDay = Number(hh) * 60 + Number(mm)
    const candidate = Math.floor(nowTick / MINUTES_PER_DAY) * MINUTES_PER_DAY + minuteOfDay
    return candidate > nowTick ? candidate : candidate + MINUTES_PER_DAY
  }
  const minuteOfDay = PHASE_START_MINUTE[at.phase]
  const named = (at.day - 1) * MINUTES_PER_DAY + minuteOfDay
  if (named > nowTick) return named
  const today = Math.floor(nowTick / MINUTES_PER_DAY) * MINUTES_PER_DAY + minuteOfDay
  return today > nowTick ? today : today + MINUTES_PER_DAY
}

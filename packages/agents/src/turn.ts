import { z } from 'zod'
import { MINUTES_PER_DAY, type DayPhase } from '@sj/shared'
import { IntentParamsSchema } from '@sj/engine/verbs'

// An hour of the day is a plan for today; a day and a phase is an appointment. Without the
// second shape nothing can be arranged in advance, only remembered or improvised.
const ReconsiderAtSchema = z.union([
  z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  z.object({ day: z.number().int().positive(), phase: z.enum(['day', 'dusk', 'night']) }).strict(),
])
export type ReconsiderAt = z.infer<typeof ReconsiderAtSchema>

export const IntentSchema = z
  .object({
    verb: z.string().min(1).describe('The exact word of the act, such as walk or eat.'),
    params: IntentParamsSchema.default({}).describe(
      'Exactly what the act asks for, named by its keys.',
    ),
  })
  .strict()
type Intent = z.infer<typeof IntentSchema>
// Every optional field takes null as well as absence, and not via `.transform()`, which
// `z.toJSONSchema(..., { io: 'output' })` refuses to represent. Readers treat both alike.
export const TurnSchema = z
  .object({
    thought: z
      .string()
      .min(1)
      .describe(
        'What passes through your mind this moment. Yours alone; no one else ever hears it.',
      ),
    speech: z
      .string()
      .min(1)
      .nullish()
      .describe('Words you say aloud. Anyone within earshot hears them.'),
    action: z
      .union([
        IntentSchema,
        z
          .object({ freeform: z.string().min(1).describe('What you attempt, in your own words.') })
          .strict(),
      ])
      .nullish()
      .describe(
        'One act you begin now: its exact word as verb with what it asks as params, or freeform for a try at something new.',
      ),
    plan: z
      .array(IntentSchema)
      .max(12)
      .nullish()
      .describe('Up to twelve acts your body carries out one after another while your mind rests.'),
    journal: z
      .string()
      .min(1)
      .nullish()
      .describe('Words you set down in your own book. Writing takes part of the hour.'),
    recall: z
      .string()
      .min(1)
      .nullish()
      .describe(
        'Something out of your own past to cast your mind back to. Casting back fills the whole moment: you do nothing else with it, and what comes back reaches you a moment later.',
      ),
    importance: z
      .number()
      .int()
      .min(1)
      .max(10)
      .describe('How deeply this moment matters to you, one through ten.'),
    reconsider_at: ReconsiderAtSchema.nullish().describe(
      'When you mean to return to your thoughts: a clock time today such as 08:30, or a day and a part of that day such as {"day": 12, "phase": "dusk"}. The parts of a day are day, dusk and night.',
    ),
  })
  .strict()
export type Turn = z.infer<typeof TurnSchema>

export const FALLBACK_TURN: Turn = {
  thought: 'My mind drifts. I stand quietly, lost in thought.',
  importance: 1,
}

// The acts that ask for nothing of their own. A verb minted at runtime is one too: the arbiter
// only ever hands those over with nothing in them.
const ACTS_ASKING_NOTHING = new Set(['sleep', 'wake', 'exit', 'doff', 'drink', 'forage'])

/** The verb this turn began with nothing named, or null when the act carries its detail. */
export function actWithoutItsDetail(turn: Turn): string | null {
  const action = turn.action
  if (action === null || action === undefined || 'freeform' in action) return null
  if (ACTS_ASKING_NOTHING.has(action.verb) || action.verb.includes(':')) return null
  return Object.values(action.params).every(isBlankAnswer) ? action.verb : null
}

// Nothing came back at all, as against something wrong coming back. The two need different
// answers: a wrong answer is worth correcting, and a blank one is worth only asking again.
export function isBlankAnswer(raw: unknown): boolean {
  if (raw === null || raw === undefined) return true
  if (typeof raw === 'string') return raw.trim().length === 0
  if (typeof raw === 'object') return Object.keys(raw).length === 0
  return false
}

/** Whether the world holds exactly one thing this verb's blank object could have meant. */
export type ActHasOneReading = (verb: string) => boolean

// Acts whose whole object is one mark. The word for that mark is the one the verb reads.
const OBJECT_KEY: Readonly<Record<string, 'itemId' | 'structureId'>> = {
  eat: 'itemId',
  take: 'itemId',
  drop: 'itemId',
  wear: 'itemId',
  read: 'itemId',
  fill: 'itemId',
  kindle: 'itemId',
  snuff: 'itemId',
  enter: 'structureId',
  stoke: 'structureId',
  extinguish: 'structureId',
}
// Words that name a mark. Prose and numbers are left where they are: a sentence read as an id
// would name nothing and would cost the act its one blank-object reading as well.
const MARK_KEYS = Object.keys(IntentParamsSchema.shape).filter((k) => k.endsWith('Id'))

// The right mark under a word the verb does not read (K20). One mark is the object it meant;
// two is a guess. Whether the mark is real is still the world's to say a beat later.
function withObjectNamed(intent: Intent): Intent {
  const want = OBJECT_KEY[intent.verb]
  if (want === undefined) return intent
  const [from, ...also] = MARK_KEYS.filter((k) => !isBlankAnswer(intent.params[k]))
  if (from === undefined || also.length > 0 || from === want) return intent
  const { [from]: mark, ...rest } = intent.params
  return { ...intent, params: { ...rest, [want]: mark } }
}

function withObjectsNamed(turn: Turn): Turn {
  const { action, plan } = turn
  return {
    ...turn,
    action: action && 'verb' in action ? withObjectNamed(action) : action,
    plan: plan ? plan.map(withObjectNamed) : plan,
  }
}

export async function parseTurnWithRepair(
  raw: unknown,
  repair: (issues: string) => Promise<unknown>,
  alert: (kind: string, detail: string) => void,
  hasOneReading?: ActHasOneReading,
): Promise<Turn> {
  const first = TurnSchema.safeParse(raw)
  if (!first.success) {
    const second = TurnSchema.safeParse(await repair(z.prettifyError(first.error)))
    if (second.success) return withObjectsNamed(second.data)
    alert('turn_fallback', z.prettifyError(second.error))
    return FALLBACK_TURN
  }
  const turn = withObjectsNamed(first.data)
  // The same one correction, spent on the other way an answer comes back unusable: the world
  // refuses an act with nothing in it a beat later, with the moment already gone (K20).
  const empty = actWithoutItsDetail(turn)
  if (empty === null) return turn
  // One reading beats one more call: the world fills the act's one candidate in when it takes
  // it, so a mind is not asked again for a word it had no choice about.
  if (hasOneReading?.(empty) === true) {
    alert('act_detail_filled_in', `${empty} has one candidate and was read as that`)
    return turn
  }
  const again = TurnSchema.safeParse(
    await repair(`your last answer left ${empty} empty; name what it asks for, or act otherwise`),
  )
  if (again.success && actWithoutItsDetail(again.data) === null) return withObjectsNamed(again.data)
  alert('empty_act_detail', `${empty} came back empty twice`)
  return turn
}

// Where each part of the day begins, as the one clock everybody shares. Read back through
// `dayPhaseFromTick` in the tests, so an anchor can never drift out of its own phase.
const PHASE_START_MINUTE: Readonly<Record<DayPhase, number>> = {
  dawn: 5 * 60,
  day: 7 * 60,
  dusk: 19 * 60,
  night: 21 * 60,
}

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

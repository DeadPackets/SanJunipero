import { z } from 'zod'
import {
  ClosedIntentParams,
  Intent as ClosedIntentSchema,
  MINUTES_PER_DAY,
  namedParams,
  PLAN_MAX_STEPS,
  type DayPhase,
} from '@sj/shared'

// An hour of the day is a plan for today; a day and a phase is an appointment. Without the
// second shape nothing can be arranged in advance, only remembered or improvised.
const ReconsiderAtSchema = z.union([
  z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  z.object({ day: z.number().int().positive(), phase: z.enum(['day', 'dusk', 'night']) }).strict(),
])
export type ReconsiderAt = z.infer<typeof ReconsiderAtSchema>

// The act as the runtime holds it: the same closed grammar with the keys it never asked for
// already taken off, which is the shape each verb's own `validate` reads.
export const IntentSchema = z
  .object({
    verb: ClosedIntentSchema.shape.verb,
    params: ClosedIntentParams.partial()
      .default({})
      .describe('Exactly what the act asks for, named by its keys.'),
  })
  .strict()
const FreeformSchema = z
  .object({ freeform: z.string().min(1).describe('What you are trying to do, in your own words.') })
  .strict()
const ACT_NOW =
  'One act you start now: its exact word as verb with what it asks as params, or freeform for a try at something new.'
const A_PLAN =
  'Up to twelve acts your body does one after another while you stop thinking about it.'
// Every optional field takes null as well as absence, and not via `.transform()`, which
// `z.toJSONSchema(..., { io: 'output' })` refuses to represent. Readers treat both alike.
export const TurnSchema = z
  .object({
    thought: z
      .string()
      .min(1)
      .describe(
        'What is going through your head this moment, in one or two sentences. Yours alone. Nobody else ever hears it.',
      ),
    speech: z
      .string()
      .min(1)
      .nullish()
      .describe('Words you say out loud. Anyone close enough hears them.'),
    action: z.union([IntentSchema, FreeformSchema]).nullish().describe(ACT_NOW),
    plan: z.array(IntentSchema).max(PLAN_MAX_STEPS).nullish().describe(A_PLAN),
    mood: z
      .string()
      .min(1)
      .nullish()
      .describe(
        'How you feel right now, in one or two plain words of your own. Null unless it has changed since you last said it.',
      ),
    journal: z
      .string()
      .min(1)
      .nullish()
      .describe('Words you write in your own book. Writing takes part of the hour.'),
    recall: z
      .string()
      .min(1)
      .nullish()
      .describe(
        'Something from your own past to think back to. Thinking back takes the whole moment: you do nothing else with it, and what comes back reaches you a moment later.',
      ),
    importance: z
      .number()
      .int()
      .min(1)
      .max(10)
      .describe('How much this moment matters to you, one to ten.'),
    reconsider_at: ReconsiderAtSchema.nullish().describe(
      'When you mean to think again: a clock time today such as 08:30, or a day and a part of that day such as {"day": 12, "phase": "dusk"}. The parts of a day are day, dusk and night.',
    ),
  })
  .strict()
// Experiment (owner 2026-08-31): no null act allowed — a mind that does nothing must say
// { verb: 'wait' } out loud. Measures whether banning the shrug creates real acts or renames it.
export const TurnSchemaActionRequired = TurnSchema.extend({
  action: z
    .union([IntentSchema, FreeformSchema])
    .describe(`${ACT_NOW} If you truly do nothing this turn, answer { verb: 'wait', params: {} }.`),
})

// ★ ONE OBJECT, NOT A CHOICE OF TWO. A grammar-constrained back end handles a union of object
// shapes worst of everything a schema can hold, and this was one of the two the turn had. The
// keys are the same keys; `fromClosed` puts the answer back into the shape the world reads.
const StrictActionSchema = z
  .object({
    verb: ClosedIntentSchema.shape.verb
      .nullable()
      .describe(
        'The exact word of the act, such as walk or eat. Null only when no word on the list fits and you are saying it in your own words instead.',
      ),
    params: ClosedIntentParams.describe(
      'Exactly what the act asks for, named by its keys. Every other key is null.',
    ),
    freeform: z
      .string()
      .min(1)
      .nullable()
      .describe(
        'What you are trying to do, in your own words, when no word on the list fits. Null whenever you named a verb.',
      ),
  })
  .strict()

// ★ The other one, and the turn's only regex with it: a clock time and an appointment are now
// three keys of one object rather than a string held to a shape or an object.
const StrictReconsiderAt = z
  .object({
    time: z
      .string()
      .min(1)
      .nullable()
      .describe('A clock time today, written as 08:30. Null when you mean another day.'),
    day: z
      .number()
      .int()
      .positive()
      .nullable()
      .describe('The day you mean, when it is not today. Null when you named a time.'),
    phase: z
      .enum(['day', 'dusk', 'night'])
      .nullable()
      .describe('Which part of that day: day, dusk or night. Null when you named a time.'),
  })
  .strict()

// The turn every mind is asked for: no key left out, no key it has never heard of. Absence is
// written as null, and `fromClosed` below takes it back out for the world.
export const StrictTurnSchema = TurnSchemaActionRequired.required().extend({
  action: StrictActionSchema.describe(
    `${ACT_NOW} If you truly do nothing this turn, answer verb 'wait' and no params.`,
  ),
  plan: z.array(ClosedIntentSchema).max(PLAN_MAX_STEPS).nullable().describe(A_PLAN),
  reconsider_at: StrictReconsiderAt.nullable().describe(
    'When you mean to think again: a clock time today such as 08:30, or a day and a part of that day. The parts of a day are day, dusk and night.',
  ),
})

/** The turn's own field names. A mind reaches for these as verbs — four of the phase 1 gate's
 *  seven paid rulings were `plan` named as an act — and the runtime turns them away as the
 *  no-op they are. Read off the schema, so a field added there cannot leave this stale. */
export const TURN_FIELDS: ReadonlySet<string> = new Set(Object.keys(StrictTurnSchema.shape))

const askedFor = (step: unknown): unknown => {
  if (step === null || typeof step !== 'object') return step
  const { params, ...rest } = step as { params?: unknown }
  if (params === null || typeof params !== 'object') return step
  return { ...rest, params: namedParams(params as Record<string, unknown>) }
}

const said = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

/** The flat act read back as the one the world takes: a named verb wins over words in the
 *  margin, and an act that named neither is the null the runtime has always understood. An
 *  answer in the older two-shape dialect has no `freeform` key and comes through untouched. */
const oneAct = (raw: unknown): unknown => {
  if (raw === null || typeof raw !== 'object' || !('freeform' in raw)) return askedFor(raw)
  const { freeform, ...named } = raw as { freeform?: unknown; verb?: unknown }
  if (said(named.verb)) return askedFor(named)
  return said(freeform) ? { freeform } : null
}

// A decoder no longer holds the clock to a shape, so the one loose form a mind writes is read
// here rather than costing a whole second turn.
const CLOCK = /^(\d{1,2}):(\d{2})$/

/** The flat "when" read back as the one shape or the other. */
const whenAgain = (raw: unknown): unknown => {
  if (raw === null || typeof raw !== 'object' || !('time' in raw)) return raw
  const { time, day, phase } = raw as { time?: unknown; day?: unknown; phase?: unknown }
  if (said(time)) {
    const hhmm = CLOCK.exec(time.trim())
    return hhmm === null ? time : `${hhmm[1]!.padStart(2, '0')}:${hhmm[2]!}`
  }
  return typeof day === 'number' && said(phase) ? { day, phase } : null
}

// With `namedParams` on a map verdict, the only place a closed answer's nulls come off: each
// verb's `validate` parses a `.strict()` schema of its own keys, which a null-filled one fails.
export function fromClosed(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object') return raw
  const turn = { ...raw } as { action?: unknown; plan?: unknown; reconsider_at?: unknown }
  if ('action' in turn) turn.action = oneAct(turn.action)
  if (Array.isArray(turn.plan)) turn.plan = turn.plan.map(askedFor)
  if ('reconsider_at' in turn) turn.reconsider_at = whenAgain(turn.reconsider_at)
  return turn
}

/** A mind's answer, in the closed dialect it was asked for, read as the turn the runtime knows. */
export const readMindTurn = (raw: unknown): z.ZodSafeParseResult<Turn> =>
  TurnSchemaActionRequired.safeParse(fromClosed(raw))

export type Turn = z.infer<typeof TurnSchema>

export const FALLBACK_TURN: Turn = {
  thought: 'My mind drifts. I stand quietly, lost in thought.',
  importance: 1,
}

// The acts that ask for nothing of their own. A verb minted at runtime is one too: the arbiter
// only ever hands those over with nothing in them.
const ACTS_ASKING_NOTHING = new Set(['sleep', 'wake', 'stop', 'exit', 'doff', 'drink', 'forage'])

/** Words for standing still. The registry has none of them and the runtime reads every one as a
 *  quiet beat, so asking a mind again to fill one in buys a call for an act with nowhere to go. */
export const BODY_NOOPS: ReadonlySet<string> = new Set([
  'stand',
  'sit',
  'wait',
  'rest',
  'look',
  'think',
  'none',
  'nothing',
  'pause',
  'stay',
])

// A try at something new carries no verb of its own, so neither reader below can speak for it.
const namedAct = (turn: Turn): z.infer<typeof IntentSchema> | null => {
  const action = turn.action
  return action === null || action === undefined || 'freeform' in action ? null : action
}

/** A turn as the body will carry it out. A wait is a rest, not an act: as the action it becomes
 *  the old null (a plan runs on, stillness stays still), and as a plan step it is dropped, since
 *  the world has no such verb and a refused step takes the whole queue down with it. */
export const waitIsRest = (turn: Turn): Turn => {
  const rested = namedAct(turn)?.verb === 'wait' ? { ...turn, action: null } : turn
  const plan = rested.plan ?? null
  if (plan === null) return rested
  const kept = plan.filter((step) => step.verb !== 'wait')
  if (kept.length === plan.length) return rested
  // An empty plan is not no plan: the runtime reads `[]` as a queue to clear and null as one to
  // leave running, so a plan that was nothing but a wait has to come back as null.
  return { ...rested, plan: kept.length > 0 ? kept : null }
}

/** The verb this turn began with nothing named, or null when the act carries its detail. A
 *  field of the turn named as a verb is dropped as the no-op it is, so asking again for a
 *  detail it never had would buy a call for an act that cannot reach the world. */
export function actWithoutItsDetail(turn: Turn): string | null {
  const action = namedAct(turn)
  if (action === null) return null
  if (ACTS_ASKING_NOTHING.has(action.verb) || TURN_FIELDS.has(action.verb)) return null
  if (BODY_NOOPS.has(action.verb)) return null
  if (action.verb.includes(':')) return null
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

/** Whether this answer puts words into the world. The capabilities list offers two doors, the
 *  `speech` field and a `speak` action, and w1a sent 35 of its 104 speeches through the second. */
export function turnSpeaks(turn: Turn): boolean {
  if (!isBlankAnswer(turn.speech)) return true
  const action = namedAct(turn)
  return action !== null && action.verb === 'speak' && !isBlankAnswer(action.params.text)
}

/** Whether the world holds exactly one thing this verb's blank object could have meant. */
export type ActHasOneReading = (verb: string) => boolean

export async function parseTurnWithRepair(
  raw: unknown,
  repair: (issues: string) => Promise<unknown>,
  alert: (kind: string, detail: string) => void,
  hasOneReading?: ActHasOneReading,
): Promise<Turn> {
  const first = readMindTurn(raw)
  if (!first.success) {
    const second = readMindTurn(await repair(z.prettifyError(first.error)))
    if (second.success) return waitIsRest(second.data)
    alert('turn_fallback', z.prettifyError(second.error))
    return FALLBACK_TURN
  }
  // The same one correction, spent on the other way an answer comes back unusable: the world
  // refuses an act with nothing in it a beat later, with the moment already gone (K20).
  const rested = waitIsRest(first.data)
  const empty = actWithoutItsDetail(rested)
  if (empty === null) return rested
  // One reading beats one more call: the world fills the act's one candidate in when it takes
  // it, so a mind is not asked again for a word it had no choice about.
  if (hasOneReading?.(empty) === true) {
    alert('act_detail_filled_in', `${empty} has one candidate and was read as that`)
    return rested
  }
  const again = readMindTurn(
    await repair(`your last answer left ${empty} empty. Name what it asks for, or act otherwise`),
  )
  if (again.success) {
    const retried = waitIsRest(again.data)
    if (actWithoutItsDetail(retried) === null) return retried
  }
  alert('empty_act_detail', `${empty} came back empty twice`)
  return rested
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

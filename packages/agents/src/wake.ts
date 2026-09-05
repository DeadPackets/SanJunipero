import { z } from 'zod'
import { dayPhaseFromTick, MINUTES_PER_DAY } from '@sj/shared'
import { IntentSchema } from './turn.js'
import type { PerceptionPacket } from './prompt/prose.js'

export type MindConfig = {
  idleGapTicks: number
  boredomTicks: number
  // Four clocks that ring when they run low, and one rung that rings when it rises: a named
  // affliction at or above `affliction` severity is a body failing, and worth waking for.
  bodyAlarm: { hunger: number; energy: number; warmth: number; thirst: number; affliction: number }
  alarmHysteresis: number
  journalTicks: number
  dozeTicks: number
  wakeRetryTicks: number
  napTicks: number
  dreamChance: number
  ambientK: number
  // How high `belonging` has to stand before the dusk fire is worth a turn of its own.
  gatheringWant: number
}

export const DEFAULT_MIND_CONFIG: MindConfig = {
  idleGapTicks: 30,
  boredomTicks: 60,
  // Thirst rings with hunger; any named affliction rings at its first severity. Hunger rings
  // late (D1). Energy rings at 25: at 10 the bell came an hour before the body dropped, and r18
  // lost ten of its eleven collapses to minds still up and talking at 23:00 with no way to a bed.
  bodyAlarm: { hunger: 15, energy: 25, warmth: 20, thirst: 25, affliction: 1 },
  alarmHysteresis: 10,
  journalTicks: 10,
  dozeTicks: 60,
  wakeRetryTicks: 25,
  napTicks: 120,
  dreamChance: 0.35,
  ambientK: 6,
  // 40 of 100, which a want rising 0.017 a tick from zero reaches in 1.6 sim-days. At 60 a fresh
  // town saw this fire for nobody until day three, and the first two days are what a new watcher
  // watches. Belonging resets to zero on any scene, so the lonely gather and then stop firing.
  gatheringWant: 40,
}

type BodyNeeds = { hunger: number; energy: number; warmth: number }

// The body the alarm reads. `thirst` and `afflictions` are absent on a packet from before
// C11, which reads as a full body carrying nothing.
export type AlarmBody = {
  needs: BodyNeeds
  thirst?: number
  afflictions?: readonly { kind: string; severity: number }[]
}

// The three needs the alarm has always watched, and the fourth C11 gave it.
const ALARM_NEEDS = ['hunger', 'energy', 'warmth', 'thirst'] as const
type AlarmNeed = (typeof ALARM_NEEDS)[number]

const levelOf = (body: AlarmBody, need: AlarmNeed): number =>
  need === 'thirst' ? (body.thirst ?? 100) : body.needs[need]

export type MindClock = {
  // `null` is a mind that has never taken a turn, and is not tick 0: a fresh town starts there,
  // so a zero makes a new arrival wait out the whole boredom floor first.
  lastTurnTick: number | null
  reconsiderAtTick: number | null
  dozeUntilTick: number
  // Keyed by need name and by `affliction:<kind>`. Absent is armed: a rung nobody has spent
  // yet still rings, so a clock added after a mind woke up needs no migration.
  alarmArmed: Partial<Record<string, boolean>>
  morningWokeDay: number | null
  // The day this mind last spent a turn on the dusk fire. Null is a mind that never has.
  gatheringDay: number | null
  wakeRetryAtTick: number
  prevVisibleIds: string[]
  // The felt tags this mind has already been asked about. Optional: a checkpoint written before
  // it existed still resumes, and an absent latch costs one turn, not sixty-six.
  feltSeen?: string[] | undefined
}

type Intent = z.infer<typeof IntentSchema>

export type PlanState = {
  queue: Intent[]
  lastResult: 'idle' | 'running' | 'done' | 'blocked'
  // How many acts the plan was committed with, so a running one can say which step it is on.
  // Optional: a checkpoint written before it existed still resumes, and prints no step.
  size?: number | undefined
}

export type WakeReason =
  | 'body_alarm'
  | 'salient_perception'
  | 'plan_blocked'
  | 'plan_done'
  | 'floor'
  | 'reconsider'
  | 'boredom'
  | 'morning'
  | 'gathering'

/** Where this mind stands in an open scene. A scene holds the talk now, so it outranks every
 *  other reason while it is open: a floor-holder who woke for a plan would never answer. */
export type FloorState = { inScene: boolean; holdsFloor: boolean }
const NO_SCENE: FloorState = { inScene: false, holdsFloor: false }

/** The one reason that decides the turn: the head of the list below, and the same answer this
 *  function has always given. */
export function decideWake(
  cfg: MindConfig,
  packet: PerceptionPacket,
  clock: MindClock,
  tick: number,
  plan: PlanState,
  floor: FloorState = NO_SCENE,
  belonging = 0,
): WakeReason | null {
  return wakeReasons(cfg, packet, clock, tick, plan, floor, belonging)[0] ?? null
}

/** Every reason true at this tick, the deciding one first. What follows the head bought nothing
 *  — it is what a histogram of winners alone cannot see, and `salient_perception` at 82% of the
 *  gate's calls was mostly a mind with nothing left to do that someone also walked past. It is
 *  read on two rungs now: felt is immediate, noticed waits for the idle gap.
 *
 *  A reason gated behind a `return` still ends the list: the backoff, the retry rung and the idle
 *  floor each stop the ladder, and what they stop was never going to be returned either.
 *
 *  Asked once a tick, and an answer with anything in it is a turn — so the felt latch is spent
 *  here. Asking twice at one tick answers the second ask as if the first had bought the turn. */
export function wakeReasons(
  cfg: MindConfig,
  packet: PerceptionPacket,
  clock: MindClock,
  tick: number,
  plan: PlanState,
  floor: FloorState = NO_SCENE,
  belonging = 0,
): WakeReason[] {
  // Backoff after a failed turn: even floor-exempt reasons wait it out.
  if (tick < clock.dozeUntilTick) return []

  // Fire and a blow reach a sleeper, so they reach a listener too: talk is a shallower state
  // than sleep, and it must not hold a mind still through the one thing sleep does not.
  const rousing = packet.feltEvents.some((e) => e === 'you_were_attacked' || e.startsWith('fire'))

  // Standing in a talk is hands at work, and the body breaks off both the same way. Nothing
  // closes a talk for being late any more, so this is the only thing that reaches anyone in one
  // running down: merely tired keeps listening, genuinely failing goes.
  const failing = bodyAlarmFired(cfg, packet.self.body, clock.alarmArmed)

  // An hour lain with somebody is chosen, and it is as deep a state as sleep: a boredom or a
  // plan wake out of it is a turn spent being refused for hands that are full.
  if (packet.self.activity === 'lie_with' && !packet.self.asleep && !rousing && !failing) return []

  // A listener takes no turn at all — that is what makes hearing free. A failing body that holds
  // the floor says its line first; the alarm reaches it the beat after, still in the talk, where
  // its turn can eat, say goodbye or walk off in a way the others remember. r16 counted 250 alarm
  // turns and 90 of 117 talks ending on a body that left without a word.
  if (floor.inScene && !packet.self.asleep && !rousing) {
    if (floor.holdsFloor) return ['floor']
    if (!failing) return []
  }

  const reasons: WakeReason[] = []
  if (packet.self.asleep) {
    if (rousing) reasons.push('salient_perception')
    // Asleep the one-shot flags give way to the backoff: a starving sleeper never recovers past
    // the re-arm point, so the alarm has to ring again until the body rises.
    if (tick < clock.wakeRetryAtTick) return reasons
    // Sleep is the cure for a low energy, not a reason to rise: r20 saw Halim woken by his own
    // tiredness bell eleven times in one night and drop each time before he was back in bed.
    if (sleeperAlarmBelow(cfg, packet.self.body)) reasons.push('body_alarm')
    // A daytime sleeper is asked again after a nap, or one bad morning costs the whole day.
    const napped = clock.lastTurnTick === null ? Infinity : tick - clock.lastTurnTick
    const dawn = clock.morningWokeDay !== Math.floor(tick / MINUTES_PER_DAY)
    if (!packet.time.isNight && (dawn || napped >= cfg.napTicks)) reasons.push('morning')
    return reasons
  }

  const sinceLast = clock.lastTurnTick === null ? Infinity : tick - clock.lastTurnTick

  // Floor-exempt: physical rousing, and whatever happened TO this body. A felt event sits in the
  // window for all 66 of its ticks, so only what is new since the last ask is worth a turn.
  const spentFelt = clock.feltSeen ?? []
  const felt =
    packet.feltEvents.length > spentFelt.length ||
    packet.feltEvents.some((e) => !spentFelt.includes(e))
  clock.feltSeen = [...packet.feltEvents]
  if (bodyAlarmFired(cfg, packet.self.body, clock.alarmArmed)) reasons.push('body_alarm')
  if (felt) reasons.push('salient_perception')
  if (plan.lastResult === 'blocked') reasons.push('plan_blocked')
  // Above the gate on purpose, and affordable there because a scene resets belonging to 0: a
  // mind with company never reaches the threshold, so the rung is only ever billed to the lonely.
  if (gatheringDue(cfg, clock, tick, belonging)) reasons.push('gathering')

  if (sinceLast < cfg.idleGapTicks) return reasons

  // Merely noticed: a word overheard, a face arriving or going. The scene machine is what
  // answers speech now — a mind spoken to becomes a participant and gets the floor, which is
  // gap-exempt — so hearing one buys a turn no sooner than an idle mind's own pacing allows.
  if (!felt && noticed(packet, clock.prevVisibleIds)) reasons.push('salient_perception')
  if (plan.lastResult === 'done') reasons.push('plan_done')
  if (clock.reconsiderAtTick !== null && tick >= clock.reconsiderAtTick) reasons.push('reconsider')
  if (plan.queue.length === 0 && sinceLast >= cfg.boredomTicks) reasons.push('boredom')

  return reasons
}

// Once per mind per dusk. The want is true for all 120 dusk ticks, so what makes it one turn is
// `gatheringDay`, latched by the runtime the way `morningWokeDay` is — on a turn actually bought.
function gatheringDue(cfg: MindConfig, clock: MindClock, tick: number, belonging: number): boolean {
  return (
    belonging > cfg.gatheringWant &&
    dayPhaseFromTick(tick) === 'dusk' &&
    clock.gatheringDay !== Math.floor(tick / MINUTES_PER_DAY)
  )
}

// Every rung the body is failing on right now, need and affliction alike, as alarm keys.
function ringing(cfg: MindConfig, body: AlarmBody): string[] {
  const keys: string[] = []
  for (const need of ALARM_NEEDS) {
    if (levelOf(body, need) < cfg.bodyAlarm[need]) keys.push(need)
  }
  for (const a of body.afflictions ?? []) {
    if (a.severity >= cfg.bodyAlarm.affliction) keys.push(`affliction:${a.kind}`)
  }
  return keys
}

function sleeperAlarmBelow(cfg: MindConfig, body: AlarmBody): boolean {
  return ringing(cfg, body).some((key) => key !== 'energy')
}

function bodyAlarmFired(cfg: MindConfig, body: AlarmBody, armed: MindClock['alarmArmed']): boolean {
  return ringing(cfg, body).some((key) => armed[key] ?? true)
}

// A need recovered past threshold + hysteresis re-arms, so oscillation cannot re-fire it. An
// affliction has no scale to oscillate on: getting worse is not a second bell.
export function rearmBodyAlarm(cfg: MindConfig, body: AlarmBody, clock: MindClock): void {
  for (const need of ALARM_NEEDS) {
    if (levelOf(body, need) >= cfg.bodyAlarm[need] + cfg.alarmHysteresis)
      clock.alarmArmed[need] = true
  }
  const still = new Set(ringing(cfg, body))
  for (const key of Object.keys(clock.alarmArmed)) {
    if (key.startsWith('affliction:') && !still.has(key)) clock.alarmArmed[key] = true
  }
}

// Called after a successful turn: rungs the mind has now seen itself on stop ringing until
// it climbs off them.
export function disarmBodyAlarm(cfg: MindConfig, body: AlarmBody, clock: MindClock): void {
  for (const key of ringing(cfg, body)) clock.alarmArmed[key] = false
}

// What this mind only noticed, as against what happened to it. A word carries no claim on the
// hearer: an audience of ten around a twelve-line scene would otherwise buy 120 turns at
// $0.00079 apiece to overhear one that cost $0.00017 a line.
function noticed(packet: PerceptionPacket, prevVisibleIds: string[]): boolean {
  if (packet.heard.length > 0) return true
  const ids = packet.visible.agents.map((a) => a.id)
  if (ids.length !== prevVisibleIds.length) return true
  const seen = new Set(ids)
  return prevVisibleIds.some((id) => !seen.has(id))
}

import { z } from 'zod'
import { MINUTES_PER_DAY } from '@sj/shared'
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
}

export const DEFAULT_MIND_CONFIG: MindConfig = {
  idleGapTicks: 30,
  boredomTicks: 60,
  // Thirst rings with hunger; any named affliction rings at its first severity. Hunger and
  // energy ring late (D1): a body turn should be rare enough to read as an emergency.
  bodyAlarm: { hunger: 15, energy: 10, warmth: 20, thirst: 25, affliction: 1 },
  alarmHysteresis: 10,
  journalTicks: 10,
  dozeTicks: 60,
  wakeRetryTicks: 25,
  napTicks: 120,
  dreamChance: 0.35,
  ambientK: 6,
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
  wakeRetryAtTick: number
  prevVisibleIds: string[]
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
): WakeReason | null {
  return wakeReasons(cfg, packet, clock, tick, plan, floor)[0] ?? null
}

/** Every reason true at this tick, the deciding one first. What follows the head bought nothing
 *  — it is what a histogram of winners alone cannot see, and `salient_perception` at 82% of the
 *  gate's calls was mostly a mind with nothing left to do that someone also walked past. It is
 *  read on two rungs now: felt is immediate, noticed waits for the idle gap.
 *
 *  A reason gated behind a `return` still ends the list: the backoff, the retry rung and the idle
 *  floor each stop the ladder, and what they stop was never going to be returned either. */
export function wakeReasons(
  cfg: MindConfig,
  packet: PerceptionPacket,
  clock: MindClock,
  tick: number,
  plan: PlanState,
  floor: FloorState = NO_SCENE,
): WakeReason[] {
  // Backoff after a failed turn: even floor-exempt reasons wait it out.
  if (tick < clock.dozeUntilTick) return []

  // Fire and a blow reach a sleeper, so they reach a listener too: talk is a shallower state
  // than sleep, and it must not hold a mind still through the one thing sleep does not.
  const rousing = packet.feltEvents.some((e) => e === 'you_were_attacked' || e.startsWith('fire'))

  // Holding the floor is hands at work, and the body breaks off both the same way. Nothing
  // closes a talk for being late any more, so this is the only thing that reaches a mouth
  // running down: merely tired keeps talking, genuinely failing goes.
  const failing = floor.holdsFloor && bodyAlarmFired(cfg, packet.self.body, clock.alarmArmed)

  // A listener takes no turn at all — that is what makes hearing free.
  if (floor.inScene && !packet.self.asleep && !rousing && !failing) {
    return floor.holdsFloor ? ['floor'] : []
  }

  const reasons: WakeReason[] = []
  if (packet.self.asleep) {
    if (rousing) reasons.push('salient_perception')
    // Asleep the one-shot flags give way to the backoff: a starving sleeper never recovers past
    // the re-arm point, so the alarm has to ring again until the body rises.
    if (tick < clock.wakeRetryAtTick) return reasons
    if (bodyAlarmBelow(cfg, packet.self.body)) reasons.push('body_alarm')
    // A daytime sleeper is asked again after a nap, or one bad morning costs the whole day.
    const napped = clock.lastTurnTick === null ? Infinity : tick - clock.lastTurnTick
    const dawn = clock.morningWokeDay !== Math.floor(tick / MINUTES_PER_DAY)
    if (!packet.time.isNight && (dawn || napped >= cfg.napTicks)) reasons.push('morning')
    return reasons
  }

  const sinceLast = clock.lastTurnTick === null ? Infinity : tick - clock.lastTurnTick

  // Floor-exempt: physical rousing, and whatever happened TO this body.
  const felt = packet.feltEvents.length > 0
  if (bodyAlarmFired(cfg, packet.self.body, clock.alarmArmed)) reasons.push('body_alarm')
  if (felt) reasons.push('salient_perception')
  if (plan.lastResult === 'blocked') reasons.push('plan_blocked')

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

function bodyAlarmBelow(cfg: MindConfig, body: AlarmBody): boolean {
  return ringing(cfg, body).length > 0
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

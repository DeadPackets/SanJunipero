import { z } from 'zod'
import { MINUTES_PER_DAY } from '@sj/shared'
import { IntentSchema } from './turn.js'
import type { PerceptionPacket } from './prompt/prose.js'

export type MindConfig = {
  conversationGapTicks: number
  conversationWindowTicks: number
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
  // Five ticks is ten seconds at 1x: a reply lands in the pause a person leaves, not on top
  // of the words it answers.
  conversationGapTicks: 5,
  conversationWindowTicks: 60,
  idleGapTicks: 30,
  boredomTicks: 60,
  // Thirst empties as hunger does and kills faster, so it rings on the same rung. Any named
  // affliction rings at its first severity: poison and illness both begin there.
  bodyAlarm: { hunger: 25, energy: 15, warmth: 20, thirst: 25, affliction: 1 },
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
  conversationUntilTick: number
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
  | 'conversation_beat'
  | 'reconsider'
  | 'boredom'
  | 'morning'

export function decideWake(
  cfg: MindConfig,
  packet: PerceptionPacket,
  clock: MindClock,
  tick: number,
  plan: PlanState,
): WakeReason | null {
  // Backoff after a failed turn: even floor-exempt reasons wait it out.
  if (tick < clock.dozeUntilTick) return null

  if (packet.self.asleep) {
    if (packet.feltEvents.some((e) => e === 'you_were_attacked' || e.startsWith('fire'))) {
      return 'salient_perception'
    }
    // Asleep the one-shot flags give way to the backoff: a starving sleeper never recovers past
    // the re-arm point, so the alarm has to ring again until the body rises.
    if (tick < clock.wakeRetryAtTick) return null
    if (bodyAlarmBelow(cfg, packet.self.body)) return 'body_alarm'
    if (!packet.time.isNight && clock.morningWokeDay !== Math.floor(tick / MINUTES_PER_DAY)) {
      return 'morning'
    }
    // A daytime sleeper is asked again after a nap, or one bad morning costs the whole day.
    const napped = clock.lastTurnTick === null ? Infinity : tick - clock.lastTurnTick
    if (!packet.time.isNight && napped >= cfg.napTicks) return 'morning'
    return null
  }

  const sinceLast = clock.lastTurnTick === null ? Infinity : tick - clock.lastTurnTick
  const inConversation = tick < clock.conversationUntilTick

  // Floor-exempt: physical rousing and immediate surprises.
  if (bodyAlarmFired(cfg, packet.self.body, clock.alarmArmed)) return 'body_alarm'
  if (salientPerception(packet, clock.prevVisibleIds)) return 'salient_perception'
  if (plan.lastResult === 'blocked') return 'plan_blocked'

  // plan_done: subject to the idle floor, but the floor only applies outside
  // an open conversation window.
  if (plan.lastResult === 'done' && (inConversation || sinceLast >= cfg.idleGapTicks))
    return 'plan_done'

  // conversation_beat: inside the window, its own tighter cadence.
  if (inConversation && sinceLast >= cfg.conversationGapTicks) return 'conversation_beat'

  // The idle floor gates the remaining reasons only outside conversation.
  if (!inConversation && sinceLast < cfg.idleGapTicks) return null

  if (clock.reconsiderAtTick !== null && tick >= clock.reconsiderAtTick) return 'reconsider'
  if (plan.queue.length === 0 && sinceLast >= cfg.boredomTicks) return 'boredom'

  return null
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

function salientPerception(packet: PerceptionPacket, prevVisibleIds: string[]): boolean {
  if (packet.heard.length > 0) return true
  if (packet.feltEvents.length > 0) return true
  const ids = packet.visible.agents.map((a) => a.id)
  if (ids.length !== prevVisibleIds.length) return true
  const seen = new Set(ids)
  return prevVisibleIds.some((id) => !seen.has(id))
}

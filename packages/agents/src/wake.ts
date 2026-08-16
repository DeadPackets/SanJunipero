import { z } from 'zod'
import { MINUTES_PER_DAY } from '@sj/shared'
import { IntentSchema } from './turn.js'
import type { PerceptionPacket } from './prompt/prose.js'

export type MindConfig = {
  conversationGapTicks: number
  conversationWindowTicks: number
  idleGapTicks: number
  boredomTicks: number
  bodyAlarm: { hunger: number; energy: number; warmth: number }
  alarmHysteresis: number
  journalTicks: number
  dozeTicks: number
  dayLogTokenBudget: number
  dreamChance: number
  ambientK: number
}

export const DEFAULT_MIND_CONFIG: MindConfig = {
  conversationGapTicks: 2,
  conversationWindowTicks: 60,
  idleGapTicks: 20,
  boredomTicks: 120,
  bodyAlarm: { hunger: 25, energy: 15, warmth: 20 },
  alarmHysteresis: 10,
  journalTicks: 10,
  dozeTicks: 60,
  dayLogTokenBudget: 6000,
  dreamChance: 0.35,
  ambientK: 8,
}

export type BodyNeeds = { hunger: number; energy: number; warmth: number }

export type MindClock = {
  lastTurnTick: number
  reconsiderAtTick: number | null
  conversationUntilTick: number
  dozeUntilTick: number
  alarmArmed: { hunger: boolean; energy: boolean; warmth: boolean }
  morningWokeDay: number | null
  prevVisibleIds: string[]
}

type Intent = z.infer<typeof IntentSchema>

export type PlanState = {
  queue: Intent[]
  lastResult: 'idle' | 'running' | 'done' | 'blocked'
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
    if (bodyAlarmFired(cfg, packet.self.body.needs, clock.alarmArmed)) return 'body_alarm'
    if (packet.feltEvents.some((e) => e === 'you_were_attacked' || e.startsWith('fire'))) {
      return 'salient_perception'
    }
    if (!packet.time.isNight && clock.morningWokeDay !== Math.floor(tick / MINUTES_PER_DAY)) {
      return 'morning'
    }
    return null
  }

  const needs = packet.self.body.needs
  const sinceLast = tick - clock.lastTurnTick
  const inConversation = tick < clock.conversationUntilTick

  // Floor-exempt: physical rousing and immediate surprises.
  if (bodyAlarmFired(cfg, needs, clock.alarmArmed)) return 'body_alarm'
  if (salientPerception(packet, clock.prevVisibleIds)) return 'salient_perception'
  if (plan.lastResult === 'blocked') return 'plan_blocked'

  // plan_done: subject to the idle floor, but the floor only applies outside
  // an open conversation window.
  if (plan.lastResult === 'done' && (inConversation || sinceLast >= cfg.idleGapTicks)) return 'plan_done'

  // conversation_beat: inside the window, its own tighter cadence.
  if (inConversation && sinceLast >= cfg.conversationGapTicks) return 'conversation_beat'

  // The idle floor gates the remaining reasons only outside conversation.
  if (!inConversation && sinceLast < cfg.idleGapTicks) return null

  if (clock.reconsiderAtTick !== null && tick >= clock.reconsiderAtTick) return 'reconsider'
  if (plan.queue.length === 0 && sinceLast >= cfg.boredomTicks) return 'boredom'

  return null
}

function bodyAlarmFired(cfg: MindConfig, needs: BodyNeeds, armed: MindClock['alarmArmed']): boolean {
  for (const need of ['hunger', 'energy', 'warmth'] as const) {
    if (needs[need] < cfg.bodyAlarm[need] && armed[need]) return true
  }
  return false
}

// Called every tick: a need that has recovered past threshold + hysteresis
// re-arms its alarm, so oscillation around the threshold cannot re-fire it.
export function rearmBodyAlarm(cfg: MindConfig, needs: BodyNeeds, clock: MindClock): void {
  for (const need of ['hunger', 'energy', 'warmth'] as const) {
    if (needs[need] >= cfg.bodyAlarm[need] + cfg.alarmHysteresis) clock.alarmArmed[need] = true
  }
}

// Called after a successful turn: needs the mind has now seen below threshold
// stop ringing until they recover past the re-arm point.
export function disarmBodyAlarm(cfg: MindConfig, needs: BodyNeeds, clock: MindClock): void {
  for (const need of ['hunger', 'energy', 'warmth'] as const) {
    if (needs[need] < cfg.bodyAlarm[need]) clock.alarmArmed[need] = false
  }
}

function salientPerception(packet: PerceptionPacket, prevVisibleIds: string[]): boolean {
  if (packet.heard.length > 0) return true
  if (packet.feltEvents.length > 0) return true
  const ids = packet.visible.agents.map((a) => a.id)
  if (ids.length !== prevVisibleIds.length) return true
  const seen = new Set(ids)
  return prevVisibleIds.some((id) => !seen.has(id))
}

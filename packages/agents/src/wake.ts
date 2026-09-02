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

// Six lines of earshot is enough to see a two-mind loop close on itself.
const EARSHOT_MEMORY = 6
const NEAR_DUPLICATE_OVERLAP = 0.8
// Under three words a shared opening is coincidence, so the overlap rule judges those alone.
const PREFIX_MIN_WORDS = 3

// Per-clock and ephemeral, because `MindClock` is serialised into a strict checkpoint schema;
// a resumed mind with nothing to have heard before is the sane reset.
const earshot = new WeakMap<MindClock, { tick: number; said: string[][] }>()

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((w) => w.length > 0)
}

function nearDuplicate(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return a.length === b.length
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  if (short.length >= PREFIX_MIN_WORDS && short.every((w, i) => long[i] === w)) return true
  const setA = new Set(a)
  const setB = new Set(b)
  let shared = 0
  for (const w of setA) if (setB.has(w)) shared += 1
  return shared / (setA.size + setB.size - shared) >= NEAR_DUPLICATE_OVERLAP
}

/** The conversation window's re-arm, called every tick. Speech the mind has just heard said
 *  again is an echo, not a beat: it is still heard, it just buys no second window. */
export function rearmConversationWindow(
  cfg: MindConfig,
  packet: PerceptionPacket,
  clock: MindClock,
  tick: number,
): void {
  if (packet.heard.length === 0) return
  // A sleeper holds no conversation, so it wakes with nothing to have heard before.
  if (packet.self.asleep) earshot.delete(clock)
  const prior = earshot.get(clock)
  const said =
    prior === undefined || tick - prior.tick > cfg.conversationWindowTicks ? [] : prior.said
  let novel = false
  for (const h of packet.heard) {
    const line = words(h.text)
    if (!said.some((seen) => nearDuplicate(line, seen))) novel = true
    said.push(line)
  }
  earshot.set(clock, { tick, said: said.slice(-EARSHOT_MEMORY) })
  if (novel) clock.conversationUntilTick = tick + cfg.conversationWindowTicks
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

import type { AssetRecord, SimEvent } from '@sj/shared'
import { resolveAssetId } from './textures.js'

// No engine mood stat: §23 bans one, so a face is inferred from the ticked body and the log.

export const EXPRESSIONS = [
  'neutral',
  'happy',
  'sad',
  'angry',
  'surprised',
  'weary',
  'asleep',
] as const
export type Expression = (typeof EXPRESSIONS)[number]

/** First match wins, in this order. The array IS the priority — one table, not two. */
export const MOOD_PRIORITY: readonly Expression[] = [
  'asleep',
  'angry',
  'sad',
  'surprised',
  'weary',
  'happy',
  'neutral',
]

/** Two sim-hours: how far back a feeling reaches. */
export const MOOD_WINDOW_TICKS = 120
export const MOOD_ENERGY_WEARY = 25
export const MOOD_COMFORT = 60

/** The codex kind the ingest writes and the renderer reads. Two spellings would fail silently,
 *  which is the `roadAutotileKind` precedent. */
export function portraitKind(agentId: string, e: Expression): string {
  return `portrait:${agentId}:${e}`
}

/** What a face needs to know. An absent optional field simply never matches. */
export type MoodView = {
  id: string
  alive: boolean
  asleep: boolean
  ill: boolean
  injuries: ReadonlyArray<{ kind: string; day: number }>
  needs: { hunger: number; energy: number; warmth: number; social: number }
  collapsedSinceTick: number | null
}

const ANGRY_TYPES = new Set(['agent_attacked', 'item_taken'])
const SAD_TYPES = new Set(['agent_died', 'grave_placed'])
const SURPRISE_TYPES = new Set(['mystery_event', 'world_grown'])
const HAPPY_TYPES = new Set(['agent_born', 'item_given', 'milestone_reached'])

const involves = (ev: SimEvent, id: string): boolean => {
  const p = ev.payload as Record<string, unknown>
  for (const k of [
    'agentId',
    'id',
    'aId',
    'bId',
    'targetId',
    'byId',
    'owner',
    'motherId',
    'fatherId',
  ]) {
    if (p?.[k] === id) return true
  }
  return false
}

/** Events inside the window that this person was part of. */
function felt(recent: readonly SimEvent[], id: string, nowTick: number): SimEvent[] {
  return recent.filter((ev) => nowTick - ev.tick <= MOOD_WINDOW_TICKS && involves(ev, id))
}

export function moodOf(a: MoodView, recent: readonly SimEvent[], nowTick: number): Expression {
  if (a.asleep || !a.alive) return 'asleep'
  const mine = felt(recent, a.id, nowTick)
  if (mine.some((ev) => ANGRY_TYPES.has(ev.type))) return 'angry'
  if (mine.some((ev) => SAD_TYPES.has(ev.type))) return 'sad'
  if (mine.some((ev) => SURPRISE_TYPES.has(ev.type))) return 'surprised'
  if (
    a.needs.energy < MOOD_ENERGY_WEARY ||
    a.ill ||
    a.injuries.length > 0 ||
    a.collapsedSinceTick !== null
  )
    return 'weary'
  const comfortable =
    a.needs.hunger > MOOD_COMFORT &&
    a.needs.energy > MOOD_COMFORT &&
    a.needs.warmth > MOOD_COMFORT &&
    a.needs.social > MOOD_COMFORT
  if (comfortable && mine.some((ev) => HAPPY_TYPES.has(ev.type))) return 'happy'
  return 'neutral'
}

/** The expression, else the neutral face, else `null` — and `null` is a real answer the caller
 *  falls back from, never a broken image. */
export function portraitUrl(
  records: readonly AssetRecord[],
  agentId: string,
  e: Expression,
): string | null {
  for (const want of e === 'neutral' ? [e] : [e, 'neutral' as Expression]) {
    const id = resolveAssetId(records as AssetRecord[], 'portrait', portraitKind(agentId, want))
    if (id !== null) return `/assets/${id}.png`
  }
  return null
}

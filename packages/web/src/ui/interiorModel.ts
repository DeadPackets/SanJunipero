import { tickToMoment, type AssetRecord } from '@sj/shared'
import type { WorldState } from '@sj/engine/state'
import { interiorOf } from '../render/interiors.js'
import { resolveAssetId } from '../render/textures.js'

/**
 * The town's word for a kind IS the kind, with its underscores spent. The hand-maintained map this
 * replaces went stale the day `cabin`, `cottage` and `farmhouse` became rooms, and read "the room".
 */
export const roomWord = (kind: string): string => kind.replace(/_/g, ' ')

/** At most this many holdings get a row; the rest are counted honestly. */
export const ROOM_HOLDS_MAX = 8

/** The only status words this card needs, chosen so one ratified vocabulary can replace this map
 *  rather than have to audit it. */
export const ROOM_STATE_ASLEEP = 'Asleep'
/** The ratified answer to "awake with nothing to do" (C12 ruling R7, Q6). */
export const ROOM_STATE_IDLE = 'Between things'

// t7 gerund ruling: drop a trailing 'e', append 'ing'; no other morphology
const gerund = (verb: string): string => `${verb.endsWith('e') ? verb.slice(0, -1) : verb}ing`
const sentenceCase = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

export function roomStateOf(a: { asleep: boolean; activity: { verb: string } | null }): string {
  if (a.asleep) return ROOM_STATE_ASLEEP
  return a.activity === null ? ROOM_STATE_IDLE : sentenceCase(gerund(a.activity.verb))
}

export type Provenance = {
  id: string
  kind: string
  plannedTick: number
  builderId: string
  completedTick: number | null
}

/** `kind` is the engine's slug and is what resolves the icon; `words` is what a viewer reads. The
 *  grid printed the slug once, so `wheat_sheaf` reached a viewer as `wheat_s…`. */
export type RoomHolding = { kind: string; words: string; qty: number; iconUrl: string | null }
export type RoomPresence = { id: string; name: string; state: string }

export type RoomCard = {
  /** "Amara’s house" | "the storehouse" — owner-aware, P12-clean */
  title: string
  /** "Raised by Yusuf, Day 3" — null when nobody recorded it, so the panel omits the line */
  built: string | null
  /** the names this room belongs to: its owner, and anyone who sleeps here */
  lives: string[]
  /** what it holds, one row per kind, biggest first */
  holds: RoomHolding[]
  /** how many kinds the grid left out */
  more: number
  /** who is in, right now */
  present: RoomPresence[]
  /** the line for a room with nobody in it — about NOW, never about a world that has not
   *  started yet */
  empty: string
}

export const ROOM_EMPTY_LINE = 'No one is in just now.'

const nameOf = (state: WorldState, id: string): string => state.agents[id]?.name ?? id

/** "Raised by Yusuf, Day 3", or the day it was begun while it is still going up. */
export function builtLine(state: WorldState, p: Provenance | null): string | null {
  if (p === null) return null
  const who = nameOf(state, p.builderId)
  if (p.completedTick === null)
    return `Begun by ${who}, Day ${tickToMoment(p.plannedTick).day} — still rising`
  return `Raised by ${who}, Day ${tickToMoment(p.completedTick).day}`
}

/** Everything a viewer should learn by standing in a room, from world state alone. Pure: the caller
 *  owns the fetch, so a card renders the same twice and needs no network in a test. */
export function roomCard(
  state: WorldState | null,
  structureId: string | null,
  records: AssetRecord[],
  provenance: Provenance | null,
): RoomCard | null {
  if (state === null || structureId === null) return null
  const room = interiorOf(state, structureId)
  if (room === null) return null

  const word = roomWord(room.kind)
  const ownerId = room.structure.owner
  // A typographic apostrophe, because the town's own name for a place is not a code literal.
  const title = ownerId === undefined ? `the ${word}` : `${nameOf(state, ownerId)}’s ${word}`

  const lives: string[] = []
  const claim = (id: string): void => {
    const n = nameOf(state, id)
    if (!lives.includes(n)) lives.push(n)
  }
  if (ownerId !== undefined) claim(ownerId)
  for (const id of room.occupants) if (state.agents[id]?.asleep === true) claim(id)

  const byKind = new Map<string, number>()
  for (const it of Object.values(state.items)) {
    if (it.loc.t !== 'structure' || it.loc.id !== structureId) continue
    byKind.set(it.kind, (byKind.get(it.kind) ?? 0) + it.qty)
  }
  const all = [...byKind.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([kind, qty]): RoomHolding => {
      const id = resolveAssetId(records, 'item', `${kind}#icon`)
      return {
        kind,
        words: kind.replace(/_/g, ' '),
        qty,
        iconUrl: id === null ? null : `/assets/${id}.png`,
      }
    })

  const present = room.occupants
    .filter((id) => state.agents[id] !== undefined)
    .map((id): RoomPresence => {
      const a = state.agents[id]!
      return { id, name: a.name, state: roomStateOf(a) }
    })

  return {
    title,
    built: builtLine(state, provenance),
    lives,
    holds: all.slice(0, ROOM_HOLDS_MAX),
    more: Math.max(0, all.length - ROOM_HOLDS_MAX),
    present,
    empty: ROOM_EMPTY_LINE,
  }
}

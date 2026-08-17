import { tickToMoment, type AssetRecord } from '@sj/shared'
import type { WorldState } from '@sj/engine/state'
import { interiorOf } from '../render/interiors.js'
import { resolveAssetId } from '../render/textures.js'

// WHAT THIS ROOM IS (U4, audit R7, plan task 68).
//
// THE GAP, measured: an interior showed a bare diamond, four props and "No one is in just
// now" — while the chronicle already knew "The storehouse is finished" and the provenance
// endpoint already knew who raised it. A room must read as SOMEBODY'S, not as a generic box,
// and every fact this card needs is already in the world.

/** The town's word for each enterable kind. Chrome copy speaks about townsfolk, never
 *  machinery (spec §5), and observes rather than scores (living-documentary law). */
export const ROOM_WORDS: Record<string, string> = {
  hut: 'hut', storehouse: 'storehouse', shed: 'shed',
}

/** At most this many holdings get a row; the rest are counted honestly. */
export const ROOM_HOLDS_MAX = 8

/**
 * DEVIATION: task 79 owns the ONE status vocabulary and has not landed. These are the only
 * words this card needs, chosen to obey P17 in advance — `resting` and `awake` mean the same
 * thing as `asleep`'s opposite and as each other, which is the synonym pair U13 names — so
 * task 79 replaces this map rather than having to audit it.
 */
export const ROOM_STATE_ASLEEP = 'Asleep'
/** The ratified answer to "awake with nothing to do" (C12 ruling R7, Q6). */
export const ROOM_STATE_IDLE = 'Between things'

// t7 gerund ruling: drop a trailing 'e', append 'ing'; no other morphology
const gerund = (verb: string): string => `${verb.endsWith('e') ? verb.slice(0, -1) : verb}ing`
const sentenceCase = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

export function roomStateOf(
  a: { asleep: boolean; activity: { verb: string } | null },
): string {
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

export type RoomHolding = { kind: string; qty: number; iconUrl: string | null }
export type RoomPresence = { id: string; name: string; state: string }

export type RoomCard = {
  /** "Amara’s hut" | "the storehouse" — owner-aware, P12-clean */
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
   *  started yet (audit M6) */
  empty: string
}

export const ROOM_EMPTY_LINE = 'No one is in just now.'

const nameOf = (state: WorldState, id: string): string => state.agents[id]?.name ?? id

/** "Raised by Yusuf, Day 3", or the day it was begun while it is still going up. */
export function builtLine(state: WorldState, p: Provenance | null): string | null {
  if (p === null) return null
  const who = nameOf(state, p.builderId)
  if (p.completedTick === null) return `Begun by ${who}, Day ${tickToMoment(p.plannedTick).day} — still rising`
  return `Raised by ${who}, Day ${tickToMoment(p.completedTick).day}`
}

/**
 * Everything a viewer should learn by standing in a room, from world state alone. Pure: the
 * caller owns the fetch, so a card renders the same twice and needs no network in a test.
 */
export function roomCard(
  state: WorldState | null,
  structureId: string | null,
  records: AssetRecord[],
  provenance: Provenance | null,
): RoomCard | null {
  if (state === null || structureId === null) return null
  const room = interiorOf(state, structureId)
  if (room === null) return null

  const word = ROOM_WORDS[room.kind] ?? 'room'
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
      return { kind, qty, iconUrl: id === null ? null : `/assets/${id}.png` }
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

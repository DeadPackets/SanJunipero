import { isAdjacentToRect, VESSEL_KINDS } from '@sj/engine'
import { FOOD_KINDS } from '@sj/shared'
import type { PerceptionPacket } from '../prompt/prose.js'

type Structure = PerceptionPacket['visible']['structures'][number]
type Item = PerceptionPacket['self']['inventory'][number]

const isBlank = (v: unknown): boolean =>
  v === null || v === undefined || (typeof v === 'string' && v.trim().length === 0)

const held = (packet: PerceptionPacket, wanted: (i: Item) => boolean): string[] =>
  packet.self.inventory.filter(wanted).map((i) => i.id)

// `atTheFire` off the packet: the same room is one place, and outside it is arm's reach of the
// footprint. A fire behind walls you are not inside is nobody's to feed (`fireIsOnYourSide`).
function atTheFire(packet: PerceptionPacket, s: Structure): boolean {
  const inside = packet.self.inside?.id
  if (inside !== undefined) return inside === s.id
  return isAdjacentToRect(packet.self.x, packet.self.y, s)
}

/** The key each act leaves blank, and everything in sight that key could equally have named. */
const OBJECT: Record<string, { key: string; candidates: (p: PerceptionPacket) => string[] }> = {
  stoke: {
    key: 'structureId',
    candidates: (p) =>
      p.visible.structures
        .filter((s) => s.hearth !== undefined && atTheFire(p, s))
        .map((s) => s.id),
  },
  take: {
    key: 'itemId',
    candidates: (p) => {
      const atHand = new Set(p.reach?.atHand ?? [])
      return p.visible.items.filter((i) => atHand.has(i.id)).map((i) => i.id)
    },
  },
  // The door tile itself, not a pace off it: standing between two roofs is the ambiguity that
  // has to be asked back about.
  enter: {
    key: 'structureId',
    candidates: (p) =>
      p.visible.structures
        .filter((s) => s.door?.x === p.self.x && s.door.y === p.self.y)
        .map((s) => s.id),
  },
  fill: { key: 'itemId', candidates: (p) => held(p, (i) => VESSEL_KINDS.has(i.kind)) },
  eat: { key: 'itemId', candidates: (p) => held(p, (i) => FOOD_KINDS.has(i.kind)) },
  drop: { key: 'itemId', candidates: (p) => held(p, () => true) },
  read: { key: 'itemId', candidates: (p) => held(p, (i) => i.kind === 'note') },
}

/** The one thing in sight this act's blank object could have meant, and the word that names it. */
function loneReading(
  verb: string,
  params: Record<string, unknown>,
  packet: PerceptionPacket,
): { key: string; id: string } | null {
  const object = OBJECT[verb]
  if (object === undefined || !isBlank(params[object.key])) return null
  const [only, ...rest] = object.candidates(packet)
  return only !== undefined && rest.length === 0 ? { key: object.key, id: only } : null
}

/** A person told "stoke the fire" beside exactly one fire does not ask which fire. Where the act
 *  named its verb and left the key it reads blank, and the packet holds exactly one thing that
 *  key could mean, read it in. Two things mean the mind must name one, and that refusal is right.
 *  `give`, `teach` and `speak` are never here: guessing a person, or words, is worse than asking. */
export function bindObvious<P extends Record<string, unknown>>(
  verb: string,
  params: P,
  packet: PerceptionPacket,
): P {
  const read = loneReading(verb, params, packet)
  return read === null ? params : { ...params, [read.key]: read.id }
}

/** Whether an act that named nothing has exactly one reading here. Asked before the decode
 *  retry, so a mind is not billed a second call for a word it had no choice about. */
export function hasOneReading(verb: string, packet: PerceptionPacket): boolean {
  return loneReading(verb, {}, packet) !== null
}

/** The verbs a blank object is read in for, named so a test can hold the list to the refusals
 *  the phase 1 gate counted. */
export const BOUND_VERBS: readonly string[] = Object.keys(OBJECT).sort()

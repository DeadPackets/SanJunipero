import { agentName } from '@sj/shared'
import type { BondsResponse } from '@sj/shared'
import {
  LEVEL_RANK,
  bondIndex,
  bondLevel,
  bondWarmth,
  pairFacts,
  type BondArc,
  type BondLevel,
  type BondType,
  type LineageLike,
  type PeopleIndex,
} from './bondModel2.js'
import { ARC_COLOR, LEVEL_DISTANCE, NO_LINK_LEVEL, TYPE_STROKE } from './relationGraph.js'

// ★ ONE PERSON'S ORBIT — the question people actually ask is about a person, so distance from the
// middle does the work the whole-town graph spends a force simulation on. The rings ARE
// `LEVEL_DISTANCE`: the number the renderer already lays the town graph out with, not a drawing.

/** Every ring the ladder has, warmest in the middle. */
const ALL_RINGS: readonly { level: BondLevel; r: number }[] = [...LEVEL_RANK]
  .map((level) => ({ level, r: LEVEL_DISTANCE[level] }))
  .sort((a, b) => a.r - b.r)

/** Strangers is drawn on every orbit whatever the town is like: a person nobody has met still
 *  has to have somewhere to stand, and the ring they stand on is the answer. */
const RINGS_ALWAYS = LEVEL_DISTANCE[NO_LINK_LEVEL]

/** Room for a node, its ring and its name outside the outermost ring drawn. */
const ORBIT_MARGIN = 26

/**
 * ★ THE RINGS ARE THE TOWN'S, NOT THE PERSON'S. Hatred is 240 and strangers 150, so a town with
 * no cold pair in it spent 38% of every orbit's radius on two empty bands and crammed the four
 * that matter into the middle. The ladder is cut to the coldest tie ANY pair in the town has —
 * a property of the town, so two people's orbits are still drawn at one scale and still
 * comparable, and nothing moves between two visits.
 */
export function orbitRings(coldest: number): readonly { level: BondLevel; r: number }[] {
  const out = Math.max(RINGS_ALWAYS, coldest)
  return ALL_RINGS.filter((r) => r.r <= out)
}

function orbitBox(rings: readonly { r: number }[]): number {
  return Math.max(...rings.map((r) => r.r)) + ORBIT_MARGIN
}

/** The warmth at which a line is as thick as it gets — the friendly/close boundary, so the
 *  channel spends its whole range inside the ties a viewer actually sees. */
export const STRENGTH_FULL = 20
export const STROKE_MIN = 2
export const STROKE_MAX = 6

/** THE THIRD CHANNEL. Type is the dash, the arc is the colour, and how much of a tie there is
 *  is how heavy the line is — so two ties at the same distance still differ. */
export function orbitStroke(warmth: number): number {
  const t = Math.min(1, Math.abs(warmth) / STRENGTH_FULL)
  return STROKE_MIN + (STROKE_MAX - STROKE_MIN) * t
}

export type OrbitTie = {
  id: string
  name: string
  /** THE LEVEL THAT DRAWS NO LINE, the same rule the town graph follows: two people who have
   *  barely met are two nodes on a page, and a spoke between them would invent a relationship. */
  drawn: boolean
  level: BondLevel
  type: BondType
  arc: BondArc
  warmth: number
  /** straight off `LEVEL_DISTANCE` — the ring this person sits on */
  r: number
  /** degrees clockwise from the top */
  angle: number
  x: number
  y: number
  dash: readonly number[] | null
  strokeCount: 1 | 2
  color: string
  width: number
  words: string
}

export type Orbit = {
  id: string
  name: string
  ties: OrbitTie[]
  /** the ladder this picture is drawn to, and half the box that holds it */
  rings: readonly { level: BondLevel; r: number }[]
  box: number
}

const rankOf = (l: BondLevel): number => LEVEL_RANK.indexOf(l)

/** Everyone else in the town, at their real distance from `centreId`. A pair the world has no
 *  bond for is not missing — they are strangers, and strangers are the outermost ring. */
export function orbitOf(
  centreId: string,
  bonds: BondsResponse,
  lineage: LineageLike,
  people: PeopleIndex,
  nowTick: number,
): Orbit | null {
  if (people[centreId] === undefined) return null

  const index = bondIndex(bonds)
  const seen = Object.keys(people)
    .filter((id) => id !== centreId)
    .map((id) => {
      const f = pairFacts(centreId, id, index, lineage, bonds, people, nowTick)
      return { id, name: agentName(people, id), ...f }
    })
    // Warmest first, then by name: the same person is in the same place on every visit.
    .sort((a, b) => rankOf(b.level) - rankOf(a.level) || a.name.localeCompare(b.name))

  // The coldest tie anywhere in the town, so every orbit in it is drawn to one ladder.
  let coldest = RINGS_ALWAYS
  for (const b of bonds.bonds) {
    coldest = Math.max(coldest, LEVEL_DISTANCE[bondLevel(bondWarmth(b, nowTick))])
  }
  const rings = orbitRings(coldest)

  const ties = seen.map((t, i) => {
    const angle = (i * 360) / seen.length
    const rad = ((angle - 90) * Math.PI) / 180
    const r = LEVEL_DISTANCE[t.level]
    const stroke = TYPE_STROKE[t.type]
    return {
      ...t,
      drawn: t.level !== NO_LINK_LEVEL,
      r,
      angle,
      x: r * Math.cos(rad),
      y: r * Math.sin(rad),
      dash: stroke.dash,
      strokeCount: stroke.strokeCount,
      color: ARC_COLOR[t.arc.direction],
      width: orbitStroke(t.warmth),
    }
  })
  return { id: centreId, name: people[centreId].name, ties, rings, box: orbitBox(rings) }
}

/** Who to open when nobody has been picked: the person the town has the most to say about, and
 *  their name as the tie-break so two runs of the same town agree. */
export function busiestPerson(orbitPeople: PeopleIndex, bonds: BondsResponse): string | null {
  const degree = new Map<string, number>()
  for (const b of bonds.bonds) {
    for (const id of [b.aId, b.bId]) degree.set(id, (degree.get(id) ?? 0) + 1)
  }
  let best: string | null = null
  for (const id of Object.keys(orbitPeople).sort()) {
    if (best === null || (degree.get(id) ?? 0) > (degree.get(best) ?? 0)) best = id
  }
  return best
}

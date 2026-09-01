import type { BondsResponse } from '@sj/shared'
import {
  LEVEL_RANK,
  bondArc,
  bondLevel,
  bondTypeOf,
  bondWarmth,
  relationLine,
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

/** The rings, warmest in the middle. Every one is drawn on every orbit, so nothing moves
 *  between two visits and an empty ring is as much of an answer as a full one. */
export const ORBIT_RINGS: readonly { level: BondLevel; r: number }[] = [...LEVEL_RANK]
  .map((level) => ({ level, r: LEVEL_DISTANCE[level] }))
  .sort((a, b) => a.r - b.r)

/** Half the drawn box, in orbit units: the outermost ring plus room for a node on it. */
export const ORBIT_R = Math.max(...ORBIT_RINGS.map((r) => r.r)) + 26

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

export type Orbit = { id: string; name: string; ties: OrbitTie[] }

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
  const centre = people[centreId]
  if (centre === undefined) return null

  const seen = Object.keys(people)
    .filter((id) => id !== centreId)
    .map((id) => {
      const bond =
        bonds.bonds.find(
          (b) => (b.aId === centreId && b.bId === id) || (b.aId === id && b.bId === centreId),
        ) ?? null
      const warmth = bond === null ? 0 : bondWarmth(bond, nowTick)
      const level = bondLevel(warmth)
      const type = bondTypeOf(centreId, id, lineage, bonds)
      const arc: BondArc =
        bond === null
          ? { from: level, to: level, direction: 'steady', sinceDay: 0 }
          : bondArc(bond, nowTick)
      return { id, name: people[id]?.name ?? id, warmth, level, type, arc }
    })
    // Warmest first, then by name: the same person is in the same place on every visit.
    .sort((a, b) => rankOf(b.level) - rankOf(a.level) || a.name.localeCompare(b.name))

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
      words: relationLine(t.type, t.level, t.arc, [centre.name, t.name]),
    }
  })
  return { id: centreId, name: centre.name, ties }
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

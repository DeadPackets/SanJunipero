import type { BondsResponse } from '@sj/shared'
import {
  BOND_LEVEL_WORD,
  bondArc,
  bondLevel,
  bondTypeOf,
  bondWarmth,
  relationLine,
  type BondLevel,
  type LineageLike,
  type PeopleIndex,
} from './bondModel2.js'

// ★ EVERY PAIR HAS ONE ADDRESS. A fixed grid, fixed rows and columns: nothing moves between
// visits, and a pair the world has no bond for is not a gap — it is two people who have never
// met, which is exactly as much of an answer as a full cell.

/** The heading over a column. Two letters is what fits above a cell at every town size. */
export function shortName(name: string): string {
  return name.slice(0, 2)
}

export type MatrixCell = {
  /** the diagonal: nobody has an address with themselves */
  self: boolean
  level: BondLevel
  /** rounded, and absent on the diagonal — the number IS the channel colour is not */
  warmth: number
  /** what the pair is, in the sentence the rest of the product uses */
  words: string
}

export type MatrixRow = { id: string; name: string; short: string; cells: MatrixCell[] }

export type LevelMatrix = {
  heads: { id: string; name: string; short: string }[]
  rows: MatrixRow[]
}

/** Every living person against every other, in one stable order. */
export function levelMatrix(
  bonds: BondsResponse,
  lineage: LineageLike,
  people: PeopleIndex,
  nowTick: number,
): LevelMatrix {
  const ids = Object.keys(people).sort((a, b) =>
    (people[a]?.name ?? a).localeCompare(people[b]?.name ?? b),
  )
  const nameOf = (id: string): string => people[id]?.name ?? id
  const heads = ids.map((id) => ({ id, name: nameOf(id), short: shortName(nameOf(id)) }))

  const rows = ids.map((aId) => ({
    id: aId,
    name: nameOf(aId),
    short: shortName(nameOf(aId)),
    cells: ids.map((bId): MatrixCell => {
      if (aId === bId) return { self: true, level: 'strangers', warmth: 0, words: '' }
      const bond =
        bonds.bonds.find(
          (b) => (b.aId === aId && b.bId === bId) || (b.aId === bId && b.bId === aId),
        ) ?? null
      const warmth = bond === null ? 0 : bondWarmth(bond, nowTick)
      const level = bondLevel(warmth)
      const type = bondTypeOf(aId, bId, lineage, bonds)
      const arc =
        bond === null
          ? ({ from: level, to: level, direction: 'steady', sinceDay: 0 } as const)
          : bondArc(bond, nowTick)
      return {
        self: false,
        level,
        warmth: Math.round(warmth),
        words: relationLine(type, level, arc, [nameOf(aId), nameOf(bId)]),
      }
    }),
  }))
  return { heads, rows }
}

/** The key under the grid, coldest to warmest, so the ladder reads as a ladder. */
export const MATRIX_LEVELS: readonly BondLevel[] = [
  'hatred',
  'strained',
  'strangers',
  'acquaintances',
  'friendly',
  'close',
]

export const MATRIX_LEVEL_WORD = BOND_LEVEL_WORD

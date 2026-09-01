import type { BondsResponse } from '@sj/shared'
import {
  BOND_LEVEL_WORD,
  LEVEL_RANK,
  bondIndex,
  pairFacts,
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

type MatrixCell = {
  /** the diagonal: nobody has an address with themselves */
  self: boolean
  level: BondLevel
  /** rounded, and absent on the diagonal — the number IS the channel colour is not */
  warmth: number
  /** what the pair is, in the sentence the rest of the product uses */
  words: string
}

type MatrixRow = { id: string; name: string; short: string; cells: MatrixCell[] }

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
  // Built once for the whole grid: the scan it replaces ran inside an n² cell loop.
  const index = bondIndex(bonds)

  const rows = ids.map((aId) => ({
    id: aId,
    name: nameOf(aId),
    short: shortName(nameOf(aId)),
    cells: ids.map((bId): MatrixCell => {
      if (aId === bId) return { self: true, level: 'strangers', warmth: 0, words: '' }
      const f = pairFacts(aId, bId, index, lineage, bonds, people, nowTick)
      return { self: false, level: f.level, warmth: Math.round(f.warmth), words: f.words }
    }),
  }))
  return { heads, rows }
}

/** The key under the grid. `LEVEL_RANK` is already coldest-to-warmest, which is exactly the
 *  order a ladder reads in — a second copy could only drift from it. */
export const MATRIX_LEVELS: readonly BondLevel[] = LEVEL_RANK

export const MATRIX_LEVEL_WORD = BOND_LEVEL_WORD

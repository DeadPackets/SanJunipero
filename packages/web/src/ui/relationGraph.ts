import type { BondsResponse } from '@sj/shared'
import {
  BOND_LEVELS,
  BOND_LEVEL_WORD,
  BOND_TYPES,
  BOND_TYPE_WORD,
  bondArc,
  bondLevel,
  bondTypeOf,
  bondWarmth,
  relationLine,
  type BondArc,
  type BondLevel,
  type BondType,
  type LineageLike,
} from './bondModel2.js'
import { NODE_ALIVE, NODE_DEAD, type BondNode, type PeopleIndex } from './bondModel2.js'

// Four channels, one meaning each: EVERY LIVING PERSON IS A NODE, so strangers are visible; edge
// length is LEVEL, edge mark is TYPE, edge colour is the ARC — colour is never the only signal.

export type RelationLink = {
  id: string
  source: string
  target: string
  type: BondType
  level: BondLevel
  arc: BondArc
  /** the force-graph link length, from LEVEL */
  distance: number
  dash: readonly number[] | null
  strokeCount: 1 | 2
  color: string
  /** `relationLine`, for the tooltip and the spoken label */
  words: string
}

/** Close pairs sit near and hatred sits furthest away. Strictly increasing along the warmth
 *  order read backwards, so the distance IS the level and needs no legend to feel right. */
export const LEVEL_DISTANCE: Readonly<Record<BondLevel, number>> = {
  close: 40,
  friendly: 70,
  acquaintances: 110,
  strangers: 150,
  strained: 190,
  hatred: 240,
}

/** THE LEVEL THAT DRAWS NO LINE. Two people who have barely met are two nodes on a page, and
 *  that is the honest picture — a line between them would invent a relationship. */
export const NO_LINK_LEVEL: BondLevel = 'strangers'

/** Total over `BondType`, and every `(dash, strokeCount)` pair is distinct — so two types can
 *  always be told apart with the colour taken away. */
export const TYPE_STROKE: Readonly<
  Record<BondType, { dash: readonly number[] | null; strokeCount: 1 | 2 }>
> = {
  none: { dash: null, strokeCount: 1 },
  partner: { dash: null, strokeCount: 2 },
  sibling: { dash: [2, 3], strokeCount: 1 },
  parent: { dash: [6, 3], strokeCount: 1 },
  child: { dash: [6, 3], strokeCount: 2 },
}

/** Three states, three MASTER_PALETTE tokens, each clearing 3:1 on the lens's night ground. */
export const ARC_COLOR: Readonly<Record<BondArc['direction'], string>> = {
  warming: '#F2C879', // honey
  cooling: '#7FB0C9', // water
  steady: '#ABA198', // stone
}

/** The lens's own ground, so the contrast of the three arc colours can be computed rather
 *  than asserted (`--night`). */
export const LENS_BACKGROUND = '#322B38'

const nameOf = (people: PeopleIndex, id: string): string => people[id]?.name ?? id

/**
 * Every living person is a node; only pairs that are more than strangers get a line. A kin edge is
 * oriented PARENT → CHILD however the endpoint stored it, so one family fact draws one mark.
 */
export function toRelationGraph(
  bonds: BondsResponse,
  lineage: LineageLike,
  people: PeopleIndex,
  nowTick: number,
): { nodes: BondNode[]; links: RelationLink[] } {
  const ids = Object.keys(people).sort()
  const degree = new Map<string, number>()

  const links: RelationLink[] = []
  for (const b of [...bonds.bonds].sort((x, y) => x.id.localeCompare(y.id))) {
    const level = bondLevel(bondWarmth(b, nowTick))
    if (level === NO_LINK_LEVEL) continue
    let source = b.aId
    let target = b.bId
    let type = bondTypeOf(source, target, lineage, bonds)
    if (type === 'child') {
      // read it from the parent's end, always
      ;[source, target] = [target, source]
      type = 'parent'
    }
    const arc = bondArc(b, nowTick)
    const stroke = TYPE_STROKE[type]
    links.push({
      id: b.id,
      source,
      target,
      type,
      level,
      arc,
      distance: LEVEL_DISTANCE[level],
      dash: stroke.dash,
      strokeCount: stroke.strokeCount,
      color: ARC_COLOR[arc.direction],
      words: relationLine(type, level, arc, [nameOf(people, source), nameOf(people, target)]),
    })
    degree.set(source, (degree.get(source) ?? 0) + 1)
    degree.set(target, (degree.get(target) ?? 0) + 1)
  }

  const nodes: BondNode[] = ids.map((id) => ({
    id,
    name: nameOf(people, id),
    size: 6 + 2 * (degree.get(id) ?? 0),
    color: people[id]?.alive === false ? NODE_DEAD : NODE_ALIVE,
    alive: people[id]?.alive !== false,
  }))
  return { nodes, links }
}

export type LegendRow = {
  axis: 'level' | 'type' | 'arc'
  /** what identifies this row: a colour for the arc axis, a level id or a type id otherwise */
  key: string
  swatch: string
  words: string
  /** what the mark looks like, so the legend can DRAW the encoding rather than describe it */
  dash: readonly number[] | null
  strokeCount: 1 | 2
}

const ARC_WORD: Readonly<Record<BondArc['direction'], string>> = {
  warming: 'Getting closer',
  cooling: 'Drifting apart',
  steady: 'Holding steady',
}

/** Every row says what the channel means and carries the mark it means it with, so the legend is a
 *  key rather than a paragraph. */
export function relationLegend(): LegendRow[] {
  const out: LegendRow[] = []
  for (const level of BOND_LEVELS) {
    out.push({
      axis: 'level',
      key: level,
      swatch: ARC_COLOR.steady,
      words: BOND_LEVEL_WORD[level],
      dash: null,
      strokeCount: 1,
    })
  }
  for (const type of BOND_TYPES) {
    if (type === 'none') continue // "no family tie" is the absence of a mark, not one
    out.push({
      axis: 'type',
      key: type,
      swatch: ARC_COLOR.steady,
      words: BOND_TYPE_WORD[type],
      dash: TYPE_STROKE[type].dash,
      strokeCount: TYPE_STROKE[type].strokeCount,
    })
  }
  for (const dir of ['warming', 'steady', 'cooling'] as const) {
    out.push({
      axis: 'arc',
      key: dir,
      swatch: ARC_COLOR[dir],
      words: ARC_WORD[dir],
      dash: null,
      strokeCount: 1,
    })
  }
  return out
}

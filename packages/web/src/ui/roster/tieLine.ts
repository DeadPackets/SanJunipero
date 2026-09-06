import { bondLevel, bondWarmth, type Bond, type BondLevel, type BondsResponse } from '@sj/shared'
import { bondArc, bondIndex, pairFacts, type LineageLike, type PeopleIndex } from '../bondModel2.js'

/** In the words the Bonds key uses, lower-cased for the middle of a line. Strangers and
 *  acquaintances are not a tie worth a row's one line, so they say nothing. */
const LEVEL_PHRASE: Readonly<Record<BondLevel, string | null>> = {
  strangers: null,
  acquaintances: null,
  friendly: 'friends with',
  close: 'close to',
  strained: 'strained with',
  hatred: 'set against',
}

const ARC_PHRASE = { warming: ', and warming', cooling: ', and cooling', steady: '' } as const

/** The one tie a row has room for: whichever of this person's ties carries the most feeling,
 *  warm or cold, as the Bonds page would say it. Null while every tie is still small. */
export function strongestTie(
  id: string,
  bonds: BondsResponse | null,
  nowTick: number,
  nameOf: (id: string) => string,
): string | null {
  if (bonds === null) return null
  let best: { bond: Bond; warmth: number } | null = null
  for (const bond of bonds.bonds) {
    if (bond.aId !== id && bond.bId !== id) continue
    const warmth = bondWarmth(bond, nowTick)
    if (best === null || Math.abs(warmth) > Math.abs(best.warmth)) best = { bond, warmth }
  }
  if (best === null) return null
  const phrase = LEVEL_PHRASE[bondLevel(best.warmth)]
  if (phrase === null) return null
  const other = best.bond.aId === id ? best.bond.bId : best.bond.aId
  return `${phrase} ${nameOf(other)}${ARC_PHRASE[bondArc(best.bond, nowTick).direction]}`
}

export type PairLine = { id: string; aId: string; bId: string; words: string }

/** The pairs with the most feeling between them, warm or cold, as the sentences the Bonds page
 *  already knows how to say. What that page says first, before the picture and before the key;
 *  strangers are not a thing to say. */
export function strongestPairs(
  bonds: BondsResponse,
  lineage: LineageLike,
  people: PeopleIndex,
  nowTick: number,
  n = 5,
): PairLine[] {
  const index = bondIndex(bonds)
  return bonds.bonds
    .filter((b) => b.aId in people && b.bId in people)
    .map((b) => ({ b, warmth: bondWarmth(b, nowTick) }))
    .filter(({ warmth }) => bondLevel(warmth) !== 'strangers')
    .sort((x, y) => Math.abs(y.warmth) - Math.abs(x.warmth) || (x.b.id < y.b.id ? -1 : 1))
    .slice(0, n)
    .map(({ b }) => ({
      id: b.id,
      aId: b.aId,
      bId: b.bId,
      words: pairFacts(b.aId, b.bId, index, lineage, bonds, people, nowTick).words,
    }))
}

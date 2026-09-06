import { bondLevel, bondWarmth, type Bond, type BondLevel, type BondsResponse } from '@sj/shared'
import { bondArc } from '../bondModel2.js'

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

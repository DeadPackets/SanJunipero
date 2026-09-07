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
  /** Given, a marriage the world holds speaks on a row that has no feeling to report yet. */
  lineage?: LineageLike,
): string | null {
  const married = (): string | null => {
    const e = lineage?.partnerOf?.find((x) => x.aId === id || x.bId === id)
    return e === undefined ? null : `married to ${nameOf(e.aId === id ? e.bId : e.aId)}`
  }
  if (bonds === null) return married()
  let best: { bond: Bond; warmth: number } | null = null
  for (const bond of bonds.bonds) {
    if (bond.aId !== id && bond.bId !== id) continue
    const warmth = bondWarmth(bond, nowTick)
    if (best === null || Math.abs(warmth) > Math.abs(best.warmth)) best = { bond, warmth }
  }
  if (best === null) return married()
  const phrase = LEVEL_PHRASE[bondLevel(best.warmth)]
  if (phrase === null) return married()
  const other = best.bond.aId === id ? best.bond.bId : best.bond.aId
  return `${phrase} ${nameOf(other)}${ARC_PHRASE[bondArc(best.bond, nowTick).direction]}`
}

export type PairLine = { id: string; aId: string; bId: string; words: string }

/** The pairs with the most feeling between them, warm or cold, as the sentences the Bonds page
 *  already knows how to say. What that page says first, before the picture and before the key.
 *  Strangers are not a thing to say, but a family the world holds is: the valley was founded
 *  with two marriages and two children, and on the first morning none of them had an act to
 *  their name, so the page said nobody here was more than a stranger. */
export function strongestPairs(
  bonds: BondsResponse,
  lineage: LineageLike,
  people: PeopleIndex,
  nowTick: number,
  n = 5,
): PairLine[] {
  const index = bondIndex(bonds)
  const key = (aId: string, bId: string): string => [aId, bId].sort().join('|')
  const here = (aId: string, bId: string): boolean => aId in people && bId in people
  const pairs = new Map<string, { aId: string; bId: string; warmth: number }>()
  for (const b of bonds.bonds) {
    if (!here(b.aId, b.bId)) continue
    pairs.set(key(b.aId, b.bId), { aId: b.aId, bId: b.bId, warmth: bondWarmth(b, nowTick) })
  }
  const family: string[] = []
  const hold = (aId: string, bId: string): void => {
    if (!here(aId, bId)) return
    const k = key(aId, bId)
    family.push(k)
    if (!pairs.has(k)) pairs.set(k, { aId, bId, warmth: 0 })
  }
  for (const e of lineage.partnerOf ?? []) hold(e.aId, e.bId)
  for (const e of lineage.parentOf) hold(e.parentId, e.childId)
  const held = new Set(family)
  return [...pairs]
    .filter(([k, p]) => held.has(k) || bondLevel(p.warmth) !== 'strangers')
    .sort(([ka, a], [kb, b]) => Math.abs(b.warmth) - Math.abs(a.warmth) || (ka < kb ? -1 : 1))
    .slice(0, n)
    .map(([k, p]) => ({
      id: k,
      aId: p.aId,
      bId: p.bId,
      words: pairFacts(p.aId, p.bId, index, lineage, bonds, people, nowTick).words,
    }))
}

/** Who this person is to their own family, in the order a person would say it: the one they
 *  married, the ones who made them, the ones they made. Says nothing about anybody else. */
export function familyLine(
  id: string,
  lineage: LineageLike,
  nameOf: (id: string) => string,
): string | null {
  const said: string[] = []
  const partner = lineage.partnerOf?.find((e) => e.aId === id || e.bId === id)
  if (partner !== undefined)
    said.push(`Married to ${nameOf(partner.aId === id ? partner.bId : partner.aId)}.`)
  const parents = lineage.parentOf.filter((e) => e.childId === id).map((e) => nameOf(e.parentId))
  if (parents.length > 0) said.push(`Child of ${listed(parents)}.`)
  const children = lineage.parentOf.filter((e) => e.parentId === id).map((e) => nameOf(e.childId))
  if (children.length > 0) said.push(`Parent to ${listed([...new Set(children)])}.`)
  return said.length === 0 ? null : said.join(' ')
}

const listed = (names: readonly string[]): string =>
  names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]!}`

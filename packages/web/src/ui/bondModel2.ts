import {
  BOND_ACT_OF_KIND,
  type Bond,
  type BondLevel,
  type BondsResponse,
  LEVEL_RANK,
  agentName,
  bondActCount,
  bondLevel,
  bondRollup,
  bondWarmth,
  tickToMoment,
} from '@sj/shared'

// Warmth, the level thresholds and the valence table live in `@sj/shared`: the reader is handed
// the folded scalar, not the acts, and `decayWarmth` carries it forward exactly.
export {
  BOND_LEVELS,
  BOND_VALENCE,
  LEVEL_RANK,
  LEVEL_THRESHOLDS,
  WARMTH_HALF_LIFE_TICKS,
  bondLevel,
  bondWarmth,
  type BondLevel,
} from '@sj/shared'

/** The endpoint records a `BondKind`; the plan names the ACT. The table is the contract's. */
export const ACT_OF_BOND_KIND = BOND_ACT_OF_KIND

// Two INDEPENDENT axes over the history the endpoint returns. TYPE is structural — a fact the
// world recorded, and a pair has at most one. LEVEL is valenced and decayed, so it can go DOWN.

// ── TYPE ───────────────────────────────────────────────────────────────────────────────────

export const BOND_TYPES = ['partner', 'parent', 'child', 'sibling', 'none'] as const
export type BondType = (typeof BOND_TYPES)[number]

export const BOND_TYPE_WORD: Readonly<Record<BondType, string>> = {
  partner: 'Partners',
  parent: 'Parent',
  child: 'Child',
  sibling: 'Siblings',
  none: '',
}

export const NODE_ALIVE = '#93B573'
export const NODE_DEAD = '#857D75'

export type PeopleIndex = Readonly<Record<string, { name: string; alive: boolean }>>
export type BondNode = { id: string; name: string; size: number; color: string; alive: boolean }

/** What the lineage endpoint returns. Structural, so the viewer needs no import from the
 *  gateway (P1) and a typed empty is a perfectly good answer. */
export type LineageLike = {
  parentOf: readonly { parentId: string; childId: string; tick: number }[]
}
export const EMPTY_LINEAGE: LineageLike = { parentOf: [] }

const parentsOf = (id: string, lineage: LineageLike): Set<string> =>
  new Set(lineage.parentOf.filter((e) => e.childId === id).map((e) => e.parentId))

const bondBetween = (aId: string, bId: string, bonds: BondsResponse): Bond | null =>
  bonds.bonds.find((b) => (b.aId === aId && b.bId === bId) || (b.aId === bId && b.bId === aId)) ??
  null

/** Every pair the world has a bond for, keyed both ways round. Built ONCE by a caller that is
 *  about to ask about many pairs: the linear scan above is n² × m inside a matrix. */
export type BondIndex = ReadonlyMap<string, Bond>
const pairKey = (aId: string, bId: string): string =>
  aId < bId ? `${aId}\t${bId}` : `${bId}\t${aId}`

export function bondIndex(bonds: BondsResponse): BondIndex {
  const out = new Map<string, Bond>()
  for (const b of bonds.bonds) out.set(pairKey(b.aId, b.bId), b)
  return out
}

/** Where one pair stands, in every channel the two pictures draw. The `arc` of a pair the world
 *  has never written is steady at their level, which is strangers — not a gap. */
export type PairFacts = {
  bond: Bond | null
  warmth: number
  level: BondLevel
  type: BondType
  arc: BondArc
  words: string
}

export function pairFacts(
  aId: string,
  bId: string,
  index: BondIndex,
  lineage: LineageLike,
  bonds: BondsResponse,
  people: PeopleIndex,
  nowTick: number,
): PairFacts {
  const bond = index.get(pairKey(aId, bId)) ?? null
  const warmth = bond === null ? 0 : bondWarmth(bond, nowTick)
  const level = bondLevel(warmth)
  const type = bondTypeOf(aId, bId, lineage, bonds)
  const arc: BondArc =
    bond === null
      ? { from: level, to: level, direction: 'steady', sinceDay: 0 }
      : bondArc(bond, nowTick)
  return {
    bond,
    warmth,
    level,
    type,
    arc,
    words: relationLine(type, level, arc, [agentName(people, aId), agentName(people, bId)]),
  }
}

/**
 * Directional, because "parent" and "child" are the same edge read from two ends. KIN OUTRANKS
 * PARTNER: a birth is a fact the world wrote down, a partnership is inferred from who slept where.
 */
export function bondTypeOf(
  aId: string,
  bId: string,
  lineage: LineageLike,
  bonds: BondsResponse,
): BondType {
  if (aId === bId) return 'none'
  if (lineage.parentOf.some((e) => e.parentId === aId && e.childId === bId)) return 'parent'
  if (lineage.parentOf.some((e) => e.parentId === bId && e.childId === aId)) return 'child'
  const mine = parentsOf(aId, lineage)
  if (mine.size > 0) {
    for (const p of parentsOf(bId, lineage)) if (mine.has(p)) return 'sibling'
  }
  const bond = bondBetween(aId, bId, bonds)
  // The rollup counts EVERY night the pair kept house, so a marriage older than the 24-act
  // window is still a marriage — which a truncated list on its own could not have said.
  return bond !== null && bondActCount(bond, 'partner') > 0 ? 'partner' : 'none'
}

/** Shared roofs after which the line can name the day it began rather than saying "lately". */
export const SPOUSE_NIGHTS = 14

/**
 * A partnership is presented as romantic AND its evidence shown beside it: the word "married"
 * appears only if the world recorded it, and the world records nights, not weddings.
 */
export function partnerEvidence(b: Bond): string | null {
  const nights = bondRollup(b, 'partner')
  if (nights === null) return null
  if (nights.count < SPOUSE_NIGHTS) return 'They have shared a roof lately.'
  return `They have shared a roof since Day ${tickToMoment(nights.firstTick).day}.`
}

// ── LEVEL ──────────────────────────────────────────────────────────────────────────────────

export const BOND_LEVEL_WORD: Readonly<Record<BondLevel, string>> = {
  strangers: 'Strangers',
  acquaintances: 'Acquaintances',
  friendly: 'Friends',
  close: 'Close',
  strained: 'Strained',
  hatred: 'Hatred',
}

const rankOf = (l: BondLevel): number => LEVEL_RANK.indexOf(l)

// ── THE ARC (P22.5): what this relationship has DONE, not only where it stands ─────────────

export type BondArc = {
  from: BondLevel
  to: BondLevel
  direction: 'warming' | 'cooling' | 'steady'
  /** the day the level last changed; the day it began when it never has */
  sinceDay: number
}

/**
 * Three reads of a server-folded summary: `priorWarmth` is where the pair stood a half-life ago
 * and `levelChangedTick` is when the level last moved. Re-summing the history here was O(acts²).
 */
export function bondArc(bond: Bond, nowTick: number): BondArc {
  const from = bondLevel(bond.priorWarmth)
  const to = bondLevel(bondWarmth(bond, nowTick))
  const direction =
    rankOf(to) > rankOf(from) ? 'warming' : rankOf(to) < rankOf(from) ? 'cooling' : 'steady'
  return { from, to, direction, sinceDay: tickToMoment(bond.levelChangedTick).day }
}

// ── THE SENTENCE A VIEWER READS ────────────────────────────────────────────────────────────

/** Type first when there is one, level always, arc when it moved. */
const TYPE_CLAUSE: Readonly<Record<BondType, (a: string, b: string) => string>> = {
  partner: (a, b) => `${a} and ${b} are partners`,
  parent: (a, b) => `${a} is ${b}’s parent`,
  child: (a, b) => `${a} is ${b}’s child`,
  sibling: (a, b) => `${a} and ${b} are siblings`,
  none: (a, b) => `${a} and ${b}`,
}

const LEVEL_CLAUSE: Readonly<Record<BondLevel, string>> = {
  strangers: 'are strangers to each other',
  acquaintances: 'know each other a little',
  friendly: 'are friends',
  close: 'are close',
  strained: 'are strained with one another',
  hatred: 'are set against each other',
}

const ARC_CLAUSE: Readonly<Record<BondArc['direction'], string | null>> = {
  warming: 'Warming since Day',
  cooling: 'Cooling since Day',
  steady: null,
}

export function relationLine(
  type: BondType,
  level: BondLevel,
  arc: BondArc,
  names: [string, string],
): string {
  const [a, b] = names
  const head =
    type === 'none'
      ? `${TYPE_CLAUSE.none(a, b)} ${LEVEL_CLAUSE[level]}.`
      : `${TYPE_CLAUSE[type](a, b)}, and they ${LEVEL_CLAUSE[level]}.`
  const arcWords = ARC_CLAUSE[arc.direction]
  return arcWords === null ? head : `${head} ${arcWords} ${arc.sinceDay}.`
}

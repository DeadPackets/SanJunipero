import {
  BOND_ACT_OF_KIND, BOND_LEVELS, BOND_VALENCE, LEVEL_RANK, LEVEL_THRESHOLDS,
  WARMTH_HALF_LIFE_TICKS, bondActCount, bondLevel, bondRollup, bondWarmth, tickToMoment,
  type Bond, type BondLevel, type BondsResponse,
} from '@sj/shared'

// ★ THE MODEL MOVED HALFWAY TO THE SERVER, AND ONLY BECAUSE THE HISTORY DID.
//
// Warmth, the level thresholds and the valence table now live in `@sj/shared`: the reader is no
// longer handed the acts, so the fold happens once on the server and the reader decays the
// scalar forward. `decayWarmth` makes that EXACT rather than approximate — see the identity in
// `shared/src/bonds.ts`. What stays here is everything a viewer reads and a server never should:
// the type axis, the words, and the arc's presentation.
export {
  BOND_LEVELS, BOND_VALENCE, LEVEL_RANK, LEVEL_THRESHOLDS, WARMTH_HALF_LIFE_TICKS,
  bondLevel, bondWarmth, type BondLevel,
} from '@sj/shared'

/** The endpoint records a `BondKind`; the plan names the ACT. The table is the contract's. */
export const ACT_OF_BOND_KIND = BOND_ACT_OF_KIND

// RELATIONSHIPS HAVE A KIND AND A TEMPERATURE, AND THE TEMPERATURE CAN FALL (U15, P22).
//
// THE ASK, verbatim: "It must express LEVELS — strangers, acquaintances, friends, hatred — AND
// TYPES — romantic (spouse counts as romantic), sibling, parent-child."
//
// WHY THE LANDED MODEL CANNOT: one kind per pair collapsed by precedence, with `strength` as an
// UNSIGNED interaction count. Any two people who once spoke in earshot are labelled `friend`;
// `kin` fuses parent-child with sibling; and "strangers" is inexpressible, because an unlinked
// person is not even a node in the graph. Hatred is unreachable by construction — that is the
// bug, and an unsigned counter is why.
//
// THE MODEL: two INDEPENDENT axes over the history the endpoint already returns.
//   TYPE  is structural — a fact the world recorded. A pair has at most one.
//   LEVEL is valenced and decayed — it can go down, which is what makes it a relationship
//         rather than a counter.
// This is a pure READER. No engine or gateway type moves.

// ── TYPE ───────────────────────────────────────────────────────────────────────────────────

export const BOND_TYPES = ['partner', 'parent', 'child', 'sibling', 'none'] as const
export type BondType = (typeof BOND_TYPES)[number]

export const BOND_TYPE_WORD: Readonly<Record<BondType, string>> = {
  partner: 'Partners', parent: 'Parent', child: 'Child', sibling: 'Siblings', none: '',
}

/** What the lineage endpoint returns. Structural, so the viewer needs no import from the
 *  gateway (P1) and a typed empty is a perfectly good answer. */
export type LineageLike = {
  parentOf: ReadonlyArray<{ parentId: string; childId: string; tick: number }>
}
export const EMPTY_LINEAGE: LineageLike = { parentOf: [] }

const parentsOf = (id: string, lineage: LineageLike): Set<string> =>
  new Set(lineage.parentOf.filter((e) => e.childId === id).map((e) => e.parentId))

const bondBetween = (aId: string, bId: string, bonds: BondsResponse): Bond | null =>
  bonds.bonds.find((b) => (b.aId === aId && b.bId === bId) || (b.aId === bId && b.bId === aId)) ?? null

/**
 * Directional, because "parent" and "child" are the same edge read from two ends.
 *
 * KIN OUTRANKS PARTNER, deliberately: a birth is a fact the world wrote down and a partnership
 * is inferred from who slept under the same roof. When the two disagree, the recorded fact wins.
 */
export function bondTypeOf(
  aId: string, bId: string, lineage: LineageLike, bonds: BondsResponse,
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
 * The user's ruling is "romantic (spouse counts as romantic)" — so a partnership is presented
 * as one AND its evidence is shown beside it. The naming law (P12) still holds: the word
 * "married" appears only if the world recorded it, and the world records nights, not weddings.
 */
export function partnerEvidence(b: Bond): string | null {
  const nights = bondRollup(b, 'partner')
  if (nights === null) return null
  if (nights.count < SPOUSE_NIGHTS) return 'They have shared a roof lately.'
  return `They have shared a roof since Day ${tickToMoment(nights.firstTick).day}.`
}

// ── LEVEL ──────────────────────────────────────────────────────────────────────────────────

export const BOND_LEVEL_WORD: Readonly<Record<BondLevel, string>> = {
  strangers: 'Strangers', acquaintances: 'Acquaintances', friendly: 'Friends',
  close: 'Close', strained: 'Strained', hatred: 'Hatred',
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
 * ★ THREE READS OF A SUMMARY, WHERE THIS USED TO BE O(acts²) IN THE BROWSER.
 *
 * It found `sinceDay` by re-summing the history at every distinct tick — a nested walk, per
 * link, per render, over a history that reached six figures per bond. The server folds the same
 * answer forward in one pass; `priorWarmth` is where the pair stood a half-life ago and
 * `levelChangedTick` is when the level last moved.
 */
export function bondArc(bond: Bond, nowTick: number): BondArc {
  const from = bondLevel(bond.priorWarmth)
  const to = bondLevel(bondWarmth(bond, nowTick))
  const direction = rankOf(to) > rankOf(from) ? 'warming'
    : rankOf(to) < rankOf(from) ? 'cooling'
      : 'steady'
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
  warming: 'Warming since Day', cooling: 'Cooling since Day', steady: null,
}

export function relationLine(
  type: BondType, level: BondLevel, arc: BondArc, names: [string, string],
): string {
  const [a, b] = names
  const head = type === 'none'
    ? `${TYPE_CLAUSE.none(a, b)} ${LEVEL_CLAUSE[level]}.`
    : `${TYPE_CLAUSE[type](a, b)}, and they ${LEVEL_CLAUSE[level]}.`
  const arcWords = ARC_CLAUSE[arc.direction]
  return arcWords === null ? head : `${head} ${arcWords} ${arc.sinceDay}.`
}

import { tickToMoment, type Bond, type BondEvent, type BondKind, type BondsResponse } from '@sj/shared'

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
  return bond !== null && bond.history.some((h) => actOf(h) === 'co_slept') ? 'partner' : 'none'
}

/** Shared roofs after which the line can name the day it began rather than saying "lately". */
export const SPOUSE_NIGHTS = 14

/**
 * The user's ruling is "romantic (spouse counts as romantic)" — so a partnership is presented
 * as one AND its evidence is shown beside it. The naming law (P12) still holds: the word
 * "married" appears only if the world recorded it, and the world records nights, not weddings.
 */
export function partnerEvidence(b: Bond): string | null {
  const nights = b.history.filter((h) => actOf(h) === 'co_slept')
  if (nights.length === 0) return null
  if (nights.length < SPOUSE_NIGHTS) return 'They have shared a roof lately.'
  return `They have shared a roof since Day ${tickToMoment(nights[0]!.tick).day}.`
}

// ── LEVEL ──────────────────────────────────────────────────────────────────────────────────

export const BOND_LEVELS =
  ['strangers', 'acquaintances', 'friendly', 'close', 'strained', 'hatred'] as const
export type BondLevel = (typeof BOND_LEVELS)[number]

export const BOND_LEVEL_WORD: Readonly<Record<BondLevel, string>> = {
  strangers: 'Strangers', acquaintances: 'Acquaintances', friendly: 'Friends',
  close: 'Close', strained: 'Strained', hatred: 'Hatred',
}

/** Signed weight per recorded act. The NEGATIVE half is what makes a level a relationship
 *  rather than a counter, and it is the only reason "hatred" is reachable at all. */
export const BOND_VALENCE: Readonly<Record<string, number>> = {
  spoke: 1, teach: 2, give: 3, co_slept: 4, born: 0, attack: -8,
}

/**
 * The acts above are how the plan names them; the endpoint records a `BondKind`, and in the
 * landed gateway the two are one-to-one — one rule per verb, one kind per rule. This is the
 * translation, written down rather than assumed, so a future writer that records the act
 * directly also works.
 */
export const ACT_OF_BOND_KIND: Readonly<Record<BondKind, string>> = {
  friend: 'spoke', work: 'teach', owe: 'give', partner: 'co_slept', kin: 'born', rival: 'attack',
}

function actOf(h: BondEvent): string {
  return BOND_VALENCE[h.kind] !== undefined
    ? h.kind
    : ACT_OF_BOND_KIND[h.kind as BondKind] ?? h.kind
}

/**
 * A friendship needs keeping up: silence costs warmth, which is what lets a level FALL without
 * anybody doing anything wrong.
 *
 * MEASURED CORRECTION to the plan, which calls this constant "one sim-day": a tick is a
 * sim-MINUTE and `MINUTES_PER_DAY` is 1440, so 2880 ticks is **two** sim-days. The value is
 * kept — two days of silence to halve a warmth is the gentler and better-behaved of the two
 * readings — and the comment is corrected rather than the number.
 */
export const WARMTH_HALF_LIFE_TICKS = 2880

/** Deterministic and order-independent — a sum is commutative, and two reads of one history
 *  at one tick can never disagree. */
export function bondWarmth(history: readonly BondEvent[], nowTick: number): number {
  let sum = 0
  for (const h of history) {
    const w = BOND_VALENCE[actOf(h)]
    if (w === undefined) continue
    const age = Math.max(0, nowTick - h.tick)
    sum += w * Math.pow(0.5, age / WARMTH_HALF_LIFE_TICKS)
  }
  return sum
}

/** Ascending in warmth: the first row whose ceiling the warmth is at or under. */
export const LEVEL_THRESHOLDS: ReadonlyArray<{ at: number; level: BondLevel }> = [
  { at: -12, level: 'hatred' }, { at: -3, level: 'strained' }, { at: 2, level: 'strangers' },
  { at: 8, level: 'acquaintances' }, { at: 20, level: 'friendly' }, { at: Infinity, level: 'close' },
]

/** Coldest to warmest — the one order that says whether a relationship went up or down. */
export const LEVEL_RANK: readonly BondLevel[] = LEVEL_THRESHOLDS.map((t) => t.level)

export function bondLevel(warmth: number): BondLevel {
  for (const t of LEVEL_THRESHOLDS) if (warmth <= t.at) return t.level
  return 'close'
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

export function bondArc(
  history: readonly BondEvent[], nowTick: number, windowTicks: number = WARMTH_HALF_LIFE_TICKS,
): BondArc {
  const then = Math.max(0, nowTick - windowTicks)
  const past = history.filter((h) => h.tick <= then)
  const from = bondLevel(bondWarmth(past, then))
  const to = bondLevel(bondWarmth(history, nowTick))

  // the last tick at which the level was different from what it is now
  const ticks = [...new Set(history.map((h) => h.tick))].sort((a, b) => a - b)
  let changedAt = ticks[0] ?? 0
  let prev: BondLevel | null = null
  for (const t of ticks) {
    const at = bondLevel(bondWarmth(history.filter((h) => h.tick <= t), t))
    if (prev !== null && at !== prev) changedAt = t
    prev = at
  }

  const direction = rankOf(to) > rankOf(from) ? 'warming'
    : rankOf(to) < rankOf(from) ? 'cooling'
      : 'steady'
  return { from, to, direction, sinceDay: tickToMoment(changedAt).day }
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

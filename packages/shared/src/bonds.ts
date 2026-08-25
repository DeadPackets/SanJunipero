import { z } from 'zod'

export const BOND_KINDS = ['partner', 'kin', 'friend', 'rival', 'owe', 'work'] as const
export const BondKindSchema = z.enum(BOND_KINDS)
export type BondKind = z.infer<typeof BondKindSchema>

/** One recorded act between two people. `note` is NOT on the wire: it is `BOND_NOTES` keyed by
 *  the act, the table is right here, and a sentence repeated a hundred thousand times is the
 *  single largest thing the old feed spent its bytes on. */
export const BondActSchema = z.object({
  tick: z.number().int().nonnegative(),
  kind: BondKindSchema,
}).strict()
export type BondAct = z.infer<typeof BondActSchema>

/**
 * ★ THE CEILING. How many acts a bond carries on the wire, whatever the town's age.
 *
 * The feed used to carry EVERY act that ever formed a tie: 83 704 521 B at sim-day 20 of a
 * talkative town, growing without limit, on a surface handed to strangers and polled every
 * 30 s per viewer. A bond now carries the last `BOND_RECENT_ACTS` of them plus a whole-history
 * rollup, so the body is O(pairs), not O(pairs × history).
 *
 * 24 because the detail panel shows a scrolling column and a viewer reads the top of it; the
 * rollup below says how many there were in total, which is the number the list could never say
 * without being unreadable.
 */
export const BOND_RECENT_ACTS = 24

/** Whole-history totals for one kind of act — at most one row per `BOND_KINDS`, so six. */
export const BondRollupSchema = z.object({
  kind: BondKindSchema,
  count: z.number().int().positive(),
  firstTick: z.number().int().nonnegative(),
  lastTick: z.number().int().nonnegative(),
}).strict()
export type BondRollup = z.infer<typeof BondRollupSchema>

export const BondSchema = z.object({
  id: z.string().min(1),                       // bondId(a, b) — the same name from either side
  aId: z.string().min(1),
  bId: z.string().min(1),
  kind: BondKindSchema,
  strength: z.number().min(0),                 // every act ever recorded, counted
  formedTick: z.number().int().nonnegative(),
  lastUpdatedTick: z.number().int().nonnegative(),
  /** The newest `BOND_RECENT_ACTS` acts, oldest first. `.max` is the ceiling, enforced by the
   *  parser: a body that outgrows it does not parse, on either side of the wire. */
  recent: z.array(BondActSchema).max(BOND_RECENT_ACTS),
  /** What the window cannot say: how many of each act there were, and when each began. */
  acts: z.array(BondRollupSchema).max(BOND_KINDS.length),
  /** Decayed valence over the WHOLE history, evaluated at `lastUpdatedTick`. Exponential decay
   *  is separable, so `decayWarmth(warmth, lastUpdatedTick, now)` is the exact warmth at any
   *  later tick — the reader loses no precision by not holding the acts. */
  warmth: z.number(),
  /** The same, restricted to acts at or before `asOfTick − WARMTH_HALF_LIFE_TICKS` and
   *  evaluated there: where this relationship stood a half-life ago, which is the arc's "from". */
  priorWarmth: z.number(),
  /** The tick the level last changed; the tick it began when it never has. The arc's "since". */
  levelChangedTick: z.number().int().nonnegative(),
}).strict()
export type Bond = z.infer<typeof BondSchema>

export const BondsResponseSchema = z.object({
  bonds: z.array(BondSchema),
  asOfTick: z.number().int().nonnegative(),
}).strict()
export type BondsResponse = z.infer<typeof BondsResponseSchema>

/** What `/api/bonds/count` answers — a badge showing one number may not ask for the feed. */
export const BondsCountSchema = z.object({
  count: z.number().int().nonnegative(),
  asOfTick: z.number().int().nonnegative(),
}).strict()
export type BondsCount = z.infer<typeof BondsCountSchema>

/**
 * ★ THE SIX ACTS A TIE IS DERIVED FROM, and the whole of them. `buildBonds` reads the record
 * for exactly these; a bond count of zero IS "none of these six has been recorded", which is
 * what lets the Bonds panel's empty state DESCRIBE instead of promise. Here rather than in the
 * gateway because the viewer has to be able to name them without reading the server.
 */
export const BOND_NOTES: Readonly<Record<string, string>> = {
  spoke: 'spoke together',
  give: 'gave something away',
  teach: 'taught something',
  attack: 'came to blows',
  co_slept: 'kept house together',
  born: 'parent and child',
}

/** The endpoint records a `BondKind`; the plan names the ACT. One rule per verb, one kind per
 *  rule, so the two are one-to-one — written down rather than assumed. */
export const BOND_ACT_OF_KIND: Readonly<Record<BondKind, string>> = {
  friend: 'spoke', work: 'teach', owe: 'give', partner: 'co_slept', kin: 'born', rival: 'attack',
}

/** The sentence the panel prints for an act, built from the table instead of shipped with it. */
export const bondNote = (kind: BondKind): string => BOND_NOTES[BOND_ACT_OF_KIND[kind]]!

export function bondId(a: string, b: string): string {
  return [a, b].sort().join('|')
}

// One bond per pair, so its kind has to be decided when two people are several things at
// once. Closest claim wins and the history keeps everything: a couple who also traded are
// still a couple, and a fight outranks a shift worked side by side.
export const BOND_KIND_PRECEDENCE: readonly BondKind[] = ['partner', 'kin', 'rival', 'owe', 'work', 'friend']

export function strongerBondKind(a: BondKind, b: BondKind): BondKind {
  return BOND_KIND_PRECEDENCE.indexOf(a) <= BOND_KIND_PRECEDENCE.indexOf(b) ? a : b
}

// ── WARMTH: the one derivation, now that BOTH ends of the wire need it ─────────────────────
//
// It used to live in the viewer, over a history the viewer was handed. The history is no longer
// handed over, so the fold happens once on the server and the reader decays the scalar forward.
// One table, one half-life, one threshold list — a second copy is how the two ends disagree.

/** Signed weight per recorded act. The NEGATIVE half is what makes a level a relationship
 *  rather than a counter, and it is the only reason "hatred" is reachable at all. */
export const BOND_VALENCE: Readonly<Record<BondKind, number>> = {
  friend: 1, work: 2, owe: 3, partner: 4, kin: 0, rival: -8,
}

/**
 * A friendship needs keeping up: silence costs warmth, which is what lets a level FALL without
 * anybody doing anything wrong. A tick is a sim-MINUTE and `MINUTES_PER_DAY` is 1440, so this
 * is two sim-days.
 */
export const WARMTH_HALF_LIFE_TICKS = 2880

/** Exponential decay is separable — `Σ wᵢ·2^-((t−tᵢ)/H) = 2^-((t−T)/H) · Σ wᵢ·2^-((T−tᵢ)/H)` —
 *  so one scalar at `fromTick` is the exact warmth at every later tick. This is the identity
 *  that lets a bounded body carry an unbounded history's warmth without rounding it. */
export function decayWarmth(warmth: number, fromTick: number, toTick: number): number {
  return warmth * Math.pow(0.5, Math.max(0, toTick - fromTick) / WARMTH_HALF_LIFE_TICKS)
}

/** The reference sum, over acts held in hand. The server folds incrementally instead; this is
 *  what that fold must agree with, and what the model's own tests are written against. */
export function warmthOf(acts: readonly BondAct[], atTick: number): number {
  let sum = 0
  for (const a of acts) sum += decayWarmth(BOND_VALENCE[a.kind], a.tick, atTick)
  return sum
}

export const BOND_LEVELS =
  ['strangers', 'acquaintances', 'friendly', 'close', 'strained', 'hatred'] as const
export type BondLevel = (typeof BOND_LEVELS)[number]

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

/** Warmth at `nowTick`, from the summary alone. Exact — see `decayWarmth`. */
export function bondWarmth(bond: Bond, nowTick: number): number {
  return decayWarmth(bond.warmth, bond.lastUpdatedTick, nowTick)
}

/** How many of one act this tie is made of, over the whole history the window cannot hold. */
export function bondActCount(bond: Bond, kind: BondKind): number {
  return bond.acts.find((a) => a.kind === kind)?.count ?? 0
}

export function bondRollup(bond: Bond, kind: BondKind): BondRollup | null {
  return bond.acts.find((a) => a.kind === kind) ?? null
}

// ── THE FOLD ───────────────────────────────────────────────────────────────────────────────

export type BondFold = {
  /** Ticks must not go backwards — the caller reads the log in `seq` order, which is tick order. */
  add(kind: BondKind, tick: number): void
  acts(): number
  bond(): Bond
}

/**
 * ★ ONE ACT IN, CONSTANT MEMORY OUT.
 *
 * Everything the contract carries is a running value: a 24-deep window, six rollup rows, three
 * scalars. Nothing here grows with how long the town has been running, which is the whole of
 * why the feed has a ceiling now.
 *
 * `levelChangedTick` is the reason this is a fold and not a formula. The reader used to find it
 * by re-summing the history at every distinct tick — O(acts²) IN THE BROWSER, per link, per
 * render, over a history that reached six figures. Folding forward gives the same answer in one
 * pass, and the pass happens once on the server rather than once per viewer per frame.
 */
export function foldBond(aId: string, bId: string, asOfTick: number): BondFold {
  const [lo, hi] = [aId, bId].sort() as [string, string]
  const id = bondId(aId, bId)
  const priorAt = Math.max(0, asOfTick - WARMTH_HALF_LIFE_TICKS)

  let kind: BondKind = 'friend'
  let first = true
  const rolls = new Map<BondKind, { count: number; firstTick: number; lastTick: number }>()
  const recent: BondAct[] = []
  let count = 0
  let formedTick = 0
  let lastTick = 0

  let warmth = 0                 // running, evaluated at `lastTick`
  let prior = 0                  // the same, over acts at or before `priorAt`
  let priorFrom = 0
  // the level as at the end of the last CLOSED tick, and when it last differed
  let closedLevel: BondLevel | null = null
  let levelChangedTick = 0
  let openTick = -1

  const closeTick = (): void => {
    if (openTick < 0) return
    const at = bondLevel(warmth)
    if (closedLevel !== null && at !== closedLevel) levelChangedTick = openTick
    closedLevel = at
    openTick = -1
  }

  return {
    add(k, tick) {
      if (first) { kind = k; formedTick = tick; levelChangedTick = tick; first = false }
      else kind = strongerBondKind(kind, k)

      if (tick !== openTick) closeTick()

      warmth = decayWarmth(warmth, lastTick, tick) + BOND_VALENCE[k]
      lastTick = tick
      openTick = tick

      if (tick <= priorAt) {
        prior = decayWarmth(prior, priorFrom, tick) + BOND_VALENCE[k]
        priorFrom = tick
      }

      const roll = rolls.get(k)
      if (roll === undefined) rolls.set(k, { count: 1, firstTick: tick, lastTick: tick })
      else { roll.count += 1; roll.lastTick = tick }

      recent.push({ tick, kind: k })
      if (recent.length > BOND_RECENT_ACTS) recent.shift()
      count += 1
    },
    acts: () => count,
    bond() {
      closeTick()
      return {
        id, aId: lo, bId: hi, kind,
        strength: count,
        formedTick,
        lastUpdatedTick: lastTick,
        recent: [...recent],
        acts: BOND_KINDS.flatMap((k) => {
          const r = rolls.get(k)
          return r === undefined ? [] : [{ kind: k, count: r.count, firstTick: r.firstTick, lastTick: r.lastTick }]
        }),
        warmth,
        priorWarmth: decayWarmth(prior, priorFrom, priorAt),
        levelChangedTick,
      }
    },
  }
}

/** The same fold over acts already in hand — the gateway streams, everything else has a list. */
export function bondFrom(
  aId: string, bId: string, acts: readonly BondAct[], asOfTick: number,
): Bond {
  const fold = foldBond(aId, bId, asOfTick)
  for (const a of [...acts].sort((x, y) => x.tick - y.tick)) fold.add(a.kind, a.tick)
  return fold.bond()
}

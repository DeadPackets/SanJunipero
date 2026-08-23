// ★ A PLOT IS A CLAIMABLE THING.
//
// Agents build. When one does, it claims a free plot and stands a building on it — it never
// chooses a coordinate, so it cannot choose a bad one. Every invariant `townGrammar` proves
// about the plot lattice is therefore true of every town any sequence of agent builds can
// reach, in any order, forever. The spacing holds BY CONSTRUCTION and not by hope.
//
// THE THREE RULINGS THIS FILE MAKES, and why:
//
//   CLAIMABLE   free, platted, and big enough. "Free" is read off the buildings that stand in
//               the town, never off a register: a register is a second source of truth that
//               can drift from the world, and this one would drift on every crash recovery.
//   ORDER       the free plot nearest the square, ties broken by block then slot. So the town
//               DENSIFIES BEFORE IT SPRAWLS, and the choice is pure — replay depends on it.
//   PLATTING    a ring plats the moment the platted area holds no plot the builder can use,
//               and never before. Growth is monotone: platting ring R+1 withdraws nothing
//               ring R offered, so a claim made on day one is still valid a hundred days on.
import {
  MAX_ALONG, MAX_DEEP, freePlots, place, type Ground, type PlacedStructure, type Plot,
} from './townGrammar.js'

/** How far the town may plat looking for a claimable plot before it admits there is none.
 *  A guard against an unbuildable ground, not a size limit: the town is as large as it has
 *  grown, and nothing here caps that. */
export const CLAIM_RING_LIMIT = 24

export type PlotRef = { block: { i: number; j: number }; slot: string }
export type Need = { along: number; deep: number }

export const plotKey = (p: PlotRef): string => `${p.block.i},${p.block.j}/${p.slot}`

export const plotRefOf = (p: PlotRef): PlotRef => ({ block: { ...p.block }, slot: p.slot })

/** Which plots are spoken for, read off the town itself. */
export function takenPlots(standing: readonly PlotRef[]): Set<string> {
  return new Set(standing.map(plotKey))
}

export function isClaimable(plot: Plot, need: Need, taken: ReadonlySet<string>): boolean {
  return holds(plot, need) && !taken.has(plotKey(plot))
}

/** Big enough, before anything is asked about who holds it. */
const holds = (plot: Plot, need: Need): boolean =>
  need.along >= 1 && need.deep >= 1 && need.along <= plot.maxAlong && need.deep <= plot.maxDeep

const fits = (need: Need): boolean =>
  need.along >= 1 && need.deep >= 1 && need.along <= MAX_ALONG && need.deep <= MAX_DEEP

/** How many rings the town must have platted for this builder to have somewhere to go. */
export function ringsPlatted(taken: ReadonlySet<string>, ground: Ground, need: Need): number {
  return ringsPlattedWhere((p) => taken.has(plotKey(p)), ground, need)
}

/** The plot the next building goes on, and the ring count the town stands at once it does. */
export function claimPlot(a: {
  taken: ReadonlySet<string>
  ground: Ground
  need: Need
}): { plot: Plot; rings: number } | null {
  return claimPlotWhere({ isTaken: (p) => a.taken.has(plotKey(p)), ground: a.ground, need: a.need })
}

// ★ WHO HOLDS A PLOT IS A QUESTION, NOT A REGISTER.
//
// `claimAll` knows the plots it has just handed out and can answer with a set of keys. A
// RUNNING WORLD cannot: what stands in it is a list of rectangles, some of them raised by the
// grammar and some of them — a bridge, a grave, a thing an arbiter minted — never platted at
// all. So the claim takes a PREDICATE and the caller answers however it can see. The two
// callers below and `townPlot.ts` are the whole of it, and the set-of-keys reading is now one
// predicate among several rather than the only shape a claim understands.

export type IsTaken = (plot: Plot) => boolean

export function ringsPlattedWhere(isTaken: IsTaken, ground: Ground, need: Need): number {
  return claimPlotWhere({ isTaken, ground, need })?.rings ?? CLAIM_RING_LIMIT
}

/** One walk outward, not two: the ring the town has to reach and the plot it offers there are
 *  the same answer, and `plattedBlocks` is the expensive part of asking. */
export function claimPlotWhere(a: { isTaken: IsTaken; ground: Ground; need: Need }): { plot: Plot; rings: number } | null {
  if (!fits(a.need)) return null
  for (let r = 1; r < CLAIM_RING_LIMIT; r++) {
    const plot = freePlots(r, a.ground).find((p) => holds(p, a.need) && !a.isTaken(p))
    if (plot !== undefined) return { plot, rings: r }
  }
  return null
}

export type Wanted = { kind: string; along: number; deep: number; owner: string | null }

/** Raise a list of buildings, each on its own claim, starting from a town already standing.
 *  This is the ONE function that builds a town — the genesis nine and the thirtieth thing an
 *  agent puts up go through it, so there is no special case for the start. */
export function claimAll(a: {
  ground: Ground
  wanted: readonly Wanted[]
  standing?: readonly PlacedStructure[]
}): { built: PlacedStructure[]; rings: number } {
  const standing = a.standing ?? []
  const taken = takenPlots(standing)
  const built: PlacedStructure[] = []
  let rings = 1
  for (const w of a.wanted) {
    const c = claimPlot({ taken, ground: a.ground, need: { along: w.along, deep: w.deep } })
    if (c === null) break
    taken.add(plotKey(c.plot))
    rings = Math.max(rings, c.rings)
    built.push(place(c.plot, w.kind, w.along, w.deep, w.owner))
  }
  return { built, rings }
}

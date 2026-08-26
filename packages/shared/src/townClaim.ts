// Free is read off standing buildings, never a register that could drift on crash recovery.
// Order is the plot nearest the square, block then slot — pure, because replay depends on it.
import {
  MAX_ALONG,
  MAX_DEEP,
  freePlots,
  place,
  type Ground,
  type PlacedStructure,
  type Plot,
} from './townGrammar.js'

/** How far the town may plat looking for a claimable plot before it admits there is none. A
 *  guard against unbuildable ground, not a size limit: nothing here caps how large a town grows. */
export const CLAIM_RING_LIMIT = 24

export type PlotRef = { block: { i: number; j: number }; slot: string }
export type Need = { along: number; deep: number }

export const plotKey = (p: PlotRef): string => `${p.block.i},${p.block.j}/${p.slot}`

/** Which plots are spoken for, read off the town itself. */
export function takenPlots(standing: readonly PlotRef[]): Set<string> {
  return new Set(standing.map(plotKey))
}

/** Big enough, before anything is asked about who holds it. */
const holds = (plot: Plot, need: Need): boolean =>
  need.along >= 1 && need.deep >= 1 && need.along <= plot.maxAlong && need.deep <= plot.maxDeep

const fits = (need: Need): boolean =>
  need.along >= 1 && need.deep >= 1 && need.along <= MAX_ALONG && need.deep <= MAX_DEEP

/** The plot the next building goes on, and the ring count the town stands at once it does. */
export function claimPlot(a: {
  taken: ReadonlySet<string>
  ground: Ground
  need: Need
}): { plot: Plot; rings: number } | null {
  return claimPlotWhere({ isTaken: (p) => a.taken.has(plotKey(p)), ground: a.ground, need: a.need })
}

// A running world holds rectangles, not plot keys — some of them, a bridge or a grave, never
// platted at all — so the claim takes a PREDICATE and the caller answers however it can see.

export type IsTaken = (plot: Plot) => boolean

/** One walk outward, not two: the ring the town has to reach and the plot it offers there are
 *  the same answer, and `plattedBlocks` is the expensive part of asking. */
export function claimPlotWhere(a: {
  isTaken: IsTaken
  ground: Ground
  need: Need
}): { plot: Plot; rings: number } | null {
  if (!fits(a.need)) return null
  for (let r = 1; r < CLAIM_RING_LIMIT; r++) {
    const plot = freePlots(r, a.ground).find((p) => holds(p, a.need) && !a.isTaken(p))
    if (plot !== undefined) return { plot, rings: r }
  }
  return null
}

export type Wanted = { kind: string; along: number; deep: number; owner: string | null }

/** Raise a list of buildings, each on its own claim, from a town already standing. The ONE
 *  function that builds a town, so there is no special case for the start. */
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

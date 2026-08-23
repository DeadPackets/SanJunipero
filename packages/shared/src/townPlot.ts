// ★ THE TOWN, SEEN FROM THE WORLD.
//
// `townGrammar` lays a lattice in its own coordinates and `townClaim` hands out plots on it.
// Neither knows where the town stands. This file is the one place that maps between the two
// frames and answers the question a RUNNING WORLD asks: an agent is about to raise a roof —
// where does it go?
//
// ★ THE ANSWER IS NEVER READ FROM THE ASKER. It is the free plot nearest the square, and
// "free" is read off the rectangles that stand in the world. So the spacing floor the grammar
// proved exhaustively (86.1626 px over 2 496 pairings) is a property of every town any
// sequence of agent builds can reach — because no sequence of agent builds can put a building
// anywhere else.
//
// ★ GRAMMAR (0, 0) IS THE TOWN'S SQUARE. The template's own corner walks one PITCH north-west
// per ring, so it is useless as a fixed point; the square does not move at all. The world
// coordinate of a grammar tile is therefore the square plus the tile, at every ring count
// there will ever be — which `TOWN_SQUARE.x + RIVER_GRAMMAR_DX === GENESIS_RIVER_X` already
// says about one column, and `townPlot.test.ts` says about the whole frame.

import {
  BLOCK, PITCH, STREET, blockIsPlattable, doorFrontOf, place, plattedBlocks, plotsOf,
  type Ground, type Plot, type TileXY, type TownFacing,
} from './townGrammar.js'
import { CLAIM_RING_LIMIT, claimPlotWhere, type Need } from './townClaim.js'
import { CITY_GROUND, TOWN_RINGS_GENESIS, townOrigin, townSpan } from './cityTemplate.js'

export type WorldXY = { x: number; y: number }
export type WorldRect = { x: number; y: number; w: number; h: number }
export type WorldBox = { dx0: number; dy0: number; dx1: number; dy1: number }

/** A grammar tile, in the world. */
export const worldOf = (square: WorldXY, t: TileXY): WorldXY =>
  ({ x: square.x + t.dx, y: square.y + t.dy })

/** A world tile, in the grammar. */
export const grammarOf = (square: WorldXY, p: WorldXY): TileXY =>
  ({ dx: p.x - square.x, dy: p.y - square.y })

/** The most ground a plot can ever be asked to hold, as a grammar rectangle. Every legal
 *  building on the plot stands on a subset of it — `along` and `deep` only ever shrink — so a
 *  plot whose greatest extent is clear is a plot no building can collide on. */
export function plotExtent(plot: Plot): { dx: number; dy: number; w: number; h: number } {
  const { dx, dy, w, h } = place(plot, '', plot.maxAlong, plot.maxDeep, null)
  return { dx, dy, w, h }
}

const overlaps = (
  a: { dx: number; dy: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number },
  square: WorldXY,
): boolean => {
  const g = grammarOf(square, b)
  return a.dx < g.dx + b.w && g.dx < a.dx + a.w && a.dy < g.dy + b.h && g.dy < a.dy + a.h
}

/**
 * ★ FREE IS READ OFF WHAT STANDS, NOT OFF A REGISTER — and in a running world "what stands"
 * is rectangles, not plot keys. A register would be a second source of truth and would drift
 * on the first crash recovery; a rectangle test also catches the things the grammar never
 * platted at all, so a grave or a wagon left across a frontage takes the plot it is on.
 */
export const plotIsTaken = (square: WorldXY, standing: readonly WorldRect[]) => (plot: Plot): boolean => {
  const ext = plotExtent(plot)
  return standing.some((s) => overlaps(ext, s, square))
}

const blockKey = (b: { i: number; j: number }): string => `${b.i},${b.j}`

/**
 * ★ A PLOT YOU CANNOT WALK TO IS NOT GROUND THE TOWN KEEPS FOR YOU.
 *
 * The blocks the town's own streets can reach from the square, walking block to block and
 * never crossing water. `plattedBlocks` does not ask this and never had to, because nothing
 * ever built past ring 1 — and the first plot ring 2 offers is block (-2, 0), which is on the
 * FAR BANK. Measured in a running world: twelve masons walked at the door of a house they
 * could never reach and were refused twenty-one thousand times, and the town stopped at ring 1
 * for good. That is the shape of failure this project keeps finding — a seam that offers
 * something and then quietly never delivers it.
 *
 * The far bank is an earned milestone (C11 §2) and this keeps it one: the west of the river
 * joins the town when somebody can get there, and not before. It is also the town-generator
 * lane's own connectivity property — one road component — made true of a grown town rather
 * than only of the genesis one.
 */
export function connectedBlocks(rings: number, ground: Ground): Set<string> {
  const platted = new Set(plattedBlocks(rings, ground).map(blockKey))
  const seen = new Set<string>([blockKey({ i: 0, j: 0 })])
  const queue: Array<{ i: number; j: number }> = [{ i: 0, j: 0 }]
  while (queue.length > 0) {
    const b = queue.shift()!
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const n = { i: b.i + di, j: b.j + dj }
      const k = blockKey(n)
      if (seen.has(k) || !platted.has(k)) continue
      if (!bandIsWalkable(b, n, ground)) continue
      seen.add(k)
      queue.push(n)
    }
  }
  seen.delete(blockKey({ i: 0, j: 0 }))
  return seen
}

/** The street band two neighbouring blocks share, and whether any of it is dry enough to walk.
 *  A band entirely in the channel is a bank, not a street. */
function bandIsWalkable(a: { i: number; j: number }, b: { i: number; j: number }, ground: Ground): boolean {
  const lo = { i: Math.min(a.i, b.i), j: Math.min(a.j, b.j) }
  const along = a.i === b.i
  for (let s = 0; s < STREET; s++) {
    const fixed = (along ? lo.j : lo.i) * PITCH + BLOCK + s
    for (let t = 0; t < BLOCK; t++) {
      const moving = (along ? lo.i : lo.j) * PITCH + t
      if (ground(along ? moving : fixed, along ? fixed : moving) !== 'water') return true
    }
  }
  return false
}

export type TownClaim = {
  /** The ground the building covers, in world tiles, already turned to its facing. */
  site: WorldRect
  /** The road tile its door opens onto. */
  door: WorldXY
  facing: TownFacing
  block: { i: number; j: number }
  slot: string
  /** How many rings the town stands at once this building is up. */
  rings: number
}

/**
 * ★ THE ONE FUNCTION THAT DECIDES WHERE A BUILDING GOES. Nothing about the asker reaches it —
 * not a coordinate, not a preference, not a plot name. It takes the square, everything
 * standing, and how much ground the thing needs, and it answers with the free plot nearest the
 * square. `null` is "the town has nowhere for a thing that size", and it is loud at the caller.
 */
export function claimTownPlot(a: {
  square: WorldXY
  standing: readonly WorldRect[]
  need: Need
  ground?: Ground
}): TownClaim | null {
  const ground = a.ground ?? CITY_GROUND
  const taken = plotIsTaken(a.square, a.standing)
  // Cheap, and computed once per ring the search looks at rather than once per plot.
  const reach = new Map<number, Set<string>>()
  const claim = claimPlotWhere({
    ground,
    need: a.need,
    isTaken: (p) => {
      const r = Math.max(Math.abs(p.block.i), Math.abs(p.block.j))
      let ok = reach.get(r)
      if (ok === undefined) { ok = connectedBlocks(r, ground); reach.set(r, ok) }
      return !ok.has(blockKey(p.block)) || taken(p)
    },
  })
  if (claim === null) return null
  const s = place(claim.plot, '', a.need.along, a.need.deep, null)
  const door = doorFrontOf(s)
  return {
    site: { ...worldOf(a.square, { dx: s.dx, dy: s.dy }), w: s.w, h: s.h },
    door: worldOf(a.square, door),
    facing: s.facing,
    block: { ...s.block },
    slot: s.slot,
    rings: claim.rings,
  }
}

/**
 * How many rings of the town are actually STANDING — the outermost ring that holds a building
 * on one of its plots. Read off the world like everything else here, and deliberately not off
 * a stored count: a count is a register, and this is the same question `plotIsTaken` answers.
 *
 * A structure that is not on a plot does not make a ring: the ford's bridge sits in block
 * (-1, -2) by arithmetic alone, and that block stands in the river and was never platted.
 */
export function ringsStanding(
  square: WorldXY, standing: readonly WorldRect[], ground: Ground = CITY_GROUND,
): number {
  let rings = TOWN_RINGS_GENESIS
  for (const s of standing) {
    const g = grammarOf(square, s)
    const i = Math.floor(g.dx / PITCH), j = Math.floor(g.dy / PITCH)
    const r = Math.max(Math.abs(i), Math.abs(j))
    if (r <= rings || r > CLAIM_RING_LIMIT) continue
    if (!blockIsPlattable(i, j, ground)) continue
    if (!plotsOf(i, j).some((p) => overlaps(plotExtent(p), s, square))) continue
    rings = r
  }
  return rings
}

/**
 * ★ THE GROUND THE TOWN HAS LAID, streets included — not the box of its roofs.
 *
 * The world-growth rule owes a block pitch of wild beyond the town, and it measured that from
 * the BUILT SET. That under-measures by exactly `STREET`: the outermost building stands three
 * tiles inside its own street, so a world that owes one pitch past the last roof owes three
 * tiles less than one pitch past the last kerb — and the next ring's far street band lands in
 * those three tiles. Measured, ring 1 → ring 2: the last roof is at world y 112 and ring 2's
 * far street band ends at 134, which is 22 = PITCH + STREET beyond it. That is the
 * world-growth lane's own C-5, and this is where it is paid.
 */
export function townBoxOf(square: WorldXY, rings: number): WorldBox {
  const o = townOrigin(rings)
  return {
    dx0: square.x - o, dy0: square.y - o,
    dx1: square.x - o + townSpan(rings) - 1, dy1: square.y - o + townSpan(rings) - 1,
  }
}

/**
 * The ground a block needs before anything can stand on it: every tile of the block cleared,
 * and every tile of its street ring paved. Both in world tiles, and both cut against the
 * river, because a road does not cross water until somebody builds a bridge.
 *
 * ★ A BLOCK IS LAID OUT WHEN ITS FIRST BUILDING IS RAISED — which is the user's parenthesis,
 * "as agents build new buildings AND ROADS", and the only way the streets of a ring the town
 * has not reached yet can arrive without anybody hand-placing them. Adjacent blocks share
 * their street band (a block's ring runs three tiles out and the pitch is BLOCK + 3), so a new
 * block's streets meet the ones already there and the town stays one connected road network.
 */
export function blockGroundOf(
  square: WorldXY, block: { i: number; j: number }, ground: Ground = CITY_GROUND,
): { cleared: WorldXY[]; paved: WorldXY[] } {
  const x0 = block.i * PITCH, y0 = block.j * PITCH
  const cleared: WorldXY[] = []
  for (let dy = y0; dy < y0 + BLOCK; dy++)
    for (let dx = x0; dx < x0 + BLOCK; dx++) cleared.push(worldOf(square, { dx, dy }))
  const paved: WorldXY[] = []
  const seen = new Set<string>()
  for (let s = 0; s < STREET; s++) {
    for (let dx = x0 - STREET; dx < x0 + BLOCK + STREET; dx++) {
      for (const t of [{ dx, dy: y0 + BLOCK + s }, { dx, dy: y0 - 1 - s }]) {
        const k = `${t.dx},${t.dy}`
        if (seen.has(k) || ground(t.dx, t.dy) === 'water') continue
        seen.add(k)
        paved.push(worldOf(square, t))
      }
    }
    for (let dy = y0 - STREET; dy < y0 + BLOCK + STREET; dy++) {
      for (const t of [{ dx: x0 + BLOCK + s, dy }, { dx: x0 - 1 - s, dy }]) {
        const k = `${t.dx},${t.dy}`
        if (seen.has(k) || ground(t.dx, t.dy) === 'water') continue
        seen.add(k)
        paved.push(worldOf(square, t))
      }
    }
  }
  return { cleared, paved }
}

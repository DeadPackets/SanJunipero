// Maps grammar coordinates to world ones: grammar (0,0) is TOWN_SQUARE, the one fixed point —
// the template's own corner walks a PITCH north-west per ring, so it cannot serve as one.

import {
  BLOCK,
  PITCH,
  STREET,
  blockIsPlattable,
  doorFrontOf,
  place,
  plotsOf,
  type Ground,
  type Plot,
  type TileXY,
  type TownFacing,
} from './townGrammar.js'
import { CLAIM_RING_LIMIT, claimPlotWhere, type Need } from './townClaim.js'
import { CITY_GROUND, TOWN_RINGS_GENESIS, townOrigin, townSpan } from './cityTemplate.js'

export type WorldXY = { x: number; y: number }
export type WorldRect = { x: number; y: number; w: number; h: number }
export type WorldBox = { dx0: number; dy0: number; dx1: number; dy1: number }

/** A grammar tile, in the world. */
export const worldOf = (square: WorldXY, t: TileXY): WorldXY => ({
  x: square.x + t.dx,
  y: square.y + t.dy,
})

/** A world tile, in the grammar. */
export const grammarOf = (square: WorldXY, p: WorldXY): TileXY => ({
  dx: p.x - square.x,
  dy: p.y - square.y,
})

/** The most ground a plot can ever be asked to hold. Every legal building stands on a subset of
 *  it — along and deep only shrink — so a plot whose greatest extent is clear cannot collide. */
export function plotExtent(plot: Plot): { dx: number; dy: number; w: number; h: number } {
  const { dx, dy, w, h } = place(plot, '', plot.maxAlong, plot.maxDeep, null)
  return { dx, dy, w, h }
}

const overlaps = (
  a: { dx: number; dy: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
  square: WorldXY,
): boolean => {
  const g = grammarOf(square, b)
  return a.dx < g.dx + b.w && g.dx < a.dx + a.w && a.dy < g.dy + b.h && g.dy < a.dy + a.h
}

/** Free is read off standing rectangles, never a register that would drift on crash recovery. A
 *  rectangle test also catches what the grammar never platted: a grave across a frontage takes the plot. */
export const plotIsTaken =
  (square: WorldXY, standing: readonly WorldRect[]) =>
  (plot: Plot): boolean => {
    const ext = plotExtent(plot)
    return standing.some((s) => overlaps(ext, s, square))
  }

/** Walking is not platting: the world's ford is dry sand the grammar calls wet, and a deck over
 *  water is not water. Asking one function both questions is how the far bank stayed shut. */
export type Walk = (dx: number, dy: number) => boolean

/** The walk a bare ground allows, and the default when nobody has built anything: every tile
 *  but the water. No bridge exists in a grammar with no world under it. */
export const walkOnGround =
  (ground: Ground): Walk =>
  (dx, dy) =>
    ground(dx, dy) !== 'water'

/** A question rather than a collection: asked once per candidate plot in a loop that runs every
 *  tick, so it is a flat byte grid — the string form cost the end-to-end run 42 seconds. */
export type Reach = { has: (dx: number, dy: number) => boolean; size: number }

/** Tile-connected reach from the square, bounded by the town's box at `rings`. Tiles, not blocks:
 *  block column i=-1 is never plattable, so a block walk could never open the far bank. */
export function reachOnFoot(rings: number, walk: Walk): Reach {
  const lo = -townOrigin(rings),
    span = townSpan(rings)
  const inBox = (ix: number, iy: number): boolean => ix >= 0 && ix < span && iy >= 0 && iy < span
  const seen = new Uint8Array(span * span)
  const queue = new Int32Array(span * span)
  let head = 0,
    tail = 0
  const push = (dx: number, dy: number): void => {
    const ix = dx - lo,
      iy = dy - lo
    if (!inBox(ix, iy)) return
    const k = iy * span + ix
    if (seen[k] === 1 || !walk(dx, dy)) return
    seen[k] = 1
    queue[tail++] = k
  }
  // The square itself is where everybody starts, and block (0, 0) is the square.
  for (let dy = 0; dy < BLOCK; dy++) for (let dx = 0; dx < BLOCK; dx++) push(dx, dy)
  while (head < tail) {
    const k = queue[head++]!
    const dx = (k % span) + lo,
      dy = (k - (k % span)) / span + lo
    push(dx + 1, dy)
    push(dx - 1, dy)
    push(dx, dy + 1)
    push(dx, dy - 1)
  }
  return {
    size: tail,
    has: (dx, dy) => {
      const ix = dx - lo,
        iy = dy - lo
      return inBox(ix, iy) && seen[iy * span + ix] === 1
    },
  }
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

/** Nothing about the asker reaches this — not a coordinate, not a preference, not a plot name.
 *  `null` is "the town has nowhere for a thing that size", and it is loud at the caller. */
export function claimTownPlot(a: {
  square: WorldXY
  standing: readonly WorldRect[]
  need: Need
  ground?: Ground
  walk?: Walk
}): TownClaim | null {
  const ground = a.ground ?? CITY_GROUND
  const walk = a.walk ?? walkOnGround(ground)
  const taken = plotIsTaken(a.square, a.standing)
  // Cheap, and computed once per ring the search looks at rather than once per plot.
  const reach = new Map<number, Reach>()
  const claim = claimPlotWhere({
    ground,
    need: a.need,
    isTaken: (p) => {
      const r = Math.max(Math.abs(p.block.i), Math.abs(p.block.j))
      let reached = reach.get(r)
      if (reached === undefined) {
        reached = reachOnFoot(r, walk)
        reach.set(r, reached)
      }
      // The door, not the block: the builder has to stand on this exact tile to raise anything,
      // so it is the tile that has to be walkable-to.
      const door = doorFrontOf(place(p, '', a.need.along, a.need.deep, null))
      return !reached.has(door.dx, door.dy) || taken(p)
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

/** The outermost ring holding a building on one of its plots, read off the world and not off a
 *  stored count. A structure not on a plot makes no ring: the ford's bridge was never platted. */
export function ringsStanding(
  square: WorldXY,
  standing: readonly WorldRect[],
  ground: Ground = CITY_GROUND,
): number {
  let rings = TOWN_RINGS_GENESIS
  for (const s of standing) {
    const g = grammarOf(square, s)
    const i = Math.floor(g.dx / PITCH),
      j = Math.floor(g.dy / PITCH)
    const r = Math.max(Math.abs(i), Math.abs(j))
    if (r <= rings || r > CLAIM_RING_LIMIT) continue
    if (!blockIsPlattable(i, j, ground)) continue
    if (!plotsOf(i, j).some((p) => overlaps(plotExtent(p), s, square))) continue
    rings = r
  }
  return rings
}

/** Streets included, not the box of roofs: the outermost building stands STREET inside its own
 *  kerb, so the next ring's far street band ends PITCH + STREET past the last roof. */
export function townBoxOf(square: WorldXY, rings: number): WorldBox {
  const o = townOrigin(rings)
  return {
    dx0: square.x - o,
    dy0: square.y - o,
    dx1: square.x - o + townSpan(rings) - 1,
    dy1: square.y - o + townSpan(rings) - 1,
  }
}

/** The ground a block needs: every tile of the block cleared, every tile of its street ring paved,
 *  both in WORLD tiles and both cut against the river. A block is laid out when its first building is raised.
 *  Adjacent blocks share their street band (ring is 3 out, pitch is BLOCK + 3), so the road network stays one piece. */
export function blockGroundOf(
  square: WorldXY,
  block: { i: number; j: number },
  ground: Ground = CITY_GROUND,
): { cleared: WorldXY[]; paved: WorldXY[] } {
  const x0 = block.i * PITCH,
    y0 = block.j * PITCH
  const cleared: WorldXY[] = []
  for (let dy = y0; dy < y0 + BLOCK; dy++)
    for (let dx = x0; dx < x0 + BLOCK; dx++) cleared.push(worldOf(square, { dx, dy }))
  const paved: WorldXY[] = []
  const seen = new Set<string>()
  for (let s = 0; s < STREET; s++) {
    for (let dx = x0 - STREET; dx < x0 + BLOCK + STREET; dx++) {
      for (const t of [
        { dx, dy: y0 + BLOCK + s },
        { dx, dy: y0 - 1 - s },
      ]) {
        const k = `${t.dx},${t.dy}`
        if (seen.has(k) || ground(t.dx, t.dy) === 'water') continue
        seen.add(k)
        paved.push(worldOf(square, t))
      }
    }
    for (let dy = y0 - STREET; dy < y0 + BLOCK + STREET; dy++) {
      for (const t of [
        { dx: x0 + BLOCK + s, dy },
        { dx: x0 - 1 - s, dy },
      ]) {
        const k = `${t.dx},${t.dy}`
        if (seen.has(k) || ground(t.dx, t.dy) === 'water') continue
        seen.add(k)
        paved.push(worldOf(square, t))
      }
    }
  }
  return { cleared, paved }
}

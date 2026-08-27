import {
  CITY_GROUND,
  isWet,
  T_FARMLAND,
  T_GRASS,
  T_ROAD,
  TOWN_SQUARE,
  blockGroundOf,
  claimTownPlot,
  firePitAt,
  plazaOf,
  ringsStanding,
  townBoxOf,
  wellAt,
  type Ground,
  type TownClaim,
  type Walk,
  type WorldBox,
  type WorldRect,
  type WorldXY,
} from '@sj/shared'
import { bridgeAt } from './path.js'
import { authoredOrigin, type WorldState } from './state.js'

// TOWN_SQUARE is in the authored frame; the array origin walks as the world grows, so the
// square's array coordinate is the authored one less state.origin. No town means no plots.

/** TOWN_SQUARE is the plaza's north-west corner, not its middle. Ring-independent by construction:
 *  every offset is a difference of two plazaOf(rings) points. 254 of 256 — well and pit stand bare. */
const PLAZA_PAVED: readonly { dx: number; dy: number }[] = (() => {
  const r = plazaOf(),
    w = wellAt(),
    f = firePitAt()
  const skip = new Set([`${w.dx - r.dx0},${w.dy - r.dy0}`, `${f.dx - r.dx0},${f.dy - r.dy0}`])
  const out: { dx: number; dy: number }[] = []
  for (let dy = r.dy0; dy <= r.dy1; dy++) {
    for (let dx = r.dx0; dx <= r.dx1; dx++) {
      const o = { dx: dx - r.dx0, dy: dy - r.dy0 }
      if (!skip.has(`${o.dx},${o.dy}`)) out.push(o)
    }
  }
  return out
})()

/** The square's array coordinate, or null for a world with no town. Asks about the whole
 *  254-tile plaza: one road crossing cannot pass that, nor a lattice shifted by less than a block. */
export function townSquareOf(state: WorldState): WorldXY | null {
  const o = authoredOrigin(state)
  const at = { x: TOWN_SQUARE.x - o.x, y: TOWN_SQUARE.y - o.y }
  for (const p of PLAZA_PAVED) {
    if (state.terrain[at.y + p.dy]?.[at.x + p.dx] !== T_ROAD) return null
  }
  return at
}

/** Everything standing, as bare rectangles — the only thing a claim may read besides the square.
 *  Sorted by id so two worlds holding the same buildings ask in the same order. */
export function standingRects(state: WorldState): WorldRect[] {
  return Object.keys(state.structures)
    .sort()
    .map((id) => state.structures[id]!)
    .map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h }))
}

/** Unions the grammar's channel with the world's water: the fork reaches the lattice at ring 3,
 *  where blocks (0,-3) and (1,-3) would stand in it. Off-array reads DRY — absent is not wet. */
export function townGroundOf(state: WorldState, square: WorldXY): Ground {
  return (dx, dy) => {
    const g = CITY_GROUND(dx, dy)
    if (g !== 'dry') return g
    const tile = state.terrain[square.y + dy]?.[square.x + dx]
    return tile !== undefined && isWet(tile) ? 'water' : 'dry'
  }
}

/** Non-water, or a completed bridge deck; derived from structures on every ask, never cached.
 *  Reads the world's water, not townGroundOf's plat ground, which widens the channel to 3 columns.
 *  A tile the array does not hold is NOT walkable — the opposite of townGroundOf, where absent is dry. */
export function townWalkOf(state: WorldState, square: WorldXY): Walk {
  return (dx, dy) => {
    const x = square.x + dx,
      y = square.y + dy
    const tile = state.terrain[y]?.[x]
    if (tile === undefined) return false
    return !isWet(tile) || bridgeAt(state, x, y)
  }
}

/** The plot the next building of this mass takes, in array coordinates. `null` when this world
 *  has no town, or when the town has nowhere for a thing that size. */
export function claimInWorld(
  state: WorldState,
  need: { along: number; deep: number },
): TownClaim | null {
  const square = townSquareOf(state)
  return square === null
    ? null
    : claimTownPlot({
        square,
        standing: standingRects(state),
        need,
        ground: townGroundOf(state, square),
        walk: townWalkOf(state, square),
      })
}

/** How many rings of the town are standing, and the ground it has laid to hold them. `null`
 *  for a world with no town — which owes nothing, because there is no town to owe it to. */
export function townGroundBox(state: WorldState): WorldBox | null {
  const square = townSquareOf(state)
  return square === null
    ? null
    : townBoxOf(square, ringsStanding(square, standingRects(state), townGroundOf(state, square)))
}

export type TileChange = {
  x: number
  y: number
  from: number
  to: number
  reason: 'levelled' | 'surfaced'
}

/** Returns only the tiles that differ, so a block whose streets a neighbour paved costs nothing.
 *  'off the map' is the loud answer: the world widens at midnight and the build succeeds next morning. */
export function layBlock(
  state: WorldState,
  square: WorldXY,
  block: { i: number; j: number },
): TileChange[] | 'off the map' {
  const { cleared, paved } = blockGroundOf(square, block, townGroundOf(state, square))
  const out: TileChange[] = []
  for (const [tiles, to, reason] of [
    [cleared, T_GRASS, 'levelled'],
    [paved, T_ROAD, 'surfaced'],
  ] as const) {
    for (const t of tiles) {
      const from = state.terrain[t.y]?.[t.x]
      if (from === undefined) return 'off the map'
      // A field and a street are somebody's work; a channel is not spared, because it is
      // impassable and a plot the town can never build on is worse than a lost ditch.
      if (reason === 'levelled' && (from === T_FARMLAND || from === T_ROAD)) continue
      if (from !== to) out.push({ x: t.x, y: t.y, from, to, reason })
    }
  }
  return out
}

import {
  CITY_GROUND, T_GRASS, T_ROAD, TOWN_SQUARE, blockGroundOf, claimTownPlot, ringsStanding,
  townBoxOf, type Ground, type TownClaim, type WorldBox, type WorldRect, type WorldXY,
} from '@sj/shared'
import { authoredOrigin, type WorldState } from './state.js'

// ★ WHERE THE TOWN IS, IN A WORLD THAT MOVES UNDER IT.
//
// `TOWN_SQUARE` names the square in the AUTHORED frame — the frame `genesisTerrainAt` is
// written in, and the frame every authored constant in `genesis/world.ts` is written in. The
// array's own origin walks when the world grows north or west, and `state.origin` is where it
// has walked to, so the square's ARRAY coordinate is the authored one less that origin. This
// is the same shift `world_grown` already applies to every agent, item, crop and structure;
// doing it here rather than storing a coordinate is what keeps the square from becoming a
// second source of truth that a replay could disagree with.
//
// ★ AND A WORLD WITH NO TOWN IN IT HAS NO PLOTS. Every fixture in the repository is a few
// dozen tiles of meadow with a shed on it. A square that is off the map, or on a tile nobody
// ever paved, is not a town — and in a world with no town a build has nowhere to go but the
// ground the builder names, which is exactly how the fixtures have always worked.

/** The square's array coordinate, or `null` for a world with no town standing in it. */
export function townSquareOf(state: WorldState): WorldXY | null {
  const o = authoredOrigin(state)
  const at = { x: TOWN_SQUARE.x - o.x, y: TOWN_SQUARE.y - o.y }
  const row = state.terrain[at.y]
  if (row === undefined || at.x < 0 || at.x >= row.length) return null
  return row[at.x] === T_ROAD ? at : null
}

/** Everything standing, as bare rectangles — the only thing a claim is allowed to read about
 *  the world besides the square. Sorted by id so two worlds that hold the same buildings ask
 *  the same question in the same order. */
export function standingRects(state: WorldState): WorldRect[] {
  return Object.keys(state.structures).sort()
    .map((id) => state.structures[id]!)
    .map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h }))
}

const WET: ReadonlySet<number> = new Set([2, 10])  // open water and a dug channel

/**
 * ★ THE GROUND THE PLAT RULE READS IN A RUNNING WORLD — the grammar's river AND the world's.
 *
 * `CITY_GROUND` knows one channel, because that is the only water the grammar was ever shown.
 * The world also has a lake, the fork that feeds it and whatever anybody has dug since.
 * Measured: rings 1 and 2 hold no world water the grammar does not already know about, and the
 * two agree to the column (48, 49, 50); ring 3 is where the fork reaches the lattice, and
 * blocks (0,-3) and (1,-3) would stand in it. So this is not decoration — it is the reason
 * "no building ever stands on water" survives past ring 2.
 *
 * A tile off the end of the array reads DRY on purpose. Absent ground is not wet ground, and a
 * plot quietly filtered out for want of a bigger world is exactly the failure that hid the
 * ring-1 clamp: it offers nothing and says nothing. Off the map is answered loudly, at the
 * build, by `layBlock`.
 */
export function townGroundOf(state: WorldState, square: WorldXY): Ground {
  return (dx, dy) => {
    const g = CITY_GROUND(dx, dy)
    if (g !== 'dry') return g
    const tile = state.terrain[square.y + dy]?.[square.x + dx]
    return tile !== undefined && WET.has(tile) ? 'water' : 'dry'
  }
}

/** The plot the next building of this mass takes, in array coordinates. `null` when this world
 *  has no town, or when the town has nowhere for a thing that size. */
export function claimInWorld(state: WorldState, need: { along: number; deep: number }): TownClaim | null {
  const square = townSquareOf(state)
  return square === null ? null
    : claimTownPlot({ square, standing: standingRects(state), need, ground: townGroundOf(state, square) })
}

/** How many rings of the town are standing, and the ground it has laid to hold them. `null`
 *  for a world with no town — which owes nothing, because there is no town to owe it to. */
export function townGroundBox(state: WorldState): WorldBox | null {
  const square = townSquareOf(state)
  return square === null ? null
    : townBoxOf(square, ringsStanding(square, standingRects(state), townGroundOf(state, square)))
}

export type TileChange = { x: number; y: number; from: number; to: number; reason: 'cleared' | 'paved' }

/**
 * ★ A BLOCK IS LAID OUT WHEN ITS FIRST BUILDING IS RAISED — the user's own parenthesis, "as
 * agents build new buildings AND ROADS". The block is cleared to open ground and its street
 * ring is paved, so a house at ring 2 stands on ground somebody made and opens onto a street
 * that reaches the square. Nothing is hand-placed: the same `streetTiles` arithmetic that laid
 * the genesis roads lays these.
 *
 * Only the tiles that actually differ are returned, so a block whose streets a neighbour
 * already paved costs nothing. `'off the map'` is the loud answer for ground the array does not
 * reach yet — the world widens at midnight and the same build succeeds the next morning.
 */
export function layBlock(
  state: WorldState, square: WorldXY, block: { i: number; j: number },
): TileChange[] | 'off the map' {
  const { cleared, paved } = blockGroundOf(square, block, townGroundOf(state, square))
  const out: TileChange[] = []
  for (const [tiles, to, reason] of [[cleared, T_GRASS, 'cleared'], [paved, T_ROAD, 'paved']] as const) {
    for (const t of tiles) {
      const from = state.terrain[t.y]?.[t.x]
      if (from === undefined) return 'off the map'
      if (from !== to) out.push({ x: t.x, y: t.y, from, to, reason })
    }
  }
  return out
}

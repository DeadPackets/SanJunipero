import {
  T_ROAD, TOWN_SQUARE, claimTownPlot, ringsStanding, townBoxOf,
  type TownClaim, type WorldBox, type WorldRect, type WorldXY,
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

/** The plot the next building of this mass takes, in array coordinates. `null` when this world
 *  has no town, or when the town has nowhere for a thing that size. */
export function claimInWorld(state: WorldState, need: { along: number; deep: number }): TownClaim | null {
  const square = townSquareOf(state)
  return square === null ? null : claimTownPlot({ square, standing: standingRects(state), need })
}

/** How many rings of the town are standing, and the ground it has laid to hold them. `null`
 *  for a world with no town — which owes nothing, because there is no town to owe it to. */
export function townGroundBox(state: WorldState): WorldBox | null {
  const square = townSquareOf(state)
  return square === null ? null : townBoxOf(square, ringsStanding(square, standingRects(state)))
}

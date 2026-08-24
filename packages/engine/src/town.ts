import {
  CITY_GROUND, T_GRASS, T_ROAD, TOWN_SQUARE, blockGroundOf, claimTownPlot, firePitAt,
  plazaOf, ringsStanding, townBoxOf, wellAt,
  type Ground, type TownClaim, type Walk, type WorldBox, type WorldRect, type WorldXY,
} from '@sj/shared'
import { bridgeAt } from './path.js'
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

/**
 * ★ THE PLAZA, IN OFFSETS FROM `TOWN_SQUARE` — which is its north-west CORNER, not its middle
 * (`plazaCentreOf` is the corner plus seven) — less the two tiles the grammar leaves bare under
 * the well and the fire pit. **254 of 256.**
 *
 * Ring-independent by construction: every offset is a difference between two
 * `plazaOf(rings)`-relative points, so the ring count cancels. Measured at rings 1, 2, 3 and 4:
 * the same 254 offsets every time, and the genesis world's own terrain agrees with all 256.
 */
const PLAZA_PAVED: ReadonlyArray<{ dx: number; dy: number }> = (() => {
  const r = plazaOf(), w = wellAt(), f = firePitAt()
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

/**
 * The square's array coordinate, or `null` for a world with no town standing in it.
 *
 * ★ AND IT USED TO ANSWER ABOUT A TOWN THAT WAS NOT THERE — the vacuous-guard family's
 * fourteenth member, and this is it closed. The test was `terrain[TOWN_SQUARE − origin] is
 * paved`: a passing condition (one tile is road) satisfiable without the property (this
 * world's town is centred here) holding. The dev world carried no origin, so the engine looked
 * ten rows north of the showcase's real square, landed on a paved tile of the plaza's own
 * street ring, and answered CONFIDENTLY. Every plot it then offered sat off the lattice that is
 * drawn. It did not fail; it lied, and the dev world had to be told the truth from outside.
 *
 * A square is the centre of a PLAZA, so the whole plaza is what is asked about: 254 tiles of
 * paving and the two the grammar leaves bare for its monuments. One road crossing cannot pass
 * that, and a lattice shifted by anything less than a block cannot either.
 */
export function townSquareOf(state: WorldState): WorldXY | null {
  const o = authoredOrigin(state)
  const at = { x: TOWN_SQUARE.x - o.x, y: TOWN_SQUARE.y - o.y }
  for (const p of PLAZA_PAVED) {
    if (state.terrain[at.y + p.dy]?.[at.x + p.dx] !== T_ROAD) return null
  }
  return at
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

/**
 * ★ A BRIDGE OPENS THE FAR BANK, AND THIS IS THE WHOLE OF THE MECHANISM.
 *
 * Where a body can put its feet in a running world: any tile the array actually holds that is
 * not water — or a COMPLETED bridge deck over water, which is the one structure that opens
 * ground instead of closing it. So a block across the channel becomes claimable BECAUSE a
 * deck stands on the tiles between here and there, and stops being claimable the moment it is
 * gone. Nothing is cached and no flag is stored: this is read off the structures every time.
 *
 * ★ IT READS THE WORLD'S WATER AND NOT THE PLAT GROUND, deliberately. `townGroundOf` unions
 * the grammar's channel with the world's so that no roof ever stands on either — three columns
 * wide, always. The world's ford is two, with a spit of dry sand where the grammar insists on
 * water. A crossing measured against the plat ground could never be laid, because a six-plank
 * deck cannot span a channel the grammar has widened by a column it does not have.
 *
 * A tile the array does not reach is not walkable. Absent ground is not somewhere to stand,
 * and `layBlock` already says "past the edge of the known country" out loud when it matters.
 */
export function townWalkOf(state: WorldState, square: WorldXY): Walk {
  return (dx, dy) => {
    const x = square.x + dx, y = square.y + dy
    const tile = state.terrain[y]?.[x]
    if (tile === undefined) return false
    return !WET.has(tile) || bridgeAt(state, x, y)
  }
}

/** The plot the next building of this mass takes, in array coordinates. `null` when this world
 *  has no town, or when the town has nowhere for a thing that size. */
export function claimInWorld(state: WorldState, need: { along: number; deep: number }): TownClaim | null {
  const square = townSquareOf(state)
  return square === null ? null : claimTownPlot({
    square, standing: standingRects(state), need,
    ground: townGroundOf(state, square), walk: townWalkOf(state, square),
  })
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

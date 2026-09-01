import { isWet, T_EARTH, T_FOREST, T_GRASS, T_ROCK, T_SAND, T_WATER } from '@sj/shared'
import { authoredOrigin, type TileId } from './state.js'

// The shape of the valley, authored from (x, y) arithmetic alone and read by everything that
// has to know where the water is: genesis lays the ground from it, the walk verb aims at it.

// A straight main channel, because the city template lays its own bank and riverfront path
// against x 48..50 — a meander here would leave the bank hanging over open water.
export const GENESIS_RIVER_X = 49
export const GENESIS_FORK_Y = 20
export const GENESIS_LAKE = { x: 86, y: 20, rx: 9, ry: 6 } as const
export const GENESIS_HILL = { x: 22, y: 104, rx: 9, ry: 7 } as const
export const GENESIS_FOREST_X = 92

// A spit of sand reaches out from the near bank and the channel runs two tiles instead of three:
// the only place a six-plank deck can span, so the paths converge on it.
export const GENESIS_FORD = { x: GENESIS_RIVER_X + 1, y0: 50, y1: 53 } as const

const inFord = (x: number, y: number): boolean =>
  x === GENESIS_FORD.x && y >= GENESIS_FORD.y0 && y <= GENESIS_FORD.y1

// Integer ellipse test, so nothing here depends on floating-point rounding.
function inEllipse(
  x: number,
  y: number,
  e: { x: number; y: number; rx: number; ry: number },
  grow = 0,
): boolean {
  const rx = e.rx + grow,
    ry = e.ry + grow
  const dx = x - e.x,
    dy = y - e.y
  return dx * dx * ry * ry + dy * dy * rx * rx <= rx * rx * ry * ry
}

// A ragged forest edge from a cheap deterministic wobble: no RNG, no stored noise field.
const forestEdgeAt = (y: number): number => GENESIS_FOREST_X + ((y * 7 + (y >> 3)) % 5) - 2

export function genesisTerrainAt(x: number, y: number): TileId {
  if (inEllipse(x, y, GENESIS_LAKE)) return T_WATER
  if (inEllipse(x, y, GENESIS_LAKE, 2)) return T_SAND
  // the branch that leaves the main river for the lake, and the pool where it leaves
  if (Math.abs(y - GENESIS_FORK_Y) <= 1 && x >= GENESIS_RIVER_X && x <= GENESIS_LAKE.x)
    return T_WATER
  if (Math.abs(y - GENESIS_FORK_Y) <= 3 && Math.abs(x - GENESIS_RIVER_X) <= 3) return T_WATER
  // The spit comes before the channel and after the fork: it narrows the main river and
  // never the pool the branch leaves from.
  if (inFord(x, y)) return T_SAND
  if (Math.abs(x - GENESIS_RIVER_X) <= 1) return T_WATER
  if (inEllipse(x, y, GENESIS_HILL)) return T_ROCK
  if (inEllipse(x, y, GENESIS_HILL, 2)) return T_EARTH
  if (x >= forestEdgeAt(y)) return T_FOREST
  return T_GRASS
}

// How far either side of the channel still reads as the river: three tiles of water at the
// main run, and the pool where the branch leaves it.
const RIVER_REACH = 3

/** The ground and where its (0, 0) stands. Growing the map north or west slides every index in
 *  the array, and the valley does not move with them. */
type Ground = { terrain: TileId[][]; origin?: { x: number; y: number } | undefined }

/** A thing the valley has that nobody built. Not a structure — no walls, no owner, no
 *  footprint — only a name every mind in the valley already knows and ground beside it.
 *  Both methods take and return array coordinates, which is the frame a body walks in. */
export type NaturalFeature = {
  id: string
  name: string
  /** Big enough to catch the eye across the valley, and wet. */
  water: boolean
  /** The tile of it nearest a body at (x, y): where that body would point at it from. */
  near(g: Ground, x: number, y: number): { x: number; y: number }
  /** Whether this tile is part of it. Read off the ground, so a world whose terrain is not
   *  this valley's simply has no such feature and nothing renders. */
  has(g: Ground, x: number, y: number): boolean
}

// The shapes above are written in authored coordinates; a body stands in array ones.
const authoredAt = (g: Ground, x: number, y: number): { x: number; y: number } => {
  const o = authoredOrigin(g)
  return { x: x + o.x, y: y + o.y }
}
const arrayAt = (g: Ground, x: number, y: number): { x: number; y: number } => {
  const o = authoredOrigin(g)
  return { x: x - o.x, y: y - o.y }
}

const wet = (g: Ground, x: number, y: number): boolean => {
  const tile = g.terrain[y]?.[x]
  return tile !== undefined && isWet(tile)
}

/** The landmarks nobody has to be shown. A person knows the valley they live in; the town's
 *  own roofs are the things that have to be walked past first (`sightSystem`). */
const NATURAL_FEATURES: readonly NaturalFeature[] = [
  {
    id: 'river',
    name: 'the river',
    water: true,
    // Abreast where the channel reaches, off its nearest end where it does not: a body south of
    // the last water still has a river, and reading it at its own y would say the valley has none.
    near: (g, _x, y) => {
      const x = arrayAt(g, GENESIS_RIVER_X, 0).x
      for (let d = 0; d < g.terrain.length; d++) {
        if (wet(g, x, y - d)) return { x, y: y - d }
        if (wet(g, x, y + d)) return { x, y: y + d }
      }
      return { x, y }
    },
    has: (g, x, y) =>
      Math.abs(authoredAt(g, x, y).x - GENESIS_RIVER_X) <= RIVER_REACH && wet(g, x, y),
  },
  {
    id: 'lake',
    name: 'the lake',
    water: true,
    near: (g) => arrayAt(g, GENESIS_LAKE.x, GENESIS_LAKE.y),
    has: (g, x, y) => {
      const a = authoredAt(g, x, y)
      return inEllipse(a.x, a.y, GENESIS_LAKE) && wet(g, x, y)
    },
  },
  {
    id: 'ford',
    name: 'the ford',
    // Sand on the river's own line: the river already answers for the water here.
    water: false,
    near: (g) => arrayAt(g, GENESIS_FORD.x, Math.floor((GENESIS_FORD.y0 + GENESIS_FORD.y1) / 2)),
    has: (g, x, y) => {
      const a = authoredAt(g, x, y)
      return inFord(a.x, a.y) && g.terrain[y]?.[x] === T_SAND
    },
  },
]

// Where the tile of a feature lies for a body at (x, y), or null when this world's ground has
// no such thing there.
const tileOf = (g: Ground, f: NaturalFeature, x: number, y: number) => {
  const at = f.near(g, x, y)
  return f.has(g, at.x, at.y) ? at : null
}

/** The feature that mark names, and the tile of it this body would point at — or null, both
 *  when nothing is called that and when this world's ground has no such thing. */
export function naturalFeatureAt(
  g: Ground,
  id: string,
  x: number,
  y: number,
): { feature: NaturalFeature; at: { x: number; y: number } } | null {
  const feature = NATURAL_FEATURES.find((f) => f.id === id)
  if (feature === undefined) return null
  const at = tileOf(g, feature, x, y)
  return at === null ? null : { feature, at }
}

/** Every landmark this valley actually has, placed where a body at (x, y) sees it. `kind` is
 *  the id: a landmark is always called by its name, so nothing ever falls back to it. */
export function naturalPlaces(
  g: Ground,
  x: number,
  y: number,
): { id: string; kind: string; name: string; x: number; y: number }[] {
  return NATURAL_FEATURES.flatMap((f) => {
    const at = tileOf(g, f, x, y)
    return at === null ? [] : [{ id: f.id, kind: f.id, name: f.name, ...at }]
  })
}

/** Water a body can see and not reach into: null whenever anything wet is already within
 *  `sight`, so the glint on the horizon never doubles what the near scan has already said.
 *  The valley's own water answers it, so the glint and a walk to the river agree by construction. */
export function distantWater(
  g: Ground,
  x: number,
  y: number,
  sight: number,
  reach: number,
): { x: number; y: number } | null {
  for (let py = y - sight; py <= y + sight; py++) {
    for (let px = x - sight; px <= x + sight; px++) if (wet(g, px, py)) return null
  }
  let best: { x: number; y: number } | null = null
  let bestD = Infinity
  for (const f of NATURAL_FEATURES) {
    if (!f.water) continue
    const at = tileOf(g, f, x, y)
    if (at === null) continue
    const d = Math.abs(at.x - x) + Math.abs(at.y - y)
    if (d > reach || d >= bestD) continue
    bestD = d
    best = at
  }
  return best
}

// The world's ground vocabulary. Every renderer, pathfinder, perception channel and
// town-grammar test reads its tile numbers from here.
export type TileId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10

export const T_GRASS = 0,
  T_EARTH = 1,
  T_WATER = 2,
  T_FOREST = 3,
  T_ROCK = 4,
  T_SAND = 5,
  T_FARMLAND = 6,
  T_ROAD = 7,
  T_PATH = 8,
  T_SAPLING = 9,
  T_CHANNEL = 10

/** Standing water and a dug channel are the same thing to a root, a mouth and a bucket. */
export const isWet = (t: number): boolean => t === T_WATER || t === T_CHANNEL

/** Road and worn path both — the move cost roads changed is already real. */
export const isTravelled = (t: number): boolean => t === T_ROAD || t === T_PATH

/** Ground a street may be laid over: grass, bare earth, and the dirt feet already wore. */
export const isPaveable = (t: number): boolean => t === T_GRASS || t === T_EARTH || t === T_PATH

/** Something standing that a swing can take down. */
export const isWoody = (t: number): boolean => t === T_FOREST || t === T_SAPLING

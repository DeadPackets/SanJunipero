import { agentName, kindWords } from '@sj/shared'
import type { Structure, TileId, WorldState } from '@sj/engine/state'

// A deliberate viewer-side reimplementation: `nearestStructureKind` lives in `@sj/agents`, which P1
// forbids the viewer importing. It answers in prose — never a coordinate, an id, or a slug.

export type Place = { words: string; kind: 'inside' | 'at' | 'on' | 'out' }

/** How close is "at". Two tiles is a person standing beside a thing, not walking past it. */
export const AT_RADIUS_TILES = 2

/** Typographic apostrophe — the chrome sets prose, not code (the landed `OWNS` const). */
const OWNS = '’s'

const NOWHERE = 'out past the edge of town'
const RIVER_BANK = 'on the river bank'

/** The town's word for each ground, or `null` where the ground has no name worth saying. A
 *  `Record`, so a wider `TileId` union is a compile error here rather than a silent gap. */
export const TERRAIN_WORDS: Readonly<Record<TileId, string | null>> = {
  0: null, // grass — just ground
  1: null, // dirt — just ground, until the river is beside it
  2: 'in the river',
  3: 'in the forest',
  4: 'up among the rocks',
  5: 'on the sand',
  6: 'in the fields',
  7: 'on the road',
  // C11's 8/9/10 landed after this table was written; they take the word of the kind
  // `TILE_KIND` already aliases them onto — earth, forest, water.
  8: null, // path — dirt the feet made
  9: 'in the forest', // sapling
  10: 'in the river', // channel
}

const WATER: TileId = 2
const DIRT: TileId = 1

/** "Amara’s house" | "the well". A kind is a slug in the engine and prose here — the underscore
 *  never reaches a viewer. */
export function structureWords(state: WorldState, s: Structure): string {
  const words = kindWords(s.kind)
  return s.owner === undefined
    ? `the ${words}`
    : `${agentName(state.agents, s.owner)}${OWNS} ${words}`
}

const tileAt = (state: WorldState, x: number, y: number): TileId | null =>
  state.terrain[y]?.[x] ?? null

/** Chebyshev distance from a point to a footprint — 0 while standing on it. */
function tilesFrom(s: Structure, x: number, y: number): number {
  const dx = Math.max(s.x - x, 0, x - (s.x + s.w - 1))
  const dy = Math.max(s.y - y, 0, y - (s.y + s.h - 1))
  return Math.max(dx, dy)
}

/** Ties resolve by id, so a rename or a re-order can never move somebody. */
function nearestStructure(state: WorldState, x: number, y: number): Structure | null {
  let best: Structure | null = null
  let bestAt = Infinity
  for (const s of Object.values(state.structures).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const d = tilesFrom(s, x, y)
    if (d < bestAt) {
      bestAt = d
      best = s
    }
  }
  return best !== null && bestAt <= AT_RADIUS_TILES ? best : null
}

function groundWords(state: WorldState, x: number, y: number): string | null {
  const t = tileAt(state, x, y)
  if (t === null) return null
  if (t === DIRT) {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      if (tileAt(state, x + dx, y + dy) === WATER) return RIVER_BANK
    }
    return null
  }
  return TERRAIN_WORDS[t]
}

/** First match wins: the room they are in, then the thing they are beside, then the ground they
 *  stand on, then the honest admission that they are nowhere in particular. */
export function placeOf(state: WorldState, agentId: string): Place {
  const a = state.agents[agentId]
  if (a === undefined) return { words: NOWHERE, kind: 'out' }

  if (a.insideId !== undefined) {
    const room = state.structures[a.insideId]
    if (room !== undefined)
      return { words: `inside ${structureWords(state, room)}`, kind: 'inside' }
  }

  const near = nearestStructure(state, a.x, a.y)
  if (near !== null) {
    // "by" a home and "at" a public place: whose it is, said in one word
    const at = near.owner === undefined ? 'at' : 'by'
    return { words: `${at} ${structureWords(state, near)}`, kind: 'at' }
  }

  const ground = groundWords(state, a.x, a.y)
  if (ground !== null) return { words: ground, kind: 'on' }

  return { words: NOWHERE, kind: 'out' }
}

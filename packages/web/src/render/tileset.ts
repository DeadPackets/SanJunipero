import type { RoadNeighbors, TerrainTileKind } from '@sj/shared'
import type { TileId } from '@sj/engine/state'

const TERRAIN_KIND_FALLBACK: TerrainTileKind = 'grass'
export const ROAD_TILE_ID = 7

// Every TileId the engine can emit needs an entry, or it falls back to grass. 8/9/10
// (path, sapling, channel) borrow the nearest existing art kind until they have their own.
export const TILE_KIND: Record<TileId, TerrainTileKind> = {
  0: 'grass',
  1: 'earth',
  2: 'water',
  3: 'forest',
  4: 'rock',
  5: 'sand',
  6: 'farmland',
  7: 'road',
  8: 'earth',
  9: 'forest',
  10: 'water',
}

const KIND_BY_ID: Partial<Record<number, TerrainTileKind>> = TILE_KIND
export function tileKind(id: number): TerrainTileKind {
  return KIND_BY_ID[id] ?? TERRAIN_KIND_FALLBACK
}

export function roadNeighborsAt(terrain: TileId[][], x: number, y: number): RoadNeighbors {
  const isRoad = (nx: number, ny: number): boolean => terrain[ny]?.[nx] === ROAD_TILE_ID
  return { n: isRoad(x, y - 1), e: isRoad(x + 1, y), s: isRoad(x, y + 1), w: isRoad(x - 1, y) }
}

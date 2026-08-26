import {
  parseTerrainTileManifest,
  roadAutotile,
  roadAutotileKind,
  type AssetRecord,
  type RoadAutotileKey,
  type RoadNeighbors,
  type TerrainTileKind,
  type TerrainTileManifest,
} from '@sj/shared'
import type { TileId } from '@sj/engine/state'

export { roadAutotileKind } from '@sj/shared'

export const TERRAIN_KIND_FALLBACK: TerrainTileKind = 'grass'
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

export function tileKind(id: number): TerrainTileKind {
  return TILE_KIND[id as TileId] ?? TERRAIN_KIND_FALLBACK
}

export const TILE_VARIANT_SALT = 0x9e3779b9
export const TERRAIN_VARIANTS = 4

export function tileVariant(x: number, y: number): number {
  // parentheses required: % binds tighter than >>>, so `>>> 0 % 4` is just `>>> 0`
  return (
    ((Math.imul(x + TILE_VARIANT_SALT, 0x27d4eb2d) ^
      Math.imul(y + TILE_VARIANT_SALT, 0x165667b1)) >>>
      0) %
    TERRAIN_VARIANTS
  )
}

export function roadNeighborsAt(terrain: TileId[][], x: number, y: number): RoadNeighbors {
  const isRoad = (nx: number, ny: number): boolean => terrain[ny]?.[nx] === ROAD_TILE_ID
  return { n: isRoad(x, y - 1), e: isRoad(x + 1, y), s: isRoad(x, y + 1), w: isRoad(x - 1, y) }
}

export type TerrainTex = {
  kind: TerrainTileKind
  variant: number
  autotile: RoadAutotileKey | null
  manifest: TerrainTileManifest | null
  url: string | null
  /** true when this is a C13 strip cell — a ribbon on transparency that needs ground beneath
   *  it. A flat variant fills its own diamond and is never an overlay. */
  overlay: boolean
}

type Candidate = { rec: AssetRecord; manifest: TerrainTileManifest | null }

function readyTerrain(records: AssetRecord[], kind: string): Candidate[] {
  return records
    .filter((r) => r.class === 'terrain' && r.kind === kind && r.status === 'ready')
    .map((r) => ({ rec: r, manifest: parseTerrainTileManifest(r.meta) }))
}

const urlOf = (rec: AssetRecord): string => `/assets/${rec.id}.png`

// Four variant records share one codex kind, so a single resolveAsset lookup cannot select a
// variant — scan every ready record of the kind and match manifest.variant.
export function resolveTerrainTile(
  records: AssetRecord[],
  id: number,
  x: number,
  y: number,
  autotile: RoadAutotileKey | null = null,
): TerrainTex {
  const kind = tileKind(id)
  const variant = tileVariant(x, y)

  if (kind === 'road' && autotile !== null) {
    const strip = readyTerrain(records, roadAutotileKind(autotile))[0]
    if (strip !== undefined) {
      return {
        kind,
        variant,
        autotile,
        manifest: strip.manifest,
        url: urlOf(strip.rec),
        overlay: true,
      }
    }
  }

  const candidates = readyTerrain(records, kind).filter(
    (c): c is { rec: AssetRecord; manifest: TerrainTileManifest } => c.manifest !== null,
  )
  const hit = candidates.find((c) => c.manifest.variant === variant) ?? candidates[0] ?? null
  return {
    kind,
    variant,
    autotile,
    manifest: hit?.manifest ?? null,
    url: hit !== null ? urlOf(hit.rec) : null,
    overlay: false,
  }
}

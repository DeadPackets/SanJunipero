import type { AssetRecord, TerrainTileManifest } from '@sj/shared'
import type { TileId } from '@sj/engine/state'
import { tileToScreen } from './iso.js'
import { roadAutotile } from '@sj/shared'
import { ROAD_TILE_ID, resolveTerrainTile, roadNeighborsAt } from './tileset.js'

// master-palette hexes — the placeholder terrain IS palette-true
export const TILE_COLORS: Record<TileId, number> = {
  0: 0x93b573 /* grass */,
  1: 0xc68a48 /* dirt */,
  2: 0x7fb0c9 /* water */,
  3: 0x4f7040 /* forest */,
  4: 0xaba198 /* rock */,
  5: 0xe8d5bc /* sand */,
  6: 0xa66e38 /* farmland */,
  7: 0xb8ad9e /* road — placeholder; C10 owns the texture */,
}

// shade tiles draw one ramp step darker for subtle checker texture
export const SHADE_MULT = 0.85

export function shadeColor(color: number): number {
  const r = Math.round(((color >> 16) & 0xff) * SHADE_MULT)
  const g = Math.round(((color >> 8) & 0xff) * SHADE_MULT)
  const b = Math.round((color & 0xff) * SHADE_MULT)
  return (r << 16) | (g << 8) | b
}

export type GroundCell = { sx: number; sy: number; color: number; shade: boolean }

export function groundPlan(terrain: TileId[][]): GroundCell[] {
  const cells: GroundCell[] = []
  for (let y = 0; y < terrain.length; y++) {
    const row = terrain[y]!
    for (let x = 0; x < row.length; x++) {
      const { sx, sy } = tileToScreen(x, y)
      cells.push({ sx, sy, color: TILE_COLORS[row[x]!], shade: (x + y) % 2 === 1 })
    }
  }
  return cells
}

export const GROUND_FALLBACK_COLOR = 0x93b573
export const GRASS_TILE_ID = 0

// One plan entry per tile: a codex texture url when terrain art exists, otherwise the C6
// flat palette-true diamond. Art independence — an empty record set renders exactly as C6 did.
export type TileLayer = { tex: TerrainTileManifest | null; url: string | null; fallback: number }

export type TilePlan = TileLayer & {
  sx: number; sy: number
  shade: boolean
  /** the C13 strip is a ribbon on transparency — `tex` covers only part of the diamond */
  overlay: boolean
  /** the ground that goes UNDER an overlay; null when `tex` fills its own diamond */
  base: TileLayer | null
}

export function tilesetPlan(terrain: TileId[][], records: AssetRecord[]): TilePlan[] {
  const cells: TilePlan[] = []
  for (let y = 0; y < terrain.length; y++) {
    const row = terrain[y]!
    for (let x = 0; x < row.length; x++) {
      const id = row[x]!
      const { sx, sy } = tileToScreen(x, y)
      // AMENDMENT (C13 §4): a road tile asks the shared autotiler for its shape first; the
      // flat road variants stay the fallback when no autotiled strip is in the codex.
      const autotile = id === ROAD_TILE_ID ? roadAutotile(roadNeighborsAt(terrain, x, y)) : null
      const { manifest, url, overlay } = resolveTerrainTile(records, id, x, y, autotile)
      // A ribbon drawn INSTEAD of the ground shows the stage through its own transparency —
      // half of a straight run is a hole. The road is painted to meet GRASS at its edges
      // (roadTiles.ts strokes exactly that seam), so grass is what goes underneath it.
      let base: TileLayer | null = null
      if (overlay) {
        const under = resolveTerrainTile(records, GRASS_TILE_ID, x, y)
        base = { tex: under.manifest, url: under.url, fallback: TILE_COLORS[GRASS_TILE_ID] }
      }
      cells.push({
        sx, sy, tex: manifest, url, overlay, base,
        fallback: TILE_COLORS[id] ?? GROUND_FALLBACK_COLOR,
        shade: (x + y) % 2 === 1,
      })
    }
  }
  return cells
}

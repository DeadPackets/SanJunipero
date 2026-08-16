import type { TileId } from '@sj/engine/state'
import { tileToScreen } from './iso.js'

// master-palette hexes — the placeholder terrain IS palette-true
export const TILE_COLORS: Record<TileId, number> = {
  0: 0x93b573 /* grass */,
  1: 0xc68a48 /* dirt */,
  2: 0x7fb0c9 /* water */,
  3: 0x4f7040 /* forest */,
  4: 0xaba198 /* rock */,
  5: 0xe8d5bc /* sand */,
  6: 0xa66e38 /* farmland */,
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

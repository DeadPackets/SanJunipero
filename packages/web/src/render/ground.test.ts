import { describe, expect, it } from 'vitest'
import type { TileId } from '@sj/engine/state'
import { TILE_COLORS, groundPlan } from './ground.js'

describe('groundPlan', () => {
  it('maps a 2x2 terrain to diamonds at exact screen points with alternating shade', () => {
    // terrain is [y][x]: row 0 = water, grass; row 1 = dirt, forest
    const terrain: TileId[][] = [
      [2, 0],
      [1, 3],
    ]
    expect(groundPlan(terrain)).toEqual([
      { sx: 0, sy: 0, color: TILE_COLORS[2], shade: false },
      { sx: 16, sy: 8, color: TILE_COLORS[0], shade: true },
      { sx: -16, sy: 8, color: TILE_COLORS[1], shade: true },
      { sx: 0, sy: 16, color: TILE_COLORS[3], shade: false },
    ])
  })

  it('water is the exact master-palette hex', () => {
    expect(TILE_COLORS[2]).toBe(0x7fb0c9)
  })
})

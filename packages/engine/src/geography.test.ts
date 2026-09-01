import { describe, expect, it } from 'vitest'
import { T_GRASS } from '@sj/shared'
import { GENESIS_RIVER_X, genesisTerrainAt, naturalFeatureAt, naturalPlaces } from './geography.js'
import type { TileId } from './state.js'

const W = 128
const H = 128

// A world whose window crops the channel short, the way ring 1 does: water from `y0` to `y1` and
// dry ground either side of it.
const clipped = (y0: number, y1: number): { terrain: TileId[][] } => ({
  terrain: Array.from({ length: H }, (_, y) =>
    Array.from({ length: W }, (_, x) => (y < y0 || y > y1 ? T_GRASS : genesisTerrainAt(x, y))),
  ),
})

// The ground as it stands once the world has grown `by` tiles north and west: `grownStrip` lays
// every new strip from `genesisTerrainAt` in the authored frame, so this is the same arithmetic.
const ground = (by = 0): { terrain: TileId[][]; origin?: { x: number; y: number } } => ({
  terrain: Array.from({ length: H }, (_, y) =>
    Array.from({ length: W }, (_, x) => genesisTerrainAt(x - by, y - by)),
  ),
  ...(by === 0 ? {} : { origin: { x: -by, y: -by } }),
})

describe('★ the valley the landmarks are read off', () => {
  it('puts the river in the column the ground actually has it in', () => {
    const river = naturalFeatureAt(ground(), 'river', 70, 40)
    expect(river?.at).toEqual({ x: GENESIS_RIVER_X, y: 40 })
  })

  // ★ Growing the map north or west slides every index in the array. The river does not move
  // with them, so a landmark read in array coordinates would drift a strip's width per growth.
  it('★ follows the array when the world grows out from under it', () => {
    const grown = ground(8)
    expect(naturalFeatureAt(grown, 'river', 70, 40)?.at).toEqual({
      x: GENESIS_RIVER_X + 8,
      y: 40,
    })
    const lake = naturalPlaces(grown, 70, 40).find((p) => p.id === 'lake')
    expect(lake).toBeDefined()
    expect(grown.terrain[lake!.y]![lake!.x]).toBe(genesisTerrainAt(lake!.x - 8, lake!.y - 8))
  })

  // ★ Read abreast, the channel vanished for every body whose row held no water — the southwest
  // corner of ring 1, where three minds spent rehearsal 5 drawing water off dry ground.
  it('★ names the river to a body past either end of the water', () => {
    const g = clipped(8, 67)
    expect(naturalFeatureAt(g, 'river', 2, 70)?.at).toEqual({ x: GENESIS_RIVER_X, y: 67 })
    expect(naturalFeatureAt(g, 'river', 70, 3)?.at).toEqual({ x: GENESIS_RIVER_X, y: 8 })
    expect(naturalPlaces(g, 2, 70).map((p) => p.id)).toContain('river')
  })

  it('names nothing at all on ground this valley did not lay', () => {
    const flat = {
      terrain: Array.from({ length: H }, () => Array.from({ length: W }, (): TileId => 0)),
    }
    expect(naturalPlaces(flat, 70, 40)).toEqual([])
    expect(naturalFeatureAt(flat, 'river', 70, 40)).toBe(null)
  })

  it('knows nothing by a name the valley never gave', () => {
    expect(naturalFeatureAt(ground(), 'the_old_mill', 70, 40)).toBe(null)
  })
})

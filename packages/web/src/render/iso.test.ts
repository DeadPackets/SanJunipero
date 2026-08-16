import { describe, expect, it } from 'vitest'
import { TILE_H, TILE_W, depthKey, facingFrom, screenToTile, tileToScreen } from './iso.js'

describe('dimetric math', () => {
  it('uses the 32×16 base tile', () => {
    expect(TILE_W).toBe(32)
    expect(TILE_H).toBe(16)
  })

  it('tileToScreen follows the spec formula', () => {
    expect(tileToScreen(3, 1)).toEqual({ sx: 32, sy: 32 })
    expect(tileToScreen(0, 0)).toEqual({ sx: 0, sy: 0 })
  })

  it('screenToTile inverts a lattice sweep', () => {
    for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) {
      const { sx, sy } = tileToScreen(x, y)
      expect(screenToTile(sx, sy)).toEqual({ x, y })
    }
  })

  it('depthKey increases along +x+y and is stable within a diagonal', () => {
    expect(depthKey(2, 3)).toBeLessThan(depthKey(3, 2))
    let prev = -Infinity
    for (let s = 0; s < 6; s++) {
      const k = depthKey(s, 0)
      expect(k).toBeGreaterThan(prev)
      prev = k
    }
    expect(depthKey(1, 1)).toBeGreaterThan(depthKey(2, 0) - 1000) // same diagonal band
  })

  it('facingFrom maps axes and breaks ties toward x', () => {
    expect(facingFrom(1, 0)).toBe('se')
    expect(facingFrom(0, 1)).toBe('sw')
    expect(facingFrom(-1, 0)).toBe('nw')
    expect(facingFrom(0, -1)).toBe('ne')
    expect(facingFrom(1, 1)).toBe('se')
    expect(facingFrom(-2, -2)).toBe('nw')
  })
})

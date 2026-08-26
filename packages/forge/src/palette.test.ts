import { describe, it, expect } from 'vitest'
import { MASTER_PALETTE, paletteRgb } from './palette.js'

describe('master palette', () => {
  it('has exactly 40 colors', () => {
    expect(MASTER_PALETTE).toHaveLength(40)
  })
  it('all entries are unique uppercase #RRGGBB', () => {
    for (const c of MASTER_PALETTE) expect(c).toMatch(/^#[0-9A-F]{6}$/)
    expect(new Set(MASTER_PALETTE).size).toBe(40)
  })
  it('paletteRgb converts in order', () => {
    expect(paletteRgb()[0]).toEqual([0xff, 0xf6, 0xe9])
    expect(paletteRgb()).toHaveLength(40)
  })
})

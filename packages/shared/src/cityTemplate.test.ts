import { describe, it, expect } from 'vitest'
import {
  CityTemplateSchema, DISTRICTS, DISTRICT_NAMES, CITY_ANCHOR_DEFAULT, CITY_W, CITY_H,
  WORLD_SIZE_GENESIS, inExtent, inRect, T_ROAD,
} from './cityTemplate.js'

const MINIMAL = {
  anchor: { x: 0, y: 0 },
  tiles: [{ dx: 1, dy: 2, to: T_ROAD }],
  structures: [{
    kind: 'hut', dx: 3, dy: 4, w: 2, h: 2, owner: 'amara',
    furnishings: [{ kind: 'bed', slot: { x: 1, y: 1 } }],
  }],
}

describe('CityTemplateSchema', () => {
  it('accepts a hand-built minimal template', () => {
    expect(() => CityTemplateSchema.parse(MINIMAL)).not.toThrow()
  })

  it('rejects an unknown key', () => {
    expect(() => CityTemplateSchema.parse({ ...MINIMAL, zoning: [] })).toThrow()
    expect(() => CityTemplateSchema.parse({
      ...MINIMAL, structures: [{ ...MINIMAL.structures[0], district: 'homes' }],
    })).toThrow()
  })

  it('rejects a footprint wider than 4', () => {
    expect(() => CityTemplateSchema.parse({
      ...MINIMAL, structures: [{ ...MINIMAL.structures[0], w: 5 }],
    })).toThrow()
  })

  // The field is required so a public building says `null` out loud; it never goes missing.
  it('rejects a missing owner but accepts a null one', () => {
    const { owner: _drop, ...noOwner } = MINIMAL.structures[0]!
    expect(() => CityTemplateSchema.parse({ ...MINIMAL, structures: [noOwner] })).toThrow()
    expect(() => CityTemplateSchema.parse({
      ...MINIMAL, structures: [{ ...MINIMAL.structures[0], owner: null }],
    })).not.toThrow()
  })

  it('rejects a furnishing without a slot', () => {
    expect(() => CityTemplateSchema.parse({
      ...MINIMAL,
      structures: [{ ...MINIMAL.structures[0], furnishings: [{ kind: 'bed' }] }],
    })).toThrow()
  })
})

describe('district geometry', () => {
  it('names exactly the four districts', () => {
    expect(DISTRICT_NAMES.sort()).toEqual(['farm', 'homes', 'market', 'riverfront'])
  })

  it('is pairwise disjoint', () => {
    for (const a of DISTRICT_NAMES)
      for (const b of DISTRICT_NAMES) {
        if (a === b) continue
        const ra = DISTRICTS[a]!, rb = DISTRICTS[b]!
        const overlaps = ra.dx0 <= rb.dx1 && rb.dx0 <= ra.dx1 && ra.dy0 <= rb.dy1 && rb.dy0 <= ra.dy1
        expect(overlaps, `${a} overlaps ${b}`).toBe(false)
      }
  })

  it('lies inside the template extent', () => {
    for (const d of DISTRICT_NAMES) {
      const r = DISTRICTS[d]!
      expect(inExtent(r.dx0, r.dy0), d).toBe(true)
      expect(inExtent(r.dx1, r.dy1), d).toBe(true)
      expect(r.dx0, d).toBeLessThanOrEqual(r.dx1)
      expect(r.dy0, d).toBeLessThanOrEqual(r.dy1)
    }
  })

  it('inRect is inclusive on both corners and rejects one past either', () => {
    const r = DISTRICTS.market
    expect(inRect(r, r.dx0, r.dy0)).toBe(true)
    expect(inRect(r, r.dx1, r.dy1)).toBe(true)
    expect(inRect(r, r.dx0 - 1, r.dy0)).toBe(false)
    expect(inRect(r, r.dx1, r.dy1 + 1)).toBe(false)
  })
})

describe('the genesis anchor', () => {
  // The standing stone and the wild need room beyond the edge of town (C11 §9).
  it('leaves at least 8 tiles of margin on every side of a 128x128 world', () => {
    const { x, y } = CITY_ANCHOR_DEFAULT
    expect(x).toBeGreaterThanOrEqual(8)
    expect(y).toBeGreaterThanOrEqual(8)
    expect(WORLD_SIZE_GENESIS - (x + CITY_W)).toBeGreaterThanOrEqual(8)
    expect(WORLD_SIZE_GENESIS - (y + CITY_H)).toBeGreaterThanOrEqual(8)
  })

  it('pins the world size it was measured against', () => {
    expect(WORLD_SIZE_GENESIS).toBe(128)
    expect([CITY_W, CITY_H]).toEqual([34, 30])
  })
})

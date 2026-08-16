import { describe, it, expect } from 'vitest'
import { ROAD_AUTOTILE_KEYS } from './autotile.js'
import {
  CityTemplateSchema, DISTRICTS, DISTRICT_NAMES, CITY_ANCHOR_DEFAULT, CITY_W, CITY_H,
  WORLD_SIZE_GENESIS, inExtent, inRect, key, cityTerrainTiles, cityRoadTiles, cityRoadKeys,
  isRoadTile, PLAZA, PLAZA_CENTRE, PATH_DX, T_ROAD, T_PATH, T_WATER,
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

describe('city roads', () => {
  const roads = cityRoadTiles()
  const terrain = cityTerrainTiles()
  const roadSet = new Set(roads.filter(isRoadTile).map(t => key(t.dx, t.dy)))

  it('lays every road tile inside the template extent', () => {
    for (const t of roads) expect(inExtent(t.dx, t.dy), key(t.dx, t.dy)).toBe(true)
  })

  it('never repeats a road tile', () => {
    expect(roadSet.size).toBe(roads.length)
  })

  // THE NO-BRIDGE LAW. The far bank is an earned milestone (C11 §2); a template author will be
  // tempted, and this is the guard.
  it('no road or path tile lies on water, and none crosses west of the template', () => {
    const water = new Set(terrain.filter(t => t.to === T_WATER).map(t => key(t.dx, t.dy)))
    expect(water.size).toBeGreaterThan(0)
    for (const t of roads) {
      expect(water.has(key(t.dx, t.dy)), `road on water at ${key(t.dx, t.dy)}`).toBe(false)
      expect(t.dx, 'road west of the template').toBeGreaterThanOrEqual(0)
    }
  })

  it('is one connected component, reachable from the market square centre', () => {
    expect(roadSet.has(key(PLAZA_CENTRE.dx, PLAZA_CENTRE.dy))).toBe(true)
    const seen = new Set<string>([key(PLAZA_CENTRE.dx, PLAZA_CENTRE.dy)])
    const stack: [number, number][] = [[PLAZA_CENTRE.dx, PLAZA_CENTRE.dy]]
    while (stack.length) {
      const [dx, dy] = stack.pop()!
      for (const [nx, ny] of [[dx, dy - 1], [dx + 1, dy], [dx, dy + 1], [dx - 1, dy]] as [number, number][]) {
        const k = key(nx, ny)
        if (roadSet.has(k) && !seen.has(k)) { seen.add(k); stack.push([nx, ny]) }
      }
    }
    expect(seen.size).toBe(roadSet.size)
  })

  it('runs the riverfront path as a contiguous north-south line down the bank', () => {
    const path = roads.filter(t => t.to === T_PATH).sort((a, b) => a.dy - b.dy)
    expect(path.length).toBe(CITY_H)
    for (let i = 0; i < path.length; i++) {
      expect(path[i]!.dx, 'the path wandered off the bank').toBe(PATH_DX)
      expect(path[i]!.dy).toBe(i)
    }
  })

  it('gives every road tile one of the fifteen autotile keys', () => {
    const keys = cityRoadKeys(roads)
    expect(keys.size).toBe(roadSet.size)
    for (const [k, v] of keys) expect(ROAD_AUTOTILE_KEYS, k).toContain(v)
  })

  // The autotiler has to be exercised by the town's own roads, not only by a test map.
  it('resolves the plaza interior to cross and its four outer corners to corner keys', () => {
    const keys = cityRoadKeys(roads)
    for (let dy = PLAZA.dy0 + 1; dy <= PLAZA.dy1 - 1; dy++)
      for (let dx = PLAZA.dx0 + 1; dx <= PLAZA.dx1 - 1; dx++)
        expect(keys.get(key(dx, dy)), key(dx, dy)).toBe('cross')
    const corners: [number, number][] = [
      [PLAZA.dx0, PLAZA.dy0], [PLAZA.dx1, PLAZA.dy0],
      [PLAZA.dx0, PLAZA.dy1], [PLAZA.dx1, PLAZA.dy1],
    ]
    for (const [dx, dy] of corners)
      expect(keys.get(key(dx, dy)), key(dx, dy)).toMatch(/^corner-/)
  })

  it('reaches all four districts', () => {
    for (const d of DISTRICT_NAMES) {
      const r = DISTRICTS[d]!
      expect(roads.some(t => inRect(r, t.dx, t.dy)), `no road in ${d}`).toBe(true)
    }
  })

  it('keeps terrain and roads on disjoint tiles', () => {
    const t = new Set(terrain.map(x => key(x.dx, x.dy)))
    expect(t.size).toBe(terrain.length)
    for (const r of roads) expect(t.has(key(r.dx, r.dy)), key(r.dx, r.dy)).toBe(false)
  })

  it('is deterministic', () => {
    expect(cityRoadTiles()).toEqual(roads)
    expect(cityTerrainTiles()).toEqual(terrain)
    expect(T_ROAD).toBe(7)
  })
})

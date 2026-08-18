import { describe, it, expect, vi } from 'vitest'
import { ROAD_AUTOTILE_KEYS } from './autotile.js'
import {
  CityTemplateSchema, DISTRICTS, DISTRICT_NAMES, CITY_ANCHOR_DEFAULT, CITY_W, CITY_H,
  WORLD_SIZE_GENESIS, inExtent, inRect, key, cityTerrainTiles, cityRoadTiles, cityRoadKeys,
  isRoadTile, PLAZA, PLAZA_CENTRE, PATH_DX, T_ROAD, T_PATH, T_WATER,
  cityStructures, doorTile, structureTiles, FOUNDER_IDS, CITY_INTERIOR_SLOTS,
  CITY_FURNISHING_KINDS, CITY_BED_KIND, CITY_HEARTH_KIND,
  makeCityTemplate, templateFits, growthPlots, T_GRASS,
  HUT_ORIGINS, WELL_AT, FIRE_PIT_AT, danglingRoadEnds, frontages,
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
  // The square's paving is laid AROUND the well and the fire pit, so its two monument tiles
  // are the only interior tiles that are not road.
  it('resolves the plaza interior to cross and its four outer corners to corner keys', () => {
    const keys = cityRoadKeys(roads)
    const monument = new Set([key(WELL_AT.dx, WELL_AT.dy), key(FIRE_PIT_AT.dx, FIRE_PIT_AT.dy)])
    // A tile that touches a monument keeps three arms, and the missing one points at it.
    const DIRS = [['n', 0, -1], ['e', 1, 0], ['s', 0, 1], ['w', -1, 0]] as const
    const expectedKey = (dx: number, dy: number): string => {
      const gone = DIRS.find(([, ox, oy]) => monument.has(key(dx + ox, dy + oy)))
      return gone === undefined ? 'cross' : `t-no-${gone[0]}`
    }
    for (let dy = PLAZA.dy0 + 1; dy <= PLAZA.dy1 - 1; dy++)
      for (let dx = PLAZA.dx0 + 1; dx <= PLAZA.dx1 - 1; dx++) {
        if (monument.has(key(dx, dy))) continue
        expect(keys.get(key(dx, dy)), key(dx, dy)).toBe(expectedKey(dx, dy))
      }
    // The tile you actually stand on, between the well and the fire, is open paving.
    expect(keys.get(key(PLAZA_CENTRE.dx, PLAZA_CENTRE.dy))).toBe('cross')
    expect(keys.get(key(WELL_AT.dx, WELL_AT.dy + 1))).toBe('t-no-n')
    expect(keys.get(key(FIRE_PIT_AT.dx, FIRE_PIT_AT.dy - 1))).toBe('t-no-s')
    // Two corners are plain corners; the other two are where the north and south approaches
    // arrive, so they carry a third arm.
    expect(keys.get(key(PLAZA.dx1, PLAZA.dy0)), 'NE').toMatch(/^corner-/)
    expect(keys.get(key(PLAZA.dx0, PLAZA.dy1)), 'SW').toMatch(/^corner-/)
    expect(keys.get(key(PLAZA.dx0, PLAZA.dy0)), 'NW, the north approach').toBe('t-no-w')
    expect(keys.get(key(PLAZA.dx1, PLAZA.dy1)), 'SE, the south approach').toBe('t-no-e')
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

describe('city structures', () => {
  const structures = cityStructures()
  const roads = cityRoadTiles()
  const roadSet = new Set(roads.filter(isRoadTile).map(t => key(t.dx, t.dy)))
  const water = new Set(cityTerrainTiles().filter(t => t.to === T_WATER).map(t => key(t.dx, t.dy)))
  const huts = structures.filter(s => s.kind === 'hut')

  it('places exactly eleven structures', () => {
    expect(structures).toHaveLength(11)
  })

  // USER RULING 1, both halves.
  it('gives each of the five huts a distinct founder owner', () => {
    expect(huts).toHaveLength(5)
    expect(huts.map(h => h.owner).sort()).toEqual([...FOUNDER_IDS].sort())
  })

  it('leaves every non-hut public — owner null, never absent', () => {
    for (const s of structures.filter(x => x.kind !== 'hut'))
      expect(s.owner, s.kind).toBeNull()
  })

  it('never overlaps another structure', () => {
    const seen = new Set<string>()
    for (const s of structures)
      for (const t of structureTiles(s)) {
        const k = key(t.dx, t.dy)
        expect(seen.has(k), `${s.kind} overlaps at ${k}`).toBe(false)
        seen.add(k)
      }
  })

  // The districts are disjoint, so "entirely inside exactly one" is the whole assertion:
  // no structure straddles a boundary and none stands in the gaps between districts.
  it('sits entirely inside exactly one district', () => {
    for (const s of structures) {
      const tiles = structureTiles(s)
      const holds = DISTRICT_NAMES.filter(d => tiles.every(t => inRect(DISTRICTS[d]!, t.dx, t.dy)))
      expect(holds, `${s.kind} at ${key(s.dx, s.dy)}`).toHaveLength(1)
    }
    // and the five huts all share the homes district
    for (const h of huts) expect(inRect(DISTRICTS.homes, h.dx, h.dy), h.owner!).toBe(true)
  })

  it('never occupies a road, a path or a water tile', () => {
    for (const s of structures)
      for (const t of structureTiles(s)) {
        expect(roadSet.has(key(t.dx, t.dy)), `${s.kind} on a road at ${key(t.dx, t.dy)}`).toBe(false)
        expect(water.has(key(t.dx, t.dy)), `${s.kind} on water at ${key(t.dx, t.dy)}`).toBe(false)
        expect(inExtent(t.dx, t.dy), `${s.kind} outside the extent`).toBe(true)
      }
  })

  it('opens every south-centre door onto a road tile', () => {
    for (const s of structures) {
      const d = doorTile(s)
      const touches = [[d.dx, d.dy - 1], [d.dx + 1, d.dy], [d.dx, d.dy + 1], [d.dx - 1, d.dy]]
        .some(([x, y]) => roadSet.has(key(x!, y!)))
      expect(touches, `${s.kind} door ${key(d.dx, d.dy)} reaches no road`).toBe(true)
      expect(structureTiles(s).some(t => t.dx === d.dx && t.dy === d.dy)).toBe(true)
    }
  })

  // C11 §9: the standing stone stands beyond the edge of town, unexplained.
  it('does not build the standing stone', () => {
    expect(structures.some(s => s.kind === 'standing_stone')).toBe(false)
  })

  it('gives every hut exactly one bed and one hearth', () => {
    for (const h of huts) {
      expect(h.furnishings.filter(f => f.kind === CITY_BED_KIND), 'bed').toHaveLength(1)
      expect(h.furnishings.filter(f => f.kind === CITY_HEARTH_KIND), 'hearth').toHaveLength(1)
    }
  })

  it('lays every furnishing on its own slot inside the interior grid', () => {
    for (const s of structures) {
      const seen = new Set<string>()
      for (const f of s.furnishings) {
        expect(f.slot.x, `${s.kind} ${f.kind}`).toBeGreaterThanOrEqual(0)
        expect(f.slot.y, `${s.kind} ${f.kind}`).toBeGreaterThanOrEqual(0)
        expect(f.slot.x, `${s.kind} ${f.kind}`).toBeLessThan(CITY_INTERIOR_SLOTS.w)
        expect(f.slot.y, `${s.kind} ${f.kind}`).toBeLessThan(CITY_INTERIOR_SLOTS.h)
        const k = key(f.slot.x, f.slot.y)
        expect(seen.has(k), `${s.kind} stacks two furnishings on ${k}`).toBe(false)
        seen.add(k)
      }
    }
  })

  // The stand-in for the cross-package check; Task 28 asserts this list against the library.
  it('furnishes only kinds the stand-in list declares', () => {
    for (const s of structures)
      for (const f of s.furnishings)
        expect(CITY_FURNISHING_KINDS, `${s.kind} ${f.kind}`).toContain(f.kind)
    const used = new Set(structures.flatMap(s => s.furnishings.map(f => f.kind)))
    expect([...used].sort()).toEqual([...CITY_FURNISHING_KINDS].sort())
  })

  it('is deterministic', () => {
    expect(cityStructures()).toEqual(structures)
  })
})

describe('makeCityTemplate', () => {
  const t = makeCityTemplate()

  it('returns a template that parses the schema', () => {
    expect(() => CityTemplateSchema.parse(t)).not.toThrow()
    expect(t.anchor).toEqual(CITY_ANCHOR_DEFAULT)
  })

  it('is deterministic across calls and unaffected by the other exports', () => {
    expect(makeCityTemplate()).toEqual(t)
    cityRoadTiles(); cityTerrainTiles(); cityStructures(); growthPlots(t)
    expect(makeCityTemplate()).toEqual(t)
  })

  it('never consults an RNG', () => {
    const spy = vi.spyOn(Math, 'random')
    makeCityTemplate()
    growthPlots(makeCityTemplate())
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('stamps each tile once, inside the extent', () => {
    const seen = new Set<string>()
    for (const x of t.tiles) {
      expect(inExtent(x.dx, x.dy), key(x.dx, x.dy)).toBe(true)
      expect(seen.has(key(x.dx, x.dy)), `stamped twice at ${key(x.dx, x.dy)}`).toBe(false)
      seen.add(key(x.dx, x.dy))
    }
  })

  it('lands entirely inside a 128x128 world at the genesis anchor', () => {
    for (const x of t.tiles) {
      expect(t.anchor.x + x.dx).toBeGreaterThanOrEqual(0)
      expect(t.anchor.x + x.dx).toBeLessThan(WORLD_SIZE_GENESIS)
      expect(t.anchor.y + x.dy).toBeGreaterThanOrEqual(0)
      expect(t.anchor.y + x.dy).toBeLessThan(WORLD_SIZE_GENESIS)
    }
    for (const s of t.structures)
      for (const c of structureTiles(s)) {
        expect(t.anchor.x + c.dx).toBeLessThan(WORLD_SIZE_GENESIS)
        expect(t.anchor.y + c.dy).toBeLessThan(WORLD_SIZE_GENESIS)
      }
  })

  it('templateFits is the caller guard, and it refuses an anchor that runs off the map', () => {
    expect(templateFits(CITY_ANCHOR_DEFAULT, WORLD_SIZE_GENESIS)).toBe(true)
    expect(templateFits({ x: 100, y: 100 }, WORLD_SIZE_GENESIS)).toBe(false)
    expect(templateFits({ x: -1, y: 0 }, WORLD_SIZE_GENESIS)).toBe(false)
    expect(templateFits({ x: WORLD_SIZE_GENESIS - CITY_W, y: WORLD_SIZE_GENESIS - CITY_H }, WORLD_SIZE_GENESIS)).toBe(true)
  })

  it('clears at least one growth plot in every district', () => {
    const plots = growthPlots(t)
    expect(plots.length).toBeGreaterThan(0)
    for (const d of DISTRICT_NAMES)
      expect(plots.some(p => inRect(DISTRICTS[d]!, p.dx, p.dy)), `no plot in ${d}`).toBe(true)
  })

  it('every plot is empty cleared grass beside a road, and none is under a structure', () => {
    const plots = growthPlots(t)
    const grass = new Set(t.tiles.filter(x => x.to === T_GRASS).map(x => key(x.dx, x.dy)))
    const roads = new Set(t.tiles.filter(isRoadTile).map(x => key(x.dx, x.dy)))
    const built = new Set(t.structures.flatMap(s => structureTiles(s).map(c => key(c.dx, c.dy))))
    for (const p of plots) {
      expect(grass.has(key(p.dx, p.dy)), `${key(p.dx, p.dy)} is not cleared grass`).toBe(true)
      expect(built.has(key(p.dx, p.dy)), `${key(p.dx, p.dy)} is under a structure`).toBe(false)
      expect([[0, -1], [1, 0], [0, 1], [-1, 0]]
        .some(([ox, oy]) => roads.has(key(p.dx + ox!, p.dy + oy!))), `${key(p.dx, p.dy)} touches no road`).toBe(true)
    }
  })

  it('carries the eleven structures and the road set into the assembled template', () => {
    expect(t.structures).toEqual(cityStructures())
    expect(t.tiles.filter(isRoadTile)).toEqual(cityRoadTiles())
  })
})

// ------------------------------------------------------- the town, read as a designed place
//
// U3: "doesn't have an actual genuine structure. It just looks like chaos." Read as a plan the
// old template was not chaos, but it was a grid with no centre and no frontage: five identical
// huts in one straight line, a well and a fire pit sitting BESIDE the square rather than in it,
// two identical sheds four rows apart, and roads that stopped in the grass. Each design move
// below is stated as an invariant a test can check.

describe('a centre that reads as a centre', () => {
  const t = makeCityTemplate()
  const roads = new Set(t.tiles.filter(isRoadTile).map(x => key(x.dx, x.dy)))

  it('stands the well and the fire pit INSIDE the square', () => {
    expect(inRect(PLAZA, WELL_AT.dx, WELL_AT.dy)).toBe(true)
    expect(inRect(PLAZA, FIRE_PIT_AT.dx, FIRE_PIT_AT.dy)).toBe(true)
  })

  it('puts both of them on the square own axis', () => {
    for (const m of [WELL_AT, FIRE_PIT_AT] as ReadonlyArray<{ dx: number; dy: number }>)
      expect(m.dx === PLAZA_CENTRE.dx || m.dy === PLAZA_CENTRE.dy, `${m.dx},${m.dy}`).toBe(true)
  })

  it('faces them across the centre you actually stand on', () => {
    expect(WELL_AT.dy).toBeLessThan(PLAZA_CENTRE.dy)
    expect(FIRE_PIT_AT.dy).toBeGreaterThan(PLAZA_CENTRE.dy)
    expect(roads.has(key(PLAZA_CENTRE.dx, PLAZA_CENTRE.dy))).toBe(true)
  })

  it('lays the paving around them, so neither stands on a road', () => {
    expect(roads.has(key(WELL_AT.dx, WELL_AT.dy))).toBe(false)
    expect(roads.has(key(FIRE_PIT_AT.dx, FIRE_PIT_AT.dy))).toBe(false)
  })
})

describe('frontage', () => {
  const t = makeCityTemplate()

  it('opens every single door onto a road', () => {
    const f = frontages(t)
    expect(f).toHaveLength(t.structures.length)
    for (const x of f)
      expect(x.onto, `${x.kind} at ${x.door.dx},${x.door.dy} faces nothing`).not.toBeNull()
  })
})

describe('a street, not a row', () => {
  const t = makeCityTemplate()

  it('stands the five huts in two facing ranks, not one line', () => {
    expect(HUT_ORIGINS).toEqual([[14, 4], [18, 4], [22, 4], [19, 7], [23, 7]])
    expect(HUT_ORIGINS.filter(([, dy]) => dy === 4)).toHaveLength(3)
    expect(HUT_ORIGINS.filter(([, dy]) => dy === 7)).toHaveLength(2)
  })

  it('runs the shared yard street between the two ranks', () => {
    const roads = new Set(t.tiles.filter(isRoadTile).map(x => key(x.dx, x.dy)))
    for (let dx = 14; dx <= 22; dx++) expect(roads.has(key(dx, 6)), `yard ${dx},6`).toBe(true)
  })

  it('staggers the ranks so no two doors look straight down each other', () => {
    const huts = cityStructures().filter(s => s.kind === 'hut')
    const doorsAt = (dy: number): number[] =>
      huts.filter(s => s.dy === dy).map(s => doorTile(s).dx).sort((a, b) => a - b)
    expect(doorsAt(4).some(dx => doorsAt(7).includes(dx)), 'a door faces a door').toBe(false)
  })
})

describe('paths that lead somewhere', () => {
  const t = makeCityTemplate()

  it('never ends a road in the grass', () => {
    expect(danglingRoadEnds(t)).toEqual([])
  })

  it('finds a dangling end when one is planted, so the check is not vacuous', () => {
    const stub = {
      ...t, tiles: [...t.tiles, { dx: 9, dy: 12, to: T_ROAD }, { dx: 9, dy: 13, to: T_ROAD }],
    }
    expect(danglingRoadEnds(stub).length).toBeGreaterThan(0)
  })
})

describe('districts you can point at', () => {
  const t = makeCityTemplate()
  const districtOf = (s: { dx: number; dy: number; w: number; h: number }): string | undefined =>
    DISTRICT_NAMES.find(d => structureTiles(s as never).every(x => inRect(DISTRICTS[d]!, x.dx, x.dy)))

  it('gives every district at least one building of its own', () => {
    for (const d of DISTRICT_NAMES)
      expect(t.structures.some(s => districtOf(s) === d), `${d} has no building`).toBe(true)
  })

  it('no longer stands the two sheds in one district as a matched pair', () => {
    const sheds = t.structures.filter(s => s.kind === 'shed')
    expect(sheds).toHaveLength(2)
    expect(districtOf(sheds[0]!)).not.toBe(districtOf(sheds[1]!))
  })
})

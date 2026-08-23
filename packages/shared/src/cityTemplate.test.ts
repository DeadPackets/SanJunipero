import { describe, it, expect, vi } from 'vitest'
import { ROAD_AUTOTILE_KEYS } from './autotile.js'
import { DEFAULT_CONFIG } from './config.js'
import {
  CityTemplateSchema, CITY_ANCHOR_DEFAULT, CITY_W, CITY_H, TOWN_ORIGIN, TOWN_RINGS_GENESIS,
  townOrigin, townSpan, RIVER_LOCAL_DX, RIVER_HALF, BANK_HALF, cityGroundAt, CITY_GROUND,
  WORLD_SIZE_GENESIS, inExtent, inRect, key, cityTerrainTiles, cityRoadTiles, cityRoadKeys,
  isRoadTile, PLAZA, PLAZA_CENTRE, T_ROAD, T_WATER, T_EARTH,
  cityStructures, cityPlacements, cityBlocks, cityFreePlots, doorTile, doorFrontTile,
  structureTiles, FOUNDER_IDS, CITY_INTERIOR_SLOTS,
  CITY_FURNISHING_KINDS, CITY_BED_KIND, CITY_HEARTH_KIND,
  makeCityTemplate, templateFits, growthPlots, T_GRASS, footprintFor,
  WELL_AT, FIRE_PIT_AT, danglingRoadEnds, frontages, GENESIS_WANTED,
  CITY_DWELLING_KINDS, DWELLING_FOOTPRINTS, isDwellingKind,
  touchingStructures, structureComponents, plazaArrivals, dwellingRanks, longestKindRun,
  dwellingGaps,
} from './cityTemplate.js'
import {
  BLOCK, MAX_ALONG, MAX_DEEP, PITCH, STREET, TOWN_FACINGS, blockTiles, closestPair, freePlots,
  place, placedTiles, plattedBlocks, streetTiles, townErrors,
} from './townGrammar.js'
import { claimAll, plotKey } from './townClaim.js'

const MINIMAL = {
  anchor: { x: 0, y: 0 },
  tiles: [{ dx: 1, dy: 2, to: T_ROAD }],
  structures: [{
    kind: 'house', dx: 3, dy: 4, w: 2, h: 2, owner: 'amara', facing: 'sw',
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

// ★ FACING IS DATA, NOT INFERENCE.
//
// `facingFrom(dx, dy)` derives a facing from a delta and can answer `ne` or `nw`, for which
// the forge has no art at all. That function is right for a WALKING BODY, which turns four
// ways; it was never right for a building, which the user ruled turns two. So the template
// carries the answer in a column and nothing infers it — and because the column is a two-value
// enum, NE and NW are not merely unused here, they are unrepresentable.
describe('every building says which way it faces', () => {
  it('carries a facing on every structure, and only ever one of the two', () => {
    for (const s of cityStructures())
      expect(TOWN_FACINGS as readonly string[], `${s.kind} at ${key(s.dx, s.dy)}`).toContain(s.facing)
  })

  it('refuses a facing the forge has no art for', () => {
    for (const bad of ['ne', 'nw', 'north', ''])
      expect(() => CityTemplateSchema.parse({
        ...MINIMAL, structures: [{ ...MINIMAL.structures[0], facing: bad }],
      }), bad).toThrow()
  })

  it('refuses a structure with no facing at all — the column is required', () => {
    const { facing: _drop, ...noFacing } = MINIMAL.structures[0]!
    expect(() => CityTemplateSchema.parse({ ...MINIMAL, structures: [noFacing] })).toThrow()
  })

  // The forge's coverage gate is written to read this column and tighten the moment it says
  // something other than the default. The town turns buildings both ways, so it does.
  it('stands buildings BOTH ways, which is what tightens the art gate', () => {
    const placed = new Set(cityPlacements().map((s) => s.facing))
    expect([...placed].sort()).toEqual(['se', 'sw'])
  })

  // This is the assertion that makes the column MEAN something rather than merely being
  // present and ignored: the door is on the face the column names, and that face is a road.
  it('puts each door on the face its column names, and that face is a street', () => {
    const roads = new Set(cityRoadTiles().filter(isRoadTile).map(t => key(t.dx, t.dy)))
    for (const s of cityStructures()) {
      if (s.w === 1 && s.h === 1) continue          // the well and the fire pit have no door
      const front = doorFrontTile(s)
      expect(roads.has(key(front.dx, front.dy)),
        `${s.kind} says ${s.facing} but ${key(front.dx, front.dy)} is not a road`).toBe(true)
      expect(structureTiles(s).some(t => t.dx === front.dx && t.dy === front.dy),
        'the door tile is outside the building, on its street').toBe(false)
    }
  })
})

describe('the lattice the template plats on', () => {
  it('derives its extent from the ring count, and from nothing else', () => {
    expect(TOWN_RINGS_GENESIS).toBe(1)
    expect(townOrigin(1)).toBe(PITCH + STREET)
    expect(townSpan(1)).toBe(2 * (PITCH + STREET) + BLOCK)
    expect([CITY_W, CITY_H]).toEqual([60, 60])
    expect(TOWN_ORIGIN).toBe(22)
    // A bigger town is a bigger number here and NOT a different function.
    expect(townSpan(3)).toBe(136)
  })

  // ★ A RIVER IS A REASON FOR THE TOWN'S SHAPE. Three of the eight blocks ring 1 could plat
  // stand in the channel, so they are not platted and the west of the town is riverfront.
  it('plats five of the eight blocks, because three of them are in the river', () => {
    expect(cityBlocks().map(b => `${b.i},${b.j}`)).toEqual(['0,-1', '0,1', '1,0', '1,-1', '1,1'])
    expect(plattedBlocks(1, () => 'dry'), 'without a river all eight plat').toHaveLength(8)
  })

  it('never plats the square', () => {
    expect(cityBlocks().some(b => b.i === 0 && b.j === 0)).toBe(false)
  })

  it('runs a three-tile channel with a tile of wet bank either side', () => {
    expect(cityGroundAt(RIVER_LOCAL_DX)).toBe('water')
    expect(cityGroundAt(RIVER_LOCAL_DX + RIVER_HALF)).toBe('water')
    expect(cityGroundAt(RIVER_LOCAL_DX + BANK_HALF)).toBe('bank')
    expect(cityGroundAt(RIVER_LOCAL_DX + BANK_HALF + 1)).toBe('dry')
    expect(cityGroundAt(RIVER_LOCAL_DX - BANK_HALF)).toBe('bank')
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

  // The anchor's ONE job beyond fitting: put the town's channel on the world's channel, so
  // the map has one river in it rather than two. `world.test.ts` holds the other half, where
  // `GENESIS_RIVER_X` can be named; here it is pinned as a number so a drift shows on both
  // sides at once.
  it('lands the town channel on world column 49', () => {
    expect(CITY_ANCHOR_DEFAULT.x + RIVER_LOCAL_DX).toBe(49)
  })

  it('pins the world size it was measured against', () => {
    expect(WORLD_SIZE_GENESIS).toBe(128)
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
  it('no road tile lies on water, and the water is really there', () => {
    const water = new Set(terrain.filter(t => t.to === T_WATER).map(t => key(t.dx, t.dy)))
    expect(water.size).toBe(3 * CITY_H)
    for (const t of roads) {
      expect(water.has(key(t.dx, t.dy)), `road on water at ${key(t.dx, t.dy)}`).toBe(false)
      expect(t.dx, 'road west of the template').toBeGreaterThanOrEqual(0)
    }
  })

  // ★ A PHANTOM ROAD ROW once ran straight through the frontage of a block, putting buildings
  // on roads. It came from a special case that widened the main street, and the fix was
  // DELETING the special case. This is the guard that keeps one from coming back.
  it('never lays a street tile on a block', () => {
    const onBlock = new Set(cityBlocks().flatMap(b =>
      blockTiles(b.i, b.j).map(t => key(t.dx + TOWN_ORIGIN, t.dy + TOWN_ORIGIN))))
    for (const t of roads)
      expect(onBlock.has(key(t.dx, t.dy)), `a street on a block at ${key(t.dx, t.dy)}`).toBe(false)
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

  it('gives every road tile one of the fifteen autotile keys', () => {
    const keys = cityRoadKeys(roads)
    expect(keys.size).toBe(roadSet.size)
    for (const [k, v] of keys) expect(ROAD_AUTOTILE_KEYS, k).toContain(v)
  })

  // ★ THE LATTICE IS REGULAR BY CONSTRUCTION and that is a FEATURE: three-tile streets meet in
  // crosses, tees and corners and never in a lane or a dead end, so the nine shapes below are
  // the nine a town of this grammar can ask for. The remaining six belong to a renderer
  // fixture, not to a town — see `web/src/render/g10.test.ts`.
  it('asks for the nine shapes a regular three-tile lattice makes, and no others', () => {
    const seen = new Set(cityRoadKeys(roads).values())
    expect([...seen].sort()).toEqual([
      'corner-es', 'corner-ne', 'corner-sw', 'corner-wn',
      'cross', 't-no-e', 't-no-n', 't-no-s', 't-no-w',
    ])
  })

  // The square's paving is laid AROUND the well and the fire pit, so its two monument tiles
  // are the only interior tiles that are not road — and each one turns its four neighbours
  // into tees, which is what makes a monument read as a thing you walk around.
  it('resolves the square interior to cross, and the monuments to tees around them', () => {
    const keys = cityRoadKeys(roads)
    const monument = new Set([key(WELL_AT.dx, WELL_AT.dy), key(FIRE_PIT_AT.dx, FIRE_PIT_AT.dy)])
    const DIRS = [['n', 0, -1], ['e', 1, 0], ['s', 0, 1], ['w', -1, 0]] as const
    for (let dy = PLAZA.dy0 + 1; dy <= PLAZA.dy1 - 1; dy++)
      for (let dx = PLAZA.dx0 + 1; dx <= PLAZA.dx1 - 1; dx++) {
        if (monument.has(key(dx, dy))) continue
        const gone = DIRS.find(([, ox, oy]) => monument.has(key(dx + ox, dy + oy)))
        expect(keys.get(key(dx, dy)), key(dx, dy)).toBe(gone === undefined ? 'cross' : `t-no-${gone[0]}`)
      }
    expect(keys.get(key(PLAZA_CENTRE.dx, PLAZA_CENTRE.dy))).toBe('cross')
    expect(keys.get(key(WELL_AT.dx, WELL_AT.dy + 1))).toBe('t-no-n')
    expect(keys.get(key(FIRE_PIT_AT.dx, FIRE_PIT_AT.dy - 1))).toBe('t-no-s')
  })

  it('keeps terrain and roads on disjoint tiles, and covers the extent between them', () => {
    const t = new Set(terrain.map(x => key(x.dx, x.dy)))
    expect(t.size).toBe(terrain.length)
    for (const r of roads) expect(t.has(key(r.dx, r.dy)), key(r.dx, r.dy)).toBe(false)
    expect(t.size + roads.length, 'the town leaves a tile of its own extent unauthored')
      .toBe(CITY_W * CITY_H)
  })

  it('is deterministic', () => {
    expect(cityRoadTiles()).toEqual(roads)
    expect(cityTerrainTiles()).toEqual(terrain)
    expect(T_ROAD).toBe(7)
  })

  // The town clears its own ground: no forest, no rock, no hillside under a street.
  it('authors every tile as water, wet bank or cleared grass, and nothing else', () => {
    expect(new Set(terrain.map(x => x.to))).toEqual(new Set([T_WATER, T_EARTH, T_GRASS]))
  })
})

describe('the four dwelling kinds', () => {
  it('names exactly the contracted list, in order', () => {
    expect([...CITY_DWELLING_KINDS]).toEqual(['cottage', 'farmhouse', 'cabin', 'house'])
  })

  it('holds the founders home kind as a first-class member', () => {
    expect((CITY_DWELLING_KINDS as readonly string[])).toContain('house')
    expect(isDwellingKind('house')).toBe(true)
    expect((CITY_DWELLING_KINDS as readonly string[])).not.toContain('hut')
    expect(isDwellingKind('hut')).toBe(false)
  })

  // ★ THE TABLE IS THE UNTURNED FOOTPRINT: `w` along the street, `h` into the block. The same
  // farmhouse is 4×2 on a south plot and 2×4 on an east one — one building, two ground shapes
  // — and `footprintFor` is the only correct way to ask which.
  it('measures each kind along the street and into the block', () => {
    const areas = CITY_DWELLING_KINDS.map((k) => {
      const f = DWELLING_FOOTPRINTS[k]
      expect(f, k).toBeDefined()
      expect(f.w, k).toBeLessThanOrEqual(MAX_ALONG)
      expect(f.h, k).toBeLessThanOrEqual(MAX_DEEP)
      return f.w * f.h
    })
    expect(areas.sort((a, b) => a - b)).toEqual([4, 4, 6, 8])
    expect(new Set(areas).size, 'the town has fewer than three house masses').toBe(3)
  })

  it('turns the footprint with the building, and only then', () => {
    expect(footprintFor(DWELLING_FOOTPRINTS.farmhouse, 'sw')).toEqual({ w: 4, h: 2 })
    expect(footprintFor(DWELLING_FOOTPRINTS.farmhouse, 'se')).toEqual({ w: 2, h: 4 })
  })

  it('is the one place that answers "is this a dwelling"', () => {
    expect(isDwellingKind('cottage')).toBe(true)
    expect(isDwellingKind('storehouse')).toBe(false)
  })

  it('stands every dwelling on its contracted mass, turned to suit its plot', () => {
    for (const s of cityStructures()) {
      if (!isDwellingKind(s.kind)) continue
      const f = DWELLING_FOOTPRINTS[s.kind]
      const want = footprintFor(f, s.facing)
      expect({ w: s.w, h: s.h }, `${s.kind} facing ${s.facing}`).toEqual(want)
    }
  })
})

describe('city structures', () => {
  const structures = cityStructures()
  const roads = cityRoadTiles()
  const roadSet = new Set(roads.filter(isRoadTile).map(t => key(t.dx, t.dy)))
  const water = new Set(cityTerrainTiles().filter(t => t.to === T_WATER).map(t => key(t.dx, t.dy)))
  const houses = structures.filter(s => s.kind === 'house')

  it('places exactly eleven structures: nine on claimed plots, two in the square', () => {
    expect(structures).toHaveLength(11)
    expect(cityPlacements()).toHaveLength(GENESIS_WANTED.length)
    expect(GENESIS_WANTED).toHaveLength(9)
  })

  // ★ THE TOWN IS A LIST OF BUILDINGS, NOT A LIST OF POSITIONS. Nothing in this file names a
  // coordinate for a building: each one claims the free plot nearest the square, in order.
  it('stands every building on a plot it claimed, one plot each', () => {
    const claimed = cityPlacements().map(plotKey)
    expect(new Set(claimed).size).toBe(claimed.length)
    const offered = new Set(freePlots(TOWN_RINGS_GENESIS, CITY_GROUND).map(plotKey))
    for (const k of claimed) expect(offered.has(k), `${k} was never offered`).toBe(true)
  })

  it('replays to exactly the same town, from the same list', () => {
    expect(claimAll({ ground: CITY_GROUND, wanted: GENESIS_WANTED }).built).toEqual(cityPlacements())
  })

  // USER RULING 1, both halves.
  it('gives each of the five houses a distinct founder owner', () => {
    expect(houses).toHaveLength(5)
    expect(houses.map(h => h.owner).sort()).toEqual([...FOUNDER_IDS].sort())
  })

  it('leaves every non-house public — owner null, never absent', () => {
    for (const s of structures.filter(x => x.kind !== 'house'))
      expect(s.owner, s.kind).toBeNull()
  })

  // ONLY A HOUSE IS A HOME, and the reason is a pinned gate: `enterableKinds` and
  // `sleepableKinds` live in SimConfigSchema, whose hash is the `forge` pin. A founder housed
  // in a cottage could not open their own door.
  it('houses every founder in a kind the engine can let them into', () => {
    const enterable = new Set(DEFAULT_CONFIG.structures.enterableKinds)
    const sleepable = new Set(DEFAULT_CONFIG.structures.sleepableKinds)
    for (const s of structures.filter(x => x.owner !== null)) {
      expect(enterable.has(s.kind), `${s.owner} cannot enter their ${s.kind}`).toBe(true)
      expect(sleepable.has(s.kind), `${s.owner} cannot sleep in their ${s.kind}`).toBe(true)
    }
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

  it('never occupies a road or a water tile', () => {
    for (const s of structures)
      for (const t of structureTiles(s)) {
        expect(roadSet.has(key(t.dx, t.dy)), `${s.kind} on a road at ${key(t.dx, t.dy)}`).toBe(false)
        expect(water.has(key(t.dx, t.dy)), `${s.kind} on water at ${key(t.dx, t.dy)}`).toBe(false)
        expect(inExtent(t.dx, t.dy), `${s.kind} outside the extent`).toBe(true)
      }
  })

  // C11 §9: the standing stone stands beyond the edge of town, unexplained.
  it('does not build the standing stone', () => {
    expect(structures.some(s => s.kind === 'standing_stone')).toBe(false)
  })

  it('gives every home exactly one bed and one hearth', () => {
    for (const h of houses) {
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
    expect([...used].sort()).toEqual(['barrel', 'bed', 'chair', 'crate', 'hearth', 'rug', 'shelf', 'table'])
    expect([...CITY_FURNISHING_KINDS].sort())
      .toEqual(['anvil', 'barrel', 'bed', 'bench', 'chair', 'crate', 'hearth', 'rug', 'shelf', 'table'])
  })

  it('is deterministic', () => {
    expect(cityStructures()).toEqual(structures)
  })
})

// ★ THE SPACING INVARIANT, AS THE TOWN ACTUALLY STANDS. The exhaustive proof is in
// `townGrammar.test.ts`; this is the instance of it, measured.
describe('★ the town this grammar builds, measured', () => {
  it('holds its closest pair at the reference ring-1 distance', () => {
    expect(closestPair(cityPlacements())).toBeCloseTo(125.2198, 3)
  })

  it('has no error of any kind in it', () => {
    expect(townErrors(cityPlacements(), streetTiles(TOWN_RINGS_GENESIS, CITY_GROUND), CITY_GROUND))
      .toEqual([])
  })

  // ★ NOT "THIS TOWN IS CLEAN" — "no town this template can grow is anything else". Every
  // legal building on every plot the template's ground can ever offer, out to ring 4.
  it('could not put a building on water or off a street on ANY plot, out to ring 4', () => {
    const water = new Set<string>()
    const doorless: string[] = []
    for (let rings = 1; rings <= 4; rings++) {
      const road = new Set(streetTiles(rings, CITY_GROUND).map(t => key(t.dx, t.dy)))
      for (const p of freePlots(rings, CITY_GROUND))
        for (let along = 1; along <= MAX_ALONG; along++)
          for (let deep = 1; deep <= MAX_DEEP; deep++) {
            const s = place(p, 'x', along, deep, null)
            for (const t of placedTiles(s))
              if (CITY_GROUND(t.dx, t.dy) === 'water') water.add(key(t.dx, t.dy))
            const d = doorFrontTile({ ...s, furnishings: [] })
            if (!road.has(key(d.dx, d.dy))) doorless.push(`${plotKey(p)} ${along}×${deep}`)
          }
    }
    expect([...water]).toEqual([])
    expect(doorless).toEqual([])
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

  it('carries the eleven structures and the road set into the assembled template', () => {
    expect(t.structures).toEqual(cityStructures())
    expect(t.tiles.filter(isRoadTile)).toEqual(cityRoadTiles())
  })
})

// ★ A PLOT IS A CLAIMABLE THING — not "grass that happens to be beside a road".
describe('the plots agents will build on', () => {
  const t = makeCityTemplate()

  it('offers every plot the town has not built on, and no others', () => {
    const plots = cityFreePlots(t)
    expect(plots).toHaveLength(freePlots(TOWN_RINGS_GENESIS, CITY_GROUND).length - GENESIS_WANTED.length)
    expect(plots).toHaveLength(11)
    const built = new Set(cityPlacements().map(plotKey))
    for (const p of plots) expect(built.has(plotKey(p)), `${plotKey(p)} is built on`).toBe(false)
  })

  it('gives each one a facing, so what gets built there already knows which way it turns', () => {
    for (const p of cityFreePlots(t))
      expect(TOWN_FACINGS as readonly string[]).toContain(p.facing)
  })

  it('leaves every plot on cleared grass beside a street, and under nothing', () => {
    const grass = new Set(t.tiles.filter(x => x.to === T_GRASS).map(x => key(x.dx, x.dy)))
    const roads = new Set(t.tiles.filter(isRoadTile).map(x => key(x.dx, x.dy)))
    const built = new Set(t.structures.flatMap(s => structureTiles(s).map(c => key(c.dx, c.dy))))
    for (const p of growthPlots(t)) {
      expect(grass.has(key(p.dx, p.dy)), `${key(p.dx, p.dy)} is not cleared grass`).toBe(true)
      expect(built.has(key(p.dx, p.dy)), `${key(p.dx, p.dy)} is under a structure`).toBe(false)
      expect([[0, -1], [1, 0], [0, 1], [-1, 0]]
        .some(([ox, oy]) => roads.has(key(p.dx + ox!, p.dy + oy!))), `${key(p.dx, p.dy)} touches no road`).toBe(true)
    }
  })
})

describe('a centre that reads as a centre', () => {
  const t = makeCityTemplate()
  const roads = new Set(t.tiles.filter(isRoadTile).map(x => key(x.dx, x.dy)))

  it('is the square the grammar never plats, and it is paved', () => {
    expect(PLAZA).toEqual({ dx0: TOWN_ORIGIN, dy0: TOWN_ORIGIN, dx1: TOWN_ORIGIN + BLOCK - 1, dy1: TOWN_ORIGIN + BLOCK - 1 })
    expect(roads.has(key(PLAZA_CENTRE.dx, PLAZA_CENTRE.dy))).toBe(true)
  })

  it('stands the well and the fire pit INSIDE it, either side of the tile you stand on', () => {
    expect(inRect(PLAZA, WELL_AT.dx, WELL_AT.dy)).toBe(true)
    expect(inRect(PLAZA, FIRE_PIT_AT.dx, FIRE_PIT_AT.dy)).toBe(true)
    expect(WELL_AT.dy).toBeLessThan(PLAZA_CENTRE.dy)
    expect(FIRE_PIT_AT.dy).toBeGreaterThan(PLAZA_CENTRE.dy)
  })

  it('lays the paving around them, so neither stands on a road', () => {
    expect(roads.has(key(WELL_AT.dx, WELL_AT.dy))).toBe(false)
    expect(roads.has(key(FIRE_PIT_AT.dx, FIRE_PIT_AT.dy))).toBe(false)
  })

  it('builds on no tile of the square at all', () => {
    for (const s of t.structures.filter(x => x.w > 1 || x.h > 1))
      for (const c of structureTiles(s))
        expect(inRect(PLAZA, c.dx, c.dy), `${s.kind} in the square`).toBe(false)
  })
})

// ★ THE FIVE PROPERTIES. "It does not look like a town" is a feeling; these are the five
// things that feeling is made of, each one a function of the template and nothing else.

describe('PROPERTY 1 — buildings front onto something', () => {
  const t = makeCityTemplate()

  it('opens every single door onto a road', () => {
    const f = frontages(t)
    expect(f).toHaveLength(t.structures.length)
    for (const x of f)
      expect(x.onto, `${x.kind} at ${x.door.dx},${x.door.dy} faces nothing`).not.toBeNull()
  })

  // Not the back of a neighbour: every building has ground on every side of it.
  it('never lets one building touch another', () => {
    expect(touchingStructures(t)).toEqual([])
  })

  it('finds a touch when one is planted, so the check is not vacuous', () => {
    const s = t.structures.find(x => x.kind === 'storehouse')!
    const stub = { ...t, structures: [...t.structures, { ...s, dx: s.dx + s.w, kind: 'shed', w: 1, h: 1 }] }
    expect(touchingStructures(stub).length).toBeGreaterThan(0)
  })

  // In this projection moving equally in +dx and +dy is PURE DEPTH, so a building directly
  // behind another is a building you cannot see. Two doors on one line is the array-space
  // signature of that, and the block-and-plot lattice cannot produce it.
  it('never puts one door directly behind another', () => {
    const fronts = t.structures.filter(s => s.w > 1 || s.h > 1).map(doorFrontTile)
    expect(new Set(fronts.map(d => key(d.dx, d.dy))).size).toBe(fronts.length)
    for (const a of fronts)
      for (const b of fronts) {
        if (a === b) continue
        expect(a.dx - a.dy === b.dx - b.dy && a.dx + a.dy !== b.dx + b.dy,
          `${key(a.dx, a.dy)} is straight behind ${key(b.dx, b.dy)}`).toBe(false)
      }
  })
})

describe('PROPERTY 2 — roads connect the places people go', () => {
  const t = makeCityTemplate()

  it('puts every structure in ONE road-connected group', () => {
    const groups = structureComponents(t)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toHaveLength(t.structures.length)
  })

  it('splits the group when a building is stranded, so the check is not vacuous', () => {
    const stub = { ...t, structures: [...t.structures, {
      kind: 'shed', dx: 1, dy: 55, w: 1, h: 1, owner: null, facing: 'sw' as const, furnishings: [],
    }] }
    expect(structureComponents(stub).length).toBeGreaterThan(1)
  })

  it('never ends a road in the grass', () => {
    expect(danglingRoadEnds(t)).toEqual([])
  })

  it('finds a dangling end when one is planted, so the check is not vacuous', () => {
    const stub = {
      ...t, tiles: [...t.tiles, { dx: 13, dy: 12, to: T_ROAD }, { dx: 13, dy: 13, to: T_ROAD }],
    }
    expect(danglingRoadEnds(stub).length).toBeGreaterThan(0)
  })
})

describe('PROPERTY 3 — variety of mass', () => {
  const t = makeCityTemplate()
  const houses = t.structures.filter(s => isDwellingKind(s.kind))

  it('stands all four contracted kinds, not one building repeated', () => {
    expect(new Set(houses.map(s => s.kind))).toEqual(new Set(CITY_DWELLING_KINDS))
  })

  // N = 2. A pair of a kind reads as two neighbours; three reads as a terrace, and five
  // identical in a line was the user's complaint.
  it('never stands more than two of one kind in a row on a street', () => {
    expect(longestKindRun(t)).toBeLessThanOrEqual(2)
  })

  it('counts a longer run when one is planted, so the ruling is not vacuous', () => {
    const three = { ...t, structures: [0, 1, 2].map(n => ({
      ...t.structures.find(s => s.kind === 'cabin')!,
      facing: 'sw' as const, w: 2, h: 2, dx: 24 + n * 3, dy: 17,
    })) }
    expect(longestKindRun(three)).toBe(3)
  })

  it('gives the town three different house masses to look at', () => {
    expect(new Set(houses.map(s => s.w * s.h)).size, 'every house covers the same ground').toBe(3)
  })
})

describe('PROPERTY 4 — a centre streets arrive at', () => {
  const t = makeCityTemplate()

  it('is reached from all four sides', () => {
    expect([...new Set(plazaArrivals(t).map(a => a.side))].sort()).toEqual(['e', 'n', 's', 'w'])
  })

  it('lands each arrival on the square itself, not beside it', () => {
    const roads = new Set(t.tiles.filter(isRoadTile).map(x => key(x.dx, x.dy)))
    for (const a of plazaArrivals(t)) {
      expect(inRect(PLAZA, a.from.dx, a.from.dy), `${a.side} arrival is inside the square`).toBe(false)
      expect(roads.has(key(a.from.dx, a.from.dy))).toBe(true)
    }
  })
})

describe('PROPERTY 5 — plots and gaps', () => {
  const t = makeCityTemplate()

  it('leaves ground between every pair of neighbours on a street', () => {
    for (const g of dwellingGaps(t)) expect(g).toBeGreaterThanOrEqual(1)
  })

  // Equal spacing is what makes a grid read as a spreadsheet.
  it('does not space them all the same', () => {
    expect(new Set(dwellingGaps(t)).size, 'every gap is the same width').toBeGreaterThanOrEqual(2)
  })

  it('clears at least eight plots of buildable ground beside a road', () => {
    expect(growthPlots(t).length).toBeGreaterThanOrEqual(8)
  })

  it('puts a house on more than one street', () => {
    expect(dwellingRanks(t).length, 'every dwelling shares one street').toBeGreaterThanOrEqual(3)
  })

  // The ranks are read off the FACING column, so a building at the corner of two streets is
  // filed under the one its door is on rather than whichever the road set happened to answer.
  it('files each dwelling under the street its own door opens on', () => {
    for (const s of t.structures) {
      if (!isDwellingKind(s.kind)) continue
      const street = s.facing === 'sw' ? `row ${s.dy + s.h}` : `col ${s.dx + s.w}`
      expect(dwellingRanks(t).map(r => r.street), `${s.kind}`).toContain(street)
    }
  })
})

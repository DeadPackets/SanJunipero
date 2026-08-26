import { describe, it, expect, vi } from 'vitest'
import { ROAD_AUTOTILE_KEYS } from './autotile.js'
import { DEFAULT_CONFIG, isRoofedKind } from './config.js'
import {
  CityTemplateSchema, CITY_ANCHOR_DEFAULT, CITY_W, CITY_H, TOWN_ORIGIN, TOWN_RINGS_GENESIS,
  townOrigin, townSpan, RIVER_LOCAL_DX, RIVER_HALF, BANK_HALF, cityGroundAt, CITY_GROUND,
  TOWN_SQUARE, anchorFor, riverLocalDx, RIVER_GRAMMAR_DX,
  WORLD_MARGIN, worldSizeForRings, worldForRings, edgesOwed,
  WORLD_SIZE_GENESIS, inExtent, inRect, key, cityTerrainTiles, cityRoadTiles, cityRoadKeys,
  isRoadTile, PLAZA, PLAZA_CENTRE, T_ROAD, T_WATER, T_EARTH,
  cityStructures, cityPlacements, cityBlocks, genesisEmptyPlots, plattedPlots, doorTile, doorFrontTile,
  structureTiles, FOUNDER_IDS, CITY_INTERIOR_SLOTS,
  CITY_FURNISHING_KINDS, CITY_BED_KIND, CITY_HEARTH_KIND, citySlotsFor,
  makeCityTemplate, templateFits, growthPlots, T_GRASS, footprintFor,
  WELL_AT, FIRE_PIT_AT, danglingRoadEnds, frontages, GENESIS_WANTED,
  CITY_DWELLING_KINDS, DWELLING_FOOTPRINTS, isDwellingKind,
} from './cityTemplate.js'
import type { CityTemplate } from './cityTemplate.js'
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

// facingFrom(dx, dy) can answer `ne` or `nw`, for which the forge has no art. A building turns
// two ways, so the template carries the answer in a two-value column and nothing infers it.
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

  // Pinned as a number here and by name in world.test.ts, so a drift shows on both sides at once.
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

  // A special case that widened the main street once ran a phantom road row through a block's
  // frontage. This is the guard that keeps one from coming back.
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

  // Three-tile streets meet in crosses, tees and corners and never in a lane or a dead end, so
  // these nine shapes are the nine a town of this grammar can ask for.
  it('asks for the nine shapes a regular three-tile lattice makes, and no others', () => {
    const seen = new Set(cityRoadKeys(roads).values())
    expect([...seen].sort()).toEqual([
      'corner-es', 'corner-ne', 'corner-sw', 'corner-wn',
      'cross', 't-no-e', 't-no-n', 't-no-s', 't-no-w',
    ])
  })

  // The paving is laid around the well and the fire pit, so their two tiles are the only interior
  // tiles that are not road — and each turns its four neighbours into tees.
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

  // The UNTURNED footprint: the same farmhouse is 4x2 on a south plot and 2x4 on an east one,
  // and footprintFor is the only correct way to ask which.
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

  // `roofed` on the recipe row is the one answer; this asserts the template and that row agree.
  it('plats no dwelling the engine cannot let a body into', () => {
    for (const s of structures.filter(x => isDwellingKind(x.kind) || x.kind === 'storehouse')) {
      expect(isRoofedKind(DEFAULT_CONFIG, s.kind), `nobody can get into a ${s.kind}`).toBe(true)
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
        // per-kind: the grid widens with the household, because a bed is two slots deep and a
        // farmhouse sleeps four. `citySlotsFor` never narrows below the landed 3.
        const grid = citySlotsFor(s.kind)
        expect(grid.w, s.kind).toBeGreaterThanOrEqual(CITY_INTERIOR_SLOTS.w)
        expect(f.slot.x, `${s.kind} ${f.kind}`).toBeLessThan(grid.w)
        expect(f.slot.y, `${s.kind} ${f.kind}`).toBeLessThan(grid.h)
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
    // `bench` joined when the cabin got a room: a refuge has somewhere to sit and no bed.
    expect([...used].sort())
      .toEqual(['barrel', 'bed', 'bench', 'chair', 'crate', 'hearth', 'rug', 'shelf', 'table'])
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

// worldSizeForRings is townSpan plus a block pitch of wild on each side, unbounded in the ring
// count because the grammar is.
describe('★ the world a town of R rings needs', () => {
  it('is the town plus one block pitch of wild on every side, and has no ceiling', () => {
    expect(WORLD_MARGIN).toBe(PITCH)
    for (const r of [1, 2, 3, 5, 8, 13, 21])
      expect(worldSizeForRings(r), `ring ${r}`).toBe(townSpan(r) + 2 * PITCH)
    // Strictly increasing and unbounded: there is no number this function stops at.
    for (let r = 1; r < 60; r++)
      expect(worldSizeForRings(r + 1)).toBeGreaterThan(worldSizeForRings(r))
    expect(worldSizeForRings(1000)).toBe(townSpan(1000) + 2 * PITCH)
  })

  // The red this is measured against: a 128-tile world at the genesis anchor refuses ring 2 on.
  it('is exactly what a fixed 128-tile world at a fixed anchor could not give', () => {
    expect(templateFits(CITY_ANCHOR_DEFAULT, WORLD_SIZE_GENESIS, 1)).toBe(true)
    for (const r of [2, 3, 4, 5])
      expect(templateFits(CITY_ANCHOR_DEFAULT, WORLD_SIZE_GENESIS, r), `ring ${r} in a 128 world`).toBe(false)
    expect(townSpan(2)).toBe(98)
    expect(townSpan(3)).toBe(136)
    expect(worldSizeForRings(2)).toBeGreaterThan(WORLD_SIZE_GENESIS)
  })

  // The square is the fixed point, so growing the town moves its corner, never its centre and
  // never the river: the ford and the forage nodes sit against a channel that does not move.
  it('leaves the square and the channel exactly where they are, at every ring', () => {
    for (let r = 1; r <= 12; r++) {
      const a = anchorFor(r)
      expect({ x: a.x + townOrigin(r), y: a.y + townOrigin(r) }, `ring ${r} square`).toEqual(TOWN_SQUARE)
      expect(a.x + riverLocalDx(r), `ring ${r} channel`).toBe(49)
      expect(TOWN_SQUARE.x + RIVER_GRAMMAR_DX).toBe(49)
    }
    expect(anchorFor(TOWN_RINGS_GENESIS)).toEqual(CITY_ANCHOR_DEFAULT)
    // The plat rule reads the same ground whatever the ring count, so ring 1's five blocks are
    // still ring 1's five blocks inside a ring-5 town.
    const inner = plattedBlocks(1, CITY_GROUND).map(b => `${b.i},${b.j}`)
    for (const b of inner) expect(plattedBlocks(5, CITY_GROUND).map(x => `${x.i},${x.j}`)).toContain(b)
  })

  it('grows the platted lattice monotonically, so a ring never withdraws what it offered', () => {
    let last = 0
    for (let r = 1; r <= 6; r++) {
      const plots = freePlots(r, CITY_GROUND).length
      expect(plots, `ring ${r}`).toBeGreaterThan(last)
      last = plots
    }
    expect(plattedBlocks(5, CITY_GROUND)).toHaveLength(109)
    expect(freePlots(5, CITY_GROUND)).toHaveLength(436)
  })
})

// Dry and road-fronted were proved out to ring 4; in-world is the third invariant.
describe('★ the town still stands at ring 5', () => {
  for (const rings of [5, 6]) {
    it(`puts every legal building on every plot of ring ${rings} on dry, in-world, road-fronted ground`, () => {
      const world = worldForRings(rings)
      const o = townOrigin(rings)
      const road = new Set(streetTiles(rings, CITY_GROUND).map(t => key(t.dx, t.dy)))
      const wet: string[] = [], doorless: string[] = [], outside: string[] = []
      let closest = Infinity, buildings = 0, tiles = 0
      for (const p of freePlots(rings, CITY_GROUND))
        for (let along = 1; along <= MAX_ALONG; along++)
          for (let deep = 1; deep <= MAX_DEEP; deep++) {
            const s = place(p, 'x', along, deep, null)
            buildings++
            for (const c of placedTiles(s)) {
              tiles++
              if (CITY_GROUND(c.dx, c.dy) === 'water') wet.push(key(c.dx, c.dy))
              // grammar → template → the world's own frame
              const wx = world.anchor.x + c.dx + o, wy = world.anchor.y + c.dy + o
              if (wx < 0 || wy < 0 || wx >= world.size || wy >= world.size) outside.push(`${wx},${wy}`)
              closest = Math.min(closest, wx, wy, world.size - 1 - wx, world.size - 1 - wy)
            }
            const d = doorFrontTile({ ...s, furnishings: [] })
            if (!road.has(key(d.dx, d.dy))) doorless.push(`${plotKey(p)} ${along}×${deep}`)
          }
      expect(buildings).toBe(freePlots(rings, CITY_GROUND).length * MAX_ALONG * MAX_DEEP)
      expect(tiles).toBeGreaterThan(10000)
      expect(wet, 'a building on water').toEqual([])
      expect(doorless, 'a door that is not on a road').toEqual([])
      expect(outside, 'a building off the edge of the world').toEqual([])
      // Measured on the box, not on the building tiles: the outermost buildings stand three tiles
      // in from their own street, and that slack would swallow a shrunken margin unnoticed.
      const span = townSpan(rings)
      const box = {
        dx0: world.anchor.x, dy0: world.anchor.y,
        dx1: world.anchor.x + span - 1, dy1: world.anchor.y + span - 1,
      }
      expect(edgesOwed(box, { w: world.size, h: world.size }), 'the world owes the town ground')
        .toEqual([])
      expect(edgesOwed(box, { w: world.size - 1, h: world.size }), 'one tile narrower must not do')
        .toEqual([{ edge: 'e', owed: 1 }])
      expect(closest).toBeGreaterThanOrEqual(WORLD_MARGIN)
    })
  }

  // The clamp the lane removed. The old `cityFreePlots` filtered every plot through a ring-1
  // extent, so an agent standing in a ring-2 town would have been offered nothing at all.
  it('offers the plots of the ring it is asked about, not the ring genesis platted', () => {
    expect(genesisEmptyPlots(1)).toHaveLength(11)
    expect(genesisEmptyPlots(5)).toHaveLength(436 - GENESIS_WANTED.length)
    for (const p of genesisEmptyPlots(5)) expect(inExtent(p.dx, p.dy, 5), key(p.dx, p.dy)).toBe(true)
  })

  // ★ THE THIRD DEFECT, AND THE SHAPE THAT ANSWERS ALL THREE. Every one of them returned a
  // plausible wrong answer instead of an error, so the new shape has no quiet failure in it.
  it('★ refuses the wrong question out loud, instead of answering it with a short list', () => {
    // A town of no rings has no plots. It used to be an empty array, which reads as "the town
    // is full" — the exact silence the ring-1 clamp hid behind.
    expect(() => plattedPlots(0)).toThrow(/no plots/)
    expect(() => plattedPlots(-1)).toThrow(/no plots/)
    expect(() => genesisEmptyPlots(0)).toThrow(/no plots/)
    // A template built for one ring count, asked about another, is the clamp itself.
    expect(() => growthPlots(makeCityTemplate(), 5)).toThrow(/is not a town of 5 ring/)
    expect(() => growthPlots(makeCityTemplate(worldForRings(3).anchor, 3))).toThrow(/is not a town of 1 ring/)
    // And the right question still answers: the template and the ring count agree.
    expect(growthPlots(makeCityTemplate(worldForRings(3).anchor, 3), 3).length)
      .toBe(genesisEmptyPlots(3).length)
  })

  // ★ THE SPLIT, MEASURED. "What could ever be built on" and "what genesis leaves empty" are
  // different lists, and the difference is exactly the nine buildings the template stands.
  it('★ what could ever be built on, and what genesis leaves empty, are two lists', () => {
    for (const rings of [1, 2, 5]) {
      expect(plattedPlots(rings).length - genesisEmptyPlots(rings).length,
        `${rings} rings`).toBe(GENESIS_WANTED.length)
    }
    // Neither takes a template, so neither can be mistaken for the running-world question —
    // and `genesisEmptyPlots` answering the same eleven forever is now its contract, not a bug.
    expect(genesisEmptyPlots(1)).toEqual(genesisEmptyPlots(1))
    expect(plattedPlots(1)).toHaveLength(20)
  })

  // A whole ring-5 town, assembled and parsed — ground, streets and all — inside the world its
  // own ring count asks for.
  it('assembles a ring-5 template that lands inside the world ring 5 asks for', () => {
    const rings = 5
    const world = worldForRings(rings)
    const t = makeCityTemplate(world.anchor, rings)
    expect(t.tiles.length).toBe(townSpan(rings) * townSpan(rings))
    expect(templateFits(world.anchor, world.size, rings)).toBe(true)
    for (const x of t.tiles) {
      expect(inExtent(x.dx, x.dy, rings), key(x.dx, x.dy)).toBe(true)
      expect(world.anchor.x + x.dx).toBeLessThan(world.size)
      expect(world.anchor.y + x.dy).toBeLessThan(world.size)
    }
    expect(danglingRoadEnds(t, rings)).toEqual([])
    expect(townErrors(cityPlacements(), streetTiles(rings, CITY_GROUND), CITY_GROUND)).toEqual([])
  })
})

// ★ HOW MUCH GROUND THE WORLD OWES, read off the built set and nothing else — no ring count, no
// map size, no anchor. The same measurement the camera's bounds and the cull already derive.
describe('edgesOwed', () => {
  const box = { dx0: 50, dy0: 50, dx1: 60, dy1: 60 }

  it('is empty exactly when every side of the built set has its margin', () => {
    expect(edgesOwed(box, { w: 200, h: 200 })).toEqual([])
    expect(edgesOwed({ dx0: WORLD_MARGIN, dy0: WORLD_MARGIN, dx1: 60, dy1: 60 },
      { w: 60 + WORLD_MARGIN + 1, h: 60 + WORLD_MARGIN + 1 })).toEqual([])
  })

  it('names the edge and the shortfall when one tile is missing, on each of the four', () => {
    expect(edgesOwed({ ...box, dy0: WORLD_MARGIN - 1 }, { w: 200, h: 200 })).toEqual([{ edge: 'n', owed: 1 }])
    expect(edgesOwed({ ...box, dx0: WORLD_MARGIN - 1 }, { w: 200, h: 200 })).toEqual([{ edge: 'w', owed: 1 }])
    expect(edgesOwed(box, { w: 200, h: 60 + WORLD_MARGIN })).toEqual([{ edge: 's', owed: 1 }])
    expect(edgesOwed(box, { w: 60 + WORLD_MARGIN, h: 200 })).toEqual([{ edge: 'e', owed: 1 }])
  })

  it('names all four, in n-e-s-w order, for a world with nothing to spare', () => {
    expect(edgesOwed({ dx0: 0, dy0: 0, dx1: 9, dy1: 9 }, { w: 10, h: 10 }))
      .toEqual([{ edge: 'n', owed: 19 }, { edge: 'e', owed: 19 }, { edge: 's', owed: 19 }, { edge: 'w', owed: 19 }])
  })

  // The genesis world is not a counter-example but the first thing the rule finds: 128 tiles leave
  // the town four rows short of its southern margin.
  it('finds the genesis world four rows short to the south, and short nowhere else', () => {
    const built = cityStructures()
    const a = CITY_ANCHOR_DEFAULT
    const world = {
      dx0: a.x + Math.min(...built.map(s => s.dx)), dy0: a.y + Math.min(...built.map(s => s.dy)),
      dx1: a.x + Math.max(...built.map(s => s.dx + s.w - 1)),
      dy1: a.y + Math.max(...built.map(s => s.dy + s.h - 1)),
    }
    expect(edgesOwed(world, { w: WORLD_SIZE_GENESIS, h: WORLD_SIZE_GENESIS }))
      .toEqual([{ edge: 's', owed: 4 }])
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
    const plots = genesisEmptyPlots()
    expect(plots).toHaveLength(freePlots(TOWN_RINGS_GENESIS, CITY_GROUND).length - GENESIS_WANTED.length)
    expect(plots).toHaveLength(11)
    const built = new Set(cityPlacements().map(plotKey))
    for (const p of plots) expect(built.has(plotKey(p)), `${plotKey(p)} is built on`).toBe(false)
  })

  it('gives each one a facing, so what gets built there already knows which way it turns', () => {
    for (const p of genesisEmptyPlots())
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

const ORTHO = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const

const roadSetOf = (t: CityTemplate): Set<string> =>
  new Set(t.tiles.filter(isRoadTile).map((x) => key(x.dx, x.dy)))

/** 1. FRONTAGE. Pairs of structures whose footprints touch orthogonally. A town has ground on
 *  every side of every building, so the invariant is that this list is empty. */
function touchingStructures(t: CityTemplate): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const at = new Map<string, number>()
  t.structures.forEach((s, i) => { for (const c of structureTiles(s)) at.set(key(c.dx, c.dy), i) })
  t.structures.forEach((s, i) => {
    const touched = new Set<number>()
    for (const c of structureTiles(s))
      for (const [ox, oy] of ORTHO) {
        const j = at.get(key(c.dx + ox, c.dy + oy))
        if (j !== undefined && j > i) touched.add(j)
      }
    for (const j of [...touched].sort((a, b) => a - b))
      out.push([`${s.kind}@${s.dx},${s.dy}`, `${t.structures[j]!.kind}@${t.structures[j]!.dx},${t.structures[j]!.dy}`])
  })
  return out
}

/** 2. CONNECTIVITY. Structures grouped by the road component their door opens onto. One group
 *  means you can walk from any building in town to any other without leaving the roads. */
function structureComponents(t: CityTemplate): string[][] {
  const roads = roadSetOf(t)
  const label = new Map<string, number>()
  let n = 0
  for (const k of [...roads].sort()) {
    if (label.has(k)) continue
    const id = n++
    const stack = [k]
    label.set(k, id)
    while (stack.length > 0) {
      const [dx, dy] = stack.pop()!.split(',').map(Number) as [number, number]
      for (const [ox, oy] of ORTHO) {
        const nk = key(dx + ox, dy + oy)
        if (roads.has(nk) && !label.has(nk)) { label.set(nk, id); stack.push(nk) }
      }
    }
  }
  const groups = new Map<number | 'none', string[]>()
  for (const f of frontages(t)) {
    const id = f.onto === null ? 'none' : label.get(key(f.onto.dx, f.onto.dy))!
    const name = `${f.kind}@${f.door.dx},${f.door.dy}`
    const g = groups.get(id)
    if (g === undefined) groups.set(id, [name]); else g.push(name)
  }
  return [...groups.values()]
}

type PlazaArrival = { side: 'n' | 'e' | 's' | 'w'; from: { dx: number; dy: number } }

/** 4. A CENTRE. The road tiles that arrive at the square from outside it, by compass side. A
 *  square streets merely pass is a wide street; a square streets ARRIVE at is a centre. */
function plazaArrivals(t: CityTemplate): PlazaArrival[] {
  const roads = roadSetOf(t)
  const out: PlazaArrival[] = []
  const SIDES = [['n', 0, -1], ['e', 1, 0], ['s', 0, 1], ['w', -1, 0]] as const
  for (let dy = PLAZA.dy0; dy <= PLAZA.dy1; dy++)
    for (let dx = PLAZA.dx0; dx <= PLAZA.dx1; dx++) {
      if (!roads.has(key(dx, dy))) continue
      for (const [side, ox, oy] of SIDES) {
        const p = { dx: dx + ox, dy: dy + oy }
        if (inRect(PLAZA, p.dx, p.dy) || !roads.has(key(p.dx, p.dy))) continue
        out.push({ side, from: p })
      }
    }
  return out.sort((a, b) => a.from.dy - b.from.dy || a.from.dx - b.from.dx)
}

type StreetRank = {
  /** `row 38` or `col 40` — the line of road every door on this rank opens onto */
  street: string
  dwellings: Array<{ kind: string; along: number; span: number }>
}

/** The houses grouped by the street their doors open onto and ordered along it. The facing column
 *  decides which street a building is on, so one at a crossroads cannot be filed under the wrong one. */
function dwellingRanks(t: CityTemplate): StreetRank[] {
  const byStreet = new Map<string, StreetRank['dwellings']>()
  for (const s of t.structures) {
    if (!isDwellingKind(s.kind)) continue
    const street = s.facing === 'sw' ? `row ${s.dy + s.h}` : `col ${s.dx + s.w}`
    const entry = s.facing === 'sw'
      ? { kind: s.kind, along: s.dx, span: s.w }
      : { kind: s.kind, along: s.dy, span: s.h }
    const g = byStreet.get(street)
    if (g === undefined) byStreet.set(street, [entry]); else g.push(entry)
  }
  return [...byStreet.entries()]
    .map(([street, dwellings]) => ({ street, dwellings: dwellings.sort((a, b) => a.along - b.along) }))
    .sort((a, b) => a.street.localeCompare(b.street))
}

/** 3. VARIETY OF MASS. The longest run of one dwelling kind on one street: two neighbours read as
 *  neighbours, three read as a terrace, so the ruling is N = 2. */
function longestKindRun(t: CityTemplate): number {
  let worst = 0
  for (const rank of dwellingRanks(t)) {
    let run = 0, last = ''
    for (const d of rank.dwellings) {
      run = d.kind === last ? run + 1 : 1
      last = d.kind
      worst = Math.max(worst, run)
    }
  }
  return worst
}

/** 5. PLOTS AND GAPS. The empty ground between consecutive dwellings on each street. Every
 *  gap is at least one tile, and they are not all the same number. */
function dwellingGaps(t: CityTemplate): number[] {
  const out: number[] = []
  for (const rank of dwellingRanks(t))
    for (let i = 1; i < rank.dwellings.length; i++) {
      const prev = rank.dwellings[i - 1]!, next = rank.dwellings[i]!
      out.push(next.along - (prev.along + prev.span))
    }
  return out
}

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

  // Moving equally in +dx and +dy is pure depth, so a building directly behind another cannot be
  // seen. Two doors on one line is the array-space signature of that.
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

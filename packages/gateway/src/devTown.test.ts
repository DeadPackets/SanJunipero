import { describe, it, expect } from 'vitest'
import { FOUNDER_IDS, cityStructures } from '@sj/shared'
import { TOWN_STRUCTURES, townStructuresFor } from './founders.js'
import { devStructureId, devTown, type DevStructure } from './devTown.js'
import { GRASS_TILE, SHOWCASE_ANCHOR, SHOWCASE_H, SHOWCASE_W } from './showcaseMap.js'

// Same footprint rule as showcaseStructureTiles, over DevStructure's open `kind`.
const tilesOf = (s: DevStructure): { x: number; y: number }[] => {
  const out: { x: number; y: number }[] = []
  for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) out.push({ x, y })
  return out
}

// The G6/G10 fixture town, frozen as a literal so a careless edit to founders.ts fails HERE
// rather than moving a gate's world silently (plan P20).
const FROZEN_TOWN_STRUCTURES = [
  { id: 'structure_storehouse', kind: 'storehouse', x: 20, y: 20, w: 2, h: 2 },
  { id: 'structure_shed', kind: 'shed', x: 23, y: 20, w: 1, h: 1 },
  { id: 'structure_cottage', kind: 'house', x: 30, y: 20, w: 2, h: 2 },
  { id: 'structure_wagon', kind: 'wagon', x: 26, y: 25, w: 1, h: 2 },
  { id: 'structure_scaffolding', kind: 'scaffolding', x: 34, y: 23, w: 1, h: 1 },
  { id: 'structure_stone', kind: 'standing_stone', x: 15, y: 28, w: 1, h: 1 },
]

// EARTH is the template's bank tile; a structure may stand on cleared earth or on grass, and
// on nothing else. Imported by value rather than by name because showcaseMap exports the ids
// it rasterises, not the template's own T_ constants.
const EARTH_TILE = 1

const town = devTown()

describe('devTown — one town, not two', () => {
  it('carries all eleven template structures', () => {
    expect(town.structures).toHaveLength(11)
  })

  it('has exactly the template kind multiset', () => {
    const count = (list: readonly { kind: string }[]): Record<string, number> => {
      const out: Record<string, number> = {}
      for (const s of list) out[s.kind] = (out[s.kind] ?? 0) + 1
      return out
    }
    expect(count(town.structures)).toEqual(count(cityStructures()))
    // Six kinds over eleven roofs, where the eleven used to be five copies of one home and a
    // matched pair of sheds. The cottage, the cabin and the farmhouse are unowned fixtures.
    expect(count(town.structures)).toEqual({
      house: 5, cottage: 1, cabin: 1, farmhouse: 1, storehouse: 1, well: 1, fire_pit: 1,
    })
  })

  it('gives five houses one founder owner each, and leaves every other building public', () => {
    const owned = town.structures.filter((s) => s.owner !== null)
    expect(owned).toHaveLength(5)
    expect(new Set(owned.map((s) => s.kind))).toEqual(new Set(['house']))
    expect(new Set(owned.map((s) => s.owner))).toEqual(new Set(FOUNDER_IDS))
    expect(new Set(owned.map((s) => s.owner)).size).toBe(owned.length) // nobody twice
  })

  it('stands every structure inside the showcase grid', () => {
    for (const s of town.structures) {
      for (const t of tilesOf(s)) {
        expect(t.x).toBeGreaterThanOrEqual(0)
        expect(t.y).toBeGreaterThanOrEqual(0)
        expect(t.x).toBeLessThan(SHOWCASE_W)
        expect(t.y).toBeLessThan(SHOWCASE_H)
      }
    }
  })

  // THE ASSERTION THAT WOULD HAVE CAUGHT THE TWO-TOWNS BUG: buildings and terrain must come
  // from the same derivation, so no building can be standing in the middle of its own road.
  it('never stands a building on the roads that serve it', () => {
    for (const s of town.structures) {
      for (const t of tilesOf(s)) {
        const tile = town.terrain[t.y]![t.x]!
        expect(
          tile === GRASS_TILE || tile === EARTH_TILE,
          `${s.id} stands on tile ${tile} at ${t.x},${t.y}`,
        ).toBe(true)
      }
    }
  })

  it('names every structure uniquely and readably', () => {
    const ids = town.structures.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const s of town.structures) {
      expect(s.id).toBe(devStructureId(s.kind, s.x, s.y))
      expect(s.id).toMatch(/^structure_[a-z_]+_\d+_\d+$/)
    }
  })

  it('is deterministic — two calls deep-equal', () => {
    expect(devTown()).toEqual(devTown())
    expect(town.anchor).toEqual(SHOWCASE_ANCHOR)
  })

  it('marks the well and the standing stone unburnable and everything else flammable', () => {
    for (const s of town.structures) {
      expect(s.flammable).toBe(s.kind !== 'standing_stone' && s.kind !== 'well')
    }
  })
})

describe('townStructuresFor', () => {
  it('keeps the scripted fixture byte-identical, so no landed gate moves', () => {
    expect(TOWN_STRUCTURES).toEqual(FROZEN_TOWN_STRUCTURES)
    expect(townStructuresFor('scripted').map((s) => ({
      id: s.id, kind: s.kind, x: s.x, y: s.y, w: s.w, h: s.h,
    }))).toEqual(FROZEN_TOWN_STRUCTURES)
  })

  it('serves the real town under showcase', () => {
    expect(townStructuresFor('showcase')).toEqual(town.structures)
  })
})

import { describe, expect, it } from 'vitest'
import {
  CITY_ANCHOR_DEFAULT, DEFAULT_CONFIG, GENESIS_WANTED, TOWN_SQUARE, cityPlacements,
  plazaOf, townOrigin, worldOf,
} from '@sj/shared'
import { claimInWorld, standingRects, townGroundBox, townSquareOf } from './town.js'
import { makeGenesisWorld } from './genesis/world.js'
import { genesisState, type WorldState } from './state.js'
import { makeFixtureMap } from './scripted.js'
import { fold } from './fold.js'

function genesisWorld(): WorldState {
  const { terrain, events } = makeGenesisWorld(DEFAULT_CONFIG)
  let state = genesisState(DEFAULT_CONFIG, terrain)
  let seq = 0
  for (const e of events) state = fold(state, { seq: ++seq, tick: 0, type: e.type, payload: e.payload }, DEFAULT_CONFIG)
  return state
}

describe('★ where the town is, in a world that moves under it', () => {
  it('the genesis world knows its square, and it is the paved corner of the plaza', () => {
    const state = genesisWorld()
    expect(townSquareOf(state)).toEqual({ x: TOWN_SQUARE.x, y: TOWN_SQUARE.y })
    // The same tile, reached the other way: the template's own plaza corner through the anchor.
    expect({
      x: CITY_ANCHOR_DEFAULT.x + plazaOf(1).dx0,
      y: CITY_ANCHOR_DEFAULT.y + plazaOf(1).dy0,
    }).toEqual({ x: TOWN_SQUARE.x, y: TOWN_SQUARE.y })
    expect(CITY_ANCHOR_DEFAULT.x + townOrigin(1)).toBe(TOWN_SQUARE.x)
  })

  it('★ every genesis building stands exactly where the grammar plotted it', () => {
    const standing = standingRects(genesisWorld())
    const plotted = cityPlacements()
      .map((s) => ({ ...worldOf(TOWN_SQUARE, { dx: s.dx, dy: s.dy }), w: s.w, h: s.h }))
    // The nine buildings, plus the well and the fire pit, which are not on plots.
    expect(standing).toHaveLength(GENESIS_WANTED.length + 2)
    for (const p of plotted) expect(standing, `${p.x},${p.y}`).toContainEqual(p)
  })

  it('a world with no town in it has no square, and therefore no plots', () => {
    const fixture = genesisState(DEFAULT_CONFIG, makeFixtureMap())
    expect(townSquareOf(fixture)).toBeNull()
    expect(claimInWorld(fixture, { along: 2, deep: 2 })).toBeNull()
    expect(townGroundBox(fixture)).toBeNull()
    // The default 32x32 state the golden gate runs on, too.
    expect(townSquareOf(genesisState(DEFAULT_CONFIG))).toBeNull()
  })

  it('a world big enough to hold the square but that never paved it is still no town', () => {
    const big = genesisState(DEFAULT_CONFIG, Array.from({ length: 128 }, () => Array.from({ length: 128 }, () => 0 as const)))
    expect(big.terrain[TOWN_SQUARE.y]![TOWN_SQUARE.x]).toBe(0)
    expect(townSquareOf(big)).toBeNull()
  })

  it('the square walks with the array when the world grows west', () => {
    const state = genesisWorld()
    const depth = 19
    const strip = Array.from({ length: state.terrain.length }, () => Array.from({ length: depth }, () => 0))
    const grown = fold(state, {
      seq: 9999, tick: 1440, type: 'world_grown', payload: { edge: 'w', depth, tiles: strip },
    }, DEFAULT_CONFIG)
    expect(grown.origin).toEqual({ x: -depth, y: 0 })
    expect(townSquareOf(grown)).toEqual({ x: TOWN_SQUARE.x + depth, y: TOWN_SQUARE.y })
    // And every building moved with it, so the claim asks the same question of the same town.
    expect(claimInWorld(grown, { along: 2, deep: 2 })!.site)
      .toEqual({ ...claimInWorld(state, { along: 2, deep: 2 })!.site, x: claimInWorld(state, { along: 2, deep: 2 })!.site.x + depth })
  })

  it('the claim reads the world, so the tenth building goes where the ninth did not', () => {
    const state = genesisWorld()
    const first = claimInWorld(state, { along: 2, deep: 2 })!
    expect(first.rings).toBe(1)
    const standing = standingRects(state)
    for (const s of standing)
      expect(first.site.x < s.x + s.w && s.x < first.site.x + first.site.w
        && first.site.y < s.y + s.h && s.y < first.site.y + first.site.h).toBe(false)
  })

  it('the town ground box reaches past the roofs, and it is what the world owes clearance to', () => {
    const state = genesisWorld()
    const box = townGroundBox(state)!
    const roofs = standingRects(state)
    expect(box.dy1).toBeGreaterThan(Math.max(...roofs.map((s) => s.y + s.h - 1)))
    expect(box.dx1).toBeGreaterThan(Math.max(...roofs.map((s) => s.x + s.w - 1)))
    expect(box.dy0).toBeLessThan(Math.min(...roofs.map((s) => s.y)))
  })
})

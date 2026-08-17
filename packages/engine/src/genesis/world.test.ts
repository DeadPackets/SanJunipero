import { describe, it, expect } from 'vitest'
import {
  CITY_ANCHOR_DEFAULT, DEFAULT_CONFIG, FOUNDER_IDS, SimConfigSchema, WORLD_SIZE_GENESIS,
  makeCityTemplate, stateHash, templateFits, type SimEvent,
} from '@sj/shared'
import { fold } from '../fold.js'
import { findPath } from '../path.js'
import { genesisState, type WorldState } from '../state.js'
import { GENESIS_FAUNA } from '../data/faunaDefs.js'
import { GENESIS_FORAGEABLES } from '../data/forageables.js'
import { makeGenesisWorld, GENESIS_FORK_Y, GENESIS_BUILDER_ID } from './world.js'

const T_WATER = 2

type Payload = Record<string, unknown>

function foldAll(): WorldState {
  const { terrain, events } = makeGenesisWorld(DEFAULT_CONFIG)
  let s = genesisState(DEFAULT_CONFIG, terrain)
  let seq = 0
  for (const e of events) {
    const ev: SimEvent = { seq: seq++, tick: 0, type: e.type, payload: e.payload }
    s = fold(s, ev, DEFAULT_CONFIG)
  }
  return s
}

describe('makeGenesisWorld: the ground', () => {
  it('is the size the config asks for, and the config agrees with the shared constant', () => {
    const { terrain } = makeGenesisWorld(DEFAULT_CONFIG)
    expect(terrain).toHaveLength(128)
    for (const row of terrain) expect(row).toHaveLength(128)
    expect(DEFAULT_CONFIG.world.size).toEqual({ w: WORLD_SIZE_GENESIS, h: WORLD_SIZE_GENESIS })
    const small = SimConfigSchema.parse({ world: { size: { w: 64, h: 48 } } })
    expect(makeGenesisWorld(small).terrain).toHaveLength(48)
    expect(makeGenesisWorld(small).terrain[0]).toHaveLength(64)
  })

  it('the city fits on it', () => {
    expect(templateFits(CITY_ANCHOR_DEFAULT, 128)).toBe(true)
  })

  it('the river reaches both map edges and runs three tiles wide', () => {
    const { terrain } = makeGenesisWorld(DEFAULT_CONFIG)
    expect(terrain[0]!.filter((t) => t === T_WATER).length).toBeGreaterThanOrEqual(3)
    expect(terrain[127]!.filter((t) => t === T_WATER).length).toBeGreaterThanOrEqual(3)
    for (const y of [5, 40, 70, 100, 127]) {
      expect(terrain[y]!.slice(48, 51).every((t) => t === T_WATER)).toBe(true)
    }
  })

  it('widens where the branch leaves for the lake', () => {
    const { terrain } = makeGenesisWorld(DEFAULT_CONFIG)
    const atFork = terrain[GENESIS_FORK_Y]!.slice(45, 55).filter((t) => t === T_WATER).length
    expect(atFork).toBeGreaterThanOrEqual(5)
    expect(atFork).toBeGreaterThan(terrain[70]!.slice(45, 55).filter((t) => t === T_WATER).length)
  })

  it('is a pure function of its input: two calls are deep-equal', () => {
    expect(makeGenesisWorld(DEFAULT_CONFIG)).toEqual(makeGenesisWorld(DEFAULT_CONFIG))
  })

  it('the city template is baked into the ground, not emitted as a change', () => {
    const { terrain, events } = makeGenesisWorld(DEFAULT_CONFIG)
    const t = makeCityTemplate()
    for (const tile of t.tiles) expect(terrain[t.anchor.y + tile.dy]![t.anchor.x + tile.dx]).toBe(tile.to)
    expect(events.some((e) => e.type === 'tile_changed' || e.type === 'terrain_changed')).toBe(false)
  })
})

describe('makeGenesisWorld: the town', () => {
  it('plants exactly five huts, one owned by each founder', () => {
    const s = foldAll()
    const huts = Object.values(s.structures).filter((x) => x.kind === 'hut')
    expect(huts).toHaveLength(5)
    expect(huts.map((h) => h.owner).sort()).toEqual([...FOUNDER_IDS].sort())
  })

  it('leaves every public building unowned — absent, not null', () => {
    const { events } = makeGenesisWorld(DEFAULT_CONFIG)
    const planned = events.filter((e) => e.type === 'structure_planned').map((e) => e.payload as Payload)
    const publics = planned.filter((p) => p['kind'] !== 'hut')
    expect(publics.length).toBeGreaterThan(0)
    for (const p of publics) expect(Object.keys(p)).not.toContain('owner')
    for (const p of planned) expect(p['builderId']).toBe(GENESIS_BUILDER_ID)
  })

  it('completes every building it plants', () => {
    const s = foldAll()
    const all = Object.values(s.structures)
    expect(all.length).toBe(makeCityTemplate().structures.length)
    for (const x of all) expect(x.stage).toBe('complete')
  })

  it('takes footprint from the template and durability from the one table that knows', () => {
    const s = foldAll()
    const hut = Object.values(s.structures).find((x) => x.kind === 'hut')!
    expect({ w: hut.w, h: hut.h }).toEqual({ w: 2, h: 2 })
    expect(hut.maxHp).toBe(DEFAULT_CONFIG.structures.recipes['hut']!.maxHp)
    expect(hut.flammable).toBe(true)
    const well = Object.values(s.structures).find((x) => x.kind === 'well')!
    expect(well.maxHp).toBe(DEFAULT_CONFIG.structures.recipes['well']!.maxHp)
    expect(well.flammable).toBe(false)
  })

  // Section 9: the far bank is earned, not given. Nothing crosses the water on day one.
  it('builds no bridge, and the far bank has no route to it', () => {
    const s = foldAll()
    expect(Object.values(s.structures).some((x) => x.kind === 'bridge')).toBe(false)
    expect(s.terrain.every((row) => row[48] === T_WATER && row[49] === T_WATER && row[50] === T_WATER)).toBe(true)
    expect(findPath(s, { x: 30, y: 100 }, { x: 55, y: 100 }, DEFAULT_CONFIG)).toBeNull()
    expect(findPath(s, { x: 55, y: 100 }, { x: 55, y: 40 }, DEFAULT_CONFIG)).not.toBeNull()
  })

  it('gives every founder a kit inside their own roof, and the stock to the storehouse', () => {
    const s = foldAll()
    for (const id of FOUNDER_IDS) {
      const kit = Object.values(s.items).filter((i) => i.owner === id)
      expect(kit.map((i) => i.kind).sort()).toEqual(['axe', 'bread', 'hoe', 'knife', 'seed_pouch', 'waterskin'])
      const hut = Object.values(s.structures).find((x) => x.kind === 'hut' && x.owner === id)!
      for (const item of kit) expect(item.loc).toEqual({ t: 'structure', id: hut.id })
      expect(kit.find((i) => i.kind === 'bread')!.qty).toBe(3)
    }
    const store = Object.values(s.structures).find((x) => x.kind === 'storehouse')!
    const stock = Object.values(s.items)
      .filter((i) => i.loc.t === 'structure' && i.loc.id === store.id && i.owner === undefined)
    expect(Object.fromEntries(stock.map((i) => [i.kind, i.qty])))
      .toEqual({ wood: 20, stone: 12, rope: 4, cloth: 4 })
  })

  it('stamps spoilage on the food and on nothing else', () => {
    const s = foldAll()
    const bread = Object.values(s.items).find((i) => i.kind === 'bread')!
    expect(bread.spoilage).toEqual({ spawnDay: 0, days: DEFAULT_CONFIG.spoilage.days['bread'] })
    expect(Object.values(s.items).find((i) => i.kind === 'axe')!.spoilage).toBeUndefined()
  })

  it('folds to a state whose hash is stable across two builds', () => {
    expect(stateHash(foldAll())).toBe(stateHash(foldAll()))
  })

  // Section 9 again: the herd is scattered on both banks, and half of it stands where
  // nobody can walk. That is the lever, not a bug — a bridge is what buys the far side.
  it('scatters the authored herd, warren and schools, schools alone carrying a stock', () => {
    const s = foldAll()
    const fauna = Object.values(s.fauna!)
    expect(fauna).toHaveLength(GENESIS_FAUNA.length)
    for (const f of fauna) {
      expect(f.alive).toBe(true)
      expect(f.stock === undefined).toBe(f.kind !== 'fish')
    }
    expect(fauna.filter((f) => f.kind === 'fish').every((f) => s.terrain[f.y]![f.x] === T_WATER)).toBe(true)
    expect(fauna.some((f) => f.x > 50)).toBe(true)
  })

  it('scatters the authored nodes, both mushrooms among them, every one standing full', () => {
    const s = foldAll()
    const nodes = Object.values(s.forageables!)
    expect(nodes).toHaveLength(GENESIS_FORAGEABLES.length)
    expect(nodes.every((n) => n.stock > 0)).toBe(true)
    const kinds = new Set(nodes.map((n) => n.kind))
    expect(kinds.has('mushroom_patch') && kinds.has('pale_mushroom_patch')).toBe(true)
    expect(nodes.some((n) => n.x > 50)).toBe(true)
  })

  it('mints ids the counter law can follow', () => {
    const s = foldAll()
    for (const id of [
      ...Object.keys(s.structures), ...Object.keys(s.items),
      ...Object.keys(s.fauna ?? {}), ...Object.keys(s.forageables ?? {}),
    ]) {
      expect(id).toMatch(/_\d+$/)
      expect(Number(/_(\d+)$/.exec(id)![1])).toBeLessThan(s.counters.nextEntityId)
    }
  })
})

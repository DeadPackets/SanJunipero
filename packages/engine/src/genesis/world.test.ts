import { describe, it, expect } from 'vitest'
import {
  CITY_ANCHOR_DEFAULT,
  DEFAULT_CONFIG,
  FOUNDER_IDS,
  MINUTES_PER_DAY,
  SimConfigSchema,
  WORLD_SIZE_GENESIS,
  isHearthKind,
  isRoofedKind,
  makeCityTemplate,
  stateHash,
  templateFits,
  type SimEvent,
} from '@sj/shared'
import { fold } from '../fold.js'
import { doorTile } from '../interiors.js'
import { besideAKeptFire, warmthTargetFor } from '../systems/warmth.js'
import { findPath, isPassable, searchPath } from '../path.js'
import { genesisState, type WorldState } from '../state.js'
import { submitIntent } from '../intent.js'
import { RngStreams } from '../rng.js'
import { buildableRecipe, buildTicks, VERBS } from '../verbs.js'
import { GENESIS_FAUNA } from '../data/faunaDefs.js'
import { GENESIS_FORAGEABLES } from '../data/forageables.js'
import {
  makeGenesisWorld,
  genesisDurability,
  GENESIS_FORD,
  GENESIS_FORK_Y,
  GENESIS_BUILDER_ID,
  GENESIS_ROOF_STOOD,
  GENESIS_SOUND_ROOFS,
  roofFell,
  GENESIS_RIVER_X,
} from './world.js'
import { CITY_DWELLING_KINDS } from '@sj/shared'

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
    for (const tile of t.tiles)
      expect(terrain[t.anchor.y + tile.dy]![t.anchor.x + tile.dx]).toBe(tile.to)
    expect(events.some((e) => e.type === 'tile_changed' || e.type === 'terrain_changed')).toBe(
      false,
    )
  })
})

describe('makeGenesisWorld: the town', () => {
  it('plants exactly five houses, one owned by each founder', () => {
    const s = foldAll()
    const houses = Object.values(s.structures).filter((x) => x.kind === 'house')
    expect(houses).toHaveLength(5)
    expect(houses.map((h) => h.owner).sort()).toEqual([...FOUNDER_IDS].sort())
  })

  it('leaves every public building unowned — absent, not null', () => {
    const { events } = makeGenesisWorld(DEFAULT_CONFIG)
    const planned = events
      .filter((e) => e.type === 'structure_planned')
      .map((e) => e.payload as Payload)
    const publics = planned.filter((p) => p.kind !== 'house')
    expect(publics.length).toBeGreaterThan(0)
    for (const p of publics) expect(Object.keys(p)).not.toContain('owner')
    for (const p of planned) expect(p.builderId).toBe(GENESIS_BUILDER_ID)
  })

  // Two buildings still have their roofs and the other seven stand as walls three quarters up.
  // Sound, the valley held 21 bodies against a cast of 5, which is what puts a want in the founding.
  it('plants every building, and stands seven of them roofless', () => {
    const s = foldAll()
    const all = Object.values(s.structures)
    expect(all.length).toBe(makeCityTemplate().structures.length)
    const sound = all
      .filter((x) => x.stage === 'complete')
      .map((x) => x.kind)
      .sort()
    const fallen = all
      .filter((x) => x.stage === 'construction')
      .map((x) => x.kind)
      .sort()
    expect(sound).toEqual(['cabin', 'fire_pit', 'storehouse', 'well'])
    expect(fallen).toEqual(['cottage', 'farmhouse', 'house', 'house', 'house', 'house', 'house'])
  })

  // A roofless building nobody can carry on is a thing that looks like an answer and refuses in
  // words a mind cannot use; roofFell throws rather than plant one.
  it('stands nothing roofless that nobody could finish, and leaves one night of work on it', () => {
    const s = foldAll()
    for (const x of Object.values(s.structures)) {
      if (x.stage !== 'construction') continue
      expect(buildableRecipe(DEFAULT_CONFIG, x.kind), `${x.kind} cannot be finished`).not.toBeNull()
      const left = buildTicks(DEFAULT_CONFIG, x.kind) - x.progressTicks
      expect(left, `${x.kind} left`).toBeGreaterThan(0)
      // One pair of hands, one 720-tick night, for the smallest of them; two pairs for the rest.
      expect(left, `${x.kind} is more than a night for two`).toBeLessThanOrEqual(1440)
      expect(x.progressTicks).toBe(
        Math.floor(buildTicks(DEFAULT_CONFIG, x.kind) * GENESIS_ROOF_STOOD),
      )
    }
    // And nothing without a roof to lose lost one.
    expect(
      s.structures[Object.keys(s.structures).find((id) => s.structures[id]!.kind === 'well')!]!
        .stage,
    ).toBe('complete')
  })

  it('takes footprint from the template and durability from the one table that knows', () => {
    const s = foldAll()
    const house = Object.values(s.structures).find((x) => x.kind === 'house')!
    expect({ w: house.w, h: house.h }).toEqual({ w: 2, h: 2 })
    expect(house.maxHp).toBe(DEFAULT_CONFIG.structures.recipes.house!.maxHp)
    expect(house.flammable).toBe(true)
    const well = Object.values(s.structures).find((x) => x.kind === 'well')!
    expect(well.maxHp).toBe(DEFAULT_CONFIG.structures.recipes.well!.maxHp)
    expect(well.flammable).toBe(false)
  })

  // The template may place any of the three dwelling kinds; genesis has to know how tough each
  // one is BEFORE the plan uses it, or the first cottage throws on the morning of day one.
  it('knows a durability for every dwelling kind the shared contract names', () => {
    for (const kind of CITY_DWELLING_KINDS)
      expect(genesisDurability(DEFAULT_CONFIG, kind), kind).not.toBeNull()
    expect(genesisDurability(DEFAULT_CONFIG, 'observatory')).toBeNull()
  })

  it('knows a durability for every kind the template actually stands', () => {
    for (const s of makeCityTemplate().structures)
      expect(genesisDurability(DEFAULT_CONFIG, s.kind), s.kind).not.toBeNull()
  })

  // Section 9: the far bank is earned, not given. Nothing crosses the water on day one.
  it('builds no bridge, and the far bank has no route to it', () => {
    const s = foldAll()
    expect(Object.values(s.structures).some((x) => x.kind === 'bridge')).toBe(false)
    const inFord = (y: number): boolean => y >= GENESIS_FORD.y0 && y <= GENESIS_FORD.y1
    expect(
      s.terrain.every(
        (row, y) =>
          row[48] === T_WATER && row[49] === T_WATER && (row[50] === T_WATER) === !inFord(y),
      ),
    ).toBe(true)
    // 128x128 holds more open ground than the 6000-node budget can walk, so the search cannot
    // prove the far bank unreachable — it spends the budget and stops at the water.
    const across = searchPath(s, { x: 30, y: 100 }, { x: 55, y: 100 }, DEFAULT_CONFIG)!
    expect(across.capped).toBe(true)
    expect(across.path.every(([x]) => x < 48)).toBe(true)
    expect(findPath(s, { x: 55, y: 100 }, { x: 55, y: 40 }, DEFAULT_CONFIG)).not.toBeNull()
  })

  it('gives every founder a kit inside their own roof, and the stock to the storehouse', () => {
    const s = foldAll()
    for (const id of FOUNDER_IDS) {
      const kit = Object.values(s.items).filter((i) => i.owner === id)
      expect(kit.map((i) => i.kind).sort()).toEqual([
        'axe',
        'bread',
        'hoe',
        'knife',
        'seed_pouch',
        'waterskin',
      ])
      const house = Object.values(s.structures).find((x) => x.kind === 'house' && x.owner === id)!
      for (const item of kit) expect(item.loc).toEqual({ t: 'structure', id: house.id })
      expect(kit.find((i) => i.kind === 'bread')!.qty).toBe(3)
    }
    const store = Object.values(s.structures).find((x) => x.kind === 'storehouse')!
    const stock = Object.values(s.items).filter(
      (i) => i.loc.t === 'structure' && i.loc.id === store.id && i.owner === undefined,
    )
    expect(Object.fromEntries(stock.map((i) => [i.kind, i.qty]))).toEqual({
      wood: 20,
      stone: 12,
      rope: 4,
      cloth: 4,
    })
  })

  it('stamps spoilage on the food and on nothing else', () => {
    const s = foldAll()
    const bread = Object.values(s.items).find((i) => i.kind === 'bread')!
    expect(bread.spoilage).toEqual({ spawnDay: 0, days: DEFAULT_CONFIG.spoilage.days.bread })
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
    expect(
      fauna.filter((f) => f.kind === 'fish').every((f) => s.terrain[f.y]![f.x] === T_WATER),
    ).toBe(true)
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

  // The clothing line had no source: fiber existed only in a recipe's input list.
  it('stands the reeds by the water, on both banks, on ground a body can reach', () => {
    const s = foldAll()
    const reeds = Object.values(s.forageables!).filter((n) => n.kind === 'reed_bed')
    expect(reeds.length).toBeGreaterThanOrEqual(2)
    for (const r of reeds) {
      expect(Math.abs(r.x - GENESIS_RIVER_X)).toBeLessThanOrEqual(3)
      expect(isPassable(s, r.x, r.y)).toBe(true)
      expect(s.terrain[r.y]![r.x]).not.toBe(T_WATER)
    }
    // One bank the town stands on, one it does not: the far reeds wait on a bridge.
    expect(reeds.some((r) => r.x > 50)).toBe(true)
    expect(reeds.some((r) => r.x < 48)).toBe(true)
  })

  it('mints ids the counter law can follow', () => {
    const s = foldAll()
    for (const id of [
      ...Object.keys(s.structures),
      ...Object.keys(s.items),
      ...Object.keys(s.fauna ?? {}),
      ...Object.keys(s.forageables ?? {}),
    ]) {
      expect(id).toMatch(/_\d+$/)
      expect(Number(/_(\d+)$/.exec(id)![1])).toBeLessThan(s.counters.nextEntityId)
    }
  })
})

// Every line of it measured rather than reasoned: the arithmetic of a deck against
// the arithmetic of a channel, then a walk that actually arrives.
describe('the ford: one reach where the channel runs two wide', () => {
  const T_SAND = 5

  it('narrows the water to two tiles across four rows, and nowhere else', () => {
    const { terrain } = makeGenesisWorld(DEFAULT_CONFIG)
    const widths = terrain.map(
      (row) => row.filter((t, x) => t === T_WATER && Math.abs(x - GENESIS_RIVER_X) <= 1).length,
    )
    for (let y = 0; y < terrain.length; y++) {
      const narrowed = y >= GENESIS_FORD.y0 && y <= GENESIS_FORD.y1
      expect(widths[y], `y=${y}`).toBe(narrowed ? 2 : 3)
      if (narrowed) expect(terrain[y]![GENESIS_FORD.x]).toBe(T_SAND)
    }
    expect(GENESIS_FORD.y1 - GENESIS_FORD.y0 + 1).toBe(4)
  })

  it('leaves a bank on both sides of it, and dry ground to stand on', () => {
    const s = foldAll()
    for (let y = GENESIS_FORD.y0; y <= GENESIS_FORD.y1; y++) {
      expect(isPassable(s, 47, y), `west bank at y=${y}`).toBe(true)
      expect(isPassable(s, GENESIS_FORD.x, y), `the spit at y=${y}`).toBe(true)
      expect(isPassable(s, 48, y)).toBe(false)
      expect(isPassable(s, 49, y)).toBe(false)
    }
  })

  it('takes a bridge, and the bridge takes feet to the far bank', () => {
    const s = foldAll()
    const y = GENESIS_FORD.y0 + 1
    let world = fold(
      s,
      {
        seq: 9000,
        tick: 0,
        type: 'agent_spawned',
        payload: { id: 'builder', name: 'Bridger', x: GENESIS_FORD.x, y, ageDays: 7300 },
      },
      DEFAULT_CONFIG,
    )
    world = fold(
      world,
      {
        seq: 9001,
        tick: 0,
        type: 'item_spawned',
        payload: { id: 'planks', kind: 'wood', qty: 6, loc: { t: 'agent', id: 'builder' } },
      },
      DEFAULT_CONFIG,
    )

    // Nowhere else on the river will take one: measured from the same bank, three rows south.
    const wide = submitIntent(world, DEFAULT_CONFIG, 'builder', 'build', {
      kind: 'bridge',
      x: 48,
      y: GENESIS_FORD.y1 + 2,
    })
    expect(wide.ok).toBe(false)

    const started = submitIntent(world, DEFAULT_CONFIG, 'builder', 'build', {
      kind: 'bridge',
      x: 48,
      y,
    })
    expect(started.ok).toBe(true)
    const planned = started.ok
      ? (started.events.find((e) => e.type === 'structure_planned')!.payload as Record<
          string,
          number
        >)
      : {}
    expect([planned.w, planned.h]).toEqual([2, 1])

    // Lay the deck by hand — the point being measured is the crossing, not the labour.
    let crossed = fold(
      world,
      {
        seq: 9002,
        tick: 0,
        type: 'structure_planned',
        payload: {
          id: 'structure_bridge',
          kind: 'bridge',
          x: 48,
          y,
          w: 2,
          h: 1,
          maxHp: 20,
          flammable: false,
          builderId: 'builder',
        },
      },
      DEFAULT_CONFIG,
    )
    crossed = fold(
      crossed,
      { seq: 9003, tick: 0, type: 'structure_completed', payload: { id: 'structure_bridge' } },
      DEFAULT_CONFIG,
    )

    const route = findPath(crossed, { x: GENESIS_FORD.x, y }, { x: 45, y }, DEFAULT_CONFIG)
    expect(route).not.toBeNull()
    expect(route!.some(([x]) => x === 48)).toBe(true)
    // And with no deck there is still no crossing.
    expect(findPath(s, { x: GENESIS_FORD.x, y }, { x: 45, y }, DEFAULT_CONFIG)).toBeNull()
  })
})

// fireIsOnYourSide warms a roofed body only from a fire in its own room, and the square's pit is
// roofless — the cabin is the valley's only indoor fire.
describe('★ a fire indoors that a body can walk to, on the morning of day one', () => {
  const CFG = DEFAULT_CONFIG
  const isWarmRoom = (kind: string) => isRoofedKind(CFG, kind) && isHearthKind(CFG, kind)
  const warmRooms = (s: WorldState) =>
    Object.values(s.structures).filter((st) => st.stage === 'complete' && isWarmRoom(st.kind))

  it('★ stands at least one, and an open fire is not one of them', () => {
    const s = foldAll()
    expect(warmRooms(s).length, 'nowhere indoors a body can be warm').toBeGreaterThan(0)

    const pit = Object.values(s.structures).find((st) => st.kind === 'fire_pit')!
    expect(pit.stage).toBe('complete')
    expect(isHearthKind(CFG, 'fire_pit'), 'the pit is a fire').toBe(true)
    expect(isRoofedKind(CFG, 'fire_pit'), 'and it is not indoors').toBe(false)
    expect(warmRooms(s).map((w) => w.kind)).not.toContain('fire_pit')

    // Vacuous guard, both ways: some roof over the valley still holds no fire, and some fire in it
    // is still behind unfinished walls. This passes for the wrong reason if everything is warm.
    expect(
      Object.values(s.structures).some(
        (st) =>
          st.stage === 'complete' && isRoofedKind(CFG, st.kind) && !isHearthKind(CFG, st.kind),
      ),
    ).toBe(true)
    expect(
      Object.values(s.structures).some((st) => st.stage === 'construction' && isWarmRoom(st.kind)),
    ).toBe(true)
  })

  // roofFell throws on a roofed kind that is unbuildable and not sound, so the sound set is FORCED
  // to be exactly the unbuildable roofed kinds. There are two, and one is a roof over goods.
  it('★ had one candidate, because the sound set is forced and not chosen', () => {
    const unbuildableRoofs = Object.keys(CFG.structures.recipes)
      .filter((k) => isRoofedKind(CFG, k) && buildableRecipe(CFG, k) === null)
      .sort()
    expect([...GENESIS_SOUND_ROOFS].sort()).toEqual(unbuildableRoofs)
    expect(unbuildableRoofs).toEqual(['cabin', 'storehouse'])
    expect(isHearthKind(CFG, 'storehouse'), 'a storehouse is a roof over goods').toBe(false)

    // And a roofed kind outside the set that nobody could finish is refused out loud rather
    // than planted as a wall that lies — which is the whole reason the set cannot grow.
    const withHut = {
      ...CFG,
      structures: {
        ...CFG.structures,
        recipes: {
          ...CFG.structures.recipes,
          hut: { ...CFG.structures.recipes.cabin!, inputs: {} },
        },
      },
    }
    expect(() => roofFell(withHut, 'hut')).toThrow(/nobody could finish/)
    expect(roofFell(CFG, 'cabin'), 'the cabin stands').toBe(false)
    expect(roofFell(CFG, 'cottage'), 'and a cottage does not').toBe(true)
  })

  // Reachability proved by walking it, not by eye: the pathfinder the world uses, from the door
  // a founder wakes at, to the door `enter` will accept — and then the whole chain through it.
  it('★ and a founder walks there from their own doorstep, goes in, feeds it, and is warmer', () => {
    const base = foldAll()
    const rooms = warmRooms(base).sort((a, b) => a.id.localeCompare(b.id))
    expect(rooms.length, 'no fire indoors to walk to').toBeGreaterThan(0)
    const room = rooms[0]!
    const target = doorTile(base, room)!
    const store = Object.values(base.structures).find(
      (st) => st.kind === 'storehouse' && st.stage === 'complete',
    )!

    // Every founder's own front door, and the storehouse door where the valley's 20 wood is:
    // the fuel and the fire have to be on the same side of the water as well.
    const starts = Object.values(base.structures)
      .filter((st) => st.kind === 'house')
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((st) => doorTile(base, st)!)
    expect(starts).toHaveLength(FOUNDER_IDS.length)
    for (const from of [...starts, doorTile(base, store)!]) {
      const route = searchPath(base, from, target, CFG)
      expect(route, `no way from (${from.x}, ${from.y}) to the fire`).not.toBeNull()
      expect(route!.capped, 'the walk ran out of budget').toBe(false)
    }

    // A winter night, one body on the doorstep, one armful of wood in its hands.
    const NIGHT = 273 * MINUTES_PER_DAY + 22 * 60 + 30
    let s = fold(base, { seq: 9100, tick: 0, type: 'tick_advanced', payload: {} }, CFG)
    s = fold(s, { seq: 9101, tick: NIGHT, type: 'tick_advanced', payload: {} }, CFG)
    s = fold(
      s,
      {
        seq: 9102,
        tick: NIGHT,
        type: 'weather_changed',
        payload: { kind: 'sunny', temperatureC: -10 },
      },
      CFG,
    )
    s = fold(
      s,
      {
        seq: 9103,
        tick: NIGHT,
        type: 'agent_spawned',
        payload: { id: 'walker', name: 'Walker', x: starts[0]!.x, y: starts[0]!.y, ageDays: 7300 },
      },
      CFG,
    )
    s = fold(
      s,
      {
        seq: 9104,
        tick: NIGHT,
        type: 'item_spawned',
        payload: { id: 'armful', kind: 'wood', qty: 1, loc: { t: 'agent', id: 'walker' } },
      },
      CFG,
    )
    const outside = warmthTargetFor(s, CFG, 'walker')

    // The walk itself, one step at a time down the route the pathfinder returned.
    let seq = 9200
    for (const [x, y] of findPath(s, starts[0]!, target, CFG)!) {
      s = fold(
        s,
        { seq: seq++, tick: NIGHT, type: 'agent_moved', payload: { id: 'walker', x, y } },
        CFG,
      )
    }
    expect([s.agents.walker!.x, s.agents.walker!.y]).toEqual([target.x, target.y])

    /** Run a verb to completion the way the tick loop would, and refuse to guess. */
    const apply = (verb: string, params: Record<string, unknown>): void => {
      const r = submitIntent(s, CFG, 'walker', verb, params)
      expect(r.ok, r.ok ? '' : `${verb}: ${r.reason}`).toBe(true)
      const done = VERBS[verb]!.onComplete(
        s,
        CFG,
        'walker',
        params,
        new RngStreams('genesis-fire').get('actions'),
      )
      for (const e of [
        ...(r.ok ? r.events : []),
        { type: 'action_completed', payload: { agentId: 'walker', verb } },
        ...done,
      ]) {
        s = fold(s, { seq: seq++, tick: NIGHT, type: e.type, payload: e.payload }, CFG)
      }
    }

    apply('enter', { structureId: room.id })
    expect(s.agents.walker!.insideId).toBe(room.id)

    // Indoors and cold: the roof alone buys a body nothing against the air, which is exactly
    // why a roofed hearthless valley measured no hearth behaviour.
    expect(warmthTargetFor(s, CFG, 'walker')).toBe(outside)

    apply('stoke', { structureId: room.id })

    expect(besideAKeptFire(s, CFG, 'walker'), 'the fire is not reaching the body').toBe(true)
    expect(warmthTargetFor(s, CFG, 'walker')).toBeGreaterThan(outside)
    expect(warmthTargetFor(s, CFG, 'walker') - outside).toBe(2 * CFG.warmth.fireWarmth)
  })
})

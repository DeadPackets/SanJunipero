// @slow — GATE G11a, the water and the ground: the bucket line, the channel, the crossing, and
// the roads feet make. Scripted actors only, no LLM, $0. Every row is an addendum §18 criterion.
import { describe, it, expect } from 'vitest'
import { fertilityAt, MINUTES_PER_DAY, SimConfigSchema, type SimConfig } from '@sj/shared'
import { fold } from './fold.js'
import { submitIntent } from './intent.js'
import { findPath, stepCostAt, terrainCostFor, BRIDGE_KIND } from './path.js'
import { RngStreams } from './rng.js'
import { genesisState, type TileId, type WorldState } from './state.js'
import { BUCKET_KIND, STONE_KIND, type PendingEvent } from './verbs.js'
import { createWorldTick } from './worldTick.js'
import { ev, grid } from './testutil/world.js'

const QUIET = {
  weather: { hourlyChangeChance: 0 },
  mystery: { chancePerDay: 0 },
  fauna: { enabled: false },
  regrowth: { enabled: false },
  aging: { deathOfOldAgeEnabled: false },
}
const CFG: SimConfig = SimConfigSchema.parse(QUIET)

const MAP = (n = 24): TileId[][] => grid(n)

function spawn(s: WorldState, config: SimConfig, id: string, x: number, y: number): WorldState {
  return fold(s, ev('agent_spawned', { id, name: id, x, y, ageDays: 7300 }), config)
}

function give(
  s: WorldState,
  config: SimConfig,
  id: string,
  itemId: string,
  kind: string,
  qty: number,
  extra: Record<string, unknown> = {},
): WorldState {
  return fold(
    s,
    ev('item_spawned', { id: itemId, kind, qty, loc: { t: 'agent', id }, ...extra }),
    config,
  )
}

type Box = { id: string; kind: string; x: number; y: number; w: number; h: number }

function raise(s: WorldState, config: SimConfig, box: Box, flammable = true): WorldState {
  const planned = fold(
    s,
    ev('structure_planned', { ...box, maxHp: 50, flammable, builderId: 'script' }),
    config,
  )
  return fold(planned, ev('structure_completed', { id: box.id }), config)
}

function pass(
  s: WorldState,
  config: SimConfig,
  tick: number,
  seed = 'g11a-water',
): {
  state: WorldState
  events: PendingEvent[]
} {
  const advanced = fold({ ...s, tick: tick - 1 }, ev('tick_advanced', {}, tick), config)
  return createWorldTick(config, new RngStreams(seed))(advanced)
}

const apply = (
  s: WorldState,
  config: SimConfig,
  events: PendingEvent[],
  tick: number,
): WorldState => events.reduce((acc, e) => fold(acc, ev(e.type, e.payload, tick), config), s)

// Submit an intent and run the world until the body is idle again. Returns everything that
// happened, so a row can name the event as well as the state it left behind.
function doVerb(
  s: WorldState,
  config: SimConfig,
  tick: number,
  agentId: string,
  verb: string,
  params: Record<string, unknown> = {},
  limit = 600,
  seed = 'g11a-water',
): { state: WorldState; events: PendingEvent[]; refusal: string | null } {
  // The clock the intent is judged against is the clock the world is on: the dark charges
  // half again for a build, and a fixture that submits at the wrong hour buys a different verb.
  const at: WorldState = { ...s, tick }
  const started = submitIntent(at, config, agentId, verb, params)
  if (!started.ok) return { state: s, events: [], refusal: started.reason }
  let state = apply(at, config, started.events, tick)
  const events: PendingEvent[] = [...started.events]
  for (let t = tick + 1; t <= tick + limit; t++) {
    const out = pass(state, config, t, seed)
    state = out.state
    events.push(...out.events)
    if (state.agents[agentId]!.activity === null) break
  }
  return { state, events, refusal: null }
}

// ------------------------------------------------------------------ the bucket line

describe('G11a-W1: a bucket filled at the river puts out a fire', () => {
  const SHED: Box = { id: 'structure_1', kind: 'shed', x: 6, y: 5, w: 2, h: 2 }

  function town(): WorldState {
    const terrain = MAP()
    for (const row of terrain) row[2] = 2 // a river down the west side
    let s = raise(genesisState(CFG, terrain), CFG, SHED)
    s = spawn(s, CFG, 'hand', 3, 5)
    s = give(s, CFG, 'hand', 'item_bucket', BUCKET_KIND, 1, { charges: 0 })
    s = fold(s, ev('fire_ignited', { structureId: SHED.id, cause: 'lightning' }, 100), CFG)
    return { ...s, tick: 100 }
  }

  it('fill takes one dose from the water, and douse spends it on the wall', () => {
    let s = town()
    expect(s.structures[SHED.id]!.burning).toBe(true)

    const filled = doVerb(s, CFG, 101, 'hand', 'fill', { itemId: 'item_bucket' })
    expect(filled.refusal).toBeNull()
    expect(filled.state.items.item_bucket!.charges).toBe(1)

    // Carry it to the wall — the same body, two tiles east, standing beside the shed.
    s = fold(filled.state, ev('agent_moved', { id: 'hand', x: 5, y: 5 }, 110), CFG)
    const out = doVerb(s, CFG, 111, 'hand', 'douse', { x: 6, y: 5 })
    expect(out.refusal).toBeNull()
    const put = out.events.find((e) => e.type === 'fire_extinguished')
    expect(put).toBeDefined()
    expect((put!.payload as { cause: string }).cause).toBe('doused')
    expect(out.state.structures[SHED.id]!.burning).toBe(false)
    expect(out.state.items.item_bucket!.charges).toBe(0)
  })

  it('an empty bucket is refused, and so is a fire nobody is standing near', () => {
    const s = town()
    expect(doVerb(s, CFG, 101, 'hand', 'douse', { x: 6, y: 5 }).refusal).toBe(
      'not close enough to the fire',
    )
    const beside = fold(s, ev('agent_moved', { id: 'hand', x: 5, y: 5 }, 105), CFG)
    expect(doVerb(beside, CFG, 106, 'hand', 'douse', { x: 6, y: 5 }).refusal).toBe(
      'the bucket is empty',
    )
  })
})

// ------------------------------------------------------------------ the channel and the field

describe('G11a-W2: water led to the field, and the harvest that says so', () => {
  // A field far from any water, and one tile of it within a spade's reach of the river.
  function field(): WorldState {
    const terrain = MAP(32)
    for (const row of terrain) row[2] = 2
    terrain[10]![20] = 6 // farmland, well out of the river's reach
    terrain[10]![19] = 0
    let s = spawn(genesisState(CFG, terrain), CFG, 'farmer', 19, 10)
    s = fold(
      s,
      ev('crop_planted', { id: 'crop_1', kind: 'wheat', x: 20, y: 10, plantedDay: 0 }, 0),
      CFG,
    )
    s = fold(s, ev('crop_grew', { cropId: 'crop_1', stage: 3 }, 0), CFG)
    return { ...s, tick: 100 }
  }

  it('dig_channel refuses ground no water reaches, and cuts where the river does', () => {
    const s = field()
    // Nothing feeds (19, 10): the river is eighteen tiles west.
    expect(doVerb(s, CFG, 101, 'farmer', 'dig_channel', { x: 19, y: 10 }).refusal).toBe(
      'no water reaches here',
    )

    const bank = fold(s, ev('agent_moved', { id: 'farmer', x: 3, y: 10 }, 101), CFG)
    const cut = doVerb(bank, CFG, 102, 'farmer', 'dig_channel', { x: 3, y: 10 })
    expect(cut.refusal).toBeNull()
    expect(cut.state.terrain[10]![3]).toBe(10)
  })

  it('the cut raises the ground it reaches, and the harvest is the multiplier, exactly', () => {
    const s = field()
    const dry = fertilityAt(s.terrain, 20, 10, CFG)
    expect(dry).toBe(1)
    const dryYield = doVerb(s, CFG, 101, 'farmer', 'harvest', { cropId: 'crop_1' })
    expect(dryYield.refusal).toBeNull()
    const dryGrain = dryYield.events.find((e) => e.type === 'item_spawned')!.payload as {
      qty: number
    }
    expect(dryGrain.qty).toBe(Math.floor(CFG.crops.wheat!.yield * dry))

    // Now a channel one tile from the plot, and nothing else changed.
    const wet = field()
    wet.terrain[10]![19] = 10
    const raised = fertilityAt(wet.terrain, 20, 10, CFG)
    expect(raised).toBeCloseTo(
      1 + CFG.fertility.waterBonus * (1 - 1 / (CFG.fertility.radius + 1)),
      12,
    )
    expect(raised).toBeGreaterThan(dry)
    const wetYield = doVerb(wet, CFG, 101, 'farmer', 'harvest', { cropId: 'crop_1' })
    const wetGrain = wetYield.events.find((e) => e.type === 'item_spawned')!.payload as {
      qty: number
    }
    expect(wetGrain.qty).toBe(Math.floor(CFG.crops.wheat!.yield * raised))
    expect(wetGrain.qty).toBeGreaterThan(dryGrain.qty)
  })

  it('with the law switched off the ground is flat again', () => {
    const OFF: SimConfig = SimConfigSchema.parse({ ...QUIET, fertility: { enabled: false } })
    const wet = field()
    wet.terrain[10]![19] = 10
    expect(fertilityAt(wet.terrain, 20, 10, OFF)).toBe(1)
  })
})

// ------------------------------------------------------------------ the crossing

describe('G11a-W3: a bridge completes, and the far bank stops being far', () => {
  // A river two tiles wide, so a six-plank deck can span it. Banks at x 9 and x 12.
  function banks(): WorldState {
    const terrain = MAP(24)
    for (const row of terrain) {
      row[10] = 2
      row[11] = 2
    }
    let s = spawn(genesisState(CFG, terrain), CFG, 'builder', 9, 5)
    s = give(s, CFG, 'builder', 'item_wood', 'wood', 6)
    return { ...s, tick: 100 }
  }

  it('before the deck, no route exists and the legs stop at the water', () => {
    const s = banks()
    expect(findPath(s, { x: 9, y: 5 }, { x: 13, y: 5 }, CFG)).toBeNull()
    // Walking to the far bank is refused for what it is: there is no way across yet.
    expect(submitIntent(s, CFG, 'builder', 'walk', { x: 13, y: 5 })).toEqual({
      ok: false,
      reason: 'no path to that spot',
    })
    // The near bank is still reachable, so it is the river and not the pathfinder.
    expect(findPath(s, { x: 9, y: 5 }, { x: 9, y: 12 }, CFG)).not.toBeNull()
  })

  it('the deck is laid across the narrows and walked at road cost', () => {
    const s = banks()
    // Started in daylight: the dark charges a build half again as much, and this row is
    // about the crossing and not about the hour.
    const out = doVerb(
      s,
      CFG,
      600,
      'builder',
      'build',
      { kind: BRIDGE_KIND, x: 10, y: 5 },
      CFG.structures.recipes.bridge!.durationTicks + 60,
    )
    expect(out.refusal).toBeNull()
    const deck = Object.values(out.state.structures).find((x) => x.kind === BRIDGE_KIND)
    expect(deck).toBeDefined()
    expect(out.events.filter((e) => e.type === 'action_interrupted')).toEqual([])
    expect(deck!.stage).toBe('complete')
    // The recipe is written one wide and two tall; the river runs the other way, so the
    // deterministic transpose lays it the way the water needs.
    expect({ w: deck!.w, h: deck!.h }).toEqual({ w: 2, h: 1 })

    // The far bank is reachable now, and every plank of the deck walks like a road.
    const route = findPath(out.state, { x: 9, y: 5 }, { x: 13, y: 5 }, CFG)
    expect(route).not.toBeNull()
    expect(route!.some(([x, y]) => x === 10 && y === 5)).toBe(true)
    expect(stepCostAt(out.state, 10, 5, CFG)).toBe(CFG.pathing.roadCost)
    expect(stepCostAt(out.state, 11, 5, CFG)).toBe(CFG.pathing.roadCost)
  })

  it('a deck over dry land, and one with a foot in open water, are both refused', () => {
    const s = banks()
    // Dry ground the builder is standing right beside, so the refusal is about the ground.
    expect(doVerb(s, CFG, 600, 'builder', 'build', { kind: BRIDGE_KIND, x: 8, y: 5 }).refusal).toBe(
      'a bridge belongs over water',
    )
    // Three tiles of water and no bank at the far end: the wide crossing has nothing to rest on.
    const wide = banks()
    for (const row of wide.terrain) row[12] = 2
    expect(
      doVerb(wide, CFG, 600, 'builder', 'build', { kind: BRIDGE_KIND, x: 10, y: 5 }).refusal,
    ).toBe('both ends must reach something solid')
  })
})

// ------------------------------------------------------------------ roads, and the paths feet make

describe('G11a-W4: pave converts and consumes, and the costs are ordered', () => {
  it('a stretch of road costs stone and changes the ground', () => {
    let s = spawn(genesisState(CFG, MAP()), CFG, 'mason', 5, 5)
    s = give(s, CFG, 'mason', 'item_stone', STONE_KIND, 2)
    s = { ...s, tick: 100 }
    const out = doVerb(s, CFG, 101, 'mason', 'pave', { x: 6, y: 5 })
    expect(out.refusal).toBeNull()
    expect(out.state.terrain[5]![6]).toBe(7)
    expect(out.state.items.item_stone!.qty).toBe(2 - CFG.roads.stonePerTile)
    const laid = out.events.find((e) => e.type === 'tile_changed')!.payload as {
      reason: string
      byId: string
    }
    expect(laid).toMatchObject({ reason: 'paved', byId: 'mason' })

    // Spend the last stone and the next stretch is refused for the reason it is.
    const spent = doVerb(out.state, CFG, 110, 'mason', 'pave', { x: 6, y: 6 })
    expect(spent.refusal).toBeNull()
    expect(spent.state.items.item_stone).toBeUndefined()
    expect(doVerb(spent.state, CFG, 120, 'mason', 'pave', { x: 5, y: 6 }).refusal).toMatch(
      /^not enough stone — /,
    )
  })

  it('grass costs more than a worn path, and a worn path more than a road', () => {
    const cost = terrainCostFor(CFG)
    expect(cost[0]).toBeGreaterThan(cost[8])
    expect(cost[8]).toBeGreaterThan(cost[7])

    // Three corridors of the same length, walled off from each other. The road lane costs two
    // extra grass tiles at each end and is still cheapest, which holds only if tiles are priced.
    const W = 42,
      H = 14
    const terrain: TileId[][] = Array.from({ length: H }, () =>
      Array.from({ length: W }, (): TileId => 2),
    )
    for (let y = 0; y < H; y++) {
      terrain[y]![0] = 0
      terrain[y]![W - 1] = 0
    }
    for (let x = 1; x < W - 1; x++) {
      terrain[4]![x] = 0
      terrain[6]![x] = 8
      terrain[8]![x] = 7
    }
    const s = genesisState(CFG, terrain)
    const route = findPath(s, { x: 0, y: 6 }, { x: W - 1, y: 6 }, CFG)
    expect(route).not.toBeNull()
    expect(route!.some(([, y]) => y === 8)).toBe(true)
    expect(route!.some(([, y]) => y === 4)).toBe(false)
  })
})

describe('G11a-W5: feet wear a trail, and grass takes it back', () => {
  // The threshold is dialled down to make a trail reachable inside a test; the number the world
  // ships with is asserted first, so the dial is visible and never a quiet weakening.
  const WEAR_AT = 4
  const WORN: SimConfig = SimConfigSchema.parse({
    ...QUIET,
    desirePaths: { wearThreshold: WEAR_AT },
  })
  const MID = { x: 5, y: 7 }

  // A body walking a line, back and forth, `crossings` times over the middle tile.
  function trodden(crossings: number): WorldState {
    let s = spawn(genesisState(WORN, MAP()), WORN, 'walker', 5, 5)
    s = { ...s, tick: 100 }
    let tick = 101
    for (let i = 0; i < crossings; i++) {
      const to = i % 2 === 0 ? { x: 5, y: 9 } : { x: 5, y: 5 }
      const out = doVerb(s, WORN, tick, 'walker', 'walk', to, 20)
      expect(out.refusal).toBeNull()
      s = out.state
      tick += 20
    }
    return s
  }

  it('a tile wears through at exactly the threshold, and not one footfall before', () => {
    expect(CFG.desirePaths.wearThreshold).toBe(120) // the number the world itself ships with

    const short = trodden(WEAR_AT - 1)
    expect(short.traffic?.[`${MID.x},${MID.y}`]).toBe(WEAR_AT - 1)
    const quiet = pass(short, WORN, MINUTES_PER_DAY)
    expect(quiet.events.filter((e) => e.type === 'tile_changed')).toEqual([])
    expect(quiet.state.terrain[MID.y]![MID.x]).toBe(0)

    const enough = trodden(WEAR_AT)
    expect(enough.traffic?.[`${MID.x},${MID.y}`]).toBe(WEAR_AT)
    const out = pass(enough, WORN, MINUTES_PER_DAY)
    const worn = out.events.filter((e) => e.type === 'tile_changed')
    // The three tiles the route passes THROUGH wear; the two it starts and ends on are
    // stepped onto half as often and do not.
    expect(worn.map((e) => e.payload)).toEqual([
      { x: 5, y: 6, from: 0, to: 8, reason: 'worn' },
      { x: 5, y: 7, from: 0, to: 8, reason: 'worn' },
      { x: 5, y: 8, from: 0, to: 8, reason: 'worn' },
    ])
    expect(out.state.terrain[MID.y]![MID.x]).toBe(8)
    expect(out.state.terrain[5]![5]).toBe(0)
    expect(out.state.terrain[9]![5]).toBe(0)
  })

  it('an unused trail is stamped quiet and overgrows on the day the clock names', () => {
    const terrain = MAP()
    terrain[MID.y]![MID.x] = 8
    let s = genesisState(CFG, terrain)
    const key = `${MID.x},${MID.y}`
    const days = CFG.desirePaths.overgrowDays

    let overgrewOn: number | null = null
    for (let day = 1; day <= days + 1; day++) {
      const out = pass(s, CFG, day * MINUTES_PER_DAY)
      s = out.state
      if (day === 1) expect(s.quietSince?.[key]).toBe(1)
      const back = out.events.find(
        (e) =>
          e.type === 'tile_changed' && (e.payload as { reason?: string }).reason === 'overgrown',
      )
      if (back !== undefined && overgrewOn === null) overgrewOn = day
    }
    expect(overgrewOn).toBe(1 + days)
    expect(s.terrain[MID.y]![MID.x]).toBe(0)
    expect(s.quietSince?.[key]).toBeUndefined()
  })

  it('with the law off, feet leave no mark at all', () => {
    const OFF: SimConfig = SimConfigSchema.parse({ ...QUIET, desirePaths: { enabled: false } })
    let s = spawn(genesisState(OFF, MAP()), OFF, 'walker', 5, 5)
    s = { ...s, tick: 100 }
    const out = doVerb(s, OFF, 101, 'walker', 'walk', { x: 5, y: 9 }, 20)
    expect(out.refusal).toBeNull()
    expect(out.state.traffic).toBeUndefined()
  })
})

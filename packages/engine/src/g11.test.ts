// @slow — the whole-world half: the 128x128 town, the map that widens, the laws an operator may
// move, the night that hides a taking, and whether a competent body would have lived.
import { describe, it, expect } from 'vitest'
import {
  CHUNK_TILES,
  chunkOf,
  chunksTouched,
  MINUTES_PER_DAY,
  SimConfigSchema,
  stateHash,
  type SimConfig,
  type SimEvent,
} from '@sj/shared'
import { openDb } from './db.js'
import { EventStore } from './eventStore.js'
import { fold } from './fold.js'
import { makeGenesisWorld } from './genesis/world.js'
import { submitIntent } from './intent.js'
import { doorTile } from './interiors.js'
import { applyLaw, TOGGLABLE_PATHS, type LawQueue } from './laws.js'
import { searchPath } from './path.js'
import { composePerception } from './perception.js'
import { replayFromGenesis } from './replay.js'
import { RngStreams } from './rng.js'
import { genesisState, thirstOf, type TileId, type WorldState } from './state.js'
import { GROWTH_EDGES } from './systems/mapGrowth.js'
import { VERBS, type PendingEvent } from './verbs.js'
import { createWorldTick } from './worldTick.js'

const QUIET = {
  weather: { hourlyChangeChance: 0 },
  mystery: { chancePerDay: 0 },
  aging: { deathOfOldAgeEnabled: false },
}
const CFG: SimConfig = SimConfigSchema.parse(QUIET)

let seq = 730000
const ev = (type: string, payload: unknown, tick = 0): SimEvent => ({
  seq: seq++,
  tick,
  type,
  payload,
})

const MAP = (n = 24): TileId[][] =>
  Array.from({ length: n }, () => Array.from({ length: n }, (): TileId => 0))

function pass(
  s: WorldState,
  config: SimConfig,
  tick: number,
  seed = 'g11a',
  laws?: LawQueue,
): {
  state: WorldState
  events: PendingEvent[]
} {
  const advanced = fold({ ...s, tick: tick - 1 }, ev('tick_advanced', {}, tick), config)
  return createWorldTick(config, new RngStreams(seed), laws)(advanced)
}

const apply = (
  s: WorldState,
  config: SimConfig,
  events: PendingEvent[],
  tick: number,
): WorldState => events.reduce((acc, e) => fold(acc, ev(e.type, e.payload, tick), config), s)

// The whole genesis town, folded: this is the fixture every 128x128 row below stands on.
function genesisTown(config: SimConfig = CFG): {
  state: WorldState
  terrain: TileId[][]
  events: PendingEvent[]
} {
  const { terrain, events } = makeGenesisWorld(config)
  const state = events.reduce(
    (s, e) => fold(s, ev(e.type, e.payload, 0), config),
    genesisState(config, terrain),
  )
  return { state, terrain, events }
}

// ------------------------------------------------------------------ the 128x128 town

describe('G11a-M1: the genesis town folds, and it is the size the world says it is', () => {
  it('a hundred and twenty-eight tiles on a side, eleven roofs, a herd and the standing bushes', () => {
    const { state } = genesisTown()
    expect(state.terrain.length).toBe(CFG.world.size.h)
    expect(state.terrain[0]!.length).toBe(CFG.world.size.w)
    expect(state.terrain.every((row) => row.length === CFG.world.size.w)).toBe(true)

    const structures = Object.values(state.structures)
    expect(structures).toHaveLength(11)
    // Eleven buildings, four of them still roofed: the village was abandoned and the other seven
    // stand as walls a pair of hands can finish. Sound, this valley held 21 bodies against five.
    expect(
      structures
        .filter((s) => s.stage === 'complete')
        .map((s) => s.kind)
        .sort(),
    ).toEqual(['cabin', 'fire_pit', 'storehouse', 'well'])
    expect(structures.filter((s) => s.kind === 'house')).toHaveLength(5)
    expect(structures.some((s) => s.kind === 'well')).toBe(true)
    expect(structures.some((s) => s.kind === 'storehouse')).toBe(true)

    expect(Object.keys(state.fauna ?? {}).length).toBeGreaterThan(0)
    expect(Object.keys(state.forageables ?? {}).length).toBeGreaterThan(0)
    // Nothing is worn, nothing is planted, nothing has grown: genesis is a beginning.
    expect(state.traffic).toBeUndefined()
    expect(state.saplings).toBeUndefined()
    expect(state.growths).toBeUndefined()
  })

  it('two builds of the same genesis are the same world, to the byte', () => {
    expect(stateHash(genesisTown().state)).toBe(stateHash(genesisTown().state))
  })

  it('every tile a paving touches names its own chunk, and no other', () => {
    const { state } = genesisTown()
    const touched = [
      { x: 30, y: 70 },
      { x: 31, y: 70 },
      { x: 70, y: 70 },
    ]
    expect(chunksTouched(touched)).toEqual(['0,2', '2,2'])
    for (const at of touched) {
      const c = chunkOf(at.x, at.y)
      expect(c).toEqual({ cx: Math.floor(at.x / CHUNK_TILES), cy: Math.floor(at.y / CHUNK_TILES) })
    }
    // And the map really is a whole number of chunks on a side.
    expect(state.terrain.length % CHUNK_TILES).toBe(0)
  })
})

// ------------------------------------------------------------------ the map that widens

describe('G11a-M2: the map grows, everything on it moves with it, and the log replays it', () => {
  const GROWS: SimConfig = SimConfigSchema.parse(QUIET)

  // The clearance is owed to the ground the town has laid, not to its roofs: the southernmost
  // kerb stands three rows past the southernmost roof, so the first midnight grows south by seven.
  it('widens the one edge the town crowds, by exactly the ground it owes, and then stops', () => {
    const { state: town } = genesisTown(GROWS)
    const grown = pass(town, GROWS, MINUTES_PER_DAY)
    const growth = grown.events.find((e) => e.type === 'world_grown')
    expect(growth).toBeDefined()
    const p = growth!.payload as { edge: string; depth: number }
    expect(GROWTH_EDGES).toContain(p.edge)
    expect({ edge: p.edge, depth: p.depth }).toEqual({ edge: 's', depth: 7 })
    expect(grown.state.terrain.length).toBe(town.terrain.length + 7)
    expect(grown.state.terrain[0]!.length).toBe(town.terrain[0]!.length)
    expect(grown.state.growths).toBe(1)
    // A south growth moves no stored coordinate, so nothing standing has to be carried.
    for (const id of Object.keys(town.structures))
      expect(grown.state.structures[id]).toEqual(town.structures[id])
    // The two frames still agree, so the key is absent and the hash is what it always was.
    expect(grown.state.origin).toBeUndefined()

    // Fed once, the world is quiet: the second midnight finds every side clear.
    const again = pass(grown.state, GROWS, 2 * MINUTES_PER_DAY)
    expect(again.events.filter((e) => e.type === 'world_grown')).toHaveLength(0)
  })

  // The other half: an edge that DOES move the origin. Nothing in the genesis town crowds the
  // north, so one is planted there — and then everything standing moves with the ground.
  it('carries every stored coordinate when the edge it widens is the north one', () => {
    const { state: town } = genesisTown(GROWS)
    let s = fold(
      town,
      ev('agent_spawned', { id: 'walker', name: 'walker', x: 30, y: 70, ageDays: 7300 }, 0),
      GROWS,
    )
    // A real walk, so the traffic map has keys in it before the ground shifts under them.
    const started = submitIntent({ ...s, tick: 600 }, GROWS, 'walker', 'walk', { x: 30, y: 74 })
    expect(started.ok).toBe(true)
    s = apply({ ...s, tick: 600 }, GROWS, (started as { events: PendingEvent[] }).events, 600)
    for (let t = 601; t <= 620; t++) s = pass(s, GROWS, t).state
    s = apply(
      s,
      GROWS,
      [
        {
          type: 'structure_planned',
          payload: {
            id: 'outpost',
            kind: 'shed',
            x: 30,
            y: 5,
            w: 2,
            h: 2,
            maxHp: 20,
            flammable: true,
            builderId: 'genesis',
          },
        },
        { type: 'structure_completed', payload: { id: 'outpost' } },
      ],
      600,
    )
    const before = { ...s }
    expect(Object.keys(before.traffic ?? {}).length).toBeGreaterThan(0)

    const grown = pass(before, GROWS, MINUTES_PER_DAY)
    const growth = grown.events.find((e) => e.type === 'world_grown')!
    const p = growth.payload as { edge: string; depth: number }
    // Five rows short of the margin to the north, and the north comes first in n-e-s-w.
    expect({ edge: p.edge, depth: p.depth }).toEqual({ edge: 'n', depth: 14 })
    const dy = p.depth
    expect(grown.state.terrain.length).toBe(before.terrain.length + dy)
    expect(grown.state.growths).toBe(1)
    expect(grown.state.origin).toEqual({ x: 0, y: -dy })
    expect(grown.state.agents.walker!.y).toBe(before.agents.walker!.y + dy)
    for (const id of Object.keys(before.structures)) {
      expect(grown.state.structures[id]!.y).toBe(before.structures[id]!.y + dy)
    }
    const shifted = Object.keys(before.traffic!)
      .map((k) => {
        const [x, y] = k.split(',').map(Number)
        return `${x},${y! + dy}`
      })
      .sort()
    // Asked of the growth alone: the same midnight decays these one-footfall tiles off the map.
    expect(Object.keys(apply(before, GROWS, [growth], MINUTES_PER_DAY).traffic!).sort()).toEqual(
      shifted,
    )
  })

  // ★ THE GROUND THAT ARRIVES IS THE WORLD CONTINUED. The river is a reason for the town's
  // shape, not a stripe: it must not stop dead at the old edge with noise below it.
  it('lays the world down beyond the edge, river and all, and moves nothing already there', () => {
    // The wood also seeds itself at midnight, and a sapling in an old row would read as the
    // world being repainted underneath the town when it is nothing of the kind.
    const STILL: SimConfig = SimConfigSchema.parse({ ...QUIET, regrowth: { enabled: false } })
    const { state: town } = genesisTown(STILL)
    const before = town.terrain.map((r) => [...r])
    const grown = pass(town, STILL, MINUTES_PER_DAY).state
    // Every row that was there is the row that was there.
    for (let y = 0; y < before.length; y++) expect(grown.terrain[y]).toEqual(before[y])
    // And the channel runs on through every new row, in the same three columns.
    for (let y = before.length; y < grown.terrain.length; y++) {
      const row = grown.terrain[y]!
      expect([...row.keys()].filter((x) => row[x] === 2)).toEqual([48, 49, 50])
    }
  })

  it('the same run replays identically from genesis and from a pre-growth snapshot', () => {
    const { terrain, events: genesisEvents } = makeGenesisWorld(GROWS)
    const store = new EventStore(openDb(':memory:'))
    let state = genesisState(GROWS, terrain)
    const write = (list: PendingEvent[], tick: number): void => {
      for (const e of list) state = fold(state, store.append(tick, e.type, e.payload), GROWS)
    }
    write(genesisEvents, 0)
    write(
      [
        {
          type: 'agent_spawned',
          payload: { id: 'walker', name: 'walker', x: 30, y: 70, ageDays: 7300 },
        },
      ],
      0,
    )

    // The tick loop, written down: every event that lands goes into the log first.
    const step = (tick: number): void => {
      const advanced = store.append(tick, 'tick_advanced', {})
      state = fold(state, advanced, GROWS)
      const out = createWorldTick(GROWS, new RngStreams('g11a-grow'))(state)
      state = { ...state }
      for (const e of out.events) state = fold(state, store.append(tick, e.type, e.payload), GROWS)
    }

    const started = submitIntent({ ...state, tick: 600 }, GROWS, 'walker', 'walk', { x: 30, y: 74 })
    expect(started.ok).toBe(true)
    state = { ...state, tick: 600 }
    write((started as { events: PendingEvent[] }).events, 600)
    for (let t = 601; t <= 620; t++) step(t)

    const preGrowth = { ...state }
    const preSeq = store.lastSeq()
    step(MINUTES_PER_DAY)
    expect(state.terrain.length).toBeGreaterThan(terrain.length)
    const live = stateHash(state)

    // From genesis, event for event.
    expect(stateHash(replayFromGenesis(store, GROWS, terrain))).toBe(live)

    // And from the snapshot taken the tick before the world widened.
    const after = store.readFrom(preSeq).reduce((s, e) => fold(s, e, GROWS), preGrowth)
    expect(stateHash(after)).toBe(live)
  })
})

// ------------------------------------------------------------------ world laws

describe('G11a-M3: an operator may move a law, and only the laws the whitelist names', () => {
  it('two flags flipped mid-run change the next tick, and the log replays the flips', () => {
    let s = genesisState(CFG, MAP())
    s = fold(s, ev('agent_spawned', { id: 'body', name: 'body', x: 5, y: 5, ageDays: 7300 }), CFG)
    s = fold(s, ev('fauna_spawned', { id: 'fauna_1', kind: 'deer', x: 15, y: 15 }), CFG)
    s = { ...s, tick: 399 }

    // Before: both laws are live and both are billing.
    const before = pass(s, CFG, 400)
    expect(before.events.some((e) => e.type === 'thirst_changed')).toBe(true)
    expect(before.events.some((e) => e.type === 'fauna_moved')).toBe(true)

    const queue: LawQueue = []
    applyLaw(queue, 'thirst.enabled', false)
    applyLaw(queue, 'fauna.enabled', false)
    const flipped = pass(before.state, CFG, 404, 'g11a', queue)
    const changes = flipped.events.filter((e) => e.type === 'config_changed').map((e) => e.payload)
    expect(changes).toEqual([
      { path: 'thirst.enabled', value: false },
      { path: 'fauna.enabled', value: false },
    ])
    // The flip lands at the tick boundary, so the very tick it arrives is already the new world.
    expect(flipped.events.some((e) => e.type === 'thirst_changed')).toBe(false)
    expect(flipped.events.some((e) => e.type === 'fauna_moved')).toBe(false)
    expect(flipped.state.laws).toEqual({ 'thirst.enabled': false, 'fauna.enabled': false })

    // And it holds on the next tick, with nothing queued.
    const after = pass(flipped.state, CFG, 408)
    expect(after.events.some((e) => e.type === 'thirst_changed')).toBe(false)

    // A log carrying the two events folds to the same laws: the flip is a fact, not a setting.
    const replayed = changes.reduce<WorldState>(
      (acc, p) => fold(acc, ev('config_changed', p, 404), CFG),
      s,
    )
    expect(replayed.laws).toEqual(flipped.state.laws)
  })

  it('a path the whitelist does not name is refused, by the fold and not by the caller', () => {
    const s = genesisState(CFG, MAP())
    expect(TOGGLABLE_PATHS['needs.hungerDecayPerTick']).toBeUndefined()
    expect(() =>
      fold(s, ev('config_changed', { path: 'needs.hungerDecayPerTick', value: 0 }), CFG),
    ).toThrow(/is not a world law/)
    // A whitelisted path with a value of the wrong shape is refused too.
    expect(() =>
      fold(s, ev('config_changed', { path: 'thirst.enabled', value: 'yes' }), CFG),
    ).toThrow(/value rejected/)
  })

  it('every C11 section flag is a law an operator can reach', () => {
    const sections = [
      'mortality',
      'illness',
      'thirst',
      'fertility',
      'roads',
      'desirePaths',
      'fauna',
      'warmth',
      'light',
      'nightWitness',
      'foodVariety',
      'regrowth',
      'mapGrowth',
      'constructs',
    ]
    for (const name of sections) expect(TOGGLABLE_PATHS[`${name}.enabled`]).toBeDefined()
  })
})

// ------------------------------------------------------------------ §19 night-witness

describe('G11a-M4: the same taking, four times, and only the light tells them apart', () => {
  const DAY = 12 * 60
  const DUSK = 19 * 60
  const NIGHT = 22 * 60
  const AT = { x: 12, y: 12 }
  const WATCH_DISTANCE = 6

  // A taking at AT, and a watcher six tiles off. Night sight reaches four tiles, dusk eight,
  // daylight twelve — so six is the distance that tells the three of them apart.
  function scene(config: SimConfig, tick: number, torchAtTarget: boolean): WorldState {
    let s = genesisState(config, MAP())
    s = fold(
      s,
      ev('agent_spawned', { id: 'taker', name: 'taker', x: AT.x, y: AT.y, ageDays: 7300 }),
      config,
    )
    s = fold(
      s,
      ev('agent_spawned', { id: 'owner', name: 'owner', x: AT.x, y: AT.y, ageDays: 7300 }),
      config,
    )
    s = fold(
      s,
      ev('agent_spawned', {
        id: 'watcher',
        name: 'watcher',
        x: AT.x,
        y: AT.y + WATCH_DISTANCE,
        ageDays: 7300,
      }),
      config,
    )
    s = fold(
      s,
      ev('item_spawned', {
        id: 'item_knife',
        kind: 'knife',
        qty: 1,
        loc: { t: 'tile', x: AT.x, y: AT.y },
        owner: 'owner',
      }),
      config,
    )
    if (torchAtTarget) {
      s = fold(
        s,
        ev('item_spawned', {
          id: 'item_torch',
          kind: 'torch',
          qty: 1,
          loc: { t: 'tile', x: AT.x, y: AT.y },
        }),
        config,
      )
      s = fold(
        s,
        ev('item_lit', { itemId: 'item_torch', burnsUntilTick: tick + 100 }, tick - 1),
        config,
      )
    }
    return { ...s, tick }
  }

  const taking: SimEvent = {
    seq: 999001,
    tick: 0,
    type: 'item_taken',
    payload: {
      itemId: 'item_knife',
      takerId: 'taker',
      ownerId: 'owner',
      kind: 'knife',
      x: AT.x,
      y: AT.y,
    },
  }

  const witnessed = (s: WorldState, config: SimConfig): boolean =>
    composePerception(s, config, 'watcher', [{ ...taking, tick: s.tick }]).seen.some(
      (x) => x.kind === 'item_taken',
    )

  it('row 1 — at noon the taking is plain', () => {
    expect(witnessed(scene(CFG, DAY, false), CFG)).toBe(true)
  })

  it('row 2 — at dusk the sight still reaches, and the light band says dim', () => {
    const s = scene(CFG, DUSK, false)
    expect(witnessed(s, CFG)).toBe(true)
    expect(composePerception(s, CFG, 'watcher', []).light).toBe('dim')
  })

  it('row 3 — at night, unlit, the same six tiles are too far', () => {
    const s = scene(CFG, NIGHT, false)
    expect(witnessed(s, CFG)).toBe(false)
    expect(composePerception(s, CFG, 'watcher', []).light).toBe('dark')
  })

  it('row 4 — a flame AT THE TAKING lights the thief, not the eye, and it is seen again', () => {
    expect(witnessed(scene(CFG, NIGHT, true), CFG)).toBe(true)
  })

  it('with the witness law off the night is as bright as noon', () => {
    const OFF: SimConfig = SimConfigSchema.parse({ ...QUIET, nightWitness: { enabled: false } })
    expect(witnessed(scene(OFF, NIGHT, false), OFF)).toBe(true)
  })

  it('the witness set is a function of the world, so two reads of it agree exactly', () => {
    for (const tick of [DAY, DUSK, NIGHT]) {
      const s = scene(CFG, tick, false)
      const first = composePerception(s, CFG, 'watcher', [{ ...taking, tick }]).seen
      const second = composePerception(s, CFG, 'watcher', [{ ...taking, tick }]).seen
      expect(first).toEqual(second)
    }
  })
})

// ------------------------------------------------------------------ the tick budget

describe('G11a-P1: the perf gate on a full 128x128 town', () => {
  const AGENTS = 12
  const TICKS = 240

  function busyTown(): WorldState {
    const { state } = genesisTown()
    let s = state
    // Twelve bodies on the town's own ground, and the herd topped up to every cap.
    for (let i = 0; i < AGENTS; i++) {
      s = fold(
        s,
        ev('agent_spawned', {
          id: `body_${i}`,
          name: `body_${i}`,
          x: 30 + (i % 6),
          y: 68 + Math.floor(i / 6),
          ageDays: 7300,
        }),
        CFG,
      )
    }
    const living = (kind: string): number =>
      Object.values(s.fauna ?? {}).filter((f) => f.kind === kind && f.alive).length
    let next = 900
    for (const [kind, cap] of Object.entries(CFG.fauna.caps)) {
      for (let i = living(kind); i < cap; i++) {
        const at = kind === 'fish' ? { x: 49, y: 40 + i } : { x: 30 + i, y: 80 }
        s = fold(
          s,
          ev('fauna_spawned', {
            id: `fauna_${next++}`,
            kind,
            ...at,
            ...(kind === 'fish' ? { stock: 3 } : {}),
          }),
          CFG,
        )
      }
    }
    return { ...s, tick: 599 }
  }

  it('median tick under 50 ms and p99 under 250 ms, with the town full', () => {
    let s = busyTown()
    expect(Object.keys(s.agents)).toHaveLength(AGENTS + 0)
    const ms: number[] = []
    for (let t = 600; t < 600 + TICKS; t++) {
      const at = performance.now()
      s = pass(s, CFG, t).state
      ms.push(performance.now() - at)
    }
    const sorted = [...ms].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]!
    const p99 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))]!
    // Recorded in the gate report as measured numbers, not just as a pass.
    expect({ median: median < 50, p99: p99 < 250 }).toEqual({ median: true, p99: true })
  })

  it('a corner-to-corner search respects the node budget and hands back a usable partial', () => {
    const { state } = genesisTown()
    const found = searchPath(state, { x: 2, y: 2 }, { x: 125, y: 125 }, CFG)
    // Either it finished inside the budget or it stopped at the frontier — never a lie about
    // where the walking ends, and never an empty answer dressed as a route.
    expect(found === null || found.path.length > 0).toBe(true)
    if (found?.capped) {
      expect(found.path.length).toBeLessThanOrEqual(CFG.pathing.maxNodes)
    }
    // A tighter budget on the same query is capped, and the partial still starts where the
    // body is standing.
    const TIGHT: SimConfig = SimConfigSchema.parse({ ...QUIET, pathing: { maxNodes: 200 } })
    const short = searchPath(state, { x: 2, y: 2 }, { x: 125, y: 125 }, TIGHT)
    expect(short).not.toBeNull()
    expect(short!.capped).toBe(true)
    expect(short!.path.length).toBeGreaterThan(0)
  })

  it('a mid-run pave is visible to the very next search — there is no cache to go stale', () => {
    // The property a cached portal graph would have had to protect, asserted directly: the search
    // reads the ground as it stands.
    const terrain = MAP(40)
    let s = genesisState(CFG, terrain)
    const before = searchPath(s, { x: 0, y: 20 }, { x: 39, y: 20 }, CFG)!
    const beforeCost = before.path.length
    for (let x = 1; x < 39; x++) {
      s = fold(
        s,
        ev('tile_changed', { x, y: 20, from: 0, to: 7, reason: 'paved', byId: 'mason' }),
        CFG,
      )
    }
    const after = searchPath(s, { x: 0, y: 20 }, { x: 39, y: 20 }, CFG)!
    expect(after.path.length).toBe(beforeCost)
    expect(after.path.every(([, y]) => y === 20)).toBe(true)
    // The route is the same tiles and a cheaper walk, which is the whole of what a road is.
    expect(CFG.pathing.roadCost).toBeLessThan(1)
  })
})

// The question is not "did they die" but "would a COMPETENT body have lived" — one that eats when
// there is food, sleeps when there is a bed, drinks when there is water.
describe('G11a-D1: a competent body comes through three days on the default world, untouched', () => {
  const HOUSE = { id: 'structure_1', kind: 'house', x: 6, y: 6, w: 2, h: 2 }
  const DAYS = 3
  const WAKE_AT = 6 * 60
  const EAT_AT = 8 * 60
  const DRINK_AT = 12 * 60
  const SLEEP_AT = 22 * 60

  function competent(): { state: WorldState; deaths: SimEvent[]; collapses: number } {
    let s = genesisState(CFG, MAP())
    s = fold(
      s,
      ev('structure_planned', { ...HOUSE, maxHp: 50, flammable: true, builderId: 'script' }),
      CFG,
    )
    s = fold(s, ev('structure_completed', { id: HOUSE.id }), CFG)
    const door = doorTile(s, s.structures[HOUSE.id]!)!
    s = fold(
      s,
      ev('agent_spawned', { id: 'ada', name: 'ada', x: door.x, y: door.y, ageDays: 7300 }),
      CFG,
    )
    s = fold(s, ev('agent_entered', { agentId: 'ada', structureId: HOUSE.id }), CFG)
    // She goes to bed on the night before day one: a body that starts a run awake at midnight has
    // been up twenty-two hours by its first bedtime, which is a fixture artifact.
    s = fold(s, ev('agent_slept', { agentId: 'ada' }), CFG)
    for (let i = 0; i < 6; i++) {
      s = fold(
        s,
        ev('item_spawned', {
          id: `item_loaf_${i}`,
          kind: 'bread',
          qty: 1,
          loc: { t: 'agent', id: 'ada' },
        }),
        CFG,
      )
    }
    for (let i = 0; i < 3; i++) {
      s = fold(
        s,
        ev('item_spawned', {
          id: `item_skin_${i}`,
          kind: 'waterskin',
          qty: 1,
          loc: { t: 'agent', id: 'ada' },
          charges: 4,
        }),
        CFG,
      )
    }

    const log: PendingEvent[] = []
    let collapses = 0
    for (let tick = 1; tick <= DAYS * MINUTES_PER_DAY; tick++) {
      const minute = tick % MINUTES_PER_DAY
      const a = s.agents.ada!
      const wants =
        minute === SLEEP_AT && !a.asleep
          ? { verb: 'sleep', params: {} }
          : minute === WAKE_AT && a.asleep
            ? { verb: 'wake', params: {} }
            : minute === EAT_AT
              ? { verb: 'eat', params: { itemId: loafInHand(s) } }
              : minute === DRINK_AT
                ? { verb: 'drink', params: { itemId: skinInHand(s) } }
                : null
      if (wants !== null) {
        const out = submitIntent({ ...s, tick }, CFG, 'ada', wants.verb, wants.params)
        if (out.ok) s = apply({ ...s, tick }, CFG, out.events, tick)
      }
      const step = pass(s, CFG, tick, 'competent')
      s = step.state
      for (const e of step.events) {
        log.push(e)
        if (e.type === 'agent_collapsed') collapses += 1
      }
    }
    const deaths = log.filter((e) => e.type === 'agent_died').map((e) => ev(e.type, e.payload))
    return { state: s, deaths, collapses }
  }

  const loafInHand = (s: WorldState): string =>
    Object.keys(s.items)
      .sort()
      .find((id) => s.items[id]!.kind === 'bread' && s.items[id]!.loc.t === 'agent') ??
    'item_loaf_0'

  const skinInHand = (s: WorldState): string =>
    Object.keys(s.items)
      .sort()
      .find((id) => s.items[id]!.kind === 'waterskin' && (s.items[id]!.charges ?? 0) > 0) ??
    'item_skin_0'

  it('three sim days, zero deaths, zero collapses, and every clock still above the floor', () => {
    const { state, deaths, collapses } = competent()
    const ada = state.agents.ada!
    expect(deaths).toEqual([])
    expect(collapses).toBe(0)
    expect(ada.alive).toBe(true)
    expect(ada.afflictions).toBeUndefined()
    expect(ada.needs.hunger).toBeGreaterThan(CFG.needs.debuffThreshold)
    expect(ada.needs.energy).toBeGreaterThan(CFG.needs.debuffThreshold)
    expect(thirstOf(ada)).toBeGreaterThan(CFG.needs.debuffThreshold)
    expect(ada.hp).toBe(CFG.health.maxHp)
  })

  // The ladder is a one-way ratchet: agent_slept clears the collapse COUNTER and leaves the
  // affliction standing, and the only thing in the world that lifts one is a herb.
  it('one collapse leaves a fatigue clock that a full night of sleep does not lift', () => {
    let s = genesisState(CFG, MAP())
    s = fold(s, ev('agent_spawned', { id: 'ada', name: 'ada', x: 5, y: 5, ageDays: 7300 }), CFG)
    s = fold(s, ev('need_changed', { id: 'ada', need: 'energy', delta: -96 }, 0), CFG)
    s = { ...s, tick: 0 }
    const fell = pass(s, CFG, 1, 'ratchet')
    expect(fell.events.some((e) => e.type === 'agent_collapsed')).toBe(true)
    expect(fell.state.agents.ada!.afflictions).toEqual([
      { kind: 'fatigue', severity: 1, sinceTick: 1 },
    ])

    // A whole night asleep: the counter goes, the clock stays.
    let rested = fold(fell.state, ev('agent_slept', { agentId: 'ada' }, 2), CFG)
    expect(rested.agents.ada!.collapsesWithoutRecovery).toBeUndefined()
    expect(rested.agents.ada!.afflictions).toHaveLength(1)
    for (let t = 3; t < 3 + 8 * 60; t++) rested = pass(rested, CFG, t, 'ratchet').state
    expect(rested.agents.ada!.needs.energy).toBe(100)
    expect(rested.agents.ada!.afflictions).toEqual([{ kind: 'fatigue', severity: 1, sinceTick: 1 }])

    // A herb is the one road back the world actually has.
    let cured = fold(
      rested,
      ev(
        'item_spawned',
        {
          id: 'item_herb',
          kind: 'herb',
          qty: 1,
          loc: { t: 'agent', id: 'ada' },
        },
        rested.tick,
      ),
      CFG,
    )
    const awake = fold(cured, ev('agent_woke', { agentId: 'ada' }, cured.tick), CFG)
    const eaten = submitIntent({ ...awake, tick: awake.tick + 1 }, CFG, 'ada', 'eat', {
      itemId: 'item_herb',
    })
    expect(eaten.ok).toBe(true)
    cured = apply(
      { ...awake, tick: awake.tick + 1 },
      CFG,
      (eaten as { events: PendingEvent[] }).events,
      awake.tick + 1,
    )
    cured = pass(cured, CFG, awake.tick + 2, 'ratchet').state
    expect(cured.agents.ada!.afflictions).toBeUndefined()
  })

  // Before this, a body outdoors could not lie down until it had already fallen over: sleep
  // refused "there is no bed here" standing, and allowed anywhere the moment it collapsed.
  it('a weary body may lie down before it falls over, and a night lifts the clock every time', () => {
    const fatigueOf = (s: WorldState): number =>
      s.agents.ada!.afflictions?.find((x) => x.kind === 'fatigue')?.severity ?? 0

    let s = genesisState(CFG, MAP())
    s = fold(s, ev('agent_spawned', { id: 'ada', name: 'ada', x: 5, y: 5, ageDays: 7300 }, 0), CFG)
    s = { ...s, tick: 0 }

    // HALF 3 — a body with a full bar is told where a bed is, and the refusal names the door
    // its own weariness will open.
    expect(submitIntent({ ...s, tick: 1 }, CFG, 'ada', 'sleep', {})).toEqual({
      ok: false,
      reason:
        'there is nothing over you here; find somewhere to lie down — weary enough and the bare ground will do',
    })

    // HALF 2 — weary enough, and the bare ground will do. No fall is required to earn it.
    s = fold(s, ev('need_changed', { id: 'ada', need: 'energy', delta: -75 }, 0), CFG)
    expect(s.agents.ada!.needs.energy).toBeLessThan(CFG.needs.debuffThreshold)
    expect(s.agents.ada!.collapsedSinceTick).toBeNull()
    expect(submitIntent({ ...s, tick: 1 }, CFG, 'ada', 'sleep', {}).ok).toBe(true)

    // HALF 1 — and for a body that did go down before anyone reached it, the night lifts the
    // affliction as well as the counter, so the clock stops instead of running for ever.
    let tick = 1
    for (; tick < 40000 && s.agents.ada!.collapsedSinceTick === null; tick++)
      s = pass(s, CFG, tick, 'spiral').state
    expect(fatigueOf(s)).toBe(1)
    const lie = submitIntent({ ...s, tick }, CFG, 'ada', 'sleep', {})
    expect(lie.ok).toBe(true)
    s = apply({ ...s, tick }, CFG, (lie as { events: PendingEvent[] }).events, tick)
    for (tick += 1; tick < 80000 && !s.agents.ada!.asleep; tick++)
      s = pass(s, CFG, tick, 'spiral').state
    expect(s.agents.ada!.collapsesWithoutRecovery).toBeUndefined()
    expect(fatigueOf(s)).toBe(0)

    // REPEATABLE, which is the whole of the ruling. Said at the verb, because a body left out
    // in the open long enough to wear out twice has died of thirst before the second time.
    const weary = fold(
      s,
      ev('agent_afflicted', { agentId: 'ada', kind: 'fatigue', severity: 2 }, tick),
      CFG,
    )
    expect(
      VERBS.sleep!.onComplete(weary, CFG, 'ada', {}, new RngStreams('r15').get('illness')),
    ).toContainEqual({ type: 'affliction_recovered', payload: { agentId: 'ada', kind: 'fatigue' } })
    // And it is the ladder it lifts, not every ill a body has: a fever is not slept off.
    const feverish = fold(
      s,
      ev('agent_afflicted', { agentId: 'ada', kind: 'illness', severity: 1 }, tick),
      CFG,
    )
    expect(
      VERBS.sleep!.onComplete(feverish, CFG, 'ada', {}, new RngStreams('r15').get('illness')).map(
        (e) => e.type,
      ),
    ).toEqual(['agent_slept'])

    // A day of the drain is more than three days of the best dawn recovery a fed, sleeping body
    // can get, so sleep is the only answer to fatigue that keeps up.
    const drainPerDay = CFG.mortality.drainPerTick.fatigue * MINUTES_PER_DAY
    const bestRecoveryPerDay = CFG.health.recoveryHpPerDay * CFG.mortality.sleepRegenMultiplier
    expect(drainPerDay).toBeCloseTo(57.6, 6)
    expect(bestRecoveryPerDay).toBe(15)
    expect(drainPerDay).toBeGreaterThan(bestRecoveryPerDay * 3)
  })

  it('and the same body given nothing to eat, drink or lie on does not — which is the difference', () => {
    // The control: the script is what changed, not the physics.
    let s = genesisState(CFG, MAP())
    s = fold(s, ev('agent_spawned', { id: 'ada', name: 'ada', x: 5, y: 5, ageDays: 7300 }), CFG)
    s = { ...s, tick: 0 }
    let collapses = 0
    for (let tick = 1; tick <= DAYS * MINUTES_PER_DAY; tick++) {
      const out = pass(s, CFG, tick, 'competent')
      s = out.state
      collapses += out.events.filter((e) => e.type === 'agent_collapsed').length
    }
    expect(collapses).toBeGreaterThan(0)
  })
})

import { describe, expect, it } from 'vitest'
import { EventStore, openDb } from '@sj/engine/store'
import {
  createWorldTick,
  fold,
  genesisState,
  RngStreams,
  replayFromGenesis,
  TickLoop,
  type TickHandler,
  type TileId,
} from '@sj/engine'
import {
  ADULT_AGE_DAYS,
  DISCOVERY_EVENT,
  SimConfigSchema,
  stateHash,
  type SimConfig,
  type SimEvent,
} from '@sj/shared'
import { DEFAULT_MIND_CONFIG } from '../wake.js'
import { DEFAULT_RECENT_WINDOW_TICKS, EngineBridge, ROLLED_BACK } from './bridge.js'

const AGENT = 'tamar'

function buildBridge(): { bridge: EngineBridge; step: () => void } {
  const config = SimConfigSchema.parse({})
  const terrain: TileId[][] = Array.from({ length: 12 }, () =>
    Array.from({ length: 12 }, (): TileId => 0),
  )
  const db = openDb(':memory:')
  const store = new EventStore(db)
  const rng = new RngStreams('bridge-drain')
  let state = genesisState(config, terrain)
  const ev = store.append(state.tick, 'agent_spawned', {
    id: AGENT,
    name: 'Tamar',
    x: 3,
    y: 3,
    ageDays: 30,
  })
  state = fold(state, ev, config)

  const worldTick = createWorldTick(config, rng)
  let handler: TickHandler = () => {}
  const loop = new TickLoop({
    store,
    state,
    rng,
    config,
    onTick: (ctx) => {
      handler(ctx)
    },
  })
  const bridge = new EngineBridge({ loop, store, simConfig: config })
  handler = bridge.wrapTickHandler(({ emit }) => {
    for (const e of worldTick(loop.state).events) emit(e.type, e.payload)
  })
  return {
    bridge,
    step: () => {
      loop.step()
    },
  }
}

// A second town where things are owned, so the bridge's ownership mapping is observable.
function ownedWorld(opts: { recentWindowTicks?: number } = {}): {
  bridge: EngineBridge
  config: SimConfig
  loop: TickLoop
  store: EventStore
  step: () => void
} {
  const config = SimConfigSchema.parse({
    weather: { hourlyChangeChance: 0 },
    mystery: { chancePerDay: 0 },
  })
  const terrain: TileId[][] = Array.from({ length: 12 }, () =>
    Array.from({ length: 12 }, (): TileId => 0),
  )
  const store = new EventStore(openDb(':memory:'))
  const rng = new RngStreams('bridge-ownership')
  let state = genesisState(config, terrain)
  const put = (type: string, payload: unknown) => {
    state = fold(state, store.append(state.tick, type, payload), config)
  }
  put('agent_spawned', { id: AGENT, name: 'Tamar', x: 3, y: 3, ageDays: ADULT_AGE_DAYS })
  put('agent_spawned', { id: 'bex', name: 'Bex', x: 4, y: 3, ageDays: ADULT_AGE_DAYS })
  put('agent_spawned', { id: 'cass', name: 'Cass', x: 5, y: 3, ageDays: ADULT_AGE_DAYS })
  put('item_spawned', {
    id: 'item_1',
    kind: 'bread',
    qty: 1,
    loc: { t: 'agent', id: AGENT },
    owner: AGENT,
  })
  put('item_spawned', {
    id: 'item_2',
    kind: 'plank',
    qty: 1,
    loc: { t: 'tile', x: 5, y: 4 },
    owner: 'bex',
    crafterMark: 'bex',
  })

  const worldTick = createWorldTick(config, rng)
  let handler: TickHandler = () => {}
  const loop = new TickLoop({
    store,
    state,
    rng,
    config,
    onTick: (ctx) => {
      handler(ctx)
    },
  })
  const bridge = new EngineBridge({ loop, store, simConfig: config, ...opts })
  handler = bridge.wrapTickHandler(({ emit }) => {
    for (const e of worldTick(loop.state).events) emit(e.type, e.payload)
    if (loop.tick === 1) {
      emit('item_moved', { id: 'item_2', loc: { t: 'agent', id: 'cass' } })
      emit('item_taken', {
        itemId: 'item_2',
        kind: 'plank',
        takerId: 'cass',
        ownerId: 'bex',
        x: 5,
        y: 4,
      })
    }
  })
  return {
    bridge,
    config,
    loop,
    store,
    step: () => {
      loop.step()
    },
  }
}

describe('EngineBridge carries ownership through to the mind', () => {
  it("names another's claim on a thing, and says nothing about your own", () => {
    const { bridge } = ownedWorld()
    const packet = bridge.perception(AGENT)
    const mine = packet.self.inventory.find((i) => i.id === 'item_1')!
    expect(mine.ownerName).toBeUndefined() // it is yours; you are not told whose it is
    const theirs = packet.visible.items.find((i) => i.id === 'item_2')!
    expect(theirs.ownerName).toBe('Bex')
    expect(theirs.crafterMarkName).toBe('Bex')
  })

  it('passes the witnessed taking straight through', () => {
    const { bridge, step } = ownedWorld()
    step()
    expect(bridge.perception(AGENT).seen).toEqual([
      { kind: 'item_taken', takerName: 'Cass', ownerName: 'Bex', itemKind: 'plank' },
    ])
  })

  it('a quiet tick leaves the witness channel empty', () => {
    const { bridge } = ownedWorld()
    expect(bridge.perception(AGENT).seen).toEqual([])
  })
})

describe('extent: the one fact about the valley no packet carries', () => {
  it('reads the terrain the world was built on', () => {
    expect(buildBridge().bridge.extent()).toEqual({ w: 12, h: 12 })
  })
})

describe('nearestPerson', () => {
  it('names the nearest other body, and never the one asking', () => {
    const { bridge } = ownedWorld()
    expect(bridge.nearestPerson(AGENT, 3, 3)).toEqual({ x: 4, y: 3, name: 'Bex' })
    // Tamar and Cass are both one tile off: the lower id wins, so the pick never drifts.
    expect(bridge.nearestPerson('bex', 4, 3)).toEqual({ x: 5, y: 3, name: 'Cass' })
  })

  it('is silent when nobody stands inside the radius', () => {
    const { bridge } = ownedWorld()
    expect(bridge.nearestPerson(AGENT, 3, 3, 0)).toBe(null)
  })
})

describe('a word carries further than a talk does', () => {
  it('parts the shoulder next to a mouth from the rest of the square', () => {
    const { bridge, step } = ownedWorld()
    bridge.announce('agent_moved', { id: 'cass', x: 11, y: 3 })
    step()
    expect(bridge.earshot(AGENT), 'a voice crosses the square').toEqual(['bex', 'cass'])
    expect(bridge.nearEnoughToAnswer(AGENT), 'Cass is eight tiles off').toEqual(['bex'])
  })

  it('is silent for a body that is not there to speak', () => {
    const { bridge } = ownedWorld()
    expect(bridge.nearEnoughToAnswer('nobody')).toEqual([])
  })
})

describe('the default perception window outlasts the gap between turns (D-28-6)', () => {
  it('covers the longest an awake mind can go without a turn, with margin', () => {
    expect(DEFAULT_RECENT_WINDOW_TICKS).toBeGreaterThan(DEFAULT_MIND_CONFIG.boredomTicks)
  })

  it('a witnessed taking still reaches a mind that looks at the end of its longest gap', () => {
    const { bridge, step } = ownedWorld()
    step() // Cass lifts Bex's plank at tick 1, in Tamar's sight
    for (let i = 0; i < DEFAULT_MIND_CONFIG.boredomTicks; i++) step()
    expect(bridge.perception(AGENT).seen).toEqual([
      { kind: 'item_taken', takerName: 'Cass', ownerName: 'Bex', itemKind: 'plank' },
    ])
  })

  it('an explicit override still narrows the window', () => {
    const { bridge, step } = ownedWorld({ recentWindowTicks: 10 })
    step()
    for (let i = 0; i < 60; i++) step()
    expect(bridge.perception(AGENT).seen).toEqual([])
  })

  it('a bridge built over an old log starts at the window edge, not at seq 0', () => {
    const { config, loop, store, step } = ownedWorld()
    for (let i = 0; i < 400; i++) step()
    const read: { from: number; rows: SimEvent[] }[] = []
    const inner = store.readFrom.bind(store)
    store.readFrom = (from: number) => {
      const rows = inner(from)
      read.push({ from, rows })
      return rows
    }
    new EngineBridge({ loop, store, simConfig: config }).perception(AGENT)
    const cutoff = loop.tick - DEFAULT_RECENT_WINDOW_TICKS
    expect(read[0]!.from).toBeGreaterThan(0)
    expect(read[0]!.rows.every((ev) => ev.tick > cutoff)).toBe(true)
  })

  it('reads the log once a tick, however often the minds look', () => {
    const { bridge, store, step } = ownedWorld()
    step()
    bridge.perception(AGENT)
    let reads = 0
    const inner = store.readFrom.bind(store)
    store.readFrom = (from: number) => {
      reads += 1
      return inner(from)
    }
    bridge.perception(AGENT)
    bridge.perception(AGENT)
    expect(reads).toBe(0)
    step()
    bridge.perception(AGENT)
    bridge.perception(AGENT)
    expect(reads).toBe(1)
  })

  it('a bridge built moments after the event still carries it', () => {
    const { config, loop, store, step } = ownedWorld()
    step() // Cass lifts Bex's plank at tick 1, in Tamar's sight
    for (let i = 0; i < DEFAULT_MIND_CONFIG.boredomTicks; i++) step()
    const restarted = new EngineBridge({ loop, store, simConfig: config })
    expect(restarted.perception(AGENT).seen).toEqual([
      { kind: 'item_taken', takerName: 'Cass', ownerName: 'Bex', itemKind: 'plank' },
    ])
  })
})

const settled: unique symbol = Symbol('pending')
function settledYet<T>(p: Promise<T>): Promise<T | typeof settled> {
  return Promise.race([p, Promise.resolve().then((): typeof settled => settled)])
}

describe('EngineBridge.drain (T23)', () => {
  it('refuses late submissions after shutdown instead of leaving them pending', async () => {
    const { bridge, step } = buildBridge()
    bridge.drain('the town goes quiet')
    const seen: unknown[] = []
    const pending = bridge.submit(AGENT, { verb: 'walk', params: { x: 8, y: 3 } }, (r) =>
      seen.push(r),
    )
    expect(await settledYet(pending)).not.toBe(settled)
    expect(await pending).toEqual({ ok: false, reason: 'the town goes quiet' })
    expect(seen).toEqual([{ ok: false, reason: 'the town goes quiet' }])
    expect(bridge.drain()).toBe(0)
    step()
    expect(bridge.perception(AGENT).self.activity).toBeNull()
  })

  it('a queued submit pends until the loop steps', async () => {
    const { bridge, step } = buildBridge()
    const p = bridge.submit(AGENT, { verb: 'walk', params: { x: 4, y: 3 } })
    expect(await settledYet(p)).toBe(settled)
    step()
    expect(await p).toEqual({ ok: true })
  })

  it('drain resolves every queued submit as refused and returns the count', async () => {
    const { bridge } = buildBridge()
    const seen: { ok: boolean; reason?: string }[] = []
    const a = bridge.submit(AGENT, { verb: 'walk', params: { x: 4, y: 3 } }, (r) => seen.push(r))
    const b = bridge.submit(AGENT, { verb: 'sleep', params: {} }, (r) => seen.push(r))

    expect(bridge.drain()).toBe(2)

    expect(await a).toEqual({ ok: false, reason: 'the moment passes' })
    expect(await b).toEqual({ ok: false, reason: 'the moment passes' })
    // The onResult callback fires too — the mind's own bookkeeping must not hang either.
    expect(seen).toEqual([
      { ok: false, reason: 'the moment passes' },
      { ok: false, reason: 'the moment passes' },
    ])
  })

  it('drain takes a reason and it reaches the waiting mind verbatim', async () => {
    const { bridge } = buildBridge()
    const p = bridge.submit(AGENT, { verb: 'walk', params: { x: 4, y: 3 } })
    expect(bridge.drain('the town goes quiet')).toBe(1)
    expect(await p).toEqual({ ok: false, reason: 'the town goes quiet' })
  })

  it('drain is idempotent: a second drain finds nothing', () => {
    const { bridge } = buildBridge()
    void bridge.submit(AGENT, { verb: 'walk', params: { x: 4, y: 3 } })
    expect(bridge.drain()).toBe(1)
    expect(bridge.drain()).toBe(0)
    expect(bridge.drain()).toBe(0)
  })

  it('an empty queue drains to 0', () => {
    const { bridge } = buildBridge()
    expect(bridge.drain()).toBe(0)
  })

  it('a drained intent never reaches the world, even if the loop steps afterwards', async () => {
    const { bridge, step } = buildBridge()
    const p = bridge.submit(AGENT, { verb: 'walk', params: { x: 8, y: 3 } })
    bridge.drain()
    step()
    expect(await p).toEqual({ ok: false, reason: 'the moment passes' })
    // The body never started walking: the intent died in the queue.
    expect(bridge.perception(AGENT).self.activity).toBeNull()
  })
})

function larder(plant?: (terrain: TileId[][]) => void): EngineBridge {
  const config = SimConfigSchema.parse({
    weather: { hourlyChangeChance: 0 },
    mystery: { chancePerDay: 0 },
  })
  const terrain: TileId[][] = Array.from({ length: 40 }, () =>
    Array.from({ length: 40 }, (): TileId => 0),
  )
  plant?.(terrain)
  const store = new EventStore(openDb(':memory:'))
  const rng = new RngStreams('bridge-larder')
  let state = genesisState(config, terrain)
  const put = (type: string, payload: unknown) => {
    state = fold(state, store.append(state.tick, type, payload), config)
  }
  put('agent_spawned', { id: AGENT, name: 'Tamar', x: 20, y: 20, ageDays: ADULT_AGE_DAYS })
  put('structure_planned', {
    id: 'shed_1',
    kind: 'storehouse',
    x: 24,
    y: 20,
    w: 1,
    h: 1,
    maxHp: 20,
    flammable: true,
    builderId: 'g',
  })
  put('structure_completed', { id: 'shed_1' })
  put('item_spawned', {
    id: 'loaf',
    kind: 'bread',
    qty: 1,
    loc: { t: 'structure', id: 'shed_1' },
  })
  put('item_spawned', { id: 'plank', kind: 'plank', qty: 1, loc: { t: 'tile', x: 21, y: 20 } })
  put('item_spawned', { id: 'sprig', kind: 'herb', qty: 1, loc: { t: 'tile', x: 22, y: 20 } })
  put('forageable_spawned', {
    id: 'bush',
    kind: 'berry_bush',
    x: 30,
    y: 20,
    stock: 6,
    fullStock: 6,
  })
  put('forageable_spawned', {
    id: 'rocks',
    kind: 'stone_outcrop',
    x: 21,
    y: 21,
    stock: 6,
    fullStock: 6,
  })
  const loop = new TickLoop({ store, state, rng, config, onTick: () => {} })
  return new EngineBridge({ loop, store, simConfig: config })
}

// The road to a meal. Thirst has had `nearestWater` and hunger
// had nothing, and the live run drank fifteen times and ate once.
describe('nearestFood: the nearest thing worth walking to for a meal', () => {
  it('names the kind and the place of the nearest meal, shelves and patches alike', () => {
    const bridge = larder()
    // The loaf on the shelf at four tiles beats the bushes at ten.
    expect(bridge.nearestFood(20, 20)).toEqual({ x: 24, y: 20, kind: 'bread' })
    // From the far side of the meadow the bushes win.
    expect(bridge.nearestFood(34, 20)).toEqual({ x: 30, y: 20, kind: 'berries' })
  })

  it('passes over what is not food, however close it lies', () => {
    const bridge = larder()
    // A plank one tile away and a stone outcrop two: neither is dinner.
    expect(bridge.nearestFood(20, 20)?.kind).toBe('bread')
  })

  // r36: Kamal, Tariq and Leyla each went for the herbs at suppertime and learned from the
  // refusal, an hour each. The road names a meal, and a remedy is not one.
  it('★ a herb two tiles off is a remedy, not the nearest meal', () => {
    const bridge = larder()
    expect(bridge.nearestFood(20, 20)?.kind).toBe('bread')
    expect(bridge.isEdible('herb')).toBe(false)
    expect(bridge.isEdible('bread')).toBe(true)
  })

  it('nothing beyond the horizon is a meal', () => {
    const bridge = larder()
    expect(bridge.nearestFood(20, 20, 2)).toBeNull()
  })
})

// The same road, for the stuff a want is priced in. A cost with no place to go is the want the
// arm-B experiment measured as worse than no want at all.
describe('nearestSource: where the missing material stands', () => {
  it('names a patch by what it is, and a stack by where somebody left it', () => {
    const bridge = larder()
    // Loose rock at the foot of the outcrop, two tiles off.
    expect(bridge.nearestSource('stone', 20, 20)).toEqual({ x: 21, y: 21, from: 'stone_outcrop' })
    // A plank is nobody's node: it is only ever a stack lying where it was put down.
    expect(bridge.nearestSource('plank', 20, 20)).toEqual({ x: 21, y: 20, from: 'stack' })
    expect(bridge.nearestSource('fiber', 20, 20)).toBeNull()
    expect(bridge.nearestSource('stone', 20, 20, 1)).toBeNull()
  })

  it('finds wood standing in the ground, which no item and no node ever holds', () => {
    const bridge = larder((t) => {
      t[24]![26] = 3
    })
    expect(bridge.nearestSource('wood', 20, 20)).toEqual({ x: 26, y: 24, from: 'tree' })
    // Only wood is ever read off the ground; clay has neither a stack nor a node here.
    expect(bridge.nearestSource('clay', 20, 20)).toBeNull()
  })
})

// A bare world with no systems running, so the only thing in the log is what the bridge put
// there. Same `let handler` wiring the harnesses above use — TickLoop takes onTick once.
function announceHarness(world: TickHandler = () => {}): {
  store: EventStore
  loop: TickLoop
  bridge: EngineBridge
  config: SimConfig
  terrain: TileId[][]
} {
  const config = SimConfigSchema.parse({})
  const terrain: TileId[][] = Array.from({ length: 8 }, () =>
    Array.from({ length: 8 }, (): TileId => 0),
  )
  const store = new EventStore(openDb(':memory:'))
  let state = genesisState(config, terrain)
  state = fold(
    state,
    store.append(state.tick, 'agent_spawned', {
      id: AGENT,
      name: 'Tamar',
      x: 3,
      y: 3,
      ageDays: ADULT_AGE_DAYS,
    }),
    config,
  )
  let handler: TickHandler = () => {}
  const loop = new TickLoop({
    store,
    state,
    rng: new RngStreams('bridge-announce'),
    config,
    onTick: (ctx) => {
      handler(ctx)
    },
  })
  const bridge = new EngineBridge({ loop, store, simConfig: config })
  handler = bridge.wrapTickHandler(world)
  return { store, loop, bridge, config, terrain }
}
const typesOf = (store: EventStore): string[] => store.readFrom(0).map((e: SimEvent) => e.type)

describe('EngineBridge.announce — a fact with no verb to ride in on', () => {
  it('flushes a late closure without advancing time or replaying it twice', () => {
    const { store, loop, bridge, config, terrain } = announceHarness(() => {
      throw new Error('shutdown must not run world systems')
    })
    bridge.announce('agent_moved', { id: AGENT, x: 4, y: 3 })
    bridge.announce('scene_closed', {
      id: 'last-talk',
      summary: 'They agreed.',
      deltas: [],
      closeReason: 'ended',
    })
    bridge.flushAnnouncements()
    expect(loop.tick).toBe(0)
    expect(loop.state.agents[AGENT]!.x).toBe(4)
    expect(typesOf(store)).toEqual(['agent_spawned', 'agent_moved', 'scene_closed'])
    expect(stateHash(replayFromGenesis(store, config, terrain))).toBe(stateHash(loop.state))
    bridge.flushAnnouncements()
    expect(typesOf(store)).toHaveLength(3)
  })

  it('keeps the announcement batch and live state intact when a flush rolls back', () => {
    const { store, loop, bridge } = announceHarness()
    const before = stateHash(loop.state)
    bridge.announce('agent_moved', { id: AGENT, x: 4, y: 3 })
    bridge.announce('agent_moved', { id: 'missing', x: 5, y: 3 })
    expect(() => {
      bridge.flushAnnouncements()
    }).toThrow(/unknown agent/)
    expect(stateHash(loop.state)).toBe(before)
    expect(typesOf(store)).toEqual(['agent_spawned'])
    expect(() => {
      bridge.flushAnnouncements()
    }).toThrow(/unknown agent/)
    expect(loop.tick).toBe(0)
  })

  it('puts the announcement in the world log at the next tick', () => {
    const { store, loop, bridge } = announceHarness()
    bridge.announce(DISCOVERY_EVENT, {
      recipeId: 'recipe:waterskin',
      name: 'stitch a waterskin',
      kind: 'craft',
      byId: 'a1',
      intent: 'carry water in a hide',
      makes: ['waterskin'],
    })
    expect(typesOf(store)).not.toContain(DISCOVERY_EVENT) // nothing before the tick
    loop.step()
    expect(typesOf(store)).toContain(DISCOVERY_EVENT)
  })

  // ★ The tick rolls back on a throw, but a resolved promise cannot: the mind went on
  // believing it had walked, and the discovery it had announced was gone from the log for good.
  it('★ a tick that comes apart tells the minds so, and keeps the announcement', async () => {
    let falling = true
    const { store, loop, bridge } = announceHarness(() => {
      if (falling) throw new Error('the world systems fell over')
    })
    bridge.announce(DISCOVERY_EVENT, {
      recipeId: 'recipe:waterskin',
      name: 'stitch a waterskin',
      kind: 'craft',
      byId: 'a1',
      intent: 'carry water in a hide',
      makes: ['waterskin'],
    })
    const p = bridge.submit(AGENT, { verb: 'walk', params: { x: 4, y: 3 } })

    expect(() => {
      loop.step()
    }).toThrow('fell over')
    expect(await p).toEqual({ ok: false, reason: ROLLED_BACK })
    expect(typesOf(store)).not.toContain(DISCOVERY_EVENT)

    falling = false
    loop.step()
    expect(typesOf(store)).toContain(DISCOVERY_EVENT)
  })

  it('drains ONCE — a second tick does not re-announce', () => {
    const { store, loop, bridge } = announceHarness()
    bridge.announce(DISCOVERY_EVENT, {
      recipeId: 'recipe:a',
      name: 'a',
      kind: 'word',
      byId: 'a1',
      intent: 'a',
      makes: [],
    })
    loop.step()
    loop.step()
    loop.step()
    expect(typesOf(store).filter((t) => t === DISCOVERY_EVENT)).toHaveLength(1)
  })

  it('keeps arrival order between two announcements in the same tick', () => {
    const { store, loop, bridge } = announceHarness()
    for (const n of ['first', 'second']) {
      bridge.announce(DISCOVERY_EVENT, {
        recipeId: `express:${n}`,
        name: n,
        kind: 'word',
        byId: 'a1',
        intent: n,
        makes: [],
      })
    }
    loop.step()
    const names = store
      .readFrom(0)
      .filter((e: SimEvent) => e.type === DISCOVERY_EVENT)
      .map((e: SimEvent) => (e.payload as { name: string }).name)
    expect(names).toEqual(['first', 'second'])
  })

  it('an announcement lands BEFORE the intent it made possible', () => {
    // The runtime codifies then submits in one synchronous stretch, so draining the other way
    // round writes "used the verb" before "the verb existed".
    const { store, loop, bridge } = announceHarness()
    void bridge.submit(AGENT, { verb: 'walk', params: { x: 4, y: 3 } })
    bridge.announce(DISCOVERY_EVENT, {
      recipeId: 'recipe:waterskin',
      name: 'stitch a waterskin',
      kind: 'craft',
      byId: AGENT,
      intent: 'carry water in a hide',
      makes: ['waterskin'],
    })
    loop.step()
    const log = store.readFrom(0)
    const discovery = log.findIndex((e: SimEvent) => e.type === DISCOVERY_EVENT)
    const acted = log.findIndex((e: SimEvent) => e.type === 'action_started')
    expect(discovery).toBeGreaterThanOrEqual(0)
    expect(acted).toBeGreaterThan(discovery)
  })

  it('folds and replays without moving the state — the archive is the log, not the state', () => {
    const { store, loop, bridge, config, terrain } = announceHarness()
    const before = stateHash(loop.state)
    bridge.announce(DISCOVERY_EVENT, {
      recipeId: 'recipe:waterskin',
      name: 'stitch a waterskin',
      kind: 'craft',
      byId: 'a1',
      intent: 'carry water in a hide',
      makes: ['waterskin'],
    })
    loop.step()
    expect(stateHash(replayFromGenesis(store, config, terrain))).toBe(stateHash(loop.state))
    expect(loop.state.tick).toBe(1)
    expect(before).not.toBe('')
  })
})

// Perception reports that a thing was done and never that it was done to you, and only the
// second is what a mind's affection is fed by.
describe('★ an expression aimed at one body', () => {
  it('names whoever aimed it here, and not whoever only did it nearby', () => {
    const { bridge, store, loop } = ownedWorld()
    const expressed = (agentId: string, verb: string, targetId?: string): void => {
      store.append(loop.tick, 'agent_expressed', {
        agentId,
        verb,
        ...(targetId === undefined ? {} : { targetId }),
        x: 4,
        y: 3,
        sense: 'sight',
      })
    }
    expressed('bex', 'express:comfort', AGENT)
    expressed('cass', 'express:mourn')
    expressed('cass', 'express:sing', 'bex')
    // A minted act that is not an expression reaches nobody's affection.
    expressed('bex', 'dig_channel', AGENT)

    expect(bridge.expressedAt(AGENT)).toEqual(['bex'])
    expect(bridge.expressedAt('bex')).toEqual(['cass'])
    expect(bridge.expressedAt('cass')).toEqual([])
  })
})

// r26: 77 of 85 walks of no length led to nothing within ten ticks, and the mind that asked for
// each was told "You have walked." A walk the world already held is answered as what it is.
describe('★ an act the world already held is answered as settled, and what the hands made rides with it', () => {
  it('a walk to the tile underfoot comes back settled, and is read back as settled', async () => {
    const { bridge, step } = buildBridge()
    const seen: unknown[] = []
    const p = bridge.submit(AGENT, { verb: 'walk', params: { x: 3, y: 3 } }, (r) => seen.push(r))
    step()
    expect(await p).toEqual({ ok: true, settled: true })
    expect(seen).toEqual([{ ok: true, settled: true }])
    // The window is read on a look, the way the runtime reads it after a perception.
    bridge.perception(AGENT)
    const done = bridge.completedSince(AGENT, 0)
    expect(done.map(({ seq, ...act }) => act)).toEqual([{ verb: 'walk', settled: true }])
    expect(typeof done[0]?.seq).toBe('number')
  })

  it('a real step is not settled, and a thing made on the tick an act finished is named with it', async () => {
    const { bridge, store, loop, step } = ownedWorld()
    const p = bridge.submit('cass', { verb: 'walk', params: { x: 6, y: 3 } })
    step()
    expect(await p).toEqual({ ok: true })
    while (loop.state.agents.cass!.activity !== null) step()
    bridge.perception('cass')
    const done = bridge.completedSince('cass', 0)
    expect(done.map(({ seq, ...act }) => act)).toEqual([{ verb: 'walk', settled: false }])
    // A catch is logged after the cast completes, on the same tick.
    store.append(loop.tick, 'item_spawned', {
      id: 'item_9',
      kind: 'fish',
      qty: 1,
      loc: { t: 'agent', id: 'cass' },
      madeBy: 'cass',
    })
    step()
    bridge.perception('cass')
    expect(bridge.completedSince('cass', 0)).toEqual([
      { seq: done[0]!.seq, verb: 'walk', settled: false, made: 'fish' },
    ])
    // Somebody else's catch is not this body's.
    expect(bridge.completedSince('bex', 0)).toEqual([])
  })
})

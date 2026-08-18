import { describe, expect, it } from 'vitest'
import {
  createWorldTick,
  EventStore,
  fold,
  genesisState,
  openDb,
  RngStreams,
  TickLoop,
  type TickHandler,
  type TileId,
} from '@sj/engine'
import { SimConfigSchema } from '@sj/shared'
import { DEFAULT_MIND_CONFIG } from '../wake.js'
import { DEFAULT_RECENT_WINDOW_TICKS, EngineBridge } from './bridge.js'

const AGENT = 'tamar'

function buildBridge(): { bridge: EngineBridge; step: () => void } {
  const config = SimConfigSchema.parse({})
  const terrain: TileId[][] = Array.from({ length: 12 }, () => Array.from({ length: 12 }, (): TileId => 0))
  const db = openDb(':memory:')
  const store = new EventStore(db)
  const rng = new RngStreams('bridge-drain')
  let state = genesisState(config, terrain)
  const ev = store.append(state.tick, 'agent_spawned', { id: AGENT, name: 'Tamar', x: 3, y: 3, ageDays: 30 })
  state = fold(state, ev, config)

  const worldTick = createWorldTick(config, rng)
  let handler: TickHandler = () => {}
  const loop = new TickLoop({ store, state, rng, config, onTick: (ctx) => handler(ctx) })
  const bridge = new EngineBridge({ loop, store, simConfig: config })
  handler = bridge.wrapTickHandler(({ emit }) => {
    for (const e of worldTick(loop.state).events) emit(e.type, e.payload)
  })
  return { bridge, step: () => loop.step() }
}

// A second town where things are owned, so the bridge's ownership mapping is
// observable: Tamar holds her own bread, Bex's plank sits on the ground beside
// her, and Cass lifts it while she watches.
function ownedWorld(opts: { recentWindowTicks?: number } = {}): { bridge: EngineBridge; step: () => void } {
  const config = SimConfigSchema.parse({ weather: { hourlyChangeChance: 0 }, mystery: { chancePerDay: 0 } })
  const terrain: TileId[][] = Array.from({ length: 12 }, () => Array.from({ length: 12 }, (): TileId => 0))
  const store = new EventStore(openDb(':memory:'))
  const rng = new RngStreams('bridge-ownership')
  let state = genesisState(config, terrain)
  const put = (type: string, payload: unknown) => { state = fold(state, store.append(state.tick, type, payload), config) }
  put('agent_spawned', { id: AGENT, name: 'Tamar', x: 3, y: 3, ageDays: 7300 })
  put('agent_spawned', { id: 'bex', name: 'Bex', x: 4, y: 3, ageDays: 7300 })
  put('agent_spawned', { id: 'cass', name: 'Cass', x: 5, y: 3, ageDays: 7300 })
  put('item_spawned', { id: 'item_1', kind: 'bread', qty: 1, loc: { t: 'agent', id: AGENT }, owner: AGENT })
  put('item_spawned', {
    id: 'item_2', kind: 'plank', qty: 1, loc: { t: 'tile', x: 5, y: 4 }, owner: 'bex', crafterMark: 'bex',
  })

  const worldTick = createWorldTick(config, rng)
  let handler: TickHandler = () => {}
  const loop = new TickLoop({ store, state, rng, config, onTick: (ctx) => handler(ctx) })
  const bridge = new EngineBridge({ loop, store, simConfig: config, ...opts })
  handler = bridge.wrapTickHandler(({ emit }) => {
    for (const e of worldTick(loop.state).events) emit(e.type, e.payload)
    if (loop.tick === 1) {
      emit('item_moved', { id: 'item_2', loc: { t: 'agent', id: 'cass' } })
      emit('item_taken', { itemId: 'item_2', kind: 'plank', takerId: 'cass', ownerId: 'bex', x: 5, y: 4 })
    }
  })
  return { bridge, step: () => loop.step() }
}

describe('EngineBridge carries ownership through to the mind', () => {
  it('names another\'s claim on a thing, and says nothing about your own', () => {
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

describe('the default perception window outlasts the gap between turns (D-28-6)', () => {
  it('covers the longest an awake mind can go without a turn, with margin', () => {
    expect(DEFAULT_RECENT_WINDOW_TICKS).toBeGreaterThanOrEqual(DEFAULT_MIND_CONFIG.boredomTicks)
    expect(DEFAULT_RECENT_WINDOW_TICKS).toBeGreaterThanOrEqual(64)
  })

  it('a witnessed taking still reaches a mind that looks a sim-hour later', () => {
    const { bridge, step } = ownedWorld()
    step() // Cass lifts Bex's plank at tick 1, in Tamar's sight
    for (let i = 0; i < 60; i++) step()
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
})

const settled: unique symbol = Symbol('pending')
function settledYet<T>(p: Promise<T>): Promise<T | typeof settled> {
  return Promise.race([p, Promise.resolve().then((): typeof settled => settled)])
}

describe('EngineBridge.drain (T23)', () => {
  it('a queued submit pends until the loop steps', async () => {
    const { bridge, step } = buildBridge()
    const p = bridge.submit(AGENT, { verb: 'walk', params: { x: 4, y: 3 } })
    expect(await settledYet(p)).toBe(settled)
    step()
    expect(await p).toEqual({ ok: true })
  })

  it('drain resolves every queued submit as refused and returns the count', async () => {
    const { bridge } = buildBridge()
    const seen: Array<{ ok: boolean; reason?: string }> = []
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

// R21-B: the road to a meal. Thirst has had `nearestWater` since the last batch and hunger
// had nothing, and the live run drank fifteen times and ate once.
describe('nearestFood: the nearest thing worth walking to for a meal', () => {
  function larder(): EngineBridge {
    const config = SimConfigSchema.parse({ weather: { hourlyChangeChance: 0 }, mystery: { chancePerDay: 0 } })
    const terrain: TileId[][] = Array.from({ length: 40 }, () => Array.from({ length: 40 }, (): TileId => 0))
    const store = new EventStore(openDb(':memory:'))
    const rng = new RngStreams('bridge-larder')
    let state = genesisState(config, terrain)
    const put = (type: string, payload: unknown) => { state = fold(state, store.append(state.tick, type, payload), config) }
    put('agent_spawned', { id: AGENT, name: 'Tamar', x: 20, y: 20, ageDays: 7300 })
    put('structure_planned', {
      id: 'shed_1', kind: 'storehouse', x: 24, y: 20, w: 1, h: 1, maxHp: 20, flammable: true, builderId: 'g',
    })
    put('structure_completed', { id: 'shed_1' })
    put('item_spawned', { id: 'loaf', kind: 'bread', qty: 1, loc: { t: 'structure', id: 'shed_1' } })
    put('item_spawned', { id: 'plank', kind: 'plank', qty: 1, loc: { t: 'tile', x: 21, y: 20 } })
    put('forageable_spawned', { id: 'bush', kind: 'berry_bush', x: 30, y: 20, stock: 6, fullStock: 6 })
    put('forageable_spawned', { id: 'rocks', kind: 'stone_outcrop', x: 21, y: 21, stock: 6, fullStock: 6 })
    const loop = new TickLoop({ store, state, rng, config, onTick: () => {} })
    return new EngineBridge({ loop, store, simConfig: config })
  }

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

  it('nothing beyond the horizon is a meal', () => {
    const bridge = larder()
    expect(bridge.nearestFood(20, 20, 2)).toBeNull()
  })
})

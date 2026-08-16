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
import { EngineBridge } from './bridge.js'

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

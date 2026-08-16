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
import { buildAgentCtx } from './arbiterSeam.js'

const AGENT = 'tamar'

function world() {
  const config = SimConfigSchema.parse({})
  const terrain: TileId[][] = Array.from({ length: 24 }, () => Array.from({ length: 24 }, (): TileId => 0))
  const db = openDb(':memory:')
  const store = new EventStore(db)
  const rng = new RngStreams('arbiter-seam-test')
  let state = genesisState(config, terrain)
  const emit = (type: string, payload: unknown) => {
    const ev = store.append(state.tick, type, payload)
    state = fold(state, ev, config)
  }
  emit('agent_spawned', { id: AGENT, name: 'Tamar', x: 7, y: 4, ageDays: 30 })
  emit('item_spawned', { id: 'item_1', kind: 'wood', qty: 3, loc: { t: 'agent', id: AGENT } })
  emit('skill_gained', { agentId: AGENT, track: 'carpentry', xp: 5 })

  const worldTick = createWorldTick(config, rng)
  let handler: TickHandler = () => {}
  const loop = new TickLoop({ store, state, rng, config, onTick: (ctx) => handler(ctx) })
  const bridge = new EngineBridge({ loop, store, simConfig: config })
  handler = bridge.wrapTickHandler(({ emit: e }) => {
    for (const ev of worldTick(loop.state).events) e(ev.type, ev.payload)
  })
  return { bridge, loop }
}

describe('buildAgentCtx', () => {
  it('carries who is asking, what they carry, where they stand, and what they can already do', () => {
    const { bridge } = world()
    expect(buildAgentCtx(bridge, AGENT)).toEqual({
      agentId: AGENT,
      name: 'Tamar',
      skills: { carpentry: 5 },
      inventory: [{ kind: 'wood', qty: 3 }],
      position: { x: 7, y: 4 },
    })
  })

  it('throws for a body the world does not have — an unknown asker is a bug, not a verdict', () => {
    const { bridge } = world()
    expect(() => buildAgentCtx(bridge, 'nobody')).toThrow(/nobody/)
  })
})

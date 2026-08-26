import { describe, expect, it } from 'vitest'
import {
  EventStore,
  RngStreams,
  TickLoop,
  fold,
  genesisState,
  openDb,
  type TickHandler,
  type TileId,
} from '@sj/engine'
import { SimConfigSchema } from '@sj/shared'
import { EngineBridge } from '../runtime/bridge.js'
import { watchBirths, type AgentBornPayload } from './watchBirths.js'

const MOTHER = 'amara'
const FATHER = 'yusuf'

function buildWorld() {
  const config = SimConfigSchema.parse({})
  const terrain: TileId[][] = Array.from({ length: 12 }, () =>
    Array.from({ length: 12 }, (): TileId => 0),
  )
  const store = new EventStore(openDb(':memory:'))
  const rng = new RngStreams('watch-births')
  let state = genesisState(config, terrain)
  for (const [id, name] of [
    [MOTHER, 'Amara'],
    [FATHER, 'Yusuf'],
  ] as const) {
    state = fold(
      state,
      store.append(state.tick, 'agent_spawned', { id, name, x: 3, y: 3, ageDays: 9000 }),
      config,
    )
  }
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
  // No world systems: this test drives births by hand, not by gestation.
  let pending: { type: string; payload: unknown }[] = []
  handler = bridge.wrapTickHandler(({ emit }) => {
    for (const e of pending) emit(e.type, e.payload)
    pending = []
  })
  return {
    bridge,
    store,
    step: () => {
      loop.step()
    },
    bear: (id: string, name: string) => {
      pending.push({
        type: 'agent_born',
        payload: { id, name, sex: 'f', motherId: MOTHER, fatherId: FATHER, x: 3, y: 3 },
      })
    },
  }
}

describe('watchBirths (T25)', () => {
  it('fires spawn exactly once per agent_born, with the parsed payload', () => {
    const w = buildWorld()
    const born: AgentBornPayload[] = []
    watchBirths(w.bridge, w.store, (b) => born.push(b))

    w.bear('agent_3', 'Mira')
    w.step()
    expect(born).toHaveLength(1)
    expect(born[0]).toEqual({
      id: 'agent_3',
      name: 'Mira',
      sex: 'f',
      motherId: MOTHER,
      fatherId: FATHER,
      x: 3,
      y: 3,
    })

    // Ticks that carry no birth do not re-announce the one already seen.
    w.step()
    w.step()
    expect(born).toHaveLength(1)

    w.bear('agent_4', 'Idris')
    w.step()
    expect(born.map((b) => b.id)).toEqual(['agent_3', 'agent_4'])
  })

  it('two births in the same tick each fire once, in log order', () => {
    const w = buildWorld()
    const born: AgentBornPayload[] = []
    watchBirths(w.bridge, w.store, (b) => born.push(b))
    w.bear('agent_3', 'Mira')
    w.bear('agent_4', 'Idris')
    w.step()
    expect(born.map((b) => b.id)).toEqual(['agent_3', 'agent_4'])
  })

  it('births already in the log before the watch started are not replayed', () => {
    const w = buildWorld()
    w.bear('agent_3', 'Mira')
    w.step()

    const born: AgentBornPayload[] = []
    watchBirths(w.bridge, w.store, (b) => born.push(b))
    w.step()
    expect(born).toEqual([])
  })

  it('the returned stop function ends the watch', () => {
    const w = buildWorld()
    const born: AgentBornPayload[] = []
    const stop = watchBirths(w.bridge, w.store, (b) => born.push(b))
    stop()
    w.bear('agent_3', 'Mira')
    w.step()
    expect(born).toEqual([])
    stop() // idempotent
  })
})

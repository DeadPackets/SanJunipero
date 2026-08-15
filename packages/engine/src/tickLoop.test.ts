import { describe, it, expect } from 'vitest'
import { openDb } from './db.js'
import { EventStore } from './eventStore.js'
import { genesisState } from './state.js'
import { RngStreams } from './rng.js'
import { TickLoop } from './tickLoop.js'
import { replayLatest } from './replay.js'
import { stateHash } from '@sj/shared'

function loop(onTick: ConstructorParameters<typeof TickLoop>[0]['onTick'], snapshotEveryTicks = 60) {
  const store = new EventStore(openDb(':memory:'))
  return { store, loop: new TickLoop({ store, state: genesisState(), rng: new RngStreams('t'), onTick, snapshotEveryTicks }) }
}

describe('TickLoop', () => {
  it('step() advances tick and applies handler emissions to state', () => {
    const { loop: l } = loop(({ tick, emit }) => { if (tick === 1) emit('agent_spawned', { id: 'a1', x: 0, y: 0 }) })
    l.step()
    expect(l.tick).toBe(1)
    expect(l.state.agents.a1).toBeDefined()
  })
  it('events land in the store in order', () => {
    const { store, loop: l } = loop(({ tick, emit }) => { if (tick === 1) emit('agent_spawned', { id: 'a1', x: 0, y: 0 }) })
    l.step(); l.step()
    expect(store.readFrom(0).map(e => e.type)).toEqual(['tick_advanced', 'agent_spawned', 'tick_advanced'])
  })
  it('snapshots every N ticks and replayLatest matches live state', () => {
    const { store, loop: l } = loop(({ tick, emit }) => { if (tick % 2 === 1) emit('agent_spawned', { id: `a${tick}`, x: tick, y: 0 }) }, 5)
    for (let i = 0; i < 12; i++) l.step()
    expect(store.latestSnapshot()!.tick).toBe(10)
    expect(stateHash(replayLatest(store).state)).toBe(stateHash(l.state))
  })
})

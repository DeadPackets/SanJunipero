import { describe, it, expect } from 'vitest'
import { stateHash } from '@sj/shared'
import { openDb } from './db.js'
import { EventStore } from './eventStore.js'
import { genesisState, fold } from './state.js'
import { replayFromGenesis, replayLatest } from './replay.js'
import { RngStreams } from './rng.js'

function seedStore(): { store: EventStore; live: ReturnType<typeof genesisState> } {
  const store = new EventStore(openDb(':memory:'))
  let live = genesisState()
  const emit = (tick: number, type: string, payload: unknown) => { live = fold(live, store.append(tick, type, payload)) }
  emit(0, 'agent_spawned', { id: 'a1', x: 1, y: 1 })
  emit(1, 'tick_advanced', {})
  emit(1, 'agent_moved', { id: 'a1', x: 2, y: 1 })
  emit(2, 'need_changed', { id: 'a1', need: 'hunger', delta: -5 })
  return { store, live }
}

describe('replay', () => {
  it('genesis replay matches live state hash', () => {
    const { store, live } = seedStore()
    expect(stateHash(replayFromGenesis(store))).toBe(stateHash(live))
  })
  it('snapshot + tail replay matches full replay', () => {
    const { store, live } = seedStore()
    const rng = new RngStreams('town1'); rng.get('weather').next()
    // snapshot mid-stream (after seq 2), then more events already exist after it
    const mid = replayFromGenesis(store) // final state; emulate mid by re-folding first 2
    void mid
    const firstTwo = store.readRange(1, 2).reduce(fold, genesisState())
    store.saveSnapshot(1, 2, firstTwo, rng.snapshot())
    const r = replayLatest(store)
    expect(stateHash(r.state)).toBe(stateHash(live))
    expect(r.seq).toBe(store.lastSeq())
    expect(r.rng.get('weather').next()).toBe(rng.get('weather').next())
  })
  it('replayLatest with no snapshot equals genesis replay', () => {
    const { store, live } = seedStore()
    expect(stateHash(replayLatest(store).state)).toBe(stateHash(live))
  })
})

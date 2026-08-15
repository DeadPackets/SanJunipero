import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG, stateHash } from '@sj/shared'
import { openDb } from './db.js'
import { EventStore } from './eventStore.js'
import { genesisState } from './state.js'
import { fold } from './fold.js'
import { replayFromGenesis, replayLatest } from './replay.js'
import { RngStreams } from './rng.js'

function seedStore(): { store: EventStore; live: ReturnType<typeof genesisState> } {
  const store = new EventStore(openDb(':memory:'))
  let live = genesisState(DEFAULT_CONFIG)
  const emit = (tick: number, type: string, payload: unknown) => { live = fold(live, store.append(tick, type, payload)) }
  emit(0, 'agent_spawned', { id: 'a1', name: 'a1', x: 1, y: 1, ageDays: 7300 })
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
    const firstTwo = store.readRange(1, 2).reduce((s, e) => fold(s, e), genesisState(DEFAULT_CONFIG))
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
  it('throws when the rng checkpoint is behind the folded state tick', () => {
    const { store } = seedStore()
    const rng = new RngStreams('town1')
    store.saveRngState(1, rng.snapshot())
    expect(() => replayLatest(store)).not.toThrow()
    store.append(2, 'tick_advanced', {})
    expect(() => replayLatest(store)).toThrow(/rng checkpoint .* behind/)
  })
})

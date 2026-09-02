import { describe, it, expect } from 'vitest'
import { ADULT_AGE_DAYS, DEFAULT_CONFIG, stateHash } from '@sj/shared'
import { openDb } from './db.js'
import { EventStore } from './eventStore.js'
import { submitIntent } from './intent.js'
import { genesisState } from './state.js'
import { fold } from './fold.js'
import { replayFromGenesis, replayLatest } from './replay.js'
import { RngStreams } from './rng.js'
import { registerVerb, unregisterVerb } from './verbs/index.js'

function seedStore(): { store: EventStore; live: ReturnType<typeof genesisState> } {
  const store = new EventStore(openDb(':memory:'))
  let live = genesisState(DEFAULT_CONFIG)
  const emit = (tick: number, type: string, payload: unknown) => {
    live = fold(live, store.append(tick, type, payload))
  }
  emit(0, 'agent_spawned', { id: 'a1', name: 'a1', x: 1, y: 1, ageDays: ADULT_AGE_DAYS })
  emit(1, 'tick_advanced', {})
  emit(1, 'agent_moved', { id: 'a1', x: 2, y: 1 })
  emit(2, 'needs_changed', { id: 'a1', changes: [{ need: 'hunger', delta: -5 }] })
  return { store, live }
}

describe('replay', () => {
  it('genesis replay matches live state hash', () => {
    const { store, live } = seedStore()
    expect(stateHash(replayFromGenesis(store))).toBe(stateHash(live))
  })
  it('snapshot + tail replay matches full replay', () => {
    const { store, live } = seedStore()
    const rng = new RngStreams('town1')
    rng.get('weather').next()
    // snapshot mid-stream (after seq 2), then more events already exist after it
    const mid = replayFromGenesis(store) // final state; emulate mid by re-folding first 2
    void mid
    const firstTwo = store
      .readRange(1, 2)
      .reduce((s, e) => fold(s, e), genesisState(DEFAULT_CONFIG))
    store.saveSnapshot(1, 2, firstTwo, rng.snapshot())
    const r = replayLatest(store)
    expect(stateHash(r.state)).toBe(stateHash(live))
    expect(r.seq).toBe(store.lastSeq())
    expect(r.rng.get('weather').next()).toBe(rng.get('weather').next())
  })
  it('replayLatest with no snapshot equals genesis replay (seed provided)', () => {
    const { store, live } = seedStore()
    expect(stateHash(replayLatest(store, DEFAULT_CONFIG, undefined, 'town1').state)).toBe(
      stateHash(live),
    )
  })
  it('throws when no rng checkpoint, no snapshot, and no seed exist', () => {
    const { store } = seedStore()
    expect(() => replayLatest(store)).toThrow(/no seed source/)
  })
  it('throws when the snapshot rng is behind the folded state tick', () => {
    const { store } = seedStore()
    const rng = new RngStreams('town1')
    const firstTwo = store
      .readRange(1, 2)
      .reduce((s, e) => fold(s, e), genesisState(DEFAULT_CONFIG))
    store.saveSnapshot(1, 2, firstTwo, rng.snapshot()) // no rng checkpoint: rng falls back to the snapshot
    store.append(3, 'tick_advanced', {})
    expect(() => replayLatest(store)).toThrow(/rng checkpoint .* behind/)
  })
  // A minted verb's binding row is rebuilt from the rulebook and never folded. What it read in
  // is in the log as the act's own params, so a replay that has never heard of the word agrees.
  it('replays a minted act whose object was read in, to the same hash', () => {
    const store = new EventStore(openDb(':memory:'))
    let live = genesisState(DEFAULT_CONFIG)
    const emit = (tick: number, type: string, payload: unknown) => {
      live = fold(live, store.append(tick, type, payload))
    }
    emit(0, 'agent_spawned', { id: 'a1', name: 'a1', x: 1, y: 1, ageDays: ADULT_AGE_DAYS })
    emit(0, 'item_spawned', { id: 'item_1', kind: 'reeds', qty: 1, loc: { t: 'agent', id: 'a1' } })

    registerVerb({
      kind: 'recipe:bless',
      reads: ['itemId'],
      validate: (_s, _c, _a, params) =>
        typeof params.itemId === 'string' ? null : 'name itemId, the thing it is for',
      duration: () => 1,
      onComplete: () => [],
    })
    const res = submitIntent(live, DEFAULT_CONFIG, 'a1', 'recipe:bless', {})
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.events.find((e) => e.type === 'action_started')!.payload).toMatchObject({
      params: { itemId: 'item_1' },
    })
    for (const e of res.events) emit(1, e.type, e.payload)
    unregisterVerb('recipe:bless')

    expect(stateHash(replayFromGenesis(store))).toBe(stateHash(live))
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

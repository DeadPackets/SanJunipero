import type { EventStore } from './eventStore.js'
import { genesisState, fold, type WorldState } from './state.js'
import { RngStreams } from './rng.js'

export function replayFromGenesis(store: EventStore): WorldState {
  return store.readFrom(0).reduce(fold, genesisState())
}

export function replayLatest(store: EventStore): { state: WorldState; rng: RngStreams; seq: number } {
  const snap = store.latestSnapshot()
  let state = snap ? (snap.state as WorldState) : genesisState()
  const ckpt = store.latestRngState()
  const rng = ckpt ? RngStreams.restore(ckpt.rng)
    : snap ? RngStreams.restore(snap.rng)
    : new RngStreams(process.env.SJ_SEED ?? 'san-junipero')
  const startSeq = snap ? snap.seq : 0
  for (const ev of store.readFrom(startSeq)) state = fold(state, ev)
  return { state, rng, seq: store.lastSeq() }
}

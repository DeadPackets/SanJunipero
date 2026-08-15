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
  const events = store.readFrom(startSeq)
  for (const ev of events) state = fold(state, ev)
  if (ckpt && events.length > 0 && ckpt.tick !== state.tick) {
    throw new Error(`rng checkpoint (tick ${ckpt.tick}) is behind folded state (tick ${state.tick})`)
  }
  return { state, rng, seq: store.lastSeq() }
}

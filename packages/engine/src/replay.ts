import { DEFAULT_CONFIG, type SimConfig } from '@sj/shared'
import type { EventStore } from './eventStore.js'
import { genesisState, type TileId, type WorldState } from './state.js'
import { fold } from './fold.js'
import { RngStreams } from './rng.js'

export function replayFromGenesis(store: EventStore, config: SimConfig = DEFAULT_CONFIG, terrain?: TileId[][]): WorldState {
  return store.readFrom(0).reduce((s, ev) => fold(s, ev, config), genesisState(config, terrain))
}

// The deterministic core never reads the environment: callers at the app
// boundary decide the seed (e.g. from SJ_SEED) and pass it in explicitly.
export function replayLatest(store: EventStore, config: SimConfig = DEFAULT_CONFIG, terrain?: TileId[][], seed?: string): { state: WorldState; rng: RngStreams; seq: number } {
  const snap = store.latestSnapshot()
  let state = snap ? (snap.state as WorldState) : genesisState(config, terrain)
  const ckpt = store.latestRngState()
  let rng: RngStreams
  if (ckpt) rng = RngStreams.restore(ckpt.rng)
  else if (snap) rng = RngStreams.restore(snap.rng)
  else if (seed !== undefined) rng = new RngStreams(seed)
  else throw new Error('replayLatest: no seed source (no rng checkpoint, no snapshot, and no seed given)')
  const startSeq = snap ? snap.seq : 0
  const events = store.readFrom(startSeq)
  for (const ev of events) state = fold(state, ev, config)
  if (ckpt && events.length > 0 && ckpt.tick !== state.tick) {
    throw new Error(`rng checkpoint (tick ${ckpt.tick}) is behind folded state (tick ${state.tick})`)
  }
  if (!ckpt && snap && events.length > 0 && snap.tick !== state.tick) {
    throw new Error(`rng checkpoint (tick ${snap.tick}) is behind folded state (tick ${state.tick})`)
  }
  return { state, rng, seq: store.lastSeq() }
}

import type { SimConfig, SimEvent } from '@sj/shared'
import { fold } from '../fold.js'
import { RngStreams } from '../rng.js'
import type { TileId, WorldState } from '../state.js'
import { createWorldTick, type WorldTickResult } from '../worldTick.js'

// One counter for every fixture in the package: nothing in the fold or the state hash reads seq.
let seq = 1
export const ev = (type: string, payload: unknown, tick = 0): SimEvent => ({
  seq: seq++,
  tick,
  type,
  payload,
})

export const grid = (n: number): TileId[][] =>
  Array.from({ length: n }, () => Array.from({ length: n }, (): TileId => 0))

// Advance one tick, run the world, then fold what it emitted back over the advanced state: the
// two must agree, or a live run and its replay are two different towns.
export function roundTrips(
  state: WorldState,
  config: SimConfig,
  seed: string,
): { replayed: WorldState; out: WorldTickResult } {
  const at = state.tick + 1
  const advanced = fold(state, ev('tick_advanced', {}, at), config)
  const out = createWorldTick(config, new RngStreams(seed))(advanced)
  const replayed = out.events.reduce(
    (s, e) => fold(s, ev(e.type, e.payload, at), config),
    advanced,
  )
  return { replayed, out }
}

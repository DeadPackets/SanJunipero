import { DURATION_TICKS, type SimConfig, type SimEvent } from '@sj/shared'
import type { NeedChange } from '../events.def.js'
import { fold } from '../fold.js'
import { RngStreams } from '../rng.js'
import type { TileId, WorldState } from '../state.js'
import type { PendingEvent } from '../verbs/index.js'
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

// A live run and its replay must land on the same state, or they are two different towns.
export function roundTrips(
  state: WorldState,
  config: SimConfig,
  seed: string,
): { replayed: WorldState; out: WorldTickResult } {
  const at = state.tick + 1
  const advanced = fold(state, ev('tick_advanced', {}, at), config)
  const out = createWorldTick(config, new RngStreams(seed))(advanced)
  const replayed = out.events.reduce((s, e) => fold(s, ev(e.type, e.payload, at), config), advanced)
  return { replayed, out }
}

/** Every tick the act in hand still needs, and every event those ticks took. An act is minutes
 *  long, so a test that means "and then it happened" means this rather than one tick. */
export function runAct(
  state: WorldState,
  config: SimConfig,
  agentId = 'a1',
  rng = new RngStreams('t'),
): WorldTickResult {
  const worldTick = createWorldTick(config, rng)
  const events: PendingEvent[] = []
  let s = state
  for (let i = 0; i <= DURATION_TICKS.day; i++) {
    const out = worldTick(fold(s, ev('tick_advanced', {}, s.tick + 1), config))
    s = out.state
    events.push(...out.events)
    if (!s.agents[agentId]?.activity) break
  }
  return { state: s, events }
}

// One reader of the batch payload shape for the whole package.
export const changesOf = (e: { type: string; payload: unknown }): NeedChange[] =>
  e.type === 'needs_changed'
    ? (e.payload as { changes: NeedChange[] }).changes
    : e.type === 'needs_ticked'
      ? (e.payload as { bodies: { changes: NeedChange[] }[] }).bodies.flatMap((b) => b.changes)
      : []

export const needChanges = (events: { type: string; payload: unknown }[]): NeedChange[] =>
  events.flatMap(changesOf)

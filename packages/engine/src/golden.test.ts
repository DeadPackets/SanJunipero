import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_CONFIG, MINUTES_PER_DAY, stateHash } from '@sj/shared'
import { openDb } from './db.js'
import { EventStore } from './eventStore.js'
import { genesisState } from './state.js'
import { fold } from './fold.js'
import { RngStreams } from './rng.js'
import { TickLoop } from './tickLoop.js'
import { replayFromGenesis, replayLatest } from './replay.js'

// Synthetic day: 5 scripted actors move and get hungry, all randomness from named streams.
function makeLoopHandler(rng: RngStreams): ConstructorParameters<typeof TickLoop>[0]['onTick'] {
  return ({ tick, emit }) => {
    if (tick === 1)
      for (let i = 0; i < 5; i++)
        emit('agent_spawned', { id: `a${i}`, name: `a${i}`, x: i, y: 0, ageDays: 7300 })
    if (tick > 1) {
      const mover = `a${rng.get('walk').int(5)}`
      emit('agent_moved', { id: mover, x: rng.get('walk').int(128), y: rng.get('walk').int(128) })
      if (tick % 10 === 0)
        emit('need_changed', { id: `a${rng.get('meta').int(5)}`, need: 'hunger', delta: -1 })
    }
  }
}

function makeLoop(store: EventStore, rng: RngStreams) {
  return new TickLoop({
    store,
    state: genesisState(DEFAULT_CONFIG),
    rng,
    snapshotEveryTicks: 60,
    onTick: makeLoopHandler(rng),
  })
}

describe('GATE G1: golden replay', () => {
  it('a full synthetic sim-day replays from genesis to the state the live run left', () => {
    const store = new EventStore(openDb(':memory:'))
    const live = makeLoop(store, new RngStreams('golden'))
    for (let i = 0; i < MINUTES_PER_DAY; i++) live.step()
    expect(stateHash(replayFromGenesis(store))).toBe(stateHash(live.state))
  })

  // The guarantee scrubbing needs: folding one recorded log twice lands on one state. Anything
  // ambient inside the fold — Math.random, a clock, module state — shows up here as two towns.
  it('folding the same recorded log twice gives the same state', () => {
    const store = new EventStore(openDb(':memory:'))
    const live = makeLoop(store, new RngStreams('golden'))
    for (let i = 0; i < MINUTES_PER_DAY; i++) live.step()
    expect(stateHash(replayFromGenesis(store))).toBe(stateHash(replayFromGenesis(store)))
  })

  // And at every tick along the way. This is the shape WorldMirror.stateAt scrubs with: scrubbing
  // back to a tick you already visited must not show a second town.
  it('folding to a mid-log tick twice lands on the same state', () => {
    const store = new EventStore(openDb(':memory:'))
    const live = makeLoop(store, new RngStreams('golden'))
    for (let i = 0; i < MINUTES_PER_DAY; i++) live.step()
    const log = store.readFrom(0)
    const foldTo = (tick: number): string =>
      stateHash(
        log
          .filter((ev) => ev.tick <= tick)
          .reduce((s, ev) => fold(s, ev, DEFAULT_CONFIG), genesisState(DEFAULT_CONFIG)),
      )
    for (const tick of [1, 137, 600, MINUTES_PER_DAY - 1]) {
      expect(foldTo(tick), `fold to tick ${tick} is not stable`).toBe(foldTo(tick))
    }
  })

  it('crash mid-day: reopen db, resume from snapshot, final state identical to uninterrupted run', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sj-golden-'))
    const dbPath = join(dir, 'town.db')
    try {
      // uninterrupted reference run (in-memory)
      const refStore = new EventStore(openDb(':memory:'))
      const ref = makeLoop(refStore, new RngStreams('golden'))
      for (let i = 0; i < 800; i++) ref.step()

      // crashed run: 500 ticks, drop everything, reopen, resume 300 more
      const s1 = new EventStore(openDb(dbPath))
      const run1 = makeLoop(s1, new RngStreams('golden'))
      for (let i = 0; i < 500; i++) run1.step()
      // "crash": no clean shutdown; recover from durable store
      const s2 = new EventStore(openDb(dbPath))
      const rec = replayLatest(s2)
      const run2 = new TickLoop({
        store: s2,
        state: rec.state,
        rng: rec.rng,
        startTick: rec.state.tick,
        snapshotEveryTicks: 60,
        onTick: makeLoopHandler(rec.rng),
      })
      // replay the ticks lost after the last durable event: resume from exact tick
      for (let i = rec.state.tick; i < 800; i++) run2.step()
      expect(stateHash(run2.state)).toBe(stateHash(ref.state))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

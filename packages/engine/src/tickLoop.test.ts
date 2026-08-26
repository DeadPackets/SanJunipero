import { describe, it, expect, vi } from 'vitest'
import { openDb } from './db.js'
import { EventStore } from './eventStore.js'
import { genesisState } from './state.js'
import { RngStreams } from './rng.js'
import { TickLoop } from './tickLoop.js'
import { replayFromGenesis, replayLatest } from './replay.js'
import { DEFAULT_CONFIG, SimConfigSchema, stateHash } from '@sj/shared'

function loop(onTick: ConstructorParameters<typeof TickLoop>[0]['onTick'], snapshotEveryTicks = 60) {
  const store = new EventStore(openDb(':memory:'))
  return { store, loop: new TickLoop({ store, state: genesisState(DEFAULT_CONFIG), rng: new RngStreams('t'), onTick, snapshotEveryTicks }) }
}

describe('TickLoop', () => {
  it('step() advances tick and applies handler emissions to state', () => {
    const { loop: l } = loop(({ tick, emit }) => { if (tick === 1) emit('agent_spawned', { id: 'a1', name: 'a1', x: 0, y: 0, ageDays: 7300 }) })
    l.step()
    expect(l.tick).toBe(1)
    expect(l.state.agents.a1).toBeDefined()
  })
  it('events land in the store in order', () => {
    const { store, loop: l } = loop(({ tick, emit }) => { if (tick === 1) emit('agent_spawned', { id: 'a1', name: 'a1', x: 0, y: 0, ageDays: 7300 }) })
    l.step(); l.step()
    expect(store.readFrom(0).map(e => e.type)).toEqual(['tick_advanced', 'agent_spawned', 'tick_advanced'])
  })
  it('snapshots every N ticks and replayLatest matches live state', () => {
    const { store, loop: l } = loop(({ tick, emit }) => { if (tick % 2 === 1) emit('agent_spawned', { id: `a${tick}`, name: `a${tick}`, x: tick, y: 0, ageDays: 7300 }) }, 5)
    for (let i = 0; i < 12; i++) l.step()
    expect(store.latestSnapshot()!.tick).toBe(10)
    expect(stateHash(replayLatest(store).state)).toBe(stateHash(l.state))
  })
  it('restores tick and state when the transaction throws, and can step again', () => {
    let thrown = false
    const { store, loop: l } = loop(({ tick, emit }) => {
      emit('agent_spawned', { id: `a${tick}`, name: `a${tick}`, x: tick, y: 0, ageDays: 7300 })
      if (tick === 3 && !thrown) { thrown = true; throw new Error('boom') }
    })
    l.step(); l.step()
    const preTick = l.tick
    const preHash = stateHash(l.state)
    const preSeq = store.lastSeq()
    expect(() => l.step()).toThrow('boom')
    expect(l.tick).toBe(2)
    expect(l.tick).toBe(preTick)
    expect(stateHash(l.state)).toBe(preHash)
    expect(store.lastSeq()).toBe(preSeq)
    l.step()
    expect(l.tick).toBe(3)
    expect(stateHash(replayLatest(store).state)).toBe(stateHash(l.state))
  })
  it('rolls the streams back with the state, so the retry draws the number the throw ate', () => {
    const rng = new RngStreams('t')
    const draws: number[] = []
    let boom = true
    const store = new EventStore(openDb(':memory:'))
    const l = new TickLoop({
      store, state: genesisState(DEFAULT_CONFIG), rng,
      onTick: ({ tick, emit }) => {
        draws.push(rng.get('health').next())
        emit('agent_spawned', { id: `a${tick}`, name: `a${tick}`, x: 0, y: 0, ageDays: 7300 })
        if (boom) { boom = false; throw new Error('boom') }
      },
    })
    const pre = rng.snapshot()
    expect(() => l.step()).toThrow('boom')
    expect(rng.snapshot()).toEqual(pre)
    l.step()
    expect(draws).toHaveLength(2)
    expect(draws[1]).toBe(draws[0])
  })

  it('a throw inside the running loop clears the timer, reports via onError, and start() works again', () => {
    vi.useFakeTimers()
    try {
      let boom = true
      const errors: unknown[] = []
      const store = new EventStore(openDb(':memory:'))
      const l = new TickLoop({
        store, state: genesisState(DEFAULT_CONFIG), rng: new RngStreams('t'), realMsPerTick: 10,
        onTick: () => { if (boom) throw new Error('boom') },
        onError: (err) => { errors.push(err) },
      })
      l.start()
      vi.advanceTimersByTime(10)
      expect(errors).toHaveLength(1)
      expect(l.tick).toBe(0)
      vi.advanceTimersByTime(100)
      expect(l.tick).toBe(0) // loop stopped, no zombie timer
      boom = false
      l.start() // must not be a silent no-op on a stale timer handle
      vi.advanceTimersByTime(10)
      expect(l.tick).toBe(1)
    } finally { vi.useRealTimers() }
  })
  it('without onError the loop error rethrows, and start() still works again', () => {
    vi.useFakeTimers()
    try {
      let boom = true
      const store = new EventStore(openDb(':memory:'))
      const l = new TickLoop({
        store, state: genesisState(DEFAULT_CONFIG), rng: new RngStreams('t'), realMsPerTick: 10,
        onTick: () => { if (boom) throw new Error('boom') },
      })
      l.start()
      expect(() => vi.advanceTimersByTime(10)).toThrow('boom')
      expect(l.tick).toBe(0)
      boom = false
      l.start()
      vi.advanceTimersByTime(10)
      expect(l.tick).toBe(1)
    } finally { vi.useRealTimers() }
  })
  it('threads a custom SimConfig through fold, and replay with that config matches live', () => {
    const custom = SimConfigSchema.parse({ health: { maxHp: 50 } })
    const store = new EventStore(openDb(':memory:'))
    const l = new TickLoop({
      store, state: genesisState(custom), rng: new RngStreams('cfg'), config: custom,
      onTick: ({ tick, emit }) => { if (tick === 1) emit('agent_spawned', { id: 'a1', name: 'a1', x: 0, y: 0, ageDays: 7300 }) },
    })
    for (let i = 0; i < 10; i++) l.step()
    expect(l.state.agents.a1!.hp).toBe(50)
    expect(stateHash(replayFromGenesis(store, custom))).toBe(stateHash(l.state))
  })
})

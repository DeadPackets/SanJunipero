import { describe, it, expect } from 'vitest'
import { openDb } from './db.js'
import { EventStore } from './eventStore.js'

function store() {
  return new EventStore(openDb(':memory:'))
}

describe('EventStore', () => {
  it('appends with monotonic seq starting at 1', () => {
    const s = store()
    expect(s.append(0, 'a', { x: 1 }).seq).toBe(1)
    expect(s.append(0, 'b', null).seq).toBe(2)
    expect(s.lastSeq()).toBe(2)
  })
  it('readFrom returns events after the given seq, parsed', () => {
    const s = store()
    s.append(0, 'a', { x: 1 })
    s.append(1, 'b', [1, 2])
    const evs = s.readFrom(1)
    expect(evs).toHaveLength(1)
    expect(evs[0]).toMatchObject({ seq: 2, tick: 1, type: 'b', payload: [1, 2] })
  })
  it('snapshot round-trips state and rng', () => {
    const s = store()
    s.append(0, 'a', null)
    s.saveSnapshot(60, 1, { world: true }, { weather: [1, 2, 3, 4] })
    const snap = s.latestSnapshot()!
    expect(snap).toMatchObject({ tick: 60, seq: 1, state: { world: true } })
    expect(snap.rng.weather).toEqual([1, 2, 3, 4])
  })
  it('latestSnapshot returns the newest', () => {
    const s = store()
    s.saveSnapshot(60, 0, { v: 1 }, {})
    s.saveSnapshot(120, 0, { v: 2 }, {})
    expect((s.latestSnapshot()!.state as { v: number }).v).toBe(2)
  })
})

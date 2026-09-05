import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, vi } from 'vitest'
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
  it('readTypeFrom returns only the events of that type, after the given seq', () => {
    const s = store()
    s.append(0, 'a', { x: 1 })
    s.append(1, 'b', { x: 2 })
    s.append(2, 'a', { x: 3 })
    expect(s.readTypeFrom(0, 'a').map((e) => e.seq)).toEqual([1, 3])
    expect(s.readTypeFrom(1, 'a').map((e) => e.seq)).toEqual([3])
    expect(s.readTypeFrom(0, 'c')).toEqual([])
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

describe('EventStore WAL checkpointer', () => {
  it('takes the autocheckpoint off COMMIT and checkpoints on its own timer until close', () => {
    vi.useFakeTimers()
    const dir = mkdtempSync(join(tmpdir(), 'sj-store-'))
    const db = openDb(join(dir, 'world.db'))
    try {
      const s = new EventStore(db)
      expect(db.pragma('wal_autocheckpoint', { simple: true })).toBe(0)
      expect(vi.getTimerCount()).toBe(1)

      const pragma = vi.spyOn(db, 'pragma')
      vi.advanceTimersByTime(5_000)
      expect(pragma).toHaveBeenCalledWith('wal_checkpoint(PASSIVE)')

      s.close()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      db.close()
      rmSync(dir, { recursive: true, force: true })
      vi.useRealTimers()
    }
  })

  it('leaves a journal that is not WAL alone', () => {
    vi.useFakeTimers()
    try {
      const s = new EventStore(openDb(':memory:'))
      expect(vi.getTimerCount()).toBe(0)
      s.close()
    } finally {
      vi.useRealTimers()
    }
  })
})

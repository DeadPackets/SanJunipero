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
  it('★ pruneType drops only the named type before the tick, oldest first, at most limit rows', () => {
    const s = store()
    for (let tick = 0; tick < 6; tick++) {
      s.append(tick, 'needs_changed', { tick })
      s.append(tick, 'agent_spoke', { tick })
    }
    expect(s.pruneType('needs_changed', 4, 2)).toBe(2)
    expect(s.readTypeFrom(0, 'needs_changed').map((e) => e.tick)).toEqual([2, 3, 4, 5])
    expect(s.pruneType('needs_changed', 4)).toBe(2)
    expect(s.readTypeFrom(0, 'needs_changed').map((e) => e.tick)).toEqual([4, 5])
    expect(s.readTypeFrom(0, 'agent_spoke')).toHaveLength(6)
    expect(s.lastSeq()).toBe(12)
  })
  it('★ pruneSnapshots keeps the boundary ones and everything newer', () => {
    const db = openDb(':memory:')
    const s = new EventStore(db)
    for (const tick of [60, 120, 1440, 1500, 2880, 2940]) s.saveSnapshot(tick, tick, {}, {})
    expect(s.pruneSnapshots(2880, 1440)).toBe(3)
    const left = db
      .prepare('SELECT tick FROM snapshots ORDER BY tick')
      .all()
      .map((r) => (r as { tick: number }).tick)
    expect(left).toEqual([1440, 2880, 2940])
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

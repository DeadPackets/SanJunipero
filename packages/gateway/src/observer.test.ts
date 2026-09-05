import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  UNWEIGHED_IMPORTANCE,
  ensureObserverTables,
  publishThought,
  thoughtsSince,
} from './observer.js'

describe('observer thought feed', () => {
  it('publishes and reads thoughts in id order', () => {
    const db = new Database(':memory:')
    ensureObserverTables(db)
    ensureObserverTables(db) // idempotent

    publishThought(db, {
      tick: 10,
      agentId: 'farmer',
      text: 'This earth wants turning.',
      importance: 4,
    })
    publishThought(db, {
      tick: 11,
      agentId: 'fisher',
      text: 'The river owes me a dinner.',
      importance: 7,
    })
    publishThought(db, {
      tick: 12,
      agentId: 'farmer',
      text: 'Wheat in, before the season slips.',
      importance: 6,
    })

    const all = thoughtsSince(db, 0)
    expect(all).toHaveLength(3)
    expect(all.map((t) => t.id)).toEqual([1, 2, 3])
    expect(all[0]).toEqual({
      id: 1,
      tick: 10,
      agentId: 'farmer',
      text: 'This earth wants turning.',
      importance: 4,
    })

    expect(thoughtsSince(db, 2)).toHaveLength(1)
    expect(thoughtsSince(db, 2)[0]!.text).toBe('Wheat in, before the season slips.')
    db.close()
  })

  // ★ Every thought is STORED whatever it weighs — the gate is over the head, not on the disk.
  it('★ keeps the light ones too, and hands back what the mind weighed them at', () => {
    const db = new Database(':memory:')
    ensureObserverTables(db)
    publishThought(db, { tick: 1, agentId: 'omar', text: 'Rain again.', importance: 1 })
    publishThought(db, { tick: 2, agentId: 'omar', text: 'The wall is done.', importance: 10 })
    expect(thoughtsSince(db, 0).map((t) => t.importance)).toEqual([1, 10])
    db.close()
  })

  // ★ A publisher with nothing to say about weight gets the middle: stored, and below the gate.
  it('★ gives an unweighed thought the middle rather than a wisp', () => {
    const db = new Database(':memory:')
    ensureObserverTables(db)
    publishThought(db, { tick: 3, agentId: 'mock', text: 'Hm.' })
    expect(thoughtsSince(db, 0)[0]!.importance).toBe(UNWEIGHED_IMPORTANCE)
    expect(UNWEIGHED_IMPORTANCE).toBeLessThan(6)
    db.close()
  })

  // ★ The live town's db is older than this column, and it is not re-created on the way in.
  it('★ adds the column to a table that was written before there was one', () => {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE observer_thoughts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tick INTEGER NOT NULL, agent_id TEXT NOT NULL, text TEXT NOT NULL
    )`)
    db.prepare('INSERT INTO observer_thoughts (tick, agent_id, text) VALUES (?, ?, ?)').run(
      9,
      'leyla',
      'Before the gate.',
    )
    ensureObserverTables(db)
    expect(thoughtsSince(db, 0)[0]!.importance).toBe(UNWEIGHED_IMPORTANCE)
    publishThought(db, { tick: 10, agentId: 'leyla', text: 'After it.', importance: 8 })
    expect(thoughtsSince(db, 1)[0]!.importance).toBe(8)
    db.close()
  })
})

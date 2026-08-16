import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { ensureObserverTables, latestThought, publishThought, thoughtsSince } from './observer.js'

describe('observer thought feed', () => {
  it('publishes and reads thoughts in id order', () => {
    const db = new Database(':memory:')
    ensureObserverTables(db)
    ensureObserverTables(db) // idempotent

    publishThought(db, { tick: 10, agentId: 'farmer', text: 'This earth wants turning.' })
    publishThought(db, { tick: 11, agentId: 'fisher', text: 'The river owes me a dinner.' })
    publishThought(db, { tick: 12, agentId: 'farmer', text: 'Wheat in, before the season slips.' })

    const all = thoughtsSince(db, 0)
    expect(all).toHaveLength(3)
    expect(all.map(t => t.id)).toEqual([1, 2, 3])
    expect(all[0]).toEqual({ id: 1, tick: 10, agentId: 'farmer', text: 'This earth wants turning.' })

    expect(thoughtsSince(db, 2)).toHaveLength(1)
    expect(thoughtsSince(db, 2)[0]!.text).toBe('Wheat in, before the season slips.')

    expect(latestThought(db, 'farmer')).toEqual({ tick: 12, text: 'Wheat in, before the season slips.' })
    expect(latestThought(db, 'fisher')).toEqual({ tick: 11, text: 'The river owes me a dinner.' })
    expect(latestThought(db, 'ghost')).toBeNull()
    db.close()
  })
})

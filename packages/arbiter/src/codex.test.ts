import { describe, expect, it } from 'vitest'
import { openArbiterDb } from './schema.js'
import { CodexStore, type CodexEntry } from './codex.js'
import { CANON } from './canon.js'
import { FORBIDDEN_FRAMING } from '@sj/shared'

const LADDER: CodexEntry[] = [
  { id: 'fire', era: 'handwork', name: 'Fire', prerequisiteId: null },
  { id: 'pottery', era: 'handwork', name: 'Pottery', prerequisiteId: null },
  { id: 'charcoal', era: 'arrangement', name: 'Charcoal', prerequisiteId: 'fire' },
  { id: 'copper_smelting', era: 'machinery', name: 'Copper smelting', prerequisiteId: 'charcoal' },
]

function seededStore(): CodexStore {
  const db = openArbiterDb(':memory:')
  const store = new CodexStore(db)
  for (const entry of LADDER) store.insert(entry)
  return store
}

describe('codex', () => {
  it('known() returns every id; knownEra() is the furthest rung', () => {
    const store = seededStore()
    expect(store.known()).toEqual(['fire', 'pottery', 'charcoal', 'copper_smelting'])
    expect(store.knownEra()).toBe('machinery')
  })

  it('knownEra() defaults to handwork when empty', () => {
    const store = new CodexStore(openArbiterDb(':memory:'))
    expect(store.knownEra()).toBe('handwork')
  })

  it('withinAdjacency accepts known ids', () => {
    const store = seededStore()
    expect(store.withinAdjacency(['fire'])).toBe(true)
    expect(store.withinAdjacency(['charcoal'])).toBe(true)
  })

  it('withinAdjacency grants one step beyond: an unearned authored id whose prerequisite is known', () => {
    const store = seededStore()
    expect(store.withinAdjacency(['iron_smelting'])).toBe(false)
    store.insert({ id: 'iron_smelting', era: 'machinery', name: 'Iron smelting', prerequisiteId: 'charcoal', known: false })
    // Not yet known — but reachable from a practiced craft.
    expect(store.known()).not.toContain('iron_smelting')
    expect(store.withinAdjacency(['iron_smelting'])).toBe(true)
  })

  it('withinAdjacency rejects an unearned authored id whose prerequisite is also unearned', () => {
    const store = seededStore()
    store.insert({ id: 'iron_smelting', era: 'machinery', name: 'Iron smelting', prerequisiteId: 'charcoal', known: false })
    store.insert({ id: 'steel', era: 'machinery', name: 'Steel', prerequisiteId: 'iron_smelting', known: false })
    expect(store.withinAdjacency(['steel'])).toBe(false)
  })

  it('withinAdjacency rejects an unauthored unknown id', () => {
    const store = seededStore()
    expect(store.withinAdjacency(['gunpowder'])).toBe(false)
  })

  it('knownEra ignores unearned authored rows', () => {
    const store = seededStore()
    store.insert({ id: 'iron_smelting', era: 'works', name: 'Iron smelting', prerequisiteId: 'charcoal', known: false })
    expect(store.knownEra()).toBe('machinery')
  })

  it('withinAdjacency rejects the empty canon', () => {
    const store = seededStore()
    expect(store.withinAdjacency([])).toBe(false)
  })

  it('frontier() names every unearned rung withinAdjacency would accept, and nothing else', () => {
    const store = seededStore()
    expect(store.frontier()).toEqual([])
    store.insert({ id: 'iron_smelting', era: 'machinery', name: 'Iron smelting', prerequisiteId: 'charcoal', known: false })
    store.insert({ id: 'steel', era: 'machinery', name: 'Steel', prerequisiteId: 'iron_smelting', known: false })
    store.insert({ id: 'glazing', era: 'arrangement', name: 'Glazing', prerequisiteId: 'pottery', known: false })

    // Sorted, so the line it renders into is byte-stable for a given codex.
    expect(store.frontier()).toEqual(['glazing', 'iron_smelting'])
    for (const id of store.frontier()) expect(store.withinAdjacency([id])).toBe(true)
    // Two rungs out, already earned, and never authored are all off the frontier.
    expect(store.frontier()).not.toContain('steel')
    expect(store.frontier()).not.toContain('charcoal')
    expect(store.frontier()).not.toContain('gunpowder')
  })

  it('duplicate insert throws (PK)', () => {
    const store = seededStore()
    expect(() =>
      store.insert({ id: 'fire', era: 'handwork', name: 'Fire again', prerequisiteId: null }),
    ).toThrow(/UNIQUE constraint failed/)
  })
})

describe('codex known-column migration', () => {
  it('adds the known column (default 1) to a pre-existing codex table and keeps old rows behaving', async () => {
    const { openDb } = await import('@sj/engine')
    const sqliteVec = await import('sqlite-vec')
    const { migrateArbiterTables } = await import('./schema.js')

    const db = openDb(':memory:')
    sqliteVec.load(db)
    // Old-shape table, as shipped before the known/earned flag existed.
    db.exec(`CREATE TABLE codex (
      id TEXT PRIMARY KEY, era TEXT NOT NULL, name TEXT NOT NULL,
      prerequisite_id TEXT REFERENCES codex(id)
    );`)
    db.prepare('INSERT INTO codex (id, era, name, prerequisite_id) VALUES (?, ?, ?, ?)').run('fire', 'handwork', 'Fire', null)

    migrateArbiterTables(db)

    const store = new CodexStore(db)
    expect(store.known()).toEqual(['fire'])
    store.insert({ id: 'charcoal', era: 'arrangement', name: 'Charcoal', prerequisiteId: 'fire', known: false })
    expect(store.known()).toEqual(['fire'])
    expect(store.withinAdjacency(['charcoal'])).toBe(true)
  })
})

describe('CANON', () => {
  it('is fully diegetic — matches no FORBIDDEN_FRAMING tokens', () => {
    expect(CANON.length).toBeGreaterThan(0)
    expect(FORBIDDEN_FRAMING.test(CANON)).toBe(false)
  })
})

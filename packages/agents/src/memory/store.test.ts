import { describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openAgentDb } from './schema.js'
import { MemoryStore, type MemoryTags } from './store.js'
import { FakeEmbedder } from '../testutil/fakeEmbedder.js'

const TAGS: MemoryTags = {
  people: ['tamar'],
  place: 'storehouse',
  objects: ['grain sack'],
  topics: ['harvest'],
}

async function makeStore(agentId = 'tamar'): Promise<{ db: Database.Database; store: MemoryStore }> {
  const db = openAgentDb(':memory:')
  const store = new MemoryStore(db, agentId, await FakeEmbedder.create())
  return { db, store }
}

describe('MemoryStore round-trip', () => {
  it('insert -> getMemory returns byte-identical text, parsed tags, day = floor(tick/1440)', async () => {
    const { store } = await makeStore()
    const text = 'Carried the last grain sack into the storehouse before the rain.'
    const id = await store.insertMemory({ tick: 3000, kind: 'action', text, importance: 6, tags: TAGS })
    const row = store.getMemory(id)
    expect(row).not.toBeNull()
    expect(row!.text).toBe(text)
    expect(row!.tags).toEqual(TAGS)
    expect(row!.day).toBe(Math.floor(3000 / 1440))
    expect(row!.agentId).toBe('tamar')
    expect(row!.kind).toBe('action')
    expect(row!.importance).toBe(6)
    expect(row!.tick).toBe(3000)
  })

  it('memoriesOfDay returns only that day, in insert order', async () => {
    const { store } = await makeStore()
    const a = await store.insertMemory({ tick: 10, kind: 'thought', text: 'day zero', importance: 2, tags: TAGS })
    const b = await store.insertMemory({ tick: 20, kind: 'thought', text: 'day zero too', importance: 2, tags: TAGS })
    await store.insertMemory({ tick: 1500, kind: 'thought', text: 'day one', importance: 2, tags: TAGS })
    expect(store.memoriesOfDay(0).map((m) => m.id)).toEqual([a, b])
    expect(store.memoriesOfDay(1)).toHaveLength(1)
  })
})

describe('immutability triggers (law, not convention)', () => {
  it('raw UPDATE on memories throws /immutable/', async () => {
    const { db, store } = await makeStore()
    await store.insertMemory({ tick: 1, kind: 'perception', text: 'unchangeable', importance: 3, tags: TAGS })
    expect(() => db.prepare("UPDATE memories SET text = 'rewritten'").run()).toThrow(/immutable/)
  })

  it('raw DELETE on memories throws /immutable/', async () => {
    const { db, store } = await makeStore()
    await store.insertMemory({ tick: 1, kind: 'perception', text: 'undeletable', importance: 3, tags: TAGS })
    expect(() => db.prepare('DELETE FROM memories').run()).toThrow(/immutable/)
  })
})

describe('agent fencing (cross-agent retrieval structurally impossible)', () => {
  it('another agent store sees null / empty everywhere', async () => {
    const { db, store: tamar } = await makeStore()
    const idByTamar = await tamar.insertMemory({
      tick: 100,
      kind: 'journal',
      text: 'private thought',
      importance: 8,
      tags: TAGS,
    })
    tamar.insertFact({ day: 0, subject: 'omar', predicate: 'lives_at', object: 'mill', srcMemoryId: idByTamar })
    tamar.insertJournal(100, 0, 'dear diary')

    const omar = new MemoryStore(db, 'omar', await FakeEmbedder.create())
    expect(omar.getMemory(idByTamar)).toBeNull()
    expect(omar.memoriesOfDay(0)).toEqual([])
    expect(omar.factsAbout('omar')).toEqual([])
    expect(omar.journalEntries()).toEqual([])
  })
})

describe('FTS5 external content', () => {
  it('MATCH finds the inserted row by rowid', async () => {
    const { db, store } = await makeStore()
    const id = await store.insertMemory({
      tick: 5,
      kind: 'perception',
      text: 'The storehouse door creaked in the wind.',
      importance: 4,
      tags: TAGS,
    })
    const rows = db
      .prepare("SELECT rowid FROM memories_fts WHERE memories_fts MATCH 'storehouse'")
      .all() as Array<{ rowid: number }>
    expect(rows.map((r) => r.rowid)).toContain(id)
  })
})

describe('sqlite-vec KNN', () => {
  it('same text embedding returns the row first with distance ~ 0', async () => {
    const { db, store } = await makeStore()
    const embedder = await FakeEmbedder.create()
    const text = 'fishing at the river fork'
    const id = await store.insertMemory({ tick: 7, kind: 'action', text, importance: 5, tags: TAGS })
    await store.insertMemory({ tick: 8, kind: 'action', text: 'a funeral in deep winter snow', importance: 5, tags: TAGS })
    await store.insertMemory({ tick: 9, kind: 'action', text: 'baking bread at dawn', importance: 5, tags: TAGS })
    const q = await embedder.embed(text)
    const rows = db
      .prepare('SELECT rowid, distance FROM memory_vec WHERE embedding MATCH ? AND k = 3')
      .all(Buffer.from(q.buffer, q.byteOffset, q.byteLength)) as Array<{ rowid: number; distance: number }>
    expect(rows).toHaveLength(3)
    expect(rows[0]!.rowid).toBe(id)
    expect(rows[0]!.distance).toBeCloseTo(0, 4)
  })
})

describe('ledgers', () => {
  it('upsert overwrites the doc and bumps updatedDay', async () => {
    const { store } = await makeStore()
    store.upsertLedger('omar', 'Omar helped with the harvest. [mem#12]', 3)
    store.upsertLedger('omar', 'Omar helped, then argued about the grain split. [mem#12][mem#19]', 5)
    expect(store.getLedger('omar')).toEqual({
      doc: 'Omar helped, then argued about the grain split. [mem#12][mem#19]',
      updatedDay: 5,
    })
    expect(store.getLedger('nobody')).toBeNull()
  })
})

describe('facts, summaries, journal, autobiography, miss log', () => {
  it('facts round-trip fenced by agent and filtered by subject', async () => {
    const { store } = await makeStore()
    const memId = await store.insertMemory({ tick: 1, kind: 'thought', text: 'src', importance: 1, tags: TAGS })
    store.insertFact({ day: 2, subject: 'omar', predicate: 'owns', object: 'boat', srcMemoryId: memId })
    store.insertFact({ day: 2, subject: 'noa', predicate: 'owns', object: 'loom', srcMemoryId: memId })
    const facts = store.factsAbout('omar')
    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({
      agentId: 'tamar',
      day: 2,
      subject: 'omar',
      predicate: 'owns',
      object: 'boat',
      srcMemoryId: memId,
    })
  })

  it('summary nodes round-trip with parsed id arrays and level/day filters', async () => {
    const { store } = await makeStore()
    const id = store.insertSummaryNode({
      level: 'day',
      day: 4,
      title: 'Day of the flood',
      text: 'The river rose past the fork.',
      childIds: [1, 2],
      memoryIds: [10, 11, 12],
    })
    const nodes = store.summaryNodes('day', 4)
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({ id, level: 'day', day: 4, childIds: [1, 2], memoryIds: [10, 11, 12] })
    expect(store.summaryNodes('era')).toEqual([])
    expect(store.summaryNodes('day', 5)).toEqual([])
  })

  it('journal entries round-trip in order', async () => {
    const { store } = await makeStore()
    store.insertJournal(100, 0, 'first entry')
    store.insertJournal(1500, 1, 'second entry')
    expect(store.journalEntries()).toEqual([
      { tick: 100, day: 0, text: 'first entry' },
      { tick: 1500, day: 1, text: 'second entry' },
    ])
  })

  it('autobiography appends and reads back paragraphs in order', async () => {
    const { store } = await makeStore()
    store.appendAutobiography(1, 'I was born by the river.')
    store.appendAutobiography(9, 'The flood changed everything.')
    expect(store.autobiography()).toEqual(['I was born by the river.', 'The flood changed everything.'])
  })

  it('logMiss records fenced rows including null topScore', async () => {
    const { db, store } = await makeStore()
    store.logMiss({ tick: 42, query: 'where is my axe', mode: 'recall', topScore: null, resultCount: 0 })
    store.logMiss({ tick: 43, query: 'rain', mode: 'ambient', topScore: 0.61, resultCount: 2 })
    const rows = db
      .prepare('SELECT agent_id, tick, query, mode, top_score, result_count FROM recall_misses ORDER BY id')
      .all() as Array<Record<string, unknown>>
    expect(rows).toEqual([
      { agent_id: 'tamar', tick: 42, query: 'where is my axe', mode: 'recall', top_score: null, result_count: 0 },
      { agent_id: 'tamar', tick: 43, query: 'rain', mode: 'ambient', top_score: 0.61, result_count: 2 },
    ])
  })
})

describe('schema', () => {
  it('migrateAgentTables is idempotent via openAgentDb re-migration', () => {
    const db = openAgentDb(':memory:')
    expect(() => openAgentDb(':memory:')).not.toThrow()
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','trigger') ORDER BY name")
      .all() as Array<{ name: string }>
    const names = tables.map((t) => t.name)
    for (const t of [
      'memories',
      'memory_tags',
      'facts',
      'ledgers',
      'summary_nodes',
      'journal',
      'autobiography',
      'recall_misses',
      'memories_no_update',
      'memories_no_delete',
    ]) {
      expect(names).toContain(t)
    }
  })
})

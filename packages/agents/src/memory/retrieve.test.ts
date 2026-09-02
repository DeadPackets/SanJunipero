import { describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openAgentDb } from './schema.js'
import { MemoryStore, type MemoryTags } from './store.js'
import { FakeEmbedder } from '@sj/llm/testutil'
import {
  DEFAULT_WEIGHTS,
  MISS_MIN_RESULTS,
  MISS_TOP_SCORE,
  cuesToQuery,
  keywords,
  retrieveAmbient,
  retrieveRecall,
} from './retrieve.js'

const TICKS_PER_DAY = 1440

const EMPTY_TAGS: MemoryTags = { people: [], place: null, objects: [], topics: [] }

async function makeStore(
  agentId = 'tamar',
): Promise<{ db: Database.Database; store: MemoryStore }> {
  const db = openAgentDb(':memory:')
  const store = new MemoryStore(db, agentId, await FakeEmbedder.create())
  return { db, store }
}

describe('keywords and cuesToQuery', () => {
  it('lowercases, drops stopwords, de-dupes, and caps at max', () => {
    expect(keywords('The Mill and the MILL wheel turned all night')).toEqual([
      'mill',
      'wheel',
      'turned',
      'all',
      'night',
    ])
    expect(keywords('the and or', 6)).toEqual([])
    expect(keywords('a b c d e f g h')).toEqual(['b', 'c', 'd', 'e', 'f', 'g'])
  })

  it('cuesToQuery joins people + place + topics by spaces', () => {
    expect(
      cuesToQuery({ people: ['yusuf', 'omar'], place: 'storehouse', topics: ['firewood'] }),
    ).toBe('yusuf omar storehouse firewood')
    expect(cuesToQuery({ people: ['yusuf'], place: null, topics: [] })).toBe('yusuf')
  })
})

describe('hybrid retrieval', () => {
  it('ranks an exact tag cue above a text-only match with identical wording', async () => {
    const { store } = await makeStore()
    const now = 5 * TICKS_PER_DAY
    const text = 'yusuf came to the storehouse with a grain sack'
    const tagged = await store.insertMemory({
      tick: now - 10,
      kind: 'perception',
      text,
      importance: 5,
      tags: { people: ['yusuf'], place: 'storehouse', objects: [], topics: [] },
    })
    const untagged = await store.insertMemory({
      tick: now - 10,
      kind: 'perception',
      text,
      importance: 5,
      tags: EMPTY_TAGS,
    })
    const results = await retrieveAmbient(
      store,
      { people: ['yusuf'], place: null, topics: [] },
      now,
    )
    const ids = results.map((r) => r.id)
    expect(ids.indexOf(tagged)).toBeGreaterThanOrEqual(0)
    expect(ids.indexOf(untagged)).toBeGreaterThanOrEqual(0)
    expect(ids.indexOf(tagged)).toBeLessThan(ids.indexOf(untagged))
  })

  it('ranks the memory containing both query words first, parts sum to score', async () => {
    const { store } = await makeStore()
    const now = 6 * TICKS_PER_DAY
    const distractors = [
      'the mill wheel creaked all night',
      'baking bread at dawn before the rain',
      'a funeral in deep winter snow',
      'the storehouse door swung in the wind',
      'planting seeds along the river fork',
      'mending a torn fishing net',
      'carrying water up the hill',
      'the children sang by the fire',
      'trading grain at the market',
      'the flock scattered in the storm',
      'firewood stacked by the shed',
      'a debt of salt between neighbors',
      'the old man told stories of the flood',
      'weaving wool into a warm cloak',
      'the river rose past the fork',
      'hunting deer at the treeline',
      'the well went dry in the heat',
      'pickling vegetables for the winter',
      'the goat escaped the pen again',
    ]
    for (let i = 0; i < distractors.length; i += 1) {
      await store.insertMemory({
        tick: i * 100 + 10,
        kind: 'thought',
        text: distractors[i]!,
        importance: 5,
        tags: EMPTY_TAGS,
      })
    }
    const targetText = 'yusuf demanded a firewood debt be repaid'
    const target = await store.insertMemory({
      tick: now - 5,
      kind: 'speech_heard',
      text: targetText,
      importance: 5,
      tags: { people: ['yusuf'], place: null, objects: [], topics: ['debt'] },
    })
    const results = await retrieveAmbient(
      store,
      { people: [], place: null, topics: ['firewood', 'debt'] },
      now,
    )
    expect(results[0]!.id).toBe(target)

    const top = results[0]!
    const expected =
      DEFAULT_WEIGHTS.tag * top.parts.tag +
      DEFAULT_WEIGHTS.bm25 * top.parts.bm25 +
      DEFAULT_WEIGHTS.cosine * top.parts.cosine +
      DEFAULT_WEIGHTS.recency * top.parts.recency +
      DEFAULT_WEIGHTS.importance * top.parts.importance
    expect(top.score).toBeCloseTo(expected, 9)

    // parts follow the exact scoring formulas
    const queryTags = keywords('firewood debt')
    const memoryTags = new Set(['yusuf', 'debt'])
    const expectedTag = Math.min(3, [...memoryTags].filter((t) => queryTags.includes(t)).length)
    expect(top.parts.tag).toBe(expectedTag)
    expect(top.parts.importance).toBe(5)
    expect(top.parts.recency).toBeCloseTo(0.5 ** ((now - top.tick) / TICKS_PER_DAY / (2 * 5)), 12)
    expect(top.parts.bm25).toBeGreaterThanOrEqual(0)
    expect(top.parts.bm25).toBeLessThan(1)
    expect(top.parts.cosine).toBeGreaterThanOrEqual(-1)
    expect(top.parts.cosine).toBeLessThanOrEqual(1)
  })

  it('recency: identical text importance-5, tick 0 vs now → newer wins', async () => {
    const { store } = await makeStore()
    const text = 'the mill wheel turned all night'
    const now = 10 * TICKS_PER_DAY
    const old = await store.insertMemory({
      tick: 0,
      kind: 'perception',
      text,
      importance: 5,
      tags: EMPTY_TAGS,
    })
    const newer = await store.insertMemory({
      tick: now,
      kind: 'perception',
      text,
      importance: 5,
      tags: EMPTY_TAGS,
    })
    const results = await retrieveAmbient(
      store,
      { people: [], place: null, topics: keywords(text) },
      now,
    )
    const ids = results.map((r) => r.id)
    expect(ids.indexOf(newer)).toBeLessThan(ids.indexOf(old))
  })

  it('recency tradeoff: importance-10 @ day-30 old outranks importance-1 @ day-1 (formula)', async () => {
    const { store } = await makeStore()
    const text = 'the floodwaters reached the old mill'
    const now = 31 * TICKS_PER_DAY
    const oldHi = await store.insertMemory({
      tick: 1 * TICKS_PER_DAY,
      kind: 'perception',
      text,
      importance: 10,
      tags: EMPTY_TAGS,
    })
    const recentLo = await store.insertMemory({
      tick: 30 * TICKS_PER_DAY,
      kind: 'perception',
      text,
      importance: 1,
      tags: EMPTY_TAGS,
    })
    const results = await retrieveAmbient(
      store,
      { people: [], place: null, topics: keywords(text) },
      now,
    )
    const ids = results.map((r) => r.id)
    expect(ids.indexOf(oldHi)).toBeLessThan(ids.indexOf(recentLo))

    const oldRow = results.find((r) => r.id === oldHi)!
    const recentRow = results.find((r) => r.id === recentLo)!
    expect(oldRow.parts.recency).toBeCloseTo(0.5 ** (30 / (2 * 10)), 12)
    expect(recentRow.parts.recency).toBeCloseTo(0.5 ** (1 / (2 * 1)), 12)
    const oldContrib =
      DEFAULT_WEIGHTS.recency * oldRow.parts.recency +
      DEFAULT_WEIGHTS.importance * oldRow.parts.importance
    const recentContrib =
      DEFAULT_WEIGHTS.recency * recentRow.parts.recency +
      DEFAULT_WEIGHTS.importance * recentRow.parts.importance
    expect(oldContrib).toBeGreaterThan(recentContrib)
  })

  it('verbatim law: returned text strictly equals the inserted original', async () => {
    const { store } = await makeStore()
    const now = 3 * TICKS_PER_DAY
    const text = 'Yusuf demanded a firewood debt — "repay it before dusk!"'
    await store.insertMemory({
      tick: 1000,
      kind: 'speech_heard',
      text,
      importance: 7,
      tags: { people: ['yusuf'], place: null, objects: [], topics: ['firewood', 'debt'] },
    })
    const results = await retrieveAmbient(
      store,
      { people: [], place: null, topics: ['firewood', 'debt'] },
      now,
    )
    expect(results.length).toBeGreaterThan(0)
    const hit = results.find((r) => r.text === text)
    expect(hit).toBeDefined()
    expect(hit!.text).toBe(text)
  })

  it('miss-log: an empty store logs resultCount 0; a rich one logs nothing', async () => {
    const now = 2 * TICKS_PER_DAY

    const { db: emptyDb, store: emptyStore } = await makeStore('empty-agent')
    const emptyResults = await retrieveAmbient(
      emptyStore,
      { people: [], place: null, topics: ['firewood'] },
      now,
    )
    expect(emptyResults).toEqual([])
    const missRows = emptyDb
      .prepare('SELECT mode, result_count, top_score FROM recall_misses ORDER BY id')
      .all()
    expect(missRows).toEqual([{ mode: 'ambient', result_count: 0, top_score: null }])

    const { db: richDb, store: richStore } = await makeStore('rich-agent')
    await richStore.insertMemory({
      tick: now - 10,
      kind: 'perception',
      text: 'yusuf stacked firewood in the storehouse',
      importance: 8,
      tags: { people: ['yusuf'], place: 'storehouse', objects: [], topics: ['firewood'] },
    })
    await richStore.insertMemory({
      tick: now - 20,
      kind: 'perception',
      text: 'yusuf argued about the grain split',
      importance: 5,
      tags: { people: ['yusuf'], place: 'storehouse', objects: [], topics: ['grain'] },
    })
    await richStore.insertMemory({
      tick: now - 30,
      kind: 'perception',
      text: 'rain fell on the storehouse roof',
      importance: 4,
      tags: { people: [], place: 'storehouse', objects: [], topics: ['rain'] },
    })
    const richResults = await retrieveAmbient(
      richStore,
      { people: ['yusuf'], place: 'storehouse', topics: ['firewood'] },
      now,
    )
    expect(richResults.length).toBeGreaterThanOrEqual(MISS_MIN_RESULTS)
    expect(richResults[0]!.score).toBeGreaterThanOrEqual(MISS_TOP_SCORE)
    const missCount = richDb.prepare('SELECT COUNT(*) AS n FROM recall_misses').get() as {
      n: number
    }
    expect(missCount.n).toBe(0)
  })

  it("a deliberate cast back reaches the mind's own words, and its miss is logged as one", async () => {
    const now = 2 * TICKS_PER_DAY
    const { db, store } = await makeStore('caster')
    await store.insertMemory({
      tick: now - 900,
      kind: 'perception',
      text: 'the river took the footbridge in the night',
      importance: 9,
      tags: { people: [], place: 'river', objects: [], topics: ['flood'] },
    })

    const found = await retrieveRecall(store, 'the night the river rose', now)
    expect(found.map((r) => r.text)).toContain('the river took the footbridge in the night')

    const modes = db.prepare('SELECT mode, query FROM recall_misses ORDER BY id').all() as {
      mode: string
      query: string
    }[]
    expect(modes).toEqual([{ mode: 'recall', query: 'the night the river rose' }])
  })

  it('a cast back that finds nothing logs a recall miss with no results', async () => {
    const { db, store } = await makeStore('empty-caster')
    expect(await retrieveRecall(store, 'my mother', TICKS_PER_DAY)).toEqual([])
    expect(db.prepare('SELECT mode, result_count FROM recall_misses ORDER BY id').all()).toEqual([
      { mode: 'recall', result_count: 0 },
    ])
  })

  it('fencing: agent B never sees agent A rows', async () => {
    const db = openAgentDb(':memory:')
    const embedder = await FakeEmbedder.create()
    const alice = new MemoryStore(db, 'alice', embedder)
    const bob = new MemoryStore(db, 'bob', embedder)
    const now = 4 * TICKS_PER_DAY
    const aId = await alice.insertMemory({
      tick: now - 10,
      kind: 'perception',
      text: 'yusuf brought a firewood debt',
      importance: 5,
      tags: { people: ['yusuf'], place: null, objects: [], topics: ['firewood'] },
    })
    const bId = await bob.insertMemory({
      tick: now - 5,
      kind: 'perception',
      text: 'bob saw a red deer by the river',
      importance: 5,
      tags: { people: [], place: 'river', objects: [], topics: ['deer'] },
    })
    const results = await retrieveAmbient(
      bob,
      { people: ['yusuf'], place: null, topics: ['firewood'] },
      now,
    )
    const ids = results.map((r) => r.id)
    expect(ids).not.toContain(aId)
    expect(ids).toContain(bId)
    expect(results.every((r) => r.agentId === 'bob')).toBe(true)
  })

  it('fencing: dense foreign rows do not displace this agent vec candidates', async () => {
    const db = openAgentDb(':memory:')
    const embedder = await FakeEmbedder.create()
    const alice = new MemoryStore(db, 'alice', embedder)
    const bob = new MemoryStore(db, 'bob', embedder)
    const now = 4 * TICKS_PER_DAY
    const query = 'riverbed'
    // alice: 55 identical-text memories — distance-0 to the query, filling the unfenced vec top-50
    for (let i = 0; i < 55; i += 1) {
      await alice.insertMemory({
        tick: now - 10,
        kind: 'perception',
        text: query,
        importance: 5,
        tags: EMPTY_TAGS,
      })
    }
    // bob: one memory reachable only via vec (different text → no FTS/tag match for 'riverbed')
    const bId = await bob.insertMemory({
      tick: now - 5,
      kind: 'thought',
      text: "bob's private thought",
      importance: 5,
      tags: EMPTY_TAGS,
    })
    const results = await retrieveAmbient(bob, { people: [], place: null, topics: [query] }, now)
    const ids = results.map((r) => r.id)
    expect(ids).toContain(bId)
    expect(results).toHaveLength(1)
    expect(results.every((r) => r.agentId === 'bob')).toBe(true)
  })

  it('caps the tag pool, so a long-tagged history does not grow the candidate set', async () => {
    const { store } = await makeStore()
    const now = 400
    for (let i = 0; i < 300; i += 1) {
      await store.insertMemory({
        tick: i,
        kind: 'perception',
        text: `errand number ${i}`,
        importance: 5,
        tags: { people: ['yusuf'], place: null, objects: [], topics: [] },
      })
    }
    const inner = store.getMemories.bind(store)
    let candidateCount = 0
    store.getMemories = (ids: number[]) => {
      candidateCount = ids.length
      return inner(ids)
    }
    await retrieveAmbient(store, { people: ['yusuf'], place: null, topics: [] }, now)
    expect(candidateCount).toBeLessThanOrEqual(150)
  })
})

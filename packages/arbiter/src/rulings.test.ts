import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import { FakeEmbedder } from '@sj/llm/testutil'
import { openArbiterDb } from './schema.js'
import { RulingsStore } from './rulings.js'
import type { Verdict } from './verdict.js'

const DIM = 384

// The shared FakeEmbedder is sha256-based, so a rephrase can never clear the cosine bar. This
// bag-of-words one gives token-overlap similarity, exercising KNN → cosine with no live model.
const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'for',
  'by',
  'to',
  'of',
  'i',
  'try',
  'want',
  'attempt',
  'and',
  'with',
])

function unitVec(bytes: Uint8Array): Float32Array {
  const v = new Float32Array(DIM)
  let digest = Buffer.from(bytes)
  let i = 0
  while (i < DIM) {
    for (const b of digest) {
      if (i >= DIM) break
      v[i] = b / 127.5 - 1
      i += 1
    }
    digest = createHash('sha256').update(digest).digest()
  }
  let norm = 0
  for (const x of v) norm += x * x
  norm = Math.sqrt(norm)
  for (let j = 0; j < DIM; j += 1) v[j]! /= norm
  return v
}

class LexicalEmbedder {
  async embed(text: string): Promise<Float32Array> {
    const v = new Float32Array(DIM)
    for (const raw of text.toLowerCase().split(/\W+/)) {
      if (raw === '' || STOPWORDS.has(raw)) continue
      const stem = raw.replace(/(ing|ed|s)$/, '')
      const wv = unitVec(createHash('sha256').update(`w:${stem}`).digest())
      for (let j = 0; j < DIM; j += 1) v[j]! += wv[j]!
    }
    let norm = 0
    for (const x of v) norm += x * x
    norm = Math.sqrt(norm)
    if (norm > 0) for (let j = 0; j < DIM; j += 1) v[j]! /= norm
    return v
  }
}

function boilSaltVerdict(): Verdict {
  return {
    kind: 'attempt',
    recipe: {
      id: 'recipe:boil_salt',
      name: 'Boil Salt',
      durationTicks: 5,
      costs: [],
      requires: [{ type: 'adjacent_fire' }],
      outcomeTable: [
        {
          weight: 1,
          success: true,
          label: 'A crust of salt forms.',
          effects: [{ op: 'spawn_item', kind: 'salt', qty: 1, to: 'agent' }],
        },
      ],
      rngStream: 'recipe:boil_salt',
      canon: ['fire'],
    },
    summary: 'Boil river water until only salt remains.',
  }
}

function copperVerdict(): Verdict {
  return {
    kind: 'attempt',
    recipe: {
      id: 'recipe:copper',
      name: 'Smelt Copper',
      durationTicks: 8,
      costs: [],
      requires: [{ type: 'adjacent_fire' }],
      outcomeTable: [
        {
          weight: 1,
          success: true,
          label: 'Copper beads out of the ore.',
          effects: [{ op: 'spawn_item', kind: 'copper', qty: 1, to: 'agent' }],
        },
      ],
      rngStream: 'recipe:copper',
      canon: ['charcoal'],
    },
    summary: 'Heat ore until copper separates.',
  }
}

async function makeStore(embedder: {
  embed(t: string): Promise<Float32Array>
}): Promise<{ db: Database.Database; store: RulingsStore }> {
  const db = openArbiterDb(':memory:')
  return { db, store: new RulingsStore(db, embedder) }
}

describe('RulingsStore', () => {
  it('round-trips intentText, verdictJson, and tick', async () => {
    const { store } = await makeStore(await FakeEmbedder.create())
    const verdict = boilSaltVerdict()
    const id = await store.record('I try to boil river water for salt', verdict, 100)
    const row = store.get(id)
    expect(row).not.toBeNull()
    expect(row!.intentText).toBe('I try to boil river water for salt')
    expect(row!.verdictJson).toBe(JSON.stringify(verdict))
    expect(row!.tick).toBe(100)
  })

  it('is immutable: raw UPDATE and DELETE both throw /immutable/', async () => {
    const { db, store } = await makeStore(await FakeEmbedder.create())
    await store.record('I try to boil river water for salt', boilSaltVerdict(), 100)
    expect(() => db.prepare("UPDATE rulings SET intent_text='x'").run()).toThrow(/immutable/)
    expect(() => db.prepare('DELETE FROM rulings').run()).toThrow(/immutable/)
  })

  it('ranks the semantic nearest ruling first with cosine > 0.8', async () => {
    const { store } = await makeStore(new LexicalEmbedder())
    await store.record('boil river water for salt', boilSaltVerdict(), 100)
    await store.record('smelt copper from ore', copperVerdict(), 100)
    const results = await store.similar('extract salt by boiling river water')
    expect(results.length).toBe(2)
    expect(results[0]!.ruling.intentText).toBe('boil river water for salt')
    expect(results[0]!.cosine).toBeGreaterThan(0.8)
    expect(results[1]!.ruling.intentText).toBe('smelt copper from ore')
    expect(results[1]!.cosine).toBeLessThan(results[0]!.cosine)
  })

  it('returns the inserted original intent, not the normalized form', async () => {
    const { store } = await makeStore(await FakeEmbedder.create())
    const raw = '  I TRY TO   Boil River Water for Salt!!  '
    const id = await store.record(raw, boilSaltVerdict(), 7)
    const row = store.get(id)!
    expect(row.intentText).toBe(raw)
    expect(row.normalizedIntent).toBe('boil river water for salt')
    expect(row.intentText).not.toBe(row.normalizedIntent)
  })

  it('similar on an empty store returns []', async () => {
    const { store } = await makeStore(await FakeEmbedder.create())
    expect(await store.similar('anything at all')).toEqual([])
  })

  it('calls embed exactly once per record', async () => {
    const embedder = await FakeEmbedder.create()
    const spy = vi.spyOn(embedder, 'embed')
    const { store } = await makeStore(embedder)
    await store.record('I try to boil river water for salt', boilSaltVerdict(), 100)
    await store.record('smelt copper from ore', copperVerdict(), 101)
    expect(spy).toHaveBeenCalledTimes(2)
  })
})

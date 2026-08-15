import { describe, expect, it } from 'vitest'
import { openArbiterDb } from './schema.js'
import { CodexStore, type CodexEntry } from './codex.js'
import { CANON } from './canon.js'

// Mirrors FORBIDDEN_FRAMING in prompt.ts (kept as a local copy per the T4
// review chain — CANON must be fully diegetic, no meta-language leaks).
const FORBIDDEN_FRAMING =
  /\b(AI|A\.I\.|artificial intelligence|language models?|LLMs?|neural|prompts?|context windows?|tokens?|chatbots?|simulations?|models?|tools?)(?!\w)/i

const LADDER: CodexEntry[] = [
  { id: 'fire', era: 'agriculture', name: 'Fire', prerequisiteId: null },
  { id: 'pottery', era: 'agriculture', name: 'Pottery', prerequisiteId: null },
  { id: 'charcoal', era: 'crafts', name: 'Charcoal', prerequisiteId: 'fire' },
  { id: 'copper_smelting', era: 'metallurgy', name: 'Copper smelting', prerequisiteId: 'charcoal' },
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
    expect(store.knownEra()).toBe('metallurgy')
  })

  it('knownEra() defaults to agriculture when empty', () => {
    const store = new CodexStore(openArbiterDb(':memory:'))
    expect(store.knownEra()).toBe('agriculture')
  })

  it('withinAdjacency accepts known ids', () => {
    const store = seededStore()
    expect(store.withinAdjacency(['fire'])).toBe(true)
    expect(store.withinAdjacency(['charcoal'])).toBe(true)
  })

  it('withinAdjacency rejects unknown ids with unknown prerequisite, then accepts after insert', () => {
    const store = seededStore()
    expect(store.withinAdjacency(['iron_smelting'])).toBe(false)
    store.insert({ id: 'iron_smelting', era: 'metallurgy', name: 'Iron smelting', prerequisiteId: 'charcoal' })
    expect(store.withinAdjacency(['iron_smelting'])).toBe(true)
  })

  it('withinAdjacency rejects an unauthored unknown id', () => {
    const store = seededStore()
    expect(store.withinAdjacency(['gunpowder'])).toBe(false)
  })

  it('withinAdjacency rejects the empty canon', () => {
    const store = seededStore()
    expect(store.withinAdjacency([])).toBe(false)
  })

  it('duplicate insert throws (PK)', () => {
    const store = seededStore()
    expect(() =>
      store.insert({ id: 'fire', era: 'agriculture', name: 'Fire again', prerequisiteId: null }),
    ).toThrow(/UNIQUE constraint failed/)
  })
})

describe('CANON', () => {
  it('is fully diegetic — matches no FORBIDDEN_FRAMING tokens', () => {
    expect(CANON.length).toBeGreaterThan(0)
    expect(FORBIDDEN_FRAMING.test(CANON)).toBe(false)
  })
})

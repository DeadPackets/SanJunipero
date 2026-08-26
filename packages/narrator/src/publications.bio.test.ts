import { describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { openDb } from '@sj/engine'
import { migrateNarratorTables } from './schema.js'
import { NarratorStore } from './store.js'
import {
  PUBLIC_EVENT_TYPES,
  collectPublicRecord,
  publicRecordText,
  writeBiography,
} from './publications.js'
import type { NarratorLlm } from './types.js'

const memStore = (): NarratorStore => {
  const db = new Database(':memory:')
  migrateNarratorTables(db)
  return new NarratorStore(db)
}

const seedWorld = (): Database.Database => {
  const world = openDb(':memory:')
  const ins = world.prepare('INSERT INTO events (tick, type, payload) VALUES (?, ?, ?)')
  ins.run(
    100,
    'agent_spoke',
    JSON.stringify({ agentId: 'tamar', text: 'The river turns.', x: 1, y: 1 }),
  )
  ins.run(200, 'action_completed', JSON.stringify({ agentId: 'tamar', verb: 'eat' }))
  ins.run(300, 'agent_spoke', JSON.stringify({ agentId: 'omar', text: 'Not tamar.', x: 2, y: 2 }))
  // a private journal row the biography must never see
  world.exec(`CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT, agent_id TEXT NOT NULL, tick INTEGER NOT NULL,
    day INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, importance REAL, tags TEXT)`)
  world
    .prepare('INSERT INTO memories (agent_id, tick, day, kind, text) VALUES (?, ?, ?, ?, ?)')
    .run('tamar', 150, 0, 'journal', 'I secretly despise the council.')
  return world
}

const bioLlm = (body: string): NarratorLlm => ({
  summarizeChapter: vi.fn(),
  summarizeEra: vi.fn(),
  newspaperCopy: vi.fn(),
  biography: vi.fn(async () => ({ title: 'Tamar of the Riverbend', body })),
})

const bioLlmSeq = (bodies: string[]): NarratorLlm => {
  let i = 0
  return {
    summarizeChapter: vi.fn(),
    summarizeEra: vi.fn(),
    newspaperCopy: vi.fn(),
    biography: vi.fn(async () => ({
      title: 'Tamar of the Riverbend',
      body: bodies[Math.min(i++, bodies.length - 1)]!,
    })),
  }
}

describe('collectPublicRecord', () => {
  it('returns only public events of the agent, never memories/journal content', () => {
    const world = seedWorld()
    const record = collectPublicRecord(world, 'tamar', 0)
    expect(record.length).toBe(2)
    expect(record[0]!.text).toContain('The river turns.')
    expect(record[1]!.text).toContain('eat')
    expect(record.some((r) => r.text.includes('secretly'))).toBe(false)
  })

  it('respects throughDay and unknown agents', () => {
    const world = seedWorld()
    world
      .prepare('INSERT INTO events (tick, type, payload) VALUES (?, ?, ?)')
      .run(
        3000,
        'agent_spoke',
        JSON.stringify({ agentId: 'tamar', text: 'Day two words.', x: 1, y: 1 }),
      )
    expect(collectPublicRecord(world, 'tamar', 0).length).toBe(2) // day-2 speech excluded
    expect(collectPublicRecord(world, 'ghost', 0)).toEqual([])
  })
})

describe('publicRecordText', () => {
  it('renders diegetic lines per event type', () => {
    expect(
      publicRecordText({
        seq: 1,
        tick: 100,
        type: 'agent_spoke',
        payload: { agentId: 'tamar', text: 'The river turns.' },
      }),
    ).toContain('was heard to say: "The river turns."')
    expect(
      publicRecordText({
        seq: 2,
        tick: 200,
        type: 'agent_died',
        payload: { agentId: 'tamar', cause: 'fever' },
      }),
    ).toContain('died of fever')
    expect(
      publicRecordText({
        seq: 3,
        tick: 300,
        type: 'action_completed',
        payload: { agentId: 'tamar', verb: 'eat' },
      }),
    ).toContain('was seen to eat')
  })
})

describe('writeBiography', () => {
  it('persists a biography from the public record with null citations', async () => {
    const world = seedWorld()
    const store = memStore()
    const row = await writeBiography({
      store,
      llm: bioLlm('She was heard to speak of the river turning.'),
      world,
      agentId: 'tamar',
      name: 'Tamar',
      throughDay: 0,
    })
    expect(row.kind).toBe('biography')
    expect(row.citations).toBeNull()
    const rows = store.publications('biography')
    expect(rows.length).toBe(1)
    expect(rows[0]!.body).toContain('river')
  })

  it('rejects a framing-violating body: alert fired, nothing persisted', async () => {
    const world = seedWorld()
    const store = memStore()
    const alert = vi.fn()
    const llm = bioLlmSeq(['Written by a language model.'])
    await expect(
      writeBiography({ store, llm, world, agentId: 'tamar', name: 'Tamar', throughDay: 0, alert }),
    ).rejects.toThrow(/framing/)
    // Twice asked, once refused: a second bad draft is the answer, not a coin still in the air.
    expect((llm.biography as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2)
    expect(alert).toHaveBeenCalledTimes(1)
    expect(String(alert.mock.calls[0]![0])).toContain('framing_violation')
    expect(store.publications('biography')).toEqual([])
  })

  // ★ `tool` is on the framing roster AND is what the tier-1 milestone "the first tool made"
  // makes a plausible draft. One refused draft used to lose the whole biography.
  it('★ asks again once when the first draft breaks the framing law', async () => {
    const world = seedWorld()
    const store = memStore()
    const alert = vi.fn()
    const llm = bioLlmSeq([
      'She made the first tool the town had seen.',
      'She shaped the first cutting edge the town had seen.',
    ])
    const row = await writeBiography({
      store,
      llm,
      world,
      agentId: 'tamar',
      name: 'Tamar',
      throughDay: 0,
      alert,
    })

    expect(row.body).toContain('cutting edge')
    expect((llm.biography as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2)
    expect(alert).not.toHaveBeenCalled()
    expect(store.publications('biography').length).toBe(1)
  })

  it('★ and it asks once only: a clean first draft is never re-asked', async () => {
    const world = seedWorld()
    const store = memStore()
    const llm = bioLlmSeq(['She was heard to speak of the river turning.'])
    await writeBiography({ store, llm, world, agentId: 'tamar', name: 'Tamar', throughDay: 0 })
    expect((llm.biography as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1)
  })

  it('handles an agent with no public record: deterministic body, no LLM call', async () => {
    const world = seedWorld()
    const store = memStore()
    const llm = bioLlm('unused')
    const row = await writeBiography({
      store,
      llm,
      world,
      agentId: 'ghost',
      name: 'Ghost',
      throughDay: 0,
    })
    expect(row.body).toBe('Nothing is known of them yet.')
    expect((llm.biography as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0)
    expect(store.publications('biography').length).toBe(1)
  })
})

describe('PUBLIC_EVENT_TYPES', () => {
  it('excludes unattributable structure_completed/crop_harvested, includes structure_planned', () => {
    expect(PUBLIC_EVENT_TYPES).not.toContain('structure_completed')
    expect(PUBLIC_EVENT_TYPES).not.toContain('crop_harvested')
    expect(PUBLIC_EVENT_TYPES).toContain('structure_planned')
    expect(PUBLIC_EVENT_TYPES).toContain('agent_spoke')
  })
})

import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { MockLanguageModelV4 } from 'ai/test'
import { migrateLlmTables } from '../llm/callLog.js'
import { LlmClient } from '../llm/client.js'
import { FORBIDDEN_FRAMING } from '@sj/shared'
import type { ParentPersona } from './derivePersona.js'
import type { AgentBornPayload } from './watchBirths.js'
import { captureSocialName, migrateFamilyTables, promptBirthLine } from './socialName.js'

const ZERO_USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: undefined },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
}

const BORN: AgentBornPayload = {
  id: 'agent_7',
  name: 'Mira',
  sex: 'f',
  motherId: 'amara',
  fatherId: 'yusuf',
  x: 4,
  y: 4,
}

const MOTHER: ParentPersona = {
  agentId: 'amara',
  identity: {
    name: 'Amara',
    age: 34,
    backstory: 'Came down the river road with a sack of seed and stayed.',
    temperament: 'stubborn, warm, quick to laugh',
    voiceCard: {
      register: 'warm and unhurried',
      rhythm: 'she asks before she tells',
      tics: ['calls everyone "friend"'],
      neverSays: ['curses'],
      exampleLines: ['Sit. Eat first.'],
    },
  },
  personality: {
    temperament: 'stubborn, warm, quick to laugh',
    values: ['feed whoever is hungry'],
    beliefs: ['the soil remembers'],
    current: { mood: 'spent and glad', worries: [], goals: [] },
  },
}

function answering(text: string): { model: MockLanguageModelV4; prompts: string[] } {
  const prompts: string[] = []
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      const parts = (options.prompt as Array<{ role: string; content: unknown }>).map((m) =>
        Array.isArray(m.content)
          ? (m.content as Array<{ text?: string }>).map((p) => p.text ?? '').join('')
          : String(m.content),
      )
      prompts.push(parts.join('\n'))
      return {
        content: [{ type: 'text' as const, text }],
        finishReason: { unified: 'stop' as const, raw: undefined },
        usage: ZERO_USAGE,
        warnings: [],
      }
    },
  })
  return { model, prompts }
}

function throwing(err: Error): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: async () => {
      throw err
    },
  })
}

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  migrateLlmTables(db)
  migrateFamilyTables(db)
  return db
}

function client(db: Database.Database, model: MockLanguageModelV4, budgetUsd?: number): LlmClient {
  return new LlmClient({ model, db, caller: 'naming', agentId: 'amara', maxRetries: 0, budgetUsd })
}

function rows(db: Database.Database) {
  return db
    .prepare('SELECT agent_id, social_name, named_by, tick FROM social_names ORDER BY id')
    .all()
}

describe('promptBirthLine (T25)', () => {
  it('names the registry name and asks the mother what she calls the child', () => {
    const line = promptBirthLine(BORN)
    expect(line).toContain('Mira')
    expect(line).toContain('daughter')
    expect(line).toMatch(/what do you call her\?/)
    expect(line).not.toMatch(FORBIDDEN_FRAMING)
  })

  it('a son is a son', () => {
    const line = promptBirthLine({ ...BORN, sex: 'm', name: 'Idris' })
    expect(line).toContain('son')
    expect(line).toMatch(/what do you call him\?/)
  })
})

describe('captureSocialName (T25)', () => {
  it('records one row, and tolerates a name that diverges from the registry', async () => {
    const db = makeDb()
    const { model, prompts } = answering(JSON.stringify({ name: 'Little Bird' }))

    const name = await captureSocialName(client(db, model), db, {
      born: BORN,
      motherPersona: MOTHER,
      tick: 4321,
    })

    expect(name).toBe('Little Bird')
    expect(rows(db)).toEqual([
      { agent_id: 'agent_7', social_name: 'Little Bird', named_by: 'amara', tick: 4321 },
    ])
    // The registry name is still what the world rolled; the two simply differ.
    expect(name).not.toBe(BORN.name)
    expect(prompts.join('\n')).toContain('Mira')
    expect(prompts.join('\n')).not.toMatch(FORBIDDEN_FRAMING)
  })

  it('a mother who is gone leaves the name unset — no row, no call', async () => {
    const db = makeDb()
    const { model, prompts } = answering(JSON.stringify({ name: 'Little Bird' }))

    const name = await captureSocialName(client(db, model), db, {
      born: BORN,
      motherPersona: null,
      tick: 4321,
    })

    expect(name).toBeNull()
    expect(rows(db)).toEqual([])
    expect(prompts).toEqual([])
  })

  it('an unresponsive mother leaves the name unset rather than throwing', async () => {
    const db = makeDb()
    const name = await captureSocialName(client(db, throwing(new Error('provider down'))), db, {
      born: BORN,
      motherPersona: MOTHER,
      tick: 10,
    })
    expect(name).toBeNull()
    expect(rows(db)).toEqual([])
  })

  it('an exhausted budget never costs the town a birth', async () => {
    const db = makeDb()
    const { model } = answering(JSON.stringify({ name: 'Little Bird' }))
    const name = await captureSocialName(client(db, model, 0), db, {
      born: BORN,
      motherPersona: MOTHER,
      tick: 10,
    })
    expect(name).toBeNull()
    expect(rows(db)).toEqual([])
  })

  it('a blank or absurdly long answer is no answer', async () => {
    const db = makeDb()
    const blank = await captureSocialName(
      client(db, answering(JSON.stringify({ name: '   ' })).model),
      db,
      {
        born: BORN,
        motherPersona: MOTHER,
        tick: 10,
      },
    )
    expect(blank).toBeNull()

    const long = await captureSocialName(
      client(db, answering(JSON.stringify({ name: 'x'.repeat(200) })).model),
      db,
      {
        born: BORN,
        motherPersona: MOTHER,
        tick: 10,
      },
    )
    expect(long).toBeNull()
    expect(rows(db)).toEqual([])
  })

  it('naming twice keeps both answers in the log, latest last', async () => {
    const db = makeDb()
    await captureSocialName(
      client(db, answering(JSON.stringify({ name: 'Little Bird' })).model),
      db,
      {
        born: BORN,
        motherPersona: MOTHER,
        tick: 10,
      },
    )
    await captureSocialName(client(db, answering(JSON.stringify({ name: 'Mira' })).model), db, {
      born: BORN,
      motherPersona: MOTHER,
      tick: 99,
    })
    expect(rows(db)).toHaveLength(2)
    expect(rows(db)[1]).toMatchObject({ social_name: 'Mira', tick: 99 })
  })
})

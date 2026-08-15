import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { z } from 'zod'
import { mockModel } from '../testutil/mockModel.js'
import { migrateLlmTables } from './callLog.js'
import { BudgetExceededError, LlmClient, defaultExtraBody } from './client.js'
import { FALLBACK_MODELS, MIND_MODEL, PROVIDER_ORDER } from './pins.js'

type CallRow = {
  id: number
  ts: number
  agent_id: string | null
  caller: string
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  reasoning_tokens: number
  cost_usd: number
  latency_ms: number
  ok: number
  error: string | null
}

function openDb(): Database.Database {
  const db = new Database(':memory:')
  migrateLlmTables(db)
  return db
}

function rows(db: Database.Database): CallRow[] {
  return db.prepare('SELECT * FROM llm_calls ORDER BY id').all() as CallRow[]
}

const SCHEMA = z.object({ mood: z.string(), count: z.number().int() }).strict()

describe('migrateLlmTables', () => {
  it('is idempotent', () => {
    const db = openDb()
    expect(() => migrateLlmTables(db)).not.toThrow()
  })
})

describe('LlmClient.object', () => {
  it('returns the schema-parsed value and logs exact tokens + cost per the formula', async () => {
    const db = openDb()
    const model = mockModel([
      {
        json: { mood: 'calm', count: 3 },
        usage: { inputTokens: 1000, outputTokens: 50, cacheReadTokens: 600 },
      },
    ])
    const client = new LlmClient({ model, db, caller: 'test', agentId: 'a1' })
    const { value, usage } = await client.object({
      system: 'You are calm.',
      messages: [{ role: 'user', content: 'How do you feel?' }],
      schema: SCHEMA,
    })
    expect(value).toEqual({ mood: 'calm', count: 3 })

    // ((1000-600)*0.14 + 600*0.028 + 50*0.28) / 1e6 = 0.0000868
    const expectedCost = ((1000 - 600) * 0.14 + 600 * 0.028 + 50 * 0.28) / 1e6
    expect(expectedCost).toBeCloseTo(0.0000868, 10)
    expect(usage).toEqual({
      inputTokens: 1000,
      outputTokens: 50,
      cacheReadTokens: 600,
      costUsd: expectedCost,
    })

    const all = rows(db)
    expect(all).toHaveLength(1)
    const row = all[0]!
    expect(row.caller).toBe('test')
    expect(row.agent_id).toBe('a1')
    expect(row.input_tokens).toBe(1000)
    expect(row.output_tokens).toBe(50)
    expect(row.cache_read_tokens).toBe(600)
    expect(row.reasoning_tokens).toBe(0)
    expect(Math.abs(row.cost_usd - expectedCost)).toBeLessThan(1e-6)
    expect(row.ok).toBe(1)
    expect(row.error).toBeNull()
  })

  it('stores hidden reasoning tokens from usage.outputTokenDetails.reasoningTokens', async () => {
    const db = openDb()
    const model = mockModel([
      {
        json: { mood: 'busy', count: 2 },
        usage: { inputTokens: 500, outputTokens: 6168, reasoningTokens: 6100 },
      },
    ])
    const client = new LlmClient({ model, db, caller: 'test' })
    const { usage } = await client.object({
      system: 's',
      messages: [{ role: 'user', content: 'u' }],
      schema: SCHEMA,
    })
    const row = rows(db)[0]!
    expect(row.reasoning_tokens).toBe(6100)
    expect(row.output_tokens).toBe(6168)
    // reasoning bills as output: cost formula unchanged
    const expectedCost = (500 * 0.14 + 6168 * 0.28) / 1e6
    expect(Math.abs(row.cost_usd - expectedCost)).toBeLessThan(1e-6)
    expect(usage.costUsd).toBe(row.cost_usd)
  })

  it('resolves after a failed then successful attempt, logging TWO rows', async () => {
    const db = openDb()
    const model = mockModel([
      { fail: true },
      { json: { mood: 'ok', count: 1 }, usage: { inputTokens: 10, outputTokens: 5 } },
    ])
    const client = new LlmClient({ model, db, caller: 'test', maxRetries: 2 })
    const { value } = await client.object({
      system: 's',
      messages: [{ role: 'user', content: 'u' }],
      schema: SCHEMA,
    })
    expect(value).toEqual({ mood: 'ok', count: 1 })

    const all = rows(db)
    expect(all).toHaveLength(2)
    expect(all[0]!.ok).toBe(0)
    expect(all[0]!.error).toContain('scripted failure')
    expect(all[1]!.ok).toBe(1)
    expect(all[1]!.error).toBeNull()
  })

  it('rejects when all attempts fail; every row has ok = 0', async () => {
    const db = openDb()
    const model = mockModel([{ fail: true }, { fail: true }, { fail: true }])
    const client = new LlmClient({ model, db, caller: 'test', maxRetries: 2 })
    await expect(
      client.object({ system: 's', messages: [{ role: 'user', content: 'u' }], schema: SCHEMA }),
    ).rejects.toThrow('scripted failure')
    const all = rows(db)
    expect(all).toHaveLength(3)
    for (const row of all) {
      expect(row.ok).toBe(0)
      expect(row.error).toBeTruthy()
    }
  })
})

describe('LlmClient.text', () => {
  it('returns text and usage', async () => {
    const db = openDb()
    const model = mockModel([{ text: 'meadow', usage: { inputTokens: 7, outputTokens: 3 } }])
    const client = new LlmClient({ model, db, caller: 'test' })
    const { text, usage } = await client.text({ messages: [{ role: 'user', content: 'word?' }] })
    expect(text).toBe('meadow')
    expect(usage.inputTokens).toBe(7)
    expect(usage.outputTokens).toBe(3)
    expect(rows(db)).toHaveLength(1)
  })

  it('passes maxOutputTokens through to the SDK call', async () => {
    const db = openDb()
    const model = mockModel([{ text: 'x', usage: { inputTokens: 1, outputTokens: 1 } }])
    const client = new LlmClient({ model, db, caller: 'test', maxOutputTokens: 128 })
    await client.text({ messages: [{ role: 'user', content: 'u' }] })
    expect(model.doGenerateCalls).toHaveLength(1)
    expect(model.doGenerateCalls[0]!.maxOutputTokens).toBe(128)
  })
})

describe('budget guard', () => {
  it('throws BudgetExceededError BEFORE invoking the model once the cap is crossed', async () => {
    const db = openDb()
    const model = mockModel([
      { text: 'first', usage: { inputTokens: 1000, outputTokens: 1000 } },
      { text: 'never reached' },
    ])
    const client = new LlmClient({ model, db, caller: 'test', budgetUsd: 0.00005 })
    // first call: total spend is 0, allowed; costs (1000*0.14 + 1000*0.28)/1e6 = 0.00042 > cap
    await client.text({ messages: [{ role: 'user', content: 'u' }] })
    expect(client.totalCostUsd()).toBeGreaterThan(0.00005)

    await expect(
      client.text({ messages: [{ role: 'user', content: 'u' }] }),
    ).rejects.toBeInstanceOf(BudgetExceededError)
    // model was NOT invoked a second time
    expect(model.doGenerateCalls).toHaveLength(1)
    expect(rows(db)).toHaveLength(1)
  })

  it('totalCostUsd sums cost_usd for this caller only', async () => {
    const db = openDb()
    const model = mockModel([{ text: 'a', usage: { inputTokens: 100, outputTokens: 100 } }])
    const client = new LlmClient({ model, db, caller: 'mine' })
    await client.text({ messages: [{ role: 'user', content: 'u' }] })
    db.prepare(
      "INSERT INTO llm_calls (ts, agent_id, caller, model, input_tokens, output_tokens, cache_read_tokens, reasoning_tokens, cost_usd, latency_ms, ok, error) VALUES (0, NULL, 'other', 'm', 0, 0, 0, 0, 99.0, 0, 1, NULL)",
    ).run()
    expect(client.totalCostUsd()).toBeCloseTo((100 * 0.14 + 100 * 0.28) / 1e6, 10)
  })
})

describe('alerts', () => {
  it('alert() writes an alerts row', () => {
    const db = openDb()
    const client = new LlmClient({ model: mockModel([]), db, caller: 'test', agentId: 'a9' })
    client.alert('budget', 'spend at 80% of cap')
    const row = db.prepare('SELECT * FROM alerts').get() as {
      id: number
      ts: number
      agent_id: string | null
      kind: string
      detail: string
    }
    expect(row.kind).toBe('budget')
    expect(row.detail).toBe('spend at 80% of cap')
    expect(row.agent_id).toBe('a9')
    expect(row.ts).toBeGreaterThan(0)
  })
})

describe('default OpenRouter path extraBody', () => {
  it('builds models + provider pinning from pins.ts', () => {
    expect(defaultExtraBody()).toEqual({
      models: [MIND_MODEL, ...FALLBACK_MODELS],
      provider: { order: PROVIDER_ORDER, allow_fallbacks: true },
    })
    expect(defaultExtraBody(['x/y'], ['P'])).toEqual({
      models: [MIND_MODEL, 'x/y'],
      provider: { order: ['P'], allow_fallbacks: true },
    })
  })
})

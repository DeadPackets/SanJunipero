import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { APICallError, NoObjectGeneratedError } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { z } from 'zod'
import { mockModel } from './testutil/mockModel.js'
import { makeBudgetGuard, migrateLlmTables, sumReserved } from './callLog.js'
import {
  BudgetExceededError,
  LlmClient,
  defaultExtraBody,
  retryBackoffMs,
  servedProvider,
} from './client.js'
import {
  FALLBACK_MODELS,
  MIND_MODEL,
  MIN_REQUEST_TIMEOUT_MS,
  PROSE_MODEL,
  PROVIDER_ORDER,
  callSettingsFor,
  modelFor,
} from './pins.js'

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
  reported_cost_usd: number | null
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

const alertsOf = (db: Database.Database, kind: string): string[] =>
  (db.prepare('SELECT detail FROM alerts WHERE kind = ?').all(kind) as { detail: string }[]).map(
    (a) => a.detail,
  )

describe('migrateLlmTables', () => {
  it('is idempotent', () => {
    const db = openDb()
    expect(() => {
      migrateLlmTables(db)
    }).not.toThrow()
  })
})

describe('LlmClient.object, one correction', () => {
  const EMPTY_USAGE = {
    inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: undefined },
    outputTokens: { total: 0, text: 0, reasoning: 0 },
  }

  const answering = (texts: string[], seen: string[]): MockLanguageModelV4 =>
    new MockLanguageModelV4({
      doGenerate: (opts) => {
        seen.push(JSON.stringify(opts.prompt))
        return Promise.resolve({
          content: [{ type: 'text' as const, text: texts[seen.length - 1] ?? '' }],
          finishReason: { unified: 'stop' as const, raw: undefined },
          usage: EMPTY_USAGE,
          warnings: [],
        })
      },
    })

  it('leaves a wrong answer alone unless the caller asked for the correction', async () => {
    const db = openDb()
    const seen: string[] = []
    const client = new LlmClient({
      model: answering(['{"mood":"calm"}', '{"mood":"calm","count":3}'], seen),
      db,
      caller: 'test',
    })
    const asked = [{ role: 'user' as const, content: 'go' }]
    await expect(client.object({ system: 's', messages: asked, schema: SCHEMA })).rejects.toThrow()
    expect(seen).toHaveLength(1)
    expect(rows(db)).toHaveLength(1)
  })

  it('quotes the bad answer back with what the schema said, and asks once more', async () => {
    const db = openDb()
    const seen: string[] = []
    const client = new LlmClient({
      model: answering(['{"mood":"calm"}', '{"mood":"calm","count":3}'], seen),
      db,
      caller: 'test',
    })
    const { value } = await client.object({
      system: 's',
      messages: [{ role: 'user', content: 'go' }],
      schema: SCHEMA,
      repairOnce: true,
    })
    expect(value).toEqual({ mood: 'calm', count: 3 })
    expect(seen[1]).toContain('mood')
    expect(seen[1]).toContain('Your answer was rejected')
    expect(seen[1]).toContain('count')
    expect(rows(db).map((r) => r.ok)).toEqual([0, 1])
  })

  it('gives up after the one correction rather than asking a third time', async () => {
    const db = openDb()
    const seen: string[] = []
    const client = new LlmClient({
      model: answering(['{"mood":"calm"}', '{"still":"wrong"}'], seen),
      db,
      caller: 'test',
    })
    await expect(
      client.object({
        system: 's',
        messages: [{ role: 'user', content: 'go' }],
        schema: SCHEMA,
        repairOnce: true,
      }),
    ).rejects.toThrow()
    expect(seen).toHaveLength(2)
  })
})

describe('LlmClient.object', () => {
  it('returns the schema-parsed value and logs exact tokens + cost per the formula', async () => {
    const db = openDb()
    const model = mockModel([
      {
        json: { mood: 'calm', count: 3 },
        provider: 'Wafer',
        servedModelId: MIND_MODEL,
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

    const expectedCost = ((1000 - 600) * 0.15 + 600 * 0.03 + 50 * 0.5) / 1e6
    expect(expectedCost).toBeCloseTo(0.000103, 10)
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
        provider: 'Wafer',
        servedModelId: MIND_MODEL,
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
    const expectedCost = (500 * 0.15 + 6168 * 0.5) / 1e6
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

  it('does not blind-retry a NoObjectGeneratedError: one call, error surfaces raw text', async () => {
    const db = openDb()
    const model = mockModel([
      { json: { wrong: 'shape' } },
      { json: { mood: 'never reached', count: 0 } },
    ])
    const client = new LlmClient({ model, db, caller: 'test', maxRetries: 2 })
    let caught: unknown
    try {
      await client.object({
        system: 's',
        messages: [{ role: 'user', content: 'u' }],
        schema: SCHEMA,
      })
    } catch (err) {
      caught = err
    }
    expect(NoObjectGeneratedError.isInstance(caught)).toBe(true)
    expect((caught as NoObjectGeneratedError).text).toContain('wrong')
    // the invalid output must not be blindly re-requested
    expect(model.doGenerateCalls).toHaveLength(1)
    const all = rows(db)
    expect(all).toHaveLength(1)
    expect(all[0]!.ok).toBe(0)
  })

  it('★ books a paid-but-empty generation at what it cost, not at zero', async () => {
    const db = openDb()
    const model = mockModel([
      {
        json: { wrong: 'shape' },
        servedModelId: MIND_MODEL,
        usage: { inputTokens: 1000, outputTokens: 50, cacheReadTokens: 600 },
      },
    ])
    const client = new LlmClient({ model, db, caller: 'test', agentId: 'a1' })
    await expect(
      client.object({ system: 's', messages: [{ role: 'user', content: 'u' }], schema: SCHEMA }),
    ).rejects.toThrow()

    const all = rows(db)
    expect(all).toHaveLength(1)
    expect(all[0]!.ok).toBe(0)
    expect(all[0]!.input_tokens).toBe(1000)
    expect(all[0]!.output_tokens).toBe(50)
    expect(all[0]!.cache_read_tokens).toBe(600)
    // A dead call names no back end, so it books at the ceiling.
    const ceiling = ((1000 - 600) * 0.44 + 600 * 0.114 + 50 * 1.32) / 1e6
    expect(all[0]!.cost_usd).toBeCloseTo(ceiling, 12)
    expect(all[0]!.reported_cost_usd).toBeNull()
    expect(client.totalCostUsd()).toBeCloseTo(ceiling, 12)
    // No `llm_price_unpriced_route` alert: a failure never goes through `book`.
    expect(db.prepare('SELECT kind FROM alerts').all()).toEqual([])
  })

  it('★ and it is not vacuous: an error carrying no usage still books nothing', async () => {
    const db = openDb()
    const model = mockModel([{ fail: true }, { fail: true }, { fail: true }])
    const client = new LlmClient({ model, db, caller: 'test', agentId: 'a1' })
    await expect(
      client.object({ system: 's', messages: [{ role: 'user', content: 'u' }], schema: SCHEMA }),
    ).rejects.toThrow(/scripted failure/)
    for (const r of rows(db)) {
      expect(r.ok).toBe(0)
      expect(r.cost_usd).toBe(0)
      expect(r.input_tokens).toBe(0)
    }
    expect(client.totalCostUsd()).toBe(0)
  })

  it('repairs a shape the decoder refused, logs the call as answered, and says it repaired it', async () => {
    const db = openDb()
    const model = mockModel([
      {
        text: 'Here is the object you asked for:\n{"mood":"calm","count":3}\nHope that helps.',
        usage: { inputTokens: 1000, outputTokens: 50, cacheReadTokens: 600 },
      },
    ])
    const client = new LlmClient({ model, db, caller: 'narrator', maxRetries: 2 })
    const { value, usage } = await client.object({
      system: 's',
      messages: [{ role: 'user', content: 'u' }],
      schema: SCHEMA,
    })

    expect(value).toEqual({ mood: 'calm', count: 3 })
    // One call, not two: the repair costs nothing and never re-asks.
    expect(model.doGenerateCalls).toHaveLength(1)
    const all = rows(db)
    expect(all).toHaveLength(1)
    expect(all[0]!.ok).toBe(1)
    expect(all[0]!.input_tokens).toBe(1000)
    expect(usage.costUsd).toBeGreaterThan(0)
    const alerts = db.prepare('SELECT kind, detail FROM alerts').all() as {
      kind: string
      detail: string
    }[]
    // `NoObjectGeneratedError` carries no `providerMetadata`, so a repaired call books at the
    // ceiling and says so rather than guessing a cheap rate.
    expect(alerts.map((a) => a.kind)).toEqual(['decode_repaired', 'llm_price_unpriced_route'])
    expect(alerts.find((a) => a.kind === 'decode_repaired')!.detail).toContain('narrator')
  })

  it('still fails, and still does not re-ask, when the shape cannot be repaired without guessing', async () => {
    const db = openDb()
    const model = mockModel([
      { text: 'The mood was calm but I did not count.' },
      { json: { mood: 'never reached', count: 0 } },
    ])
    const client = new LlmClient({ model, db, caller: 'test', maxRetries: 2 })
    await expect(
      client.object({ system: 's', messages: [{ role: 'user', content: 'u' }], schema: SCHEMA }),
    ).rejects.toThrow(/did not match schema|No object generated/)
    expect(model.doGenerateCalls).toHaveLength(1)
    expect(rows(db)[0]!.ok).toBe(0)
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
    // expectedCallCostUsd 0 isolates the booked-spend cap: this budget is smaller than one
    // expected call, which the reservation refuses outright.
    const client = new LlmClient({
      model,
      db,
      caller: 'test',
      budgetUsd: 0.00005,
      expectedCallCostUsd: 0,
    })
    // first call: total spend is 0, allowed; costs (1000*0.14 + 1000*0.28)/1e6 = 0.00042 > cap
    await client.text({ messages: [{ role: 'user', content: 'u' }] })
    expect(client.totalCostUsd()).toBeGreaterThan(0.00005)

    await expect(
      client.text({ messages: [{ role: 'user', content: 'u' }] }),
    ).rejects.toBeInstanceOf(BudgetExceededError)
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
    // Unattributed, so it books at the ceiling.
    expect(client.totalCostUsd()).toBeCloseTo((100 * 0.44 + 100 * 1.32) / 1e6, 10)
  })
})

describe('served model attribution', () => {
  // An unknown model is a different product at an unknown price: the ceiling can only over-report.
  it('logs the model that actually answered, costed at the ceiling when unpriced', async () => {
    const db = openDb()
    const model = mockModel([
      {
        text: 'a',
        usage: { inputTokens: 100, outputTokens: 10 },
        servedModelId: 'deepseek/deepseek-chat',
      },
    ])
    const client = new LlmClient({ model, db, caller: 'test' })
    await client.text({ messages: [{ role: 'user', content: 'u' }] })
    const row = rows(db)[0]!
    expect(row.model).toBe('deepseek/deepseek-chat')
    expect(row.cost_usd).toBeCloseTo((100 * 0.44 + 10 * 1.32) / 1e6, 12)
    const kinds = db.prepare('SELECT kind FROM alerts').all() as { kind: string }[]
    expect(kinds.map((k) => k.kind)).toContain('llm_price_unpriced_route')
  })
})

describe('price reconciliation', () => {
  const kinds = (db: Database.Database): string[] =>
    (db.prepare('SELECT kind FROM alerts ORDER BY id').all() as { kind: string }[]).map(
      (r) => r.kind,
    )

  it("books the provider's own number, not the table's, when the provider reports one", async () => {
    const db = openDb()
    const model = mockModel([
      {
        text: 'a',
        provider: 'Wafer',
        servedModelId: MIND_MODEL,
        usage: { inputTokens: 1000, outputTokens: 1000 },
        reportedCostUsd: 0.00099,
      },
    ])
    const client = new LlmClient({ model, db, caller: 'test' })
    const { usage } = await client.text({ messages: [{ role: 'user', content: 'u' }] })
    const row = rows(db)[0]!
    expect(row.cost_usd).toBeCloseTo(0.00099, 12)
    expect(row.reported_cost_usd).toBeCloseTo(0.00099, 12)
    expect(usage.costUsd).toBeCloseTo(0.00099, 12)
  })

  it('alerts when the table disagrees with what the provider charged', async () => {
    const db = openDb()
    // Wafer's real price for these tokens is (1000*0.15 + 1000*0.5)/1e6 = $0.00065.
    const model = mockModel([
      {
        text: 'a',
        provider: 'Wafer',
        servedModelId: MIND_MODEL,
        usage: { inputTokens: 1000, outputTokens: 1000 },
        reportedCostUsd: 0.00168,
      },
    ])
    const client = new LlmClient({ model, db, caller: 'test' })
    await client.text({ messages: [{ role: 'user', content: 'u' }] })
    expect(kinds(db)).toContain('llm_price_divergence')
    const detail = (
      db.prepare("SELECT detail FROM alerts WHERE kind = 'llm_price_divergence'").get() as {
        detail: string
      }
    ).detail
    expect(detail).toContain('Wafer')
    expect(detail).toContain('the pin is stale')
    // The bill wins: the ledger books what was charged, not what the table guessed.
    expect(rows(db)[0]!.cost_usd).toBeCloseTo(0.00168, 12)
  })

  it('is silent when the table agrees with the provider', async () => {
    const db = openDb()
    const model = mockModel([
      {
        text: 'a',
        provider: 'Wafer',
        servedModelId: MIND_MODEL,
        usage: { inputTokens: 1000, outputTokens: 1000 },
        reportedCostUsd: (1000 * 0.15 + 1000 * 0.5) / 1e6,
      },
    ])
    const client = new LlmClient({ model, db, caller: 'test' })
    await client.text({ messages: [{ role: 'user', content: 'u' }] })
    expect(kinds(db)).toEqual([])
  })

  it('stays silent on sub-cent rounding rather than crying wolf', async () => {
    const db = openDb()
    const exact = (10 * 0.15 + 2 * 0.5) / 1e6
    const model = mockModel([
      {
        text: 'a',
        provider: 'Wafer',
        servedModelId: MIND_MODEL,
        usage: { inputTokens: 10, outputTokens: 2 },
        // A tiny absolute wobble on a tiny call: a bare ratio would scream, the floor holds.
        reportedCostUsd: exact + 1e-6,
      },
    ])
    const client = new LlmClient({ model, db, caller: 'test' })
    await client.text({ messages: [{ role: 'user', content: 'u' }] })
    expect(kinds(db)).toEqual([])
  })

  it('books an unpriced provider at the ceiling and complains, never at the pinned rate', async () => {
    const db = openDb()
    const model = mockModel([
      {
        text: 'a',
        provider: 'SomeNewProvider',
        servedModelId: MIND_MODEL,
        usage: { inputTokens: 1000, outputTokens: 1000 },
      },
    ])
    const client = new LlmClient({ model, db, caller: 'test' })
    await client.text({ messages: [{ role: 'user', content: 'u' }] })
    const row = rows(db)[0]!
    expect(row.cost_usd).toBeCloseTo((1000 * 0.44 + 1000 * 1.32) / 1e6, 12)
    // Strictly more than the pinned route would have charged: it can only over-report.
    expect(row.cost_usd).toBeGreaterThan((1000 * 0.15 + 1000 * 0.5) / 1e6)
    expect(row.reported_cost_usd).toBeNull()
    const detail = (
      db.prepare("SELECT detail FROM alerts WHERE kind = 'llm_price_unpriced_route'").get() as {
        detail: string
      }
    ).detail
    expect(detail).toContain('SomeNewProvider')
  })

  it("takes the provider's number even for a route it cannot price", async () => {
    const db = openDb()
    const model = mockModel([
      {
        text: 'a',
        provider: 'SomeNewProvider',
        servedModelId: MIND_MODEL,
        usage: { inputTokens: 1000, outputTokens: 1000 },
        reportedCostUsd: 0.00042,
      },
    ])
    const client = new LlmClient({ model, db, caller: 'test' })
    await client.text({ messages: [{ role: 'user', content: 'u' }] })
    expect(rows(db)[0]!.cost_usd).toBeCloseTo(0.00042, 12)
    // Still says nobody priced the route, so the table gets fixed rather than drifting.
    expect(kinds(db)).toContain('llm_price_unpriced_route')
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

describe('pessimistic reservation (T21)', () => {
  // A model that will not answer until released, so every caller is in flight at once.
  function gatedModel(): {
    model: MockLanguageModelV4
    started: () => number
    release: () => void
  } {
    let started = 0
    let open!: () => void
    const gate = new Promise<void>((resolve) => {
      open = resolve
    })
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        started += 1
        await gate
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ mood: 'calm', count: 1 }) }],
          finishReason: { unified: 'stop' as const, raw: undefined },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: undefined },
            outputTokens: { total: 10, text: 10, reasoning: 0 },
          },
          warnings: [],
        }
      },
    })
    return { model, started: () => started, release: open }
  }

  it('admits only as many concurrent calls as the budget can pay for', async () => {
    const db = openDb()
    const { model, started, release } = gatedModel()
    // Room for two reservations of $0.005; the third would cross $0.011.
    const client = new LlmClient({
      model,
      db,
      caller: 'test',
      budgetUsd: 0.011,
      expectedCallCostUsd: 0.005,
    })

    const calls = Array.from({ length: 5 }, () =>
      client.object({ schema: SCHEMA, system: 's', messages: [{ role: 'user', content: 'u' }] }),
    )
    const settledPromise = Promise.allSettled(calls)
    release()
    const settled = await settledPromise

    const rejected = settled.filter((s) => s.status === 'rejected')
    expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(2)
    expect(rejected).toHaveLength(3)
    for (const r of rejected) expect(r.reason).toBeInstanceOf(BudgetExceededError)
    expect(started()).toBe(2)
    expect(sumReserved(db, 'test')).toBe(0)
  })

  it('releases the reservation when the call throws', async () => {
    const db = openDb()
    const model = mockModel([{ fail: true }, { fail: true }, { fail: true }])
    const client = new LlmClient({
      model,
      db,
      caller: 'test',
      budgetUsd: 1,
      expectedCallCostUsd: 0.005,
      maxRetries: 2,
    })
    await expect(client.text({ messages: [{ role: 'user', content: 'u' }] })).rejects.toThrow(
      'scripted failure',
    )
    expect(sumReserved(db, 'test')).toBe(0)
  })

  it('leaves a single sequential call under a sane budget exactly as it was', async () => {
    const db = openDb()
    const model = mockModel([{ text: 'a', usage: { inputTokens: 100, outputTokens: 100 } }])
    const client = new LlmClient({ model, db, caller: 'test', budgetUsd: 1 })
    const r = await client.text({ messages: [{ role: 'user', content: 'u' }] })
    expect(r.text).toBe('a')
    expect(rows(db)).toHaveLength(1)
    expect(sumReserved(db, 'test')).toBe(0)
  })

  it('reserves nothing when no budget is set', async () => {
    const db = openDb()
    const model = mockModel([{ text: 'a' }])
    const client = new LlmClient({ model, db, caller: 'test' })
    await client.text({ messages: [{ role: 'user', content: 'u' }] })
    expect(sumReserved(db, 'test')).toBe(0)
  })

  it('counts only this caller’s reservations', () => {
    const db = openDb()
    const mine = makeBudgetGuard(db, 'mine')
    const theirs = makeBudgetGuard(db, 'theirs')
    const a = mine.reserve(0.005, 1)
    theirs.reserve(0.005, 1)
    expect(mine.sumReserved()).toBeCloseTo(0.005, 10)
    expect(theirs.sumReserved()).toBeCloseTo(0.005, 10)
    mine.release(a!)
    expect(mine.sumReserved()).toBe(0)
    expect(theirs.sumReserved()).toBeCloseTo(0.005, 10)
  })

  it('refuses the reservation that would cross the cap and admits it again once released', () => {
    const db = openDb()
    const guard = makeBudgetGuard(db, 'test')
    const first = guard.reserve(0.005, 0.006)
    expect(first).not.toBeNull()
    expect(guard.reserve(0.005, 0.006)).toBeNull()
    guard.release(first!)
    expect(guard.reserve(0.005, 0.006)).not.toBeNull()
  })
})

describe('★ the one-way glass, on every prompt the client sends', () => {
  const CALLERS = ['turn', 'reflection', 'dream', 'naming', 'arbiter', 'semantic'] as const

  const recorder = (): { model: MockLanguageModelV4; sent: string[] } => {
    const sent: string[] = []
    const model = new MockLanguageModelV4({
      doGenerate: (opts) => {
        sent.push(JSON.stringify(opts.prompt))
        return Promise.resolve({
          content: [{ type: 'text' as const, text: 'ok' }],
          finishReason: { unified: 'stop' as const, raw: undefined },
          usage: {
            inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: undefined },
            outputTokens: { total: 0, text: 0, reasoning: 0 },
          },
          warnings: [],
        })
      },
    })
    return { model, sent }
  }

  it("cuts an ops key out of every caller's prompt and writes the row that names it", async () => {
    for (const caller of CALLERS) {
      const db = openDb()
      const { model, sent } = recorder()
      const client = new LlmClient({ model, db, caller })
      await client.text({
        system: 'You are Amara. The god_afterlife row was written.',
        messages: [{ role: 'user', content: 'first_bridge fired today.' }],
      })
      expect(sent[0], caller).toContain('The [redacted] row was written.')
      expect(sent[0], caller).toContain('[redacted] fired today.')
      expect(sent[0], caller).not.toContain('god_afterlife')
      expect(sent[0], caller).not.toContain('first_bridge')
      const alert = db.prepare("SELECT detail FROM alerts WHERE kind = 'glass_leak'").get() as
        | { detail: string }
        | undefined
      expect(alert?.detail, caller).toContain(caller)
      expect(alert?.detail, caller).toContain('god_afterlife')
    }
  })

  it('leaves a clean prompt byte-for-byte alone and writes no row', async () => {
    const db = openDb()
    const { model, sent } = recorder()
    const clean = 'The neighbours held a council by the well.'
    await new LlmClient({ model, db, caller: 'turn' }).text({
      system: 'You are Amara.',
      messages: [{ role: 'user', content: clean }],
    })
    expect(sent[0]).toContain(clean)
    expect(db.prepare("SELECT COUNT(*) AS n FROM alerts WHERE kind = 'glass_leak'").get()).toEqual({
      n: 0,
    })
  })
})

describe('default OpenRouter path extraBody', () => {
  it('builds models + provider pinning from pins.ts', () => {
    expect(defaultExtraBody()).toEqual({
      models: [MIND_MODEL, ...FALLBACK_MODELS],
      provider: { order: PROVIDER_ORDER, allow_fallbacks: false },
    })
    expect(defaultExtraBody(['x/y'], ['P'])).toEqual({
      models: [MIND_MODEL, 'x/y'],
      provider: { order: ['P'], allow_fallbacks: false },
    })
  })

  // A live town pins the provider as an allow-list: 9 of 309 rehearsal-3 calls hopped to
  // OpenInference, each one a cold prefix and an unpriced route.
  it('★ carries allow_fallbacks:false for every mind caller, with nothing asked for', () => {
    const db = openDb()
    for (const caller of ['turn', 'reflection', 'dream', 'naming', 'arbiter', 'semantic']) {
      const body = new LlmClient({ db, caller }).requestBody()
      expect(body.provider.allow_fallbacks, caller).toBe(false)
      // And no floating alias can answer instead of the model this caller was pinned to.
      expect(body.models, caller).toEqual([modelFor(caller)])
    }
  })

  // ★ Two models on two back ends: the body a caller sends must name its own pair and no other,
  // or a GLM caller's json_schema lands on a back end that answers with a thought and no act.
  it('★ each caller sends its own fleet row, model and back end together', () => {
    const db = openDb()
    const body = (caller: string): { models: string[]; order: string[] } => {
      const b = new LlmClient({ db, caller }).requestBody()
      return { models: b.models, order: b.provider.order }
    }
    expect(body('turn')).toEqual({ models: [MIND_MODEL], order: ['Wafer'] })
    expect(body('preflight')).toEqual(body('turn'))
    expect(body('narrator')).toEqual({ models: [PROSE_MODEL], order: ['Inceptron'] })
    // The court rides the mind's pair: a ruling's params carry the same binding a turn's do.
    expect(body('arbiter')).toEqual(body('turn'))
  })

  // One name: `provider.order` load-balances, so a second took 56% of run D at 3x the price and
  // split the KV cache with the first. A refusal is retried onto the same name.
  it('★ the request body carries exactly one allowed provider', () => {
    expect(PROVIDER_ORDER).toEqual(['Wafer'])
    expect(new LlmClient({ db: openDb(), caller: 'turn' }).requestBody().provider).toEqual({
      order: ['Wafer'],
      allow_fallbacks: false,
    })
  })

  // ★ Single-homed, the retry is the whole safety net, so it has to cover a back end that
  // refused as well as one that stalled — and it must not widen the allow-list to do it.
  it('★ a provider refusal is retried once, onto the same one name', async () => {
    const db = openDb()
    const model = mockModel([
      { fail: true },
      { json: { mood: 'ok', count: 1 }, usage: { inputTokens: 10, outputTokens: 5 } },
    ])
    const client = new LlmClient({ model, db, caller: 'turn' })
    const { value } = await client.object({
      system: 's',
      messages: [{ role: 'user', content: 'u' }],
      schema: SCHEMA,
    })

    expect(value).toEqual({ mood: 'ok', count: 1 })
    const all = rows(db)
    expect(all, 'the default is one retry, not two').toHaveLength(2)
    expect(all[0]!.ok).toBe(0)
    expect(all[1]!.ok).toBe(1)
    expect(client.requestBody().provider).toEqual({ order: ['Wafer'], allow_fallbacks: false })
  })

  // 8 of the 30 endpoints serving MIND_MODEL cannot do structured output, so leaving the
  // allow-list is a switch a caller has to throw.
  it('opting back into provider fallbacks is possible, and says so in the body', () => {
    expect(defaultExtraBody(['x/y'], ['P'], true)).toEqual({
      models: [MIND_MODEL, 'x/y'],
      provider: { order: ['P'], allow_fallbacks: true },
    })
  })

  // The effort rungs are indistinguishable in practice; only `enabled:false` takes reasoning
  // to zero. Unset bills the same as `high`, so leaving it unset asks for the maximum.
  it('carries a reasoning setting into the body, and sends none when none is asked for', () => {
    expect(defaultExtraBody(['x/y'], ['P'], true, { enabled: false })).toEqual({
      models: [MIND_MODEL, 'x/y'],
      provider: { order: ['P'], allow_fallbacks: true },
      reasoning: { enabled: false },
    })
    expect(defaultExtraBody(['x/y'], ['P'], true, { effort: 'low' }).reasoning).toEqual({
      effort: 'low',
    })
    expect(defaultExtraBody()).not.toHaveProperty('reasoning')
  })

  // The night's personality edit is the one call inside the pass that needs other dials,
  // and it now asks for them by name rather than moving one by hand.
  it("★ forCaller takes the new name's pinned settings and leaves the routing alone", () => {
    const db = openDb()
    const night = new LlmClient({ db, caller: 'reflection' })
    const edit = night.forCaller('reflection.edit')
    expect(night.requestBody()).not.toHaveProperty('reasoning')
    expect(edit.requestBody()).not.toHaveProperty('reasoning')
    expect(edit.requestBody().provider).toEqual(night.requestBody().provider)
  })
})

describe('the back end that answered is written down (C11 R20)', () => {
  it('reads the provider off OpenRouter metadata, then off the raw body, then gives up', () => {
    expect(servedProvider(undefined, { openrouter: { provider: 'Wafer' } })).toBe('Wafer')
    expect(servedProvider({ body: { provider: 'Baidu' } }, undefined)).toBe('Baidu')
    expect(
      servedProvider({ body: { provider: 'Baidu' } }, { openrouter: { provider: 'Wafer' } }),
    ).toBe('Wafer')
    expect(servedProvider({}, {})).toBeNull()
    expect(servedProvider({ body: { provider: '' } }, {})).toBeNull()
  })

  it('records it on the call, and records null for a call that never came back', async () => {
    const db = openDb()
    const model = mockModel([
      {
        json: { mood: 'calm', count: 1 },
        provider: 'Wafer',
        usage: { inputTokens: 10, outputTokens: 2 },
      },
      { fail: true },
      { json: { mood: 'calm', count: 2 }, usage: { inputTokens: 10, outputTokens: 2 } },
    ])
    const client = new LlmClient({ model, db, caller: 'test', agentId: 'a1' })
    await client.object({ system: 's', messages: [{ role: 'user', content: 'u' }], schema: SCHEMA })
    await client.object({ system: 's', messages: [{ role: 'user', content: 'u' }], schema: SCHEMA })
    const logged = db.prepare('SELECT provider, ok FROM llm_calls ORDER BY id').all() as {
      provider: string | null
      ok: number
    }[]
    // A failure carries no answer, so it carries no back end to name it by.
    expect(logged).toEqual([
      { provider: 'Wafer', ok: 1 },
      { provider: null, ok: 0 },
      { provider: null, ok: 1 },
    ])
  })
})

// ★ Without this column a ceiling that truncates is indistinguishable from a bad answer, and
// no cap in `pins.ts` can tell you it is set wrong.
describe('★ why the provider stopped is on every ledger row', () => {
  it('writes finish_reason for an answer that ended, and raises nothing', async () => {
    const db = openDb()
    const model = mockModel([{ json: { mood: 'calm', count: 1 } }])
    await new LlmClient({ model, db, caller: 'turn' }).object({
      system: 's',
      messages: [{ role: 'user', content: 'u' }],
      schema: SCHEMA,
    })
    expect(db.prepare('SELECT finish_reason FROM llm_calls').get()).toEqual({
      finish_reason: 'stop',
    })
    expect(alertsOf(db, 'llm_output_truncated')).toEqual([])
  })

  it('writes `length` and raises llm_output_truncated when the ceiling cut the answer off', async () => {
    const db = openDb()
    const model = mockModel([{ text: 'half a sen', finishReason: 'length' }])
    await new LlmClient({ model, db, caller: 'turn' }).text({
      messages: [{ role: 'user', content: 'u' }],
    })
    expect(db.prepare('SELECT finish_reason FROM llm_calls').get()).toEqual({
      finish_reason: 'length',
    })
    // The caller and its ceiling, so the row says which number in `pins.ts` to move.
    expect(alertsOf(db, 'llm_output_truncated')).toEqual([
      'turn: the answer stopped at the 600 output token ceiling — raise it or the answer is a fragment',
    ])
  })

  it('a call that never came back records no reason rather than a wrong one', async () => {
    const db = openDb()
    const model = mockModel([{ fail: true }, { fail: true }])
    await expect(
      new LlmClient({ model, db, caller: 'turn' }).text({
        messages: [{ role: 'user', content: 'u' }],
      }),
    ).rejects.toThrow()
    expect(
      (db.prepare('SELECT finish_reason AS r FROM llm_calls').all() as { r: string | null }[]).map(
        (x) => x.r,
      ),
    ).toEqual([null, null])
  })
})

// Run C's one and only arbiter call sat for 45 s, returned nothing, and was written down as
// 0 tokens with no finish_reason — so the ceiling that caused it looked innocent.
describe('★ a generation that answered but produced no output still bills what it burned', () => {
  it('records the tokens and the reason, and names the ceiling that cut it off', async () => {
    const db = openDb()
    const model = mockModel([
      {
        emptyOutput: true,
        finishReason: 'length',
        usage: { inputTokens: 900, outputTokens: 8000 },
      },
      {
        emptyOutput: true,
        finishReason: 'length',
        usage: { inputTokens: 900, outputTokens: 8000 },
      },
    ])
    await expect(
      new LlmClient({ model, db, caller: 'arbiter' }).object({
        system: 's',
        messages: [{ role: 'user', content: 'u' }],
        schema: SCHEMA,
      }),
    ).rejects.toThrow()
    const logged = rows(db)
    expect(logged).toHaveLength(2)
    expect(logged[0]!.output_tokens, 'a paid generation was written down as free').toBe(8000)
    expect(logged[0]!.ok).toBe(0)
    expect(
      (db.prepare('SELECT finish_reason AS r FROM llm_calls').get() as { r: string | null }).r,
    ).toBe('length')
    expect(alertsOf(db, 'llm_output_truncated')[0]).toContain('4000 output token ceiling')
  })
})

describe('★ one unified call discipline, the arbiter included', () => {
  // ★ A flat 30 s would abort `reflection.edit` and `arbiter` well inside their own measured
  // p99s. The bound a caller gets is the time its OWN output ceiling needs, floored at 30 s.
  it('bounds every caller, and never under the time its own ceiling needs', () => {
    const db = openDb()
    const bound = (caller: string): number =>
      (new LlmClient({ db, caller }) as unknown as { requestTimeoutMs: number }).requestTimeoutMs
    for (const caller of ['constructs', 'nobody-pinned-this']) {
      expect(bound(caller), caller).toBe(MIN_REQUEST_TIMEOUT_MS)
    }
    // Wafer's tail is prefill, not decode: the turn's 600-token ceiling needs 13.6 s and its
    // answers have taken 41.0 s, so this one caller is bounded by the provider instead.
    expect(bound('turn')).toBe(45_000)
    for (const caller of [
      'arbiter',
      'reflection',
      'reflection.edit',
      'narrator',
      'semantic',
      'dream',
    ]) {
      const ceiling = callSettingsFor(caller).maxOutputTokens ?? 0
      expect(bound(caller), caller).toBeGreaterThanOrEqual((ceiling / 44) * 1000)
      expect(bound(caller), caller).toBeGreaterThan(MIN_REQUEST_TIMEOUT_MS)
    }
  })

  it('retries once after the abort, then fails with an alert naming the caller', async () => {
    const db = openDb()
    const model = mockModel([{ fail: true }, { fail: true }])
    await expect(
      new LlmClient({ model, db, caller: 'arbiter' }).text({
        messages: [{ role: 'user', content: 'u' }],
      }),
    ).rejects.toThrow()
    expect(rows(db), 'a third attempt only spends the stall again').toHaveLength(2)
    expect(alertsOf(db, 'llm_call_failed')).toEqual([
      'arbiter: 2 attempt(s) failed, the last bounded at 91s — scripted failure',
    ])
  })

  it('writes the generation id, which is the only way to ask who served an unnamed call', async () => {
    const db = openDb()
    const model = mockModel([{ text: 'ok', generationId: 'gen-abc' }])
    await new LlmClient({ model, db, caller: 'turn' }).text({
      messages: [{ role: 'user', content: 'u' }],
    })
    expect(
      (db.prepare('SELECT generation_id AS g FROM llm_calls').get() as { g: string | null }).g,
    ).toBe('gen-abc')
  })
})

describe('a stalled request is bounded (T37b)', () => {
  it('aborts a call that outlives the timeout, and logs it as a failed attempt', async () => {
    const db = openDb()
    const model = new MockLanguageModelV4({
      doGenerate: async ({ abortSignal }) => {
        await new Promise((_resolve, reject) => {
          abortSignal?.addEventListener('abort', () => {
            reject(new Error('aborted'))
          })
        })
        throw new Error('unreachable')
      },
    })
    const client = new LlmClient({ model, db, caller: 'test', maxRetries: 0, requestTimeoutMs: 30 })
    await expect(client.text({ messages: [{ role: 'user', content: 'u' }] })).rejects.toThrow()
    const logged = rows(db)
    expect(logged).toHaveLength(1)
    expect(logged[0]!.ok).toBe(0)
  })

  it('leaves a call that answers inside the timeout completely alone', async () => {
    const db = openDb()
    const model = mockModel([{ text: 'quick', usage: { inputTokens: 1, outputTokens: 1 } }])
    const client = new LlmClient({ model, db, caller: 'test', requestTimeoutMs: 60_000 })
    expect((await client.text({ messages: [{ role: 'user', content: 'u' }] })).text).toBe('quick')
    expect(rows(db)[0]!.ok).toBe(1)
  })
})

// ★ 201 rate-limited turn calls and 38 gists in the live ledger came in failure pairs 5.5 s
// apart: the retry re-asked inside the window that had just refused it, and paid for both.
describe('a re-ask waits out the window it was refused in', () => {
  const refused = new APICallError({
    message: 'Provider returned error',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    requestBodyValues: {},
    statusCode: 429,
  })

  const answeringAfter = (fail: Error): MockLanguageModelV4 => {
    let n = 0
    return new MockLanguageModelV4({
      doGenerate: () => {
        n += 1
        if (n === 1) return Promise.reject(fail)
        return Promise.resolve({
          content: [{ type: 'text' as const, text: 'ok' }],
          finishReason: { unified: 'stop' as const, raw: undefined },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: undefined },
            outputTokens: { total: 1, text: 1, reasoning: 0 },
          },
          warnings: [],
        })
      },
    })
  }

  it('waits seconds on a rate limit, however the provider spelled it', () => {
    for (const err of [refused, new Error('429 Too Many Requests'), new Error('Rate-limit hit')]) {
      const ms = retryBackoffMs(err)
      expect(ms, String(err)).toBeGreaterThanOrEqual(2_000)
      expect(ms, String(err)).toBeLessThan(4_000)
    }
  })

  it('waits for nothing else, so an ordinary stall still retries at once', () => {
    expect(retryBackoffMs(new Error('scripted failure'))).toBe(0)
  })

  it('jitters, so a fleet of minds refused together does not re-ask together', () => {
    const draws = new Set(Array.from({ length: 20 }, () => retryBackoffMs(refused)))
    expect(draws.size).toBeGreaterThan(1)
  })

  it('sleeps before the retry that follows a 429, and books both attempts', async () => {
    const db = openDb()
    const model = answeringAfter(refused)
    const client = new LlmClient({ model, db, caller: 'test', maxRetries: 1 })
    const started = Date.now()
    expect((await client.text({ messages: [{ role: 'user', content: 'u' }] })).text).toBe('ok')
    expect(
      Date.now() - started,
      'the retry re-asked inside the same window',
    ).toBeGreaterThanOrEqual(2_000)
    expect(rows(db)).toHaveLength(2)
  })

  it('does not sleep before the retry that follows an ordinary failure', async () => {
    const db = openDb()
    const model = answeringAfter(new Error('scripted failure'))
    const client = new LlmClient({ model, db, caller: 'test', maxRetries: 1 })
    const started = Date.now()
    await client.text({ messages: [{ role: 'user', content: 'u' }] })
    expect(Date.now() - started, 'a dead back end is not a busy one').toBeLessThan(100)
    expect(rows(db)).toHaveLength(2)
  })

  // No pinned caller goes under the 30 s floor, so this guards the caller that overrides it.
  it('fails fast rather than sleep past a bound the caller cut below the wait', async () => {
    const db = openDb()
    const model = answeringAfter(refused)
    const client = new LlmClient({ model, db, caller: 'test', maxRetries: 1, requestTimeoutMs: 50 })
    const started = Date.now()
    await expect(client.text({ messages: [{ role: 'user', content: 'u' }] })).rejects.toThrow(
      'Provider returned error',
    )
    expect(Date.now() - started, 'no wait it could not afford').toBeLessThan(1_000)
    expect(rows(db), 'the retry it had no time for was never made').toHaveLength(1)
    expect(alertsOf(db, 'llm_call_failed')[0]).toContain('test: 1 attempt(s) failed')
  })
})

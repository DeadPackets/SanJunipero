import { beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { APICallError, NoObjectGeneratedError } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { z } from 'zod'
import { mockModel, recordingModel } from './testutil/mockModel.js'
import {
  insertLlmCall,
  makeBudgetGuard,
  mergeBlockTokens,
  migrateLlmTables,
  sumReserved,
  type Reserved,
} from './callLog.js'

const idOf = (r: Reserved): number => {
  if ('held' in r) throw new Error(`expected a reservation, got ${r.held}`)
  return r.id
}
import {
  BudgetExceededError,
  LlmClient,
  MIN_QUEUE_WAIT_MS,
  defaultExtraBody,
  retryBackoffMs,
  servedProvider,
} from './client.js'
import { DEFAULT_MAX_CONCURRENCY, limiterFor, resetLimiters } from './rateLimiter.js'
import {
  FALLBACK_MODELS,
  MIND_MODEL,
  MIN_REQUEST_TIMEOUT_MS,
  PINNED_CALLERS,
  PROVIDER_ORDER,
  callSettingsFor,
  requestTimeoutMsFor,
  PRICE_PER_M,
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

// The admission gates live for the process, so one test's refusal would otherwise hold the next
// test's calls behind its cool-down.
beforeEach(resetLimiters)

describe('migrateLlmTables', () => {
  it('is idempotent', () => {
    const db = openDb()
    expect(() => {
      migrateLlmTables(db)
    }).not.toThrow()
  })

  // ★ A reservation is released in a JS `finally`, so a kill or an OOM leaves it behind and it
  // counts against that caller's budget for ever. One process owns the ledger: boot clears them.
  it('★ clears the reservations a killed process left behind, and no call it billed', () => {
    const db = openDb()
    db.prepare('INSERT INTO llm_reservations (ts, caller, amount_usd) VALUES (?, ?, ?)').run(
      Date.now(),
      'reflection',
      0.005,
    )
    insertLlmCall(db, {
      agentId: null,
      caller: 'reflection',
      model: 'm',
      provider: 'Wafer',
      inputTokens: 10,
      outputTokens: 2,
      cacheReadTokens: 0,
      reasoningTokens: 0,
      costUsd: 0.01,
      estimatedCostUsd: 0.01,
      reportedCostUsd: null,
      latencyMs: 90,
      finishReason: 'stop',
      ok: true,
      error: null,
    })

    migrateLlmTables(db)

    expect(db.prepare('SELECT COUNT(*) AS n FROM llm_reservations').get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM llm_calls').get()).toEqual({ n: 1 })
  })

  it('adds the two bill columns to a table that predates them, leaving its rows alone', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE llm_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, agent_id TEXT,
        caller TEXT NOT NULL, model TEXT NOT NULL, input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL, cache_read_tokens INTEGER NOT NULL,
        reasoning_tokens INTEGER NOT NULL, cost_usd REAL NOT NULL, estimated_cost_usd REAL,
        reported_cost_usd REAL, latency_ms INTEGER NOT NULL, ok INTEGER NOT NULL, error TEXT,
        provider TEXT, finish_reason TEXT, generation_id TEXT);
      INSERT INTO llm_calls VALUES
        (1, 7, 'tamar', 'turn', 'm', 10, 2, 0, 0, 0.5, 0.5, NULL, 90, 1, NULL, 'Wafer', 'stop', NULL);
    `)
    migrateLlmTables(db)

    const row = db.prepare('SELECT * FROM llm_calls WHERE id = 1').get() as Record<string, unknown>
    expect(row.caller).toBe('turn')
    expect(row.cost_usd).toBe(0.5)
    expect(row.wake_reason).toBeNull()
    expect(row.wake_reasons).toBeNull()
    expect(row.block_tokens).toBeNull()
  })
})

// Why a turn was bought and what its prompt weighed. Null for every caller with no wake —
// reflection, arbiter, pre-flight — and for every row written before the columns existed.
describe('the wake reason and the block bill', () => {
  const call = {
    agentId: 'tamar',
    caller: 'turn',
    model: MIND_MODEL,
    provider: 'Wafer',
    inputTokens: 8000,
    outputTokens: 300,
    cacheReadTokens: 2048,
    reasoningTokens: 0,
    costUsd: 0.001,
    estimatedCostUsd: 0.001,
    reportedCostUsd: null,
    latencyMs: 900,
    finishReason: 'stop',
    ok: true,
    error: null,
  }

  it('round-trips a wake reason, everything else that was true, and the block JSON', () => {
    const db = openDb()
    const id = insertLlmCall(db, {
      ...call,
      wakeReason: 'salient_perception',
      wakeReasons: ['salient_perception', 'plan_done'],
      blockTokens: { shared: 2067, dayLog: 4200, _priorStepsLeft: 3 },
    })

    const row = db.prepare('SELECT * FROM llm_calls WHERE id = ?').get(id) as {
      wake_reason: string | null
      wake_reasons: string | null
      block_tokens: string | null
    }
    expect(row.wake_reason).toBe('salient_perception')
    expect(JSON.parse(row.wake_reasons!)).toEqual(['salient_perception', 'plan_done'])
    expect(JSON.parse(row.block_tokens!)).toEqual({
      shared: 2067,
      dayLog: 4200,
      _priorStepsLeft: 3,
    })
  })

  it('reads back a row written without either, as a caller with no wake writes one', () => {
    const db = openDb()
    const id = insertLlmCall(db, { ...call, caller: 'reflection' })

    const row = db.prepare('SELECT * FROM llm_calls WHERE id = ?').get(id) as {
      caller: string
      wake_reason: string | null
      wake_reasons: string | null
      block_tokens: string | null
    }
    expect(row.caller).toBe('reflection')
    expect(row.wake_reason).toBeNull()
    expect(row.wake_reasons).toBeNull()
    expect(row.block_tokens).toBeNull()
  })

  it('merges what the answer turned out to be worth into the row already written', () => {
    const db = openDb()
    const id = insertLlmCall(db, {
      ...call,
      wakeReason: 'boredom',
      blockTokens: { shared: 2067, _priorStepsLeft: 0 },
    })
    mergeBlockTokens(db, id, { _planSize: 4 })

    const row = db.prepare('SELECT block_tokens AS json FROM llm_calls WHERE id = ?').get(id) as {
      json: string
    }
    expect(JSON.parse(row.json)).toEqual({ shared: 2067, _priorStepsLeft: 0, _planSize: 4 })
  })

  it('starts the block JSON from nothing when the row carried none', () => {
    const db = openDb()
    const id = insertLlmCall(db, call)
    mergeBlockTokens(db, id, { _planSize: 0 })

    const row = db.prepare('SELECT block_tokens AS json FROM llm_calls WHERE id = ?').get(id) as {
      json: string
    }
    expect(JSON.parse(row.json)).toEqual({ _planSize: 0 })
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
        provider: 'OpenAI',
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

    const P = PRICE_PER_M
    const expectedCost = ((1000 - 600) * P.input + 600 * P.cacheRead + 50 * P.output) / 1e6
    // Worked by hand off the pinned row, so a formula derived from the same table cannot agree
    // with itself and be wrong: (400 x 0.25 + 600 x 0.02 + 50 x 1.20) / 1e6.
    expect(expectedCost).toBeCloseTo(0.000172, 10)
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
        provider: 'OpenAI',
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
    const expectedCost = (500 * PRICE_PER_M.input + 6168 * PRICE_PER_M.output) / 1e6
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
    // The pinned price for these tokens, whatever the table currently says it is.
    const model = mockModel([
      {
        text: 'a',
        provider: 'OpenAI',
        servedModelId: MIND_MODEL,
        usage: { inputTokens: 1000, outputTokens: 1000 },
        reportedCostUsd: 0.003,
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
    expect(detail).toContain('OpenAI')
    expect(detail).toContain('the pin is stale')
    // The bill wins: the ledger books what was charged, not what the table guessed.
    expect(rows(db)[0]!.cost_usd).toBeCloseTo(0.003, 12)
  })

  it('is silent when the table agrees with the provider', async () => {
    const db = openDb()
    const model = mockModel([
      {
        text: 'a',
        provider: 'OpenAI',
        servedModelId: MIND_MODEL,
        usage: { inputTokens: 1000, outputTokens: 1000 },
        reportedCostUsd: (1000 * PRICE_PER_M.input + 1000 * PRICE_PER_M.output) / 1e6,
      },
    ])
    const client = new LlmClient({ model, db, caller: 'test' })
    await client.text({ messages: [{ role: 'user', content: 'u' }] })
    expect(kinds(db)).toEqual([])
  })

  it('stays silent on sub-cent rounding rather than crying wolf', async () => {
    const db = openDb()
    const exact = (10 * PRICE_PER_M.input + 2 * PRICE_PER_M.output) / 1e6
    const model = mockModel([
      {
        text: 'a',
        provider: 'OpenAI',
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
    expect(row.cost_usd).toBeGreaterThan(
      (1000 * PRICE_PER_M.input + 1000 * PRICE_PER_M.output) / 1e6,
    )
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
    const a = mine.reserve(0.005, 1, null)
    theirs.reserve(0.005, 1, null)
    expect(mine.sumReserved()).toBeCloseTo(0.005, 10)
    expect(theirs.sumReserved()).toBeCloseTo(0.005, 10)
    mine.release(idOf(a))
    expect(mine.sumReserved()).toBe(0)
    expect(theirs.sumReserved()).toBeCloseTo(0.005, 10)
  })

  it('refuses the reservation that would cross the cap and admits it again once released', () => {
    const db = openDb()
    const guard = makeBudgetGuard(db, 'test')
    const first = guard.reserve(0.005, 0.006, null)
    expect(first).not.toHaveProperty('held')
    expect(guard.reserve(0.005, 0.006, null)).toEqual({ held: 'budget', spentUsd: 0 })
    guard.release(idOf(first))
    expect(guard.reserve(0.005, 0.006, null)).not.toHaveProperty('held')
  })
})

describe('★ the one-way glass, on every prompt a mind reads', () => {
  const CALLERS = ['turn', 'reflection', 'dream', 'naming', 'arbiter'] as const

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

  // ★ The repair rung appends the provider's own bytes and the schema complaint AFTER the one
  // sealing pass — the only two messages in the client that reached a provider unsealed.
  it('★ seals the two messages the repair rung appends', async () => {
    const db = openDb()
    const { model, sent } = recordingModel([
      { text: 'god_afterlife, and not JSON either' },
      { json: { a: 1 } },
    ])
    await new LlmClient({ model, db, caller: 'turn' }).object({
      system: 'You are Amara.',
      messages: [{ role: 'user', content: 'answer' }],
      schema: z.object({ a: z.number() }),
      repairOnce: true,
    })

    expect(sent, 'the repair rung never ran').toHaveLength(2)
    expect(sent[1]).not.toContain('god_afterlife')
    expect(sent[1]).toContain('[redacted]')
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

  it('hands an ops recogniser its own words, because its question is made of them', async () => {
    const db = openDb()
    const { model, sent } = recorder()
    const ask = 'Answer with the id: god_afterlife, multi_day_plan. first_bridge counts.'
    await new LlmClient({ model, db, caller: 'semantic', audience: 'ops' }).text({
      system: ask,
      messages: [{ role: 'user', content: 'god_afterlife' }],
    })
    expect(sent[0]).toContain(ask)
    expect(sent[0]).not.toContain('[redacted]')
    expect(db.prepare("SELECT COUNT(*) AS n FROM alerts WHERE kind = 'glass_leak'").get()).toEqual({
      n: 0,
    })
  })

  it('seals a caller nobody declared, so a new one is a mind’s until it says otherwise', async () => {
    const db = openDb()
    const { model, sent } = recorder()
    await new LlmClient({ model, db, caller: 'a-caller-added-next-year' }).text({
      system: 'god_afterlife',
      messages: [{ role: 'user', content: 'hello' }],
    })
    expect(sent[0]).not.toContain('god_afterlife')
  })
})

describe('default OpenRouter path extraBody', () => {
  it('builds models + provider pinning from pins.ts', () => {
    expect(defaultExtraBody()).toEqual({
      models: [MIND_MODEL, ...FALLBACK_MODELS],
      provider: { order: PROVIDER_ORDER, allow_fallbacks: false, require_parameters: false },
    })
    expect(defaultExtraBody(['x/y'], ['P'])).toEqual({
      models: [MIND_MODEL, 'x/y'],
      provider: { order: ['P'], allow_fallbacks: false, require_parameters: false },
    })
  })

  // r15 sent the pair as `only` to win sticky routing: OpenRouter put every call on DeepInfra,
  // which rate-limited 27% of them upstream. `order` keeps Wafer first, as r13 measured; the
  // per-mind session id still rides along and costs nothing while an order is named.
  it('★ every route sends an ordered preference, and a mind’s calls carry its session id', () => {
    const mind = defaultExtraBody(
      FALLBACK_MODELS,
      PROVIDER_ORDER,
      false,
      undefined,
      MIND_MODEL,
      'sj-amara',
    )
    expect(mind.provider).toEqual({
      order: PROVIDER_ORDER,
      allow_fallbacks: false,
      require_parameters: false,
    })
    expect(mind.session_id).toBe('sj-amara')
    const prose = defaultExtraBody(FALLBACK_MODELS, ['P', 'Q'], false, undefined, 'x/y')
    expect(prose.provider).toEqual({
      order: ['P', 'Q'],
      allow_fallbacks: false,
      require_parameters: false,
    })
    expect(prose.session_id).toBeUndefined()
  })

  it('★ an OpenAI model carries the mind’s session id as its prompt cache key too', () => {
    const luna = defaultExtraBody(
      [],
      ['OpenAI'],
      false,
      undefined,
      'openai/gpt-5.6-luna',
      'sj-amara',
    )
    expect(luna.prompt_cache_key).toBe('sj-amara')
    expect(luna.prompt_cache_key).toBe(
      defaultExtraBody(FALLBACK_MODELS, PROVIDER_ORDER, false, undefined, MIND_MODEL, 'sj-amara')
        .prompt_cache_key,
    )
    // The key is OpenAI's: a model served anywhere else gets the session id and nothing more.
    const glm = defaultExtraBody([], ['Wafer'], false, undefined, 'z-ai/glm-5.3-flash', 'sj-amara')
    expect(glm.prompt_cache_key).toBeUndefined()
    const noMind = defaultExtraBody([], ['OpenAI'], false, undefined, 'openai/gpt-5.6-luna')
    expect(noMind.prompt_cache_key).toBeUndefined()
  })

  // Sticky routing keys off this and nothing else. One per mind, not per caller: the turn and
  // the scene line carry the same identity block and want the same warm back end.
  it('★ names the mind asking, so its next call lands on the back end holding its prefix', () => {
    const db = openDb()
    expect(new LlmClient({ db, caller: 'turn', agentId: 'nadia' }).requestBody().session_id).toBe(
      'sj-nadia',
    )
    expect(new LlmClient({ db, caller: 'scene', agentId: 'nadia' }).requestBody().session_id).toBe(
      'sj-nadia',
    )
    // Nobody's call: the narrator and the court have no prefix of their own to keep warm.
    expect(new LlmClient({ db, caller: 'narrator' }).requestBody()).not.toHaveProperty('session_id')
  })

  // A live town pins the provider as an allow-list: 9 of 309 rehearsal-3 calls hopped to
  // OpenInference, each one a cold prefix and an unpriced route.
  it('★ carries allow_fallbacks:false for every mind caller, with nothing asked for', () => {
    const db = openDb()
    for (const caller of ['turn', 'reflection', 'dream', 'naming', 'arbiter', 'semantic']) {
      const body = new LlmClient({ db, caller }).requestBody()
      expect(body.provider.allow_fallbacks, caller).toBe(false)
      // And no floating alias can answer instead of the model this caller was pinned to.
      expect(body.models, caller).toEqual([MIND_MODEL])
    }
  })

  // ★ One model at one home for every caller: the body each sends must name that pair and no
  // other, or a json_schema lands on a back end that answers with a thought and no act.
  it('★ every caller sends the one fleet row, model and back end together', () => {
    const db = openDb()
    const body = (caller: string): { models: string[]; homes: string[] | undefined } => {
      const b = new LlmClient({ db, caller }).requestBody()
      return { models: b.models, homes: b.provider.only ?? b.provider.order }
    }
    for (const caller of [...PINNED_CALLERS, 'nobody-pinned-this'])
      expect(body(caller), caller).toEqual({ models: [MIND_MODEL], homes: PROVIDER_ORDER })
  })

  // A closed allow-list: a name outside it is a hard failure. One home, because `openai/fast`
  // bills 2x for the same answer and is the only other one.
  it('★ the request body carries exactly the pinned allow-list', () => {
    expect(PROVIDER_ORDER).toEqual(['OpenAI'])
    expect(new LlmClient({ db: openDb(), caller: 'turn' }).requestBody().provider).toEqual({
      order: PROVIDER_ORDER,
      allow_fallbacks: false,
      require_parameters: false,
    })
  })

  // ★ Single-homed, the retry is the whole safety net, so it has to cover a back end that
  // refused as well as one that stalled — and it must not widen the allow-list to do it.
  it('★ a provider refusal is retried once, inside the same allow-list', async () => {
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
    expect(client.requestBody().provider).toEqual({
      order: PROVIDER_ORDER,
      allow_fallbacks: false,
      require_parameters: false,
    })
  })

  // 8 of the 30 endpoints serving MIND_MODEL cannot do structured output, so leaving the
  // allow-list is a switch a caller has to throw.
  it('opting back into provider fallbacks is possible, and says so in the body', () => {
    expect(defaultExtraBody(['x/y'], ['P'], true)).toEqual({
      models: [MIND_MODEL, 'x/y'],
      provider: { order: ['P'], allow_fallbacks: true, require_parameters: false },
    })
  })

  // The effort rungs are indistinguishable in practice; only `enabled:false` takes reasoning
  // to zero. Unset bills the same as `high`, so leaving it unset asks for the maximum.
  it('carries a reasoning setting into the body, and sends none when none is asked for', () => {
    expect(defaultExtraBody(['x/y'], ['P'], true, { enabled: false })).toEqual({
      models: [MIND_MODEL, 'x/y'],
      provider: { order: ['P'], allow_fallbacks: true, require_parameters: false },
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
    expect(night.requestBody().reasoning).toEqual({ effort: 'medium' })
    expect(edit.requestBody().reasoning).toEqual({ effort: 'medium' })
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
      `turn: the answer stopped at the ${callSettingsFor('turn').maxOutputTokens} output token ceiling — raise it or the answer is a fragment`,
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
    expect(alertsOf(db, 'llm_output_truncated')[0]).toContain(
      `${callSettingsFor('arbiter').maxOutputTokens} output token ceiling`,
    )
    // Two asks, not three: the second was the one fallback, and a runaway is never re-asked as is.
    expect(alertsOf(db, 'reasoning_runaway')).toHaveLength(1)
  })

  // r37: 8 of 33 rulings burned the whole ceiling thinking, answered nothing, and were asked the
  // same way again — a quarter of the town's inventions lost at four minutes and 3 cents each.
  it('★ a ruling that thinks itself out of tokens is asked once more at the lower effort', async () => {
    const db = openDb()
    const model = mockModel([
      {
        emptyOutput: true,
        finishReason: 'length',
        usage: { inputTokens: 900, outputTokens: 16_000 },
      },
      { json: { mood: 'calm', count: 1 }, usage: { inputTokens: 900, outputTokens: 3000 } },
    ])
    const got = await new LlmClient({ model, db, caller: 'arbiter' }).object({
      system: 's',
      messages: [{ role: 'user', content: 'u' }],
      schema: SCHEMA,
    })
    expect(got.value).toEqual({ mood: 'calm', count: 1 })
    const logged = rows(db)
    expect(logged.map((r) => r.ok)).toEqual([0, 1])
    expect(alertsOf(db, 'reasoning_runaway')).toEqual([
      'arbiter: 16000 tokens at xhigh and no answer; asking once more at high',
    ])
    expect(alertsOf(db, 'llm_call_failed')).toEqual([])
  })

  it('a caller with no fallback effort is not asked the identical runaway twice', async () => {
    const db = openDb()
    const model = mockModel([
      {
        emptyOutput: true,
        finishReason: 'length',
        usage: { inputTokens: 100, outputTokens: 7500 },
      },
      { json: { mood: 'calm', count: 1 } },
    ])
    await expect(
      new LlmClient({ model, db, caller: 'turn' }).object({
        system: 's',
        messages: [{ role: 'user', content: 'u' }],
        schema: SCHEMA,
      }),
    ).rejects.toThrow()
    expect(rows(db)).toHaveLength(1)
    expect(alertsOf(db, 'reasoning_runaway')).toEqual([])
  })

  it('the fallback body carries the lower effort and nothing else changes', () => {
    const db = openDb()
    const client = new LlmClient({ db, caller: 'arbiter' })
    expect(client.requestBody().reasoning).toEqual({ effort: 'xhigh' })
    const fallback = client.requestBody({ effort: 'high' })
    expect(fallback.reasoning).toEqual({ effort: 'high' })
    expect({ ...fallback, reasoning: undefined }).toEqual({
      ...client.requestBody(),
      reasoning: undefined,
    })
  })
})

describe('★ one unified call discipline, the arbiter included', () => {
  // ★ A flat 30 s would abort `reflection.edit` and `arbiter` well inside their own measured
  // p99s. The bound a caller gets is the time its OWN output ceiling needs, floored at 30 s.
  it('bounds every caller, and never under the time its own ceiling needs', () => {
    const db = openDb()
    const bound = (caller: string): number =>
      (new LlmClient({ db, caller }) as unknown as { requestTimeoutMs: number }).requestTimeoutMs
    expect(bound('nobody-pinned-this')).toBe(MIN_REQUEST_TIMEOUT_MS)
    // The route's own floor: a restating caller's 1,500-token ceiling needs 34 s, and the
    // model's tail is its thinking, so the 90 s floor rules where the ceiling is small.
    expect(bound('constructs')).toBe(90_000)
    expect(bound('turn')).toBe(Math.ceil((7500 / 44) * 1000))
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
      'arbiter: 2 attempt(s) failed, the last bounded at 455s — scripted failure',
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

  // ★ An answer the schema turned away still billed, and `note` never ran to record what served
  // it. r13 booked 3 such `semantic` rows at the ceiling with no id to ask OpenRouter about.
  it('★ writes it for a refused answer too, which is the row that books at the ceiling', async () => {
    const db = openDb()
    const model = mockModel([{ text: 'not json at all', generationId: 'gen-dead' }])
    await expect(
      new LlmClient({ model, db, caller: 'semantic' }).object({
        system: 's',
        messages: [{ role: 'user', content: 'u' }],
        schema: SCHEMA,
      }),
    ).rejects.toThrow()
    const row = db.prepare('SELECT generation_id AS g, ok FROM llm_calls').get() as {
      g: string | null
      ok: number
    }
    expect([row.g, row.ok]).toEqual(['gen-dead', 0])
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
const refused = new APICallError({
  message: 'Provider returned error',
  url: 'https://openrouter.ai/api/v1/chat/completions',
  requestBodyValues: {},
  statusCode: 429,
})

describe('a re-ask waits out the window it was refused in', () => {
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

  // ★ r3: the first attempt was refused 35% of the time and the second 75% — one 2 s-wide
  // window is not spread enough for five minds refused in the same instant.
  it('widens the window each time it is refused again', () => {
    for (const [attempt, low] of [
      [0, 2_000],
      [1, 4_000],
      [2, 8_000],
    ] as const) {
      const draws = Array.from({ length: 40 }, () => retryBackoffMs(refused, attempt))
      expect(Math.min(...draws), `attempt ${attempt}`).toBeGreaterThanOrEqual(low)
      expect(Math.max(...draws), `attempt ${attempt}`).toBeLessThan(low * 2)
    }
  })

  // The last wait a re-asking caller can draw must still fit inside its own bound, or the guard
  // below turns every re-ask into an immediate hard failure.
  it('never waits longer than the bound a re-asking caller runs on', () => {
    const last = Math.max(...Array.from({ length: 200 }, () => retryBackoffMs(refused, 2)))
    expect(last).toBeLessThan(requestTimeoutMsFor('reflection'))
  })

  // ★ Six reflection calls must land in a row before the night writes its gists; at two attempts
  // each, r3 got 1 night in 10 that far. A 429 bills nothing, so the re-asks are free.
  const refusing = (n: number): MockLanguageModelV4 => {
    let sent = 0
    return new MockLanguageModelV4({
      doGenerate: () => {
        sent += 1
        if (sent > n)
          throw new Error(`re-asked ${sent} times, more than the ${n} it was pinned for`)
        return Promise.reject(refused)
      },
    })
  }

  it.each([
    ['reflection', 4],
    ['turn', 2],
  ])('re-asks %s past a burst as many times as it is pinned for', async (caller, attempts) => {
    // The widening waits are the point elsewhere; here only the count is, so the clock is driven
    // rather than waited out. Each attempt is refused before any timer of its own can fire.
    vi.useFakeTimers()
    try {
      const db = openDb()
      const model = refusing(attempts)
      const call = new LlmClient({ model, db, caller })
        .text({ messages: [{ role: 'user', content: 'u' }] })
        .catch((err: unknown) => err)
      for (let i = 0; i < attempts; i++) await vi.advanceTimersByTimeAsync(20_000)
      expect(await call).toBeInstanceOf(APICallError)
      expect(model.doGenerateCalls).toHaveLength(attempts)
      expect(alertsOf(db, 'llm_call_failed')[0]).toContain(`${caller}: ${attempts} attempt(s)`)
    } finally {
      vi.useRealTimers()
    }
  })

  // ★ reflection.edit's bound is 295 s. Spending the burst budget on a stall instead would sit
  // that out four times over, and unlike a 429 every one of them is billed.
  it('spends the burst budget on a burst only, never on a stall', async () => {
    const db = openDb()
    const model = mockModel([{ fail: true }, { fail: true }])
    await expect(
      new LlmClient({ model, db, caller: 'reflection.edit' }).text({
        messages: [{ role: 'user', content: 'u' }],
      }),
    ).rejects.toThrow('scripted failure')
    expect(model.doGenerateCalls).toHaveLength(2)
  })

  // ★ A model that answers off-schema is not a transient fault, and the response_format path has
  // never re-asked one. The tool path threw a plain Error, so the loop billed a second ask.
  it('★ never re-asks a tool call the schema refused', async () => {
    const db = openDb()
    const model = mockModel([{ text: 'no tool call at all' }, { text: 'nor this one' }])
    await expect(
      new LlmClient({ model, db, caller: 'turn', transport: 'tool' }).object({
        system: 's',
        messages: [{ role: 'user', content: 'u' }],
        schema: z.object({ a: z.number() }),
      }),
    ).rejects.toThrow(/tool transport/)
    expect(model.doGenerateCalls, 'an off-schema answer was asked for twice').toHaveLength(1)
  })

  // ★ In the 2026-09-10 tool trial, 7 of 11 faults were a schema-valid turn sitting in the
  // model's text channel with no tool call made, and the transport threw all seven away.
  it('★ reads a turn the model wrote as prose instead of calling the tool', async () => {
    const db = openDb()
    const model = mockModel([
      {
        text: 'Sure, here is the turn:\n{"mood":"calm","count":3}',
        usage: { inputTokens: 900, outputTokens: 40 },
        provider: 'OpenAI',
        servedModelId: MIND_MODEL,
      },
    ])
    const got = await new LlmClient({ model, db, caller: 'turn', transport: 'tool' }).object({
      system: 's',
      messages: [{ role: 'user', content: 'u' }],
      schema: SCHEMA,
    })
    expect(got.value).toEqual({ mood: 'calm', count: 3 })
    // One call, not two, and the row is an answer rather than a fault: it was never re-asked.
    expect(model.doGenerateCalls).toHaveLength(1)
    expect(rows(db).map((r) => r.ok)).toEqual([1])
    expect(rows(db)[0]!.output_tokens).toBe(40)
    expect(alertsOf(db, 'decode_repaired')[0]).toContain('turn')
  })

  // A model that wrote prose and skipped the tool did not think itself out of tokens. The
  // transport reported the call it never made as `null`, so the court billed a second ask for it.
  it('does not call a prose answer a runaway, whatever cut it off', async () => {
    const db = openDb()
    const model = mockModel([
      {
        text: 'The mood was calm but I did not count.',
        finishReason: 'length',
        usage: { inputTokens: 900, outputTokens: 16_000 },
      },
      { json: { mood: 'calm', count: 1 } },
    ])
    await expect(
      new LlmClient({ model, db, caller: 'arbiter', transport: 'tool' }).object({
        system: 's',
        messages: [{ role: 'user', content: 'u' }],
        schema: SCHEMA,
      }),
    ).rejects.toThrow(/tool transport/)
    expect(model.doGenerateCalls, 'a written answer was re-asked as a runaway').toHaveLength(1)
    expect(alertsOf(db, 'reasoning_runaway')).toEqual([])
  })

  // A model that answers the word null answered something. It used to read as the stringified
  // tool call nobody made, and the court billed a second ask for it.
  it('does not call an answer of null a runaway either', async () => {
    const db = openDb()
    const model = mockModel([
      { text: 'null', finishReason: 'length', usage: { inputTokens: 900, outputTokens: 16_000 } },
      { json: { mood: 'calm', count: 1 } },
    ])
    await expect(
      new LlmClient({ model, db, caller: 'arbiter', transport: 'tool' }).object({
        system: 's',
        messages: [{ role: 'user', content: 'u' }],
        schema: SCHEMA,
      }),
    ).rejects.toThrow(/tool transport/)
    expect(model.doGenerateCalls, 'an answer of null was re-asked as a runaway').toHaveLength(1)
    expect(alertsOf(db, 'reasoning_runaway')).toEqual([])
  })

  // ★ The stall budget used to be re-armed by a burst: once `attempt` had passed `maxRetries`,
  // the stall check could never fire again, so reflection billed three 45 s stalls for two.
  it('spends the stall budget once, whatever order a burst arrives in', async () => {
    vi.useFakeTimers()
    try {
      const db = openDb()
      let sent = 0
      const script = [new Error('scripted failure'), refused, new Error('scripted failure')]
      const model = new MockLanguageModelV4({
        doGenerate: () => {
          sent += 1
          return Promise.reject(script[sent - 1] ?? new Error(`re-asked ${sent} times, for three`))
        },
      })
      const call = new LlmClient({ model, db, caller: 'reflection' })
        .text({ messages: [{ role: 'user', content: 'u' }] })
        .catch((err: unknown) => err)
      for (let i = 0; i < 4; i++) await vi.advanceTimersByTimeAsync(20_000)
      await call
      expect(model.doGenerateCalls, 'two stalls billed, not three').toHaveLength(3)
      expect(alertsOf(db, 'llm_call_failed')[0]).toContain('reflection: 3 attempt(s)')
    } finally {
      vi.useRealTimers()
    }
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

// ★ r3: 27-35% of turn attempts were refused at the door because five minds, their reflections
// and the court all fired into one back end's per-key concurrency with nothing coordinating them.
describe('the fleet meets the provider through one gate', () => {
  const holding = (): { model: MockLanguageModelV4; live: () => number; open: () => void } => {
    let live = 0
    const gates: (() => void)[] = []
    return {
      live: () => live,
      open: () => {
        for (const g of gates.splice(0)) g()
      },
      model: new MockLanguageModelV4({
        doGenerate: async () => {
          live += 1
          await new Promise<void>((resolve) => gates.push(resolve))
          live -= 1
          return {
            content: [{ type: 'text' as const, text: 'ok' }],
            finishReason: { unified: 'stop' as const, raw: undefined },
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: undefined },
              outputTokens: { total: 1, text: 1, reasoning: 0 },
            },
            warnings: [],
          }
        },
      }),
    }
  }

  it('never lets more minds at the back end at once than the cap allows', async () => {
    const db = openDb()
    const held = holding()
    // Two more than the gate allows, whatever the gate allows: the cap is a measured number and
    // this test is about the queue, not about its value.
    const over = DEFAULT_MAX_CONCURRENCY + 2
    const asks = Array.from({ length: over }, (_, i) =>
      new LlmClient({ model: held.model, db, caller: 'turn', agentId: `a${i}` }).text({
        messages: [{ role: 'user', content: 'u' }],
      }),
    )
    await vi.waitFor(() => {
      expect(held.live()).toBe(DEFAULT_MAX_CONCURRENCY)
    })
    expect(held.live(), 'the excess is queued, not refused').toBe(DEFAULT_MAX_CONCURRENCY)
    held.open()
    await vi.waitFor(() => {
      expect(held.live()).toBe(2)
    })
    held.open()
    await Promise.all(asks)
    expect(rows(db)).toHaveLength(over)
  })

  it('gives up unsent rather than bill a wait it has no patience for', async () => {
    const db = openDb()
    const held = holding()
    // Exactly enough to fill the gate, so the next one has nowhere to go.
    const blocking = Array.from({ length: DEFAULT_MAX_CONCURRENCY }, (_, i) =>
      new LlmClient({ model: held.model, db, caller: 'turn', agentId: `a${i}` }).text({
        messages: [{ role: 'user', content: 'u' }],
      }),
    )
    await vi.waitFor(() => {
      expect(held.live()).toBe(DEFAULT_MAX_CONCURRENCY)
    })
    const late = new LlmClient({
      model: held.model,
      db,
      caller: 'turn',
      agentId: 'e',
      maxQueueWaitMs: 20,
    }).text({ messages: [{ role: 'user', content: 'u' }] })
    await expect(late).rejects.toThrow('no slot on')
    expect(rows(db), 'the gate is full, and the next never reached the provider').toHaveLength(0)
    expect(alertsOf(db, 'llm_call_failed')[0]).toContain('turn: 1 attempt(s)')
    held.open()
    await Promise.all(blocking)
  })

  // ★ 9 of r13's 13 dozes read "no slot after 0 ms": the first attempt stalled out the whole
  // queue budget and the re-ask reached a full pool with nothing left to wait with.
  it('★ a re-ask joins the gate with real patience, not the 0 ms its stall left behind', async () => {
    const db = openDb()
    const gate = limiterFor(PROVIDER_ORDER.join(','))
    const waits: number[] = []
    const straightThrough = gate.run.bind(gate)
    vi.spyOn(gate, 'run').mockImplementation(async (exec, maxWaitMs) => {
      waits.push(maxWaitMs)
      return await straightThrough(exec, maxWaitMs)
    })
    const model = mockModel([{ fail: true }, { text: 'ok' }])
    await new LlmClient({ model, db, caller: 'turn', maxQueueWaitMs: 0 }).text({
      messages: [{ role: 'user', content: 'u' }],
    })
    expect(waits[0], 'the first attempt spends exactly the patience it was pinned').toBe(0)
    expect(waits[1], 'and the re-ask is not sent to the gate empty-handed').toBe(MIN_QUEUE_WAIT_MS)
  })

  // The gate's state is worth one line to the operator, not one line per call: a pin stuck at
  // single file is 5 minds taking turns, and no ledger column says so.
  it('files one alert, not one per call, when the pin has gone single-file', async () => {
    vi.useFakeTimers()
    try {
      const db = openDb()
      const gate = limiterFor(PROVIDER_ORDER.join(','))
      // The cap gives ground only to a refusal our own calls were part of, so one is held in
      // flight while three are refused beside it: 8 -> 4 -> 2 -> 1.
      let release!: () => void
      const busy = new Promise<string>((res) => {
        release = () => {
          res('done')
        }
      })
      void gate.run(() => busy, 60_000)
      for (let i = 0; i < 3; i++) {
        void gate.run(() => Promise.reject(refused), 0).catch(() => null)
        await vi.advanceTimersByTimeAsync(2_000)
      }
      expect(gate.state().cap).toBe(1)
      release()
      await vi.advanceTimersByTimeAsync(60_000)
      for (let i = 0; i < 3; i++) {
        await new LlmClient({ model: mockModel([{ text: 'ok' }]), db, caller: 'turn' }).text({
          messages: [{ role: 'user', content: 'u' }],
        })
      }
      expect(alertsOf(db, 'llm_rate_pinned')).toHaveLength(1)
      expect(alertsOf(db, 'llm_rate_pinned')[0]).toContain('one call at a time')
    } finally {
      vi.useRealTimers()
    }
  })
})

import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { NoObjectGeneratedError } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { z } from 'zod'
import { mockModel } from './testutil/mockModel.js'
import { makeBudgetGuard, migrateLlmTables, sumReserved } from './callLog.js'
import { BudgetExceededError, LlmClient, defaultExtraBody, servedProvider } from './client.js'
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

describe('migrateLlmTables', () => {
  it('is idempotent', () => {
    const db = openDb()
    expect(() => {
      migrateLlmTables(db)
    }).not.toThrow()
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

    // Wafer's real price: ((1000-600)*0.28 + 600*0.07 + 50*0.56) / 1e6 = 0.000182
    const expectedCost = ((1000 - 600) * 0.28 + 600 * 0.07 + 50 * 0.56) / 1e6
    expect(expectedCost).toBeCloseTo(0.000182, 10)
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
    const expectedCost = (500 * 0.28 + 6168 * 0.56) / 1e6
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

  // ★ A generation that came back with nothing was still billed. The retry path booked six
  // hardcoded zeros, so ~10% of the mini-rehearsal's spend was invisible to every guard.
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
    // A dead call names no back end, so it books at the ceiling — the same rule a landed call
    // with an unattributed route follows: ((1000-600)*0.44 + 600*0.114 + 50*1.32) / 1e6.
    const ceiling = ((1000 - 600) * 0.44 + 600 * 0.114 + 50 * 1.32) / 1e6
    expect(all[0]!.cost_usd).toBeCloseTo(ceiling, 12)
    expect(all[0]!.reported_cost_usd).toBeNull()
    // And the per-caller guard can now see the money it burned.
    expect(client.totalCostUsd()).toBeCloseTo(ceiling, 12)
    // No `llm_price_unpriced_route` alert: a failure has no bill to reconcile, so it never
    // goes through `book`, and ~10% of calls would otherwise be an alert flood.
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
    // The tokens were spent whether or not the shape was right, so they are reported.
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
    // expectedCallCostUsd 0 isolates the booked-spend cap: this budget is
    // smaller than one expected call, which T21's reservation refuses outright.
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
    // Unattributed, so it books at the ceiling.
    expect(client.totalCostUsd()).toBeCloseTo((100 * 0.44 + 100 * 1.32) / 1e6, 10)
  })
})

describe('served model attribution', () => {
  // An unknown model is a different product at an unknown price, so it books at the worst rate
  // any endpoint charges and raises an alert. It can only over-report.
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

// OpenRouter reports what it charged on the response that carries the tokens; the pinned table
// computes a second opinion; the two are compared every call.
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

  // The defect: a table half the endpoint's real price books half the spend.
  it('alerts when the table disagrees with what the provider charged', async () => {
    const db = openDb()
    // Wafer's real price for these tokens is (1000*0.28 + 1000*0.56)/1e6 = $0.00084.
    const model = mockModel([
      {
        text: 'a',
        provider: 'Wafer',
        servedModelId: MIND_MODEL,
        usage: { inputTokens: 1000, outputTokens: 1000 },
        // ...but suppose the provider actually charges double what the table believes.
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

  // A reconciliation that alerts on every call is one people mute inside a week.
  it('is silent when the table agrees with the provider', async () => {
    const db = openDb()
    const model = mockModel([
      {
        text: 'a',
        provider: 'Wafer',
        servedModelId: MIND_MODEL,
        usage: { inputTokens: 1000, outputTokens: 1000 },
        reportedCostUsd: (1000 * 0.28 + 1000 * 0.56) / 1e6,
      },
    ])
    const client = new LlmClient({ model, db, caller: 'test' })
    await client.text({ messages: [{ role: 'user', content: 'u' }] })
    expect(kinds(db)).toEqual([])
  })

  it('stays silent on sub-cent rounding rather than crying wolf', async () => {
    const db = openDb()
    const exact = (10 * 0.28 + 2 * 0.56) / 1e6
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

  // A `served` value with no price row must not fall through to somebody else's cheap rate.
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
    expect(row.cost_usd).toBeGreaterThan((1000 * 0.28 + 1000 * 0.56) / 1e6)
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

    // All five reserve synchronously before any of them can answer.
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

  it('the allow-list is a switch now, and the default leaves the routing where it was', () => {
    expect(defaultExtraBody(['x/y'], ['P'], false)).toEqual({
      models: [MIND_MODEL, 'x/y'],
      provider: { order: ['P'], allow_fallbacks: false },
    })
    expect(defaultExtraBody(['x/y'], ['P']).provider.allow_fallbacks).toBe(true)
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

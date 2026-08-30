import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { insertLlmCall, migrateLlmTables } from './callLog.js'
import { backfillUnattributed } from './backfill.js'

const NOW = 1_700_000_000_000
const APIKEY = 'test-key'

function openDb(): Database.Database {
  const db = new Database(':memory:')
  migrateLlmTables(db)
  return db
}

/** A call the ceiling priced because its answer named no back end: 1,000 in and 1,000 out at
 *  the ceiling is $0.00176, where Baidu's own rate is $0.000135. */
function seedUnattributed(db: Database.Database, generationId: string | null): void {
  insertLlmCall(db, {
    agentId: 'amara',
    caller: 'turn',
    model: 'deepseek/deepseek-v4-flash-0731',
    provider: null,
    generationId,
    inputTokens: 1000,
    outputTokens: 1000,
    cacheReadTokens: 0,
    reasoningTokens: 0,
    costUsd: 0.00176,
    estimatedCostUsd: 0.00176,
    reportedCostUsd: null,
    latencyMs: 2000,
    finishReason: 'stop',
    ok: true,
    error: null,
  })
  db.prepare('UPDATE llm_calls SET ts = ? WHERE ts > ?').run(NOW - 60_000, NOW)
}

type Row = { provider: string | null; cost_usd: number; estimated_cost_usd: number | null }

const rowOf = (db: Database.Database): Row =>
  db
    .prepare('SELECT provider, cost_usd, estimated_cost_usd FROM llm_calls ORDER BY id')
    .get() as Row

const alertKinds = (db: Database.Database): string[] =>
  (db.prepare('SELECT kind FROM alerts ORDER BY id').all() as { kind: string }[]).map((a) => a.kind)

const answering = (body: unknown, ok = true): typeof fetch =>
  (async () => ({ ok, json: async () => body })) as unknown as typeof fetch

// ★ 21 of run C's 207 calls were booked at the ceiling because nobody could say who served
// them. The generation endpoint knows, and asking is free.
describe('★ an unattributed row is asked about, not ceiling-priced for ever', () => {
  it('names the back end, takes its bill, and re-prices the row off the ceiling', async () => {
    const db = openDb()
    seedUnattributed(db, 'gen-1')
    const fetchFn = answering({ data: { provider_name: 'Baidu', total_cost: 0.000135 } })

    const r = await backfillUnattributed(db, { apiKey: APIKEY, fetchFn, now: NOW })

    expect(r).toEqual({ attempted: 1, backfilled: 1 })
    const row = rowOf(db)
    expect(row.provider).toBe('Baidu')
    expect(row.cost_usd, 'the provider bill did not become the booked cost').toBeCloseTo(
      0.000135,
      9,
    )
    expect(row.estimated_cost_usd, 'the pinned table was not re-run at the real rate').toBeCloseTo(
      0.00013482,
      9,
    )
    expect(alertKinds(db)).toEqual(['llm_price_backfilled'])
  })

  it('re-runs the reconciliation, so a bill the pin cannot explain still speaks up', async () => {
    const db = openDb()
    seedUnattributed(db, 'gen-2')
    const fetchFn = answering({ data: { provider_name: 'Baidu', total_cost: 0.002 } })

    await backfillUnattributed(db, { apiKey: APIKEY, fetchFn, now: NOW })

    expect(alertKinds(db)).toEqual(['llm_price_divergence', 'llm_price_backfilled'])
  })

  it('leaves the ceiling price standing when the endpoint will not answer', async () => {
    const db = openDb()
    seedUnattributed(db, 'gen-3')
    const fetchFn = answering({}, false)

    const r = await backfillUnattributed(db, { apiKey: APIKEY, fetchFn, now: NOW })

    expect(r).toEqual({ attempted: 1, backfilled: 0 })
    expect(rowOf(db).provider).toBeNull()
    expect(rowOf(db).cost_usd).toBeCloseTo(0.00176, 9)
    expect(alertKinds(db)).toEqual([])
  })

  it('leaves the ceiling price standing when the answer names nobody either', async () => {
    const db = openDb()
    seedUnattributed(db, 'gen-4')
    const fetchFn = answering({ data: { total_cost: 0.0005 } })

    expect(await backfillUnattributed(db, { apiKey: APIKEY, fetchFn, now: NOW })).toEqual({
      attempted: 1,
      backfilled: 0,
    })
    expect(rowOf(db).provider).toBeNull()
  })

  it('waits out the delay: OpenRouter has no row for a generation that just closed', async () => {
    const db = openDb()
    seedUnattributed(db, 'gen-5')
    let asked = 0
    const fetchFn = (async () => {
      asked += 1
      return { ok: true, json: async () => ({ data: { provider_name: 'Baidu' } }) }
    }) as unknown as typeof fetch

    expect(
      await backfillUnattributed(db, { apiKey: APIKEY, fetchFn, now: NOW, delayMs: 120_000 }),
    ).toEqual({ attempted: 0, backfilled: 0 })
    expect(asked).toBe(0)

    expect(await backfillUnattributed(db, { apiKey: APIKEY, fetchFn, now: NOW })).toEqual({
      attempted: 1,
      backfilled: 1,
    })
  })

  // Without this a generation OpenRouter has expired is re-requested every sweep for the life
  // of the run, and holds the 25-row window against every newer call behind it.
  it('★ gives up on a row too old for the endpoint to still know about', async () => {
    const db = openDb()
    seedUnattributed(db, 'gen-old')
    let asked = 0
    const fetchFn = (async () => {
      asked += 1
      return { ok: false, json: async () => ({}) }
    }) as unknown as typeof fetch

    expect(await backfillUnattributed(db, { apiKey: APIKEY, fetchFn, now: NOW })).toEqual({
      attempted: 1,
      backfilled: 0,
    })
    expect(asked).toBe(1)

    const anHourOn = NOW + 61 * 60 * 1000
    expect(await backfillUnattributed(db, { apiKey: APIKEY, fetchFn, now: anHourOn })).toEqual({
      attempted: 0,
      backfilled: 0,
    })
    expect(asked, 'a permanently dead row was asked about for ever').toBe(1)
  })

  it('never asks about a row that has no generation id to ask about', async () => {
    const db = openDb()
    seedUnattributed(db, null)
    let asked = 0
    const fetchFn = (async () => {
      asked += 1
      return { ok: true, json: async () => ({}) }
    }) as unknown as typeof fetch

    await backfillUnattributed(db, { apiKey: APIKEY, fetchFn, now: NOW })
    expect(asked).toBe(0)
  })

  it('leaves a row that already knows its back end alone', async () => {
    const db = openDb()
    seedUnattributed(db, 'gen-6')
    db.prepare("UPDATE llm_calls SET provider = 'AtlasCloud'").run()
    const fetchFn = answering({ data: { provider_name: 'Baidu', total_cost: 0.1 } })

    expect(await backfillUnattributed(db, { apiKey: APIKEY, fetchFn, now: NOW })).toEqual({
      attempted: 0,
      backfilled: 0,
    })
    expect(rowOf(db).provider).toBe('AtlasCloud')
  })
})

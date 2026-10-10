import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { APICallError } from 'ai'
import { limiterFor } from './rateLimiter.js'
import { PROVIDER_ORDER } from './pins.js'
import { MockLanguageModelV4 } from 'ai/test'
import { LlmClient, BudgetExceededError } from './client.js'
import { mockModel } from './testutil/mockModel.js'
import Database from 'better-sqlite3'
import {
  configureSpendLimits,
  insertLlmCall,
  makeBudgetGuard,
  migrateLlmTables,
  sumCostUsd,
  sumReserved,
  type LlmCallInsert,
} from './callLog.js'

const dbs: Database.Database[] = []
function openDb(): Database.Database {
  const db = new Database(':memory:')
  migrateLlmTables(db)
  dbs.push(db)
  return db
}
afterEach(() => {
  vi.useRealTimers()
  for (const db of dbs.splice(0)) db.close()
})

describe('town spending reservations', () => {
  it.each(['lifetime', 'rolling-day'])(
    'records %s admission refusal below the billed ceiling without releasing exposure',
    (window) => {
      const db = openDb()
      configureSpendLimits(db, {
        lifetimeUsd: window === 'lifetime' ? 1 : 10,
        rollingDayUsd: window === 'rolling-day' ? 1 : 10,
      })
      const guard = makeBudgetGuard(db, 'forge')
      const held = guard.reserve(0.75, null, null)
      if (!('id' in held)) throw new Error('first reservation refused')
      guard.retainUncertain(held.id)
      expect(makeBudgetGuard(db, 'turn').reserve(0.5, null, null)).toEqual({
        held: 'budget',
        spentUsd: 0,
      })
      const alert = db
        .prepare("SELECT detail FROM alerts WHERE kind = 'town_budget_refused'")
        .get() as { detail: string }
      expect(JSON.parse(alert.detail)).toMatchObject({ window, spentUsd: 0, limitUsd: 1 })
      expect(sumReserved(db)).toBe(0.75)
      expect(sumCostUsd(db)).toBe(0)
    },
  )

  it('does not record a global refusal when only a caller allowance is full', () => {
    const db = openDb()
    configureSpendLimits(db, { lifetimeUsd: 10, rollingDayUsd: 10 })
    expect(
      makeBudgetGuard(db, 'forge').reserve(0.5, null, { usd: 0.1, sinceMs: 0 }),
    ).toHaveProperty('held', 'rail')
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM alerts WHERE kind = 'town_budget_refused'").get(),
    ).toEqual({ n: 0 })
  })

  it('does not stop the town when only an explicit client budget refuses admission', () => {
    const db = openDb()
    configureSpendLimits(db, { lifetimeUsd: 10, rollingDayUsd: 10 })
    expect(makeBudgetGuard(db, 'probe').reserve(0.5, 0.1, null)).toEqual({
      held: 'budget',
      spentUsd: 0,
    })
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM alerts WHERE kind = 'town_budget_refused'").get(),
    ).toEqual({ n: 0 })
    expect(makeBudgetGuard(db, 'turn').reserve(0.5, null, null)).toHaveProperty('id')
  })

  it('holds an image beside two text callers under one dollar', async () => {
    const db = openDb()
    const image = makeBudgetGuard(db, 'forge').reserve(0.25, 1, null)
    expect(image).toHaveProperty('id')
    const calls = await Promise.all(
      ['turn', 'narrator'].map(async (caller) =>
        makeBudgetGuard(db, caller).reserve(0.75, 1, null),
      ),
    )
    expect(calls.filter((r) => 'id' in r)).toHaveLength(1)
    expect(db.prepare('SELECT SUM(amount_usd) AS total FROM llm_reservations').get()).toEqual({
      total: 1,
    })
  })
})

const bill = (caller: string, costUsd: number): LlmCallInsert => ({
  caller,
  costUsd,
  agentId: null,
  model: 'test',
  provider: 'test',
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  reasoningTokens: 0,
  estimatedCostUsd: costUsd,
  reportedCostUsd: costUsd,
  latencyMs: 1,
  finishReason: 'stop',
  ok: true,
  error: null,
})
const ask = (client: LlmClient) => client.text({ messages: [{ role: 'user', content: 'hello' }] })
const reservationId = (result: ReturnType<ReturnType<typeof makeBudgetGuard>['reserve']>) => {
  if ('held' in result) throw new Error('reservation refused')
  return result.id
}

describe('reservation settlement', () => {
  it('reconciles actual prices once and cancellation cannot erase a charge', () => {
    const db = openDb()
    configureSpendLimits(db, { lifetimeUsd: 1, rollingDayUsd: 1 })
    const guard = makeBudgetGuard(db, 'forge')
    const id = reservationId(guard.reserve(0.75, null, null))
    const call = guard.reconcile(id, bill('forge', 0.6))
    guard.release(id)
    guard.release(id)
    expect(guard.reconcile(id, bill('forge', 0.6))).toBe(call)
    expect(sumCostUsd(db)).toBe(0.6)
    expect(sumReserved(db)).toBe(0)
    expect(makeBudgetGuard(db, 'turn').reserve(0.4, null, null)).toHaveProperty('id')
  })

  it('books a late charge after release and reports an underestimated allowance', () => {
    const db = openDb()
    const guard = makeBudgetGuard(db, 'forge')
    const id = reservationId(guard.reserve(0.2, 1, null))
    guard.release(id)
    guard.reconcile(id, bill('forge', 0.3))
    expect(sumCostUsd(db)).toBe(0.3)
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM alerts WHERE kind = 'reservation_overrun'").get(),
    ).toEqual({ n: 1 })
  })

  it('keeps an unsettled image allowance and settled charges across a reopen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sj-budget-'))
    const path = join(dir, 'ops.db')
    const first = new Database(path)
    try {
      migrateLlmTables(first)
      configureSpendLimits(first, { lifetimeUsd: 1, rollingDayUsd: 1 })
      makeBudgetGuard(first, 'forge').reserve(0.75, null, null)
      insertLlmCall(first, bill('turn', 0.2))
      first.close()
      const second = new Database(path)
      try {
        migrateLlmTables(second)
        expect(makeBudgetGuard(second, 'narrator').reserve(0.1, null, null)).toEqual({
          held: 'budget',
          spentUsd: 0.2,
        })
      } finally {
        second.close()
      }
    } finally {
      if (first.open) first.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('uses a rolling UTC day across midnight and retains old outstanding allowances', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-21T23:59:59.999Z'))
    const db = openDb()
    configureSpendLimits(db, { lifetimeUsd: 10, rollingDayUsd: 1 })
    insertLlmCall(db, bill('turn', 0.8))
    const guard = makeBudgetGuard(db, 'forge')
    guard.reserve(0.1, null, null)
    vi.setSystemTime(new Date('2026-09-22T00:00:00.000Z'))
    expect(guard.reserve(0.2, null, null)).toHaveProperty('held', 'budget')
    vi.setSystemTime(new Date('2026-09-22T23:59:59.999Z'))
    expect(guard.reserve(0.2, null, null)).toHaveProperty('held', 'budget')
    vi.setSystemTime(new Date('2026-09-23T00:00:00.000Z'))
    expect(guard.reserve(0.9, null, null)).toHaveProperty('id')
    expect(guard.reserve(0.01, null, null)).toHaveProperty('held', 'budget')
  })

  it('rejects a retry after the previous accepted charge spent its remaining allowance', async () => {
    const db = openDb()
    configureSpendLimits(db, { lifetimeUsd: 1, rollingDayUsd: 1 })
    const model = mockModel([
      {
        emptyOutput: true,
        finishReason: 'length',
        reportedCostUsd: 0.8,
        usage: { outputTokens: 5 },
      },
      { text: 'paid again', reportedCostUsd: 0.8 },
    ])
    const client = new LlmClient({
      db,
      caller: 'arbiter',
      model,
      expectedCallCostUsd: 0.75,
      maxRetries: 1,
    })
    await expect(
      client.object({
        system: 'hello',
        messages: [{ role: 'user', content: 'hello' }],
        schema: z.object({ answer: z.string() }).strict(),
      }),
    ).rejects.toBeInstanceOf(BudgetExceededError)
    expect(sumCostUsd(db)).toBe(0.8)
    expect(sumReserved(db)).toBe(0)
    expect(db.prepare('SELECT COUNT(*) AS n FROM llm_calls').get()).toEqual({ n: 1 })
  })

  it.each(['timeout', 'cancellation'])(
    'keeps unconfirmed provider exposure after %s',
    async (kind) => {
      const db = openDb()
      configureSpendLimits(db, { lifetimeUsd: 1, rollingDayUsd: 1 })
      let entered!: () => void
      const started = new Promise<void>((resolve) => {
        entered = resolve
      })
      const model = new MockLanguageModelV4({
        doGenerate: ({ abortSignal }) =>
          new Promise((_resolve, reject) => {
            entered()
            abortSignal!.addEventListener(
              'abort',
              () => {
                reject(abortSignal!.reason as Error)
              },
              { once: true },
            )
          }),
      })
      const client = new LlmClient({
        db,
        caller: 'timeout-test',
        model,
        expectedCallCostUsd: 0.75,
        maxRetries: 0,
        requestTimeoutMs: 10,
      })
      const pending = ask(client)
      expect(sumReserved(db)).toBe(0.75)
      await started
      if (kind === 'cancellation') client.abort()
      await expect(pending).rejects.toThrow()
      expect(sumReserved(db)).toBe(0.75)
      expect(makeBudgetGuard(db, 'narrator').reserve(1, null, null)).toHaveProperty(
        'held',
        'budget',
      )
      const row = db
        .prepare("SELECT id FROM llm_reservations WHERE status = 'uncertain'")
        .get() as { id: number }
      const guard = makeBudgetGuard(db, 'timeout-test')
      guard.reconcile(row.id, bill('timeout-test', 0.2))
      guard.reconcile(row.id, bill('timeout-test', 0.2))
      expect(sumReserved(db)).toBe(0)
      expect(sumCostUsd(db)).toBe(0.2)
    },
  )
})

it('reserves the prompt and output ceiling instead of a flat five mills', async () => {
  const db = openDb()
  configureSpendLimits(db, { lifetimeUsd: 0.01, rollingDayUsd: 0.01 })
  const client = new LlmClient({ db, caller: 'arbiter', model: mockModel([{ text: 'bought' }]) })
  await expect(ask(client)).rejects.toBeInstanceOf(BudgetExceededError)
  expect(sumCostUsd(db)).toBe(0)
})

it('books the retry admitted inside the rate limiter under a fresh reservation', async () => {
  vi.useFakeTimers()
  const db = openDb()
  configureSpendLimits(db, { lifetimeUsd: 1, rollingDayUsd: 1 })
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const sibling = limiterFor(PROVIDER_ORDER.join(',')).run(() => held, 10_000)
  let attempts = 0
  const answer = mockModel([{ text: 'hello', reportedCostUsd: 0.75 }])
  const model = new MockLanguageModelV4({
    doGenerate: (opts) => {
      if (attempts++ === 0)
        throw new APICallError({
          message: 'busy',
          url: 'https://provider.invalid',
          requestBodyValues: {},
          statusCode: 429,
        })
      return answer.doGenerate(opts)
    },
  })
  try {
    const client = new LlmClient({
      db,
      caller: 'retry-test',
      model,
      expectedCallCostUsd: 0.75,
      maxRetries: 0,
    })
    const pending = ask(client).catch((err: unknown) => err)
    await vi.advanceTimersByTimeAsync(3000)
    expect(await pending).toMatchObject({ text: 'hello' })
    expect(sumCostUsd(db)).toBe(0.75)
    expect(sumReserved(db)).toBe(0)
    expect(db.prepare('SELECT COUNT(*) AS n FROM llm_calls').get()).toEqual({ n: 2 })
  } finally {
    release()
    await sibling
  }
})

it('reserves Luna fast large-context prices without changing historical billing estimates', async () => {
  const db = openDb()
  configureSpendLimits(db, { lifetimeUsd: 0.02, rollingDayUsd: 0.02 })
  const model = mockModel([{ text: 'hello' }])
  const client = new LlmClient({
    db,
    caller: 'turn',
    model,
    maxOutputTokens: 7500,
  })
  await expect(ask(client)).rejects.toThrow(BudgetExceededError)
  expect(sumCostUsd(db)).toBe(0)
})

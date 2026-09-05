import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mockModel } from './testutil/mockModel.js'
import { insertLlmCall, migrateLlmTables, makeBudgetGuard } from './callLog.js'
import { BudgetExceededError, CallerRailError, LlmClient } from './client.js'
import { callSettingsFor, PINNED_CALLERS, RAIL_FLOOR_USD } from './pins.js'
import { clearRails, RAIL_WINDOW_MS } from './rails.js'

function openDb(): Database.Database {
  const db = new Database(':memory:')
  migrateLlmTables(db)
  return db
}

/** A billed call in this caller's rolling day, `agoMs` before now. */
function spend(db: Database.Database, caller: string, usd: number, agoMs = 0): void {
  const id = insertLlmCall(db, {
    agentId: null,
    caller,
    model: 'm',
    provider: 'p',
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    reasoningTokens: 0,
    costUsd: usd,
    estimatedCostUsd: usd,
    reportedCostUsd: usd,
    latencyMs: 1,
    finishReason: 'stop',
    ok: true,
    error: null,
  })
  if (agoMs > 0) db.prepare('UPDATE llm_calls SET ts = ? WHERE id = ?').run(Date.now() - agoMs, id)
}

const alerts = (db: Database.Database): { kind: string; detail: string }[] =>
  db.prepare('SELECT kind, detail FROM alerts ORDER BY id').all() as {
    kind: string
    detail: string
  }[]

const ask = (client: LlmClient): Promise<unknown> =>
  client.text({ messages: [{ role: 'user', content: 'u' }] })

describe('★ a caller cannot spend the whole town’s day', () => {
  beforeEach(() => {
    clearRails()
  })

  it('gives every pinned caller a rail, none of them under the floor', () => {
    for (const caller of PINNED_CALLERS) {
      const rail = callSettingsFor(caller).dailyUsd
      expect(rail, caller).toBeTypeOf('number')
      expect(rail!, caller).toBeGreaterThanOrEqual(RAIL_FLOOR_USD)
    }
  })

  it('refuses the caller that reached its rail and lets its sibling keep working', async () => {
    const db = openDb()
    const rail = callSettingsFor('arbiter').dailyUsd!
    spend(db, 'arbiter', rail)

    const court = new LlmClient({ model: mockModel([{ text: 'a' }]), db, caller: 'arbiter' })
    await expect(ask(court)).rejects.toBeInstanceOf(CallerRailError)

    // The narrator has its own rail and has spent nothing against it.
    const paper = new LlmClient({ model: mockModel([{ text: 'a' }]), db, caller: 'narrator' })
    await expect(ask(paper)).resolves.toBeDefined()
  })

  it('writes the operator one line per trip, however many calls are refused', async () => {
    const db = openDb()
    spend(db, 'arbiter', callSettingsFor('arbiter').dailyUsd!)
    const court = new LlmClient({ model: mockModel([{ text: 'a' }]), db, caller: 'arbiter' })
    for (let i = 0; i < 4; i++) await expect(ask(court)).rejects.toBeInstanceOf(CallerRailError)
    const tripped = alerts(db).filter((a) => a.kind === 'caller_rail_tripped')
    expect(tripped).toHaveLength(1)
    expect(tripped[0]!.detail).toContain('arbiter')
    expect(tripped[0]!.detail).toContain('the town keeps running')
  })

  it('fails the next ask off the map, without reading the ledger again', async () => {
    const db = openDb()
    spend(db, 'arbiter', callSettingsFor('arbiter').dailyUsd!)
    const court = new LlmClient({ model: mockModel([{ text: 'a' }]), db, caller: 'arbiter' })
    await expect(ask(court)).rejects.toBeInstanceOf(CallerRailError)

    // The ledger is emptied under it; the hold still answers, because it never looks.
    db.exec('DELETE FROM llm_calls')
    await expect(ask(court)).rejects.toBeInstanceOf(CallerRailError)
  })

  it('holds the caller only until the oldest call rolls out of its day', async () => {
    const db = openDb()
    const rail = callSettingsFor('arbiter').dailyUsd!
    // Twenty-three hours old: an hour from now the window no longer holds it.
    spend(db, 'arbiter', rail, 23 * 60 * 60 * 1000)
    const court = new LlmClient({ model: mockModel([{ text: 'a' }]), db, caller: 'arbiter' })
    const err = await ask(court).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(CallerRailError)
    const until = (err as CallerRailError).untilMs
    expect(until - Date.now()).toBeGreaterThan(0)
    expect(until - Date.now()).toBeLessThan(RAIL_WINDOW_MS)
  })

  it('leaves an old bill out of the day it is no longer part of', async () => {
    const db = openDb()
    spend(db, 'arbiter', callSettingsFor('arbiter').dailyUsd! * 10, RAIL_WINDOW_MS + 60_000)
    const court = new LlmClient({ model: mockModel([{ text: 'a' }]), db, caller: 'arbiter' })
    await expect(ask(court)).resolves.toBeDefined()
  })

  it('lets the lifetime budget refuse first, so a stop is never reported as a rail', () => {
    const db = openDb()
    spend(db, 'arbiter', 1)
    const guard = makeBudgetGuard(db, 'arbiter')
    expect(guard.reserve(0.005, 0.5, { usd: 0.18, sinceMs: Date.now() - RAIL_WINDOW_MS })).toEqual({
      held: 'budget',
      spentUsd: 1,
    })
  })

  it('is a budget refusal, so every caller that already handles one handles it', async () => {
    const db = openDb()
    spend(db, 'arbiter', callSettingsFor('arbiter').dailyUsd!)
    const court = new LlmClient({ model: mockModel([{ text: 'a' }]), db, caller: 'arbiter' })
    await expect(ask(court)).rejects.toBeInstanceOf(BudgetExceededError)
  })

  it('leaves an unpinned caller alone — there is no rail to reach', async () => {
    const db = openDb()
    spend(db, 'forge', 100)
    const forge = new LlmClient({ model: mockModel([{ text: 'a' }]), db, caller: 'forge' })
    await expect(ask(forge)).resolves.toBeDefined()
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import Database from 'better-sqlite3'
import { migrateLlmTables } from './callLog.js'
import {
  DEFAULT_SPEND_THRESHOLD_USD_PER_SIM_DAY,
  DEFAULT_SPEND_WINDOW_REAL_MINUTES,
  REAL_MINUTES_PER_SIM_DAY,
  checkSpend,
  classifyFailure,
  deadCallCounts,
  projectDailySpend,
  providerCounts,
  reconcileCosts,
  reportDeadCalls,
  reportProviders,
  reportReconciliation,
} from './spendMonitor.js'

const NOW = 1_700_000_000_000

function openDb(): Database.Database {
  const db = new Database(':memory:')
  migrateLlmTables(db)
  return db
}

function seedCall(db: Database.Database, agoMinutes: number, costUsd: number, now = NOW): void {
  db.prepare(
    `INSERT INTO llm_calls
       (ts, agent_id, caller, model, input_tokens, output_tokens, cache_read_tokens,
        reasoning_tokens, cost_usd, latency_ms, ok, error)
     VALUES (?, NULL, 'turn', 'm', 0, 0, 0, 0, ?, 0, 1, NULL)`,
  ).run(now - agoMinutes * 60_000, costUsd)
}

function alerts(db: Database.Database): { kind: string; detail: string }[] {
  return db.prepare('SELECT kind, detail FROM alerts ORDER BY id').all() as {
    kind: string
    detail: string
  }[]
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('projectDailySpend (T24)', () => {
  it('one sim-day is one real hour, so a window scales by 60/window', () => {
    const db = openDb()
    expect(REAL_MINUTES_PER_SIM_DAY).toBe(60)
    seedCall(db, 1, 0.5)
    seedCall(db, 2, 0.25)

    const p = projectDailySpend(db, { windowRealMinutes: 15, now: NOW })
    expect(p).toEqual({ usdPerSimDay: 3, windowRealMinutes: 15, sampledCalls: 2 })
  })

  it('counts only calls inside the window, boundary included', () => {
    const db = openDb()
    seedCall(db, 15, 1) // exactly on the edge — in
    seedCall(db, 15.001, 100) // a hair older — out
    seedCall(db, 400, 100) // long gone — out

    const p = projectDailySpend(db, { windowRealMinutes: 15, now: NOW })
    expect(p.sampledCalls).toBe(1)
    expect(p.usdPerSimDay).toBe(4)
  })

  it('leaves an excluded caller out of the rate, but still in the ledger', () => {
    const db = openDb()
    seedCall(db, 1, 0.5)
    db.prepare(
      `INSERT INTO llm_calls
         (ts, agent_id, caller, model, input_tokens, output_tokens, cache_read_tokens,
          reasoning_tokens, cost_usd, latency_ms, ok, error)
       VALUES (?, NULL, 'forge', 'm', 0, 0, 0, 0, 0.5, 0, 1, NULL)`,
    ).run(NOW - 60_000)

    const all = projectDailySpend(db, { windowRealMinutes: 15, now: NOW })
    const minds = projectDailySpend(db, {
      windowRealMinutes: 15,
      now: NOW,
      excludeCallers: ['forge'],
    })
    expect(all).toEqual({ usdPerSimDay: 4, windowRealMinutes: 15, sampledCalls: 2 })
    expect(minds).toEqual({ usdPerSimDay: 2, windowRealMinutes: 15, sampledCalls: 1 })
  })

  it('an idle window projects zero, not NaN', () => {
    const db = openDb()
    seedCall(db, 500, 9)
    const p = projectDailySpend(db, { windowRealMinutes: 15, now: NOW })
    expect(p).toEqual({ usdPerSimDay: 0, windowRealMinutes: 15, sampledCalls: 0 })
  })

  it('a full-hour window is the measured sim-day itself, multiplier 1', () => {
    const db = openDb()
    seedCall(db, 30, 2.5)
    expect(projectDailySpend(db, { windowRealMinutes: 60, now: NOW }).usdPerSimDay).toBe(2.5)
  })

  it('defaults to a quarter-hour window', () => {
    const db = openDb()
    expect(DEFAULT_SPEND_WINDOW_REAL_MINUTES).toBe(15)
    expect(projectDailySpend(db).windowRealMinutes).toBe(15)
  })
})

describe('dead calls — paid for, and nothing came back', () => {
  const fail = (
    db: Database.Database,
    agentId: string | null,
    error: string | null,
    agoMinutes = 1,
    now = NOW,
  ): void => {
    db.prepare(
      `INSERT INTO llm_calls
         (ts, agent_id, caller, model, input_tokens, output_tokens, cache_read_tokens,
          reasoning_tokens, cost_usd, latency_ms, ok, error)
       VALUES (?, ?, 'turn', 'm', 0, 0, 0, 0, 0, 0, 0, ?)`,
    ).run(now - agoMinutes * 60_000, agentId, error)
  }

  it('tells an empty answer from an unparseable one from anything else', () => {
    expect(classifyFailure('No output generated.')).toBe('empty_output')
    expect(classifyFailure('No object generated: could not parse the response.')).toBe(
      'unparseable',
    )
    expect(classifyFailure('fetch failed')).toBe('other')
    expect(classifyFailure(null)).toBe('other')
  })

  it('counts them per mind per day, beside the calls that mind was billed for', () => {
    const db = openDb()
    seedCall(db, 1, 0.002) // one good turn, no agent named
    fail(db, 'omar', 'No output generated.')
    fail(db, 'omar', 'No object generated: could not parse the response.')
    fail(db, 'omar', 'No output generated.', 60 * 30) // the day before
    fail(db, 'nadia', 'fetch failed')

    const rows = deadCallCounts(db)
    expect(rows.map((r) => r.agentId)).toEqual(['nadia', 'omar', 'omar'])
    const omarToday = rows.find(
      (r) => r.agentId === 'omar' && r.emptyOutput === 1 && r.unparseable === 1,
    )!
    expect(omarToday).toMatchObject({ emptyOutput: 1, unparseable: 1, otherFailures: 0, calls: 2 })
    expect(rows.find((r) => r.agentId === 'nadia')).toMatchObject({
      otherFailures: 1,
      emptyOutput: 0,
    })
    // Two days for one mind means two rows, never one lumped total.
    expect(rows.filter((r) => r.agentId === 'omar')).toHaveLength(2)
    expect(new Set(rows.filter((r) => r.agentId === 'omar').map((r) => r.day)).size).toBe(2)
  })

  it('folds on an escaped NUL, so git still reads the source as text', () => {
    const src = readFileSync(new URL('./spendMonitor.ts', import.meta.url), 'utf8')
    expect(src).toContain('\\x00')
    expect(src).not.toContain('\0')
  })

  it('a clean run reports nothing at all', () => {
    const db = openDb()
    seedCall(db, 1, 0.002)
    expect(deadCallCounts(db)).toEqual([])
    expect(reportDeadCalls(db)).toEqual([])
    expect(alerts(db)).toEqual([])
  })

  it('writes one alert and one line per mind per day, naming both counts', () => {
    const db = openDb()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fail(db, 'omar', 'No output generated.')
    fail(db, 'omar', 'No object generated: could not parse the response.')
    fail(db, 'nadia', 'No output generated.')

    const rows = reportDeadCalls(db)
    expect(rows).toHaveLength(2)
    expect(alerts(db)).toHaveLength(2)
    expect(alerts(db).map((a) => a.kind)).toEqual(['llm_dead_calls', 'llm_dead_calls'])
    expect(alerts(db)[1]!.detail).toContain('1 empty')
    expect(alerts(db)[1]!.detail).toContain('1 unparseable')
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('rides along with the spend projection, so a clean-looking burn cannot hide them', () => {
    const db = openDb()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    seedCall(db, 1, 4)
    fail(db, 'omar', 'No output generated.')

    const r = checkSpend(db, { thresholdUsdPerSimDay: 10, windowRealMinutes: 15, now: NOW })
    expect(r.deadCalls).toMatchObject({ calls: 1, emptyOutput: 1, unparseable: 0 })
    expect(alerts(db)[0]!.detail).toContain('1 of 2 calls came back empty or unparseable')
    expect(warn).toHaveBeenCalled()
  })
})

describe('checkSpend (T24)', () => {
  it('over the threshold: one alert row per check, naming the projection', () => {
    const db = openDb()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    seedCall(db, 1, 4)

    const r = checkSpend(db, { thresholdUsdPerSimDay: 10, windowRealMinutes: 15, now: NOW })
    expect(r.usdPerSimDay).toBe(16)
    expect(r.alerted).toBe(true)
    expect(alerts(db)).toHaveLength(1)
    expect(alerts(db)[0]!.kind).toBe('spend_projection')
    expect(alerts(db)[0]!.detail).toContain('16')
    expect(alerts(db)[0]!.detail).toContain('10')
    expect(warn).toHaveBeenCalledTimes(1)

    // A second check over the same threshold alerts again: an operator wants a heartbeat.
    checkSpend(db, { thresholdUsdPerSimDay: 10, windowRealMinutes: 15, now: NOW })
    expect(alerts(db)).toHaveLength(2)
  })

  it('under the threshold: no alert, no console line', () => {
    const db = openDb()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    seedCall(db, 1, 1)

    const r = checkSpend(db, { thresholdUsdPerSimDay: 10, windowRealMinutes: 15, now: NOW })
    expect(r.usdPerSimDay).toBe(4)
    expect(r.alerted).toBe(false)
    expect(alerts(db)).toEqual([])
    expect(warn).not.toHaveBeenCalled()
  })

  it('sitting exactly on the threshold is not over it', () => {
    const db = openDb()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    seedCall(db, 1, 2.5)
    const r = checkSpend(db, { thresholdUsdPerSimDay: 10, windowRealMinutes: 15, now: NOW })
    expect(r.usdPerSimDay).toBe(10)
    expect(r.alerted).toBe(false)
    expect(alerts(db)).toEqual([])
  })

  it('the default threshold is 10x the expected five-mind rate', () => {
    const db = openDb()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(DEFAULT_SPEND_THRESHOLD_USD_PER_SIM_DAY).toBe(0.4)
    seedCall(db, 1, 0.11) // 0.11 over 15 real minutes projects to $0.44/sim-day
    expect(checkSpend(db, { windowRealMinutes: 15, now: NOW }).alerted).toBe(true)
    seedCall(db, 1, -0.02) // pull the window back under
    expect(checkSpend(db, { windowRealMinutes: 15, now: NOW }).alerted).toBe(false)
  })
})

describe('providerCounts: which back end answered, and how much of it was worth paying for', () => {
  function seedProviderCall(
    db: Database.Database,
    row: { provider: string | null; ok: boolean; error?: string; costUsd?: number },
  ): void {
    db.prepare(
      `INSERT INTO llm_calls
         (ts, agent_id, caller, model, input_tokens, output_tokens, cache_read_tokens,
          reasoning_tokens, cost_usd, latency_ms, ok, error, provider)
       VALUES (?, NULL, 'turn', 'm', 0, 0, 0, 0, ?, 0, ?, ?, ?)`,
    ).run(NOW, row.costUsd ?? 0.001, row.ok ? 1 : 0, row.error ?? null, row.provider)
  }

  const mixed = (): Database.Database => {
    const db = openDb()
    seedProviderCall(db, { provider: 'Wafer', ok: true, costUsd: 0.01 })
    seedProviderCall(db, { provider: 'Wafer', ok: true, costUsd: 0.01 })
    seedProviderCall(db, { provider: 'Baidu', ok: true, costUsd: 0.001 })
    seedProviderCall(db, { provider: null, ok: false, error: 'No output generated.' })
    seedProviderCall(db, {
      provider: null,
      ok: false,
      error: 'No object generated: could not parse',
    })
    return db
  }

  it('folds calls, answers, failures and cost per back end, sorted by name', () => {
    expect(providerCounts(mixed())).toEqual([
      {
        provider: null,
        calls: 2,
        ok: 0,
        failed: 2,
        emptyOutput: 1,
        unparseable: 1,
        costUsd: 0.002,
      },
      {
        provider: 'Baidu',
        calls: 1,
        ok: 1,
        failed: 0,
        emptyOutput: 0,
        unparseable: 0,
        costUsd: 0.001,
      },
      {
        provider: 'Wafer',
        calls: 2,
        ok: 2,
        failed: 0,
        emptyOutput: 0,
        unparseable: 0,
        costUsd: 0.02,
      },
    ])
  })

  it('writes one alert row per back end, and names the unattributable ones as such', () => {
    const db = mixed()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const rows = reportProviders(db)
    expect(rows).toHaveLength(3)
    const details = alerts(db)
      .filter((a) => a.kind === 'llm_provider_mix')
      .map((a) => a.detail)
    expect(details).toHaveLength(3)
    expect(details.some((d) => d.startsWith('unattributed: 2 calls'))).toBe(true)
    expect(details.some((d) => d.startsWith('Wafer: 2 calls, 2 answered'))).toBe(true)
  })

  it('a ledger with nothing in the window reports nothing at all', () => {
    const db = mixed()
    expect(providerCounts(db, { since: NOW + 1 })).toEqual([])
  })
})

describe('price reconciliation over a run', () => {
  // Written the way the client writes it: `cost_usd` books the bill when the provider named one.
  const insert = (db: Database.Database, computed: number, reported: number | null): void => {
    db.prepare(
      `INSERT INTO llm_calls (ts, agent_id, caller, model, input_tokens, output_tokens,
         cache_read_tokens, reasoning_tokens, cost_usd, estimated_cost_usd, reported_cost_usd,
         latency_ms, ok, error)
       VALUES (?, NULL, 'c', 'm', 0, 0, 0, 0, ?, ?, ?, 0, 1, NULL)`,
    ).run(NOW, reported ?? computed, computed, reported)
  }

  it('is silent when the ledger matches the bill', () => {
    const db = openDb()
    insert(db, 0.001, 0.001)
    const r = reportReconciliation(db)
    expect(r.ratio).toBeCloseTo(1, 10)
    expect(db.prepare('SELECT COUNT(*) AS n FROM alerts').get()).toEqual({ n: 0 })
  })

  it('reports the 2x the project actually had', () => {
    const db = openDb()
    // What 611 Wafer calls looked like: booked at Baidu's price, charged at Wafer's.
    insert(db, 0.43, 0.89)
    const r = reportReconciliation(db)
    expect(r.ratio).toBeCloseTo(2.07, 2)
    const row = db.prepare('SELECT kind, detail FROM alerts').get() as {
      kind: string
      detail: string
    }
    expect(row.kind).toBe('llm_price_reconciliation')
    expect(row.detail).toContain('2.07x out')
  })

  it('★ compares the pinned table against the bill, never the bill against itself', () => {
    const db = openDb()
    insert(db, 0.43, 0.89)
    expect(
      db.prepare('SELECT cost_usd AS booked, reported_cost_usd AS bill FROM llm_calls').get(),
      'the ledger books the bill, which is why it cannot be the second opinion',
    ).toEqual({ booked: 0.89, bill: 0.89 })
    expect(reconcileCosts(db).ratio).toBeCloseTo(2.07, 2)
  })

  it('cannot reconcile a row written before the estimate had a column of its own', () => {
    const db = openDb()
    db.prepare(
      `INSERT INTO llm_calls (ts, agent_id, caller, model, input_tokens, output_tokens,
         cache_read_tokens, reasoning_tokens, cost_usd, reported_cost_usd, latency_ms, ok, error)
       VALUES (?, NULL, 'c', 'm', 0, 0, 0, 0, 0.89, 0.89, 0, 1, NULL)`,
    ).run(NOW)
    const r = reconcileCosts(db)
    expect(r).toMatchObject({ reconciledCalls: 0, unreconciledCalls: 1, ratio: null })
  })

  it('counts the calls it could not reconcile rather than hiding them', () => {
    const db = openDb()
    insert(db, 0.001, null)
    insert(db, 0.001, 0.001)
    const r = reconcileCosts(db)
    expect(r.reconciledCalls).toBe(1)
    expect(r.unreconciledCalls).toBe(1)
    // The unreconcilable call is excluded from BOTH sides, so it cannot skew the ratio.
    expect(r.computedUsd).toBeCloseTo(0.001, 10)
  })
})

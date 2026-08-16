import { afterEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { migrateLlmTables } from './callLog.js'
import {
  DEFAULT_SPEND_THRESHOLD_USD_PER_SIM_DAY,
  DEFAULT_SPEND_WINDOW_REAL_MINUTES,
  REAL_MINUTES_PER_SIM_DAY,
  checkSpend,
  projectDailySpend,
} from './spendMonitor.js'

const NOW = 1_700_000_000_000

function openDb(): Database.Database {
  const db = new Database(':memory:')
  migrateLlmTables(db)
  return db
}

// One llm_calls row at a chosen wall-clock instant. Only ts and cost matter here.
function seedCall(db: Database.Database, agoMinutes: number, costUsd: number, now = NOW): void {
  db.prepare(
    `INSERT INTO llm_calls
       (ts, agent_id, caller, model, input_tokens, output_tokens, cache_read_tokens,
        reasoning_tokens, cost_usd, latency_ms, ok, error)
     VALUES (?, NULL, 'turn', 'm', 0, 0, 0, 0, ?, 0, 1, NULL)`,
  ).run(now - agoMinutes * 60_000, costUsd)
}

function alerts(db: Database.Database): Array<{ kind: string; detail: string }> {
  return db.prepare('SELECT kind, detail FROM alerts ORDER BY id').all() as Array<{ kind: string; detail: string }>
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

    // A second check over the same threshold alerts again — the operator wants a heartbeat,
    // not a one-shot that goes quiet while the burn continues.
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

  it('the default threshold is the ruled $10 per sim-day', () => {
    const db = openDb()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(DEFAULT_SPEND_THRESHOLD_USD_PER_SIM_DAY).toBe(10)
    seedCall(db, 1, 2.6)
    expect(checkSpend(db, { windowRealMinutes: 15, now: NOW }).alerted).toBe(true)
    seedCall(db, 1, -0.2) // pull the window back under
    expect(checkSpend(db, { windowRealMinutes: 15, now: NOW }).alerted).toBe(false)
  })
})

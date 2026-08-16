import type Database from 'better-sqlite3'
import { insertAlert } from './callLog.js'

// The sim runs one day per real hour, so a window of W real minutes covers
// W/60 of a sim-day and its spend scales by 60/W to reach $/sim-day.
export const REAL_MINUTES_PER_SIM_DAY = 60
export const DEFAULT_SPEND_WINDOW_REAL_MINUTES = 15
export const DEFAULT_SPEND_THRESHOLD_USD_PER_SIM_DAY = 10

export type SpendProjection = { usdPerSimDay: number; windowRealMinutes: number; sampledCalls: number }

export type SpendWindowOpts = { windowRealMinutes?: number; now?: number }

export function projectDailySpend(db: Database.Database, opts: SpendWindowOpts = {}): SpendProjection {
  const windowRealMinutes = opts.windowRealMinutes ?? DEFAULT_SPEND_WINDOW_REAL_MINUTES
  const cutoff = (opts.now ?? Date.now()) - windowRealMinutes * 60_000
  const row = db
    .prepare('SELECT COALESCE(SUM(cost_usd), 0) AS total, COUNT(*) AS n FROM llm_calls WHERE ts >= ?')
    .get(cutoff) as { total: number; n: number }
  return {
    usdPerSimDay: row.total * (REAL_MINUTES_PER_SIM_DAY / windowRealMinutes),
    windowRealMinutes,
    sampledCalls: row.n,
  }
}

// Fires every time it is called over the threshold, not once per crossing: an
// operator watching a burn wants a heartbeat, not a single line at the start.
export function checkSpend(
  db: Database.Database,
  opts: SpendWindowOpts & { thresholdUsdPerSimDay?: number } = {},
): SpendProjection & { alerted: boolean } {
  const threshold = opts.thresholdUsdPerSimDay ?? DEFAULT_SPEND_THRESHOLD_USD_PER_SIM_DAY
  const projection = projectDailySpend(db, opts)
  if (projection.usdPerSimDay <= threshold) return { ...projection, alerted: false }
  const detail =
    `projected $${projection.usdPerSimDay.toFixed(2)}/sim-day over a $${threshold.toFixed(2)} threshold ` +
    `(${projection.sampledCalls} calls in the last ${projection.windowRealMinutes} real minutes)`
  insertAlert(db, { agentId: null, kind: 'spend_projection', detail })
  console.warn(`spend: ${detail}`)
  return { ...projection, alerted: true }
}

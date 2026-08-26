import type Database from 'better-sqlite3'
import { insertAlert } from './callLog.js'

// The sim runs one day per real hour, so a window of W real minutes covers
// W/60 of a sim-day and its spend scales by 60/W to reach $/sim-day.
export const REAL_MINUTES_PER_SIM_DAY = 60
export const DEFAULT_SPEND_WINDOW_REAL_MINUTES = 15
export const DEFAULT_SPEND_THRESHOLD_USD_PER_SIM_DAY = 10

export type SpendProjection = {
  usdPerSimDay: number
  windowRealMinutes: number
  sampledCalls: number
}

export type SpendWindowOpts = { windowRealMinutes?: number; now?: number }

export function projectDailySpend(
  db: Database.Database,
  opts: SpendWindowOpts = {},
): SpendProjection {
  const windowRealMinutes = opts.windowRealMinutes ?? DEFAULT_SPEND_WINDOW_REAL_MINUTES
  const cutoff = (opts.now ?? Date.now()) - windowRealMinutes * 60_000
  const row = db
    .prepare(
      'SELECT COALESCE(SUM(cost_usd), 0) AS total, COUNT(*) AS n FROM llm_calls WHERE ts >= ?',
    )
    .get(cutoff) as { total: number; n: number }
  return {
    usdPerSimDay: row.total * (REAL_MINUTES_PER_SIM_DAY / windowRealMinutes),
    windowRealMinutes,
    sampledCalls: row.n,
  }
}

// A call that came back with nothing was still paid for. The provider says it one of two ways,
// and the retry path swallows both: 10.4% of the mini-rehearsal's calls, ~$0.24, one alert.
export type FailureClass = 'empty_output' | 'unparseable' | 'other'

export function classifyFailure(error: string | null): FailureClass {
  if (error === null) return 'other'
  if (/no output generated/i.test(error)) return 'empty_output'
  if (/no object generated|could not parse/i.test(error)) return 'unparseable'
  return 'other'
}

export type DeadCalls = {
  calls: number
  emptyOutput: number
  unparseable: number
  otherFailures: number
}
export type DeadCallRow = DeadCalls & { agentId: string | null; day: string }

const NO_DEAD_CALLS: DeadCalls = { calls: 0, emptyOutput: 0, unparseable: 0, otherFailures: 0 }

// The wall-clock day, which is the only day `llm_calls` knows: it carries no tick.
const dayOf = (ts: number): string => new Date(ts).toISOString().slice(0, 10)

// Every failed call, folded per mind per day. Sorted by mind then day so two runs of the same
// ledger report in the same order.
export function deadCallCounts(
  db: Database.Database,
  opts: { since?: number } = {},
): DeadCallRow[] {
  const rows = db
    .prepare(
      'SELECT ts, agent_id AS agentId, error FROM llm_calls WHERE ok = 0 AND ts >= ? ORDER BY id',
    )
    .all(opts.since ?? 0) as { ts: number; agentId: string | null; error: string | null }[]
  const byKey = new Map<string, DeadCallRow>()
  for (const row of rows) {
    const day = dayOf(row.ts)
    const key = `${row.agentId ?? ''}\x00${day}`
    const acc = byKey.get(key) ?? { ...NO_DEAD_CALLS, agentId: row.agentId, day }
    acc.calls += 1
    const cls = classifyFailure(row.error)
    if (cls === 'empty_output') acc.emptyOutput += 1
    else if (cls === 'unparseable') acc.unparseable += 1
    else acc.otherFailures += 1
    byKey.set(key, acc)
  }
  return [...byKey.values()].sort(
    (a, b) => (a.agentId ?? '').localeCompare(b.agentId ?? '') || a.day.localeCompare(b.day),
  )
}

const sumDeadCalls = (rows: DeadCallRow[]): DeadCalls =>
  rows.reduce(
    (acc, r) => ({
      calls: acc.calls + r.calls,
      emptyOutput: acc.emptyOutput + r.emptyOutput,
      unparseable: acc.unparseable + r.unparseable,
      otherFailures: acc.otherFailures + r.otherFailures,
    }),
    NO_DEAD_CALLS,
  )

// One alert row and one line per mind per day. Says nothing at all about a run with nothing
// to say, so a quiet ops surface still means a quiet run.
export function reportDeadCalls(
  db: Database.Database,
  opts: { since?: number } = {},
): DeadCallRow[] {
  const rows = deadCallCounts(db, opts)
  for (const row of rows) {
    const detail =
      `${row.agentId ?? 'the run'} on ${row.day}: ${row.calls} paid calls came back with nothing — ` +
      `${row.emptyOutput} empty, ${row.unparseable} unparseable, ${row.otherFailures} otherwise failed`
    insertAlert(db, { agentId: row.agentId, kind: 'llm_dead_calls', detail })
    console.warn(`dead calls: ${detail}`)
  }
  return rows
}

// Fires every time it is called over the threshold, not once per crossing: an
// operator watching a burn wants a heartbeat, not a single line at the start.
export function checkSpend(
  db: Database.Database,
  opts: SpendWindowOpts & { thresholdUsdPerSimDay?: number } = {},
): SpendProjection & { alerted: boolean; deadCalls: DeadCalls } {
  const threshold = opts.thresholdUsdPerSimDay ?? DEFAULT_SPEND_THRESHOLD_USD_PER_SIM_DAY
  const projection = projectDailySpend(db, opts)
  const windowRealMinutes = opts.windowRealMinutes ?? DEFAULT_SPEND_WINDOW_REAL_MINUTES
  const cutoff = (opts.now ?? Date.now()) - windowRealMinutes * 60_000
  const deadCalls = sumDeadCalls(deadCallCounts(db, { since: cutoff }))
  if (projection.usdPerSimDay <= threshold) return { ...projection, alerted: false, deadCalls }
  // The projection alone said the mini-rehearsal was clean while a tenth of it bought nothing.
  const dead = deadCalls.emptyOutput + deadCalls.unparseable
  const wasted =
    dead === 0 ? '' : `; ${dead} of ${projection.sampledCalls} calls came back empty or unparseable`
  const detail =
    `projected $${projection.usdPerSimDay.toFixed(2)}/sim-day over a $${threshold.toFixed(2)} threshold ` +
    `(${projection.sampledCalls} calls in the last ${projection.windowRealMinutes} real minutes)${wasted}`
  insertAlert(db, { agentId: null, kind: 'spend_projection', detail })
  console.warn(`spend: ${detail}`)
  return { ...projection, alerted: true, deadCalls }
}

// A failed call names no provider — it carries no answer to read one off — so `emptyOutput`
// counts against the calls that landed, and the failures get their own row.
export type ProviderRow = {
  provider: string | null
  calls: number
  ok: number
  failed: number
  emptyOutput: number
  unparseable: number
  costUsd: number
}

export function providerCounts(
  db: Database.Database,
  opts: { since?: number } = {},
): ProviderRow[] {
  const rows = db
    .prepare(
      'SELECT provider, ok, error, cost_usd AS costUsd FROM llm_calls WHERE ts >= ? ORDER BY id',
    )
    .all(opts.since ?? 0) as {
    provider: string | null
    ok: number
    error: string | null
    costUsd: number
  }[]
  const byProvider = new Map<string, ProviderRow>()
  for (const row of rows) {
    const key = row.provider ?? ''
    const acc = byProvider.get(key) ?? {
      provider: row.provider,
      calls: 0,
      ok: 0,
      failed: 0,
      emptyOutput: 0,
      unparseable: 0,
      costUsd: 0,
    }
    acc.calls += 1
    acc.costUsd += row.costUsd
    if (row.ok === 1) acc.ok += 1
    else {
      acc.failed += 1
      const cls = classifyFailure(row.error)
      if (cls === 'empty_output') acc.emptyOutput += 1
      else if (cls === 'unparseable') acc.unparseable += 1
    }
    byProvider.set(key, acc)
  }
  return [...byProvider.values()].sort((a, b) => (a.provider ?? '').localeCompare(b.provider ?? ''))
}

// The per-call reconciliation over a whole run, which is where a small per-call bias shows.
// A run where nothing can be reconciled is itself the finding: the ledger has no second opinion.
export type Reconciliation = {
  reconciledCalls: number
  unreconciledCalls: number
  reportedUsd: number
  computedUsd: number
  // reported / computed. 1 is agreement; the defect this exists for read ~2.
  ratio: number | null
}

export const RECONCILE_TOLERANCE = 0.05

export function reconcileCosts(
  db: Database.Database,
  opts: { since?: number } = {},
): Reconciliation {
  const row = db
    .prepare(
      `SELECT
       COALESCE(SUM(CASE WHEN reported_cost_usd IS NOT NULL THEN 1 ELSE 0 END), 0) AS reconciled,
       COALESCE(SUM(CASE WHEN reported_cost_usd IS NULL THEN 1 ELSE 0 END), 0) AS unreconciled,
       COALESCE(SUM(reported_cost_usd), 0) AS reported,
       COALESCE(SUM(CASE WHEN reported_cost_usd IS NOT NULL THEN cost_usd ELSE 0 END), 0) AS computed
     FROM llm_calls WHERE ts >= ? AND ok = 1`,
    )
    .get(opts.since ?? 0) as {
    reconciled: number
    unreconciled: number
    reported: number
    computed: number
  }
  return {
    reconciledCalls: row.reconciled,
    unreconciledCalls: row.unreconciled,
    reportedUsd: row.reported,
    computedUsd: row.computed,
    ratio: row.computed > 0 ? row.reported / row.computed : null,
  }
}

// Says nothing when the ledger and the bill agree, so a quiet ops surface still means a quiet run.
export function reportReconciliation(
  db: Database.Database,
  opts: { since?: number; tolerance?: number } = {},
): Reconciliation {
  const r = reconcileCosts(db, opts)
  const tolerance = opts.tolerance ?? RECONCILE_TOLERANCE
  if (r.ratio === null || Math.abs(r.ratio - 1) <= tolerance) return r
  const detail =
    `the ledger computed $${r.computedUsd.toFixed(4)} for ${r.reconciledCalls} calls that the ` +
    `provider charged $${r.reportedUsd.toFixed(4)} for — ${r.ratio.toFixed(2)}x out. ` +
    'A price pin is stale; re-read the provider price list before trusting any cost this run reports'
  insertAlert(db, { agentId: null, kind: 'llm_price_reconciliation', detail })
  console.warn(`price: ${detail}`)
  return r
}

// One alert row and one line per back end. A run served by one provider says one line; a run
// that fell through says how far.
export function reportProviders(
  db: Database.Database,
  opts: { since?: number } = {},
): ProviderRow[] {
  const rows = providerCounts(db, opts)
  for (const row of rows) {
    const who = row.provider ?? 'unattributed'
    const detail =
      `${who}: ${row.calls} calls, ${row.ok} answered, ${row.failed} came back with nothing ` +
      `(${row.emptyOutput} empty, ${row.unparseable} unparseable), $${row.costUsd.toFixed(4)}`
    insertAlert(db, { agentId: null, kind: 'llm_provider_mix', detail })
    console.warn(`providers: ${detail}`)
  }
  return rows
}

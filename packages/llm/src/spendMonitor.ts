import type Database from 'better-sqlite3'
import { insertAlert } from './callLog.js'

// The sim runs one day per 30 real minutes, so a window of W real minutes covers
// W/30 of a sim-day and its spend scales by 30/W to reach $/sim-day.
export const REAL_MINUTES_PER_SIM_DAY = 30
export const DEFAULT_SPEND_WINDOW_REAL_MINUTES = 15
// 21x the expected $0.019/sim-day for the shipped five-mind cast — itself an expectation
// and not a measurement.
export const DEFAULT_SPEND_THRESHOLD_USD_PER_SIM_DAY = 0.4

export const REAL_MINUTES_PER_SIM_HOUR = REAL_MINUTES_PER_SIM_DAY / 24

/** The callers a mind's own thinking goes through, and the only ones the per-mind rate counts.
 *  The narrator, the arbiter, the tier-2.5 pass and the forge are town work at any cast size. */
export const MIND_CALLERS: string[] = ['turn', 'reflection', 'reflection.edit', 'dream', 'recall']

const MIND_CALLER_SLOTS = MIND_CALLERS.map(() => '?').join(',')

type WindowOpts = { windowRealMinutes?: number; now?: number }

const windowOf = (opts: WindowOpts): { windowRealMinutes: number; cutoff: number } => {
  const windowRealMinutes = opts.windowRealMinutes ?? DEFAULT_SPEND_WINDOW_REAL_MINUTES
  return { windowRealMinutes, cutoff: (opts.now ?? Date.now()) - windowRealMinutes * 60_000 }
}

export type CallRateProjection = { callsPerMindSimHour: number; sampledCalls: number }

/** Calls, not dollars: the flow a runaway shows up in first, and the one number a provider
 *  failover cannot move. */
export function projectCallRate(
  db: Database.Database,
  opts: WindowOpts & { minds: number },
): CallRateProjection {
  const { windowRealMinutes, cutoff } = windowOf(opts)
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM llm_calls
        WHERE ts >= ? AND caller IN (${MIND_CALLER_SLOTS})`,
    )
    .get(cutoff, ...MIND_CALLERS) as { n: number }
  const simHours = windowRealMinutes / REAL_MINUTES_PER_SIM_HOUR
  return {
    callsPerMindSimHour: row.n / Math.max(1, opts.minds) / simHours,
    sampledCalls: row.n,
  }
}

// Turns, not minutes: an act rate is a property of the answers, and a real-time window over a
// paused or slowed loop measures the loop instead.
export const ACT_RATE_WINDOW_TURNS = 40
// Run E ran at 1.6% silent; run G at 44.5%. Anything past a third is a collapse, not a mood.
export const DEFAULT_SILENT_TURN_THRESHOLD = 0.3

export type ActRate = {
  turns: number
  silent: number
  silentShare: number
  providers: string[]
}

/** How many of the last turns produced neither an act nor a word, and who served them. */
export function actRate(db: Database.Database, opts: { windowTurns?: number } = {}): ActRate {
  const rows = db
    .prepare('SELECT provider, acted, spoke FROM turn_outcomes ORDER BY id DESC LIMIT ?')
    .all(opts.windowTurns ?? ACT_RATE_WINDOW_TURNS) as {
    provider: string | null
    acted: number
    spoke: number
  }[]
  const silent = rows.filter((r) => r.acted === 0 && r.spoke === 0).length
  const providers = [...new Set(rows.map((r) => r.provider ?? 'unattributed'))].sort()
  return {
    turns: rows.length,
    silent,
    silentShare: rows.length === 0 ? 0 : silent / rows.length,
    providers,
  }
}

/** Silent under a full window only: a short window early in a run says nothing yet. Fires every
 *  time it is called over the threshold, like the spend heartbeat. */
export function checkActRate(
  db: Database.Database,
  opts: { windowTurns?: number; threshold?: number } = {},
): ActRate & { alerted: boolean } {
  const windowTurns = opts.windowTurns ?? ACT_RATE_WINDOW_TURNS
  const threshold = opts.threshold ?? DEFAULT_SILENT_TURN_THRESHOLD
  const rate = actRate(db, { windowTurns })
  if (rate.turns < windowTurns || rate.silentShare <= threshold) return { ...rate, alerted: false }
  const detail =
    `${rate.silent} of the last ${rate.turns} mind turns produced no act and no word ` +
    `(${(rate.silentShare * 100).toFixed(0)}%, over ${(threshold * 100).toFixed(0)}%), ` +
    `served by ${rate.providers.join(', ')}`
  insertAlert(db, { agentId: null, kind: 'act_rate_collapsed', detail })
  console.warn(`acts: ${detail}`)
  return { ...rate, alerted: true }
}

export type ProviderMix = {
  calls: number
  costUsd: number
  offPinShare: number
  alerted: boolean
}

/** With one name pinned and `allow_fallbacks` false, a back end off the allow-list is not a mix,
 *  it is a leak, and one served call is the whole signal. A call that names nobody belongs to the
 *  backfill, not here. An alert, never a stop: only the operator can answer it. */
export function checkProviderMix(
  db: Database.Database,
  opts: WindowOpts & { allowed: string[] },
): ProviderMix {
  const { windowRealMinutes, cutoff } = windowOf(opts)
  const rows = db
    .prepare(
      `SELECT provider, COUNT(*) AS calls, COALESCE(SUM(cost_usd), 0) AS costUsd
         FROM llm_calls
        WHERE ts >= ? AND caller IN (${MIND_CALLER_SLOTS})
        GROUP BY provider ORDER BY calls DESC, provider`,
    )
    .all(cutoff, ...MIND_CALLERS) as { provider: string | null; calls: number; costUsd: number }[]
  const calls = rows.reduce((n, r) => n + r.calls, 0)
  const costUsd = rows.reduce((n, r) => n + r.costUsd, 0)
  const leaked = rows.filter((r) => r.provider !== null && !opts.allowed.includes(r.provider))
  const offPin = leaked.reduce((n, r) => n + r.calls, 0)
  const offPinShare = calls === 0 ? 0 : offPin / calls
  const mix = { calls, costUsd, offPinShare }
  if (offPin === 0) return { ...mix, alerted: false }
  const who = leaked.map((r) => `${r.provider} ${r.calls}`).join(', ')
  const detail =
    `${offPin} of ${calls} mind calls in the last ${windowRealMinutes} real minutes were served ` +
    `off the allow-list [${opts.allowed.join(', ')}] (${who}); the window cost $${costUsd.toFixed(4)}`
  insertAlert(db, { agentId: null, kind: 'llm_provider_off_allow_list', detail })
  console.warn(`providers: ${detail}`)
  return { ...mix, alerted: true }
}

export type SpendProjection = {
  usdPerSimDay: number
  windowRealMinutes: number
  sampledCalls: number
}

export type SpendWindowOpts = {
  windowRealMinutes?: number
  now?: number
  excludeCallers?: string[]
}

export function projectDailySpend(
  db: Database.Database,
  opts: SpendWindowOpts = {},
): SpendProjection {
  const windowRealMinutes = opts.windowRealMinutes ?? DEFAULT_SPEND_WINDOW_REAL_MINUTES
  const cutoff = (opts.now ?? Date.now()) - windowRealMinutes * 60_000
  const excluded = opts.excludeCallers ?? []
  const notIn = excluded.length ? ` AND caller NOT IN (${excluded.map(() => '?').join(',')})` : ''
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) AS total, COUNT(*) AS n FROM llm_calls WHERE ts >= ?${notIn}`,
    )
    .get(cutoff, ...excluded) as { total: number; n: number }
  return {
    usdPerSimDay: row.total * (REAL_MINUTES_PER_SIM_DAY / windowRealMinutes),
    windowRealMinutes,
    sampledCalls: row.n,
  }
}

// A call that came back with nothing was still paid for, and the provider says so one of two
// ways; the retry path swallows both.
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

// Sorted by mind then day so two runs of the same ledger report in the same order.
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

export const sumDeadCalls = (rows: DeadCallRow[]): DeadCalls =>
  rows.reduce(
    (acc, r) => ({
      calls: acc.calls + r.calls,
      emptyOutput: acc.emptyOutput + r.emptyOutput,
      unparseable: acc.unparseable + r.unparseable,
      otherFailures: acc.otherFailures + r.otherFailures,
    }),
    NO_DEAD_CALLS,
  )

// Silent on a run with nothing to say, so a quiet ops surface still means a quiet run.
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

// A run where nothing can be reconciled is itself the finding: the ledger has no second opinion.
export type Reconciliation = {
  reconciledCalls: number
  unreconciledCalls: number
  reportedUsd: number
  computedUsd: number
  // reported / computed; 1 is agreement.
  ratio: number | null
}

export const RECONCILE_TOLERANCE = 0.05

// The pinned table against the bill, never `cost_usd` against the bill: `cost_usd` IS the bill
// whenever the provider named one, so a run reconciled against it can only ever read 1.0000.
const BOTH_COSTS = 'reported_cost_usd IS NOT NULL AND estimated_cost_usd IS NOT NULL'

export function reconcileCosts(
  db: Database.Database,
  opts: { since?: number } = {},
): Reconciliation {
  const row = db
    .prepare(
      `SELECT
       COALESCE(SUM(CASE WHEN ${BOTH_COSTS} THEN 1 ELSE 0 END), 0) AS reconciled,
       COALESCE(SUM(CASE WHEN ${BOTH_COSTS} THEN 0 ELSE 1 END), 0) AS unreconciled,
       COALESCE(SUM(CASE WHEN ${BOTH_COSTS} THEN reported_cost_usd ELSE 0 END), 0) AS reported,
       COALESCE(SUM(CASE WHEN ${BOTH_COSTS} THEN estimated_cost_usd ELSE 0 END), 0) AS computed
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

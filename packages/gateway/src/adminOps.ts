import Database from 'better-sqlite3'
import { MINUTES_PER_DAY, TICK_REAL_MS } from '@sj/shared'
import { readBody, type AdminRoute } from './adminLaws.js'
import { writeRunTar, type ExportOpts } from './exportRun.js'
import { sendJson } from './http.js'
import type { LiveOps } from './liveCast.js'

/** `TickLoop` satisfies this. */
export type Clock = {
  readonly paused: boolean
  readonly speed: number
  readonly tick: number
  pause(): void
  resume(): void
  setSpeed(speed: number): void
}

export type OpsDeps = ExportOpts & {
  clock: Clock
  /** A thunk, not a value: a cast attached after the channel opened is still seen. */
  ops: () => LiveOps | null
}

const MIN_SPEED = 0.1
export const MAX_SPEED = 60
/** The gateway reads the ledger with SQL rather than importing `@sj/llm`'s spend monitor: that
 *  package pulls the model SDK, which the scripted path must never load. */
const SPEND_WINDOW_REAL_MINUTES = 15
const REAL_MINUTES_PER_SIM_DAY = (MINUTES_PER_DAY * TICK_REAL_MS) / 60_000
const DAY_MS = 24 * 60 * 60 * 1000
const TOP_MINDS = 10
const RECENT_ALERTS = 10
/** One sim-day is 48 real minutes, so this number moves far slower than the page polls. */
const ANSWER_RATE_TTL_MS = 60_000

const bodyJson = (text: string | null): Record<string, unknown> => {
  try {
    return JSON.parse(text ?? '{}') as Record<string, unknown>
  } catch {
    return {}
  }
}

type Spend = { calls: number; usd: number }
export type CostReport = {
  live: boolean
  today: Spend
  lifetime: Spend
  projection: { usdPerSimDay: number; windowRealMinutes: number; sampledCalls: number }
  byCaller: (Spend & { caller: string })[]
  byMind: (Spend & { agentId: string })[]
  /** Cached input tokens over all input tokens. */
  cacheReadShare: number | null
  caps: { dailyUsd: number; lifetimeUsd: number }
  stop: { dailyReached: boolean; lifetimeReached: boolean }
  alerts: { ts: number; kind: string; detail: string }[]
  answerRate: AnswerRate
}

type Money = Omit<CostReport, 'answerRate'>

const NOTHING_SPENT: Spend = { calls: 0, usd: 0 }
const NOTHING_BOUGHT: Money = {
  live: false,
  today: NOTHING_SPENT,
  lifetime: NOTHING_SPENT,
  projection: { usdPerSimDay: 0, windowRealMinutes: SPEND_WINDOW_REAL_MINUTES, sampledCalls: 0 },
  byCaller: [],
  byMind: [],
  cacheReadShare: null,
  caps: { dailyUsd: 0, lifetimeUsd: 0 },
  stop: { dailyReached: false, lifetimeReached: false },
  alerts: [],
}

// One pass for three windows and the token share: four `SELECT`s walk the same pages four times.
type Totals = {
  todayCalls: number
  todayUsd: number
  lifeCalls: number
  lifeUsd: number
  windowCalls: number
  windowUsd: number
  input: number
  cached: number
}

function ledger(db: Database.Database, caps: LiveOps['caps'], now: number): Money {
  const t = db
    .prepare(
      `SELECT
         COALESCE(SUM(ts >= @day), 0) AS todayCalls,
         COALESCE(SUM(CASE WHEN ts >= @day THEN cost_usd ELSE 0 END), 0) AS todayUsd,
         COUNT(*) AS lifeCalls,
         COALESCE(SUM(cost_usd), 0) AS lifeUsd,
         COALESCE(SUM(ts >= @window), 0) AS windowCalls,
         COALESCE(SUM(CASE WHEN ts >= @window THEN cost_usd ELSE 0 END), 0) AS windowUsd,
         COALESCE(SUM(input_tokens), 0) AS input,
         COALESCE(SUM(cache_read_tokens), 0) AS cached
       FROM llm_calls`,
    )
    .get({ day: now - DAY_MS, window: now - SPEND_WINDOW_REAL_MINUTES * 60_000 }) as Totals
  return {
    live: true,
    today: { calls: t.todayCalls, usd: t.todayUsd },
    lifetime: { calls: t.lifeCalls, usd: t.lifeUsd },
    projection: {
      usdPerSimDay: t.windowUsd * (REAL_MINUTES_PER_SIM_DAY / SPEND_WINDOW_REAL_MINUTES),
      windowRealMinutes: SPEND_WINDOW_REAL_MINUTES,
      sampledCalls: t.windowCalls,
    },
    byCaller: db
      .prepare(
        'SELECT caller, COUNT(*) AS calls, COALESCE(SUM(cost_usd), 0) AS usd FROM llm_calls' +
          ' GROUP BY caller ORDER BY usd DESC',
      )
      .all() as CostReport['byCaller'],
    byMind: db
      .prepare(
        'SELECT agent_id AS agentId, COUNT(*) AS calls, COALESCE(SUM(cost_usd), 0) AS usd' +
          ' FROM llm_calls WHERE agent_id IS NOT NULL GROUP BY agent_id ORDER BY usd DESC LIMIT ?',
      )
      .all(TOP_MINDS) as CostReport['byMind'],
    cacheReadShare: t.input > 0 ? t.cached / t.input : null,
    caps,
    stop: {
      dailyReached: caps.dailyUsd > 0 && t.todayUsd >= caps.dailyUsd,
      lifetimeReached: caps.lifetimeUsd > 0 && t.lifeUsd >= caps.lifetimeUsd,
    },
    alerts: db
      .prepare('SELECT ts, kind, detail FROM alerts ORDER BY id DESC LIMIT ?')
      .all(RECENT_ALERTS) as CostReport['alerts'],
  }
}

/** Of the acts a body STARTED, the share it finished. */
export type AnswerRate = {
  stated: number
  answered: number
  abandoned: number
  /** Started, not yet finished or abandoned — the run's tail, not a refusal. */
  inFlight: number
  rate: number | null
  byVerb: { verb: string; stated: number; answered: number }[]
}

const NO_ANSWER_RATE: AnswerRate = {
  stated: 0,
  answered: 0,
  abandoned: 0,
  inFlight: 0,
  rate: null,
  byVerb: [],
}

export function answerRate(worldDbPath: string): AnswerRate {
  let db: Database.Database
  try {
    db = new Database(worldDbPath, { readonly: true, fileMustExist: true })
  } catch {
    return NO_ANSWER_RATE
  }
  try {
    const byVerb = db
      .prepare(
        `SELECT json_extract(payload, '$.verb') AS verb,
                SUM(type = 'action_started') AS stated,
                SUM(type = 'action_completed') AS answered,
                SUM(type = 'action_interrupted') AS abandoned
           FROM events
          WHERE type IN ('action_started', 'action_completed', 'action_interrupted')
          GROUP BY verb ORDER BY stated DESC, verb`,
      )
      .all() as { verb: string; stated: number; answered: number; abandoned: number }[]
    const total = byVerb.reduce(
      (acc, r) => ({
        stated: acc.stated + r.stated,
        answered: acc.answered + r.answered,
        abandoned: acc.abandoned + r.abandoned,
      }),
      { stated: 0, answered: 0, abandoned: 0 },
    )
    return {
      ...total,
      inFlight: Math.max(0, total.stated - total.answered - total.abandoned),
      rate: total.stated > 0 ? total.answered / total.stated : null,
      byVerb: byVerb.map((r) => ({ verb: r.verb, stated: r.stated, answered: r.answered })),
    }
  } catch {
    return NO_ANSWER_RATE
  } finally {
    db.close()
  }
}

const clockState = (c: Clock) => ({ paused: c.paused, speed: c.speed, tick: c.tick })

function rulingRoute(deps: OpsDeps, verdict: 'approve' | 'revert'): AdminRoute['handle'] {
  return (req, res, params) => {
    const rulings = deps.ops()?.rulings ?? null
    if (rulings === null) {
      sendJson(res, { error: 'this stream has no god layer — nothing has been codified' }, 409)
      return
    }
    const ruleId = Number(params.id)
    if (!Number.isInteger(ruleId)) {
      sendJson(res, { error: 'a ruling is named by its rule id' }, 400)
      return
    }
    void readBody(req).then((text) => {
      const said = bodyJson(text).reason
      try {
        if (verdict === 'approve') rulings.approve(ruleId)
        else
          rulings.revert(
            ruleId,
            typeof said === 'string' && said !== '' ? said : 'the operator reverted it',
            deps.clock.tick,
          )
      } catch (e) {
        sendJson(res, { error: e instanceof Error ? e.message : String(e) }, 400)
        return
      }
      sendJson(res, { pending: rulings.pending() })
    })
  }
}

export function adminOpsRoutes(deps: OpsDeps): AdminRoute[] {
  // The whole world log, aggregated, is the one costly read on this channel; the number it
  // yields moves on a sim-day timescale and the page polls every few seconds.
  let motive: { at: number; rate: AnswerRate } | null = null
  const costReport = (now = Date.now()): CostReport => {
    if (motive === null || now - motive.at > ANSWER_RATE_TTL_MS)
      motive = { at: now, rate: answerRate(deps.worldDbPath) }
    const ops = deps.ops()
    return {
      ...(ops === null ? NOTHING_BOUGHT : ledger(ops.opsDb, ops.caps, now)),
      answerRate: motive.rate,
    }
  }

  return [
    {
      method: 'GET',
      path: '/admin/clock',
      handle: (_req, res) => {
        sendJson(res, clockState(deps.clock))
      },
    },
    {
      method: 'POST',
      path: '/admin/pause',
      handle: (_req, res) => {
        deps.clock.pause()
        sendJson(res, clockState(deps.clock))
      },
    },
    {
      method: 'POST',
      path: '/admin/resume',
      handle: (_req, res) => {
        deps.clock.resume()
        sendJson(res, clockState(deps.clock))
      },
    },
    {
      method: 'POST',
      path: '/admin/speed',
      handle: (req, res) => {
        void readBody(req).then((text) => {
          const x = Number(bodyJson(text).x)
          if (!(x >= MIN_SPEED && x <= MAX_SPEED)) {
            sendJson(res, { error: `expected {x} between ${MIN_SPEED} and ${MAX_SPEED}` }, 400)
            return
          }
          deps.clock.setSpeed(x)
          sendJson(res, clockState(deps.clock))
        })
      },
    },
    {
      method: 'GET',
      path: '/admin/cost',
      handle: (_req, res) => {
        sendJson(res, costReport())
      },
    },
    {
      method: 'GET',
      path: '/admin/rulings/pending',
      handle: (_req, res) => {
        sendJson(res, { pending: deps.ops()?.rulings?.pending() ?? [] })
      },
    },
    { method: 'POST', path: '/admin/rulings/:id/approve', handle: rulingRoute(deps, 'approve') },
    { method: 'POST', path: '/admin/rulings/:id/revert', handle: rulingRoute(deps, 'revert') },
    {
      method: 'GET',
      path: '/admin/export',
      handle: (_req, res) => {
        res.writeHead(200, {
          'content-type': 'application/x-tar',
          'content-disposition': `attachment; filename="san-junipero-tick-${deps.clock.tick}.tar"`,
        })
        writeRunTar(res, deps)
        res.end()
      },
    },
  ]
}

import type { ServerResponse } from 'node:http'
import Database from 'better-sqlite3'
import { readBody, type AdminRoute } from './adminLaws.js'
import { writeRunTar, type ExportOpts } from './exportRun.js'
import type { LiveOps } from './liveCast.js'

/** The world clock, as the operator holds it. `TickLoop` satisfies this. */
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
  /** The live half's ledger and ruling queue, or null on a scripted stream. */
  ops: () => LiveOps | null
}

/** Faster than a mind can think and slower than the disk can write are both useless. */
const MIN_SPEED = 0.1
export const MAX_SPEED = 60
/** The projection window, in real minutes — the same window `@sj/llm`'s spend monitor uses. The
 *  gateway reads the ledger rather than importing it: `@sj/llm` pulls the model SDK. */
const SPEND_WINDOW_REAL_MINUTES = 15
/** One sim-day is one real hour, so a 15-minute window scales by 4 to reach $/sim-day. */
const REAL_MINUTES_PER_SIM_DAY = 60
const DAY_MS = 24 * 60 * 60 * 1000
const TOP_MINDS = 10
const RECENT_ALERTS = 10

const send = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

// ── the money ───────────────────────────────────────────────────────────────────────────────

type Spend = { calls: number; usd: number }
export type CostReport = {
  /** False on a scripted stream: there is no ledger because nothing was ever bought. */
  live: boolean
  today: Spend
  lifetime: Spend
  projection: { usdPerSimDay: number; windowRealMinutes: number; sampledCalls: number }
  byCaller: (Spend & { caller: string })[]
  byMind: (Spend & { agentId: string })[]
  /** Cached input tokens over all input tokens, or null when nothing has been bought yet. */
  cacheReadShare: number | null
  caps: { dailyUsd: number; lifetimeUsd: number }
  stop: { dailyReached: boolean; lifetimeReached: boolean }
  alerts: { ts: number; kind: string; detail: string }[]
  answerRate: AnswerRate
}

const NOTHING_SPENT = { calls: 0, usd: 0 }

const spendSince = (db: Database.Database, sinceMs: number): Spend =>
  db
    .prepare(
      'SELECT COUNT(*) AS calls, COALESCE(SUM(cost_usd), 0) AS usd FROM llm_calls WHERE ts >= ?',
    )
    .get(sinceMs) as Spend

function ledger(
  db: Database.Database,
  caps: LiveOps['caps'],
  now: number,
): Omit<CostReport, 'answerRate'> {
  const today = spendSince(db, now - DAY_MS)
  const lifetime = spendSince(db, 0)
  const window = spendSince(db, now - SPEND_WINDOW_REAL_MINUTES * 60_000)
  const tokens = db
    .prepare(
      'SELECT COALESCE(SUM(input_tokens), 0) AS input, COALESCE(SUM(cache_read_tokens), 0) AS cached FROM llm_calls',
    )
    .get() as { input: number; cached: number }
  return {
    live: true,
    today,
    lifetime,
    projection: {
      usdPerSimDay: window.usd * (REAL_MINUTES_PER_SIM_DAY / SPEND_WINDOW_REAL_MINUTES),
      windowRealMinutes: SPEND_WINDOW_REAL_MINUTES,
      sampledCalls: window.calls,
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
    cacheReadShare: tokens.input > 0 ? tokens.cached / tokens.input : null,
    caps,
    stop: {
      dailyReached: caps.dailyUsd > 0 && today.usd >= caps.dailyUsd,
      lifetimeReached: caps.lifetimeUsd > 0 && lifetime.usd >= caps.lifetimeUsd,
    },
    alerts: db
      .prepare('SELECT ts, kind, detail FROM alerts ORDER BY id DESC LIMIT ?')
      .all(RECENT_ALERTS) as CostReport['alerts'],
  }
}

// ── the motive number ───────────────────────────────────────────────────────────────────────

/**
 * `~/handoff/cleanup/honest.md` §1 asks for the ANSWER RATE: of the wants a mind stated, the
 * share that led to an act. The drives layer it names does not exist on this branch, so this is
 * the closest the log can measure — of the actions a mind STARTED, the share that finished.
 * A mind that abandons everything it begins wanted none of it.
 */
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

export function costReport(deps: OpsDeps, now = Date.now()): CostReport {
  const ops = deps.ops()
  const money =
    ops === null
      ? {
          live: false,
          today: NOTHING_SPENT,
          lifetime: NOTHING_SPENT,
          projection: {
            usdPerSimDay: 0,
            windowRealMinutes: SPEND_WINDOW_REAL_MINUTES,
            sampledCalls: 0,
          },
          byCaller: [],
          byMind: [],
          cacheReadShare: null,
          caps: { dailyUsd: 0, lifetimeUsd: 0 },
          stop: { dailyReached: false, lifetimeReached: false },
          alerts: [],
        }
      : ledger(ops.opsDb, ops.caps, now)
  return { ...money, answerRate: answerRate(deps.worldDbPath) }
}

// ── the routes ──────────────────────────────────────────────────────────────────────────────

type ClockState = { paused: boolean; speed: number; tick: number }
const clockState = (c: Clock): ClockState => ({ paused: c.paused, speed: c.speed, tick: c.tick })

function rulingRoute(
  deps: OpsDeps,
  act: (rulings: NonNullable<LiveOps['rulings']>, ruleId: number, reason: string) => void,
): AdminRoute['handle'] {
  return (req, res, params) => {
    const rulings = deps.ops()?.rulings ?? null
    if (rulings === null) {
      send(res, 409, { error: 'this stream has no god layer — nothing has been codified' })
      return
    }
    const ruleId = Number(params.id)
    if (!Number.isInteger(ruleId)) {
      send(res, 400, { error: 'a ruling is named by its rule id' })
      return
    }
    void readBody(req).then((text) => {
      let reason = ''
      try {
        const said = (JSON.parse(text ?? '{}') as { reason?: unknown }).reason
        if (typeof said === 'string') reason = said
      } catch {
        reason = ''
      }
      try {
        act(rulings, ruleId, reason)
      } catch (e) {
        send(res, 400, { error: e instanceof Error ? e.message : String(e) })
        return
      }
      send(res, 200, { pending: rulings.pending() })
    })
  }
}

/** The operator's own routes, mounted beside `/admin/laws` on the same loopback bearer channel. */
export function adminOpsRoutes(deps: OpsDeps): AdminRoute[] {
  return [
    {
      method: 'GET',
      path: '/admin/clock',
      handle: (_req, res) => {
        send(res, 200, clockState(deps.clock))
      },
    },
    {
      method: 'POST',
      path: '/admin/pause',
      handle: (_req, res) => {
        deps.clock.pause()
        send(res, 200, clockState(deps.clock))
      },
    },
    {
      method: 'POST',
      path: '/admin/resume',
      handle: (_req, res) => {
        deps.clock.resume()
        send(res, 200, clockState(deps.clock))
      },
    },
    {
      method: 'POST',
      path: '/admin/speed',
      handle: (req, res) => {
        void readBody(req).then((text) => {
          let x = NaN
          try {
            x = Number((JSON.parse(text ?? '') as { x?: unknown }).x)
          } catch {
            x = NaN
          }
          if (!(x >= MIN_SPEED && x <= MAX_SPEED)) {
            send(res, 400, { error: `expected {x} between ${MIN_SPEED} and ${MAX_SPEED}` })
            return
          }
          deps.clock.setSpeed(x)
          send(res, 200, clockState(deps.clock))
        })
      },
    },
    {
      method: 'GET',
      path: '/admin/cost',
      handle: (_req, res) => {
        send(res, 200, costReport(deps))
      },
    },
    {
      method: 'GET',
      path: '/admin/rulings/pending',
      handle: (_req, res) => {
        send(res, 200, { pending: deps.ops()?.rulings?.pending() ?? [] })
      },
    },
    {
      method: 'POST',
      path: '/admin/rulings/:id/approve',
      handle: rulingRoute(deps, (rulings, ruleId) => {
        rulings.approve(ruleId)
      }),
    },
    {
      method: 'POST',
      path: '/admin/rulings/:id/revert',
      handle: rulingRoute(deps, (rulings, ruleId, reason) => {
        rulings.revert(ruleId, reason === '' ? 'the operator reverted it' : reason, deps.clock.tick)
      }),
    },
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

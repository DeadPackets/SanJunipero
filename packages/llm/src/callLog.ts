import type Database from 'better-sqlite3'
import { RAIL_WINDOW_MS } from './rails.js'

export type LlmCallInsert = {
  agentId: string | null
  caller: string
  model: string
  provider: string | null
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  reasoningTokens: number
  // What the run books, which is the provider's own charge whenever it offered one.
  costUsd: number
  // OpenRouter's id for this generation, which is the only way to ask it later who served a
  // call whose answer named nobody.
  generationId?: string | null
  // What the pinned price table computed for this call, always. `costUsd` becomes the bill the
  // moment the provider names one, so only this column can be reconciled against it.
  estimatedCostUsd: number
  // What the provider said it charged, when it said.
  reportedCostUsd: number | null
  latencyMs: number
  // Why the provider stopped. `length` means the answer hit `maxOutputTokens` rather than
  // ending, which is otherwise indistinguishable from a bad answer.
  finishReason: string | null
  ok: boolean
  error: string | null
  // Which `WakeReason` bought this call. Null for every caller that has no wake.
  wakeReason?: string | null
  // Every reason that was true at that tick, deciding one first, as a JSON array. The winner
  // alone hides the overlap: the reason below it would have bought the call anyway.
  wakeReasons?: readonly string[] | null
  // One JSON object, not a column per block: the blocks change as the prompt does, and a
  // schema migration for each is not worth it.
  blockTokens?: Record<string, number> | null
}

export function migrateLlmTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS llm_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      agent_id TEXT,
      caller TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      cache_read_tokens INTEGER NOT NULL,
      reasoning_tokens INTEGER NOT NULL,
      cost_usd REAL NOT NULL,
      estimated_cost_usd REAL,
      reported_cost_usd REAL,
      latency_ms INTEGER NOT NULL,
      ok INTEGER NOT NULL,
      error TEXT,
      provider TEXT,
      finish_reason TEXT,
      generation_id TEXT,
      wake_reason TEXT,
      wake_reasons TEXT,
      block_tokens TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_llm_calls_caller ON llm_calls(caller);
    CREATE INDEX IF NOT EXISTS idx_llm_calls_ts ON llm_calls(ts);
    CREATE INDEX IF NOT EXISTS idx_llm_calls_provider ON llm_calls(provider);
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      agent_id TEXT,
      kind TEXT NOT NULL,
      detail TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS turn_outcomes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      agent_id TEXT,
      provider TEXT,
      acted INTEGER NOT NULL,
      spoke INTEGER NOT NULL,
      plan_continued INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS llm_reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      caller TEXT NOT NULL,
      amount_usd REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'held',
      call_id INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_llm_reservations_caller ON llm_reservations(caller);
    CREATE TABLE IF NOT EXISTS spend_limits (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      lifetime_usd REAL,
      rolling_day_usd REAL
    );
  `)
  const reservationCols = db.prepare('PRAGMA table_info(llm_reservations)').all() as {
    name: string
  }[]
  if (!reservationCols.some((c) => c.name === 'status'))
    db.exec("ALTER TABLE llm_reservations ADD COLUMN status TEXT NOT NULL DEFAULT 'held'")
  if (!reservationCols.some((c) => c.name === 'call_id'))
    db.exec('ALTER TABLE llm_reservations ADD COLUMN call_id INTEGER')
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_llm_reservations_unsettled ON llm_reservations(caller) WHERE status IN ('held', 'uncertain')",
  )
  const cols = db.prepare('PRAGMA table_info(llm_calls)').all() as { name: string }[]
  if (!cols.some((c) => c.name === 'provider'))
    db.exec('ALTER TABLE llm_calls ADD COLUMN provider TEXT')
  if (!cols.some((c) => c.name === 'reported_cost_usd')) {
    db.exec('ALTER TABLE llm_calls ADD COLUMN reported_cost_usd REAL')
  }
  if (!cols.some((c) => c.name === 'estimated_cost_usd')) {
    db.exec('ALTER TABLE llm_calls ADD COLUMN estimated_cost_usd REAL')
  }
  if (!cols.some((c) => c.name === 'finish_reason')) {
    db.exec('ALTER TABLE llm_calls ADD COLUMN finish_reason TEXT')
  }
  if (!cols.some((c) => c.name === 'generation_id')) {
    db.exec('ALTER TABLE llm_calls ADD COLUMN generation_id TEXT')
  }
  if (!cols.some((c) => c.name === 'wake_reason')) {
    db.exec('ALTER TABLE llm_calls ADD COLUMN wake_reason TEXT')
  }
  if (!cols.some((c) => c.name === 'wake_reasons')) {
    db.exec('ALTER TABLE llm_calls ADD COLUMN wake_reasons TEXT')
  }
  if (!cols.some((c) => c.name === 'block_tokens')) {
    db.exec('ALTER TABLE llm_calls ADD COLUMN block_tokens TEXT')
  }
  const outcomeCols = db.prepare('PRAGMA table_info(turn_outcomes)').all() as { name: string }[]
  if (!outcomeCols.some((c) => c.name === 'plan_continued')) {
    db.exec('ALTER TABLE turn_outcomes ADD COLUMN plan_continued INTEGER NOT NULL DEFAULT 0')
  }
}

/** What one paid turn produced, against the back end that answered it — a turn that acts on
 *  nothing and says nothing is legal, and this row is its only trace. `planContinued` is the
 *  fourth outcome: a plan, running or committed by this same answer, is carrying the body. */
export function insertTurnOutcome(
  db: Database.Database,
  row: {
    agentId: string | null
    provider: string | null
    acted: boolean
    spoke: boolean
    planContinued: boolean
  },
): void {
  db.prepare(
    'INSERT INTO turn_outcomes (ts, agent_id, provider, acted, spoke, plan_continued) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    Date.now(),
    row.agentId,
    row.provider,
    row.acted ? 1 : 0,
    row.spoke ? 1 : 0,
    row.planContinued ? 1 : 0,
  )
}

export function configureSpendLimits(
  db: Database.Database,
  limits: { lifetimeUsd: number | null; rollingDayUsd: number | null },
): void {
  for (const value of [limits.lifetimeUsd, limits.rollingDayUsd]) {
    if (value !== null && (!Number.isFinite(value) || value < 0))
      throw new Error('invalid spending limit')
  }
  db.prepare(
    `INSERT INTO spend_limits (id, lifetime_usd, rolling_day_usd) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET lifetime_usd = excluded.lifetime_usd,
       rolling_day_usd = excluded.rolling_day_usd`,
  ).run(limits.lifetimeUsd, limits.rollingDayUsd)
}

export function sumReserved(db: Database.Database, caller?: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) AS total FROM llm_reservations
     WHERE status IN ('held', 'uncertain')${caller === undefined ? '' : ' AND caller = ?'}`,
    )
    .get(...(caller === undefined ? [] : [caller])) as { total: number }
  return row.total
}

type CallerRail = { usd: number; sinceMs: number }
export type Reserved = { id: number } | { held: 'budget' | 'rail'; spentUsd: number }

export type BudgetGuard = {
  reserve(expectedUsd: number, budgetUsd: number | null, rail: CallerRail | null): Reserved
  reconcile(reservationId: number, call: LlmCallInsert): number
  retainUncertain(reservationId: number): void
  release(reservationId: number): void
  sumReserved(): number
}

export function makeBudgetGuard(db: Database.Database, caller: string): BudgetGuard {
  const reserve = db.transaction(
    (expectedUsd: number, budgetUsd: number | null, rail: CallerRail | null): Reserved => {
      if (!Number.isFinite(expectedUsd) || expectedUsd < 0) throw new Error('invalid reservation')
      if (budgetUsd !== null && (!Number.isFinite(budgetUsd) || budgetUsd < 0))
        throw new Error('invalid spending limit')
      if (
        rail !== null &&
        (!Number.isFinite(rail.usd) || rail.usd < 0 || !Number.isFinite(rail.sinceMs))
      )
        throw new Error('invalid caller allowance')
      const limits = db
        .prepare('SELECT lifetime_usd, rolling_day_usd FROM spend_limits WHERE id = 1')
        .get() as { lifetime_usd: number | null; rolling_day_usd: number | null } | undefined
      const lifetime = sumCostUsd(db)
      const held = sumReserved(db)
      const ceiling = limits?.lifetime_usd ?? Infinity
      const refuse = (
        window: 'lifetime' | 'rolling-day',
        spentUsd: number,
        limitUsd: number,
      ): Reserved => {
        insertAlert(db, {
          agentId: null,
          kind: 'town_budget_refused',
          detail: JSON.stringify({
            caller,
            window,
            spentUsd,
            limitUsd,
            heldUsd: held,
            expectedUsd,
          }),
        })
        return { held: 'budget', spentUsd }
      }
      if (lifetime + held + expectedUsd > ceiling) return refuse('lifetime', lifetime, ceiling)
      const today = sumCostUsdSince(db, undefined, Date.now() - RAIL_WINDOW_MS)
      const dailyCeiling = limits?.rolling_day_usd ?? Infinity
      if (today + held + expectedUsd > dailyCeiling)
        return refuse('rolling-day', today, dailyCeiling)
      if (budgetUsd !== null && lifetime + held + expectedUsd > budgetUsd)
        return { held: 'budget', spentUsd: lifetime }
      if (rail !== null) {
        const callerToday = sumCostUsdSince(db, caller, rail.sinceMs)
        if (callerToday + sumReserved(db, caller) + expectedUsd > rail.usd)
          return { held: 'rail', spentUsd: callerToday }
      }
      return {
        id: Number(
          db
            .prepare('INSERT INTO llm_reservations (ts, caller, amount_usd) VALUES (?, ?, ?)')
            .run(Date.now(), caller, expectedUsd).lastInsertRowid,
        ),
      }
    },
  )
  const reconcile = db.transaction((reservationId: number, call: LlmCallInsert): number => {
    const row = db
      .prepare('SELECT amount_usd, call_id FROM llm_reservations WHERE id = ? AND caller = ?')
      .get(reservationId, caller) as { amount_usd: number; call_id: number | null } | undefined
    if (row === undefined || call.caller !== caller) throw new Error('unknown spending reservation')
    if (row.call_id !== null) return row.call_id
    if (!Number.isFinite(call.costUsd) || call.costUsd < 0)
      throw new Error('invalid provider charge')
    const id = insertLlmCall(db, call)
    db.prepare("UPDATE llm_reservations SET status = 'settled', call_id = ? WHERE id = ?").run(
      id,
      reservationId,
    )
    if (call.costUsd > row.amount_usd)
      insertAlert(db, {
        agentId: call.agentId,
        kind: 'reservation_overrun',
        detail: `${caller}: reserved $${row.amount_usd.toFixed(6)}, charged $${call.costUsd.toFixed(6)}`,
      })
    return id
  })
  return {
    reserve: (expectedUsd, budgetUsd, rail) => reserve.immediate(expectedUsd, budgetUsd, rail),
    reconcile: (reservationId, call) => reconcile.immediate(reservationId, call),
    retainUncertain: (reservationId) => {
      const retained = db
        .prepare(
          "UPDATE llm_reservations SET status = 'uncertain' WHERE id = ? AND caller = ? AND status = 'held'",
        )
        .run(reservationId, caller)
      if (retained.changes > 0)
        insertAlert(db, {
          agentId: null,
          kind: 'unconfirmed_charge',
          detail: `${caller}: reservation ${reservationId} is retained until provider billing is known`,
        })
    },
    release: (reservationId) => {
      db.prepare(
        "UPDATE llm_reservations SET status = 'released' WHERE id = ? AND caller = ? AND status = 'held'",
      ).run(reservationId, caller)
    },
    sumReserved: () => sumReserved(db, caller),
  }
}

/** Returns the row it wrote, so a fact the caller only learns after the answer parses can be
 *  merged into the same row rather than guessed at from the outside. */
export function insertLlmCall(db: Database.Database, call: LlmCallInsert): number {
  const info = db
    .prepare(
      `INSERT INTO llm_calls
       (ts, agent_id, caller, model, input_tokens, output_tokens, cache_read_tokens,
        reasoning_tokens, cost_usd, estimated_cost_usd, reported_cost_usd, latency_ms, ok,
        error, provider, finish_reason, generation_id, wake_reason, wake_reasons, block_tokens)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      Date.now(),
      call.agentId,
      call.caller,
      call.model,
      call.inputTokens,
      call.outputTokens,
      call.cacheReadTokens,
      call.reasoningTokens,
      call.costUsd,
      call.estimatedCostUsd,
      call.reportedCostUsd,
      Math.round(call.latencyMs),
      call.ok ? 1 : 0,
      call.error,
      call.provider,
      call.finishReason,
      call.generationId ?? null,
      call.wakeReason ?? null,
      call.wakeReasons == null ? null : JSON.stringify(call.wakeReasons),
      call.blockTokens == null ? null : JSON.stringify(call.blockTokens),
    )
  return Number(info.lastInsertRowid)
}

/** What the answer committed to, which the caller only learns once the plan has parsed. */
export function mergeBlockTokens(
  db: Database.Database,
  id: number,
  patch: Record<string, number>,
): void {
  const row = db.prepare('SELECT block_tokens AS json FROM llm_calls WHERE id = ?').get(id) as
    | { json: string | null }
    | undefined
  if (row === undefined) return
  const base = row.json === null ? {} : (JSON.parse(row.json) as Record<string, number>)
  db.prepare('UPDATE llm_calls SET block_tokens = ? WHERE id = ?').run(
    JSON.stringify({ ...base, ...patch }),
    id,
  )
}

export function insertAlert(
  db: Database.Database,
  alert: { agentId: string | null; kind: string; detail: string },
): void {
  db.prepare('INSERT INTO alerts (ts, agent_id, kind, detail) VALUES (?, ?, ?, ?)').run(
    Date.now(),
    alert.agentId,
    alert.kind,
    alert.detail,
  )
}

/** A call OpenRouter answered without naming its back end. It books at the ceiling and cannot
 *  be reconciled, so it is the one row shape worth going back and asking about. */
export type UnattributedCall = {
  id: number
  generationId: string
  agentId: string | null
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
}

/** Old enough that the provider has written its accounting row, young enough that the provider
 *  still has one. A row outside the band is never asked about again. A refused answer counts as
 *  much as an accepted one: r13's 3 dearest unattributed rows were schema misses, 17.5k tokens
 *  each and booked at the ceiling. A row that billed nothing has nothing to re-price. */
export function unattributedCalls(
  db: Database.Database,
  window: { from: number; until: number; limit: number; skip?: readonly string[] },
): UnattributedCall[] {
  const skip = window.skip ?? []
  // Excluded in SQL, not after: filtered afterwards they would still fill the limit and hold
  // every newer row out of the window.
  const notThese =
    skip.length === 0 ? '' : `AND generation_id NOT IN (${skip.map(() => '?').join(',')})`
  return db
    .prepare(
      `SELECT id, generation_id AS generationId, agent_id AS agentId, model,
              input_tokens AS inputTokens, output_tokens AS outputTokens,
              cache_read_tokens AS cacheReadTokens
         FROM llm_calls
        WHERE provider IS NULL AND generation_id IS NOT NULL
          AND (input_tokens > 0 OR output_tokens > 0)
          AND ts >= ? AND ts <= ? ${notThese}
        ORDER BY id LIMIT ?`,
    )
    .all(window.from, window.until, ...skip, window.limit) as UnattributedCall[]
}

export type CallPricing = {
  provider: string
  reportedCostUsd: number | null
  estimatedCostUsd: number
  costUsd: number
}

export function updateCallPricing(db: Database.Database, id: number, p: CallPricing): void {
  db.prepare(
    `UPDATE llm_calls
        SET provider = ?, reported_cost_usd = ?, estimated_cost_usd = ?, cost_usd = ?
      WHERE id = ?`,
  ).run(p.provider, p.reportedCostUsd, p.estimatedCostUsd, p.costUsd, id)
}

export function sumCostUsd(db: Database.Database, caller?: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) AS total FROM llm_calls${caller === undefined ? '' : ' WHERE caller = ?'}`,
    )
    .get(...(caller === undefined ? [] : [caller])) as { total: number }
  return row.total
}

/** What this caller has spent inside a rolling window. `idx_llm_calls_caller` serves it. */
function sumCostUsdSince(
  db: Database.Database,
  caller: string | undefined,
  sinceMs: number,
): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) AS total FROM llm_calls WHERE ts >= ?${caller === undefined ? '' : ' AND caller = ?'}`,
    )
    .get(sinceMs, ...(caller === undefined ? [] : [caller])) as { total: number }
  return row.total
}

/** When the oldest call still inside the window was billed — the moment the window rolls off it
 *  and the caller has room again. Null when it has spent nothing in the window at all. */
export function oldestCallTsSince(
  db: Database.Database,
  caller: string,
  sinceMs: number,
): number | null {
  const row = db
    .prepare('SELECT MIN(ts) AS ts FROM llm_calls WHERE caller = ? AND ts >= ?')
    .get(caller, sinceMs) as { ts: number | null }
  return row.ts
}

/** The operator's own line, newest first is not wanted here: the stream logs them in order. */
export function alertsSince(
  db: Database.Database,
  afterId: number,
  kind: string,
): { id: number; detail: string }[] {
  return db
    .prepare('SELECT id, detail FROM alerts WHERE id > ? AND kind = ? ORDER BY id')
    .all(afterId, kind) as { id: number; detail: string }[]
}

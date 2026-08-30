import type Database from 'better-sqlite3'

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
  // What the pinned price table computed for this call, always. `costUsd` becomes the bill the
  // moment the provider names one, so only this column can be reconciled against it.
  estimatedCostUsd: number
  // What the provider said it charged, when it said.
  reportedCostUsd: number | null
  latencyMs: number
  ok: boolean
  error: string | null
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
      provider TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_llm_calls_caller ON llm_calls(caller);
    CREATE INDEX IF NOT EXISTS idx_llm_calls_provider ON llm_calls(provider);
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      agent_id TEXT,
      kind TEXT NOT NULL,
      detail TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS llm_reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      caller TEXT NOT NULL,
      amount_usd REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_llm_reservations_caller ON llm_reservations(caller);
  `)
  const cols = db.prepare('PRAGMA table_info(llm_calls)').all() as { name: string }[]
  if (!cols.some((c) => c.name === 'provider'))
    db.exec('ALTER TABLE llm_calls ADD COLUMN provider TEXT')
  if (!cols.some((c) => c.name === 'reported_cost_usd')) {
    db.exec('ALTER TABLE llm_calls ADD COLUMN reported_cost_usd REAL')
  }
  if (!cols.some((c) => c.name === 'estimated_cost_usd')) {
    db.exec('ALTER TABLE llm_calls ADD COLUMN estimated_cost_usd REAL')
  }
}

export function sumReserved(db: Database.Database, caller: string): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(amount_usd), 0) AS total FROM llm_reservations WHERE caller = ?')
    .get(caller) as { total: number }
  return row.total
}

export type BudgetGuard = {
  reserve(expectedUsd: number, budgetUsd: number | null): number | null
  release(reservationId: number): void
  sumReserved(): number
}

// Booking after the fact lets every call in flight pass one read-only check and all overshoot.
// Read and claim inside one synchronous transaction; the worst overshoot is one reserved call.
export function makeBudgetGuard(db: Database.Database, caller: string): BudgetGuard {
  const insert = db.prepare(
    'INSERT INTO llm_reservations (ts, caller, amount_usd) VALUES (?, ?, ?)',
  )
  const remove = db.prepare('DELETE FROM llm_reservations WHERE id = ?')
  const reserve = db.transaction((expectedUsd: number, budgetUsd: number | null): number | null => {
    if (
      budgetUsd !== null &&
      sumCostUsd(db, caller) + sumReserved(db, caller) + expectedUsd > budgetUsd
    ) {
      return null
    }
    return Number(insert.run(Date.now(), caller, expectedUsd).lastInsertRowid)
  })
  return {
    reserve,
    release: (reservationId) => {
      remove.run(reservationId)
    },
    sumReserved: () => sumReserved(db, caller),
  }
}

export function insertLlmCall(db: Database.Database, call: LlmCallInsert): void {
  db.prepare(
    `INSERT INTO llm_calls
       (ts, agent_id, caller, model, input_tokens, output_tokens, cache_read_tokens,
        reasoning_tokens, cost_usd, estimated_cost_usd, reported_cost_usd, latency_ms, ok,
        error, provider)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
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

export function sumCostUsd(db: Database.Database, caller: string): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(cost_usd), 0) AS total FROM llm_calls WHERE caller = ?')
    .get(caller) as { total: number }
  return row.total
}

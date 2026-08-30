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
      generation_id TEXT
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
  if (!cols.some((c) => c.name === 'finish_reason')) {
    db.exec('ALTER TABLE llm_calls ADD COLUMN finish_reason TEXT')
  }
  if (!cols.some((c) => c.name === 'generation_id')) {
    db.exec('ALTER TABLE llm_calls ADD COLUMN generation_id TEXT')
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
        error, provider, finish_reason, generation_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    call.finishReason,
    call.generationId ?? null,
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
 *  still has one. A row outside the band is never asked about again. */
export function unattributedCalls(
  db: Database.Database,
  window: { from: number; until: number; limit: number },
): UnattributedCall[] {
  return db
    .prepare(
      `SELECT id, generation_id AS generationId, agent_id AS agentId, model,
              input_tokens AS inputTokens, output_tokens AS outputTokens,
              cache_read_tokens AS cacheReadTokens
         FROM llm_calls
        WHERE provider IS NULL AND generation_id IS NOT NULL AND ok = 1
          AND ts >= ? AND ts <= ?
        ORDER BY id LIMIT ?`,
    )
    .all(window.from, window.until, window.limit) as UnattributedCall[]
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

export function sumCostUsd(db: Database.Database, caller: string): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(cost_usd), 0) AS total FROM llm_calls WHERE caller = ?')
    .get(caller) as { total: number }
  return row.total
}

import type Database from 'better-sqlite3'

export type LlmCallInsert = {
  agentId: string | null
  caller: string
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  reasoningTokens: number
  costUsd: number
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
      latency_ms INTEGER NOT NULL,
      ok INTEGER NOT NULL,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_llm_calls_caller ON llm_calls(caller);
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      agent_id TEXT,
      kind TEXT NOT NULL,
      detail TEXT NOT NULL
    );
  `)
}

export function insertLlmCall(db: Database.Database, call: LlmCallInsert): void {
  db.prepare(
    `INSERT INTO llm_calls
       (ts, agent_id, caller, model, input_tokens, output_tokens, cache_read_tokens,
        reasoning_tokens, cost_usd, latency_ms, ok, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    Math.round(call.latencyMs),
    call.ok ? 1 : 0,
    call.error,
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

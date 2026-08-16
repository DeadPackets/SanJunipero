import Database from 'better-sqlite3'

export function openForgeDb(path: string): Database.Database {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS assets (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      class TEXT NOT NULL,
      desc TEXT NOT NULL,
      footprint_w INTEGER NOT NULL,
      footprint_h INTEGER NOT NULL,
      png BLOB NOT NULL,
      width_px INTEGER NOT NULL,
      height_px INTEGER NOT NULL,
      status TEXT NOT NULL,
      score REAL,
      attempts INTEGER NOT NULL,
      cost_usd REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      run_at TEXT NOT NULL DEFAULT (datetime('now')),
      result TEXT,
      error TEXT,
      started_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_claim ON jobs(status, run_at);
  `)
  return db
}

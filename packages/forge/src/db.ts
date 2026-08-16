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
    CREATE TABLE IF NOT EXISTS vision_qa (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id TEXT NOT NULL,
      asset_class TEXT NOT NULL,
      rubric_version TEXT NOT NULL,
      model TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      overall TEXT NOT NULL,
      scores TEXT NOT NULL,
      cost_usd REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_vision_qa_class ON vision_qa(asset_class, created_at);
  `)
  const cols = db.pragma('table_info(assets)') as Array<{ name: string }>
  if (!cols.some(c => c.name === 'kind')) {
    db.exec('ALTER TABLE assets ADD COLUMN kind TEXT')
    // backfill pre-existing rows only, by the desc-prefix convention; new rows set kind at register
    db.exec("UPDATE assets SET kind = substr(desc, 1, instr(desc, ':') - 1) WHERE instr(desc, ':') > 0")
  }
  if (!cols.some(c => c.name === 'meta')) {
    db.exec('ALTER TABLE assets ADD COLUMN meta TEXT') // v4 hi-res manifest JSON; no backfill (v2 rows have none)
  }
  return db
}

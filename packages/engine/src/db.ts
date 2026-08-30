import Database from 'better-sqlite3'

export function openDb(path: string): Database.Database {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  // Under WAL this drops the per-commit fsync (measured 2.897 -> 0.171 ms on the tick
  // transaction): a power cut may lose the last commits, never corrupt them.
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      tick INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_tick ON events(tick);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tick INTEGER NOT NULL,
      seq INTEGER NOT NULL,
      state TEXT NOT NULL,
      rng TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    -- Scrubbing reads snapshots by (tick DESC, id DESC); without this it is a SCAN plus a
    -- temp b-tree over rows carrying ~30 KB of state JSON, and it slows as the world ages.
    CREATE INDEX IF NOT EXISTS idx_snapshots_tick ON snapshots(tick DESC, id DESC);
    CREATE TABLE IF NOT EXISTS rng_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      tick INTEGER NOT NULL,
      rng TEXT NOT NULL
    );
  `)
  return db
}

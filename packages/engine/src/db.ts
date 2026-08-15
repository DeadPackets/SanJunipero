import Database from 'better-sqlite3'

export function openDb(path: string): Database.Database {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      tick INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_tick ON events(tick);
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tick INTEGER NOT NULL,
      seq INTEGER NOT NULL,
      state TEXT NOT NULL,
      rng TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS rng_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      tick INTEGER NOT NULL,
      rng TEXT NOT NULL
    );
  `)
  return db
}

import type Database from 'better-sqlite3'

// Observer-side only (spec §5): thoughts never enter world state and are never read by fold.
export function ensureObserverTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS observer_thoughts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tick INTEGER NOT NULL, agent_id TEXT NOT NULL, text TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_observer_thoughts_id ON observer_thoughts(id);
  `)
}

export function publishThought(db: Database.Database, t: { tick: number; agentId: string; text: string }): void {
  db.prepare('INSERT INTO observer_thoughts (tick, agent_id, text) VALUES (?, ?, ?)').run(t.tick, t.agentId, t.text)
}

export function thoughtsSince(db: Database.Database, idExclusive: number): Array<{ id: number; tick: number; agentId: string; text: string }> {
  const rows = db.prepare('SELECT id, tick, agent_id, text FROM observer_thoughts WHERE id > ? ORDER BY id').all(idExclusive) as
    Array<{ id: number; tick: number; agent_id: string; text: string }>
  return rows.map(r => ({ id: r.id, tick: r.tick, agentId: r.agent_id, text: r.text }))
}

export function latestThought(db: Database.Database, agentId: string): { tick: number; text: string } | null {
  const r = db.prepare('SELECT tick, text FROM observer_thoughts WHERE agent_id = ? ORDER BY id DESC LIMIT 1').get(agentId) as
    { tick: number; text: string } | undefined
  return r ?? null
}

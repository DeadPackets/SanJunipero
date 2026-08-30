import type Database from 'better-sqlite3'

// Observer-side only (spec §5): thoughts never enter world state and are never read by fold.
export function ensureObserverTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS observer_thoughts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tick INTEGER NOT NULL, agent_id TEXT NOT NULL, text TEXT NOT NULL
    );
    -- id is the rowid, so idx_observer_thoughts_id was a duplicate b-tree written on every
    -- thought. Dropped, not just removed, so databases that already have it stop paying.
    DROP INDEX IF EXISTS idx_observer_thoughts_id;
    CREATE INDEX IF NOT EXISTS idx_observer_thoughts_tick ON observer_thoughts(tick);
  `)
}

type Stmts = { insert: Database.Statement; since: Database.Statement }

// Both run on the pump's per-poll path, so they are compiled once per database rather than
// once per call — the same prepare-once shape `EventStore` holds on its own object.
const prepared = new WeakMap<Database.Database, Stmts>()

function stmts(db: Database.Database): Stmts {
  const cached = prepared.get(db)
  if (cached !== undefined) return cached
  const fresh: Stmts = {
    insert: db.prepare('INSERT INTO observer_thoughts (tick, agent_id, text) VALUES (?, ?, ?)'),
    since: db.prepare(
      'SELECT id, tick, agent_id, text FROM observer_thoughts WHERE id > ? ORDER BY id',
    ),
  }
  prepared.set(db, fresh)
  return fresh
}

export function publishThought(
  db: Database.Database,
  t: { tick: number; agentId: string; text: string },
): void {
  stmts(db).insert.run(t.tick, t.agentId, t.text)
}

export function thoughtsSince(
  db: Database.Database,
  idExclusive: number,
): { id: number; tick: number; agentId: string; text: string }[] {
  const rows = stmts(db).since.all(idExclusive) as {
    id: number
    tick: number
    agent_id: string
    text: string
  }[]
  return rows.map((r) => ({ id: r.id, tick: r.tick, agentId: r.agent_id, text: r.text }))
}

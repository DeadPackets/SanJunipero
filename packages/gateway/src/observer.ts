import type Database from 'better-sqlite3'
import { MINUTES_PER_DAY } from '@sj/shared'

/** What a publisher that does not weigh its thoughts gets: the middle of the 1–10 scale, which
 *  sits below the viewer's bubble gate. Stored and readable; not a wisp over a head. */
export const UNWEIGHED_IMPORTANCE = 5

// Observer-side only (spec §5): thoughts never enter world state and are never read by fold.
export function ensureObserverTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS observer_thoughts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tick INTEGER NOT NULL, agent_id TEXT NOT NULL, text TEXT NOT NULL,
      importance INTEGER NOT NULL DEFAULT ${UNWEIGHED_IMPORTANCE}
    );
    -- id is the rowid, so idx_observer_thoughts_id was a duplicate b-tree written on every
    -- thought. Dropped, not just removed, so databases that already have it stop paying.
    DROP INDEX IF EXISTS idx_observer_thoughts_id;
    CREATE INDEX IF NOT EXISTS idx_observer_thoughts_tick ON observer_thoughts(tick);
    CREATE TABLE IF NOT EXISTS observer_moods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tick INTEGER NOT NULL, agent_id TEXT NOT NULL, mood TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS observer_minds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tick INTEGER NOT NULL, agent_id TEXT NOT NULL, state TEXT NOT NULL
    );
  `)
  const cols = db.pragma('table_info(observer_thoughts)') as { name: string }[]
  if (!cols.some((c) => c.name === 'importance')) {
    db.exec(
      `ALTER TABLE observer_thoughts ADD COLUMN importance INTEGER NOT NULL DEFAULT ${UNWEIGHED_IMPORTANCE}`,
    )
  }
}

type Stmts = {
  insert: Database.Statement
  since: Database.Statement
  insertMood: Database.Statement
  moodsSince: Database.Statement
  latestMoods: Database.Statement
}

// Both run on the pump's per-poll path, so they are compiled once per database rather than
// once per call — the same prepare-once shape `EventStore` holds on its own object.
const prepared = new WeakMap<Database.Database, Stmts>()

function stmts(db: Database.Database): Stmts {
  const cached = prepared.get(db)
  if (cached !== undefined) return cached
  const fresh: Stmts = {
    insert: db.prepare(
      'INSERT INTO observer_thoughts (tick, agent_id, text, importance) VALUES (?, ?, ?, ?)',
    ),
    since: db.prepare(
      'SELECT id, tick, agent_id AS agentId, text, importance FROM observer_thoughts WHERE id > ? ORDER BY id',
    ),
    insertMood: db.prepare('INSERT INTO observer_moods (tick, agent_id, mood) VALUES (?, ?, ?)'),
    moodsSince: db.prepare(
      'SELECT id, tick, agent_id AS agentId, mood FROM observer_moods WHERE id > ? ORDER BY id',
    ),
    latestMoods: db.prepare(
      'SELECT id, tick, agent_id AS agentId, mood FROM observer_moods WHERE id IN (SELECT MAX(id) FROM observer_moods GROUP BY agent_id) ORDER BY id',
    ),
  }
  prepared.set(db, fresh)
  return fresh
}

export function publishThought(
  db: Database.Database,
  t: { tick: number; agentId: string; text: string; importance?: number },
): void {
  stmts(db).insert.run(t.tick, t.agentId, t.text, t.importance ?? UNWEIGHED_IMPORTANCE)
}

export function thoughtsSince(
  db: Database.Database,
  idExclusive: number,
): { id: number; tick: number; agentId: string; text: string; importance: number }[] {
  return stmts(db).since.all(idExclusive) as {
    id: number
    tick: number
    agentId: string
    text: string
    importance: number
  }[]
}

export type MoodRow = { id: number; tick: number; agentId: string; mood: string }

export function publishMood(
  db: Database.Database,
  m: { tick: number; agentId: string; mood: string },
): void {
  stmts(db).insertMood.run(m.tick, m.agentId, m.mood)
}

export function moodsSince(db: Database.Database, idExclusive: number): MoodRow[] {
  return stmts(db).moodsSince.all(idExclusive) as MoodRow[]
}

/** One row per mind, the word it holds now: what a late viewer is handed at the greeting. */
export function latestMoods(db: Database.Database): MoodRow[] {
  return stmts(db).latestMoods.all() as MoodRow[]
}

export type MindRow = { id: number; tick: number; agentId: string; state: 'deciding' | 'idle' }

type MindStmts = {
  insert: Database.Statement
  since: Database.Statement
  maxId: Database.Statement
  trim: Database.Statement
  written: number
}

// Its own cache, because `prepare` throws on a table that is not there and a world file written
// before this table existed must still hand the gateway its thoughts.
const preparedMinds = new WeakMap<Database.Database, MindStmts>()

function mindStmts(db: Database.Database): MindStmts {
  const cached = preparedMinds.get(db)
  if (cached !== undefined) return cached
  const fresh: MindStmts = {
    insert: db.prepare('INSERT INTO observer_minds (tick, agent_id, state) VALUES (?, ?, ?)'),
    since: db.prepare(
      'SELECT id, tick, agent_id AS agentId, state FROM observer_minds WHERE id > ? ORDER BY id',
    ),
    maxId: db.prepare('SELECT MAX(id) AS id FROM observer_minds'),
    trim: db.prepare('DELETE FROM observer_minds WHERE tick < ?'),
    written: 0,
  }
  preparedMinds.set(db, fresh)
  return fresh
}

/** Two rows per turn per body forever is a leak, and the thought table already has it. The
 *  sweep rides the insert rather than a caller's cadence, so no caller can forget it. */
const MIND_TRIM_EVERY = 128

export function publishMind(
  db: Database.Database,
  m: { tick: number; agentId: string; state: 'deciding' | 'idle' },
): void {
  const s = mindStmts(db)
  s.insert.run(m.tick, m.agentId, m.state)
  s.written += 1
  if (s.written >= MIND_TRIM_EVERY) {
    s.written = 0
    s.trim.run(m.tick - MINUTES_PER_DAY)
  }
}

export function mindsSince(db: Database.Database, idExclusive: number): MindRow[] {
  const rows = mindStmts(db).since.all(idExclusive) as (Omit<MindRow, 'state'> & {
    state: string
  })[]
  return rows.map((r) => ({ ...r, state: r.state === 'deciding' ? 'deciding' : 'idle' }))
}

/** Where a fresh gateway starts reading. Rows a previous process wrote are history: a town that
 *  died mid-turn left a `deciding` with no `idle`, and replaying it lights a caret nothing puts out. */
export function maxMindId(db: Database.Database): number {
  return (mindStmts(db).maxId.get() as { id: number | null }).id ?? 0
}

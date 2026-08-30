import Database from 'better-sqlite3'
import { NARRATOR_DDL } from '@sj/shared/narratorSchema'
import { migrateLlmTables } from '@sj/llm'

export const NARRATOR_TABLES = [
  'scenes',
  'chapters',
  'eras',
  'heat_scores',
  'milestones',
  'institutions',
  'publications',
  'semantic_first_detected',
  'semantic_candidates',
] as const

// One ledger widened rather than a rival one beside it; every existing row is a tier-1 engine
// first, which is what the defaults say. Idempotent: columns are added only where missing.
const MILESTONE_COLUMNS: readonly { name: string; ddl: string }[] = [
  { name: 'tier', ddl: "ALTER TABLE milestones ADD COLUMN tier TEXT NOT NULL DEFAULT '1'" },
  {
    name: 'domain',
    ddl: "ALTER TABLE milestones ADD COLUMN domain TEXT NOT NULL DEFAULT 'engine'",
  },
  {
    name: 'agent_ids',
    ddl: "ALTER TABLE milestones ADD COLUMN agent_ids TEXT NOT NULL DEFAULT '[]'",
  },
  { name: 'construct_id', ddl: 'ALTER TABLE milestones ADD COLUMN construct_id TEXT' },
  { name: 'name_provenance', ddl: 'ALTER TABLE milestones ADD COLUMN name_provenance TEXT' },
]

export function migrateNarratorTables(db: Database.Database): void {
  db.exec(NARRATOR_DDL)
  const have = new Set(
    (db.prepare('PRAGMA table_info(milestones)').all() as { name: string }[]).map((c) => c.name),
  )
  for (const col of MILESTONE_COLUMNS) if (!have.has(col.name)) db.exec(col.ddl)
}

// Not engine openDb: that would create events/snapshots/rng_state — world tables
// that must never exist in narrator.db (one-way glass, Task 3 permissions test).
export function openNarratorDb(path: string): Database.Database {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrateLlmTables(db)
  migrateNarratorTables(db)
  return db
}

// Every world+agent table the narrator must not own (asserted absent from narrator.db).
export const WORLD_TABLES = [
  'events',
  'snapshots',
  'rng_state',
  'rulebook',
  'rulings',
  'rulings_fts',
  'rulings_vec',
  'ruling_reviews',
  'codex',
  'assets',
  'jobs',
  'memories',
  'memory_tags',
  'memories_fts',
  'memory_vec',
  'facts',
  'ledgers',
  'summary_nodes',
  'journal',
  'autobiography',
  'recall_misses',
  'personality_versions',
] as const

// Deliberately NOT engine openDb: readonly is the only genuine "no write grant"
// primitive better-sqlite3 exposes, and openDb would attempt DDL on open.
export function openNarratorWorld(townPath: string): Database.Database {
  return new Database(townPath, { readonly: true })
}

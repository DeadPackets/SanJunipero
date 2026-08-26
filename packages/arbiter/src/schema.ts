import type Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import { openDb } from '@sj/engine'
import { EMBEDDING_DIM } from '@sj/agents'

export function openArbiterDb(path: string): Database.Database {
  const db = openDb(path)
  sqliteVec.load(db)
  migrateArbiterTables(db)
  return db
}

export function migrateArbiterTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS codex (
      id TEXT PRIMARY KEY,
      era TEXT NOT NULL,
      name TEXT NOT NULL,
      prerequisite_id TEXT REFERENCES codex(id),
      known INTEGER NOT NULL DEFAULT 1
    );
  `)
  // Pre-known-flag DBs: every existing row was earned, so default 1.
  const codexCols = db.prepare('PRAGMA table_info(codex)').all() as { name: string }[]
  if (!codexCols.some((c) => c.name === 'known')) {
    db.exec('ALTER TABLE codex ADD COLUMN known INTEGER NOT NULL DEFAULT 1')
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS rulings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      intent_text TEXT NOT NULL,
      normalized_intent TEXT NOT NULL,
      verdict_json TEXT NOT NULL,
      tick INTEGER NOT NULL
    );
    CREATE TRIGGER IF NOT EXISTS rulings_no_update BEFORE UPDATE ON rulings
      BEGIN SELECT RAISE(ABORT,'rulings are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS rulings_no_delete BEFORE DELETE ON rulings
      BEGIN SELECT RAISE(ABORT,'rulings are immutable'); END;
    CREATE VIRTUAL TABLE IF NOT EXISTS rulings_fts USING fts5(
      intent_text, content='rulings', content_rowid='id'
    );
    CREATE TRIGGER IF NOT EXISTS rulings_fts_after_insert AFTER INSERT ON rulings
      BEGIN INSERT INTO rulings_fts(rowid, intent_text) VALUES (new.id, new.intent_text); END;
    CREATE VIRTUAL TABLE IF NOT EXISTS rulings_vec USING vec0(embedding float[${EMBEDDING_DIM}]);
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS rulebook (
      id INTEGER PRIMARY KEY,
      recipe_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      recipe_json TEXT NOT NULL,
      verb TEXT NOT NULL,
      tick INTEGER NOT NULL,
      reverted_at_tick INTEGER,
      reverted_reason TEXT
    );
  `)
  // The construct registry and its ops-plane record. Agent-invisible by construction: these
  // tables live in the arbiter's database, never in the world's.
  db.exec(`
    CREATE TABLE IF NOT EXISTS constructs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT,
      name_provenance TEXT,
      anchor TEXT,
      participants TEXT NOT NULL,
      first_tick INTEGER NOT NULL,
      recurrences TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS construct_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('construct_recognized','construct_named','construct_recurred')),
      construct_id TEXT NOT NULL REFERENCES constructs(id),
      tick INTEGER NOT NULL,
      payload TEXT NOT NULL
    );
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS ruling_reviews (
      id INTEGER PRIMARY KEY,
      rule_id INTEGER NOT NULL REFERENCES rulebook(id),
      recipe_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','approved','reverted')),
      reason TEXT,
      tick INTEGER NOT NULL
    );
  `)
}

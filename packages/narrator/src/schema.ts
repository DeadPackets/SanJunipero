import Database from 'better-sqlite3'
import { migrateLlmTables } from '@sj/agents'

export const NARRATOR_TABLES = [
  'scenes',
  'chapters',
  'eras',
  'heat_scores',
  'milestones',
  'institutions',
  'publications',
] as const

// "cast" is a SQLite keyword — quoted everywhere it appears in SQL.
const DDL = `
CREATE TABLE IF NOT EXISTS scenes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, day INTEGER NOT NULL, start_tick INTEGER NOT NULL,
  end_tick INTEGER NOT NULL, event_ids TEXT NOT NULL, "cast" TEXT NOT NULL, location TEXT);
CREATE INDEX IF NOT EXISTS idx_scenes_day ON scenes(day);
CREATE TABLE IF NOT EXISTS chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT, day INTEGER NOT NULL UNIQUE, title TEXT NOT NULL,
  text TEXT NOT NULL, citations TEXT NOT NULL, scene_ids TEXT NOT NULL,
  rendered_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS eras (
  id INTEGER PRIMARY KEY AUTOINCREMENT, start_day INTEGER NOT NULL, end_day INTEGER NOT NULL,
  title TEXT NOT NULL, text TEXT NOT NULL, citations TEXT NOT NULL, chapter_ids TEXT NOT NULL,
  rendered_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS heat_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT, scene_id INTEGER NOT NULL REFERENCES scenes(id),
  conflict REAL NOT NULL, novelty REAL NOT NULL, firsts REAL NOT NULL, stakes REAL NOT NULL,
  dramatic_irony REAL NOT NULL, total REAL NOT NULL);
CREATE INDEX IF NOT EXISTS idx_heat_scene ON heat_scores(scene_id);
CREATE TABLE IF NOT EXISTS milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL UNIQUE, label TEXT NOT NULL,
  event_seq INTEGER NOT NULL, day INTEGER NOT NULL, tick INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS institutions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL CHECK (kind IN ('group','rule','role')),
  name TEXT NOT NULL, description TEXT NOT NULL, founding_scene_id INTEGER NOT NULL,
  member_ids TEXT NOT NULL, source_event_ids TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS publications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, day INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('newspaper','biography','timelapse_caption','share_card')),
  title TEXT NOT NULL, body TEXT NOT NULL, citations TEXT,
  rendered_at TEXT NOT NULL DEFAULT (datetime('now')));
`

export function migrateNarratorTables(db: Database.Database): void {
  db.exec(DDL)
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

// The narrator's tables, written down once: @sj/narrator creates them and the gateway reads
// them by plain SELECT, because a free scripted stream may not import an LLM SDK.

// "cast" is a SQLite keyword — quoted everywhere it appears in SQL.
export const NARRATOR_DDL = `
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
CREATE TABLE IF NOT EXISTS semantic_first_detected (
  id INTEGER PRIMARY KEY AUTOINCREMENT, concept_kind TEXT NOT NULL UNIQUE, agent_id TEXT NOT NULL,
  day INTEGER NOT NULL, source_kind TEXT NOT NULL, event_seq INTEGER, memory_ref TEXT,
  quote TEXT NOT NULL, quote2 TEXT, provenance2 TEXT, confidence REAL NOT NULL, rationale TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS semantic_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT, concept_kind TEXT NOT NULL, agent_id TEXT NOT NULL,
  day INTEGER NOT NULL, source_kind TEXT NOT NULL, quote TEXT NOT NULL, confidence REAL NOT NULL,
  rationale TEXT NOT NULL, reason TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS publications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, day INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('newspaper','biography','timelapse_caption','share_card')),
  title TEXT NOT NULL, body TEXT NOT NULL, citations TEXT, subject_id TEXT,
  rendered_at TEXT NOT NULL DEFAULT (datetime('now')));
`

/** Everything the gateway is allowed to SELECT out of narrator.db. */
export const NARRATOR_READ_TABLES: Readonly<Record<string, readonly string[]>> = {
  chapters: ['day', 'title', 'text'],
  milestones: ['kind', 'label', 'day', 'tick'],
  scenes: ['day', 'start_tick', 'end_tick', '"cast"', 'location'],
  publications: ['day', 'kind', 'title', 'body', 'subject_id'],
  eras: ['start_day', 'end_day', 'title', 'text'],
  institutions: ['kind', 'name', 'description', 'founding_scene_id', 'member_ids'],
  heat_scores: ['scene_id', 'total'],
}

export type ChapterRow = { day: number; title: string; text: string }
export type MilestoneRow = { kind: string; label: string; day: number; tick: number }
export type SceneRow = {
  day: number
  start_tick: number
  end_tick: number
  cast: string
  location: string | null
}

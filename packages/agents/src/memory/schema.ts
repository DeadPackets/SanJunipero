import type Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import { openDb } from '@sj/engine/store'
import { EMBEDDING_DIM } from '@sj/shared'

export function openAgentDb(path: string): Database.Database {
  const db = openDb(path)
  sqliteVec.load(db)
  migrateAgentTables(db)
  return db
}

export function migrateAgentTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      tick INTEGER NOT NULL,
      day INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN
        ('perception','thought','action','speech_heard','journal','dream','reflection')),
      text TEXT NOT NULL,
      importance INTEGER NOT NULL CHECK (importance BETWEEN 1 AND 10),
      tags TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memories_agent_day ON memories(agent_id, day);
    CREATE TRIGGER IF NOT EXISTS memories_no_update BEFORE UPDATE ON memories
      BEGIN SELECT RAISE(ABORT,'memories are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS memories_no_delete BEFORE DELETE ON memories
      BEGIN SELECT RAISE(ABORT,'memories are immutable'); END;

    CREATE TABLE IF NOT EXISTS memory_tags (
      memory_id INTEGER NOT NULL REFERENCES memories(id),
      kind TEXT NOT NULL,
      tag TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memory_tags_tag_kind ON memory_tags(tag, kind);

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      text, content='memories', content_rowid='id'
    );
    CREATE TRIGGER IF NOT EXISTS memories_fts_after_insert AFTER INSERT ON memories
      BEGIN INSERT INTO memories_fts(rowid, text) VALUES (new.id, new.text); END;

    CREATE VIRTUAL TABLE IF NOT EXISTS memory_vec USING vec0(embedding float[${EMBEDDING_DIM}]);

    CREATE TABLE IF NOT EXISTS facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      day INTEGER NOT NULL,
      subject TEXT NOT NULL,
      predicate TEXT NOT NULL,
      object TEXT NOT NULL,
      src_memory_id INTEGER NOT NULL REFERENCES memories(id)
    );
    CREATE INDEX IF NOT EXISTS idx_facts_agent_subject ON facts(agent_id, subject);

    CREATE TABLE IF NOT EXISTS ledgers (
      agent_id TEXT NOT NULL,
      person_id TEXT NOT NULL,
      doc TEXT NOT NULL,
      updated_day INTEGER NOT NULL,
      PRIMARY KEY (agent_id, person_id)
    );

    CREATE TABLE IF NOT EXISTS summary_nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      level TEXT NOT NULL CHECK (level IN ('scene','day','era')),
      day INTEGER NOT NULL,
      title TEXT NOT NULL,
      text TEXT NOT NULL,
      child_ids TEXT NOT NULL,
      memory_ids TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_summary_nodes_agent_level_day
      ON summary_nodes(agent_id, level, day);

    CREATE TABLE IF NOT EXISTS journal (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      tick INTEGER NOT NULL,
      day INTEGER NOT NULL,
      text TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS autobiography (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      day INTEGER NOT NULL,
      paragraph TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recall_misses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      tick INTEGER NOT NULL,
      query TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('ambient','recall')),
      top_score REAL,
      result_count INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS personality_versions (
      agent_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      day INTEGER NOT NULL,
      doc TEXT NOT NULL,
      edit TEXT,
      PRIMARY KEY (agent_id, version)
    );
    CREATE INDEX IF NOT EXISTS idx_personality_versions_agent_day
      ON personality_versions(agent_id, day);
  `)
}

import type Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import { openDb } from '@sj/engine'

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
      prerequisite_id TEXT REFERENCES codex(id)
    );
  `)
}

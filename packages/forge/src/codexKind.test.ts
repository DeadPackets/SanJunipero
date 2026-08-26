import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { openForgeDb } from './db.js'
import { AssetCodex } from './codex.js'

// the pre-T12 assets table, verbatim minus the kind column
const OLD_SCHEMA = `CREATE TABLE assets (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  class TEXT NOT NULL,
  desc TEXT NOT NULL,
  footprint_w INTEGER NOT NULL,
  footprint_h INTEGER NOT NULL,
  png BLOB NOT NULL,
  width_px INTEGER NOT NULL,
  height_px INTEGER NOT NULL,
  status TEXT NOT NULL,
  score REAL,
  attempts INTEGER NOT NULL,
  cost_usd REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`

const dirs: string[] = []
const tempDb = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-codex-kind-'))
  dirs.push(dir)
  return join(dir, 'forge.db')
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const png = Buffer.from([0x89, 0x50])
const insertOld = (db: Database.Database, id: string, desc: string): void => {
  db.prepare(`INSERT INTO assets (id, class, desc, footprint_w, footprint_h, png, width_px, height_px, status, score, attempts, cost_usd)
    VALUES (?, 'building', ?, 1, 1, ?, 8, 8, 'ready', 8, 1, 0)`).run(id, desc, png)
}

describe('codex kind column migration', () => {
  it('adds a nullable kind column to a pre-T12 db and backfills by the desc-prefix convention', () => {
    const path = tempDb()
    const raw = new Database(path)
    raw.exec(OLD_SCHEMA)
    insertOld(raw, 'a1', 'hut: timber dwelling')
    insertOld(raw, 'a2', 'plain barn desc without colon')
    raw.close()

    const db = openForgeDb(path)
    const rows = db.prepare('SELECT id, kind FROM assets ORDER BY seq').all() as Array<{
      id: string
      kind: string | null
    }>
    expect(rows).toEqual([
      { id: 'a1', kind: 'hut' },
      { id: 'a2', kind: null },
    ])
    db.close()
  })

  it('is idempotent: reopening neither errors nor rewrites kinds set after the migration', () => {
    const path = tempDb()
    const db1 = openForgeDb(path)
    const codex1 = new AssetCodex(db1)
    // a post-migration row with a colon in desc but NO kind must stay null — backfill is migration-only
    const rec = codex1.register({
      class: 'building',
      desc: 'barn: wide roof',
      footprint: { w: 1, h: 1 },
      png,
      widthPx: 8,
      heightPx: 8,
      status: 'ready',
      score: 8,
      attempts: 1,
      costUsd: 0,
    })
    expect(rec.kind).toBeNull()
    db1.close()

    const db2 = openForgeDb(path)
    const kind = (
      db2.prepare('SELECT kind FROM assets WHERE id = ?').get(rec.id) as { kind: string | null }
    ).kind
    expect(kind).toBeNull()
    db2.close()
  })

  it('register accepts an optional meta manifest and round-trips it; migration adds the column to old DBs', () => {
    const path = tempDb()
    const db0 = openForgeDb(path)
    db0.exec('ALTER TABLE assets DROP COLUMN meta') // simulate a pre-meta DB
    db0.close()
    const db = openForgeDb(path) // reopen migrates
    const codex = new AssetCodex(db)
    const meta = JSON.stringify({
      version: 'v4-hires-building',
      kind: 'shed',
      footprint: { w: 1, h: 1 },
      cell: { w: 10, h: 12, feetX: 5, feetY: 11 },
    })
    const rec = codex.register({
      class: 'building',
      desc: 'shed: tool shed',
      kind: 'shed',
      meta,
      footprint: { w: 1, h: 1 },
      png,
      widthPx: 8,
      heightPx: 8,
      status: 'ready',
      score: 8,
      attempts: 1,
      costUsd: 0,
    })
    expect(rec.meta).toBe(meta)
    expect(codex.get(rec.id)?.record.meta).toBe(meta)
    const plain = codex.register({
      class: 'building',
      desc: 'barn: plain',
      footprint: { w: 1, h: 1 },
      png,
      widthPx: 8,
      heightPx: 8,
      status: 'ready',
      score: 8,
      attempts: 1,
      costUsd: 0,
    })
    expect(plain.meta).toBeNull()
    db.close()
  })

  it('register accepts an optional kind and round-trips it through records', () => {
    const db = openForgeDb(tempDb())
    const codex = new AssetCodex(db)
    const rec = codex.register({
      class: 'building',
      desc: 'hut: timber dwelling',
      kind: 'hut',
      footprint: { w: 2, h: 2 },
      png,
      widthPx: 64,
      heightPx: 64,
      status: 'ready',
      score: 9,
      attempts: 1,
      costUsd: 0,
    })
    expect(rec.kind).toBe('hut')
    expect(codex.get(rec.id)?.record.kind).toBe('hut')
    expect(codex.listSince(0).at(-1)?.kind).toBe('hut')
    db.close()
  })
})

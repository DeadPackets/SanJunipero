import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openForgeDb } from '../db.js'
import { CRITERIA, deriveOverall, type VisionCriteria, type VisionVerdict } from './verdict.js'
import { recordVerdict, passRates } from './telemetry.js'

function verdictAt(assetId: string, score: number, attempt: number): VisionVerdict {
  const criteria = Object.fromEntries(
    CRITERIA.map((k) => [k, { pass: true, score, evidence: 'seen' }]),
  ) as VisionCriteria
  return {
    assetId,
    model: 'google/gemini-3.7-flash',
    rubricVersion: 'v1',
    criteria,
    feedback: '',
    overall: deriveOverall(criteria, { minScore: 7, attempt, maxRetries: 3 }),
  }
}

let db: Database.Database
beforeEach(() => {
  db = openForgeDb(':memory:')
})

describe('vision_qa migration', () => {
  it('adds the table to a pre-existing forge DB and preserves every assets row', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'sj-forge-')), 'forge.db')
    const old = new Database(file)
    old.exec(`CREATE TABLE assets (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, class TEXT NOT NULL,
      desc TEXT NOT NULL, footprint_w INTEGER NOT NULL, footprint_h INTEGER NOT NULL,
      png BLOB NOT NULL, width_px INTEGER NOT NULL, height_px INTEGER NOT NULL,
      status TEXT NOT NULL, score REAL, attempts INTEGER NOT NULL, cost_usd REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')));`)
    old
      .prepare(`INSERT INTO assets (id, class, desc, footprint_w, footprint_h, png, width_px,
      height_px, status, score, attempts, cost_usd) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        'asset_old',
        'building',
        'shed: a lean-to',
        1,
        1,
        Buffer.from('png'),
        64,
        64,
        'ready',
        8,
        1,
        0.09,
      )
    old.close()

    const migrated = openForgeDb(file)
    expect(migrated.prepare('SELECT count(*) c FROM assets').get()).toEqual({ c: 1 })
    expect((migrated.prepare('SELECT id, status FROM assets').get() as { id: string }).id).toBe(
      'asset_old',
    )
    expect(() => migrated.prepare('SELECT * FROM vision_qa').all()).not.toThrow()
    expect(passRates(migrated).n).toBe(0)
  })
})

describe('recordVerdict', () => {
  it('round-trips the per-criterion scores as JSON', () => {
    recordVerdict(db, verdictAt('a1', 9, 1), {
      assetClass: 'building',
      attempt: 1,
      costUsd: 0.0025,
    })
    const row = db.prepare('SELECT * FROM vision_qa').get() as Record<string, unknown>
    expect(row.asset_id).toBe('a1')
    expect(row.asset_class).toBe('building')
    expect(row.rubric_version).toBe('v1')
    expect(row.model).toBe('google/gemini-3.7-flash')
    expect(row.attempt).toBe(1)
    expect(row.overall).toBe('pass')
    expect(row.cost_usd).toBe(0.0025)
    expect(JSON.parse(row.scores as string)).toEqual(
      Object.fromEntries(CRITERIA.map((k) => [k, 9])),
    )
  })
})

describe('passRates', () => {
  beforeEach(() => {
    const rec = (id: string, klass: string, score: number, attempt: number) =>
      recordVerdict(db, verdictAt(id, score, attempt), {
        assetClass: klass,
        attempt,
        costUsd: 0.0025,
      })
    rec('a1', 'building', 9, 1) // first-pass
    rec('a2', 'building', 4, 1)
    rec('a2', 'building', 5, 2)
    rec('a2', 'building', 8, 3) // pass on 3
    for (const at of [1, 2, 3, 4]) rec('a3', 'building', 3, at) // blocked on 4
    rec('a4', 'item', 10, 1) // first-pass, other class
  })

  it('is exact over the four-asset fixture', () => {
    expect(passRates(db)).toEqual({ firstPass: 0.5, withinRetries: 0.75, blocked: 0.25, n: 4 })
  })

  it('filters to a class', () => {
    const r = passRates(db, 'building')
    expect(r.n).toBe(3)
    expect(r.firstPass).toBeCloseTo(1 / 3, 10)
    expect(r.withinRetries).toBeCloseTo(2 / 3, 10)
    expect(r.blocked).toBeCloseTo(1 / 3, 10)
    expect(passRates(db, 'item')).toEqual({ firstPass: 1, withinRetries: 1, blocked: 0, n: 1 })
  })

  it('returns zeros and never NaN on an empty scope', () => {
    const empty = openForgeDb(':memory:')
    expect(passRates(empty)).toEqual({ firstPass: 0, withinRetries: 0, blocked: 0, n: 0 })
    expect(passRates(db, 'terrain')).toEqual({ firstPass: 0, withinRetries: 0, blocked: 0, n: 0 })
    for (const v of Object.values(passRates(empty))) expect(Number.isNaN(v)).toBe(false)
  })
})

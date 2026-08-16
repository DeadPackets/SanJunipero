import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SpendLedger, SpendRowSchema, AnomalyStopError, ANOMALY_STOP_USD } from './spendLedger.js'

let dir: string, file: string
let t = 0
const now = () => `2026-08-16T00:00:${String(t++).padStart(2, '0')}.000Z`

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sj-ledger-'))
  file = join(dir, 'spend.json')
  t = 0
})

const row = (assetId: string, usd: number, kind: 'image_gen' | 'vision_qa' | 'style_judge' = 'image_gen') =>
  ({ assetId, kind, model: 'google/gemini-3.1-flash-image', usd })

describe('SpendRowSchema', () => {
  it('rejects a negative amount and an unknown kind', () => {
    expect(() => SpendRowSchema.parse({ ...row('a', -1), at: now() })).toThrow()
    expect(() => SpendRowSchema.parse({ assetId: 'a', kind: 'guessing', model: 'm', usd: 1, at: now() })).toThrow()
    expect(() => SpendRowSchema.parse({ ...row('a', 1), at: now(), extra: 1 })).toThrow()
    expect(SpendRowSchema.parse({ ...row('a', 0), at: '2026-01-01' }).usd).toBe(0)
  })
})

describe('SpendLedger accounting', () => {
  it('totals per asset and per kind', () => {
    const l = new SpendLedger(null, now)
    l.append(row('a', 0.045))
    l.append(row('a', 0.0025, 'vision_qa'))
    l.append(row('b', 0.09))
    l.append(row('b', 0.0004, 'style_judge'))
    expect(l.totalFor('a')).toBeCloseTo(0.0475, 10)
    expect(l.totalFor('b')).toBeCloseTo(0.0904, 10)
    expect(l.totalFor('missing')).toBe(0)
    expect(l.byKind()).toEqual({ image_gen: 0.135, vision_qa: 0.0025, style_judge: 0.0004 })
    expect(l.total()).toBeCloseTo(0.1379, 10)
    expect(l.rows()).toHaveLength(4)
    expect(l.rows()[0]!.at).toBe('2026-08-16T00:00:00.000Z')
  })

  it('byKind reports every kind even when unused', () => {
    expect(new SpendLedger(null, now).byKind()).toEqual({ image_gen: 0, vision_qa: 0, style_judge: 0 })
  })

  it('never touches disk when the path is null', () => {
    const l = new SpendLedger(null, now)
    l.append(row('a', 1))
    l.flush()
    expect(existsSync(file)).toBe(false)
  })
})

describe('SpendLedger persistence', () => {
  // The spend.json clobber class: a second writer must ADD to the file, never replace it.
  it('REGRESSION (spend.json clobber): a second ledger sees the first rows and adds to them', () => {
    const a = new SpendLedger(file, now)
    a.append(row('a', 0.045))
    a.flush()

    const b = new SpendLedger(file, now)
    expect(b.rows()).toHaveLength(1)
    expect(b.totalFor('a')).toBe(0.045)
    b.append(row('b', 0.09))
    b.flush()

    const c = new SpendLedger(file, now)
    expect(c.rows()).toHaveLength(2)
    expect(c.total()).toBeCloseTo(0.135, 10)
  })

  it('keeps both writers rows when they interleave over one file', () => {
    const a = new SpendLedger(file, now)
    const b = new SpendLedger(file, now)
    a.append(row('a', 1)); b.append(row('b', 2))
    a.flush(); b.flush()
    const merged = new SpendLedger(file, now)
    expect(merged.rows().map(r => r.assetId).sort()).toEqual(['a', 'b'])
  })

  it('flushing twice does not duplicate rows', () => {
    const l = new SpendLedger(file, now)
    l.append(row('a', 0.045))
    l.flush(); l.flush(); l.flush()
    expect(JSON.parse(readFileSync(file, 'utf8'))).toHaveLength(1)
    l.append(row('a', 0.01))
    l.flush()
    expect(JSON.parse(readFileSync(file, 'utf8'))).toHaveLength(2)
  })

  it('treats an absent or corrupt file as empty without throwing', () => {
    expect(new SpendLedger(file, now).rows()).toHaveLength(0)
    writeFileSync(file, 'not json at all')
    const l = new SpendLedger(file, now)
    expect(l.rows()).toHaveLength(0)
    l.append(row('a', 1))
    expect(() => l.flush()).not.toThrow()
    expect(JSON.parse(readFileSync(file, 'utf8'))).toHaveLength(1)
  })
})

describe('anomaly stop', () => {
  it('throws on the crossing row, does not record it, and leaves other assets alone', () => {
    const l = new SpendLedger(null, now)
    l.append(row('a', 4.5))
    l.append(row('b', 4.9))
    expect(() => l.append(row('a', 0.6))).toThrow(AnomalyStopError)
    expect(l.totalFor('a')).toBe(4.5)
    expect(l.rows()).toHaveLength(2)
    l.append(row('b', 0.05))
    expect(l.totalFor('b')).toBeCloseTo(4.95, 10)
  })

  it('allows a total that lands exactly on the stop and refuses the next cent', () => {
    const l = new SpendLedger(null, now)
    l.append(row('a', ANOMALY_STOP_USD))
    expect(l.totalFor('a')).toBe(5)
    expect(() => l.append(row('a', 0.01))).toThrow(/anomaly stop/)
  })

  it('carries the asset id and the attempted total', () => {
    const l = new SpendLedger(null, now)
    l.append(row('a', 4.99))
    try { l.append(row('a', 1)); expect.unreachable() }
    catch (e) {
      expect(e).toBeInstanceOf(AnomalyStopError)
      expect((e as AnomalyStopError).assetId).toBe('a')
      expect((e as AnomalyStopError).totalUsd).toBeCloseTo(5.99, 10)
    }
  })
})

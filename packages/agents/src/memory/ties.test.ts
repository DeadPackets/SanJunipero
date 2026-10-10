import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MINUTES_PER_DAY } from '@sj/shared'
import type { TieDelta } from '../scene/scene.js'
import { migrateAgentTables, openAgentDb } from './schema.js'
import { TIE_LET_GO_TICKS, TieStore } from './ties.js'

const AMARA = 'amara'
const YUSUF = 'yusuf'
const OPENED = 4 * MINUTES_PER_DAY

const store = (): TieStore => new TieStore(openAgentDb(':memory:'), AMARA)

const grudge: TieDelta = {
  agentId: AMARA,
  personId: YUSUF,
  kind: 'grudge',
  text: 'He said two planks and brought one.',
}

describe('a tie nobody touches is let go', () => {
  it('closes at seven sim-days and hands the tie back', () => {
    const ties = store()
    ties.apply([grudge], OPENED)
    const gone = ties.letGo(OPENED + TIE_LET_GO_TICKS)
    expect(gone.map((t) => t.text)).toEqual([grudge.text])
    expect(ties.open()).toEqual([])
    expect(ties.all()[0]!.settledTick).toBe(OPENED + TIE_LET_GO_TICKS)
  })

  it('still stands on the sixth day, and lets go of nothing twice', () => {
    const ties = store()
    ties.apply([grudge], OPENED)
    expect(ties.letGo(OPENED + 6 * MINUTES_PER_DAY)).toEqual([])
    expect(ties.open()).toHaveLength(1)
    expect(ties.letGo(OPENED + TIE_LET_GO_TICKS)).toHaveLength(1)
    expect(ties.letGo(OPENED + 2 * TIE_LET_GO_TICKS)).toEqual([])
  })

  it('has no clock for kin, however long nobody speaks', () => {
    const ties = store()
    ties.seedKin([{ id: YUSUF, relation: 'child' }], 0)
    expect(ties.letGo(10 * TIE_LET_GO_TICKS)).toEqual([])
    expect(ties.open().map((t) => t.kind)).toEqual(['kin'])
  })

  it('lets go of one stale tie and leaves the fresh one standing', () => {
    const ties = store()
    ties.apply([grudge], OPENED)
    ties.apply([{ ...grudge, kind: 'promise', text: 'Water from the far well.' }], OPENED + 2000)
    const gone = ties.letGo(OPENED + TIE_LET_GO_TICKS)
    expect(gone.map((t) => t.kind)).toEqual(['grudge'])
    expect(ties.open().map((t) => t.kind)).toEqual(['promise'])
  })
})

describe('kin are ties from the first tick', () => {
  it('writes one per kin in the persona, in the mind’s own words', () => {
    const ties = store()
    ties.seedKin(
      [
        { id: 'leyla', relation: 'partner' },
        { id: 'tariq', relation: 'child' },
      ],
      0,
    )
    expect(ties.open().map((t) => [t.personId, t.kind, t.text, t.source])).toEqual([
      ['leyla', 'kin', 'your partner', 'kin'],
      ['tariq', 'kin', 'your child', 'kin'],
    ])
  })

  it('writes nothing on a second boot, and never claims itself', () => {
    const ties = store()
    const kin = [{ id: 'leyla', relation: 'partner' }]
    ties.seedKin(kin, 0)
    ties.seedKin([...kin, { id: AMARA, relation: 'partner' }], 900)
    expect(ties.all()).toHaveLength(1)
  })
})

describe('independent commitments', () => {
  it('resolves one promise by identity and keeps a future promise beyond seven days', () => {
    const ties = store()
    ties.apply(
      [
        { ...grudge, kind: 'promise', text: 'Bring a chair tomorrow.' },
        {
          ...grudge,
          kind: 'promise',
          text: 'Help with harvest next month.',
          remindAtTick: 30 * MINUTES_PER_DAY,
        },
      ],
      0,
    )
    const chair = ties.open()[0]!
    ties.apply(
      [
        {
          ...grudge,
          kind: 'promise',
          text: chair.text,
          tieId: chair.id,
          resolution: 'fulfilled',
          evidenceSeqs: [12],
        },
      ],
      1,
    )
    expect(ties.open().map((t) => t.text)).toEqual(['Help with harvest next month.'])
    expect(ties.letGo(7 * MINUTES_PER_DAY)).toEqual([])
    expect(ties.all()[0]).toMatchObject({
      resolution: 'fulfilled',
      evidenceSeqs: [12],
      settledTick: 1,
    })
  })

  it('rejects missing and foreign resolution targets without changing either book', () => {
    const ties = store()
    const other = new TieStore(ties.db, 'omar')
    ties.apply([{ ...grudge, kind: 'promise' }], 0)
    other.apply([{ ...grudge, agentId: 'omar', kind: 'promise' }], 0)
    for (const tieId of [undefined, other.open()[0]!.id, 999]) {
      expect(() =>
        ties.apply([{ ...grudge, kind: 'promise', tieId, resolution: 'released' }], 1),
      ).toThrow()
    }
    expect(ties.open()).toHaveLength(1)
    expect(other.open()).toHaveLength(1)
  })

  it('does not duplicate an exact restatement or expire durable ties', () => {
    const ties = store()
    const rows = (['promise', 'debt', 'alliance', 'secret'] as const).map((kind) => ({
      ...grudge,
      kind,
    }))
    ties.apply(rows, 0)
    ties.apply(rows, 1)
    expect(ties.open()).toHaveLength(4)
    expect(ties.letGo(100 * MINUTES_PER_DAY)).toEqual([])
  })
})

describe('tie storage boundaries', () => {
  it('migrates twice and reopens without losing individual provenance', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sj-ties-'))
    const path = join(dir, 'agent.db')
    const db = openAgentDb(path)
    const ties = new TieStore(db, AMARA)
    ties.apply([{ ...grudge, kind: 'debt', remindAtTick: 900, evidenceSeqs: [14, 15] }], 2)
    migrateAgentTables(db)
    migrateAgentTables(db)
    db.close()
    const reopened = openAgentDb(path)
    try {
      expect(new TieStore(reopened, AMARA).open()[0]).toMatchObject({
        remindAtTick: 900,
        evidenceSeqs: [14, 15],
        resolution: null,
      })
    } finally {
      reopened.close()
      rmSync(dir, { recursive: true })
    }
  })

  it('rejects obsolete bulk-settlement input instead of creating or resolving a tie', () => {
    const ties = store()
    ties.apply([{ ...grudge, kind: 'debt' }], 0)
    expect(() =>
      ties.apply([{ ...grudge, kind: 'debt', settled: true } as unknown as TieDelta], 1),
    ).toThrow()
    expect(ties.open()).toHaveLength(1)
  })
})

it('adds columns without inventing an outcome for historical settled rows', () => {
  const db = openAgentDb(':memory:')
  db.exec(
    'ALTER TABLE ties DROP COLUMN resolution; ALTER TABLE ties DROP COLUMN evidence_seqs; ALTER TABLE ties DROP COLUMN remind_at_tick',
  )
  db.prepare(
    'INSERT INTO ties (agent_id,person_id,kind,text,tick,settled_tick,source) VALUES (?,?,?,?,?,?,?)',
  ).run(AMARA, YUSUF, 'promise', 'An old promise', 0, 100, 'scene')
  migrateAgentTables(db)
  migrateAgentTables(db)
  expect(new TieStore(db, AMARA).all()[0]).toMatchObject({
    settledTick: 100,
    resolution: null,
    evidenceSeqs: [],
    source: 'scene',
  })
  db.close()
})

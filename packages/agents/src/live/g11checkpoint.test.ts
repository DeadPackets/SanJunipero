import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RuntimeSnapshot } from '../runtime/agentRuntime.js'
import {
  G11_CHECKPOINT_VERSION,
  G11CheckpointSchema,
  checkpointRefusal,
  fingerprintMismatch,
  migrateCheckpointTable,
  readCheckpoint,
  restoreSnapshot,
  writeCheckpoint,
  type G11Checkpoint,
  type G11Fingerprint,
} from './g11checkpoint.js'

const FINGERPRINT: G11Fingerprint = {
  gitSha: '6d5c9376c9c0342300ccabc46459e70026347db6',
  configHash: 'config-hash-of-the-run-that-wrote-this',
  totalTicks: 5760,
  startTick: 420,
  wearThreshold: 1,
  model: 'deepseek/deepseek-v4-flash-0731',
  providerOrder: ['Baidu'],
  hardProviderAllowList: false,
  mindIds: ['amara', 'yusuf', 'nadia', 'omar', 'salma'],
  dryRun: false,
}

const checkpointAt = (tick: number): G11Checkpoint => ({
  version: G11_CHECKPOINT_VERSION,
  writtenAt: '2026-08-18T01:00:00.000Z',
  fingerprint: FINGERPRINT,
  sidecar: {
    tick,
    lastDayClosed: Math.floor(tick / 1440),
    stateHash: `hash-at-${tick}`,
    thoughts: [{ tick: tick - 1, agentId: 'omar', text: 'Salma looks ill.' }],
    adjudications: [
      {
        tick: tick - 2,
        agentId: 'salma',
        intent: 'hum a little',
        kind: 'map',
        verb: 'express:hum',
      },
    ],
    rejections: [
      { tick: tick - 3, agentId: 'yusuf', verb: 'tend', reason: 'tend needs a {targetId}' },
    ],
    accepted: [{ tick: tick - 4, agentId: 'amara', verb: 'drink' }],
    tickMs: [0.4, 0.5, 0.41],
    spendProjections: [{ tick: tick - 60, usdPerSimDay: 0.17 }],
    fullNeed: [
      ['omar:0', 12],
      ['salma:1', 3],
    ],
    nightsRun: [0],
    semanticRan: true,
    semanticErrors: 1,
    semanticSkippedNights: 1,
    narrateErrors: 0,
    constructErrors: 0,
    semanticHits: ['first_song'],
    minds: [
      {
        agentId: 'omar',
        snapshot: {
          clock: {
            lastTurnTick: tick - 6,
            reconsiderAtTick: tick + 40,
            conversationUntilTick: 0,
            dozeUntilTick: 0,
            alarmArmed: { hunger: true },
            morningWokeDay: 1,
            wakeRetryAtTick: 0,
            prevVisibleIds: ['salma'],
          },
          plan: { queue: [{ verb: 'walk', params: { x: 62, y: 70 } }], lastResult: 'running' },
          stats: { turns: 27, dozes: 3, reflections: 2 },
          dayLog: ['The morning is bright.'],
          reflectedNight: 0,
          wasNight: false,
          pendingDreamMood: null,
        },
      },
    ],
    dryTurn: 41,
    resumes: [],
  },
})

let dir: string
let dbPath: string
let snapPath: string
let db: Database.Database

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sj-g11ckpt-'))
  dbPath = join(dir, 'g11.db')
  snapPath = join(dir, 'g11-checkpoint.db')
  db = new Database(dbPath)
  db.exec('CREATE TABLE events (seq INTEGER PRIMARY KEY, tick INTEGER, type TEXT)')
  migrateCheckpointTable(db)
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe("the checkpoint carries the run's memory, not only its world", () => {
  it('round-trips every accumulator no criterion could be computed without', () => {
    const cp = checkpointAt(2880)
    writeCheckpoint(db, snapPath, cp)
    expect(readCheckpoint(db)).toEqual(cp)
  })

  it('is one file: the snapshot carries the accumulators inside it', () => {
    const cp = checkpointAt(2880)
    db.prepare('INSERT INTO events (seq, tick, type) VALUES (1, 2879, ?)').run('agent_drank')
    writeCheckpoint(db, snapPath, cp)

    // The live database moves on, and then dies.
    db.prepare('INSERT INTO events (seq, tick, type) VALUES (2, 3000, ?)').run('agent_died')
    db.close()

    restoreSnapshot(snapPath, dbPath)
    const revived = new Database(dbPath)
    // The tail after the checkpoint is gone, and the accumulators came back with the events.
    expect(revived.prepare('SELECT COUNT(*) c FROM events').pluck().get()).toBe(1)
    expect(readCheckpoint(revived)!.sidecar.tick).toBe(2880)
    revived.close()
    db = new Database(dbPath)
  })

  it('refuses a snapshot that is not there rather than starting an empty world', () => {
    expect(() => restoreSnapshot(join(dir, 'nothing.db'), dbPath)).toThrow(/no checkpoint snapshot/)
  })

  it('a torn write leaves the previous checkpoint standing, because the copy is renamed', () => {
    writeCheckpoint(db, snapPath, checkpointAt(1440))
    expect(() =>
      writeCheckpoint(db, join(dir, 'no-such-dir', 'x.db'), checkpointAt(2880)),
    ).toThrow()
    restoreSnapshot(snapPath, join(dir, 'copy.db'))
    const old = new Database(join(dir, 'copy.db'))
    expect(readCheckpoint(old)!.sidecar.tick).toBe(1440)
    old.close()
  })
})

describe('a checkpoint cannot launder a failure into a pass', () => {
  it('only ever moves forward: an earlier tick may not overwrite a later one', () => {
    writeCheckpoint(db, snapPath, checkpointAt(4320))
    expect(() => writeCheckpoint(db, snapPath, checkpointAt(2880))).toThrow(/may only move forward/)
    expect(readCheckpoint(db)!.sidecar.tick).toBe(4320)
  })

  it('allows a checkpoint at the same tick, which is a rewrite and not a rewind', () => {
    writeCheckpoint(db, snapPath, checkpointAt(4320))
    expect(() => writeCheckpoint(db, snapPath, checkpointAt(4320))).not.toThrow()
  })

  it('refuses to continue a run taken on a different commit', () => {
    const reasons = fingerprintMismatch(FINGERPRINT, { ...FINGERPRINT, gitSha: 'deadbeef' })
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toContain('gitSha')
    expect(checkpointRefusal(reasons)).toContain('GATE REFUSED TO RESUME')
  })

  it('refuses every difference that makes it a different gate', () => {
    const differences: Array<Partial<G11Fingerprint>> = [
      { configHash: 'other' },
      { totalTicks: 2880 },
      { startTick: 0 },
      { wearThreshold: 3 },
      { model: 'some/other-model' },
      { providerOrder: ['DeepInfra'] },
      { hardProviderAllowList: true },
      { mindIds: ['amara'] },
      { dryRun: true },
    ]
    for (const d of differences) {
      const reasons = fingerprintMismatch(FINGERPRINT, { ...FINGERPRINT, ...d })
      expect(reasons, JSON.stringify(d)).toHaveLength(1)
      expect(reasons[0]).toContain(Object.keys(d)[0]!)
    }
  })

  it('allows the run that wrote it to continue, and says so with an empty list', () => {
    expect(fingerprintMismatch(FINGERPRINT, { ...FINGERPRINT })).toEqual([])
  })

  it('records every resume in the checkpoint, so a resumed run can never look continuous', () => {
    const cp = checkpointAt(4320)
    cp.sidecar.resumes = [
      { atTick: 2880, at: '2026-08-18T01:10:00.000Z' },
      { atTick: 4320, at: '2026-08-18T01:40:00.000Z' },
    ]
    writeCheckpoint(db, snapPath, cp)
    expect(readCheckpoint(db)!.sidecar.resumes).toHaveLength(2)
  })

  it('refuses a checkpoint from an older format rather than guessing at its shape', () => {
    db.prepare('INSERT OR REPLACE INTO g11_checkpoint (id, payload) VALUES (1, ?)').run(
      JSON.stringify({ ...checkpointAt(1440), version: 0 }),
    )
    expect(() => readCheckpoint(db)).toThrow()
  })

  it('refuses a checkpoint missing an accumulator instead of resuming with a zeroed counter', () => {
    const cp = checkpointAt(1440) as unknown as Record<string, unknown>
    delete (cp.sidecar as Record<string, unknown>).adjudications
    expect(() => G11CheckpointSchema.parse(cp)).toThrow()
  })
})

describe('a mind comes back with its clock, not with a fresh one', () => {
  // The type below is the runtime's own, so a field added to a mind's clock fails this file
  // rather than being silently dropped by every resume.
  it("the checkpoint's mind shape is exactly the runtime's snapshot shape", () => {
    const fromCheckpoint = checkpointAt(2880).sidecar.minds[0]!.snapshot
    const asRuntime: RuntimeSnapshot = fromCheckpoint
    const backAgain: typeof fromCheckpoint = asRuntime
    expect(backAgain).toEqual(fromCheckpoint)
  })

  it('round-trips a half-run plan and a pending appointment through the snapshot', () => {
    writeCheckpoint(db, snapPath, checkpointAt(2880))
    const back = readCheckpoint(db)!.sidecar.minds[0]!.snapshot
    expect(back.plan.queue).toEqual([{ verb: 'walk', params: { x: 62, y: 70 } }])
    expect(back.plan.lastResult).toBe('running')
    expect(back.clock.reconsiderAtTick).toBe(2920)
    expect(back.clock.prevVisibleIds).toEqual(['salma'])
    expect(back.stats).toEqual({ turns: 27, dozes: 3, reflections: 2 })
  })
})

describe('an absent checkpoint', () => {
  it('reads as null, so a first run starts from genesis without special-casing', () => {
    expect(readCheckpoint(db)).toBeNull()
  })
})

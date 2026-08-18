import { copyFileSync, existsSync, renameSync, rmSync } from 'node:fs'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import { IntentSchema } from '../turn.js'

// A resumable gate.
//
// A 4-sim-day G11b is ~60 minutes of wall clock, ~35 of it inside four day-closes, and
// `g11-deepworld.ts` builds the world from genesis every time. C11 batch 13's run reached tick
// 5520 of 6180 — 93% — was reaped inside the last day-close before the report writer ran, and
// could not be continued: the score and the $0.68 went with the process. That will recur on
// every 4-day gate until an interrupted run can pick itself up.
//
// The checkpoint is a ROLLBACK POINT, not a bookmark. Everything the run holds lives in one of
// two places — the SQLite database, or a handful of in-memory accumulators — so a checkpoint
// is an atomic snapshot of the database with those accumulators written INSIDE it. Resuming
// copies that snapshot back over the live database and picks the accumulators out of it, which
// discards the un-checkpointed tail rather than trying to reconcile it. That is the whole
// reason for the design: a half-recorded day, an orphan thought or an adjudication whose event
// is gone would each be a criterion computed on data a continuous run never had.
//
// TWO PROPERTIES IT HAS TO HOLD, and how each is held:
//
// 1. A RESUMED RUN SCORES WHAT A CONTINUOUS RUN WOULD. Every input to `checkG11Report` is
//    either read out of the database — restored whole, to one consistent moment — or restored
//    from the sidecar below and appended to. No counter is reset by a resume, no window is
//    counted twice (the tail is discarded), and none is skipped (the loop restarts at exactly
//    the checkpoint's tick, and `lastDayClosed` comes back with it, so the days that follow are
//    closed and the ones before are not re-closed). What is NOT restored is each mind's turn
//    clock and plan queue, which are rebuilt fresh: that changes when a mind next thinks, which
//    is a trajectory difference an LLM run has anyway, and it changes no criterion's arithmetic.
//
// 2. A CHECKPOINT CANNOT LAUNDER A FAILURE INTO A PASS. Four rules, all enforced here:
//    - `fingerprintMismatch` refuses a resume across a different commit, a different config
//      hash, a different tick budget, a different model or provider routing, a different set
//      of minds, or a dry run resumed as a live one. You cannot fix what failed and then score
//      the whole run as though it had always worked.
//    - `writeCheckpoint` refuses to move the checkpoint BACKWARDS. There is exactly one
//      checkpoint and it only ever advances, so no earlier point can be picked to re-roll a
//      day that went badly.
//    - the replayed world state must hash to the value the checkpoint recorded, or the resume
//      is refused outright.
//    - every resume appends to `resumes`, which rides in the report. A run that was resumed
//      says so, with the tick it was resumed from, every time.

// 2: the sidecar gained `semanticSkippedNights`. A version-1 checkpoint carries no count of
// the nights it lost, so it cannot be resumed into a run that reports one.
export const G11_CHECKPOINT_VERSION = 2

const Thought = z.object({ tick: z.number().int(), agentId: z.string(), text: z.string() }).strict()
const Adjudication = z.object({
  tick: z.number().int(), agentId: z.string(), intent: z.string(), kind: z.string(),
  verb: z.string().nullable(),
}).strict()
const Rejection = z.object({
  tick: z.number().int(), agentId: z.string(), verb: z.string(), reason: z.string(),
}).strict()
const Accepted = z.object({ tick: z.number().int(), agentId: z.string(), verb: z.string() }).strict()
const SpendProjection = z.object({ tick: z.number().int(), usdPerSimDay: z.number() }).strict()
// The shape of `RuntimeSnapshot`, written out. The test holds the two to each other so a field
// added to a mind's clock cannot be silently dropped by a resume.
const MindClockZ = z.object({
  lastTurnTick: z.number(),
  reconsiderAtTick: z.number().nullable(),
  conversationUntilTick: z.number(),
  dozeUntilTick: z.number(),
  // Not a wire schema — nothing sends this to a provider — so `z.record` is safe here.
  // Optional values, because an unspent rung is absent rather than false.
  alarmArmed: z.record(z.string(), z.boolean().optional()),
  morningWokeDay: z.number().nullable(),
  wakeRetryAtTick: z.number(),
  prevVisibleIds: z.array(z.string()),
}).strict()
const MindSnapshot = z.object({
  agentId: z.string(),
  snapshot: z.object({
    clock: MindClockZ,
    plan: z.object({
      queue: z.array(IntentSchema),
      lastResult: z.enum(['idle', 'running', 'done', 'blocked']),
    }).strict(),
    stats: z.object({
      turns: z.number().int(), dozes: z.number().int(), reflections: z.number().int(),
    }).strict(),
    dayLog: z.array(z.string()),
    reflectedNight: z.number().int().nullable(),
    wasNight: z.boolean(),
    pendingDreamMood: z.string().nullable(),
  }).strict(),
}).strict()

// Everything that decides whether two runs are the same run. A resume across ANY difference
// here is a different gate wearing the first one's evidence.
export const G11FingerprintSchema = z.object({
  gitSha: z.string(),
  configHash: z.string(),
  totalTicks: z.number().int(),
  startTick: z.number().int(),
  wearThreshold: z.number(),
  model: z.string(),
  providerOrder: z.array(z.string()),
  hardProviderAllowList: z.boolean(),
  mindIds: z.array(z.string()),
  dryRun: z.boolean(),
}).strict()
export type G11Fingerprint = z.infer<typeof G11FingerprintSchema>

// The run's memory. Nothing here is in the event log, and every one of these feeds a criterion
// or the transcript: adjudications carry criterion 9, tickMs carries criterion 1's tick budget,
// the full-need tally carries the discretionary table's last column.
export const G11SidecarSchema = z.object({
  tick: z.number().int(),
  lastDayClosed: z.number().int(),
  stateHash: z.string(),
  thoughts: z.array(Thought),
  adjudications: z.array(Adjudication),
  rejections: z.array(Rejection),
  accepted: z.array(Accepted),
  tickMs: z.array(z.number()),
  spendProjections: z.array(SpendProjection),
  fullNeed: z.array(z.tuple([z.string(), z.number().int()])),
  nightsRun: z.array(z.number().int()),
  semanticRan: z.boolean(),
  semanticErrors: z.number().int(),
  // Restored like the rest: a resume that zeroed it would turn a lost night into one that
  // never happened (C11 batch 16 fix 3).
  semanticSkippedNights: z.number().int(),
  narrateErrors: z.number().int(),
  constructErrors: z.number().int(),
  semanticHits: z.array(z.string()),
  minds: z.array(MindSnapshot),
  dryTurn: z.number().int(),
  resumes: z.array(z.object({ atTick: z.number().int(), at: z.string() }).strict()),
}).strict()
export type G11Sidecar = z.infer<typeof G11SidecarSchema>

export const G11CheckpointSchema = z.object({
  version: z.literal(G11_CHECKPOINT_VERSION),
  writtenAt: z.string(),
  fingerprint: G11FingerprintSchema,
  sidecar: G11SidecarSchema,
}).strict()
export type G11Checkpoint = z.infer<typeof G11CheckpointSchema>

export function migrateCheckpointTable(db: Database.Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS g11_checkpoint ('
    + ' id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL)')
}

// Which fields of the saved run differ from the one asking to continue it. Empty means the two
// are the same run and the resume is allowed.
export function fingerprintMismatch(saved: G11Fingerprint, now: G11Fingerprint): string[] {
  const out: string[] = []
  const say = (field: string, a: unknown, b: unknown): void => {
    out.push(`${field}: checkpoint has ${JSON.stringify(a)}, this run has ${JSON.stringify(b)}`)
  }
  for (const key of Object.keys(G11FingerprintSchema.shape) as Array<keyof G11Fingerprint>) {
    const a = saved[key]
    const b = now[key]
    if (JSON.stringify(a) !== JSON.stringify(b)) say(key, a, b)
  }
  return out
}

export function checkpointRefusal(reasons: readonly string[]): string {
  return [
    'GATE REFUSED TO RESUME: this checkpoint does not belong to this run.',
    ...reasons.map((r) => `  ${r}`),
    '  A checkpoint may only continue the run that wrote it. Resuming across a code, config or',
    '  routing change would score a repaired run on the broken one\'s evidence. Start a fresh run.',
  ].join('\n')
}

export function readCheckpoint(db: Database.Database): G11Checkpoint | null {
  migrateCheckpointTable(db)
  const row = db.prepare('SELECT payload FROM g11_checkpoint WHERE id = 1').get() as
    { payload: string } | undefined
  if (row === undefined) return null
  return G11CheckpointSchema.parse(JSON.parse(row.payload))
}

// The checkpoint goes into the live database first and the whole database is then copied out
// with `VACUUM INTO`, so the snapshot and the accumulators inside it are one consistent object
// in one file. The copy lands on a temporary name and is renamed over the previous snapshot,
// so a process killed mid-write leaves the previous checkpoint intact rather than a torn one.
export function writeCheckpoint(
  db: Database.Database, snapshotPath: string, checkpoint: G11Checkpoint,
): void {
  const previous = readCheckpoint(db)
  if (previous !== null && checkpoint.sidecar.tick < previous.sidecar.tick) {
    throw new Error('a checkpoint may only move forward: refusing to overwrite tick'
      + ` ${previous.sidecar.tick} with tick ${checkpoint.sidecar.tick}`)
  }
  G11CheckpointSchema.parse(checkpoint)
  db.prepare('INSERT OR REPLACE INTO g11_checkpoint (id, payload) VALUES (1, ?)')
    .run(JSON.stringify(checkpoint))
  const tmp = `${snapshotPath}.tmp`
  rmSync(tmp, { force: true })
  db.prepare(`VACUUM INTO ?`).run(tmp)
  renameSync(tmp, snapshotPath)
}

// Put the snapshot back where the live database lives, and clear the write-ahead files that
// belong to the database being replaced — leaving them would fold a dead tail back in.
export function restoreSnapshot(snapshotPath: string, dbPath: string): void {
  if (!existsSync(snapshotPath)) throw new Error(`no checkpoint snapshot at ${snapshotPath}`)
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true })
  copyFileSync(snapshotPath, dbPath)
}

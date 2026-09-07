import type Database from 'better-sqlite3'
import { EventEnvelope, type SimEvent } from '@sj/shared'
import type { RngState } from './rng.js'

const CHECKPOINT_EVERY_MS = 5_000

export class EventStore {
  private checkpointTimer: NodeJS.Timeout | null = null
  private insertEv
  private selFrom
  private selRange
  private selTypeFrom
  private selLast
  private selLastThroughTick
  private insertSnap
  private selSnap
  private upsertRng
  private selRng
  private delTypeBefore
  private delSnapsBefore
  constructor(private db: Database.Database) {
    this.insertEv = db.prepare('INSERT INTO events (tick, type, payload) VALUES (?, ?, ?)')
    this.selFrom = db.prepare(
      'SELECT seq, tick, type, payload FROM events WHERE seq > ? ORDER BY seq',
    )
    this.selRange = db.prepare(
      'SELECT seq, tick, type, payload FROM events WHERE seq >= ? AND seq <= ? ORDER BY seq',
    )
    this.selTypeFrom = db.prepare(
      'SELECT seq, tick, type, payload FROM events WHERE seq > ? AND type = ? ORDER BY seq',
    )
    this.selLast = db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM events')
    this.selLastThroughTick = db.prepare(
      'SELECT COALESCE(MAX(seq), 0) AS m FROM events WHERE tick <= ?',
    )
    this.insertSnap = db.prepare(
      'INSERT INTO snapshots (tick, seq, state, rng) VALUES (?, ?, ?, ?)',
    )
    this.selSnap = db.prepare(
      'SELECT tick, seq, state, rng FROM snapshots ORDER BY id DESC LIMIT 1',
    )
    this.upsertRng = db.prepare(
      'INSERT INTO rng_state (id, tick, rng) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET tick=excluded.tick, rng=excluded.rng',
    )
    this.selRng = db.prepare('SELECT tick, rng FROM rng_state WHERE id = 1')
    this.delTypeBefore = db.prepare(
      'DELETE FROM events WHERE seq IN (SELECT seq FROM events WHERE type = ? AND tick < ? ORDER BY seq LIMIT ?)',
    )
    this.delSnapsBefore = db.prepare('DELETE FROM snapshots WHERE tick < ? AND tick % ? != 0')
    // Left on, the autocheckpoint runs inside the COMMIT of whichever tick pushes the WAL past
    // 1,000 pages and puts a 20 ms tail on it (measured). PASSIVE off a timer never blocks a writer.
    if (db.pragma('journal_mode', { simple: true }) === 'wal') {
      db.pragma('wal_autocheckpoint = 0')
      this.checkpointTimer = setInterval(() => {
        if (db.open) db.pragma('wal_checkpoint(PASSIVE)')
      }, CHECKPOINT_EVERY_MS)
      this.checkpointTimer.unref()
    }
  }

  /** Stops the checkpointer. The db handle stays the caller's to close. */
  close(): void {
    if (this.checkpointTimer !== null) {
      clearInterval(this.checkpointTimer)
      this.checkpointTimer = null
    }
  }

  append(tick: number, type: string, payload: unknown): SimEvent {
    const json = JSON.stringify(payload ?? null)
    const info = this.insertEv.run(tick, type, json)
    return EventEnvelope.parse({
      seq: Number(info.lastInsertRowid),
      tick,
      type,
      payload: JSON.parse(json) as unknown,
    })
  }
  private parseRow = (r: { seq: number; tick: number; type: string; payload: string }): SimEvent =>
    EventEnvelope.parse({
      seq: r.seq,
      tick: r.tick,
      type: r.type,
      payload: JSON.parse(r.payload) as unknown,
    })

  readFrom(seqExclusive: number): SimEvent[] {
    return (this.selFrom.all(seqExclusive) as never[]).map(this.parseRow)
  }
  /** Only one kind of event. A tail that wants one rare type pays nothing to parse the rest. */
  readTypeFrom(seqExclusive: number, type: string): SimEvent[] {
    return (this.selTypeFrom.all(seqExclusive, type) as never[]).map(this.parseRow)
  }
  readRange(from: number, to: number): SimEvent[] {
    return (this.selRange.all(from, to) as never[]).map(this.parseRow)
  }
  lastSeq(): number {
    return (this.selLast.get() as { m: number }).m
  }
  /** Where a tick-window tail resumes: the last seq at or before `tick`, parsing nothing. */
  lastSeqThroughTick(tick: number): number {
    return (this.selLastThroughTick.get(tick) as { m: number }).m
  }

  saveSnapshot(tick: number, seq: number, state: unknown, rng: Record<string, RngState>): void {
    this.insertSnap.run(tick, seq, JSON.stringify(state), JSON.stringify(rng))
  }
  latestSnapshot() {
    const r = this.selSnap.get() as
      | { tick: number; seq: number; state: string; rng: string }
      | undefined
    return r
      ? {
          tick: r.tick,
          seq: r.seq,
          state: JSON.parse(r.state) as unknown,
          rng: JSON.parse(r.rng) as Record<string, RngState>,
        }
      : null
  }

  /** Drops at most `limit` rows of one bulk type older than `beforeTick`. The type index walks
   *  its rows in seq order, so the oldest go first and a drained backlog costs one short scan. */
  pruneType(type: string, beforeTick: number, limit = 5000): number {
    return this.delTypeBefore.run(type, beforeTick, limit).changes
  }
  /** Thins snapshots older than `beforeTick` to the ones on a `keepEveryTicks` boundary. */
  pruneSnapshots(beforeTick: number, keepEveryTicks: number): number {
    return this.delSnapsBefore.run(beforeTick, keepEveryTicks).changes
  }

  saveRngState(tick: number, rng: Record<string, RngState>): void {
    this.upsertRng.run(tick, JSON.stringify(rng))
  }
  latestRngState(): { tick: number; rng: Record<string, RngState> } | null {
    const r = this.selRng.get() as { tick: number; rng: string } | undefined
    return r ? { tick: r.tick, rng: JSON.parse(r.rng) as Record<string, RngState> } : null
  }
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)()
  }
}

import type Database from 'better-sqlite3'
import { EventEnvelope, type SimEvent } from '@sj/shared'
import type { RngState } from './rng.js'

export class EventStore {
  private insertEv; private selFrom; private selRange; private selLast; private insertSnap; private selSnap
  private upsertRng; private selRng
  constructor(private db: Database.Database) {
    this.insertEv = db.prepare('INSERT INTO events (tick, type, payload) VALUES (?, ?, ?)')
    this.selFrom = db.prepare('SELECT seq, tick, type, payload FROM events WHERE seq > ? ORDER BY seq')
    this.selRange = db.prepare('SELECT seq, tick, type, payload FROM events WHERE seq >= ? AND seq <= ? ORDER BY seq')
    this.selLast = db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM events')
    this.insertSnap = db.prepare('INSERT INTO snapshots (tick, seq, state, rng) VALUES (?, ?, ?, ?)')
    this.selSnap = db.prepare('SELECT tick, seq, state, rng FROM snapshots ORDER BY id DESC LIMIT 1')
    this.upsertRng = db.prepare('INSERT INTO rng_state (id, tick, rng) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET tick=excluded.tick, rng=excluded.rng')
    this.selRng = db.prepare('SELECT tick, rng FROM rng_state WHERE id = 1')
  }

  append(tick: number, type: string, payload: unknown): SimEvent {
    const info = this.insertEv.run(tick, type, JSON.stringify(payload ?? null))
    return EventEnvelope.parse({ seq: Number(info.lastInsertRowid), tick, type, payload: payload ?? null })
  }
  private parseRow = (r: { seq: number; tick: number; type: string; payload: string }): SimEvent =>
    EventEnvelope.parse({ seq: r.seq, tick: r.tick, type: r.type, payload: JSON.parse(r.payload) })

  readFrom(seqExclusive: number): SimEvent[] { return (this.selFrom.all(seqExclusive) as never[]).map(this.parseRow) }
  readRange(from: number, to: number): SimEvent[] { return (this.selRange.all(from, to) as never[]).map(this.parseRow) }
  lastSeq(): number { return (this.selLast.get() as { m: number }).m }

  saveSnapshot(tick: number, seq: number, state: unknown, rng: Record<string, RngState>): void {
    this.insertSnap.run(tick, seq, JSON.stringify(state), JSON.stringify(rng))
  }
  latestSnapshot() {
    const r = this.selSnap.get() as { tick: number; seq: number; state: string; rng: string } | undefined
    return r ? { tick: r.tick, seq: r.seq, state: JSON.parse(r.state), rng: JSON.parse(r.rng) as Record<string, RngState> } : null
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

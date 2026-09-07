import type Database from 'better-sqlite3'
import { EventEnvelope, type SimConfig, type SimEvent } from '@sj/shared'
import { fold, genesisState, type TileId, type WorldState } from '@sj/engine'
import { unpackState } from '@sj/engine/store'

type SnapRow = { tick: number; seq: number; state: string | Buffer }
type EvRow = { seq: number; tick: number; type: string; payload: string }

const parseEv = (r: EvRow): SimEvent =>
  EventEnvelope.parse({
    seq: r.seq,
    tick: r.tick,
    type: r.type,
    payload: JSON.parse(r.payload) as unknown,
  })

// Named so the plan test can EXPLAIN the query the mirror actually runs, not a copy of it.
// It needs idx_snapshots_tick, or it is a scan plus a temp b-tree over 30 KB rows.
export const SNAP_AT_OR_BEFORE_SQL =
  'SELECT tick, seq, state FROM snapshots WHERE tick <= ? ORDER BY tick DESC, id DESC LIMIT 1'

// Read-only by construction: the mirror only ever prepares SELECTs. Readonly
// enforcement lives where the DB is opened (createGateway passes { readonly: true }).
export class WorldMirror {
  #state: WorldState
  #seq: number
  #config: SimConfig
  #terrain: TileId[][] | undefined
  #selLatestSnap
  #selSnapAtOrBefore
  #selEventsFrom
  #selEventsRange
  #selEventsTicks

  constructor(opts: { db: Database.Database; config: SimConfig; terrain: TileId[][] }) {
    this.#config = opts.config
    this.#terrain = opts.terrain
    const db = opts.db
    this.#selLatestSnap = db.prepare(
      'SELECT tick, seq, state FROM snapshots ORDER BY id DESC LIMIT 1',
    )
    this.#selSnapAtOrBefore = db.prepare(SNAP_AT_OR_BEFORE_SQL)
    this.#selEventsFrom = db.prepare(
      'SELECT seq, tick, type, payload FROM events WHERE seq > ? ORDER BY seq',
    )
    this.#selEventsRange = db.prepare(
      'SELECT seq, tick, type, payload FROM events WHERE seq > ? AND tick <= ? ORDER BY seq',
    )
    // Bounded by TICK, not by seq: a replay reading a minute out of an old week would otherwise
    // scan every row that follows it. This one rides idx_events_tick.
    this.#selEventsTicks = db.prepare(
      'SELECT seq, tick, type, payload FROM events WHERE tick > ? AND tick <= ? ORDER BY seq',
    )

    const snap = this.#selLatestSnap.get() as SnapRow | undefined
    this.#state = snap
      ? (unpackState(snap.state) as WorldState)
      : genesisState(this.#config, this.#terrain)
    this.#seq = snap ? snap.seq : 0
    for (const row of this.#selEventsFrom.all(this.#seq) as EvRow[]) {
      const ev = parseEv(row)
      this.#state = fold(this.#state, ev, this.#config)
      this.#seq = ev.seq
    }
  }

  state(): WorldState {
    return this.#state
  }
  seq(): number {
    return this.#seq
  }

  poll(): { tick: number; events: SimEvent[] }[] {
    const groups: { tick: number; events: SimEvent[] }[] = []
    for (const row of this.#selEventsFrom.all(this.#seq) as EvRow[]) {
      const ev = parseEv(row)
      this.#state = fold(this.#state, ev, this.#config)
      this.#seq = ev.seq
      const last = groups[groups.length - 1]
      if (last?.tick === ev.tick) last.events.push(ev)
      else groups.push({ tick: ev.tick, events: [ev] })
    }
    return groups
  }

  stateAt(tick: number): WorldState {
    return this.snapshotAt(tick).state
  }

  /** The world at `tick` AND the log head that produced it — what a replay adopts so the deltas
   *  after it read as an ordinary rising stream. */
  snapshotAt(tick: number): { state: WorldState; seq: number } {
    if (tick > this.#state.tick)
      throw new RangeError(`stateAt(${tick}): beyond live tick ${this.#state.tick}`)
    const snap = this.#selSnapAtOrBefore.get(tick) as SnapRow | undefined
    let state = snap
      ? (unpackState(snap.state) as WorldState)
      : genesisState(this.#config, this.#terrain)
    let seq = snap ? snap.seq : 0
    for (const row of this.#selEventsRange.all(seq, tick) as EvRow[]) {
      const ev = parseEv(row)
      state = fold(state, ev, this.#config)
      seq = ev.seq
    }
    return { state, seq }
  }

  /** The recorded minutes in `(afterTick, throughTick]`, grouped the way `poll` groups a live
   *  one. Read, never folded: a replay hands the fold back to the viewer. */
  eventsBetween(afterTick: number, throughTick: number): { tick: number; events: SimEvent[] }[] {
    const groups: { tick: number; events: SimEvent[] }[] = []
    for (const row of this.#selEventsTicks.all(afterTick, throughTick) as EvRow[]) {
      const ev = parseEv(row)
      const last = groups[groups.length - 1]
      if (last?.tick === ev.tick) last.events.push(ev)
      else groups.push({ tick: ev.tick, events: [ev] })
    }
    return groups
  }
}

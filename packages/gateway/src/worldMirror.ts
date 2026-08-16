import type Database from 'better-sqlite3'
import { EventEnvelope, type SimConfig, type SimEvent } from '@sj/shared'
import { fold, genesisState, type TileId, type WorldState } from '@sj/engine'

type SnapRow = { tick: number; seq: number; state: string }
type EvRow = { seq: number; tick: number; type: string; payload: string }

const parseEv = (r: EvRow): SimEvent =>
  EventEnvelope.parse({ seq: r.seq, tick: r.tick, type: r.type, payload: JSON.parse(r.payload) })

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

  constructor(opts: { db: Database.Database; config: SimConfig; terrain: TileId[][] }) {
    this.#config = opts.config
    this.#terrain = opts.terrain
    const db = opts.db
    this.#selLatestSnap = db.prepare('SELECT tick, seq, state FROM snapshots ORDER BY id DESC LIMIT 1')
    this.#selSnapAtOrBefore = db.prepare('SELECT tick, seq, state FROM snapshots WHERE tick <= ? ORDER BY tick DESC, id DESC LIMIT 1')
    this.#selEventsFrom = db.prepare('SELECT seq, tick, type, payload FROM events WHERE seq > ? ORDER BY seq')
    this.#selEventsRange = db.prepare('SELECT seq, tick, type, payload FROM events WHERE seq > ? AND tick <= ? ORDER BY seq')

    const snap = this.#selLatestSnap.get() as SnapRow | undefined
    this.#state = snap ? (JSON.parse(snap.state) as WorldState) : genesisState(this.#config, this.#terrain)
    this.#seq = snap ? snap.seq : 0
    for (const row of this.#selEventsFrom.all(this.#seq) as EvRow[]) {
      const ev = parseEv(row)
      this.#state = fold(this.#state, ev, this.#config)
      this.#seq = ev.seq
    }
  }

  state(): WorldState { return this.#state }
  seq(): number { return this.#seq }

  poll(): Array<{ tick: number; events: SimEvent[] }> {
    const groups: Array<{ tick: number; events: SimEvent[] }> = []
    for (const row of this.#selEventsFrom.all(this.#seq) as EvRow[]) {
      const ev = parseEv(row)
      this.#state = fold(this.#state, ev, this.#config)
      this.#seq = ev.seq
      const last = groups[groups.length - 1]
      if (last && last.tick === ev.tick) last.events.push(ev)
      else groups.push({ tick: ev.tick, events: [ev] })
    }
    return groups
  }

  stateAt(tick: number): WorldState {
    if (tick > this.#state.tick) throw new RangeError(`stateAt(${tick}): beyond live tick ${this.#state.tick}`)
    const snap = this.#selSnapAtOrBefore.get(tick) as SnapRow | undefined
    let state = snap ? (JSON.parse(snap.state) as WorldState) : genesisState(this.#config, this.#terrain)
    const fromSeq = snap ? snap.seq : 0
    for (const row of this.#selEventsRange.all(fromSeq, tick) as EvRow[]) {
      state = fold(state, parseEv(row), this.#config)
    }
    return state
  }
}

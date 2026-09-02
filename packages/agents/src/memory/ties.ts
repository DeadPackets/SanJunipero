import type Database from 'better-sqlite3'
import type { TieDelta, TieKind } from '../scene/scene.js'

export type Tie = {
  id: number
  personId: string
  kind: TieKind
  text: string
  tick: number
  /** Null while the tie still stands. A settled tie is kept: what was owed is part of a life. */
  settledTick: number | null
  source: string
}

type RawTie = {
  id: number
  person_id: string
  kind: TieKind
  text: string
  tick: number
  settled_tick: number | null
  source: string
}

const toTie = (r: RawTie): Tie => ({
  id: r.id,
  personId: r.person_id,
  kind: r.kind,
  text: r.text,
  tick: r.tick,
  settledTick: r.settled_tick,
  source: r.source,
})

/** What one mind holds against, owes to, or feels for the people it knows. Written here by a
 *  scene's close and by reflection (Task 11); read by the quarrel upgrade and the scene ask. */
export class TieStore {
  constructor(
    readonly db: Database.Database,
    readonly agentId: string,
  ) {}

  all(): Tie[] {
    return (
      this.db
        .prepare('SELECT * FROM ties WHERE agent_id = ? ORDER BY id')
        .all(this.agentId) as RawTie[]
    ).map(toTie)
  }

  open(): Tie[] {
    return this.all().filter((t) => t.settledTick === null)
  }

  /** A delta either settles the open tie it matches or opens a new one. `agentId` on the delta
   *  is whose book it goes in, so a close writes to every participant from one list. */
  apply(deltas: readonly TieDelta[], tick: number, source = 'scene'): void {
    const settle = this.db.prepare(
      `UPDATE ties SET settled_tick = ?
       WHERE agent_id = ? AND person_id = ? AND kind = ? AND settled_tick IS NULL`,
    )
    const insert = this.db.prepare(
      `INSERT INTO ties (agent_id, person_id, kind, text, tick, settled_tick, source)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`,
    )
    const write = this.db.transaction((rows: readonly TieDelta[]): void => {
      for (const d of rows) {
        if (d.settled === true) settle.run(tick, this.agentId, d.personId, d.kind)
        else insert.run(this.agentId, d.personId, d.kind, d.text, tick, source)
      }
    })
    write(deltas.filter((d) => d.agentId === this.agentId))
  }
}

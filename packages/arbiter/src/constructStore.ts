import type Database from 'better-sqlite3'
import type { Construct, ConstructOpsEvent, ConstructOpsType } from './constructs.js'

// The registry lives in the arbiter's database and nowhere else. Nothing here is world state:
// no row reaches a snapshot, the hash, a perception packet or a prompt.

type RawConstruct = {
  id: string
  type: string
  name: string | null
  name_provenance: string | null
  anchor: string | null
  participants: string
  first_tick: number
  recurrences: string
}

function toConstruct(r: RawConstruct): Construct {
  return {
    id: r.id,
    type: r.type as Construct['type'],
    name: r.name,
    nameProvenance:
      r.name_provenance === null
        ? null
        : (JSON.parse(r.name_provenance) as Construct['nameProvenance']),
    anchor: r.anchor === null ? null : (JSON.parse(r.anchor) as Construct['anchor']),
    participants: JSON.parse(r.participants) as string[],
    firstTick: r.first_tick,
    recurrences: JSON.parse(r.recurrences) as Construct['recurrences'],
  }
}

export class ConstructStore {
  constructor(readonly db: Database.Database) {}

  byId(id: string): Construct | null {
    const row = this.db.prepare('SELECT * FROM constructs WHERE id = ?').get(id) as
      | RawConstruct
      | undefined
    return row === undefined ? null : toConstruct(row)
  }

  all(): Construct[] {
    return (this.db.prepare('SELECT * FROM constructs ORDER BY id').all() as RawConstruct[]).map(
      toConstruct,
    )
  }

  upsert(c: Construct): void {
    this.db
      .prepare(
        `INSERT INTO constructs (id, type, name, name_provenance, anchor, participants, first_tick, recurrences)
       VALUES (@id, @type, @name, @nameProvenance, @anchor, @participants, @firstTick, @recurrences)
       ON CONFLICT(id) DO UPDATE SET type = excluded.type, name = excluded.name,
         name_provenance = excluded.name_provenance, anchor = excluded.anchor,
         participants = excluded.participants, recurrences = excluded.recurrences`,
      )
      .run({
        id: c.id,
        type: c.type,
        name: c.name,
        nameProvenance: c.nameProvenance === null ? null : JSON.stringify(c.nameProvenance),
        anchor: c.anchor === null ? null : JSON.stringify(c.anchor),
        participants: JSON.stringify(c.participants),
        firstTick: c.firstTick,
        recurrences: JSON.stringify(c.recurrences),
      })
  }

  record(type: ConstructOpsType, constructId: string, tick: number, payload: unknown): void {
    this.db
      .prepare(
        'INSERT INTO construct_events (type, construct_id, tick, payload) VALUES (?, ?, ?, ?)',
      )
      .run(type, constructId, tick, JSON.stringify(payload))
  }

  events(): ConstructOpsEvent[] {
    const rows = this.db
      .prepare('SELECT type, construct_id, tick, payload FROM construct_events ORDER BY id')
      .all() as Array<{
      type: ConstructOpsType
      construct_id: string
      tick: number
      payload: string
    }>
    return rows.map((r) => ({
      type: r.type,
      constructId: r.construct_id,
      tick: r.tick,
      payload: JSON.parse(r.payload) as unknown,
    }))
  }
}

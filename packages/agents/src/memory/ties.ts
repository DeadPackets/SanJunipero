import type Database from 'better-sqlite3'
import { MINUTES_PER_DAY } from '@sj/shared'
import { TieDeltaSchema, type TieDelta, type TieKind } from '../scene/scene.js'

/** Unrefreshed affect fades after seven days. One tick is one sim-minute. */
export const TIE_LET_GO_TICKS = 7 * MINUTES_PER_DAY

/** The town's words for what one person holds about another. Here rather than in either prompt,
 *  because a scene and an ordinary turn must name the same thing the same way. */
export const TIE_PHRASE: Record<TieKind, string> = {
  promise: 'a promise',
  debt: 'a debt',
  slight: 'a slight',
  grudge: 'a grudge',
  attraction: 'an attraction',
  secret: 'a secret',
  alliance: 'an alliance',
  kin: 'kin',
}

export type Tie = {
  id: number
  personId: string
  kind: TieKind
  text: string
  tick: number
  /** Null while the tie still stands. A settled tie is kept: what was owed is part of a life. */
  settledTick: number | null
  source: string
  resolution: TieDelta['resolution'] | null
  evidenceSeqs: number[]
  remindAtTick: number | null
}

type RawTie = {
  id: number
  person_id: string
  kind: TieKind
  text: string
  tick: number
  settled_tick: number | null
  source: string
  resolution: TieDelta['resolution'] | null
  evidence_seqs: string
  remind_at_tick: number | null
}

const toTie = (r: RawTie): Tie => ({
  id: r.id,
  personId: r.person_id,
  kind: r.kind,
  text: r.text,
  tick: r.tick,
  settledTick: r.settled_tick,
  source: r.source,
  resolution: r.resolution,
  evidenceSeqs: JSON.parse(r.evidence_seqs) as number[],
  remindAtTick: r.remind_at_tick,
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

  nextReminderAfter(tick: number): number | null {
    const row = this.db
      .prepare(`SELECT MIN(remind_at_tick) AS tick FROM ties
      WHERE agent_id = ? AND settled_tick IS NULL AND remind_at_tick > ?`)
      .get(this.agentId, tick) as { tick: number | null }
    return row.tick
  }

  apply(deltas: readonly TieDelta[], tick: number, source = 'scene'): TieDelta[] {
    return this.db.transaction(() => {
      const applied: TieDelta[] = []
      for (const raw of deltas) {
        if (raw.agentId !== this.agentId) continue
        const d = TieDeltaSchema.parse(raw)
        const target =
          d.tieId === undefined
            ? undefined
            : this.open().find(
                (t) => t.id === d.tieId && t.personId === d.personId && t.kind === d.kind,
              )
        if ((d.resolution !== undefined || d.tieId !== undefined) && target === undefined)
          throw new Error('tie target must identify an open tie owned by this mind')
        const evidence = JSON.stringify([
          ...new Set([...(target?.evidenceSeqs ?? []), ...(d.evidenceSeqs ?? [])]),
        ])
        if (target !== undefined) {
          this.db
            .prepare(`UPDATE ties SET settled_tick = ?, resolution = ?, evidence_seqs = ?,
            remind_at_tick = ? WHERE id = ? AND agent_id = ?`)
            .run(
              d.resolution === undefined ? null : tick,
              d.resolution ?? null,
              evidence,
              d.remindAtTick === undefined ? target.remindAtTick : d.remindAtTick,
              target.id,
              this.agentId,
            )
          applied.push(d)
        } else {
          if (
            this.open().some(
              (t) => t.personId === d.personId && t.kind === d.kind && t.text === d.text,
            )
          )
            continue
          const row = this.db
            .prepare(`INSERT INTO ties
            (agent_id, person_id, kind, text, tick, source, evidence_seqs, remind_at_tick)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(
              this.agentId,
              d.personId,
              d.kind,
              d.text,
              tick,
              source,
              evidence,
              d.remindAtTick ?? null,
            )
          applied.push({ ...d, tieId: Number(row.lastInsertRowid) })
        }
      }
      return applied
    })()
  }

  /** The kin a persona was written with, as ties from the first tick. Kin never settle, so a
   *  second boot finds them already standing and writes nothing. */
  seedKin(kin: readonly { id: string; relation: string }[], tick: number): void {
    const held = new Set(
      this.all()
        .filter((t) => t.kind === 'kin')
        .map((t) => t.personId),
    )
    this.apply(
      kin
        .filter((k) => k.id !== this.agentId && !held.has(k.id))
        .map((k) => ({
          agentId: this.agentId,
          personId: k.id,
          kind: 'kin' as const,
          text: `your ${k.relation}`,
        })),
      tick,
      'kin',
    )
  }

  /** Only affect fades on a clock; obligations and durable relationships need a decision. */
  letGo(tick: number): Tie[] {
    const gone = this.open().filter(
      (t) =>
        ['slight', 'grudge', 'attraction'].includes(t.kind) && tick - t.tick >= TIE_LET_GO_TICKS,
    )
    const settle = this.db.prepare(
      "UPDATE ties SET settled_tick = ?, resolution = 'released' WHERE id = ?",
    )
    this.db.transaction((rows: readonly Tie[]): void => {
      for (const t of rows) settle.run(tick, t.id)
    })(gone)
    return gone
  }
}

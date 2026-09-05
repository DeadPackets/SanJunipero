import type Database from 'better-sqlite3'
import {
  MINUTES_PER_DAY,
  type Moment,
  SceneKind,
  byDayThenStakes,
  momentTitle,
  placeWordsAt,
} from '@sj/shared'
import type { SceneRow } from '@sj/shared/narratorSchema'
import type { WorldMirror } from './worldMirror.js'

// ONE SCENE PER CARD, off the world's own log. `/api/moments` used to read the narrator's
// segments and title every one of them with the day's chapter title — thirty cards a day sharing
// one name, and no stakes on the wire to order them by. A scene carries its own topic, its own
// room and its own pressure, so a card has something to be about.

/** The newest this many scenes. The list is polled by every open filmstrip and a long-lived town
 *  has thousands. */
export const MOMENT_MAX = 240

export type MomentDeps = {
  db: Database.Database
  mirror: WorldMirror
  narratorDb: Database.Database | null
}

export function makeMomentsReader(deps: MomentDeps): () => Moment[] {
  // The newest rows, not the whole log: a close is always newer than its open, so a scene whose
  // open is in the window has its close in it too, and the pair survives the bound intact.
  const selScenes = deps.db.prepare(
    `SELECT seq, tick, type, payload FROM events WHERE type IN ('scene_opened', 'scene_closed')
     ORDER BY tick DESC, seq DESC LIMIT ?`,
  )

  // R4: a scene is stored as the tile it happened on, and a viewer is never shown a pair of
  // numbers. The nearest thing the town built answers for the tile, or nothing does.
  const placeWords = (loc: string | null): string | null => {
    if (loc === null) return null
    const m = /^(\d+),(\d+)$/.exec(loc)
    if (m === null) return loc
    return placeWordsAt(Object.values(deps.mirror.state().structures), Number(m[1]), Number(m[2]))
  }

  /** The log records no room. The narrator's own scene rows are the only place a place is ever
   *  written down, and they are time WINDOWS over the same events rather than these scenes — so
   *  there is no key to join on, and the window a scene happened inside answers for it. */
  const placeAt = (fromTick: number): ((tick: number) => string | null) => {
    let windows: Pick<SceneRow, 'start_tick' | 'end_tick' | 'location'>[] = []
    try {
      windows = (deps.narratorDb
        ?.prepare(
          'SELECT start_tick, end_tick, location FROM scenes WHERE end_tick >= ? ORDER BY start_tick',
        )
        .all(fromTick) ?? []) as typeof windows
    } catch {
      /* a narrator db that predates the table simply has no places to give */
    }
    return (tick) => {
      const w = windows.find((row) => tick >= row.start_tick && tick <= row.end_tick)
      return w === undefined ? null : placeWords(w.location)
    }
  }

  // One scan per world generation: `/api/moments` is polled by every open filmstrip and every
  // share card asks the same question of the same log.
  let held: { seq: number; moments: Moment[] } | null = null

  const read = (): Moment[] => {
    const rows = (
      selScenes.all(MOMENT_MAX * 2) as {
        seq: number
        tick: number
        type: string
        payload: string
      }[]
    ).reverse()
    const where = placeAt(rows[0]?.tick ?? 0)
    const open = new Map<string, Moment>()
    const out: Moment[] = []
    for (const r of rows) {
      const p = JSON.parse(r.payload) as Record<string, unknown>
      const id = typeof p.id === 'string' ? p.id : null
      if (id === null) continue
      if (r.type === 'scene_opened') {
        const kind = SceneKind.safeParse(p.kind)
        if (!kind.success) continue
        const moment: Moment = {
          id: r.seq,
          day: Math.floor(r.tick / MINUTES_PER_DAY),
          startTick: r.tick,
          endTick: r.tick,
          title: momentTitle(kind.data, typeof p.topic === 'string' ? p.topic : null),
          cast: Array.isArray(p.participants) ? (p.participants as string[]) : [],
          location: where(r.tick),
          kind: kind.data,
          stakes: typeof p.stakes === 'number' ? p.stakes : 0,
          summary: null,
        }
        open.set(id, moment)
        out.push(moment)
        continue
      }
      // A scene the log opened before this window began has nothing here to close.
      const started = open.get(id)
      if (started === undefined) continue
      open.delete(id)
      started.endTick = r.tick
      const summary = typeof p.summary === 'string' ? p.summary.trim() : ''
      started.summary = summary === '' ? null : summary
    }
    return out.sort(byDayThenStakes).slice(0, MOMENT_MAX)
  }

  return () => {
    const seq = deps.mirror.seq()
    if (held?.seq !== seq) held = { seq, moments: read() }
    return held.moments
  }
}

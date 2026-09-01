import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { IncomingMessage } from 'node:http'
import Database from 'better-sqlite3'
import {
  CHRONICLE_TYPES,
  type ChronicleEntry,
  type ChronicleLookup,
  MILESTONE_ICON,
  MILESTONE_TYPE,
  MINUTES_PER_DAY,
  type Moment,
  agentName,
  chronicleIcon,
  chronicleLine,
  discoveryHeadline,
  kindWords,
  placeWordsAt,
} from '@sj/shared'
// Plain SELECTs rather than @sj/narrator, which drags @sj/llm and the `ai` SDK behind it.
// The contract is declared once, in @sj/shared.
import {
  MILESTONE_SELECT,
  milestoneFromRow,
  type ChapterRow,
  type MilestoneRow,
  type SceneRow,
} from '@sj/shared/narratorSchema'
import { MYSTERY_BY_KIND } from '@sj/engine'
import { readDiscoveries } from './discoveries.js'
import type { Router } from './router.js'
import type { WorldMirror } from './worldMirror.js'
import { makeSeqCache, sendPrebuilt } from './seqCache.js'
import { sendJson, toEvent } from './http.js'
import { reportOnce } from './degraded.js'

export type NarratorApiDeps = {
  db: Database.Database // the world DB — events are the town's own record
  mirror: WorldMirror
  narratorDb: Database.Database | null // absent until C7 narrates a day
  agentDbDir?: string | undefined // agent memory, for the days a personality moved
}

/** Every open panel refetches the feed on a 20 s timer; unbounded that is the whole history. */
export const CHRONICLE_MAX = 200

/** The record grows one row a day forever and every open panel refetches it. */
const DISPATCH_MAX = 30

/** The five things the world's own log records that the town would remember. Anything else is
 *  the everyday, and a scrub bar covered in the everyday points nowhere. */
const MARK_EVENT_TYPES: readonly string[] = [
  'agent_died',
  'agent_born',
  'agent_spawned',
  'agent_injured',
  'structure_completed',
]

// A narrator.db that exists but predates a table still answers [] — the observatory is a
// window, and a window never errors because the room behind it is unfinished.
/** A renamed narrator TABLE is a different fact wearing the same empty answer; it says so once
 *  rather than 500ing. See `degraded.ts`. */
function readOrEmpty<T>(db: Database.Database | null, sql: string): T[] {
  if (db === null) return []
  try {
    return db.prepare(sql).all() as T[]
  } catch (e) {
    reportOnce(
      `narrator.${sql}`,
      () =>
        `the narrator db is open but \`${sql}\` failed, so /api/chronicle is answering without it` +
        ` — ${e instanceof Error ? e.message : String(e)}`,
    )
    return []
  }
}

export function mountNarratorApi(router: Router, deps: NarratorApiDeps): void {
  // `/api/chronicle` scans the weighted log per request, on the tick thread. See seqCache.ts.
  // The agent-db sweep behind `/api/timeline/marks` is memoised on the DAY instead — see below.
  const cache = makeSeqCache(() => deps.mirror.seq())
  const placeholders = CHRONICLE_TYPES.map(() => '?').join(', ')
  const selWeighted = deps.db.prepare(
    `SELECT seq, tick, type, payload FROM events
     WHERE type IN (${placeholders}) AND tick BETWEEN ? AND ? ORDER BY tick, seq`,
  )

  const lookup = (): ChronicleLookup => {
    const state = deps.mirror.state()
    return {
      agentName: (id) => agentName(state.agents, id),
      structureKind: (id) => kindWords(state.structures[id]?.kind ?? 'building'),
      mysteryProse: (kind) => MYSTERY_BY_KIND[kind]?.prose ?? null,
    }
  }

  // R4: a scene is stored as the tile it happened on, and a viewer is never shown a pair of
  // numbers. The nearest thing the town built answers for the tile, or nothing does; a place
  // already written as words is already an answer.
  const placeWords = (loc: string | null): string | null => {
    if (loc === null) return null
    const m = /^(\d+),(\d+)$/.exec(loc)
    if (m === null) return loc
    return placeWordsAt(Object.values(deps.mirror.state().structures), Number(m[1]), Number(m[2]))
  }

  // A free key is a cache a stranger can miss on purpose. The clamped pair is also the memo key,
  // so every over-long window collapses onto the same entry.
  const windowOf = (url: URL): { fromTick: number; toTick: number } => {
    const liveTick = deps.mirror.state().tick
    const pin = (raw: string | null, fallback: number): number => {
      const n = Number(raw ?? fallback)
      if (!Number.isFinite(n)) return fallback
      return Math.min(Math.max(Math.trunc(n), 0), liveTick)
    }
    const fromTick = pin(url.searchParams.get('fromTick'), 0)
    return { fromTick, toTick: Math.max(fromTick, pin(url.searchParams.get('toTick'), liveTick)) }
  }

  const chronicleEntries = (fromTick: number, toTick: number): readonly ChronicleEntry[] =>
    cache.value(`chronicle:${fromTick}:${toTick}`, () => {
      const look = lookup()
      const rows = selWeighted.all(...CHRONICLE_TYPES, fromTick, toTick) as {
        seq: number
        tick: number
        type: string
        payload: string
      }[]
      const entries: ChronicleEntry[] = []
      for (const r of rows) {
        const label = chronicleLine(toEvent(r), look)
        if (label === null) continue // a weighted type the formatter has no words for yet
        entries.push({ seq: r.seq, tick: r.tick, type: r.type, icon: chronicleIcon(r.type), label })
      }

      // The narrator's firsts join the same stream: same shape, same ordering, one feed.
      for (const m of readOrEmpty<{ label: string; event_seq: number; tick: number }>(
        deps.narratorDb,
        'SELECT label, event_seq, tick FROM milestones ORDER BY id',
      )) {
        if (m.tick < fromTick || m.tick > toTick) continue
        entries.push({
          seq: Math.max(1, m.event_seq),
          tick: m.tick,
          type: MILESTONE_TYPE,
          icon: MILESTONE_ICON,
          label: m.label,
        })
      }
      entries.sort((a, b) => a.tick - b.tick || a.seq - b.seq)
      return entries
    })

  router.route('GET', '/api/chronicle', (req: IncomingMessage, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const { fromTick, toTick } = windowOf(url)
    sendPrebuilt(
      res,
      cache.json(`chronicle:${fromTick}:${toTick}`, () => ({
        entries: chronicleEntries(fromTick, toTick).slice(-CHRONICLE_MAX),
      })),
    )
  })

  router.route('GET', '/api/chapters', (_req, res) => {
    sendJson(
      res,
      readOrEmpty<ChapterRow>(
        deps.narratorDb,
        'SELECT day, title, text FROM chapters ORDER BY day',
      ),
    )
  })

  // Memoised on the world DAY, not `mirror.seq()`: nothing here changes between day boundaries,
  // and a seq-keyed memo would rescan six tables on every pump.
  let dispatchedDay = -1
  let dispatched: unknown = null
  router.route('GET', '/api/dispatches', (_req, res) => {
    const day = Math.floor(deps.mirror.state().tick / MINUTES_PER_DAY)
    if (day !== dispatchedDay || dispatched === null) {
      dispatchedDay = day
      const db = deps.narratorDb
      dispatched = {
        papers: readOrEmpty(
          db,
          `SELECT day, title, body FROM publications WHERE kind = 'newspaper'
           ORDER BY day DESC LIMIT ${DISPATCH_MAX}`,
        ),
        captions: readOrEmpty(
          db,
          `SELECT day, body AS caption FROM publications WHERE kind = 'timelapse_caption'
           ORDER BY day DESC LIMIT ${DISPATCH_MAX}`,
        ),
        // Only the newest of each life: a biography is rewritten as its subject lives longer.
        biographies: readOrEmpty(
          db,
          `SELECT subject_id AS subjectId, MAX(day) AS day, title, body FROM publications
           WHERE kind = 'biography' AND subject_id IS NOT NULL GROUP BY subject_id`,
        ),
        eras: readOrEmpty(
          db,
          `SELECT start_day AS startDay, end_day AS endDay, title, text FROM eras
           ORDER BY start_day DESC LIMIT ${DISPATCH_MAX}`,
        ),
        institutions: readOrEmpty(
          db,
          `SELECT s.day AS day, i.kind, i.name, i.description, i.member_ids AS memberIds
           FROM institutions i JOIN scenes s ON s.id = i.founding_scene_id
           ORDER BY s.day DESC LIMIT ${DISPATCH_MAX}`,
        ),
        // One reading a day: the hottest scene the narrator scored is what the day felt like.
        heat: readOrEmpty(
          db,
          `SELECT s.day AS day, MAX(h.total) AS total FROM heat_scores h
           JOIN scenes s ON s.id = h.scene_id GROUP BY s.day ORDER BY s.day DESC
           LIMIT ${DISPATCH_MAX}`,
        ),
      }
    }
    sendJson(res, dispatched)
  })

  router.route('GET', '/api/milestones', (_req, res) => {
    const rows = readOrEmpty<MilestoneRow>(
      deps.narratorDb,
      `SELECT ${MILESTONE_SELECT} FROM milestones ORDER BY id`,
    )
    sendJson(res, rows.map(milestoneFromRow))
  })

  // A recorded day, named by its chapter when C7 has written one and by its number when it
  // has not — the day exists either way, and the list must not wait on the prose.
  router.route('GET', '/api/moments', (_req, res) => {
    const rows = readOrEmpty<SceneRow & { id: number; title: string | null }>(
      deps.narratorDb,
      `
      SELECT s.id, s.day, s.start_tick, s.end_tick, s."cast", s.location, c.title
      FROM scenes s LEFT JOIN chapters c ON c.day = s.day
      ORDER BY s.day, s.id
    `,
    )
    const moments: Moment[] = rows.map((r) => ({
      id: r.id,
      day: r.day,
      startTick: r.start_tick,
      endTick: r.end_tick,
      title: r.title ?? `Day ${r.day}`,
      cast: JSON.parse(r.cast) as string[],
      location: placeWords(r.location),
    }))
    sendJson(res, { moments })
  })

  // The SOURCES, not the marks: the rule that turns them into marks lives in the viewer's
  // `ui/timelineMarks.ts`, and a second copy here is a second copy to keep right.
  const selMarkEvents = deps.db.prepare(
    `SELECT tick, type FROM events WHERE type IN (${MARK_EVENT_TYPES.map(() => '?').join(', ')})
     ORDER BY tick, seq`,
  )

  /** The days a personality document actually MOVED. Version 1 is the document arriving, not
   *  a change, so it is excluded — otherwise everybody "changed" on the day they were written. */
  const sweepChangeDays = (): { tick: number }[] => {
    if (deps.agentDbDir === undefined) return []
    let files: string[]
    try {
      files = readdirSync(deps.agentDbDir)
        .filter((f) => f.endsWith('.db'))
        .sort()
    } catch {
      return []
    }
    const ticks: number[] = []
    for (const file of files) {
      let adb: Database.Database | null = null
      try {
        adb = new Database(join(deps.agentDbDir, file), { readonly: true, fileMustExist: true })
        for (const r of adb
          .prepare('SELECT day FROM personality_versions WHERE version > 1')
          .all() as { day: number }[])
          ticks.push(r.day * MINUTES_PER_DAY)
      } catch {
        /* an agent with no memory file, or a file predating the table, simply has no changes */
      } finally {
        adb?.close()
      }
    }
    return [...new Set(ticks)].sort((a, b) => a - b).map((tick) => ({ tick }))
  }

  // Keyed on the world DAY, not `mirror.seq()`: the seq moves every pump, so a seq-keyed memo
  // reopens every agent db per poll. The mark is day-granular, so a day is what it may lag by.
  let sweptDay = -1
  let sweptChanges: { tick: number }[] = []
  const changeDays = (): { tick: number }[] => {
    const day = Math.floor(deps.mirror.state().tick / MINUTES_PER_DAY)
    if (day !== sweptDay) {
      sweptDay = day
      sweptChanges = sweepChangeDays()
    }
    return sweptChanges
  }

  router.route('GET', '/api/timeline/marks', (_req, res) => {
    sendPrebuilt(
      res,
      cache.json('marks', () => ({
        throughTick: deps.mirror.state().tick,
        chapters: readOrEmpty<ChapterRow>(
          deps.narratorDb,
          'SELECT day, title FROM chapters ORDER BY day',
        ),
        moments: readOrEmpty<{ day: number; startTick: number }>(
          deps.narratorDb,
          'SELECT day, start_tick AS startTick FROM scenes ORDER BY day, id',
        ),
        changes: changeDays(),
        // Its own source, not a sixth MARK_EVENT_TYPE: the events source carries only tick and
        // type, and a discovery mark that cannot name its inventor is a mark not worth aiming at.
        discoveries: readDiscoveries(deps.db, (id) =>
          agentName(deps.mirror.state().agents, id),
        ).map((d) => ({ tick: d.tick, words: discoveryHeadline(d) })),
        events: selMarkEvents.all(...MARK_EVENT_TYPES) as { tick: number; type: string }[],
      })),
    )
  })
}

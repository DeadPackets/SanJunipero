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
  agentName,
  chronicleCast,
  chronicleIcon,
  chronicleLine,
  discoveryHeadline,
  kindWords,
} from '@sj/shared'
// Plain SELECTs rather than @sj/narrator, which drags @sj/llm and the `ai` SDK behind it.
// The contract is declared once, in @sj/shared.
import {
  MILESTONE_SELECT,
  milestoneFromRow,
  type ChapterRow,
  type MilestoneRow,
} from '@sj/shared/narratorSchema'
// The deep path, never the package root: `@sj/narrator`'s index reaches @sj/llm and the `ai`
// SDK, which a free scripted stream may not import. This module's own imports are types only.
import { footnoteSeqs, stripFootnotes } from '@sj/narrator/chronicle'
import { MYSTERY_BY_KIND } from '@sj/engine'
import { readDiscoveries } from './discoveries.js'
import { makeMomentsReader } from './moments.js'
import type { Router } from './router.js'
import type { WorldMirror } from './worldMirror.js'
import { makeSeqCache, sendPrebuilt } from './seqCache.js'
import { parseTarget, sendJson, toEvent } from './http.js'
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

/** The six things the world's own log records that the town would remember. Anything else is
 *  the everyday, and a scrub bar covered in the everyday points nowhere. The founding is not one
 *  of them — `agent_spawned` is the town starting, not a day anybody would scrub back to. */
const MARK_EVENT_TYPES: readonly string[] = [
  'agent_died',
  'agent_born',
  'agent_arrived',
  'agent_departed',
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
  // Newest first with a LIMIT, then reversed: a stranger picks the window, and every distinct
  // pair is a cache miss, so an unbounded miss is an O(history) scan on the tick thread.
  const selWeighted = deps.db.prepare(
    `SELECT seq, tick, type, payload FROM events
     WHERE type IN (${placeholders}) AND tick BETWEEN ? AND ?
     ORDER BY tick DESC, seq DESC LIMIT ${CHRONICLE_MAX}`,
  )

  const lookup = (): ChronicleLookup => {
    const state = deps.mirror.state()
    return {
      agentName: (id) => agentName(state.agents, id),
      structureKind: (id) => kindWords(state.structures[id]?.kind ?? 'building'),
      mysteryProse: (kind) => MYSTERY_BY_KIND[kind]?.prose ?? null,
      partnerOf: (id) => state.agents[id]?.partnerId ?? null,
    }
  }

  // A free key is a cache a stranger can miss on purpose. The clamped pair is also the memo key,
  // so every over-long window collapses onto the same entry.
  const windowOf = (q: URLSearchParams): { fromTick: number; toTick: number } => {
    const liveTick = deps.mirror.state().tick
    const pin = (raw: string | null, fallback: number): number => {
      const n = Number(raw ?? fallback)
      if (!Number.isFinite(n)) return fallback
      return Math.min(Math.max(Math.trunc(n), 0), liveTick)
    }
    const fromTick = pin(q.get('fromTick'), 0)
    return { fromTick, toTick: Math.max(fromTick, pin(q.get('toTick'), liveTick)) }
  }

  const chronicleEntries = (fromTick: number, toTick: number): readonly ChronicleEntry[] =>
    cache.value(`chronicle:${fromTick}:${toTick}`, () => {
      const look = lookup()
      const rows = (
        selWeighted.all(...CHRONICLE_TYPES, fromTick, toTick) as {
          seq: number
          tick: number
          type: string
          payload: string
        }[]
      ).reverse()
      const agents = deps.mirror.state().agents
      const isAgent = (id: string): boolean => agents[id] !== undefined
      const entries: ChronicleEntry[] = []
      for (const r of rows) {
        const ev = toEvent(r)
        const label = chronicleLine(ev, look)
        if (label === null) continue // a weighted type the formatter has no words for yet
        entries.push({
          seq: r.seq,
          tick: r.tick,
          type: r.type,
          icon: chronicleIcon(r.type),
          label,
          agentIds: chronicleCast(ev, isAgent),
        })
      }

      // The narrator's firsts join the same stream: same shape, same ordering, one feed.
      for (const row of readOrEmpty<MilestoneRow>(
        deps.narratorDb,
        `SELECT ${MILESTONE_SELECT} FROM milestones ORDER BY id`,
      )) {
        const m = milestoneFromRow(row)
        if (m.tick < fromTick || m.tick > toTick) continue
        entries.push({
          seq: Math.max(1, m.eventSeq),
          tick: m.tick,
          type: MILESTONE_TYPE,
          icon: MILESTONE_ICON,
          label: m.label,
          agentIds: m.agentIds,
        })
      }
      entries.sort((a, b) => a.tick - b.tick || a.seq - b.seq)
      return entries
    })

  router.route('GET', '/api/chronicle', (req: IncomingMessage, res) => {
    const { fromTick, toTick } = windowOf(
      parseTarget(req.url)?.searchParams ?? new URLSearchParams(),
    )
    sendPrebuilt(
      res,
      cache.json(`chronicle:${fromTick}:${toTick}`, () => ({
        entries: chronicleEntries(fromTick, toTick).slice(-CHRONICLE_MAX),
      })),
    )
  })

  /** The `Seen:` footnotes are the narrator's own citation apparatus and a number leak to a
   *  reader, so the prose is served without them — and the mapping they carry is served beside
   *  it, paragraph by paragraph, so a replay can caption itself in the narrator's own voice
   *  rather than paying an LLM per view. `seen[i]` belongs to paragraph `i` of `text`. */
  const chapterRead = (c: ChapterRow): ChapterRow & { seen: number[][] } => {
    const paras = c.text
      .split(/\n{2,}/)
      .map((p) => ({ text: stripFootnotes(p), seen: footnoteSeqs(p) }))
      .filter((p) => p.text !== '')
    return {
      day: c.day,
      title: c.title,
      text: paras.map((p) => p.text).join('\n\n'),
      seen: paras.map((p) => p.seen),
    }
  }

  router.route('GET', '/api/chapters', (_req, res) => {
    sendJson(
      res,
      readOrEmpty<ChapterRow>(
        deps.narratorDb,
        'SELECT day, title, text FROM chapters ORDER BY day',
      ).map(chapterRead),
    )
  })

  // Memoised on the newest publication, not `mirror.seq()` and not the world DAY: nothing here
  // changes until the narrator writes, and it writes SECONDS into the day a day-keyed memo has
  // already captured — which showed day N's paper only once day N+2 began.
  let dispatchedAt = -1
  let dispatched: unknown = null
  router.route('GET', '/api/dispatches', (_req, res) => {
    const written =
      readOrEmpty<{ id: number | null }>(
        deps.narratorDb,
        'SELECT MAX(id) AS id FROM publications',
      )[0]?.id ?? 0
    if (written !== dispatchedAt || dispatched === null) {
      dispatchedAt = written
      const db = deps.narratorDb
      dispatched = {
        papers: readOrEmpty<{ day: number; title: string; body: string }>(
          db,
          `SELECT day, title, body FROM publications WHERE kind = 'newspaper'
           ORDER BY day DESC LIMIT ${DISPATCH_MAX}`,
        ).map((p) => ({ ...p, body: stripFootnotes(p.body) })),
        captions: readOrEmpty(
          db,
          `SELECT day, body AS caption FROM publications WHERE kind = 'timelapse_caption'
           ORDER BY day DESC LIMIT ${DISPATCH_MAX}`,
        ),
        // Only the newest of each life: a biography is rewritten as its subject lives longer.
        biographies: readOrEmpty<{ subjectId: string; day: number; title: string; body: string }>(
          db,
          `SELECT subject_id AS subjectId, MAX(day) AS day, title, body FROM publications
           WHERE kind = 'biography' AND subject_id IS NOT NULL GROUP BY subject_id`,
        ).map((b) => ({ ...b, body: stripFootnotes(b.body) })),
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
        // The five bare columns come off the row MAX() picked, which SQLite guarantees only
        // while this query carries exactly one aggregate.
        heat: readOrEmpty(
          db,
          `SELECT s.day AS day, MAX(h.total) AS total, h.conflict AS conflict,
             h.novelty AS novelty, h.firsts AS firsts, h.stakes AS stakes,
             h.dramatic_irony AS dramaticIrony
           FROM heat_scores h
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
    // Read apart rather than joined: a narrator db written before this table still answers
    // every first, with no quote, instead of answering none.
    const detected = new Map(
      readOrEmpty<{ concept_kind: string; day: number; quote: string }>(
        deps.narratorDb,
        'SELECT concept_kind, day, quote FROM semantic_first_detected',
      ).map((d) => [`first_${d.concept_kind}`, { quote: d.quote, day: d.day }]),
    )
    sendJson(
      res,
      rows.map((r) => ({ ...milestoneFromRow(r), detected: detected.get(r.kind) ?? null })),
    )
  })

  const momentsFromLog = makeMomentsReader(deps)

  router.route('GET', '/api/moments', (_req, res) => {
    sendPrebuilt(
      res,
      cache.json('moments', () => ({ moments: momentsFromLog() })),
    )
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
        // A chapter is dated to a day, and its own scenes hold the only minute the world ever
        // wrote for it. A chapter that kept no scene keeps no minute, and says so with null.
        chapters: readOrEmpty<{ day: number; title: string; startTick: number | null }>(
          deps.narratorDb,
          `SELECT c.day AS day, c.title AS title, MIN(s.start_tick) AS startTick
           FROM chapters c LEFT JOIN scenes s ON s.day = c.day
           GROUP BY c.day ORDER BY c.day`,
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

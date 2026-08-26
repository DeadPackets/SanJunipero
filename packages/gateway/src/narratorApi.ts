import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { IncomingMessage } from 'node:http'
import Database from 'better-sqlite3'
import {
  CHRONICLE_TYPES, MILESTONE_ICON, MILESTONE_TYPE, MINUTES_PER_DAY, chronicleIcon, chronicleLine,
  discoveryHeadline,
  type ChronicleEntry, type ChronicleLookup, type Moment,
} from '@sj/shared'
import { MYSTERY_BY_KIND } from '@sj/engine'
import { readDiscoveries } from './discoveries.js'
import type { Router } from './server.js'
import type { WorldMirror } from './worldMirror.js'
import { makeSeqCache, sendPrebuilt } from './seqCache.js'
import { sendJson, toEvent } from './http.js'
import { clampWindow } from './api.js'
import { reportOnce } from './degraded.js'

// Plain SELECTs rather than @sj/narrator, which drags @sj/agents (onnxruntime, transformers)
// behind it. A test walks this map against the real narrator schema.
export const NARRATOR_READ_TABLES: Readonly<Record<string, readonly string[]>> = {
  chapters: ['day', 'title'],
  milestones: ['kind', 'label', 'day', 'tick'],
  scenes: ['day', 'start_tick', 'end_tick', '"cast"', 'location'],
}

export type NarratorApiDeps = {
  db: Database.Database                     // the world DB — events are the town's own record
  mirror: WorldMirror
  narratorDb: Database.Database | null      // absent until C7 narrates a day
  agentDbDir?: string                       // agent memory, for the days a personality moved
}

/** The five things the world's own log records that the town would remember. Anything else is
 *  the everyday, and a scrub bar covered in the everyday points nowhere. */
export const MARK_EVENT_TYPES: readonly string[] = [
  'agent_died', 'agent_born', 'agent_spawned', 'agent_injured', 'structure_completed',
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
    reportOnce(`narrator.${sql}`, () =>
      `the narrator db is open but \`${sql}\` failed, so /api/chronicle is answering without it`
      + ` — ${e instanceof Error ? e.message : String(e)}`)
    return []
  }
}

export function mountNarratorApi(router: Router, deps: NarratorApiDeps): void {
  // `/api/chronicle` scans the weighted log and `/api/timeline/marks` opens EVERY agent memory
  // db from disk — both per request, both on the tick thread. See seqCache.ts.
  const cache = makeSeqCache(() => deps.mirror.seq())
  const placeholders = CHRONICLE_TYPES.map(() => '?').join(', ')
  const selWeighted = deps.db.prepare(
    `SELECT seq, tick, type, payload FROM events
     WHERE type IN (${placeholders}) AND tick BETWEEN ? AND ? ORDER BY tick, seq`,
  )

  const lookup = (): ChronicleLookup => {
    const state = deps.mirror.state()
    return {
      agentName: (id) => state.agents[id]?.name ?? id,
      // A kind is a slug in the engine and PROSE to a viewer. `kindWords` in
      // web/ui/broadcastReady.ts owns this rule; the gateway cannot import the web bundle.
      structureKind: (id) => (state.structures[id]?.kind ?? 'building').replace(/_/g, ' '),
      mysteryProse: (kind) => MYSTERY_BY_KIND[kind]?.prose ?? null,
    }
  }

  // Clamped because a free key is a cache a stranger can miss on purpose. The clamped pair is
  // also the memo key, so every over-long window collapses onto the same entry.
  const windowOf = (url: URL): { fromTick: number; toTick: number } => clampWindow(
    url.searchParams.get('fromTick'), url.searchParams.get('toTick'), deps.mirror.state().tick)

  const chronicleEntries = (fromTick: number, toTick: number): readonly ChronicleEntry[] =>
    cache.value(`chronicle:${fromTick}:${toTick}`, () => {
      const look = lookup()
      const rows = selWeighted.all(...CHRONICLE_TYPES, fromTick, toTick) as Array<{
        seq: number; tick: number; type: string; payload: string
      }>
      const entries: ChronicleEntry[] = []
      for (const r of rows) {
        const label = chronicleLine(toEvent(r), look)
        if (label === null) continue // a weighted type the formatter has no words for yet
        entries.push({ seq: r.seq, tick: r.tick, type: r.type, icon: chronicleIcon(r.type), label })
      }

      // The narrator's firsts join the same stream: same shape, same ordering, one feed.
      for (const m of readOrEmpty<{ label: string; event_seq: number; tick: number }>(
        deps.narratorDb, 'SELECT label, event_seq, tick FROM milestones ORDER BY id',
      )) {
        if (m.tick < fromTick || m.tick > toTick) continue
        entries.push({
          seq: Math.max(1, m.event_seq), tick: m.tick,
          type: MILESTONE_TYPE, icon: MILESTONE_ICON, label: m.label,
        })
      }
      entries.sort((a, b) => a.tick - b.tick || a.seq - b.seq)
      return entries
    })

  router.route('GET', '/api/chronicle', (req: IncomingMessage, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const { fromTick, toTick } = windowOf(url)
    sendPrebuilt(res, cache.json(`chronicle:${fromTick}:${toTick}`, () =>
      ({ entries: chronicleEntries(fromTick, toTick) })))
  })

  /** How long the ledger is, without sending the ledger. It costs nothing extra:
   *  `chronicleEntries` is memoised per generation, so the badge and the panel share one scan. */
  router.route('GET', '/api/chronicle/count', (req: IncomingMessage, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const { fromTick, toTick } = windowOf(url)
    sendPrebuilt(res, cache.json(`chronicle-count:${fromTick}:${toTick}`, () => {
      const entries = chronicleEntries(fromTick, toTick)
      const last = entries[entries.length - 1]
      // `latestSeq` is the feed's newest entry, so a badge can say "N new" without the body.
      return { count: entries.length, latestSeq: last ? last.seq : 0, latestTick: last ? last.tick : 0 }
    }))
  })

  router.route('GET', '/api/chapters', (_req, res) => {
    sendJson(res, readOrEmpty<{ day: number; title: string }>(
      deps.narratorDb, 'SELECT day, title FROM chapters ORDER BY day',
    ))
  })

  router.route('GET', '/api/milestones', (_req, res) => {
    sendJson(res, readOrEmpty<{ kind: string; label: string; day: number; tick: number }>(
      deps.narratorDb, 'SELECT kind, label, day, tick FROM milestones ORDER BY id',
    ))
  })

  // A recorded day, named by its chapter when C7 has written one and by its number when it
  // has not — the day exists either way, and the list must not wait on the prose.
  router.route('GET', '/api/moments', (_req, res) => {
    const rows = readOrEmpty<{
      id: number; day: number; start_tick: number; end_tick: number
      cast: string; location: string | null; title: string | null
    }>(deps.narratorDb, `
      SELECT s.id, s.day, s.start_tick, s.end_tick, s."cast", s.location, c.title
      FROM scenes s LEFT JOIN chapters c ON c.day = s.day
      ORDER BY s.day, s.id
    `)
    const moments: Moment[] = rows.map((r) => ({
      id: r.id,
      day: r.day,
      startTick: r.start_tick,
      endTick: r.end_tick,
      title: r.title ?? `Day ${r.day}`,
      cast: JSON.parse(r.cast) as string[],
      location: r.location,
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
  const changeDays = (): Array<{ tick: number }> => {
    if (deps.agentDbDir === undefined) return []
    let files: string[]
    try {
      files = readdirSync(deps.agentDbDir).filter((f) => f.endsWith('.db')).sort()
    } catch {
      return []
    }
    const ticks: number[] = []
    for (const file of files) {
      let adb: Database.Database | null = null
      try {
        adb = new Database(join(deps.agentDbDir, file), { readonly: true, fileMustExist: true })
        for (const r of adb.prepare('SELECT day FROM personality_versions WHERE version > 1').all() as
          Array<{ day: number }>) ticks.push(r.day * MINUTES_PER_DAY)
      } catch {
        /* an agent with no memory file, or a file predating the table, simply has no changes */
      } finally {
        adb?.close()
      }
    }
    return [...new Set(ticks)].sort((a, b) => a - b).map((tick) => ({ tick }))
  }

  router.route('GET', '/api/timeline/marks', (_req, res) => {
    sendPrebuilt(res, cache.json('marks', () => ({
      throughTick: deps.mirror.state().tick,
      chapters: readOrEmpty<{ day: number; title: string }>(
        deps.narratorDb, 'SELECT day, title FROM chapters ORDER BY day'),
      milestones: readOrEmpty<{ label: string; day: number; tick: number }>(
        deps.narratorDb, 'SELECT label, day, tick FROM milestones ORDER BY tick, id'),
      moments: readOrEmpty<{ day: number; startTick: number }>(
        deps.narratorDb, 'SELECT day, start_tick AS startTick FROM scenes ORDER BY day, id'),
      changes: changeDays(),
      // Its own source, not a sixth MARK_EVENT_TYPE: the events source carries only tick and
      // type, and a discovery mark that cannot name its inventor is a mark not worth aiming at.
      discoveries: readDiscoveries(deps.db, (id) => deps.mirror.state().agents[id]?.name ?? id)
        .map((d) => ({ tick: d.tick, words: discoveryHeadline(d) })),
      events: selMarkEvents.all(...MARK_EVENT_TYPES) as Array<{ tick: number; type: string }>,
    })))
  })
}

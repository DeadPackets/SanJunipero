import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import Database from 'better-sqlite3'
import {
  CHRONICLE_TYPES, MILESTONE_ICON, MILESTONE_TYPE, chronicleIcon, chronicleLine, discoveryHeadline,
  type ChronicleEntry, type ChronicleLookup, type Moment, type SimEvent,
} from '@sj/shared'
import { MYSTERY_BY_KIND } from '@sj/engine'
import { readDiscoveries } from './discoveries.js'
import type { Router } from './server.js'
import type { WorldMirror } from './worldMirror.js'
import { makeSeqCache, sendPrebuilt } from './seqCache.js'
import { clampWindow } from './api.js'

// The narrator's tables are read through plain SELECTs rather than @sj/narrator, which drags
// @sj/agents (onnxruntime, transformers) behind it — the same call api.ts makes for agent
// memory. This map is the whole of the read surface, and a test walks it against the real
// narrator schema so a renamed column fails here instead of in production.
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

/** U14 — the five things the world's own log records that the town would remember. Anything
 *  else is the everyday, and a scrub bar covered in the everyday points nowhere. */
export const MARK_EVENT_TYPES: readonly string[] = [
  'agent_died', 'agent_born', 'agent_spawned', 'agent_injured', 'structure_completed',
]

const MINUTES_PER_DAY = 1440

const sendJson = (res: ServerResponse, body: unknown, status = 200): void => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

// A narrator.db that exists but predates a table still answers [] — the observatory is a
// window, and a window never errors because the room behind it is unfinished.
function readOrEmpty<T>(db: Database.Database | null, sql: string): T[] {
  if (db === null) return []
  try {
    return db.prepare(sql).all() as T[]
  } catch {
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
      // R4: a kind is a slug in the engine and PROSE to a viewer. `kindWords` in
      // web/ui/broadcastReady.ts owns this rule; the gateway cannot import the web bundle,
      // so the one line is repeated here rather than the rule being forgotten.
      structureKind: (id) => (state.structures[id]?.kind ?? 'building').replace(/_/g, ' '),
      mysteryProse: (kind) => MYSTERY_BY_KIND[kind]?.prose ?? null,
    }
  }

  // Clamped into the world for the same reason `/api/digest` is: an unbounded window is a
  // window on nothing, and a free key is a cache a stranger can miss on purpose. The clamped
  // pair is also the memo key, so every over-long window collapses onto the same entry.
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
        const ev: SimEvent = { seq: r.seq, tick: r.tick, type: r.type, payload: JSON.parse(r.payload) }
        const label = chronicleLine(ev, look)
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
    sendPrebuilt(res, cache.json(`chronicle${url.search}`, () => {
      const { fromTick, toTick } = windowOf(url)
      return { entries: chronicleEntries(fromTick, toTick) }
    }))
  })

  /**
   * ★ HOW LONG THE LEDGER IS, WITHOUT SENDING THE LEDGER.
   *
   * The viewer's chronicle badge fetched every entry to display one number — the whole feed
   * over the wire and through `JSON.parse` on every poll, for two integers' worth of answer.
   * That is the same read amplification as everything else on this surface, just paid by the
   * browser instead of the tick thread.
   *
   * It costs the server nothing extra: `chronicleEntries` is memoised per world generation, so
   * the badge and the panel share one scan when both ask in the same tick.
   */
  router.route('GET', '/api/chronicle/count', (req: IncomingMessage, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    sendPrebuilt(res, cache.json(`chronicle-count${url.search}`, () => {
      const { fromTick, toTick } = windowOf(url)
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

  // THE MARKS ON THE SCRUB BAR (U14). This hands over the SOURCES, not the marks: the rule
  // that turns them into marks — the weighting, the coalescing, the words — is one function in
  // the viewer (`ui/timelineMarks.ts`), and a second copy of it here is a second copy to keep
  // right. Plain SELECTs, typed-empty when a source is absent, never a 500.
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

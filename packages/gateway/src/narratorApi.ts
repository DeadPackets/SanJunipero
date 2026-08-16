import type { IncomingMessage, ServerResponse } from 'node:http'
import type Database from 'better-sqlite3'
import {
  CHRONICLE_TYPES, MILESTONE_ICON, MILESTONE_TYPE, chronicleIcon, chronicleLine,
  type ChronicleEntry, type ChronicleLookup, type Moment, type SimEvent,
} from '@sj/shared'
import { MYSTERY_BY_KIND } from '@sj/engine'
import type { Router } from './server.js'
import type { WorldMirror } from './worldMirror.js'

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
}

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
  const placeholders = CHRONICLE_TYPES.map(() => '?').join(', ')
  const selWeighted = deps.db.prepare(
    `SELECT seq, tick, type, payload FROM events
     WHERE type IN (${placeholders}) AND tick BETWEEN ? AND ? ORDER BY tick, seq`,
  )

  const lookup = (): ChronicleLookup => {
    const state = deps.mirror.state()
    return {
      agentName: (id) => state.agents[id]?.name ?? id,
      structureKind: (id) => state.structures[id]?.kind ?? 'building',
      mysteryProse: (kind) => MYSTERY_BY_KIND[kind]?.prose ?? null,
    }
  }

  router.route('GET', '/api/chronicle', (req: IncomingMessage, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const liveTick = deps.mirror.state().tick
    const fromTick = Number(url.searchParams.get('fromTick') ?? 0)
    const toTick = Number(url.searchParams.get('toTick') ?? liveTick)
    if (!Number.isFinite(fromTick) || !Number.isFinite(toTick)) {
      sendJson(res, { entries: [] })
      return
    }
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
    sendJson(res, { entries })
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
}

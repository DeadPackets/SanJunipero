import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import Database from 'better-sqlite3'
import { MINUTES_PER_DAY, tickToMoment, type SimConfig, type SimEvent } from '@sj/shared'
import type { Router } from './server.js'
import type { WorldMirror } from './worldMirror.js'
import { heatWindows, type HeatWindow } from './heatStub.js'
import { makeSeqCache, sendPrebuilt } from './seqCache.js'

export const TALK_WINDOW_TICKS = 20   // two spoke events this close, in earshot → one talk weight
export const TOP_MOMENTS = 5

/**
 * ★ AN AGENT ID IS A SLUG, AND THE ROUTER HANDS IT OVER DECODED.
 *
 * `server.ts` splits the path on `/` and THEN calls `decodeURIComponent` on each segment, so a
 * `%2f` a stranger writes becomes a path separator only after routing has finished. Given a
 * world started with `agentDbDir`, `GET /api/agent/..%2f..%2fsecret/journal` reached
 * `join(agentDbDir, '../../secret.db')` — an arbitrary file on the host, opened as SQLite and
 * read out to the internet whenever it happened to carry a `journal`, `ledgers` or
 * `personality_versions` table.
 *
 * Refusing the SHAPE beats sanitising the path: every id this world mints is a slug, and
 * nothing that is not one has an answer worth giving.
 */
export const AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

/**
 * ★ `?toTick=` DROVE AN UNBOUNDED LOOP, AND IT IS THE STRANGER'S NUMBER.
 *
 * `/api/digest` builds one entry per day between `fromTick` and `toTick` and neither was
 * checked against the world. Measured on a live town: `?toTick=1000000000` answered **4.75 MB**
 * to a 60-byte GET — 694 444 day numbers for a world seven days old, an amplification of about
 * 79 000×. Another three zeroes is the process's memory.
 *
 * Clamping into the world that exists is also the only honest answer: a town at tick 10 000 has
 * nothing to say about tick 10 000 000, so asking for it means asking for today. As a side
 * effect the cache key space collapses — every over-long window is now the same window.
 */
export function clampWindow(from: string | null, to: string | null, liveTick: number): {
  fromTick: number; toTick: number
} {
  const pin = (raw: string | null, fallback: number): number => {
    const n = Number(raw ?? fallback)
    if (!Number.isFinite(n)) return fallback
    return Math.min(Math.max(Math.trunc(n), 0), liveTick)
  }
  const fromTick = pin(from, 0)
  return { fromTick, toTick: Math.max(fromTick, pin(to, liveTick)) }
}

export type DataApiDeps = {
  db: Database.Database
  mirror: WorldMirror
  config: SimConfig
  agentDbDir?: string
}

type LinkKind = 'talk' | 'give' | 'teach' | 'attack'
const VERB_LINKS: ReadonlySet<string> = new Set(['give', 'teach', 'attack'])

const sendJson = (res: ServerResponse, body: unknown, status = 200): void => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}
const notFound = (res: ServerResponse): void => sendJson(res, { error: 'not found' }, 404)

// "-ing" line for the digest: drop a trailing e (give→giving), else append
const gerund = (verb: string): string => (verb.endsWith('e') ? `${verb.slice(0, -1)}ing` : `${verb}ing`)

export function mountDataApi(router: Router, deps: DataApiDeps): void {
  const cache = makeSeqCache(() => deps.mirror.seq())
  const selEventsAfter = deps.db.prepare('SELECT seq, tick, type, payload FROM events WHERE seq > ? ORDER BY seq')

  /**
   * ★ THE RESPONSE CACHE IS NOT ENOUGH ON ITS OWN, BECAUSE `/api/digest` LETS THE STRANGER PICK
   * ITS KEY. `?toTick=` varies freely, so a caller who never repeats a query string misses
   * `seqCache` every time by construction. Measured on a 182 701-event world: eight concurrent
   * cache-missing requests fell to 13/s at a 510 ms median AND stretched the town's own 2500 ms
   * tick to 2923-2991 ms — the world visibly ran slow for every other viewer.
   *
   * The parse is the cost, not the shaping. Memoised per generation it is paid once however
   * many endpoints and however many query strings ask for it, so a deliberate cache miss now
   * buys a filter over an array already in memory instead of a second walk of the log.
   *
   * Callers MUST treat the result as frozen; every one of them filters or folds rather than
   * mutating, and `heatWindows` only reads.
   *
   * ★ AND ONCE PER GENERATION IS STILL O(WORLD AGE), WHICH IS THE CEILING ON A TOWN THAT NEVER
   * RESTARTS. The generation changes EVERY tick, so re-reading the whole table per generation
   * costs the tick thread a full re-parse of all of history, every 2.5 seconds. Measured on
   * this machine at 185 ns and 123 B per event against a real town's payloads: 48 ms/tick at
   * sim-day 10, 250 ms at sim-day 52, 485 ms at sim-day 100. Nobody had ever hit it because
   * nobody could keep a town alive past a few hours — resume is what makes it reachable.
   *
   * The log is append-only, so the fix is to append. The array is retained across generations
   * and only the rows after the highest seq already held are read and parsed: O(events this
   * tick), flat in world age. What remains O(age) is the RESIDENT array, and that is the part
   * this cannot fix from here — see the report.
   */
  type EventRow = { seq: number; tick: number; type: string; payload: string }
  let eventsGen = -1
  let eventsCursor = 0
  const eventsMemo: SimEvent[] = []
  const readEvents = (): readonly SimEvent[] => {
    const gen = deps.mirror.seq()
    if (gen !== eventsGen) {
      eventsGen = gen
      for (const r of selEventsAfter.all(eventsCursor) as EventRow[]) {
        eventsMemo.push({ seq: r.seq, tick: r.tick, type: r.type, payload: JSON.parse(r.payload) } as SimEvent)
        eventsCursor = r.seq
      }
    }
    return eventsMemo
  }

  // agent memory DBs are optional (scripted world) — missing file or table reads as []
  const readAgentRows = <T>(agentId: string, sql: string): T[] => {
    if (!deps.agentDbDir || !AGENT_ID.test(agentId)) return []
    let adb: Database.Database | null = null
    try {
      adb = new Database(join(deps.agentDbDir, `${agentId}.db`), { readonly: true, fileMustExist: true })
      return adb.prepare(sql).all(agentId) as T[]
    } catch {
      return []
    } finally {
      adb?.close()
    }
  }

  router.route('GET', '/api/agent/:id/profile', (_req, res, params) => {
    const id = params.id ?? ''
    // `agents['__proto__']` is truthy and answers a body of nulls; a slug never is.
    const a = AGENT_ID.test(id) ? deps.mirror.state().agents[id] : undefined
    if (!a) { notFound(res); return }
    sendJson(res, {
      id: a.id, name: a.name, alive: a.alive, asleep: a.asleep, x: a.x, y: a.y,
      needs: a.needs, hp: a.hp, injuries: a.injuries, ill: a.ill, ageDays: a.ageDays,
      skills: a.skills, activity: a.activity,
    })
  })

  router.route('GET', '/api/agent/:id/journal', (_req, res, params) => {
    sendJson(res, readAgentRows(params.id ?? '',
      'SELECT tick, day, text FROM journal WHERE agent_id = ? ORDER BY id'))
  })

  router.route('GET', '/api/agent/:id/ledgers', (_req, res, params) => {
    sendJson(res, readAgentRows<{ personId: string; doc: string; updatedDay: number }>(params.id ?? '',
      'SELECT person_id AS personId, doc, updated_day AS updatedDay FROM ledgers WHERE agent_id = ? ORDER BY person_id'))
  })

  router.route('GET', '/api/agent/:id/personality', (_req, res, params) => {
    sendJson(res, readAgentRows(params.id ?? '',
      'SELECT version, day, doc, edit FROM personality_versions WHERE agent_id = ? ORDER BY version'))
  })

  router.route('GET', '/api/structure/:id/provenance', (_req, res, params) => {
    const id = params.id ?? ''
    let planned: { tick: number; kind: string; builderId: string } | null = null
    let completedTick: number | null = null
    for (const ev of readEvents()) {
      if (ev.type === 'structure_planned') {
        const p = ev.payload as { id: string; kind: string; builderId: string }
        if (p.id === id) planned = { tick: ev.tick, kind: p.kind, builderId: p.builderId }
      } else if (ev.type === 'structure_completed' && (ev.payload as { id: string }).id === id) {
        completedTick = ev.tick
      }
    }
    if (!planned) { notFound(res); return }
    sendJson(res, { id, kind: planned.kind, plannedTick: planned.tick, builderId: planned.builderId, completedTick })
  })

  router.route('GET', '/api/society', (_req, res) => sendPrebuilt(res, cache.json('society', () => {
    const state = deps.mirror.state()
    const nodes = Object.values(state.agents)
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map(a => ({ id: a.id, name: a.name, alive: a.alive }))

    const weights = new Map<string, number>() // `${source}\n${target}\n${kind}` → weight
    const bump = (source: string, target: string, kind: LinkKind): void => {
      const key = `${source}\n${target}\n${kind}`
      weights.set(key, (weights.get(key) ?? 0) + 1)
    }

    const earshot = deps.config.movement.earshotRadius
    const spokes: Array<{ agentId: string; tick: number; x: number; y: number }> = []
    const started = new Map<string, Record<string, unknown>>() // `${agentId}\n${verb}` → params
    for (const ev of readEvents()) {
      if (ev.type === 'agent_spoke') {
        const p = ev.payload as { agentId: string; x: number; y: number }
        const cur = { agentId: p.agentId, tick: ev.tick, x: p.x, y: p.y }
        for (const prev of spokes) {
          if (prev.agentId === cur.agentId) continue
          if (cur.tick - prev.tick > TALK_WINDOW_TICKS) continue
          if (Math.hypot(cur.x - prev.x, cur.y - prev.y) > earshot) continue
          const [a, b] = [prev.agentId, cur.agentId].sort() as [string, string]
          bump(a, b, 'talk')
        }
        spokes.push(cur)
      } else if (ev.type === 'action_started') {
        const p = ev.payload as { agentId: string; verb: string; params: Record<string, unknown> }
        if (VERB_LINKS.has(p.verb)) started.set(`${p.agentId}\n${p.verb}`, p.params)
      } else if (ev.type === 'action_completed') {
        const p = ev.payload as { agentId: string; verb: string }
        if (!VERB_LINKS.has(p.verb)) continue
        const params = started.get(`${p.agentId}\n${p.verb}`)
        const targetId = params?.targetId
        if (typeof targetId === 'string') bump(p.agentId, targetId, p.verb as LinkKind)
      }
    }

    const links = [...weights.entries()]
      .map(([key, weight]) => {
        const [source, target, kind] = key.split('\n') as [string, string, LinkKind]
        return { source, target, kind, weight }
      })
      .sort((a, b) => b.weight - a.weight
        || a.source.localeCompare(b.source) || a.target.localeCompare(b.target) || a.kind.localeCompare(b.kind))
    return { nodes, links }
  })))

  // /api/chapters moved to narratorApi.ts, where it reads C7's real chapters instead of [].

  router.route('GET', '/api/heat', (_req, res) =>
    sendPrebuilt(res, cache.json('heat', () => heatWindows(readEvents()))))

  router.route('GET', '/api/digest', (req: IncomingMessage, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    sendPrebuilt(res, cache.json(`digest${url.search}`, () => {
      const { fromTick, toTick } = clampWindow(
        url.searchParams.get('fromTick'), url.searchParams.get('toTick'), deps.mirror.state().tick)
      const events = readEvents().filter(ev => ev.tick >= fromTick && ev.tick <= toTick)

      const days: number[] = []
      for (let d = Math.floor(fromTick / MINUTES_PER_DAY); d <= Math.floor(toTick / MINUTES_PER_DAY); d++) days.push(d)

      const deaths = events.filter(ev => ev.type === 'agent_died').map(ev => {
        const p = ev.payload as { agentId: string; cause: string }
        return { agentId: p.agentId, tick: ev.tick, cause: p.cause }
      })

      const state = deps.mirror.state()
      const structuresCompleted = events.filter(ev => ev.type === 'structure_completed').map(ev => {
        const id = (ev.payload as { id: string }).id
        return { id, kind: state.structures[id]?.kind ?? 'structure', tick: ev.tick }
      })

      const topMoments = heatWindows(events)
        .sort((a: HeatWindow, b: HeatWindow) => b.score - a.score
          || a.fromTick - b.fromTick || a.agentId.localeCompare(b.agentId))
        .slice(0, TOP_MOMENTS)
        .map(w => ({ tick: w.fromTick, agentId: w.agentId, score: w.score, moment: tickToMoment(w.fromTick) }))

      const agentLines = Object.values(state.agents)
        .filter(a => a.alive)
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map(a => ({
          agentId: a.id,
          line: `${a.name} was last seen ${a.activity ? gerund(a.activity.verb) : 'resting'}`,
        }))

      return { days, deaths, births: [], structuresCompleted, topMoments, agentLines }
    }))
  })
}

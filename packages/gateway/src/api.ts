import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import Database from 'better-sqlite3'
import { MINUTES_PER_DAY, tickToMoment, type SimConfig, type SimEvent } from '@sj/shared'
import type { Router } from './server.js'
import type { WorldMirror } from './worldMirror.js'
import {
  HEAT_WINDOW_TICKS, heatContext, heatFromScores, heatSince, scoreEvent,
  type HeatScores, type HeatWindow,
} from './heatStub.js'
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
  /** Testing seam only: how many records the read path is holding right now. See `readFold`. */
  onFootprint?: (f: () => Footprint) => void
}

/** What the read path keeps once an event has been folded. Every field is a count of ANSWERS —
 *  links, drama windows, deaths, buildings — and none of them is a count of events. */
export type Footprint = {
  provenance: number; heat: number; links: number; spokes: number
  started: number; deaths: number; completions: number
  /** The highest seq folded. Present so a guard can prove the fold really consumed the log. */
  seq: number
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
   * An earlier lane fixed the CPU by memoising the parsed log and appending to it per
   * generation. That made the reads 338× faster and left a `SimEvent[]` that never shrinks.
   *
   * ★ AND A RETAINED LOG IS A LEAK WITH A VIEWER ATTACHED. Measured on this machine against a
   * real founders town, over `/api/society` — the first endpoint to touch the array:
   *
   *   |  events | retained |
   *   |---:|---:|
   *   |  49 649 |  7.2 MB |
   *   | 139 337 | 20.3 MB |
   *   | 183 622 | 28.7 MB |
   *   | 255 809 | 52.8 MB |
   *   | 346 069 | 86.9 MB |
   *
   * Strictly linear in EVENTS, with no ceiling of any kind — 151 B/event early and 396 B/event
   * marginal once `fauna_moved` (640 B payloads) dominates. Days are not the axis: this town
   * goes quiet on day 3, and one that stays as busy as its own founding days (34.5 events/tick)
   * passes 387 MB at sim-day 31 and 750 MB at day 100. A stream is watched for weeks.
   *
   * ★ SO THE LOG IS NOT KEPT. Every event is folded ONCE, into the aggregates the four routes
   * below actually answer from, and then dropped. What is retained is a count of ANSWERS —
   * one entry per talking pair, per 60-tick drama window, per death, per building — never a
   * count of events. `footprint()` is that in numbers, and `apiFootprint.test.ts` ticks a world
   * four times deeper and holds it to a ceiling.
   */
  type EventRow = { seq: number; tick: number; type: string; payload: string }
  type Planned = { kind: string; builderId: string; plannedTick: number }
  type Spoke = { agentId: string; tick: number; x: number; y: number }

  const planned = new Map<string, Planned>()
  const completedTick = new Map<string, number>()
  const heat: HeatScores = new Map()
  const weights = new Map<string, number>()        // `${source}\n${target}\n${kind}` → weight
  const deaths: Array<{ agentId: string; tick: number; cause: string }> = []
  const completions: Array<{ id: string; tick: number }> = []
  // Bounded by construction: a spoke older than the talk window can never pair with a new one,
  // and the started map is keyed by agent and verb, so it is the size of the cast times three.
  let spokes: Spoke[] = []
  const started = new Map<string, Record<string, unknown>>()

  const earshot = deps.config.movement.earshotRadius
  const bump = (source: string, target: string, kind: LinkKind): void => {
    const key = `${source}\n${target}\n${kind}`
    weights.set(key, (weights.get(key) ?? 0) + 1)
  }

  // The drama scorer's one piece of world knowledge, and the read path already keeps it: a fire
  // at a place is scored to the person who raised the place. See `heatStub.dramatis`.
  const builderOf = (id: string): string | null => planned.get(id)?.builderId ?? null
  const heatCtx = heatContext(builderOf)

  const foldOne = (ev: SimEvent): void => {
    scoreEvent(heat, ev, heatCtx)
    switch (ev.type) {
      case 'agent_spoke': {
        const p = ev.payload as { agentId: string; x: number; y: number }
        // The old scan compared against every earlier spoke and skipped the stale ones; dropping
        // them instead is the same answer and turns an O(spokes²) walk into a bounded one.
        if (spokes.length > 0 && spokes[0]!.tick < ev.tick - TALK_WINDOW_TICKS) {
          spokes = spokes.filter((s) => ev.tick - s.tick <= TALK_WINDOW_TICKS)
        }
        for (const prev of spokes) {
          if (prev.agentId === p.agentId) continue
          if (Math.hypot(p.x - prev.x, p.y - prev.y) > earshot) continue
          const [a, b] = [prev.agentId, p.agentId].sort() as [string, string]
          bump(a, b, 'talk')
        }
        spokes.push({ agentId: p.agentId, tick: ev.tick, x: p.x, y: p.y })
        return
      }
      case 'action_started': {
        const p = ev.payload as { agentId: string; verb: string; params: Record<string, unknown> }
        if (VERB_LINKS.has(p.verb)) started.set(`${p.agentId}\n${p.verb}`, p.params)
        return
      }
      case 'action_completed': {
        const p = ev.payload as { agentId: string; verb: string }
        if (!VERB_LINKS.has(p.verb)) return
        const targetId = started.get(`${p.agentId}\n${p.verb}`)?.targetId
        if (typeof targetId === 'string') bump(p.agentId, targetId, p.verb as LinkKind)
        return
      }
      case 'structure_planned': {
        const p = ev.payload as { id: string; kind: string; builderId: string }
        // Last plan wins and last completion wins, in two maps, because that is what the old
        // linear scan did — it tracked the two facts independently and in either order.
        planned.set(p.id, { kind: p.kind, builderId: p.builderId, plannedTick: ev.tick })
        return
      }
      case 'structure_completed': {
        const id = (ev.payload as { id: string }).id
        completedTick.set(id, ev.tick)
        completions.push({ id, tick: ev.tick })
        return
      }
      case 'agent_died': {
        const p = ev.payload as { agentId: string; cause: string }
        deaths.push({ agentId: p.agentId, tick: ev.tick, cause: p.cause })
        return
      }
      default:
    }
  }

  let foldGen = -1
  let foldCursor = 0
  const readFold = (): void => {
    const gen = deps.mirror.seq()
    if (gen === foldGen) return
    foldGen = gen
    for (const r of selEventsAfter.all(foldCursor) as EventRow[]) {
      foldOne({ seq: r.seq, tick: r.tick, type: r.type, payload: JSON.parse(r.payload) } as SimEvent)
      foldCursor = r.seq
    }
  }
  deps.onFootprint?.(() => ({
    provenance: planned.size + completedTick.size, heat: heat.size, links: weights.size,
    spokes: spokes.length, started: started.size, deaths: deaths.length,
    completions: completions.length, seq: foldCursor,
  }))

  /**
   * ★ HEAT OVER A WINDOW THE VIEWER PICKED, WITHOUT KEEPING THE LOG.
   *
   * `/api/digest` is "what did I miss" — `fromTick = tick − missedTicks` — so its ends land
   * anywhere, and a 60-tick drama window the range only half covers must score only the half.
   * Rounding to whole windows would report drama from before the viewer left.
   *
   * Whole windows come from the running map. The at most TWO windows the range cuts are
   * re-scored from the log, which is at most 120 ticks and hits `idx_events_tick` — bounded
   * however old the town is.
   */
  const selRange = deps.db.prepare(
    'SELECT seq, tick, type, payload FROM events WHERE tick BETWEEN ? AND ? ORDER BY seq')
  const heatOver = (fromTick: number, toTick: number): HeatWindow[] => {
    const lo = Math.floor(fromTick / HEAT_WINDOW_TICKS)
    const hi = Math.floor(toTick / HEAT_WINDOW_TICKS)
    const loWhole = fromTick % HEAT_WINDOW_TICKS === 0 ? lo : lo + 1
    const hiWhole = toTick % HEAT_WINDOW_TICKS === HEAT_WINDOW_TICKS - 1 ? hi : hi - 1
    const scores: HeatScores = new Map()
    // A fresh actor memory per re-read; a verb's completion and its results share a tick, so a
    // tick range never splits the pair and the re-scored window is exact.
    const ctx = heatContext(builderOf)
    for (const [key, score] of heat) {
      const w = Number(key.slice(0, key.indexOf('\n')))
      if (w >= loWhole && w <= hiWhole) scores.set(key, score)
    }
    for (const w of new Set([lo, hi])) {
      if (w >= loWhole && w <= hiWhole) continue
      const from = Math.max(fromTick, w * HEAT_WINDOW_TICKS)
      const to = Math.min(toTick, (w + 1) * HEAT_WINDOW_TICKS - 1)
      if (from > to) continue
      for (const r of selRange.all(from, to) as EventRow[]) {
        scoreEvent(scores, { seq: r.seq, tick: r.tick, type: r.type, payload: JSON.parse(r.payload) } as SimEvent, ctx)
      }
    }
    return heatFromScores(scores)
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

  // ★ AND THIS ONE WAS NOT BEHIND THE CACHE AT ALL. It walked the whole memo per request with
  // the id chosen by the caller, so a stranger in a loop bought a full history scan every time.
  // A map keyed by the id makes it the O(1) lookup it always described itself as.
  router.route('GET', '/api/structure/:id/provenance', (_req, res, params) => {
    readFold()
    const id = params.id ?? ''
    const plan = planned.get(id)
    if (!plan) { notFound(res); return }
    sendJson(res, {
      id, kind: plan.kind, plannedTick: plan.plannedTick, builderId: plan.builderId,
      completedTick: completedTick.get(id) ?? null,
    })
  })

  router.route('GET', '/api/society', (_req, res) => {
    readFold()
    sendPrebuilt(res, cache.json('society', () => {
      const nodes = Object.values(deps.mirror.state().agents)
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map(a => ({ id: a.id, name: a.name, alive: a.alive }))
      const links = [...weights.entries()]
        .map(([key, weight]) => {
          const [source, target, kind] = key.split('\n') as [string, string, LinkKind]
          return { source, target, kind, weight }
        })
        .sort((a, b) => b.weight - a.weight
          || a.source.localeCompare(b.source) || a.target.localeCompare(b.target) || a.kind.localeCompare(b.kind))
      return { nodes, links }
    }))
  })

  // /api/chapters moved to narratorApi.ts, where it reads C7's real chapters instead of [].

  /**
   * ★ THE HORIZON IS THE CEILING — see `HEAT_HORIZON_TICKS`.
   *
   * The running map stays whole, because `/api/digest` answers "what did I miss" over a window
   * the viewer picks and must be exact however far back it reaches. What is SENT is the last
   * sim-day of it, which is a body bounded by the population rather than by the town's age, and
   * twelve times more than `pickCut` looks at.
   */
  router.route('GET', '/api/heat', (_req, res) => {
    readFold()
    sendPrebuilt(res, cache.json('heat', () =>
      heatSince(heatFromScores(heat), deps.mirror.state().tick)))
  })

  router.route('GET', '/api/digest', (req: IncomingMessage, res) => {
    readFold()
    const url = new URL(req.url ?? '/', 'http://localhost')
    sendPrebuilt(res, cache.json(`digest${url.search}`, () => {
      const { fromTick, toTick } = clampWindow(
        url.searchParams.get('fromTick'), url.searchParams.get('toTick'), deps.mirror.state().tick)
      const inWindow = (t: number): boolean => t >= fromTick && t <= toTick

      const days: number[] = []
      for (let d = Math.floor(fromTick / MINUTES_PER_DAY); d <= Math.floor(toTick / MINUTES_PER_DAY); d++) days.push(d)

      const state = deps.mirror.state()
      const structuresCompleted = completions.filter(c => inWindow(c.tick)).map(c => ({
        id: c.id, kind: state.structures[c.id]?.kind ?? 'structure', tick: c.tick,
      }))

      const topMoments = heatOver(fromTick, toTick)
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

      return {
        days, deaths: deaths.filter(d => inWindow(d.tick)), births: [],
        structuresCompleted, topMoments, agentLines,
      }
    }))
  })
}

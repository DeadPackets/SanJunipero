import { join } from 'node:path'
import type { IncomingMessage } from 'node:http'
import Database from 'better-sqlite3'
import { MINUTES_PER_DAY, tickToMoment, type SimConfig, type SimEvent } from '@sj/shared'
import type { Router } from './server.js'
import type { WorldMirror } from './worldMirror.js'
import {
  HEAT_HORIZON_TICKS,
  HEAT_WINDOW_TICKS,
  heatContext,
  heatFromScores,
  heatSince,
  scoreEvent,
  type HeatScores,
  type HeatWindow,
} from './heat.js'
import { makeSeqCache, sendPrebuilt } from './seqCache.js'
import { notFound, sendJson, toEvent, type EventRow } from './http.js'

export const TALK_WINDOW_TICKS = 20 // two spoke events this close, in earshot → one talk weight
const TOP_MOMENTS = 5

/**
 * `server.ts` decodes each path segment AFTER splitting on `/`, so a `%2f` a stranger writes
 * becomes a path separator only once routing has finished. Refusing the SHAPE — every id this
 * world mints is a slug — beats sanitising the path.
 */
export const AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

/** The only rows the fold below reads: `foldOne`'s six cases and `HEAT_WEIGHTS`' nine keys.
 *  0.5% of a real log — `need_changed` alone is 56% of it — and `idx_events_type` serves the
 *  filter. `heat.ts` reads the seq gaps this leaves as the events they were. */
export const FOLD_TYPES: readonly string[] = [
  'action_completed',
  'action_started',
  'agent_collapsed',
  'agent_died',
  'agent_injured',
  'agent_spoke',
  'crop_harvested',
  'fire_ignited',
  'fire_spread',
  'item_moved',
  'structure_completed',
  'structure_planned',
]

/**
 * `/api/digest` builds one entry per day between the two ticks, and both are the stranger's
 * number: unclamped, `?toTick=1000000000` answers 4.75 MB to a 60-byte GET. Clamping into the
 * world that exists also collapses the cache key space — every over-long window is one window.
 */
export function clampWindow(
  from: string | null,
  to: string | null,
  liveTick: number,
): {
  fromTick: number
  toTick: number
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
  agentDbDir?: string | undefined
  /** Testing seam only: how many records the read path is holding right now. See `readFold`. */
  onFootprint?: (f: () => Footprint) => void
}

/** What the read path keeps once an event has been folded. Every field is a count of ANSWERS —
 *  links, drama windows, deaths, buildings — and none of them is a count of events. */
export type Footprint = {
  provenance: number
  heat: number
  links: number
  spokes: number
  started: number
  deaths: number
  /** The log head the fold has caught up to — NOT the SELECT's cursor, which stops at the last
   *  row of a type `FOLD_TYPES` names. Present so a guard can prove the fold consumed the log. */
  seq: number
}

type LinkKind = 'talk' | 'give' | 'teach' | 'attack'
const VERB_LINKS: ReadonlySet<string> = new Set(['give', 'teach', 'attack'])

// "-ing" line for the digest: drop a trailing e (give→giving), else append
const gerund = (verb: string): string =>
  verb.endsWith('e') ? `${verb.slice(0, -1)}ing` : `${verb}ing`

export function mountDataApi(router: Router, deps: DataApiDeps): void {
  const cache = makeSeqCache(() => deps.mirror.seq())
  const selEventsAfter = deps.db.prepare(
    `SELECT seq, tick, type, payload FROM events
     WHERE seq > ? AND type IN (${FOLD_TYPES.map(() => '?').join(', ')}) ORDER BY seq`,
  )

  /**
   * The event log is never retained — every event is folded ONCE into the aggregates below,
   * because a kept log grows strictly linearly with events (151 B/event early, 396 B/event
   * marginal; 28.7 MB at 183k events, no ceiling) and a stream is watched for weeks.
   * `?toTick=` is caller-chosen, so `seqCache` misses by construction on a caller who never
   * repeats a query string.
   */
  type Planned = { kind: string; builderId: string; plannedTick: number }
  type Spoke = { agentId: string; tick: number; x: number; y: number }

  const planned = new Map<string, Planned>()
  const completedTick = new Map<string, number>()
  const heat: HeatScores = new Map()
  const weights = new Map<string, number>() // `${source}\n${target}\n${kind}` → weight
  const deaths: { agentId: string; tick: number; cause: string }[] = []
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
  // at a place is scored to the person who raised the place. See `heat.dramatis`.
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
        completedTick.set((ev.payload as { id: string }).id, ev.tick)
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
    // `.iterate`, not `.all`: on a resumed town foldCursor is 0, and the rows and their parsed
    // payloads would both be fully materialised before a single event is folded.
    for (const r of selEventsAfter.iterate(foldCursor, ...FOLD_TYPES) as Iterable<EventRow>) {
      foldOne(toEvent(r))
      foldCursor = r.seq
    }
  }
  // On a resumed town this is the whole log, and it runs on the boot thread rather than on the
  // first stranger's GET — which would be the thread that ticks the town.
  readFold()
  deps.onFootprint?.(() => ({
    provenance: planned.size + completedTick.size,
    heat: heat.size,
    links: weights.size,
    spokes: spokes.length,
    started: started.size,
    deaths: deaths.length,
    seq: foldGen,
  }))

  /**
   * Whole windows come from the running map; the at most TWO windows a viewer-picked range cuts
   * are re-scored from the log — at most 120 ticks, bounded however old the town is.
   */
  const selRange = deps.db.prepare(
    'SELECT seq, tick, type, payload FROM events WHERE tick BETWEEN ? AND ? ORDER BY seq',
  )
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
        scoreEvent(scores, toEvent(r), ctx)
      }
    }
    return heatFromScores(scores)
  }

  // agent memory DBs are optional (scripted world) — missing file or table reads as []
  const readAgentRows = <T>(agentId: string, sql: string): T[] => {
    if (!deps.agentDbDir || !AGENT_ID.test(agentId)) return []
    let adb: Database.Database | null = null
    try {
      adb = new Database(join(deps.agentDbDir, `${agentId}.db`), {
        readonly: true,
        fileMustExist: true,
      })
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
    if (!a) {
      notFound(res)
      return
    }
    sendJson(res, {
      id: a.id,
      name: a.name,
      alive: a.alive,
      asleep: a.asleep,
      x: a.x,
      y: a.y,
      needs: a.needs,
      hp: a.hp,
      injuries: a.injuries,
      ill: a.ill,
      ageDays: a.ageDays,
      skills: a.skills,
      activity: a.activity,
    })
  })

  router.route('GET', '/api/agent/:id/journal', (_req, res, params) => {
    sendJson(
      res,
      readAgentRows(
        params.id ?? '',
        'SELECT tick, day, text FROM journal WHERE agent_id = ? ORDER BY id',
      ),
    )
  })

  router.route('GET', '/api/agent/:id/ledgers', (_req, res, params) => {
    sendJson(
      res,
      readAgentRows<{ personId: string; doc: string; updatedDay: number }>(
        params.id ?? '',
        'SELECT person_id AS personId, doc, updated_day AS updatedDay FROM ledgers WHERE agent_id = ? ORDER BY person_id',
      ),
    )
  })

  router.route('GET', '/api/agent/:id/personality', (_req, res, params) => {
    sendJson(
      res,
      readAgentRows(
        params.id ?? '',
        'SELECT version, day, doc, edit FROM personality_versions WHERE agent_id = ? ORDER BY version',
      ),
    )
  })

  // The id is the caller's to choose, so this must stay an O(1) map lookup — a scan per request
  // is a full history walk a stranger can loop.
  router.route('GET', '/api/structure/:id/provenance', (_req, res, params) => {
    readFold()
    const id = params.id ?? ''
    const plan = planned.get(id)
    if (!plan) {
      notFound(res)
      return
    }
    sendJson(res, {
      id,
      kind: plan.kind,
      plannedTick: plan.plannedTick,
      builderId: plan.builderId,
      completedTick: completedTick.get(id) ?? null,
    })
  })

  router.route('GET', '/api/society', (_req, res) => {
    readFold()
    sendPrebuilt(
      res,
      cache.json('society', () => {
        const nodes = Object.values(deps.mirror.state().agents)
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .map((a) => ({ id: a.id, name: a.name, alive: a.alive }))
        const links = [...weights.entries()]
          .map(([key, weight]) => {
            const [source, target, kind] = key.split('\n') as [string, string, LinkKind]
            return { source, target, kind, weight }
          })
          .sort(
            (a, b) =>
              b.weight - a.weight ||
              a.source.localeCompare(b.source) ||
              a.target.localeCompare(b.target) ||
              a.kind.localeCompare(b.kind),
          )
        return { nodes, links }
      }),
    )
  })

  // /api/chapters moved to narratorApi.ts, where it reads C7's real chapters instead of [].

  /**
   * The running map stays whole — `/api/digest` must be exact however far back the viewer
   * reaches — but what is SENT is the last sim-day, bounded by population not by the town's age.
   */
  router.route('GET', '/api/heat', (_req, res) => {
    readFold()
    sendPrebuilt(
      res,
      cache.json('heat', () => {
        const nowTick = deps.mirror.state().tick
        // The windows `heatSince` would keep, picked out before they are built and sorted: it keeps
        // `60w + 59 >= nowTick − HORIZON`, which is exactly `w >= floor((nowTick − HORIZON) / 60)`.
        const floorW = Math.floor((nowTick - HEAT_HORIZON_TICKS) / HEAT_WINDOW_TICKS)
        const recent: HeatScores = new Map()
        for (const [key, score] of heat) {
          if (Number(key.slice(0, key.indexOf('\n'))) >= floorW) recent.set(key, score)
        }
        return heatSince(heatFromScores(recent), nowTick)
      }),
    )
  })

  router.route('GET', '/api/digest', (req: IncomingMessage, res) => {
    readFold()
    const url = new URL(req.url ?? '/', 'http://localhost')
    const { fromTick, toTick } = clampWindow(
      url.searchParams.get('fromTick'),
      url.searchParams.get('toTick'),
      deps.mirror.state().tick,
    )
    sendPrebuilt(
      res,
      cache.json(`digest:${fromTick}:${toTick}`, () => {
        const inWindow = (t: number): boolean => t >= fromTick && t <= toTick

        const days: number[] = []
        for (
          let d = Math.floor(fromTick / MINUTES_PER_DAY);
          d <= Math.floor(toTick / MINUTES_PER_DAY);
          d++
        )
          days.push(d)

        const state = deps.mirror.state()
        const structuresCompleted = [...completedTick]
          .filter(([, tick]) => inWindow(tick))
          .map(([id, tick]) => ({
            id,
            kind: state.structures[id]?.kind ?? 'structure',
            tick,
          }))

        const topMoments = heatOver(fromTick, toTick)
          .sort(
            (a: HeatWindow, b: HeatWindow) =>
              b.score - a.score || a.fromTick - b.fromTick || a.agentId.localeCompare(b.agentId),
          )
          .slice(0, TOP_MOMENTS)
          .map((w) => ({
            tick: w.fromTick,
            agentId: w.agentId,
            score: w.score,
            moment: tickToMoment(w.fromTick),
          }))

        const agentLines = Object.values(state.agents)
          .filter((a) => a.alive)
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .map((a) => ({
            agentId: a.id,
            line: `${a.name} was last seen ${a.activity ? gerund(a.activity.verb) : 'resting'}`,
          }))

        return {
          days,
          deaths: deaths.filter((d) => inWindow(d.tick)),
          births: [],
          structuresCompleted,
          topMoments,
          agentLines,
        }
      }),
    )
  })
}

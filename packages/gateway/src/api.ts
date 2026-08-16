import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import Database from 'better-sqlite3'
import { MINUTES_PER_DAY, tickToMoment, type SimConfig, type SimEvent } from '@sj/shared'
import type { Router } from './server.js'
import type { WorldMirror } from './worldMirror.js'
import { heatWindows, type HeatWindow } from './heatStub.js'

export const TALK_WINDOW_TICKS = 20   // two spoke events this close, in earshot → one talk weight
export const TOP_MOMENTS = 5

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
  const selEvents = deps.db.prepare('SELECT seq, tick, type, payload FROM events ORDER BY seq')
  const readEvents = (): SimEvent[] =>
    (selEvents.all() as Array<{ seq: number; tick: number; type: string; payload: string }>)
      .map(r => ({ seq: r.seq, tick: r.tick, type: r.type, payload: JSON.parse(r.payload) }) as SimEvent)

  // agent memory DBs are optional (scripted world) — missing file or table reads as []
  const readAgentRows = <T>(agentId: string, sql: string): T[] => {
    if (!deps.agentDbDir) return []
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
    const a = deps.mirror.state().agents[params.id ?? '']
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

  router.route('GET', '/api/society', (_req, res) => {
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
    sendJson(res, { nodes, links })
  })

  // /api/chapters moved to narratorApi.ts, where it reads C7's real chapters instead of [].

  router.route('GET', '/api/heat', (_req, res) => sendJson(res, heatWindows(readEvents())))

  router.route('GET', '/api/digest', (req: IncomingMessage, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const liveTick = deps.mirror.state().tick
    const fromTick = Number(url.searchParams.get('fromTick') ?? 0)
    const toTick = Number(url.searchParams.get('toTick') ?? liveTick)
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

    sendJson(res, { days, deaths, births: [], structuresCompleted, topMoments, agentLines })
  })
}

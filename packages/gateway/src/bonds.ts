import type { ServerResponse } from 'node:http'
import type Database from 'better-sqlite3'
import {
  BOND_NOTES, bondId, strongerBondKind,
  type Bond, type BondEvent, type BondKind, type BondsResponse, type SimConfig, type SimEvent,
} from '@sj/shared'
import type { Router } from './server.js'
import type { WorldMirror } from './worldMirror.js'
import { TALK_WINDOW_TICKS } from './api.js'

// What the town did, read as what the town became. Each rule is one observable act; the
// SEMANTICS (trust, debt, grudge, love from the ledgers) stay C9 T11/T12's job — when they
// land this reader swaps and BondSchema does not move. `BOND_NOTES` moved to `@sj/shared` so
// the viewer can name the six acts without reading the server — see the Bonds empty state.
export { BOND_NOTES } from '@sj/shared'

const VERB_BONDS: Readonly<Record<string, BondKind>> = { give: 'owe', teach: 'work', attack: 'rival' }

export type BondsDeps = {
  db: Database.Database
  mirror: WorldMirror
  config: SimConfig
}

const sendJson = (res: ServerResponse, body: unknown, status = 200): void => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

type Draft = { aId: string; bId: string; kind: BondKind; history: BondEvent[] }

export function buildBonds(events: SimEvent[], earshot: number, asOfTick: number): BondsResponse {
  const drafts = new Map<string, Draft>()

  const tie = (a: string, b: string, kind: BondKind, tick: number, note: string): void => {
    if (a === b) return
    const id = bondId(a, b)
    const [aId, bId] = [a, b].sort() as [string, string]
    const draft = drafts.get(id) ?? { aId, bId, kind, history: [] }
    draft.kind = strongerBondKind(draft.kind, kind)
    draft.history.push({ tick, kind, note })
    drafts.set(id, draft)
  }

  const spokes: Array<{ agentId: string; tick: number; x: number; y: number }> = []
  const started = new Map<string, Record<string, unknown>>() // `${agentId}\n${verb}` → params

  for (const ev of events) {
    if (ev.type === 'agent_spoke') {
      const p = ev.payload as { agentId: string; x: number; y: number }
      for (const prev of spokes) {
        if (prev.agentId === p.agentId) continue
        if (ev.tick - prev.tick > TALK_WINDOW_TICKS) continue
        if (Math.hypot(p.x - prev.x, p.y - prev.y) > earshot) continue
        tie(prev.agentId, p.agentId, 'friend', ev.tick, BOND_NOTES.spoke!)
      }
      spokes.push({ agentId: p.agentId, tick: ev.tick, x: p.x, y: p.y })
    } else if (ev.type === 'action_started') {
      const p = ev.payload as { agentId: string; verb: string; params: Record<string, unknown> }
      if (VERB_BONDS[p.verb] !== undefined) started.set(`${p.agentId}\n${p.verb}`, p.params)
    } else if (ev.type === 'action_completed') {
      const p = ev.payload as { agentId: string; verb: string }
      const kind = VERB_BONDS[p.verb]
      if (kind === undefined) continue
      const targetId = started.get(`${p.agentId}\n${p.verb}`)?.targetId
      if (typeof targetId === 'string') tie(p.agentId, targetId, kind, ev.tick, BOND_NOTES[p.verb]!)
    } else if (ev.type === 'co_slept') {
      const p = ev.payload as { aId: string; bId: string }
      tie(p.aId, p.bId, 'partner', ev.tick, BOND_NOTES.co_slept!)
    } else if (ev.type === 'agent_born') {
      const p = ev.payload as { id: string; motherId: string; fatherId: string }
      for (const parent of [p.motherId, p.fatherId]) tie(parent, p.id, 'kin', ev.tick, BOND_NOTES.born!)
    }
  }

  const bonds: Bond[] = [...drafts.entries()]
    .map(([id, d]): Bond => ({
      id, aId: d.aId, bId: d.bId, kind: d.kind,
      strength: d.history.length,
      formedTick: d.history[0]!.tick,
      lastUpdatedTick: d.history[d.history.length - 1]!.tick,
      history: d.history,
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
  return { bonds, asOfTick }
}

export function mountBondsApi(router: Router, deps: BondsDeps): void {
  const selEvents = deps.db.prepare('SELECT seq, tick, type, payload FROM events ORDER BY seq')

  router.route('GET', '/api/bonds', (_req, res) => {
    const events = (selEvents.all() as Array<{ seq: number; tick: number; type: string; payload: string }>)
      .map((r) => ({ seq: r.seq, tick: r.tick, type: r.type, payload: JSON.parse(r.payload) }) as SimEvent)
    sendJson(res, buildBonds(events, deps.config.movement.earshotRadius, deps.mirror.state().tick))
  })
}

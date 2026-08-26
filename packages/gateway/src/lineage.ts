import type Database from 'better-sqlite3'
import type { SimEvent } from '@sj/shared'
import type { Router } from './server.js'
import type { WorldMirror } from './worldMirror.js'
import { makeSeqCache, sendPrebuilt } from './seqCache.js'
import { toEvent, type EventRow } from './http.js'

type LineagePerson = { id: string; name: string; alive: boolean }
export type ParentEdge = { parentId: string; childId: string; tick: number }
export type Household = { structureId: string; memberIds: string[] }
export type LineageResponse = {
  people: LineagePerson[]
  parentOf: ParentEdge[]
  households: Household[]
}

/** A childless world is a typed empty, never a 500 and never a null. */
export const EMPTY_LINEAGE: LineageResponse = { people: [], parentOf: [], households: [] }

type BornPayload = { id: string; motherId?: string; fatherId?: string }

/** Pure: the parent edges the log records, in the order it recorded them. Both parents of one
 *  birth are two edges, because a child with one known parent must still appear. */
export function parentEdges(events: readonly SimEvent[]): ParentEdge[] {
  const out: ParentEdge[] = []
  const seen = new Set<string>()
  for (const ev of events) {
    if (ev.type !== 'agent_born') continue
    const p = ev.payload as BornPayload
    if (typeof p.id !== 'string' || p.id === '') continue
    for (const parentId of [p.motherId, p.fatherId]) {
      if (typeof parentId !== 'string' || parentId === '' || parentId === p.id) continue
      const key = `${parentId}\n${p.id}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ parentId, childId: p.id, tick: ev.tick })
    }
  }
  return out
}

/** Who sleeps under which roof, right now. `insideId` is the only record of it the world keeps,
 *  so this is a snapshot and says so — a household is a fact about tonight, not a claim of kin. */
export function householdsOf(
  agents: Readonly<Record<string, { id: string; insideId?: string }>>,
): Household[] {
  const by = new Map<string, string[]>()
  for (const a of Object.values(agents).sort((x, y) => (x.id < y.id ? -1 : 1))) {
    if (a.insideId === undefined) continue
    const list = by.get(a.insideId) ?? []
    list.push(a.id)
    by.set(a.insideId, list)
  }
  return [...by.entries()]
    .sort((x, y) => (x[0] < y[0] ? -1 : 1))
    .map(([structureId, memberIds]) => ({ structureId, memberIds }))
}

export function buildLineage(
  events: readonly SimEvent[],
  agents: Readonly<Record<string, { id: string; name: string; alive: boolean; insideId?: string }>>,
): LineageResponse {
  const people = Object.values(agents)
    .map((a): LineagePerson => ({ id: a.id, name: a.name, alive: a.alive }))
    .sort((x, y) => (x.id < y.id ? -1 : 1))
  return { people, parentOf: parentEdges(events), households: householdsOf(agents) }
}

export type LineageDeps = { db: Database.Database; mirror: WorldMirror }

export function mountLineageApi(router: Router, deps: LineageDeps): void {
  const selBirths = deps.db.prepare(
    "SELECT seq, tick, type, payload FROM events WHERE type = 'agent_born' ORDER BY seq",
  )
  const cache = makeSeqCache(() => deps.mirror.seq())
  router.route('GET', '/api/lineage', (_req, res) => {
    sendPrebuilt(
      res,
      cache.json('lineage', () => {
        try {
          const events = (selBirths.all() as EventRow[]).map(toEvent)
          return buildLineage(events, deps.mirror.state().agents)
        } catch {
          return EMPTY_LINEAGE // a town with no ancestry is not an error
        }
      }),
    )
  })
}

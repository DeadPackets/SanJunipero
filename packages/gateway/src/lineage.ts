import type Database from 'better-sqlite3'
import { personAt, type SimEvent } from '@sj/shared'
import type { Router } from './router.js'
import type { WorldMirror } from './worldMirror.js'
import { makeSeqCache, sendPrebuilt } from './seqCache.js'
import { toEvent, type EventRow } from './http.js'

type LineagePerson = { id: string; name: string; alive: boolean }
export type ParentEdge = { parentId: string; childId: string; tick: number }
/** Two people the world holds as partners right now, the lower id first. */
export type PartnerEdge = { aId: string; bId: string }
export type Household = { structureId: string; memberIds: string[] }
export type LineageResponse = {
  people: LineagePerson[]
  parentOf: ParentEdge[]
  partnerOf: PartnerEdge[]
  households: Household[]
}

/** A childless world is a typed empty, never a 500 and never a null. */
export const EMPTY_LINEAGE: LineageResponse = {
  people: [],
  parentOf: [],
  partnerOf: [],
  households: [],
}

type BornPayload = { id: string; motherId?: string; fatherId?: string }
type SpawnedPayload = { id: string; parents?: unknown }

/** Pure: the parent edges the log records, in the order it recorded them. Both parents of one
 *  birth are two edges, because a child with one known parent must still appear. */
export function parentEdges(events: readonly SimEvent[]): ParentEdge[] {
  const out: ParentEdge[] = []
  const seen = new Set<string>()
  for (const ev of events) {
    // A body born here names its two; a body the valley was founded with names whoever its card
    // knew, which may be one. Without this a founding child has no family anybody can draw.
    if (ev.type !== 'agent_born' && ev.type !== 'agent_spawned') continue
    const p = ev.payload as BornPayload & SpawnedPayload
    if (typeof p.id !== 'string' || p.id === '') continue
    const named =
      ev.type === 'agent_born'
        ? [p.motherId, p.fatherId]
        : Array.isArray(p.parents)
          ? (p.parents as unknown[])
          : []
    for (const parentId of named) {
      if (typeof parentId !== 'string' || parentId === '' || parentId === p.id) continue
      const key = `${parentId}\n${p.id}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ parentId, childId: p.id, tick: ev.tick })
    }
  }
  return out
}

/** How far back a face may be inherited. A town left running for weeks grows generations, and a
 *  lineage the world was founded with can name a parent it never spawned. */
const FOREBEAR_DEPTH = 4

/** The forebears of a body, nearest first. Every committed character sheet belongs to a founder
 *  or a traveller, so this is how a body born here is drawn at all. */
export function forebears(
  agents: Readonly<Record<string, { parents?: readonly string[] } | undefined>>,
  id: string,
): string[] {
  const out: string[] = []
  const seen = new Set([id])
  let front = [id]
  for (let step = 0; step < FOREBEAR_DEPTH && front.length > 0; step++) {
    const next: string[] = []
    for (const who of front)
      for (const parent of personAt(agents, who)?.parents ?? []) {
        if (seen.has(parent)) continue
        seen.add(parent)
        out.push(parent)
        next.push(parent)
      }
    front = next
  }
  return out
}

/** The partnerships the world holds right now, each pair once. A marriage the valley was founded
 *  with is a fact from the first tick, and one made here is a fact from the vow. */
export function partnerEdges(
  agents: Readonly<Record<string, { id: string; partnerId?: string }>>,
): PartnerEdge[] {
  const seen = new Set<string>()
  const out: PartnerEdge[] = []
  for (const a of Object.values(agents).sort((x, y) => (x.id < y.id ? -1 : 1))) {
    const other = a.partnerId
    if (other === undefined || other === a.id || agents[other] === undefined) continue
    const [aId, bId] = [a.id, other].sort()
    const key = `${aId}\n${bId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ aId: aId!, bId: bId! })
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
  agents: Readonly<
    Record<
      string,
      { id: string; name: string; alive: boolean; insideId?: string; partnerId?: string }
    >
  >,
): LineageResponse {
  const people = Object.values(agents)
    .map((a): LineagePerson => ({ id: a.id, name: a.name, alive: a.alive }))
    .sort((x, y) => (x.id < y.id ? -1 : 1))
  return {
    people,
    parentOf: parentEdges(events),
    partnerOf: partnerEdges(agents),
    households: householdsOf(agents),
  }
}

export type LineageDeps = { db: Database.Database; mirror: WorldMirror }

export function mountLineageApi(router: Router, deps: LineageDeps): void {
  // Both, because a founding child names its family on the spawn: reading births alone left the
  // valley's own two families undrawable, which is what shipped on 2026-09-07.
  const selKin = deps.db.prepare(
    "SELECT seq, tick, type, payload FROM events WHERE type IN ('agent_born', 'agent_spawned') ORDER BY seq",
  )
  const cache = makeSeqCache(() => deps.mirror.seq())
  router.route('GET', '/api/lineage', (_req, res) => {
    sendPrebuilt(
      res,
      cache.json('lineage', () => {
        try {
          const events = (selKin.all() as EventRow[]).map(toEvent)
          return buildLineage(events, deps.mirror.state().agents)
        } catch {
          return EMPTY_LINEAGE // a town with no ancestry is not an error
        }
      }),
    )
  })
}

import type { IncomingMessage, ServerResponse } from 'node:http'
import type Database from 'better-sqlite3'
import { DISCOVERY_EVENT, DiscoveryRecordSchema, type DiscoveryRecord } from '@sj/shared'
import type { Router } from './server.js'
import type { WorldMirror } from './worldMirror.js'
import { makeSeqCache, sendPrebuilt } from './seqCache.js'
import { reportOnce } from './degraded.js'

export type DiscoveryApiDeps = { db: Database.Database; mirror: WorldMirror }

// The world's own log IS the archive: append-only, ordered, and physically unable to lose a
// row when a rule is later reverted. Nothing here reaches the ops plane, by construction —
// this file names none of its tables and this package does not depend on it.
export function readDiscoveries(
  db: Database.Database,
  nameOf: (agentId: string) => string,
): DiscoveryRecord[] {
  const rows = db
    .prepare('SELECT seq, tick, payload FROM events WHERE type = ? ORDER BY tick, seq')
    .all(DISCOVERY_EVENT) as Array<{ seq: number; tick: number; payload: string }>
  const out: DiscoveryRecord[] = []
  for (const r of rows) {
    const p = JSON.parse(r.payload) as Record<string, unknown>
    const parsed = DiscoveryRecordSchema.safeParse({
      seq: r.seq, tick: r.tick,
      recipeId: p.recipeId, name: p.name, kind: p.kind, byId: p.byId,
      by: nameOf(String(p.byId ?? '')), intent: p.intent, makes: p.makes,
    })
    // A row a future writer shaped differently is skipped, never a 500: the observatory is a
    // window, and a window does not break because one pane is unfinished. It does say which
    // pane — silently short is how a schema drift stays invisible instead of degraded.
    if (parsed.success) out.push(parsed.data)
    else {
      reportOnce('discoveries.schema', () =>
        `a ${DISCOVERY_EVENT} row at seq ${r.seq} does not fit DiscoveryRecordSchema and is being`
        + ` dropped from /api/discoveries — ${parsed.error.issues.map((i) =>
          `${i.path.join('.')}: ${i.message}`).join('; ')}`)
    }
  }
  return out
}

export function mountDiscoveryApi(router: Router, deps: DiscoveryApiDeps): void {
  const cache = makeSeqCache(() => deps.mirror.seq())
  router.route('GET', '/api/discoveries', (_req: IncomingMessage, res: ServerResponse) =>
    sendPrebuilt(res, cache.json('discoveries', () => {
      const state = deps.mirror.state()
      return { discoveries: readDiscoveries(deps.db, (id) => state.agents[id]?.name ?? id) }
    })))
}

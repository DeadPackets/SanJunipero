import { join } from 'node:path'
import Database from 'better-sqlite3'
import { MINUTES_PER_DAY } from '@sj/shared'
import type { Router } from './server.js'
import { sendJson } from './http.js'
import { reportOnce } from './degraded.js'

// The recognizer's registry, read the way the observatory reads everything: readonly, never
// created, and typed-empty until the arbiter has written a day. Plain SELECTs rather than
// @sj/arbiter, which drags the mind stack onto the scripted path.

/** The recognizer's own file, beside the minds. Must match `LIVE_ARBITER_DB` in @sj/live —
 *  the gateway may not import the live half. */
const ARBITER_DB = '_arbiter.db'

type ConstructRow = {
  id: string
  type: string
  /** The town's own word for it, quoted from a mouth, or null while it has none. */
  name: string | null
  members: string[]
  firstDay: number
  /** Times they came back to it, the first gathering included. */
  gatherings: number
  anchor: { x: number; y: number } | null
  /** The whole utterance the name was taken from, and whose mouth it came out of. */
  quote: string | null
  saidBy: string | null
}

type RawRow = {
  id: string
  type: string
  name: string | null
  name_provenance: string | null
  anchor: string | null
  participants: string
  first_tick: number
  recurrences: string
}

const parse = <T>(json: string | null, fallback: T): T =>
  json === null ? fallback : (JSON.parse(json) as T)

function toRow(r: RawRow): ConstructRow {
  const provenance = parse<{ quote: string; byId: string } | null>(r.name_provenance, null)
  const anchor = parse<ConstructRow['anchor'] | string>(r.anchor, null)
  return {
    id: r.id,
    type: r.type,
    name: r.name,
    members: parse<string[]>(r.participants, []),
    firstDay: Math.floor(r.first_tick / MINUTES_PER_DAY),
    gatherings: parse<unknown[]>(r.recurrences, []).length + 1,
    anchor: typeof anchor === 'object' ? anchor : null,
    quote: provenance?.quote ?? null,
    saidBy: provenance?.byId ?? null,
  }
}

/** Opened and closed per request: the file does not exist until the arbiter writes it, and the
 *  panel behind this reads once a minute. */
function readConstructs(agentDbDir: string | undefined): ConstructRow[] {
  if (agentDbDir === undefined) return []
  let db: Database.Database
  try {
    db = new Database(join(agentDbDir, ARBITER_DB), { readonly: true, fileMustExist: true })
  } catch {
    return [] // a scripted town, or one whose first day is still unrecognized
  }
  try {
    return (db.prepare('SELECT * FROM constructs ORDER BY first_tick, id').all() as RawRow[]).map(
      toRow,
    )
  } catch (e) {
    reportOnce(
      'arbiter.constructs',
      () =>
        `the arbiter db is open but its constructs table could not be read, so /api/constructs` +
        ` is answering empty — ${e instanceof Error ? e.message : String(e)}`,
    )
    return []
  } finally {
    db.close()
  }
}

export function mountConstructsApi(
  router: Router,
  deps: { agentDbDir?: string | undefined },
): void {
  router.route('GET', '/api/constructs', (_req, res) => {
    sendJson(res, readConstructs(deps.agentDbDir))
  })
}

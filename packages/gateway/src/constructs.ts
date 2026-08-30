import { join } from 'node:path'
import Database from 'better-sqlite3'
import {
  ARBITER_DB_FILE,
  ConstructRowSchema,
  ConstructsResponseSchema,
  MINUTES_PER_DAY,
  type ConstructRecord,
  type ConstructRow,
} from '@sj/shared'
import type { Router } from './router.js'
import { sendJson } from './http.js'
import { reportOnce } from './degraded.js'

// Plain SELECTs rather than @sj/arbiter, which drags the mind stack onto the scripted path.
// Readonly and never created: typed-empty until the arbiter has written a day.

const parse = <T>(json: string | null, fallback: T): T =>
  json === null ? fallback : (JSON.parse(json) as T)

function toRecord(r: ConstructRow): ConstructRecord {
  const provenance = parse<{ quote: string; byId: string } | null>(r.name_provenance, null)
  const anchor = parse<ConstructRecord['anchor'] | string>(r.anchor, null)
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

export function mountConstructsApi(
  router: Router,
  deps: { agentDbDir?: string | undefined },
): () => void {
  // Opened on the first request that finds it rather than at boot: the arbiter creates the file
  // on the first night, which is an hour after the gateway starts serving.
  let db: Database.Database | null = null
  const open = (): Database.Database | null => {
    if (db !== null || deps.agentDbDir === undefined) return db
    try {
      db = new Database(join(deps.agentDbDir, ARBITER_DB_FILE), {
        readonly: true,
        fileMustExist: true,
      })
    } catch {
      db = null // a scripted town, or one whose first day is still unrecognized
    }
    return db
  }

  router.route('GET', '/api/constructs', (_req, res) => {
    const arbiter = open()
    if (arbiter === null) {
      sendJson(res, [])
      return
    }
    try {
      const rows = ConstructRowSchema.array().parse(
        arbiter.prepare('SELECT * FROM constructs ORDER BY first_tick, id').all(),
      )
      sendJson(res, ConstructsResponseSchema.parse(rows.map(toRecord)))
    } catch (e) {
      reportOnce(
        'arbiter.constructs',
        () =>
          `the arbiter db is open but its constructs table could not be read, so /api/constructs` +
          ` is answering empty — ${e instanceof Error ? e.message : String(e)}`,
      )
      sendJson(res, [])
    }
  })

  return () => {
    db?.close()
    db = null
  }
}

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterAll, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { DEFAULT_CONFIG } from '@sj/shared'
import { EventStore, openDb } from '@sj/engine/store'
import { RngStreams, TickLoop, genesisState, type TileId } from '@sj/engine'
import { FOLD_TYPES, mountDataApi } from './api.js'
import { WorldMirror } from './worldMirror.js'
import type { RouteHandler, Router } from './router.js'

const GRASS: TileId[][] = Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => 0))

type EventRead = { via: 'all' | 'iterate'; rows: number }

/** Counts the rows every `FROM events` read hands back, so a full re-scan is visible — through
 *  `.iterate` as well as `.all`, or swapping one for the other stops the measurement. */
function spyOnEventReads(db: Database.Database): EventRead[] {
  const reads: EventRead[] = []
  const realPrepare = db.prepare.bind(db)
  Object.defineProperty(db, 'prepare', {
    value: (sql: string) => {
      const st = realPrepare(sql) as {
        all: (...a: unknown[]) => unknown[]
        iterate: (...a: unknown[]) => Iterable<unknown>
      }
      if (!sql.includes('FROM events')) return st
      const realAll = st.all.bind(st)
      st.all = (...a: unknown[]): unknown[] => {
        const r = realAll(...a)
        reads.push({ via: 'all', rows: r.length })
        return r
      }
      const realIterate = st.iterate.bind(st)
      st.iterate = function* (...a: unknown[]): Iterable<unknown> {
        const read: EventRead = { via: 'iterate', rows: 0 }
        reads.push(read)
        for (const row of realIterate(...a)) {
          read.rows++
          yield row
        }
      }
      return st
    },
  })
  return reads
}

const rowsRead = (reads: EventRead[]): number => reads.reduce((a, r) => a + r.rows, 0)

const foldRows = (db: Database.Database, seq: number): number =>
  (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM events
         WHERE seq > ? AND type IN (${FOLD_TYPES.map(() => '?').join(', ')})`,
      )
      .get(seq, ...FOLD_TYPES) as { n: number }
  ).n

const collect = (): { router: Router; call: (key: string) => void } => {
  const routes = new Map<string, RouteHandler>()
  const res = { writeHead: () => {}, end: () => {} } as unknown as ServerResponse
  return {
    router: {
      route: (m, p, fn) => {
        routes.set(`${m} ${p}`, fn)
      },
    },
    call: (key) => {
      routes.get(key)!({ url: '/' } as IncomingMessage, res, {})
    },
  }
}

/** One route's body from a freshly mounted api over `db`. */
const bodyOf = (db: Database.Database, mirror: WorldMirror, path: string): string => {
  const routes = new Map<string, RouteHandler>()
  mountDataApi(
    {
      route: (m, p, fn) => {
        routes.set(`${m} ${p}`, fn)
      },
    },
    { db, mirror, config: DEFAULT_CONFIG },
  )
  let body = ''
  routes.get(`GET ${path}`)!(
    { url: path } as IncomingMessage,
    {
      writeHead: () => {},
      end: (b: string) => {
        body = b
      },
    } as unknown as ServerResponse,
    {},
  )
  return body
}

/**
 * A memo keyed on `mirror.seq()` buys nothing: the generation changes every tick, so the whole
 * table is re-read and re-`JSON.parse`d on the tick thread.
 */
describe('★ the read API reads the tick, not the history', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-apiscale-'))
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('reads only the events appended since the generation it last saw', () => {
    const dbPath = join(dir, 'w.db')
    const worldDb = openDb(dbPath)
    const store = new EventStore(worldDb)
    const loop = new TickLoop({
      store,
      state: genesisState(DEFAULT_CONFIG, GRASS),
      rng: new RngStreams('scale'),
      snapshotEveryTicks: 1000,
      onTick: ({ tick, emit }) => {
        if (tick === 1)
          emit('agent_spawned', { id: 'alice', name: 'Alice', x: 1, y: 1, ageDays: 7300 })
        emit('agent_spoke', { agentId: 'alice', x: 1, y: 1, text: 'hello' })
      },
    })
    for (let i = 0; i < 200; i++) loop.step()
    const total = store.lastSeq()
    expect(total).toBeGreaterThan(400)

    // the api gets its own handle so only ITS reads are counted (the mirror prepares the
    // same SQL and polls it every generation of its own accord)
    const apiDb = new Database(dbPath, { readonly: true })
    const mirror = new WorldMirror({ db: worldDb, config: DEFAULT_CONFIG, terrain: GRASS })
    const rows = spyOnEventReads(apiDb)
    const { router, call } = collect()
    mountDataApi(router, { db: apiDb, mirror, config: DEFAULT_CONFIG })

    // ★ the resumed town is folded at MOUNT — the first stranger's GET does not pay for it —
    // and only the types the fold consumes are read.
    const atBoot = rowsRead(rows)
    expect(atBoot, 'the boot fold read rows no case in it consumes').toBe(foldRows(apiDb, 0))
    expect(atBoot, 'and the filter dropped nothing, so it read the whole log').toBeLessThan(total)
    // ★ and it reads them one at a time: `.all` on a resumed town's backlog is the whole log
    // materialised, and JSON.parsed, in one synchronous stall on the tick thread.
    expect(rows.map((r) => r.via)).not.toContain('all')

    rows.length = 0
    call('GET /api/society')
    expect(rowsRead(rows), 'the first viewer paid for the town it never saw').toBe(0)

    loop.step()
    mirror.poll() // a new generation: the memo must be refreshed
    rows.length = 0
    call('GET /api/society')
    const secondRead = rowsRead(rows)

    expect(secondRead, 'a second generation must cost the tick, not the town').toBeLessThan(20)
    expect(secondRead, 'and it must be exactly the events that tick appended').toBe(
      foldRows(apiDb, total),
    )

    // …and appending gives byte-identical answers to reading the whole log once
    const fresh = new Database(dbPath, { readonly: true })
    const freshMirror = new WorldMirror({ db: fresh, config: DEFAULT_CONFIG, terrain: GRASS })
    expect(bodyOf(apiDb, mirror, '/api/society')).toBe(bodyOf(fresh, freshMirror, '/api/society'))
    expect(bodyOf(apiDb, mirror, '/api/heat')).toBe(bodyOf(fresh, freshMirror, '/api/heat'))

    fresh.close()
    apiDb.close()
    worldDb.close()
  })
})

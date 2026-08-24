import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterAll, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { DEFAULT_CONFIG } from '@sj/shared'
import { EventStore, RngStreams, TickLoop, genesisState, openDb, type TileId } from '@sj/engine'
import { mountDataApi } from './api.js'
import { WorldMirror } from './worldMirror.js'
import type { RouteHandler, Router } from './server.js'

const GRASS: TileId[][] = Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => 0 as TileId))

/** Counts the rows every `FROM events` read hands back, so a full re-scan is visible. */
function spyOnEventReads(db: Database.Database): number[] {
  const rows: number[] = []
  const realPrepare = db.prepare.bind(db)
  Object.defineProperty(db, 'prepare', {
    value: (sql: string) => {
      const st = realPrepare(sql) as { all: (...a: unknown[]) => unknown[] }
      if (!/FROM events/.test(sql)) return st
      const realAll = st.all.bind(st)
      st.all = (...a: unknown[]): unknown[] => {
        const r = realAll(...a)
        rows.push(r.length)
        return r
      }
      return st
    },
  })
  return rows
}

const collect = (): { router: Router; call: (key: string) => void } => {
  const routes = new Map<string, RouteHandler>()
  const res = { writeHead: () => {}, end: () => {} } as unknown as ServerResponse
  return {
    router: { route: (m, p, fn) => { routes.set(`${m} ${p}`, fn) } },
    call: (key) => routes.get(key)!({ url: '/' } as IncomingMessage, res, {}),
  }
}

/** One route's body from a freshly mounted api over `db`. */
const bodyOf = (db: Database.Database, mirror: WorldMirror, path: string): string => {
  const routes = new Map<string, RouteHandler>()
  mountDataApi({ route: (m, p, fn) => { routes.set(`${m} ${p}`, fn) } },
    { db, mirror, config: DEFAULT_CONFIG })
  let body = ''
  routes.get(`GET ${path}`)!({ url: path } as IncomingMessage,
    { writeHead: () => {}, end: (b: string) => { body = b } } as unknown as ServerResponse, {})
  return body
}

/**
 * ★ THE READ API WAS O(WORLD AGE) EVERY TICK, AND RESUME IS WHAT MADE THAT REACHABLE.
 *
 * `readEvents` memoised the parsed log per `mirror.seq()` generation — but the generation
 * changes every tick, so the memo bought exactly nothing over a long run: the whole table was
 * re-read and re-`JSON.parse`d on the tick thread every 2.5 seconds. Measured at 185 ns/event,
 * that is 250 ms per tick at sim-day 52 and 485 ms at sim-day 100.
 *
 * Nobody had reached it because no town had ever survived a restart.
 */
describe('★ the read API reads the tick, not the history', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-apiscale-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('reads only the events appended since the generation it last saw', () => {
    const dbPath = join(dir, 'w.db')
    const worldDb = openDb(dbPath)
    const store = new EventStore(worldDb)
    const loop = new TickLoop({
      store, state: genesisState(DEFAULT_CONFIG, GRASS), rng: new RngStreams('scale'),
      snapshotEveryTicks: 1000,
      onTick: ({ tick, emit }) => {
        if (tick === 1) emit('agent_spawned', { id: 'alice', name: 'Alice', x: 1, y: 1, ageDays: 7300 })
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

    call('GET /api/society')
    const firstRead = rows.reduce((a, b) => a + b, 0)
    expect(firstRead, 'the first ask still has to read the town it never saw').toBe(total)

    loop.step()
    mirror.poll() // a new generation: the memo must be refreshed
    rows.length = 0
    call('GET /api/society')
    const secondRead = rows.reduce((a, b) => a + b, 0)

    expect(secondRead, 'a second generation must cost the tick, not the town').toBeLessThan(20)
    expect(secondRead, 'and it must be exactly the events that tick appended')
      .toBe(store.lastSeq() - total)

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

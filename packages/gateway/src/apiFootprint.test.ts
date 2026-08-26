import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterAll, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { DEFAULT_CONFIG } from '@sj/shared'
import { EventStore, RngStreams, TickLoop, genesisState, openDb, type TileId } from '@sj/engine'
import { HEAT_HORIZON_TICKS, HEAT_WINDOW_TICKS } from './heat.js'
import { mountDataApi, type Footprint } from './api.js'
import { WorldMirror } from './worldMirror.js'
import type { RouteHandler } from './server.js'

/**
 * Growth is the property, so the measurement is the SECOND tranche: three times the events of
 * the first, and the heap must barely move. The bodies are checked too — "grew by 0 MB" is
 * satisfiable by a read path that answers `[]`.
 */
const GRASS: TileId[][] = Array.from({ length: 64 }, () => Array.from({ length: 64 }, () => 0))
const AGENTS = 12
const FIRST_TRANCHE_TICKS = 2_000
const SECOND_TRANCHE_TICKS = 14_000
/** The retained log cost 146 B/event, so the second tranche alone was ~23 MB of it. */
const GROWTH_CEILING_MB = 6

// vitest is not started with --expose-gc, and an uncollected tranche of parse garbage is the
// same order as the leak being measured. This is the supported way to ask for one anyway.
const collect = ((): (() => void) => {
  const exposed = (globalThis as { gc?: () => void }).gc
  if (exposed)
    return () => {
      for (let i = 0; i < 5; i++) exposed()
    }
  setFlagsFromString('--expose-gc')
  const gc = runInNewContext('gc') as () => void
  setFlagsFromString('--no-expose-gc')
  return () => {
    for (let i = 0; i < 5; i++) gc()
  }
})()
const heapMB = (): number => {
  collect()
  return process.memoryUsage().heapUsed / 1024 / 1024
}

const ids = Array.from({ length: AGENTS }, (_, i) => `a${i}`)

describe('★ the read path holds answers, not the log', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-footprint-'))
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('three times the events must not be three times the memory', () => {
    const dbPath = join(dir, 'loud.db')
    const worldDb = openDb(dbPath)
    const store = new EventStore(worldDb)
    // Deliberately LOUD: talk links and drama windows are the two aggregates that could still
    // grow, and a quiet world would pass this test without proving anything.
    let s = 123456789
    const rnd = (): number => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
    const loop = new TickLoop({
      store,
      state: genesisState(DEFAULT_CONFIG, GRASS),
      rng: new RngStreams('loud'),
      snapshotEveryTicks: 1000,
      onTick: ({ tick, emit }) => {
        if (tick === 1)
          for (const [i, id] of ids.entries()) {
            emit('agent_spawned', {
              id,
              name: `A${i}`,
              x: (i * 5) % 60,
              y: (i * 7) % 60,
              ageDays: 7300,
            })
          }
        for (let k = 0; k < 4; k++) {
          emit('agent_spoke', {
            agentId: ids[Math.floor(rnd() * AGENTS)]!,
            text: 'a word',
            x: Math.floor(rnd() * 30),
            y: Math.floor(rnd() * 30),
          })
        }
        for (let k = 0; k < 6; k++) {
          emit('agent_moved', {
            id: ids[Math.floor(rnd() * AGENTS)]!,
            x: Math.floor(rnd() * 60),
            y: Math.floor(rnd() * 60),
          })
        }
        if (tick % 3 === 0) {
          emit('action_started', {
            agentId: ids[Math.floor(rnd() * AGENTS)]!,
            verb: 'give',
            params: { targetId: ids[Math.floor(rnd() * AGENTS)]! },
            duration: 2,
          })
        }
        if (tick % 3 === 2)
          emit('action_completed', { agentId: ids[Math.floor(rnd() * AGENTS)]!, verb: 'give' })
        if (tick % 37 === 0)
          emit('agent_injured', { agentId: ids[Math.floor(rnd() * AGENTS)]!, kind: 'minor' })
      },
    })

    const apiDb = new Database(dbPath, { readonly: true })
    const mirror = new WorldMirror({ db: worldDb, config: DEFAULT_CONFIG, terrain: GRASS })
    const routes = new Map<string, RouteHandler>()
    let footprint = (): Footprint => {
      throw new Error('api.ts never offered a footprint')
    }
    mountDataApi(
      {
        route: (m, p, fn) => {
          routes.set(`${m} ${p}`, fn)
        },
      },
      {
        db: apiDb,
        mirror,
        config: DEFAULT_CONFIG,
        onFootprint: (f) => {
          footprint = f
        },
      },
    )

    const bodies = new Map<string, string>()
    const warm = (): void => {
      for (const [key, url] of [
        ['GET /api/society', '/api/society'],
        ['GET /api/heat', '/api/heat'],
        ['GET /api/digest', '/api/digest'],
      ] as [string, string][]) {
        let body = ''
        routes.get(key)!(
          { url } as IncomingMessage,
          {
            writeHead: () => {},
            end: (b: string) => {
              body = b
            },
          } as unknown as ServerResponse,
          {},
        )
        bodies.set(key, body)
      }
      // the window nobody repeats, which is the cache miss a stranger can force at will
      routes.get('GET /api/digest')!(
        { url: `/api/digest?fromTick=7&toTick=${mirror.state().tick - 13}` } as IncomingMessage,
        { writeHead: () => {}, end: () => {} } as unknown as ServerResponse,
        {},
      )
    }

    for (let i = 0; i < FIRST_TRANCHE_TICKS; i++) loop.step()
    mirror.poll()
    warm()
    const firstEvents = store.lastSeq()
    const afterFirst = heapMB()

    for (let i = 0; i < SECOND_TRANCHE_TICKS; i++) loop.step()
    mirror.poll()
    warm()
    const afterSecond = heapMB()
    const growthMB = afterSecond - afterFirst

    const f = footprint()
    const added = store.lastSeq() - firstEvents

    // ── the fold really consumed the log ──────────────────────────────────────────────────
    expect(added, 'the second tranche must be the larger one').toBeGreaterThan(firstEvents * 2)
    expect(f.seq, 'every row appended must have been folded').toBe(store.lastSeq())

    // ── and the answers are real, so the bound is a bound over something ───────────────────
    const society = JSON.parse(bodies.get('GET /api/society')!) as {
      nodes: unknown[]
      links: unknown[]
    }
    const heat = JSON.parse(bodies.get('GET /api/heat')!) as { fromTick: number }[]
    expect(society.nodes).toHaveLength(AGENTS)
    expect(society.links.length, 'a town this loud has talk and give links').toBeGreaterThan(100)
    expect(heat.length, 'and drama in most of its recent 60-tick windows').toBeGreaterThan(100)
    expect(bodies.get('GET /api/digest')!.length).toBeGreaterThan(500)

    /**
     * The running map is the whole town's drama, because `/api/digest` must be exact over a
     * window the viewer picks. What is SENT is the last sim-day, so the body is bounded by the
     * population and not by the town's age.
     */
    const oldest = Math.min(...heat.map((w) => w.fromTick))
    const live = mirror.state().tick
    expect(oldest, 'nothing older than the horizon is sent').toBeGreaterThanOrEqual(
      live - HEAT_HORIZON_TICKS - HEAT_WINDOW_TICKS,
    )
    expect(
      heat.length,
      'one window per agent per 60 ticks of the horizon, at most',
    ).toBeLessThanOrEqual(Math.ceil(HEAT_HORIZON_TICKS / HEAT_WINDOW_TICKS + 1) * AGENTS)
    expect(f.heat, 'the MAP is still the whole town, so the digest stays exact').toBeGreaterThan(
      heat.length * 4,
    )

    // ── the property: what is retained counts ANSWERS, never events ────────────────────────
    expect(
      f.spokes,
      'a spoke past the talk window can pair with nothing and is dropped',
    ).toBeLessThan(4 * (20 + 2))
    expect(f.started, 'one entry per speaker per linking verb').toBeLessThanOrEqual(AGENTS * 3)
    expect(f.links, 'one entry per ordered pair per kind').toBeLessThanOrEqual(AGENTS * AGENTS * 4)
    expect(f.heat, 'one entry per 60-tick window per agent in it').toBeLessThanOrEqual(
      Math.ceil(mirror.state().tick / 60 + 1) * AGENTS,
    )

    // ── and the heap agrees ────────────────────────────────────────────────────────────────
    expect(
      growthMB,
      `${added} more events grew the read path by ${growthMB.toFixed(1)} MB` +
        ` (the retained log cost 146 B each, so ${((added * 146) / 1024 / 1024).toFixed(1)} MB)`,
    ).toBeLessThan(GROWTH_CEILING_MB)

    apiDb.close()
    worldDb.close()
  })
})

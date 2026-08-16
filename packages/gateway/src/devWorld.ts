import { mkdirSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DEFAULT_CONFIG, type SimConfig } from '@sj/shared'
import {
  EventStore, RngStreams, TickLoop, genesisState, makeFixtureMap, openDb,
} from '@sj/engine'
import { openForgeDb } from '@sj/forge'
import { createGateway, type Gateway } from './server.js'
import { ensureObserverTables, publishThought } from './observer.js'
import { makeFoundersOnTick } from './founders.js'
import { ingestProductionArt, ingestTerrainArt } from './ingestArt.js'
import { showcaseTerrain } from './showcaseMap.js'

export const DEV_DB_PATH = 'data/dev-world.db'
export const DEV_PORT = 8787
export const DEV_MS_PER_TICK = 2500
export const DEV_SEED = 'g6'
export const DEV_SNAPSHOT_EVERY_TICKS = 60

// The founders showcase is an art demo: freeze weather to sunny so the storm
// grading matrix never greys the town (seed g6 rolls rain within the first day).
export const SHOWCASE_CONFIG: SimConfig = { ...DEFAULT_CONFIG, weather: { ...DEFAULT_CONFIG.weather, hourlyChangeChance: 0 } }

// The G6 "live thought" source — human framing, no AI vocabulary.
export const THOUGHT_LINES: Record<string, string> = {
  walk: 'The path is clear enough.',        till: 'This earth wants turning.',
  plant: 'Wheat in, before the season slips.', harvest: 'Ready at last.',
  fish: 'The river owes me a dinner.',      eat: 'That settles the stomach.',
  sleep: 'My eyes are heavy.',              give: 'They need it more than I do.',
  take: 'The storehouse can spare this.',   build: 'Beam by beam it rises.',
}

export type DevWorld = { gateway: Gateway; loop: TickLoop; stop(): Promise<void> }

// 'scripted' is the G6 fixture map and stays the default, so every existing gate is unchanged.
// 'showcase' folds C13's city template (see showcaseMap.ts). A third 'city' value — genesis
// taking the template directly, at 128×128 — is a one-line addition here when C11 §9 lands.
export type DevMapKind = 'scripted' | 'showcase'
export const DEV_MAP_DEFAULT: DevMapKind = 'scripted'

export function devTerrain(map: DevMapKind = DEV_MAP_DEFAULT): ReturnType<typeof makeFixtureMap> {
  return map === 'showcase' ? showcaseTerrain() : makeFixtureMap()
}

export async function startDevWorld(
  opts: {
    dbPath?: string; port?: number; realMsPerTick?: number; seed?: string; ingest?: boolean
    map?: DevMapKind
    /** dev/demo only (G10 human pass): tired founders go indoors and come out again.
     *  Off by default, so every existing gate folds exactly the events it always did. */
    interiors?: boolean
  } = {},
): Promise<DevWorld> {
  const dbPath = opts.dbPath ?? DEV_DB_PATH
  mkdirSync(dirname(dbPath), { recursive: true })
  for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true }) // recreated fresh

  const forgeDb = openForgeDb(dbPath) // migrate forge assets/jobs tables for the push loop + hot-swap demo
  if (opts.ingest === true) {
    // the dev DB is recreated each boot — load the approved production art so the
    // town wakes with its real cast + buildings (CLI default; tests skip the cost)
    const tiles = await ingestTerrainArt(forgeDb) // code-painted, offline, $0 — never throws on a missing root
    console.log(`dev world: ingested terrain tiles (${tiles.length} records, road strip included)`)
    try {
      const entries = await ingestProductionArt(forgeDb)
      console.log(`dev world: ingested production art (${entries.length} assets)`)
    } catch (e) {
      console.log(`dev world: production art not ingested — ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  forgeDb.close()
  const db = openDb(dbPath)
  ensureObserverTables(db)

  const config = SHOWCASE_CONFIG
  const terrain = devTerrain(opts.map ?? DEV_MAP_DEFAULT)
  const rng = new RngStreams(opts.seed ?? DEV_SEED)
  const store = new EventStore(db)
  const loop: TickLoop = new TickLoop({
    store, state: genesisState(config, terrain), rng, config,
    snapshotEveryTicks: DEV_SNAPSHOT_EVERY_TICKS,
    // the founders showcase town
    onTick: makeFoundersOnTick(config, rng, () => loop.state, { interiors: opts.interiors === true }),
  })

  const gateway = await createGateway({ dbPath, port: opts.port ?? DEV_PORT, terrain, config, db })

  // Scripted thoughts: when an actor's chosen intent verb changes, it "thinks" a line.
  let lastSeq = 0
  const lastVerb = new Map<string, string>()
  const tickOnce = (): void => {
    loop.step()
    for (const ev of store.readFrom(lastSeq)) {
      lastSeq = ev.seq
      if (ev.type !== 'action_started') continue
      const p = ev.payload as { agentId: string; verb: string }
      if (lastVerb.get(p.agentId) === p.verb) continue
      lastVerb.set(p.agentId, p.verb)
      publishThought(db, { tick: ev.tick, agentId: p.agentId, text: THOUGHT_LINES[p.verb] ?? 'Hm.' })
    }
  }
  // DEV_FAST_FORWARD=<tick>: step the world synchronously to a moment (e.g. 490 = Day 0
  // 08:10 daylight) before the real-time cadence starts — screenshot/QA convenience only
  const ff = Number(process.env['DEV_FAST_FORWARD'] ?? '0')
  if (Number.isFinite(ff) && ff > 0) {
    while (loop.state.tick < ff) tickOnce()
    console.log(`dev world: fast-forwarded to tick ${loop.state.tick}`)
  }

  const timer = setInterval(tickOnce, opts.realMsPerTick ?? DEV_MS_PER_TICK)

  return {
    gateway, loop,
    stop: async () => {
      clearInterval(timer)
      await gateway.close()
      db.close()
    },
  }
}

// CLI switches, read HERE and nowhere else, so no test's world can drift with an env var:
//   SJ_DEV_MAP=showcase   fold C13's city template instead of the G6 fixture map
//   SJ_DEV_INTERIORS=1    tired founders go indoors and come out again (the G10 human pass)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const map: DevMapKind = process.env['SJ_DEV_MAP'] === 'showcase' ? 'showcase' : DEV_MAP_DEFAULT
  const interiors = process.env['SJ_DEV_INTERIORS'] === '1'
  void startDevWorld({ ingest: true, map, interiors }).then(({ gateway }) => {
    console.log(`dev world: map=${map} interiors=${interiors ? 'on' : 'off'}`)
    console.log(`dev world: the town is awake on ws://localhost:${gateway.port}/ws`)
  })
}

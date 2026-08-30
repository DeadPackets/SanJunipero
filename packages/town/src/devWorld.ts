import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DEFAULT_CONFIG, TOWN_RINGS_GENESIS, simTimeFromTick, type SimConfig } from '@sj/shared'
import { EventStore, openDb } from '@sj/engine/store'
import {
  RngStreams,
  TickLoop,
  applyLaw,
  genesisState,
  makeFixtureMap,
  replayLatest,
  type LawQueue,
  type TickHandler,
  type TileId,
} from '@sj/engine'
import { openForgeDb } from '@sj/forge'
import {
  createGateway,
  ensureObserverTables,
  publishThought,
  type Gateway,
  type LiveCast,
  type LiveOps,
} from '@sj/gateway'
import { foundersFor, makeFoundersOnTick, townStructuresFor } from './founders.js'
import { ingestLibraryArt, ingestProductionArt, ingestTerrainArt } from './ingestArt.js'
import { showcaseDeck, showcaseTerrain } from './showcaseMap.js'
import { parseWorldEnv, type WorldEnv } from './worldEnv.js'
import { devWorldOrigin } from './devTown.js'
import {
  assertSameWorld,
  ensureWorldMetaTable,
  readWorldMeta,
  writeWorldMeta,
} from './worldMeta.js'

export const DEV_DB_PATH = 'data/dev-world.db'
export const DEV_PORT = 8787
export const DEV_MS_PER_TICK = 2500
export const DEV_SEED = 'g6'
export const DEV_SNAPSHOT_EVERY_TICKS = 60

// `construction.houseTicks` defaults to two sim days — two REAL HOURS at the dev world's 2.5 s
// tick. `config.test.ts` requires this dial and the recipe's `durationTicks` to stay equal.
export const DEV_HOUSE_TICKS = 240

export const SHOWCASE_CONFIG: SimConfig = {
  ...DEFAULT_CONFIG,
  construction: { ...DEFAULT_CONFIG.construction, houseTicks: DEV_HOUSE_TICKS },
  structures: {
    ...DEFAULT_CONFIG.structures,
    recipes: {
      ...DEFAULT_CONFIG.structures.recipes,
      house: { ...DEFAULT_CONFIG.structures.recipes.house!, durationTicks: DEV_HOUSE_TICKS },
    },
  },
}

/** The showcase with its weather held still. The test harnesses that count houses and
 *  bridges were tuned on a sunny run; the shipped town runs the weather. */
export const STILL_WEATHER_CONFIG: SimConfig = {
  ...SHOWCASE_CONFIG,
  weather: { ...SHOWCASE_CONFIG.weather, hourlyChangeChance: 0 },
}

// Human framing, no AI vocabulary: one-way glass holds for canned lines too.
export const THOUGHT_LINES: Record<string, string> = {
  walk: 'The path is clear enough.',
  till: 'This earth wants turning.',
  plant: 'Wheat in, before the season slips.',
  harvest: 'Ready at last.',
  fish: 'The river owes me a dinner.',
  eat: 'That settles the stomach.',
  sleep: 'My eyes are heavy.',
  give: 'They need it more than I do.',
  take: 'The storehouse can spare this.',
  build: 'Beam by beam it rises.',
}

export type DevWorld = {
  gateway: Gateway
  loop: TickLoop
  /** The map the world actually runs on — the resumed one when there is a town on disk, and
   *  the same array the gateway was handed, so the viewer can never render a different map. */
  terrain: TileId[][]
  resumedAtTick: number | null
  live: boolean
  ops: LiveOps | null
  /** ONE WHOLE TICK: the loop step AND the observer scan after it — `loop.step()` is not all of one. */
  tick(): void
  /** Lands as one `config_changed` at the next tick boundary, replayed like every other fact. */
  submitLaw: (path: string, value: unknown) => void
  stop(): Promise<void>
}

/** Agent memory is a separate `<id>.db` per mind, so world and mind are wiped as ONE unit.
 *  Only `*.db` goes — the rest of the directory is not this function's to delete. */
function wipeAgentMemory(agentDbDir: string | undefined): number {
  if (agentDbDir === undefined) return 0
  let gone = 0
  let names: string[]
  try {
    names = readdirSync(agentDbDir)
  } catch {
    return 0
  }
  for (const name of names) {
    if (!/\.db(-wal|-shm)?$/.test(name)) continue
    rmSync(join(agentDbDir, name), { force: true })
    gone += 1
  }
  return gone
}

/** `scripted` is a FROZEN TEST FIXTURE: the gates hash the world it folds, so it may never change. */
export type DevMapKind = 'scripted' | 'showcase'
/** For `startDevWorld()` called as a library, i.e. by the gates. Never by a person. */
export const DEV_MAP_DEFAULT: DevMapKind = 'scripted'

export function devTerrain(
  map: DevMapKind = DEV_MAP_DEFAULT,
  rings: number = TOWN_RINGS_GENESIS,
): ReturnType<typeof makeFixtureMap> {
  return map === 'showcase' ? showcaseTerrain(undefined, rings) : makeFixtureMap()
}

/** `state.origin` is where the array's (0, 0) sits in the AUTHORED frame. The frozen fixture
 *  gets none deliberately — an absent field keeps its fold byte-identical. */
export function devGenesisState(
  config: SimConfig,
  terrain: ReturnType<typeof makeFixtureMap>,
  map: DevMapKind = DEV_MAP_DEFAULT,
  rings: number = TOWN_RINGS_GENESIS,
) {
  const base = genesisState(config, terrain)
  return map === 'showcase' ? { ...base, origin: devWorldOrigin(rings) } : base
}

export async function startDevWorld(
  opts: {
    dbPath?: string
    port?: number
    realMsPerTick?: number
    seed?: string
    ingest?: boolean
    /** Every world knob at once, the way `parseWorldEnv()` hands them over. An absent knob takes
     *  the LIBRARY default, which is not the env default: off, so a frozen gate folds unchanged. */
    world?: Partial<WorldEnv>
    lamps?: number
    /** Opened readonly. Absent, every narrated surface answers typed-empty. */
    narratorDbPath?: string
    /** Present, this process serves world, socket and viewer on one port; absent, vite proxies. */
    staticDir?: string
    /** Per-mind memory dbs (`<id>.db`), thrown away with the world when `fresh` is asked for. */
    agentDbDir?: string
    /** A FACTORY, not a cast: one built before this call has already opened the per-mind dbs
     *  that `fresh` deletes. */
    cast?: () => Promise<LiveCast>
  } = {},
): Promise<DevWorld> {
  const dbPath = opts.dbPath ?? DEV_DB_PATH
  const world = opts.world ?? {}
  const fresh = world.fresh === true
  mkdirSync(dirname(dbPath), { recursive: true })
  if (fresh) {
    for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true })
    const minds = wipeAgentMemory(opts.agentDbDir)
    console.log(
      `dev world: FRESH — the world db was deleted${minds > 0 ? ` along with ${minds} agent memory db(s)` : ''}`,
    )
  }

  const config = SHOWCASE_CONFIG
  const map = world.map ?? DEV_MAP_DEFAULT
  const rings = world.rings ?? TOWN_RINGS_GENESIS
  const seed = opts.seed ?? DEV_SEED
  // The frozen fixture has no grammar to grow, so its ring count is not part of its identity.
  const identity = { map, rings: map === 'showcase' ? rings : 0, seed }

  // Refused BEFORE the art ingest, so a boot that cannot proceed does not spend a minute first.
  {
    const probe = openDb(dbPath)
    try {
      ensureWorldMetaTable(probe)
      const stored = readWorldMeta(probe)
      if (stored && new EventStore(probe).lastSeq() > 0) assertSameWorld(stored, identity)
    } finally {
      probe.close()
    }
  }

  const forgeDb = openForgeDb(dbPath)
  if (opts.ingest === true) {
    // Idempotent: unchanged bytes register nothing, so a resumed town does not grow a second
    // copy of the art cache on every boot.
    const tiles = await ingestTerrainArt(forgeDb) // code-painted, offline, $0 — never throws on a missing root
    console.log(`dev world: ingested terrain tiles (${tiles.length} records, road strip included)`)
    try {
      const entries = ingestProductionArt(forgeDb)
      const gone = entries.filter((e) => e.action === 'missing')
      console.log(
        `dev world: ingested production art (${entries.length - gone.length} of ${entries.length} assets)`,
      )
      for (const e of gone) console.log(`dev world:   NO ART for ${e.kind} — ${e.detail ?? ''}`)
    } catch (e) {
      console.log(
        `dev world: production art not ingested — ${e instanceof Error ? e.message : String(e)}`,
      )
    }
    try {
      const lib = ingestLibraryArt(forgeDb)
      console.log(`dev world: ingested library art (${lib.length} items, furniture included)`)
    } catch (e) {
      console.log(
        `dev world: library art not ingested — ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }
  forgeDb.close()
  const db = openDb(dbPath)
  ensureObserverTables(db)
  ensureWorldMetaTable(db)
  writeWorldMeta(db, identity)

  const genesisTerrain = devTerrain(map, rings)
  // Same map kind AND the same ring count as the terrain, or the town is an overlay of two layouts.
  const structures = townStructuresFor(map, rings)

  // `WorldState.terrain` rides in the snapshot, so the gateway must be handed THIS array and
  // not `devTerrain(map, rings)` recomputed from the environment.
  const store = new EventStore(db)
  const resumed = store.lastSeq() > 0 ? replayLatest(store, config, genesisTerrain, seed) : null
  const terrain = resumed ? resumed.state.terrain : genesisTerrain
  const rng = resumed ? resumed.rng : new RngStreams(seed)

  console.log(
    `dev world: map=${map} rings=${map === 'showcase' ? rings : 'n/a (frozen fixture)'} ` +
      `terrain=${terrain[0]?.length ?? 0}x${terrain.length} structures=${structures.length}` +
      (map === 'scripted' ? '  ← THE FROZEN G6 TEST FIXTURE, not the product town' : ''),
  )
  if (resumed) {
    const t = simTimeFromTick(resumed.state.tick)
    // A SIGKILL rolls back the tick that was in flight, so this number can be one behind.
    console.log(
      `dev world: RESUMED at tick ${resumed.state.tick} — year ${t.year} ${t.season} day ${t.dayOfSeason}, ` +
        `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}, ` +
        `${Object.keys(resumed.state.structures).length} structures, ` +
        `${Object.keys(resumed.state.agents).length} townsfolk, ${resumed.seq} events`,
    )
  } else {
    console.log('dev world: a new day 0 — no town on disk')
  }

  // The handler is an indirection because a bridge and a loop each need the other first: the
  // bridge is constructed around `loop`, and `loop` runs the handler that bridge returns.
  let handler: TickHandler | null = null
  const loop: TickLoop = new TickLoop({
    store,
    state: resumed ? resumed.state : devGenesisState(config, terrain, map, rings),
    rng,
    config,
    snapshotEveryTicks: DEV_SNAPSHOT_EVERY_TICKS,
    onTick: (ctx) => {
      handler?.(ctx)
    },
  })
  const lawQueue: LawQueue = []
  const scriptedOnTick = makeFoundersOnTick(config, rng, () => loop.state, {
    laws: lawQueue,
    // foundersFor is identity on an unowned town, so the scripted arm is byte-identical.
    interiors: world.interiors === true,
    structures,
    founders: foundersFor(structures),
    holdings: map === 'showcase',
    builders: world.builders === true && map === 'showcase',
    jointBuild: world.jointBuild === true && map === 'showcase',
    ...(opts.lamps !== undefined && opts.lamps > 0 && map === 'showcase'
      ? { lamps: opts.lamps }
      : {}),
    // the crossing: derived from the ford the map lays, so the two cannot disagree
    ...(world.bridge === true && map === 'showcase'
      ? { deck: showcaseDeck(undefined, rings) }
      : {}),
    // ★ A live cast keeps the town on tick 1 and the world systems; the patrols and top-ups go.
    minds: opts.cast !== undefined,
  })
  const cast = opts.cast === undefined ? null : await opts.cast()
  handler =
    cast === null ? scriptedOnTick : cast.attach({ loop, store, config, db, world: scriptedOnTick })

  let gateway: Gateway
  try {
    gateway = await createGateway({
      dbPath,
      port: opts.port ?? DEV_PORT,
      terrain,
      config,
      db,
      paused: () => loop.paused,
      ...(opts.narratorDbPath === undefined ? {} : { narratorDbPath: opts.narratorDbPath }),
      ...(opts.staticDir === undefined ? {} : { staticDir: opts.staticDir }),
      ...(opts.agentDbDir === undefined ? {} : { agentDbDir: opts.agentDbDir }),
    })
  } catch (e) {
    // Nothing outside this function has a handle to stop the cast or close the db it opened.
    await cast?.stop()
    db.close()
    throw e
  }

  // The cursor starts at the END of the log: a resumed world would otherwise re-publish every
  // thought the town ever had.
  let lastSeq = store.lastSeq()
  const lastVerb = new Map<string, string>()
  const tickOnce = (): void => {
    loop.step()
    if (cast !== null) return
    for (const ev of store.readFrom(lastSeq)) {
      lastSeq = ev.seq
      if (ev.type !== 'action_started') continue
      const p = ev.payload as { agentId: string; verb: string }
      if (lastVerb.get(p.agentId) === p.verb) continue
      lastVerb.set(p.agentId, p.verb)
      publishThought(db, {
        tick: ev.tick,
        agentId: p.agentId,
        text: THOUGHT_LINES[p.verb] ?? 'Hm.',
      })
    }
  }
  // DEV_FAST_FORWARD=<tick>: step synchronously to a moment before the real-time cadence starts.
  const ff = Number(process.env.DEV_FAST_FORWARD ?? '0')
  if (Number.isFinite(ff) && ff > 0) {
    while (loop.state.tick < ff) tickOnce()
    console.log(`dev world: fast-forwarded to tick ${loop.state.tick}`)
  }

  // A self-arming beat, not an interval: the operator's dial (POST /admin/speed, /admin/pause)
  // moves `loop.speed` and `loop.paused`, and an interval already armed cannot be re-timed.
  const beatMs = opts.realMsPerTick ?? DEV_MS_PER_TICK
  const beat = (): void => {
    if (!loop.paused) tickOnce()
    arm()
  }
  const arm = (): void => {
    timer = setTimeout(beat, beatMs / loop.speed)
  }
  let timer: ReturnType<typeof setTimeout>
  arm()

  return {
    gateway,
    loop,
    terrain,
    resumedAtTick: resumed ? resumed.state.tick : null,
    live: cast !== null,
    ops: cast?.ops ?? null,
    tick: tickOnce,
    submitLaw: (path, value) => {
      applyLaw(lawQueue, path, value)
    },
    stop: async () => {
      clearTimeout(timer)
      // The cast first: a mind holding a promise on an intent the loop will never step never returns.
      await cast?.stop()
      await gateway.close()
      db.close()
    },
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = parseWorldEnv()
  void startDevWorld({ ingest: true, world: env }).then(({ gateway }) => {
    const showcase = env.map === 'showcase'
    console.log(
      `dev world: interiors=${env.interiors ? 'on' : 'off'} builders=${env.builders && showcase ? 'on (SCRIPTED masons, real build verb)' : 'off'}` +
        ` bridge=${env.bridge && showcase ? `on (a deck at the ford ${JSON.stringify(showcaseDeck(undefined, env.rings))})` : 'off'}` +
        ` joint=${env.jointBuild && showcase ? 'on (a mason lends a hand at walls in reach)' : 'off'}`,
    )
    console.log(`dev world: the town is awake on ws://localhost:${gateway.port}/ws`)
  })
}

import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DEFAULT_CONFIG, TOWN_RINGS_GENESIS, simTimeFromTick, type SimConfig } from '@sj/shared'
import {
  EventStore,
  RngStreams,
  TickLoop,
  genesisState,
  makeFixtureMap,
  openDb,
  replayLatest,
  type TickHandler,
  type TileId,
} from '@sj/engine'
import { openForgeDb } from '@sj/forge'
import { createGateway, type Gateway } from './server.js'
import { ensureObserverTables, publishThought } from './observer.js'
import { foundersFor, makeFoundersOnTick, townStructuresFor } from './founders.js'
import { ingestLibraryArt, ingestProductionArt, ingestTerrainArt } from './ingestArt.js'
import { showcaseDeck, showcaseTerrain } from './showcaseMap.js'
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

// The founders showcase is an art demo: freeze weather to sunny so the storm
// grading matrix never greys the town (seed g6 rolls rain within the first day).
export const SHOWCASE_CONFIG: SimConfig = {
  ...DEFAULT_CONFIG,
  weather: { ...DEFAULT_CONFIG.weather, hourlyChangeChance: 0 },
  construction: { ...DEFAULT_CONFIG.construction, houseTicks: DEV_HOUSE_TICKS },
  structures: {
    ...DEFAULT_CONFIG.structures,
    recipes: {
      ...DEFAULT_CONFIG.structures.recipes,
      house: { ...DEFAULT_CONFIG.structures.recipes.house!, durationTicks: DEV_HOUSE_TICKS },
    },
  },
}

// The G6 "live thought" source — human framing, no AI vocabulary.
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
  /** The tick a resumed town woke at, or `null` when this boot is a new day 0. */
  resumedAtTick: number | null
  /** True when a live cast is driving the bodies. `false` is the scripted puppets, and the
   *  distinction is the whole seam — a caller that cannot read it cannot tell the two apart. */
  live: boolean
  /** ONE WHOLE TICK the way the wall clock takes it: the loop step AND the observer scan that
   *  follows it. `loop.step()` is most of a tick and not all of it. */
  tick(): void
  stop(): Promise<void>
}

/**
 * A port, not an import: this file stays free of `@sj/agents` and its onnxruntime. `attach` runs
 * after the loop exists and before the first tick — each needs the other first.
 */
export type LiveCast = {
  attach(deps: {
    loop: TickLoop
    store: EventStore
    config: SimConfig
    /** The world db, in process. A live cast publishes what its minds actually thought into
     *  `observer_thoughts`, which is the same channel the scripted canned lines used. */
    db: ReturnType<typeof openDb>
    /** The scripted handler: the tick-1 town, the world systems, and nothing else when the
     *  cast is attached (`FoundersOpts.minds`). A live cast wraps it, never replaces it. */
    world: TickHandler
  }): TickHandler
  stop(): Promise<void>
}

/**
 * Agent memory is a separate `<id>.db` per mind, not the world db, so world and mind are wiped
 * as ONE unit. Only `*.db` goes — the rest of the directory is not this function's to delete.
 */
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

/**
 * `scripted` is a FROZEN TEST FIXTURE — `g6.test.ts` and `devWorld.test.ts` hash the world it
 * folds, so it may never change. The library default stays `scripted`; a person gets the product.
 */
export type DevMapKind = 'scripted' | 'showcase'
/** For `startDevWorld()` called as a library, i.e. by the gates. Never by a person. */
export const DEV_MAP_DEFAULT: DevMapKind = 'scripted'
/** For anyone starting a world to LOOK at it. */
export const DEV_MAP_HUMAN: DevMapKind = 'showcase'

export function devTerrain(
  map: DevMapKind = DEV_MAP_DEFAULT,
  rings: number = TOWN_RINGS_GENESIS,
): ReturnType<typeof makeFixtureMap> {
  return map === 'showcase' ? showcaseTerrain(undefined, rings) : makeFixtureMap()
}

/**
 * `state.origin` is where the array's (0, 0) sits in the AUTHORED frame, and the engine's claim
 * seam hangs off it. The frozen fixture gets none deliberately — an absent field keeps its fold
 * byte-identical.
 */
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
    map?: DevMapKind
    /** How many rings of blocks the showcase town is platted for; ignored by `scripted`, which
     *  is frozen. Every dimension of the map derives from it. */
    rings?: number
    /** dev/demo only: tired founders go indoors and come out again. Off by default, so every
     *  existing gate folds exactly the events it always did. */
    interiors?: boolean
    /** dev/demo only: the founders raise houses on claimed plots through the real `build` verb.
     *  Off by default — the frozen fixture has no lattice to build on. */
    builders?: boolean
    /** dev/demo only: how many lamp posts one founder raises along the street and keeps fed.
     *  ABSENT by default — the stream asks for them; no gate does. */
    lamps?: number
    /** dev/demo only: one founder decks the ford, joining the blocks across the water to the
     *  town. Off by default — only the showcase has a ford. */
    bridge?: boolean
    /** dev/demo only: a mason beside somebody's half-raised walls lends a hand. Off by default —
     *  see `jointBuild` on `FoundersOpts` for the numbers. */
    jointBuild?: boolean
    /** The narrator db, opened readonly. Absent, every narrated surface — chapters, milestones,
     *  moments — answers typed-empty. */
    narratorDbPath?: string
    /** The built `@sj/web`. Present, this process is the whole stream — world, socket and
     *  viewer on one port. Absent, it is the API/socket half and vite proxies to it. */
    staticDir?: string
    /** Per-mind memory dbs (`<id>.db`). Served read-only by the gateway, and — see
     *  `wipeAgentMemory` — thrown away together with the world when `fresh` is asked for. */
    agentDbDir?: string
    /**
     * Throw the town away and start a new day 0. Off by default: a function handed a path to a
     * database does not get to delete it without being asked.
     */
    fresh?: boolean
    /**
     * Minds instead of puppets; absent, the founders are the scripted cast. A FACTORY, not a
     * cast: one built before this call has already opened the per-mind dbs that `fresh` deletes.
     */
    cast?: () => Promise<LiveCast>
  } = {},
): Promise<DevWorld> {
  const dbPath = opts.dbPath ?? DEV_DB_PATH
  const fresh = opts.fresh === true
  mkdirSync(dirname(dbPath), { recursive: true })
  if (fresh) {
    for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true })
    const minds = wipeAgentMemory(opts.agentDbDir)
    console.log(
      `dev world: FRESH — the world db was deleted${minds > 0 ? ` along with ${minds} agent memory db(s)` : ''}`,
    )
  }

  const config = SHOWCASE_CONFIG
  const map = opts.map ?? DEV_MAP_DEFAULT
  const rings = opts.rings ?? TOWN_RINGS_GENESIS
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
      // A scratchpad that lost its files used to abort the whole ingest silently; say which.
      for (const e of gone) console.log(`dev world:   NO ART for ${e.kind} — ${e.detail ?? ''}`)
    } catch (e) {
      console.log(
        `dev world: production art not ingested — ${e instanceof Error ? e.message : String(e)}`,
      )
    }
    // the premade library: the furniture the interior scenes place on their slots
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
  // Terrain and buildings are read from the SAME map kind AND the same ring count, so the town
  // can never again be an overlay of two unrelated layouts.
  const structures = townStructuresFor(map, rings)

  /**
   * The fold starts at the latest snapshot, never at genesis, so resume is flat in world age.
   * `WorldState.terrain` rides in the snapshot, which is why the gateway must be handed THIS
   * array and not `devTerrain(map, rings)` recomputed from the environment.
   */
  const store = new EventStore(db)
  const resumed = store.lastSeq() > 0 ? replayLatest(store, config, genesisTerrain, seed) : null
  const terrain = resumed ? resumed.state.terrain : genesisTerrain
  const rng = resumed ? resumed.rng : new RngStreams(seed)

  // Said out loud on every boot, in every path, because a lane that does not know which world
  // it is looking at reports a finding about the wrong one.
  console.log(
    `dev world: map=${map} rings=${map === 'showcase' ? rings : 'n/a (frozen fixture)'} ` +
      `terrain=${terrain[0]?.length ?? 0}x${terrain.length} structures=${structures.length}` +
      (map === 'scripted' ? '  ← THE FROZEN G6 TEST FIXTURE, not the product town' : ''),
  )
  if (resumed) {
    const t = simTimeFromTick(resumed.state.tick)
    // A resumed world says which tick it woke at rather than pretending it never stopped: a
    // SIGKILL rolls back the tick that was in flight, so this number can be one behind.
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
  // the founders showcase town
  const scriptedOnTick = makeFoundersOnTick(config, rng, () => loop.state, {
    // foundersFor is identity on an unowned town, so the scripted arm is byte-identical.
    interiors: opts.interiors === true,
    structures,
    founders: foundersFor(structures),
    // the showcase town is what a viewer opens, and an empty storeroom is why the room
    // card's holdings grid had never been seen
    holdings: map === 'showcase',
    // and a lattice nobody ever builds in is why merge train 3 called a ring-3 town empty
    builders: opts.builders === true && map === 'showcase',
    // two pairs of hands on one roof — reachable, and off unless asked for
    jointBuild: opts.jointBuild === true && map === 'showcase',
    // the streets, lit: one founder raises lamp posts on the verge and keeps them fed.
    // ABSENT unless asked for, so every landed gate folds exactly the world it always did.
    ...(opts.lamps !== undefined && opts.lamps > 0 && map === 'showcase'
      ? { lamps: opts.lamps }
      : {}),
    // the crossing: derived from the ford the map lays, so the two cannot disagree
    ...(opts.bridge === true && map === 'showcase' ? { deck: showcaseDeck(undefined, rings) } : {}),
    // ★ AND THE PUPPET STRINGS COME OFF THE MOMENT A LIVE CAST IS ATTACHED. The town on
    // tick 1 and the world systems stay; the patrols, the masons and the need top-ups go.
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

  // The cursor starts at the END of the log, not at 0: a resumed world would otherwise
  // re-publish every thought the town ever had. A live cast publishes real ones to the same
  // table, so these canned lines go off.
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
  // DEV_FAST_FORWARD=<tick>: step the world synchronously to a moment (e.g. 490 = Day 0
  // 08:10 daylight) before the real-time cadence starts — screenshot/QA convenience only
  const ff = Number(process.env.DEV_FAST_FORWARD ?? '0')
  if (Number.isFinite(ff) && ff > 0) {
    while (loop.state.tick < ff) tickOnce()
    console.log(`dev world: fast-forwarded to tick ${loop.state.tick}`)
  }

  const timer = setInterval(tickOnce, opts.realMsPerTick ?? DEV_MS_PER_TICK)

  return {
    gateway,
    loop,
    terrain,
    resumedAtTick: resumed ? resumed.state.tick : null,
    live: cast !== null,
    tick: tickOnce,
    stop: async () => {
      clearInterval(timer)
      // The cast first: a mind holding a promise on an intent the loop will never step is a
      // mind that never returns, and a reflection half-written is a night paid for twice.
      await cast?.stop()
      await gateway.close()
      db.close()
    },
  }
}

// CLI switches, read HERE and nowhere else, so no test's world can drift with an env var:
//   SJ_MAP=scripted   ask for the frozen G6 fixture BY NAME (the product town otherwise)
//   SJ_RINGS=3        plat the showcase town for three rings of blocks instead of one
//   SJ_INTERIORS=0    keep the founders out of doors (they go home and sleep otherwise)
//   SJ_BUILDERS=0     stop the founders raising houses (they build on claimed plots otherwise)
//   SJ_BRIDGE=0       leave the river uncrossed (one founder decks the ford otherwise)
//   SJ_JOINT=1        let a mason lend a hand at a neighbour's walls (off by default for a
//                     measured reason — see `jointBuild` on `FoundersOpts`)
//   SJ_FRESH=1        throw the town on disk away and start a new day 0
//
// The human path defaults to the product town and to interiors on; the LIBRARY defaults stay
// `scripted` and interiors off, because `g6.test.ts` and `devWorld.test.ts` hash exactly that.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const map: DevMapKind = process.env.SJ_MAP === 'scripted' ? 'scripted' : DEV_MAP_HUMAN
  const interiors = process.env.SJ_INTERIORS !== '0'
  const builders = process.env.SJ_BUILDERS !== '0'
  const bridge = process.env.SJ_BRIDGE !== '0'
  const jointBuild = process.env.SJ_JOINT === '1'
  const fresh = process.env.SJ_FRESH === '1'
  const asked = Number(process.env.SJ_RINGS ?? TOWN_RINGS_GENESIS)
  const rings = Number.isInteger(asked) && asked >= 1 ? asked : TOWN_RINGS_GENESIS
  if (rings !== asked)
    console.log(`dev world: SJ_RINGS=${process.env.SJ_RINGS} is not a ring count; using ${rings}`)
  void startDevWorld({
    ingest: true,
    map,
    interiors,
    builders,
    bridge,
    jointBuild,
    rings,
    fresh,
  }).then(({ gateway }) => {
    console.log(
      `dev world: interiors=${interiors ? 'on' : 'off'} builders=${builders && map === 'showcase' ? 'on (SCRIPTED masons, real build verb)' : 'off'}` +
        ` bridge=${bridge && map === 'showcase' ? `on (a deck at the ford ${JSON.stringify(showcaseDeck(undefined, rings))})` : 'off'}` +
        ` joint=${jointBuild && map === 'showcase' ? 'on (a mason lends a hand at walls in reach)' : 'off'}`,
    )
    console.log(`dev world: the town is awake on ws://localhost:${gateway.port}/ws`)
  })
}

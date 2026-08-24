import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DEFAULT_CONFIG, TOWN_RINGS_GENESIS, simTimeFromTick, type SimConfig } from '@sj/shared'
import {
  EventStore, RngStreams, TickLoop, genesisState, makeFixtureMap, openDb, replayLatest,
  type TileId,
} from '@sj/engine'
import { openForgeDb } from '@sj/forge'
import { createGateway, type Gateway } from './server.js'
import { ensureObserverTables, publishThought } from './observer.js'
import { foundersFor, makeFoundersOnTick, townStructuresFor } from './founders.js'
import { ingestLibraryArt, ingestProductionArt, ingestTerrainArt } from './ingestArt.js'
import { showcaseDeck, showcaseTerrain } from './showcaseMap.js'
import { devWorldOrigin } from './devTown.js'
import { assertSameWorld, ensureWorldMetaTable, readWorldMeta, writeWorldMeta } from './worldMeta.js'

export const DEV_DB_PATH = 'data/dev-world.db'
export const DEV_PORT = 8787
export const DEV_MS_PER_TICK = 2500
export const DEV_SEED = 'g6'
export const DEV_SNAPSHOT_EVERY_TICKS = 60

// ★ A HOUSE YOU CAN WATCH GO UP. `construction.houseTicks` is two sim days by default, which
// at the dev world's 2.5 s tick is two REAL HOURS for one roof — a builder nobody would ever
// see. 240 is the declared fixture dial `townGrowth.test.ts` and `farBank.test.ts` both use,
// for the same reason and to the same number, so the dev world and the two landed proofs speak
// one figure. It changes how LONG a build takes and nothing about WHERE it goes: `buildTicks`
// is read after the site is settled. `config.test.ts` requires the dial and the recipe's
// `durationTicks` to stay equal, so they move together.
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
      house: { ...DEFAULT_CONFIG.structures.recipes['house']!, durationTicks: DEV_HOUSE_TICKS },
    },
  },
}

// The G6 "live thought" source — human framing, no AI vocabulary.
export const THOUGHT_LINES: Record<string, string> = {
  walk: 'The path is clear enough.',        till: 'This earth wants turning.',
  plant: 'Wheat in, before the season slips.', harvest: 'Ready at last.',
  fish: 'The river owes me a dinner.',      eat: 'That settles the stomach.',
  sleep: 'My eyes are heavy.',              give: 'They need it more than I do.',
  take: 'The storehouse can spare this.',   build: 'Beam by beam it rises.',
}

export type DevWorld = {
  gateway: Gateway; loop: TickLoop
  /** The map the world actually runs on — the resumed one when there is a town on disk, and
   *  the same array the gateway was handed, so the viewer can never render a different map. */
  terrain: TileId[][]
  /** The tick a resumed town woke at, or `null` when this boot is a new day 0. */
  resumedAtTick: number | null
  stop(): Promise<void>
}

/**
 * ★ FRESH MUST MEAN FRESH FOR THE MINDS TOO, OR THE TOWN GETS AMNESIA BACKWARDS.
 *
 * Agent memory is not in the world db — it is a separate `<id>.db` per mind, which the world
 * delete never touched. That is harmless only for as long as the cast is scripted. The moment
 * live minds are wired to this gateway, a fresh boot would hand you the one state that is
 * worse than either a clean reset or a clean resume: the buildings gone, the day counter back
 * to 0, and every mind still remembering all of it.
 *
 * World and mind are wiped as ONE unit. Only `*.db` goes — anything else in the directory is
 * not this function's to delete.
 */
function wipeAgentMemory(agentDbDir: string | undefined): number {
  if (agentDbDir === undefined) return 0
  let gone = 0
  let names: string[]
  try { names = readdirSync(agentDbDir) } catch { return 0 }
  for (const name of names) {
    if (!/\.db(-wal|-shm)?$/.test(name)) continue
    rmSync(join(agentDbDir, name), { force: true })
    gone += 1
  }
  return gone
}

/**
 * ★ THE TWO DEV WORLDS, AND WHICH ONE IS THE PRODUCT.
 *
 * | kind | terrain | town | what it is |
 * |---|---|---|---|
 * | `scripted` | `makeFixtureMap()`, 64×64 | 6 hand-placed buildings (`TOWN_STRUCTURES`) | **A FROZEN TEST FIXTURE.** G1, G2 and G6 hash the world it folds, so it may never change. Four of its six kinds — `wagon`, `shed`, `scaffolding`, `standing_stone` — are the four the art ingest reports `NO ART` for, so two thirds of this town draws as untextured placeholder. |
 * | `showcase` | `showcaseTerrain()`, 76×76 at one ring | the 11 the grammar plats | **THE PRODUCT.** Same `makeCityTemplate` genesis calls, same anchor, same eleven buildings, real art on all of them but the well and the fire pit. |
 *
 * ★ AND THE DEFAULT USED TO BE THE FIXTURE. `startDevWorld()` with no `map:` handed a caller
 * the frozen G6 town, silently. The three-defects lane found the cost: it measured the ambient
 * canopy at 38 of 140 quads outside the ground on the fixture and 0 outside on the showcase —
 * same code, opposite verdicts, decided entirely by which map had loaded. Several lanes met the
 * looking law honestly and may have been looking at a fixture.
 *
 * The LIBRARY default stays `scripted`, because `g6.test.ts` and `devWorld.test.ts` call
 * `startDevWorld()` bare and their gates hash exactly that world. The HUMAN-FACING default — the
 * CLI at the bottom of this file — is the product, and the boot line now says which map loaded
 * and why in every case. A fixture must be asked for by name, not received by silence.
 */
export type DevMapKind = 'scripted' | 'showcase'
/** For `startDevWorld()` called as a library, i.e. by the gates. Never by a person. */
export const DEV_MAP_DEFAULT: DevMapKind = 'scripted'
/** For anyone starting a world to LOOK at it. */
export const DEV_MAP_HUMAN: DevMapKind = 'showcase'

export function devTerrain(
  map: DevMapKind = DEV_MAP_DEFAULT, rings: number = TOWN_RINGS_GENESIS,
): ReturnType<typeof makeFixtureMap> {
  return map === 'showcase' ? showcaseTerrain(undefined, rings) : makeFixtureMap()
}

/**
 * ★ THE DEV WORLD'S GENESIS, WHICH HAS TO SAY WHERE IT STANDS.
 *
 * `state.origin` is where the array's (0, 0) sits in the AUTHORED frame, and the engine's whole
 * claim seam hangs off it: `townSquareOf` reads `TOWN_SQUARE − origin`. The showcase town is
 * the same `makeCityTemplate` town at a different array offset, so without an origin the engine
 * looked for the square ten rows north of where it is, landed on a paved tile of the plaza's
 * street ring, and answered confidently about a town that is not there. `devWorldOrigin`
 * derives the offset; `devTown.ts` carries the proof that it is a derivation.
 *
 * ★ THE FROZEN FIXTURE GETS NO ORIGIN, deliberately. `makeFixtureMap` is 64 tiles of meadow
 * with six buildings on it and no lattice anywhere — a world with no town in it, which is
 * exactly the domain `townSquareOf` returns null for. Leaving the field absent is what keeps
 * G1, G2 and G6 folding byte-identical worlds.
 */
export function devGenesisState(
  config: SimConfig, terrain: ReturnType<typeof makeFixtureMap>,
  map: DevMapKind = DEV_MAP_DEFAULT, rings: number = TOWN_RINGS_GENESIS,
) {
  const base = genesisState(config, terrain)
  return map === 'showcase' ? { ...base, origin: devWorldOrigin(rings) } : base
}

export async function startDevWorld(
  opts: {
    dbPath?: string; port?: number; realMsPerTick?: number; seed?: string; ingest?: boolean
    map?: DevMapKind
    /** ★ HOW MANY RINGS OF BLOCKS THE SHOWCASE TOWN IS PLATTED FOR. Ignored by `scripted`,
     *  which is frozen. Every dimension of the map derives from it — the world-growth lane
     *  removed the ceiling and nothing in the running app could reach past ring 1 until this
     *  existed. Ring 3 is 136 + 16 = 152 tiles square, which bakes past 2048 px and is the
     *  case the chunked ground was written for. */
    rings?: number
    /** dev/demo only (G10 human pass): tired founders go indoors and come out again.
     *  Off by default, so every existing gate folds exactly the events it always did. */
    interiors?: boolean
    /** dev/demo only: the founders raise houses on plots the town claims for them, through the
     *  real `build` verb. Off by default; the frozen fixture has no lattice to build on and
     *  every existing gate folds exactly the events it always did. */
    builders?: boolean
    /** dev/demo only: one founder lays a deck over the ford before it joins the masons, and the
     *  fourteen plattable blocks across the water join the town. Off by default; only the
     *  showcase has a ford, and every existing gate folds exactly the events it always did. */
    bridge?: boolean
    /** dev/demo only: a mason beside somebody's half-raised walls lends a hand instead of
     *  walking to the next plot. Off by default — the hands are real and the calendar does not
     *  know it; see `jointBuild` on `FoundersOpts` for the numbers. */
    jointBuild?: boolean
    /** C7's narrator.db. Absent, every narrated surface — chapters, milestones, moments —
     *  answers typed-empty, which is why the timeline marks and the filmstrip had never been
     *  seen with data. The gateway already opens it readonly; the dev world could not ask. */
    narratorDbPath?: string
    /** The built `@sj/web`. Present, this process is the whole stream — world, socket and
     *  viewer on one port. Absent, it is the API/socket half and vite proxies to it. */
    staticDir?: string
    /** Per-mind memory dbs (`<id>.db`). Served read-only by the gateway, and — see
     *  `wipeAgentMemory` — thrown away together with the world when `fresh` is asked for. */
    agentDbDir?: string
    /**
     * ★ THROW THE TOWN AWAY AND START A NEW DAY 0. Off by default, and that default is the
     * whole point of this option existing.
     *
     * This function used to `rmSync` the world db unconditionally, so every boot — every
     * deploy, every crash, every `docker restart` — was a new town. The event log held every
     * fact the old one ever had and nothing read it back. A function handed a path to a
     * database does not get to delete it without being asked.
     */
    fresh?: boolean
  } = {},
): Promise<DevWorld> {
  const dbPath = opts.dbPath ?? DEV_DB_PATH
  const fresh = opts.fresh === true
  mkdirSync(dirname(dbPath), { recursive: true })
  if (fresh) {
    for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true })
    const minds = wipeAgentMemory(opts.agentDbDir)
    console.log(`dev world: FRESH — the world db was deleted${minds > 0 ? ` along with ${minds} agent memory db(s)` : ''}`)
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
    } finally { probe.close() }
  }

  const forgeDb = openForgeDb(dbPath) // migrate forge assets/jobs tables for the push loop + hot-swap demo
  if (opts.ingest === true) {
    // load the approved production art so the town wakes with its real cast + buildings
    // (CLI default; tests skip the cost). Idempotent: unchanged bytes register nothing, so a
    // resumed town does not grow a second copy of the ~6 MB art cache on every boot.
    const tiles = await ingestTerrainArt(forgeDb) // code-painted, offline, $0 — never throws on a missing root
    console.log(`dev world: ingested terrain tiles (${tiles.length} records, road strip included)`)
    try {
      const entries = await ingestProductionArt(forgeDb)
      const gone = entries.filter((e) => e.action === 'missing')
      console.log(`dev world: ingested production art (${entries.length - gone.length} of ${entries.length} assets)`)
      // A scratchpad that lost its files used to abort the whole ingest silently; say which.
      for (const e of gone) console.log(`dev world:   NO ART for ${e.kind} — ${e.detail ?? ''}`)
    } catch (e) {
      console.log(`dev world: production art not ingested — ${e instanceof Error ? e.message : String(e)}`)
    }
    // the C13 premade library: the furniture the interior scenes place on their slots
    try {
      const lib = await ingestLibraryArt(forgeDb)
      console.log(`dev world: ingested library art (${lib.length} items, furniture included)`)
    } catch (e) {
      console.log(`dev world: library art not ingested — ${e instanceof Error ? e.message : String(e)}`)
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
   * ★ RESUME IS NOT A NEW FUNCTION. IT IS THE ONE THE ENGINE ALREADY HAS, FINALLY CALLED.
   *
   * `replayLatest` loads the latest snapshot — state AND rng cursor — folds the events after
   * it, and cross-checks the rng checkpoint's tick against the folded tick, throwing rather
   * than resuming skewed. It has been in `engine/src/replay.ts` all along with exactly one
   * caller, and that caller was a gate script.
   *
   * The fold starts at the latest snapshot, never at genesis, so this is flat in world age:
   * at most `DEV_SNAPSHOT_EVERY_TICKS` ticks of events however old the town is.
   *
   * ★ AND THE TERRAIN COMES BACK WITH IT. `WorldState.terrain` rides in the snapshot, so the
   * resumed map is the town's real one — which is exactly why the gateway must be handed THIS
   * array and not `devTerrain(map, rings)` recomputed from the environment.
   */
  const store = new EventStore(db)
  const resumed = store.lastSeq() > 0 ? replayLatest(store, config, genesisTerrain, seed) : null
  const terrain = resumed ? resumed.state.terrain : genesisTerrain
  const rng = resumed ? resumed.rng : new RngStreams(seed)

  // Said out loud on every boot, in every path, because a lane that does not know which world
  // it is looking at reports a finding about the wrong one.
  console.log(
    `dev world: map=${map} rings=${map === 'showcase' ? rings : 'n/a (frozen fixture)'} `
    + `terrain=${terrain[0]?.length ?? 0}x${terrain.length} structures=${structures.length}`
    + (map === 'scripted' ? '  ← THE FROZEN G6 TEST FIXTURE, not the product town' : ''),
  )
  if (resumed) {
    const t = simTimeFromTick(resumed.state.tick)
    // A resumed world says which tick it woke at rather than pretending it never stopped: a
    // SIGKILL rolls back the tick that was in flight, so this number can be one behind.
    console.log(
      `dev world: RESUMED at tick ${resumed.state.tick} — year ${t.year} ${t.season} day ${t.dayOfSeason}, `
      + `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}, `
      + `${Object.keys(resumed.state.structures).length} structures, `
      + `${Object.keys(resumed.state.agents).length} townsfolk, ${resumed.seq} events`,
    )
  } else {
    console.log('dev world: a new day 0 — no town on disk')
  }

  const loop: TickLoop = new TickLoop({
    store, state: resumed ? resumed.state : devGenesisState(config, terrain, map, rings), rng, config,
    snapshotEveryTicks: DEV_SNAPSHOT_EVERY_TICKS,
    // the founders showcase town
    onTick: makeFoundersOnTick(config, rng, () => loop.state, {
      // foundersFor is identity on an unowned town, so the scripted arm is byte-identical.
      interiors: opts.interiors === true, structures, founders: foundersFor(structures),
      // the showcase town is what a viewer opens, and an empty storeroom is why the room
      // card's holdings grid had never been seen
      holdings: map === 'showcase',
      // and a lattice nobody ever builds in is why merge train 3 called a ring-3 town empty
      builders: opts.builders === true && map === 'showcase',
      // two pairs of hands on one roof — reachable, and off unless asked for
      jointBuild: opts.jointBuild === true && map === 'showcase',
      // the crossing: derived from the ford the map lays, so the two cannot disagree
      ...(opts.bridge === true && map === 'showcase' ? { deck: showcaseDeck(undefined, rings) } : {}),
    }),
  })

  const gateway = await createGateway({
    dbPath, port: opts.port ?? DEV_PORT, terrain, config, db, narratorDbPath: opts.narratorDbPath,
    ...(opts.staticDir === undefined ? {} : { staticDir: opts.staticDir }),
    ...(opts.agentDbDir === undefined ? {} : { agentDbDir: opts.agentDbDir }),
  })

  // Scripted thoughts: when an actor's chosen intent verb changes, it "thinks" a line.
  // ★ The cursor starts at the END of the log, not at 0: a resumed world would otherwise scan
  // its whole history on its first tick and re-publish every thought the town ever had.
  let lastSeq = store.lastSeq()
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
    gateway, loop, terrain, resumedAtTick: resumed ? resumed.state.tick : null,
    stop: async () => {
      clearInterval(timer)
      await gateway.close()
      db.close()
    },
  }
}

// CLI switches, read HERE and nowhere else, so no test's world can drift with an env var:
//   SJ_DEV_MAP=scripted   ask for the frozen G6 fixture BY NAME (the product town otherwise)
//   SJ_DEV_RINGS=3        plat the showcase town for three rings of blocks instead of one
//   SJ_DEV_INTERIORS=0    keep the founders out of doors (they go home and sleep otherwise)
//   SJ_DEV_BUILDERS=0     stop the founders raising houses (they build on claimed plots otherwise)
//   SJ_DEV_BRIDGE=0       leave the river uncrossed (one founder decks the ford otherwise)
//   SJ_DEV_JOINT=1        let a mason lend a hand at a neighbour's walls (OFF by default, and
//                         the only default here that is off for a MEASURED reason rather than
//                         a conservative one — see `jointBuild` on `FoundersOpts`)
//   SJ_FRESH=1            throw the town on disk away and start a new day 0
//
// ★ AND INTERIORS DEFAULT ON FOR A PERSON, for the same reason `showcase` does. Three
// integration trains in a row reported no interior seen; two of them had the surface switched
// off by silence and the third watched the cast collapse before reaching a door. A viewer who
// runs this is here to see the town live in itself. The LIBRARY default stays off — `g6` and
// `devWorld.test.ts` hash exactly the world they always folded.
//
// ★ THE HUMAN PATH DEFAULTS TO THE PRODUCT. It used to default to the fixture, and a lane that
// ran `pnpm --filter @sj/gateway dev:world` and looked at what came up was looking at six
// hand-placed buildings, four of them with no art, on a 64×64 map the grammar never drew.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const map: DevMapKind = process.env['SJ_DEV_MAP'] === 'scripted' ? 'scripted' : DEV_MAP_HUMAN
  const interiors = process.env['SJ_DEV_INTERIORS'] !== '0'
  const builders = process.env['SJ_DEV_BUILDERS'] !== '0'
  const bridge = process.env['SJ_DEV_BRIDGE'] !== '0'
  const jointBuild = process.env['SJ_DEV_JOINT'] === '1'
  const fresh = process.env['SJ_FRESH'] === '1'
  const asked = Number(process.env['SJ_DEV_RINGS'] ?? TOWN_RINGS_GENESIS)
  const rings = Number.isInteger(asked) && asked >= 1 ? asked : TOWN_RINGS_GENESIS
  if (rings !== asked) console.log(`dev world: SJ_DEV_RINGS=${process.env['SJ_DEV_RINGS']} is not a ring count; using ${rings}`)
  void startDevWorld({ ingest: true, map, interiors, builders, bridge, jointBuild, rings, fresh }).then(({ gateway }) => {
    console.log(`dev world: interiors=${interiors ? 'on' : 'off'} builders=${builders && map === 'showcase' ? 'on (SCRIPTED masons, real build verb)' : 'off'}`
      + ` bridge=${bridge && map === 'showcase' ? `on (a deck at the ford ${JSON.stringify(showcaseDeck(undefined, rings))})` : 'off'}`
      + ` joint=${jointBuild && map === 'showcase' ? 'on (a mason lends a hand at walls in reach)' : 'off'}`)
    console.log(`dev world: the town is awake on ws://localhost:${gateway.port}/ws`)
  })
}

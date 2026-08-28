// This is the whole live half. `@sj/town` reaches it only through serve.ts's dynamic import
// behind SJ_LIVE=1, which is what keeps the mind stack off the scripted path.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type Database from 'better-sqlite3'
import { DISCOVERY_EVENT, MINUTES_PER_DAY, type SimEvent } from '@sj/shared'
import type { TickHandler } from '@sj/engine'
import {
  EngineBridge,
  PREFLIGHT_ROUNDS,
  bootMinds,
  ensureChildren,
  needsHousehold,
  openAgentDb,
  preflightRefusal,
  runPreflight,
  wireBirths,
  resolveCast,
  FOUNDER_MINDS,
  type BootedMinds,
  type MindConfig,
  type MindSpec,
  type RuntimeSnapshot,
  type SeamArbiter,
} from '@sj/agents'
import {
  Embedder,
  LlmClient,
  MIND_MODEL,
  insertAlert,
  migrateLlmTables,
  projectDailySpend,
  reportReconciliation,
} from '@sj/llm'
import {
  CodexStore,
  ConstructStore,
  GENESIS_CODEX,
  makeArbiter,
  openArbiterDb,
  runConstructPass,
  type Codified,
  type Recipe,
} from '@sj/arbiter'
import { AssetCodex } from '@sj/forge'
import {
  NarratorStore,
  closeDay,
  makeNarratorLlm,
  openNarratorDb,
  type TranscriptRecord,
} from '@sj/narrator'
import { publishThought, type LiveCast } from '@sj/gateway'
import { createDiscoveryArt } from './discoveryCommission.js'

/** Dollars in a rolling 24 real hours, the budget a weeks-long stream is actually run on: one
 *  sim-day IS one real hour here, so this is the flow, not a lifetime. `SJ_SPEND_DAILY_USD`. */
const LIVE_SPEND_DAILY_USD = 3
/** Dollars over the town's whole life; 0 is none. Reaching it KILLS THE PROCESS: a stream that
 *  quietly stops thinking and keeps serving a town of statues is the costliest thing to discover. */
const LIVE_SPEND_STOP_USD = 50
/** The daily budget's window. */
const SPEND_DAY_MS = 24 * 60 * 60 * 1000
/** How often the ledger is read, in world ticks. At the dev world's 2.5 s tick this is every
 *  25 s of wall clock — far tighter than one turn, so nothing can outrun it. */
const LIVE_SPEND_CHECK_TICKS = 10
/** How often each mind's clock and half-run plan are written down. ~2 min of wall clock. */
const LIVE_RUNTIME_SAVE_TICKS = 48
/** The only event types `detectCandidates` reads. `events(type)` is indexed, so four narrow
 *  reads beat one full-log read whose rows the recognizer then drops. */
const RECOGNIZER_EVENTS = ['agent_moved', 'agent_spoke', 'agent_expressed', 'item_taken']
/** How many of a day's words the tier-2.5 pass is shown. A very loud day must not build an
 *  unbounded prompt; the most recent words are the ones a first is most likely to be in. */
const SEMANTIC_RECORD_CAP = 300
/** A container gives about ten seconds before SIGKILL; losing a night's reflection is survivable
 *  and hanging the shutdown is not. */
const REFLECTION_SETTLE_MS = 5_000
/** `dozeTicks` is the one `MIND_CONFIG` dial denominated in real seconds — it is an HTTP retry
 *  backoff — so it is the only one this world's 2 500 ms tick may rescale. */
const STREAM_MIND_CONFIG: Partial<MindConfig> = { dozeTicks: 6 }
/** The call ledger and the alerts. A `.db` beside the minds, so `SJ_FRESH=1` takes it too. */
export const LIVE_OPS_DB = '_ops.db'
/** Rulings and the codex, never in the world db: the gateway serves that one to strangers. In
 *  `agentDbDir` so `SJ_FRESH=1` resets the town's laws with the town, underscore-prefixed to stay
 *  out of the `<mindId>.db` namespace the amnesia guard walks. */
const LIVE_ARBITER_DB = '_arbiter.db'
/** Rendered into the adjudication prompt AND enforced against the answer, so a ruling can never
 *  mint a recipe out of a material nobody has a word for. */
const STREAM_VOCABULARY = {
  itemKinds: [
    'wood',
    'stone',
    'rope',
    'cloth',
    'fiber',
    'hide',
    'clay',
    'axe',
    'hoe',
    'knife',
    'seed_pouch',
    'waterskin',
    'bucket',
    'torch',
    'garment',
    'plank',
    'bread',
    'wheat',
    'fish',
    'venison',
    'rabbit_meat',
    'berries',
    'mushroom',
    'herb',
    'stew',
  ],
  structureKinds: ['house', 'storehouse', 'shed', 'wagon', 'well', 'fire_pit', 'bridge', 'grave'],
} as const
/** The sentence-transformer cache. `SJ_MODELS_DIR` moves it; nothing downloads at run time. */
const DEFAULT_MODELS_DIR = fileURLToPath(new URL('../../../data/models/', import.meta.url))

export type LiveCastOpts = {
  /** Directory of `<id>.db` files. Created if absent; wiped with the world on `SJ_FRESH=1`. */
  agentDbDir: string
  /** Where the chronicle is written. Absent, no day is narrated and the stream costs two fewer
   *  calls an hour. The gateway reads the same file, so both are handed one path. */
  narratorDbPath?: string
  minds?: readonly MindSpec[]
  /** Dollars over the town's life; 0 is none. Reaching it stops the minds and calls `onSpendStop`. */
  spendCapUsd?: number
  /** Dollars in a rolling 24 real hours. Reaching it stops the minds and calls `onSpendStop`. */
  spendDailyUsd?: number
  /** What a stream does when the cap lands. Default is a loud message and nothing else, so a
   *  test can assert the stop without taking the test runner down with it. */
  onSpendStop?: (spent: number, cap: number) => void
  /** The rate tripwire's window. A test cannot wait fifteen real minutes to prove a flow. */
  rateWindowRealMinutes?: number
  /** How many minds this town may hold; never fewer than its founders. `SJ_MAX_MINDS`. */
  maxMinds?: number
  /** Injected in tests, and handed the SAME ops db the cap is read off — a test whose fake
   *  client bills a different ledger proves nothing about the stop. */
  makeClient?: (opsDb: Database.Database, caller: string, agentId?: string) => LlmClient
  embedder?: { embed(t: string): Promise<Float32Array> }
  /** For a harness that cannot wait 120 ticks for the boredom floor. Absent in every real run. */
  mindConfig?: Partial<MindConfig>
  /** Never dispatch a live run without it — a provider that silently returns garbage has
   *  burned a lane before. Off only for a test, which spends nothing to preflight. */
  preflight?: boolean
  modelsDir?: string
  /** Only a test passes this: the real one needs the bridge and the tick, which do not exist
   *  until `attach`. */
  arbiter?: SeamArbiter
  /**
   * On by default: the arbiter fires only once the world has already refused an intent with
   * `unknown verb:`, so it is a per-NOVELTY call and not a per-turn one. `SJ_ARBITER=0` is off.
   */
  useArbiter?: boolean
  log?: (line: string) => void
}

/** A new town whose minds remember an older one is refused rather than served: it is strictly
 *  worse than either a clean reset or a clean resume. */
export function amnesiaRefusal(remembering: readonly { id: string; memories: number }[]): string {
  const who = remembering.map((r) => `${r.id} (${r.memories})`).join(', ')
  return [
    'stream: could not start — this is a new town at tick 0, and its minds remember an older one.',
    `        still holding memories: ${who}`,
    '        A world reset with the minds left standing is worse than either a clean reset or a',
    '        clean resume. Start both over with SJ_FRESH=1, or put the world db back.',
  ].join('\n')
}

/** Wait for something to stop being busy, but never for longer than `deadlineMs`. Returns whether
 *  it settled. */
export async function settle(
  busy: () => boolean,
  deadlineMs: number,
  pollMs = 200,
): Promise<boolean> {
  const until = Date.now() + deadlineMs
  while (busy()) {
    if (Date.now() >= until) return false
    await new Promise((r) => setTimeout(r, Math.min(pollMs, Math.max(1, until - Date.now()))))
  }
  return true
}

/**
 * A per-call cap cannot see a slow leak; this bounds spend per unit time.
 * PER MIND, because the bill scales with the cast and not with the world — a total ceiling would
 * false-fire the day somebody streams ten people.
 * 0.21 is 9.9x the measured 0.0212 $/mind/sim-day and 6.8x the worst measured 15-minute window.
 */
const LIVE_RATE_CEILING_USD_PER_MIND_DAY = 0.21
/** The projection window. Long enough that one reflection burst cannot carry it, short enough
 *  that a runaway dies in minutes. */
const LIVE_RATE_WINDOW_REAL_MINUTES = 15

/** The population ceiling, as a multiple of the founding cast: nothing else in the world stops
 *  the town growing, and every mind is another live bill. `SJ_MAX_MINDS`. */
const LIVE_MAX_MINDS_PER_FOUNDER = 3

function rateStopMessage(rate: number, ceiling: number, minds: number): string {
  return [
    `STREAM STOPPED: the live cast is spending $${rate.toFixed(4)}/hour, over its` +
      ` $${ceiling.toFixed(4)}/hour ceiling (${minds} mind(s) x` +
      ` $${LIVE_RATE_CEILING_USD_PER_MIND_DAY.toFixed(2)}).`,
    `        Measured over the last ${LIVE_RATE_WINDOW_REAL_MINUTES} real minutes. This is a RATE`,
    '        stop, not a budget — the town is nowhere near either line and is burning too fast.',
    '        Every mind is stopped and no further call will be made. The town on disk is intact.',
  ].join('\n')
}

function spendStopMessage(spent: number, cap: number): string {
  return [
    `STREAM STOPPED: the live cast has spent $${spent.toFixed(4)} of its $${cap.toFixed(2)} cap.`,
    '        Every mind is stopped and no further call will be made. The town on disk is intact',
    '        and `pnpm stream` will resume it with the scripted cast for $0.00/hour.',
  ].join('\n')
}

function dailyStopMessage(spent: number, budget: number): string {
  return [
    `STREAM STOPPED: the live cast has spent $${spent.toFixed(4)} of its` +
      ` $${budget.toFixed(2)} daily budget.`,
    '        Measured over the last 24 real hours. Every mind is stopped and no further call will',
    '        be made. The town on disk is intact. SJ_SPEND_DAILY_USD raises the budget.',
  ].join('\n')
}

/** The daily budget refuses a boot too, and BEFORE the pre-flight: a container that restarts on
 *  its own would otherwise pay for a pre-flight on every loop to be told the same thing. */
export function dailyReachedRefusal(spent: number, budget: number): string {
  return [
    `stream: could not start — this town has spent $${spent.toFixed(4)} of its` +
      ` $${budget.toFixed(2)} daily budget in the last 24 hours.`,
    '        The window rolls, so the budget frees itself as the oldest calls age out of it.',
    '        Nothing was spent to tell you this. SJ_SPEND_DAILY_USD raises the budget.',
    '        `pnpm stream` (no SJ_LIVE) resumes this same town scripted, for $0.00/hour.',
  ].join('\n')
}

/** The cap is per TOWN, not per process — the ledger resumes with the town, so a resumed boot can
 *  be over the line before its first tick, and is told so in one sentence rather than a trace. */
export function capReachedRefusal(spent: number, cap: number, agentDbDir: string): string {
  return [
    `stream: could not start — this town has already spent $${spent.toFixed(4)} of its` +
      ` $${cap.toFixed(2)} cap.`,
    '        The cap is per TOWN, not per process: the call ledger resumes with the world, so',
    '        restarting does not reset it. That is the point of an anomaly stop.',
    '        `pnpm stream` (no SJ_LIVE) resumes this same town scripted, for $0.00/hour.',
    `        SJ_FRESH=1 starts a new town and a new ledger, throwing away ${agentDbDir}.`,
  ].join('\n')
}

/** Total dollars in a call ledger, across every caller, since `sinceMs`. `sumCostUsd` is
 *  per-caller and the cap is not: five minds on two callers each would clear one ten times over. */
export function ledgerTotalUsd(db: Database.Database, sinceMs = 0): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(cost_usd), 0) AS total FROM llm_calls WHERE ts >= ?')
    .get(sinceMs) as { total: number }
  return row.total
}

/** Scoped to THIS boot's pre-flight rows: the ledger resumes with the town, so the whole sum
 *  would be the town's entire history rather than what the pre-flight cost. */
export function preflightCostUsd(db: Database.Database, since: number): number {
  const row = db
    .prepare(
      "SELECT COALESCE(SUM(cost_usd), 0) AS total FROM llm_calls WHERE caller = 'preflight' AND ts >= ?",
    )
    .get(since) as { total: number }
  return row.total
}

// A mind's clock and half-run plan between processes, keyed by the world tick it was taken at:
// a snapshot from AHEAD of the world is one of a tick SQLite rolled back.
function ensureRuntimeTable(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS mind_runtime (
    agent_id TEXT PRIMARY KEY, tick INTEGER NOT NULL, snapshot TEXT NOT NULL
  )`)
}

export function restorableSnapshot(
  row: { tick: number; snapshot: string } | undefined,
  worldTick: number,
): RuntimeSnapshot | null {
  if (row === undefined || row.tick > worldTick) return null
  try {
    return JSON.parse(row.snapshot) as RuntimeSnapshot
  } catch {
    return null
  }
}

const countMemories = (db: Database.Database): number => {
  try {
    return (db.prepare('SELECT COUNT(*) AS n FROM memories').get() as { n: number }).n
  } catch {
    return 0
  }
}

/** Build a cast of minds for `startDevWorld`. Async because the embedder load and the provider
 *  pre-flight both run first and either can refuse the whole run; everything that needs the world
 *  happens in `attach`, because a bridge needs the loop and the loop needs the bridge's handler. */
export async function createLiveCast(opts: LiveCastOpts): Promise<LiveCast> {
  const log =
    opts.log ??
    ((line: string) => {
      console.log(line)
    })
  const founders = opts.minds ?? FOUNDER_MINDS
  const maxMinds = Math.max(
    opts.maxMinds ?? founders.length * LIVE_MAX_MINDS_PER_FOUNDER,
    founders.length,
  )
  const cap = opts.spendCapUsd ?? LIVE_SPEND_STOP_USD
  const dailyBudget = opts.spendDailyUsd ?? LIVE_SPEND_DAILY_USD
  mkdirSync(opts.agentDbDir, { recursive: true })

  const opsDb = openAgentDb(join(opts.agentDbDir, LIVE_OPS_DB))
  migrateLlmTables(opsDb)
  opsDb.exec('CREATE INDEX IF NOT EXISTS idx_llm_calls_ts ON llm_calls(ts)')
  const spentToday = (): number => ledgerTotalUsd(opsDb, Date.now() - SPEND_DAY_MS)

  // Before the pre-flight, because the pre-flight spends and a town that is already over either
  // line must not spend another cent to be told so.
  const alreadySpent = ledgerTotalUsd(opsDb)
  if (cap > 0 && alreadySpent >= cap) {
    opsDb.close()
    throw new Error(capReachedRefusal(alreadySpent, cap, opts.agentDbDir))
  }
  const today = spentToday()
  if (today >= dailyBudget) {
    opsDb.close()
    throw new Error(dailyReachedRefusal(today, dailyBudget))
  }

  const makeClient = (caller: string, agentId?: string): LlmClient =>
    opts.makeClient !== undefined
      ? opts.makeClient(opsDb, caller, agentId)
      : new LlmClient({
          db: opsDb,
          caller,
          ...(agentId === undefined ? {} : { agentId }),
          // The per-caller backstop: it stops one caller running away between two reads of the
          // ledger, which the tick watchdog below cannot see.
          ...(cap > 0 ? { budgetUsd: cap } : {}),
        })

  if (opts.preflight !== false) {
    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error('SJ_LIVE=1 needs OPENROUTER_API_KEY — run with node --env-file=<repo>/.env')
    }
    // Scoped to THIS boot's pre-flight rows: the ledger is resumed with the town, so the whole
    // sum would be the whole history of the town and not the cost of these twelve calls.
    const startedAt = Date.now()
    const result = await runPreflight({
      llm: makeClient('preflight'),
      provider: 'default',
      hardAllowList: false,
      model: MIND_MODEL,
      identity: founders[0]?.identity,
      personality: founders[0]?.personality,
      rounds: PREFLIGHT_ROUNDS,
      costUsd: () => preflightCostUsd(opsDb, startedAt),
    })
    log(
      `stream: pre-flight — action ${result.actions}/${result.calls} over ${result.roundsRun}` +
        ` round(s), ${result.roundsPassed} passed, $${result.costUsd.toFixed(6)};` +
        ` this town has spent $${spentToday().toFixed(4)} of today's $${dailyBudget.toFixed(2)}`,
    )
    if (!result.passed) throw new Error(preflightRefusal(result))
  }

  // Opened before the gateway, which reads this same file and will not create it.
  const narratorDb = opts.narratorDbPath === undefined ? null : openNarratorDb(opts.narratorDbPath)
  const narratorStore = narratorDb === null ? null : new NarratorStore(narratorDb)
  let narrating = false
  let recognizing = false

  const embedder = opts.embedder ?? (await Embedder.create(opts.modelsDir ?? DEFAULT_MODELS_DIR))

  const mindDbs = new Map<string, Database.Database>()
  const dbFor = (id: string): Database.Database => {
    let db = mindDbs.get(id)
    if (db === undefined) {
      db = openAgentDb(join(opts.agentDbDir, `${id}.db`))
      ensureRuntimeTable(db)
      mindDbs.set(id, db)
    }
    return db
  }

  // ── the god layer's own database, opened before a mind boots and closed with them ──
  // Opened here rather than in `attach` so a failure to open it refuses the run instead of
  // taking down a world that is already ticking.
  const wantsArbiter = opts.useArbiter !== false
  const arbiterDb =
    wantsArbiter && opts.arbiter === undefined
      ? openArbiterDb(join(opts.agentDbDir, LIVE_ARBITER_DB))
      : null
  if (arbiterDb !== null) {
    // Seeded once per TOWN, not once per boot. Emptiness is the test because it is the only
    // state that can mean "this town has never had a codex".
    const codex = new CodexStore(arbiterDb)
    if (codex.known().length === 0) for (const entry of GENESIS_CODEX) codex.insert(entry)
  }

  let booted: BootedMinds | null = null
  let bridge: EngineBridge | null = null
  let stopped = false
  let saveRuntime: ((tick: number) => void) | null = null
  let stopBirths: (() => void) | null = null

  const stopMinds = (): void => {
    if (stopped) return
    stopped = true
    stopBirths?.()
    booted?.stop()
    bridge?.drain('the moment passes')
  }

  return {
    attach({ loop, store, config, db, world }): TickHandler {
      const worldTick = loop.state.tick
      const cast = resolveCast(founders, store, maxMinds)
      if (cast.length >= maxMinds)
        insertAlert(opsDb, {
          agentId: null,
          kind: 'cast_at_max_minds',
          detail: `this town is at its ${maxMinds}-mind ceiling; a birth past it gets a body and no mind`,
        })

      // ── the guard, before a single mind is booted ──
      const remembering = cast
        .map((m) => ({ id: m.id, memories: countMemories(dbFor(m.id)) }))
        .filter((r) => r.memories > 0)
      if (worldTick === 0 && remembering.length > 0) throw new Error(amnesiaRefusal(remembering))
      if (worldTick > 0 && remembering.length === 0) {
        log(
          `stream: this town is ${worldTick} ticks old and every mind behind it is new —` +
            ' the bodies remember more than the people in them do',
        )
      }

      bridge = new EngineBridge({ loop, store, simConfig: config })
      const restoring = new Map<string, RuntimeSnapshot>()
      for (const m of cast) {
        const row = dbFor(m.id)
          .prepare('SELECT tick, snapshot FROM mind_runtime WHERE agent_id = ?')
          .get(m.id) as { tick: number; snapshot: string } | undefined
        const snap = restorableSnapshot(row, worldTick)
        if (snap !== null) restoring.set(m.id, snap)
      }

      // A discovered item is drawn once, out of the same budget and into the same ledger the
      // minds bill; until it lands the viewer keeps serving the placeholder.
      const art = createDiscoveryArt({
        codex: new AssetCodex(db),
        opsDb,
        spendableUsd: () =>
          Math.min(
            dailyBudget - spentToday(),
            cap > 0 ? cap - ledgerTotalUsd(opsDb) : Number.POSITIVE_INFINITY,
          ),
        apiKey: process.env.OPENROUTER_API_KEY, // absent ⇒ draws nothing
        onError: (kind, err) => {
          log(`stream: no art for ${kind} — ${String(err)}`)
        },
      })

      // Built here and not at `createLiveCast` time because `makeArbiter` needs the tick and
      // `onCodified` needs the bridge, and neither exists until a loop does. `makeClient` points
      // at `opsDb`: an arbiter billing its own db would spend outside the anomaly stop.
      const arbiter: SeamArbiter | undefined =
        opts.arbiter ??
        (arbiterDb === null
          ? undefined
          : (() => {
              const built = makeArbiter({
                db: arbiterDb,
                llm: makeClient('arbiter'),
                embedder,
                tick: () => loop.state.tick,
                vocabulary: STREAM_VOCABULARY,
                // A codification is a world fact, so it goes in the world's log. The verb is
                // already minted by the time this runs, so nothing here can fail it.
                onCodified: (d: Codified) => {
                  bridge?.announce(DISCOVERY_EVENT, {
                    recipeId: d.recipeId,
                    name: d.name,
                    kind: d.kind,
                    byId: d.credit.agentId,
                    intent: d.credit.intent,
                    makes: d.makes,
                  })
                  art.onDiscovery({ name: d.name, makes: d.makes })
                },
              })
              return {
                adjudicate: (...args) => built.adjudicate(...args),
                codify: (recipe: { id: string }, credit) => built.codify(recipe as Recipe, credit),
              }
            })())

      // A child still owed its household comes up the way a live birth does — household
      // first, then the mind — so `ensureChildren` below is what boots it.
      booted = bootMinds({
        minds: cast.filter((m) => !needsHousehold(m, dbFor(m.id))),
        bridge,
        embedder,
        dbFor,
        turnLlm: (id) => makeClient('turn', id),
        reflectionLlm: (id) => makeClient('reflection', id),
        dreamLlm: (id) => makeClient('dream', id),
        mindConfig: { ...STREAM_MIND_CONFIG, ...opts.mindConfig },
        day: Math.floor(worldTick / MINUTES_PER_DAY),
        restoring,
        ...(arbiter === undefined ? {} : { arbiter }),
        onThought: (t) => {
          if (!stopped) publishThought(db, t)
        },
      })
      // What a birth writes outside the world log — the household and the mother's name — is
      // finished here when a crash left it half done. Idempotent, so a whole town costs nothing.
      void ensureChildren({
        cast: new Map(cast.map((m) => [m.id, m])),
        store,
        dbFor,
        opsDb,
        embedder,
        namingLlm: makeClient('naming'),
        boot: (spec) => {
          booted?.add(spec)
        },
      }).catch((err: unknown) => {
        insertAlert(opsDb, {
          agentId: null,
          kind: 'birth_failed',
          detail: err instanceof Error ? err.message : String(err),
        })
      })
      stopBirths = wireBirths({
        booted,
        bridge,
        store,
        dbFor,
        embedder,
        opsDb,
        namingLlm: makeClient('naming'),
        maxMinds,
        log,
      })
      saveRuntime = (tick: number): void => {
        for (const { agentId, snapshot } of booted?.snapshots() ?? []) {
          dbFor(agentId)
            .prepare(
              'INSERT INTO mind_runtime (agent_id, tick, snapshot) VALUES (?, ?, ?)' +
                ' ON CONFLICT(agent_id) DO UPDATE SET tick = excluded.tick, snapshot = excluded.snapshot',
            )
            .run(agentId, tick, JSON.stringify(snapshot))
        }
      }

      log(
        `stream: LIVE — ${cast.length} of at most ${maxMinds} minds on ${MIND_MODEL},` +
          ` $${dailyBudget.toFixed(2)}/day` +
          `${cap > 0 ? ` under a $${cap.toFixed(2)} lifetime cap` : ''}, memory in ${opts.agentDbDir}`,
      )
      log(
        arbiter === undefined
          ? 'stream: the arbiter is OFF — an invented act falls back to experiment and the world answers it'
          : `stream: the arbiter is ON — a mind may attempt what the engine has no verb for; laws in ${LIVE_ARBITER_DB}`,
      )

      // ── the chronicle, on the day boundary ──
      // Dispatched OFF this handler: awaiting two provider calls here would stall the socket
      // for as long as they take. The day just ended is the one being written.
      let narratedThroughSeq = store.lastSeq()
      const rulebookCount = (): number =>
        arbiterDb === null
          ? 0
          : (arbiterDb.prepare('SELECT COUNT(*) AS n FROM rulebook').get() as { n: number }).n
      const thoughtsOn = (day: number): number =>
        (
          db
            .prepare('SELECT COUNT(*) AS n FROM observer_thoughts WHERE tick >= ? AND tick < ?')
            .get(day * MINUTES_PER_DAY, (day + 1) * MINUTES_PER_DAY) as { n: number }
        ).n

      // What a mind said and what it thought, for the tier-2.5 pass. Speech is a public event;
      // a thought exists only in the observer's own table, which no mind can read.
      const transcriptFor = (day: number, events: SimEvent[]): TranscriptRecord[] => {
        const spoken: TranscriptRecord[] = events
          .filter((e) => e.type === 'agent_spoke')
          .map((e) => {
            const p = (e.payload ?? {}) as Record<string, unknown>
            return {
              sourceKind: 'speech',
              agentId: String(p.agentId),
              day,
              tick: e.tick,
              text: String(p.text),
              eventSeq: e.seq,
            }
          })
        const thought: TranscriptRecord[] = (
          db
            .prepare(
              'SELECT tick, agent_id, text FROM observer_thoughts WHERE tick >= ? AND tick < ? ORDER BY id',
            )
            .all(day * MINUTES_PER_DAY, (day + 1) * MINUTES_PER_DAY) as {
            tick: number
            agent_id: string
            text: string
          }[]
        ).map((t, i) => ({
          sourceKind: 'thought',
          agentId: t.agent_id,
          day,
          tick: t.tick,
          text: t.text,
          memoryRef: `thought:${day}:${i}`,
        }))
        return [...spoken, ...thought].sort((a, b) => a.tick - b.tick).slice(-SEMANTIC_RECORD_CAP)
      }

      // ── the recognizer, on the same boundary and off the same thread ──
      // OBSERVER-SIDE: what it writes lives in the arbiter's db and reaches no prompt or memory.
      const recognizeTheDay = (arb: Database.Database, tick: number): void => {
        const day = tick / MINUTES_PER_DAY - 1
        if (stopped || spentToday() >= dailyBudget) {
          log(`stream: day ${day} goes unrecognized — the recognizer is outside today's budget`)
          return
        }
        // A pass still in flight at the next boundary would re-read the whole log and pay a
        // second classification call for the same candidates.
        if (recognizing) return
        recognizing = true
        setImmediate(() => {
          void runConstructPass({
            events: RECOGNIZER_EVENTS.flatMap((t) => store.readTypeFrom(0, t)).sort(
              (a, b) => a.seq - b.seq,
            ),
            baseConfig: config,
            store: new ConstructStore(arb),
            llm: makeClient('constructs', 'town'),
            laws: loop.state.laws,
          })
            .catch((e: unknown) => {
              log(
                `stream: day ${day} went unrecognized — ${e instanceof Error ? e.message : String(e)}`,
              )
            })
            .finally(() => {
              recognizing = false
            })
        })
      }

      const writeTheDay = (chronicle: NarratorStore, tick: number): void => {
        const day = tick / MINUTES_PER_DAY - 1
        const from = narratedThroughSeq
        narratedThroughSeq = store.lastSeq()
        if (stopped || spentToday() >= dailyBudget) {
          log(`stream: day ${day} goes unwritten — the chronicle is outside today's budget`)
          return
        }
        narrating = true
        // Reading the day back is a whole sim-day of rows, so even that waits for the next turn
        // of the loop: this handler returns to the socket first.
        setImmediate(() => {
          const events = store
            .readFrom(from)
            .filter((e) => Math.floor(e.tick / MINUTES_PER_DAY) === day)
          if (events.length === 0) {
            narrating = false
            return
          }
          void closeDay({
            store: chronicle,
            llm: makeNarratorLlm(makeClient('narrator')),
            worldDb: db,
            events,
            rulebookCount: rulebookCount(),
            privateCounts: { thoughts: thoughtsOn(day), journals: 0 },
            cast: [...(booted?.cast.values() ?? cast)].map((m) => ({
              id: m.id,
              name: m.identity.name,
            })),
            world: { config, state: loop.state },
            semantic: {
              db: opsDb,
              llm: makeClient('semantic', 'town'),
              records: transcriptFor(day, events),
            },
            alert: (d) => {
              log(`stream: chronicle — ${d}`)
            },
          })
            .then((c) => {
              log(`stream: day ${day} is written — "${c.title}"`)
            })
            .catch((e: unknown) => {
              log(
                `stream: day ${day} went unwritten — ${e instanceof Error ? e.message : String(e)}`,
              )
            })
            .finally(() => {
              narrating = false
            })
        })
      }

      // ── the money, on the world's own clock ──
      bridge.onTick((tick) => {
        if (tick % LIVE_RUNTIME_SAVE_TICKS === 0) saveRuntime?.(tick)
        if (tick > 0 && tick % MINUTES_PER_DAY === 0) {
          if (arbiterDb !== null) recognizeTheDay(arbiterDb, tick)
          if (narratorStore !== null) writeTheDay(narratorStore, tick)
        }
        if (tick % LIVE_SPEND_CHECK_TICKS !== 0 || stopped) return
        const spent = ledgerTotalUsd(opsDb)
        if (cap > 0 && spent >= cap) {
          console.error(spendStopMessage(spent, cap))
          stopMinds()
          opts.onSpendStop?.(spent, cap)
          return
        }
        const today = spentToday()
        if (today >= dailyBudget) {
          console.error(dailyStopMessage(today, dailyBudget))
          stopMinds()
          opts.onSpendStop?.(spent, cap)
          return
        }
        // The flow, not the total. A leak is visible here four days before it is visible above.
        // The cast, not the founders: a town that has borne children spends for all of them.
        const castSize = booted?.cast.size ?? cast.length
        const ceiling = LIVE_RATE_CEILING_USD_PER_MIND_DAY * castSize
        // Art is bursty and per discovery; it stays under the daily and lifetime caps, not the mind rate.
        const rate = projectDailySpend(opsDb, {
          windowRealMinutes: opts.rateWindowRealMinutes ?? LIVE_RATE_WINDOW_REAL_MINUTES,
          excludeCallers: ['forge'],
        }).usdPerSimDay
        if (rate <= ceiling) return
        console.error(rateStopMessage(rate, ceiling, castSize))
        stopMinds()
        opts.onSpendStop?.(spent, cap)
      })

      return bridge.wrapTickHandler(world)
    },

    async stop(): Promise<void> {
      stopMinds()
      // Closing a mind's db while `runSleepReflection` is in flight throws out of a promise
      // nobody awaits, so this waits a bounded five seconds and then closes anyway.
      const settled = await settle(
        () => booted?.reflecting() === true || narrating || recognizing,
        REFLECTION_SETTLE_MS,
      )
      if (!settled) log('stream: a night was still being reflected on when the town closed')
      // The last plan each mind was halfway through, written at the tick it stopped rather
      // than at the last multiple of 48 — a clean shutdown should lose nothing at all.
      try {
        saveRuntime?.(bridge?.currentTick() ?? 0)
      } catch {
        /* a closed db loses the plan, not the memory */
      }
      for (const db of mindDbs.values()) db.close()
      arbiterDb?.close()
      narratorDb?.close()
      // The run's last word on its own prices: says nothing when the ledger and the provider's
      // bill agree, and writes an alert row when a pin has gone stale.
      reportReconciliation(opsDb)
      opsDb.close()
    },
  }
}

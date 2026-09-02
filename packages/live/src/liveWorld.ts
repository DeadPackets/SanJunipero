// This is the whole live half. `@sj/town` reaches it only through serve.ts's dynamic import
// behind SJ_LIVE=1, which is what keeps the mind stack off the scripted path.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type Database from 'better-sqlite3'
import {
  ARBITER_DB_FILE,
  DISCOVERY_EVENT,
  MINUTES_PER_DAY,
  REFLECTION_SETTLE_MS,
  type SimEvent,
} from '@sj/shared'
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
  modelFor,
  PROVIDER_ORDER,
  backfillUnattributed,
  checkActRate,
  checkProviderMix,
  checkSpend,
  insertAlert,
  migrateLlmTables,
  projectCallRate,
  reportDeadCalls,
  reportProviders,
  reportReconciliation,
} from '@sj/llm'
import {
  CodexStore,
  ConstructStore,
  GENESIS_CODEX,
  ReviewStore,
  makeArbiter,
  openArbiterDb,
  RETIRED_REASON,
  runConstructPass,
  type Arbiter,
  type AttemptVerdict,
  type Codified,
} from '@sj/arbiter'
import { AssetCodex } from '@sj/forge'
import {
  NarratorStore,
  closeDay,
  constructMilestones,
  makeNarratorLlm,
  openNarratorDb,
  type TranscriptRecord,
} from '@sj/narrator'
import { publishThought, type LiveCast, type LiveOps } from '@sj/gateway'
import { createDiscoveryArt } from './discoveryCommission.js'

/** Dollars in a rolling 24 real hours, the budget a weeks-long stream is actually run on:
 *  48 sim-days pass inside one, so this is the flow, not a lifetime. `SJ_SPEND_DAILY_USD`. */
const LIVE_SPEND_DAILY_USD = 3
/** Dollars over the town's whole life; 0 is none. Reaching it KILLS THE PROCESS: a stream that
 *  quietly stops thinking and keeps serving a town of statues is the costliest thing to discover. */
const LIVE_SPEND_STOP_USD = 50
const SPEND_DAY_MS = 24 * 60 * 60 * 1000
/** How often the ledger is read, in world ticks. At the dev world's tick this is every 20 s
 *  of wall clock — far tighter than one turn, so nothing can outrun it. */
const LIVE_SPEND_CHECK_TICKS = 10
/** How often each mind's clock and half-run plan are written down. ~96 s of wall clock. */
const LIVE_RUNTIME_SAVE_TICKS = 48
/** The only event types `detectCandidates` reads. `events(type)` is indexed, so four narrow
 *  reads beat one full-log read whose rows the recognizer then drops. */
const RECOGNIZER_EVENTS = ['agent_moved', 'agent_spoke', 'agent_expressed', 'item_taken']
/** How many of a day's words the tier-2.5 pass is shown. A very loud day must not build an
 *  unbounded prompt; the most recent words are the ones a first is most likely to be in. */
const SEMANTIC_RECORD_CAP = 300
/** `dozeTicks` is the one `MIND_CONFIG` dial denominated in real seconds — it is an HTTP retry
 *  backoff — so it is the only one this world's 2 500 ms tick may rescale. */
const STREAM_MIND_CONFIG: Partial<MindConfig> = { dozeTicks: 6 }
/** The call ledger and the alerts. A `.db` beside the minds, so `SJ_FRESH=1` takes it too. */
export const LIVE_OPS_DB = '_ops.db'
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
  /** The rate tripwire's window, and the provider-mix window. A test cannot wait fifteen real
   *  minutes to prove a flow. */
  rateWindowRealMinutes?: number
  /** How often the projected-spend alert may fire. A test cannot wait a real hour for one. */
  spendAlertRealMinutes?: number
  /** How many minds this town may hold; never fewer than its founders. `SJ_MAX_MINDS`. */
  maxMinds?: number
  /** Injected in tests, and handed the SAME ops db the cap is read off — a test whose fake
   *  client bills a different ledger proves nothing about the stop. */
  makeClient?: (opsDb: Database.Database, caller: string, agentId?: string) => LlmClient
  embedder?: { embed(t: string): Promise<Float32Array> }
  /** For a harness that cannot wait out the boredom floor. Absent in every real run. */
  mindConfig?: Partial<MindConfig>
  /** Never dispatch a live run without it — a provider that silently returns garbage has
   *  burned a lane before. Off only for a test, which spends nothing to preflight. */
  preflight?: boolean
  modelsDir?: string
  /** Only a test passes this: the real one needs the bridge and the tick, which do not exist
   *  until `attach`. */
  arbiter?: SeamArbiter
  /** The arbiter fires only once the world has already refused an intent with `unknown verb:`,
   *  so it is a per-NOVELTY call and not a per-turn one. On by default; `SJ_ARBITER=0` is off. */
  useArbiter?: boolean
  log?: (line: string) => void
}

export function amnesiaRefusal(remembering: readonly { id: string; memories: number }[]): string {
  const who = remembering.map((r) => `${r.id} (${r.memories})`).join(', ')
  return [
    'stream: could not start — this is a new town at tick 0, and its minds remember an older one.',
    `        still holding memories: ${who}`,
    '        A world reset with the minds left standing is worse than either a clean reset or a',
    '        clean resume. Start both over with SJ_FRESH=1, or put the world db back.',
  ].join('\n')
}

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

/** A per-call cap cannot see a slow leak; this bounds CALLS per unit time, PER MIND. Calls, not
 *  dollars: a failover to a dearer back end is the routing moving, not the town running away.
 *  Rehearsal-4 run C measured 4.7 (203 mind calls, 5 minds, 8.6 sim-hours); 14 is 3x, per ruling 25. */
const LIVE_CALL_CEILING_PER_MIND_SIM_HOUR = 14
// A rate needs a span to be a rate: two sim-hours is four real minutes at 1x and a burst of
// night reflections spread thin enough not to read as a runaway.
const LIVE_RATE_MIN_SPAN_SIM_HOURS = 2
/** The projection window. Long enough that one reflection burst cannot carry it, short enough
 *  that a runaway dies in minutes. */
const LIVE_RATE_WINDOW_REAL_MINUTES = 15
/** How often the operator hears a projected burn. Well under every hard stop, so a leak is on
 *  the ops surface with an hour left to look at it. */
const LIVE_SPEND_ALERT_REAL_MINUTES = 60
/** How often unattributed rows are asked about. One sweep drains far more than any town
 *  produces in a minute, and the endpoint is never asked twice inside one. */
const LIVE_BACKFILL_REAL_SECONDS = 60

/** The pinned provider is an ALLOW-LIST for every mind-facing call, not a preference: a routing
 *  hop costs a cold prefix and an unpriced route. `PROVIDER_ORDER` is the way to serve it anyway. */
export const LIVE_ALLOW_PROVIDER_FALLBACKS = false

/** The population ceiling, as a multiple of the founding cast: nothing else in the world stops
 *  the town growing, and every mind is another live bill. `SJ_MAX_MINDS`. */
const LIVE_MAX_MINDS_PER_FOUNDER = 3

function rateStopMessage(rate: number, ceiling: number, minds: number, calls: number): string {
  return [
    `STREAM STOPPED: each of the ${minds} live mind(s) is making ${rate.toFixed(1)} calls a` +
      ` sim-hour, over the ${ceiling} call ceiling.`,
    `        ${calls} mind calls in the last ${LIVE_RATE_WINDOW_REAL_MINUTES} real minutes. This is`,
    '        a RATE stop, not a budget — the town is nowhere near either dollar line and is',
    '        thinking far too often. Every mind is stopped and no further call will be made.',
    '        The town on disk is intact.',
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

export const RATE_STOP_ALERT_KIND = 'rate_stop'

export function rateStopRefusal(detail: string, agentDbDir: string): string {
  return [
    'stream: could not start — this town was stopped for calling far too often.',
    ...detail.split('\n'),
    '        A rate stop outlives the process, or a restart would pay a pre-flight and rerun the',
    '        runaway. Nothing was spent to tell you this.',
    '        `pnpm stream` (no SJ_LIVE) resumes this same town scripted, for $0.00/hour.',
    `        DELETE FROM alerts WHERE kind = '${RATE_STOP_ALERT_KIND}' clears it;` +
      ` SJ_FRESH=1 throws away ${agentDbDir}.`,
  ].join('\n')
}

function rateStopOnRecord(db: Database.Database): string | null {
  const row = db
    .prepare('SELECT detail FROM alerts WHERE kind = ? ORDER BY id DESC LIMIT 1')
    .get(RATE_STOP_ALERT_KIND) as { detail: string } | undefined
  return row?.detail ?? null
}

/** Not `sumCostUsd`, which is per-caller where the cap is not: five minds on two callers each
 *  would clear one ten times over. */
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

/** Async because the embedder load and the pre-flight run first and either can refuse the run.
 *  Everything needing the world waits for `attach`: a bridge needs the loop, the loop the bridge. */
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
  opsDb.exec('CREATE INDEX IF NOT EXISTS idx_llm_calls_agent ON llm_calls(agent_id)')
  const spentToday = (): number => ledgerTotalUsd(opsDb, Date.now() - SPEND_DAY_MS)

  // Before the pre-flight, because the pre-flight spends and a town that is already over either
  // line must not spend another cent to be told so.
  const priorRateStop = rateStopOnRecord(opsDb)
  if (priorRateStop !== null) {
    opsDb.close()
    throw new Error(rateStopRefusal(priorRateStop, opts.agentDbDir))
  }
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

  const openRouterKey = process.env.OPENROUTER_API_KEY ?? ''

  /** A row whose answer named no back end books at the ceiling for ever otherwise; asking
   *  OpenRouter who served it is the only way back to a real price. */
  const sweepUnattributed = async (): Promise<void> => {
    if (openRouterKey === '') return
    const r = await backfillUnattributed(opsDb, { apiKey: openRouterKey })
    if (r.backfilled > 0) log(`stream: priced ${r.backfilled} call(s) nobody had claimed`)
  }

  const makeClient = (caller: string, agentId?: string): LlmClient =>
    opts.makeClient !== undefined
      ? opts.makeClient(opsDb, caller, agentId)
      : new LlmClient({
          db: opsDb,
          caller,
          ...(agentId === undefined ? {} : { agentId }),
          allowProviderFallbacks: LIVE_ALLOW_PROVIDER_FALLBACKS,
          // The per-caller backstop: it stops one caller running away between two reads of the
          // ledger, which the tick watchdog below cannot see.
          ...(cap > 0 ? { budgetUsd: cap } : {}),
        })

  if (opts.preflight !== false) {
    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error('SJ_LIVE=1 needs OPENROUTER_API_KEY — run with node --env-file=<repo>/.env')
    }
    const startedAt = Date.now()
    const result = await runPreflight({
      llm: makeClient('preflight'),
      provider: 'default',
      hardAllowList: !LIVE_ALLOW_PROVIDER_FALLBACKS,
      model: modelFor('preflight'),
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

  // Opened here rather than in `attach` so a failure to open it refuses the run instead of
  // taking down a world that is already ticking.
  const wantsArbiter = opts.useArbiter !== false
  const arbiterDb =
    wantsArbiter && opts.arbiter === undefined
      ? openArbiterDb(join(opts.agentDbDir, ARBITER_DB_FILE))
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

  // Nothing on the operator's surface is ever rendered into a prompt.
  const ops: LiveOps = {
    opsDb,
    caps: { dailyUsd: dailyBudget, lifetimeUsd: cap },
    rulings: arbiterDb === null ? null : new ReviewStore(arbiterDb),
    alert: (kind, detail) => {
      insertAlert(opsDb, { agentId: null, kind, detail })
    },
  }

  return {
    ops,
    attach({ loop, store, config, db, world }): TickHandler {
      const worldTick = loop.state.tick
      const cast = resolveCast(founders, store, maxMinds)
      if (cast.length >= maxMinds)
        insertAlert(opsDb, {
          agentId: null,
          kind: 'cast_at_max_minds',
          detail: `this town is at its ${maxMinds}-mind ceiling; a birth past it gets a body and no mind`,
        })

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

      // Not built in `createLiveCast`: `makeArbiter` needs the tick and `onCodified` the bridge.
      // `makeClient` points at `opsDb` — an arbiter on its own db spends outside the anomaly stop.
      const built =
        arbiterDb === null || opts.arbiter !== undefined
          ? null
          : makeArbiter({
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
                  ...(d.credit.saying ? { saying: d.credit.saying } : {}),
                  makes: d.makes,
                })
                art.onDiscovery({ name: d.name, makes: d.makes })
              },
            })
      const arbiter: SeamArbiter | undefined =
        opts.arbiter ??
        (built === null
          ? undefined
          : {
              adjudicate: (...args) => built.adjudicate(...args),
              codify: (attempt, credit) => built.codify(attempt as AttemptVerdict, credit),
              roster: () => built.roster(),
            })

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
          : `stream: the arbiter is ON — a mind may attempt what the engine has no verb for; laws in ${ARBITER_DB_FILE}`,
      )

      // Dispatched OFF this handler: awaiting two provider calls here would stall the socket
      // for as long as they take. The day just ended is the one being written.
      let narratedThroughSeq = store.lastSeq()
      const recognizerEvents: SimEvent[] = []
      let recognizedThroughSeq = 0
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

      const journalsOn = (day: number): { tick: number; agent_id: string; text: string }[] =>
        [...mindDbs.values()].flatMap(
          (mind) =>
            mind
              .prepare('SELECT tick, agent_id, text FROM journal WHERE day = ? ORDER BY id')
              .all(day) as { tick: number; agent_id: string; text: string }[],
        )

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
        // A journal is written by hand and read by no one else; deep-world §20 counts it as
        // testimony the tier-2.5 pass may quote, alongside speech and thought.
        const journal: TranscriptRecord[] = journalsOn(day).map((j, i) => ({
          sourceKind: 'journal',
          agentId: j.agent_id,
          day,
          tick: j.tick,
          text: j.text,
          memoryRef: `journal:${day}:${j.agent_id}:${i}`,
        }))
        return [...spoken, ...thought, ...journal]
          .sort((a, b) => a.tick - b.tick)
          .slice(-SEMANTIC_RECORD_CAP)
      }

      // OBSERVER-SIDE: what it writes lives in the arbiter's db and reaches no prompt or memory.
      const recognizeTheDay = (
        arb: Database.Database,
        chronicle: NarratorStore | null,
        tick: number,
      ): void => {
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
          // A site is recognized by recurring, so the pass still needs every day it has seen —
          // but it is extended, never re-read: parsing the whole log again grows without bound.
          const fresh = RECOGNIZER_EVENTS.flatMap((t) =>
            store.readTypeFrom(recognizedThroughSeq, t),
          ).sort((a, b) => a.seq - b.seq)
          recognizedThroughSeq = store.lastSeq()
          // One at a time: the first pass on a resumed town is the whole log, and a spread
          // that wide overflows the argument stack.
          for (const ev of fresh) recognizerEvents.push(ev)
          void runConstructPass({
            events: recognizerEvents,
            baseConfig: config,
            store: new ConstructStore(arb),
            llm: makeClient('constructs', 'town'),
            laws: loop.state.laws,
          })
            .then((constructs) => {
              // The registry lives in the arbiter's db, which the chronicle cannot read; a
              // tier-3 milestone row is the only bridge into the record.
              if (chronicle === null) return
              for (const m of constructMilestones(constructs, chronicle.milestoneKinds()))
                chronicle.insertMilestone(m)
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
            privateCounts: { thoughts: thoughtsOn(day), journals: journalsOn(day).length },
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

      const spendAlertMs = (opts.spendAlertRealMinutes ?? LIVE_SPEND_ALERT_REAL_MINUTES) * 60 * 1000
      let nextSpendAlertAt = Date.now() + spendAlertMs
      const rateWindow = opts.rateWindowRealMinutes ?? LIVE_RATE_WINDOW_REAL_MINUTES
      // One sample a tick, trimmed to the window: the rate is judged over the sim-hours these
      // ticks covered, so a loop slowed by idle pacing or paused is not read as a runaway.
      const tickHistory: { ms: number; tick: number }[] = []
      // From the first read, not one window in: an operator wants the routing named while there
      // is still a run left to re-pin.
      let nextMixCheckAt = Date.now()
      let nextBackfillAt = Date.now() + LIVE_BACKFILL_REAL_SECONDS * 1000
      let backfilling = false
      // Minted verbs are used through the world log, which the arbiter cannot read: each day's
      // acts are handed over, then whatever has gone fourteen days unused is retired.
      let usedThroughSeq = store.lastSeq()
      const retireTheDay = (arb: Arbiter, tick: number): void => {
        for (const ev of store.readTypeFrom(usedThroughSeq, 'action_started')) {
          const verb = (ev.payload as { verb?: unknown }).verb
          if (typeof verb === 'string' && verb.includes(':')) arb.noteUsed(verb, ev.tick)
        }
        usedThroughSeq = store.lastSeq()
        const retired = arb.retireUnused(tick)
        if (retired.length > 0) log(`stream: retired ${retired.join(', ')} — ${RETIRED_REASON}`)
      }
      bridge.onTick((tick) => {
        tickHistory.push({ ms: Date.now(), tick })
        if (tick % LIVE_RUNTIME_SAVE_TICKS === 0) saveRuntime?.(tick)
        if (tick > 0 && tick % MINUTES_PER_DAY === 0) {
          if (built !== null) retireTheDay(built, tick)
          if (arbiterDb !== null) recognizeTheDay(arbiterDb, narratorStore, tick)
          if (narratorStore !== null) writeTheDay(narratorStore, tick)
        }
        if (tick % LIVE_SPEND_CHECK_TICKS !== 0 || stopped) return
        // The operator's heartbeat, before any hard stop has its say: a burn that is about to
        // kill the run must be on the ops surface even when this is the tick that kills it.
        if (Date.now() >= nextSpendAlertAt) {
          nextSpendAlertAt = Date.now() + spendAlertMs
          const projected = checkSpend(opsDb, { windowRealMinutes: rateWindow })
          if (projected.alerted) {
            log(`stream: spend — projected $${projected.usdPerSimDay.toFixed(2)}/sim-day`)
          }
        }
        // One line per window, never a stop: only the operator can answer a back end that got
        // past the allow-list.
        if (Date.now() >= nextMixCheckAt) {
          nextMixCheckAt = Date.now() + rateWindow * 60 * 1000
          const mix = checkProviderMix(opsDb, {
            windowRealMinutes: rateWindow,
            allowed: PROVIDER_ORDER,
          })
          if (mix.alerted) {
            log(
              `stream: providers — ${(mix.offPinShare * 100).toFixed(0)}% of mind calls off the allow-list`,
            )
          }
        }
        // The sustained act bar: pre-flight's three calls cannot see a rate that collapses over a
        // run — a collapse inside the first sim-hour means the back end passed the bar, then quit.
        const acts = checkActRate(opsDb)
        if (acts.alerted) {
          log(`stream: acts — ${(acts.silentShare * 100).toFixed(0)}% of mind turns did nothing`)
        }
        if (Date.now() >= nextBackfillAt && !backfilling) {
          nextBackfillAt = Date.now() + LIVE_BACKFILL_REAL_SECONDS * 1000
          backfilling = true
          void sweepUnattributed().finally(() => {
            backfilling = false
          })
        }
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
        // The living cast, not the founders: a town that has borne children thinks for all of
        // them, and a dead one is a denominator that hides the rate of everybody left.
        const castSize = Math.max(1, booted?.alive() ?? cast.length)
        const now = Date.now()
        const cutoff = now - rateWindow * 60_000
        while (tickHistory.length > 1 && tickHistory[1]!.ms <= cutoff) tickHistory.shift()
        const anchor = tickHistory[0]!
        const simHours = (tick - anchor.tick) / 60
        if (simHours < LIVE_RATE_MIN_SPAN_SIM_HOURS) return
        const projected = projectCallRate(opsDb, {
          windowRealMinutes: (now - anchor.ms) / 60_000,
          now,
          minds: castSize,
          simHours,
        })
        const rate = projected.callsPerMindSimHour
        if (rate <= LIVE_CALL_CEILING_PER_MIND_SIM_HOUR) return
        const msg = rateStopMessage(
          rate,
          LIVE_CALL_CEILING_PER_MIND_SIM_HOUR,
          castSize,
          projected.sampledCalls,
        )
        console.error(msg)
        insertAlert(opsDb, { agentId: null, kind: RATE_STOP_ALERT_KIND, detail: msg })
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
      // Before every report, not between them: a row still booked at the ceiling makes both
      // the provider table and the reconciliation ratio a lie.
      await sweepUnattributed()
      // Each of these says nothing about a run with nothing to say, so a quiet ops surface
      // still means a quiet run.
      for (const row of reportDeadCalls(opsDb)) {
        log(
          `stream: ${row.agentId ?? 'the run'} paid for ${row.calls} call(s) that came back with nothing`,
        )
      }
      for (const row of reportProviders(opsDb)) {
        log(
          `stream: ${row.provider ?? 'an unnamed back end'} served ${row.calls} call(s), $${row.costUsd.toFixed(4)}`,
        )
      }
      reportReconciliation(opsDb)
      opsDb.close()
    },
  }
}

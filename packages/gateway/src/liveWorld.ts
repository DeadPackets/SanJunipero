// ★ THE SEAM. THE TWO HALVES OF THE FOUNDING SENTENCE, IN ONE PROCESS.
//
// The project's founding sentence is "a simulation that can be live-streamed and watched by
// anyone around the world, of LLM agents interacting with the world around them." Both halves
// have been shipped for weeks and neither has ever run inside the other:
//
//   a world served to strangers    serve.ts -> startDevWorld -> createGateway
//   LLM minds living in a world    packages/agents/scripts/g11-deepworld.ts, a 1300-line script
//
// Everything anybody has ever watched in a browser on this project has been `founders.ts` —
// puppets whose every decision is a plain `if`. This file is the join.
//
// ★ WHY IT LIVES IN THE GATEWAY, WHICH IS THE ONE DECISION HERE WORTH ARGUING.
//
// A composition root must sit above everything it composes, and the dependency graph leaves
// exactly one candidate:
//
//   @sj/arbiter -> @sj/agents        so the assembly may NOT live in @sj/agents
//   @sj/narrator -> @sj/agents       (an arbiter or a narrator around the minds closes a cycle)
//   @sj/agents   -/-> @sj/gateway    so the assembly may NOT live below the gateway either
//   @sj/gateway  -> everything       and nothing depends on @sj/gateway
//
// `g11-deepworld.ts` reaches into `../../arbiter/src/…` and `../../narrator/src/…` by relative
// path precisely because it is a script and scripts are outside the graph. That is not a seam,
// it is a hole in the wall, and building the served world the same way would put the hole in
// shipped code. The mind-side wiring that IS package-legal — a bridge, N runtimes, their
// clients — was extracted to `@sj/agents`' `bootMinds`; what is left here is everything that
// needs to know about a world AND about a mind at the same time, which is this file's whole job.
//
// ★ AND IT COSTS THE SCRIPTED WORLD NOTHING. Nothing in `devWorld.ts` imports this module;
// `serve.ts` reaches it through a dynamic `import()` behind `SJ_LIVE=1`. A person running
// `pnpm stream` by reflex loads no onnxruntime, opens no model, makes no call and spends $0.00.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type Database from 'better-sqlite3'
import { DISCOVERY_EVENT, MINUTES_PER_DAY, type SimConfig } from '@sj/shared'
import type { EventStore, TickHandler, TickLoop } from '@sj/engine'
import {
  Embedder, EngineBridge, LlmClient, MIND_MODEL, PREFLIGHT_ROUNDS, bootMinds, migrateLlmTables,
  openAgentDb, preflightRefusal, projectDailySpend, runPreflight,
  FOUNDER_MINDS, type BootedMinds, type MindConfig, type MindSpec, type RuntimeSnapshot,
  type SeamArbiter,
} from '@sj/agents'
// ★ AND THE GOD LAYER, which is legal here for exactly the reason the header gives above:
// `@sj/arbiter -> @sj/agents`, so an arbiter around the minds can only be assembled somewhere
// above both, and this is the only file that is. `serve.ts` reaches this module through a
// dynamic `import()` behind `SJ_LIVE=1`, so these imports cost the scripted stream nothing —
// the same quarantine `@sj/agents` already sits inside, and `liveWorld.test.ts` asserts it for
// both packages now.
import {
  CodexStore, GENESIS_CODEX, makeArbiter, openArbiterDb, type Codified, type Recipe,
} from '@sj/arbiter'
import type { LiveCast } from './devWorld.js'
import { publishThought } from './observer.js'

/**
 * ★ THE ANOMALY STOP, AND IT IS A PRODUCT SURFACE NOW, NOT A LANE COST.
 *
 * Every previous live run in this repo was a lane spending a lane's money for twenty minutes
 * with somebody watching the console. A stream is a process a person starts and walks away
 * from, and `SJ_LIVE=1` left up overnight bills a real card. So the cap does not live in the
 * script that starts it — it lives in the served world, it is checked on the world's own clock,
 * and reaching it KILLS THE PROCESS. A stream that quietly stops thinking and keeps serving a
 * town of statues is the failure mode that would cost the most to discover.
 */
export const LIVE_SPEND_STOP_USD = 5
/** How often the ledger is read, in world ticks. At the dev world's 2.5 s tick this is every
 *  25 s of wall clock — far tighter than one turn, so nothing can outrun it. */
export const LIVE_SPEND_CHECK_TICKS = 10
/** How often each mind's clock and half-run plan are written down. ~2 min of wall clock. */
export const LIVE_RUNTIME_SAVE_TICKS = 48
/** How long a shutdown waits for a night's reflection to land before closing the db under it.
 *  A container gives about ten seconds before SIGKILL; losing the night is survivable and
 *  hanging the shutdown is not. */
export const REFLECTION_SETTLE_MS = 5_000
/**
 * ★ The mind dials whose meaning is REAL seconds, restated for this world's 2 500 ms tick.
 *
 * Nearly every number in `DEFAULT_MIND_CONFIG` is denominated in sim-minutes — one tick is one
 * sim-minute — so it says the same thing about a person at any tick rate and must NOT be scaled.
 * `dozeTicks` is the exception: `#doze()` is a retry backoff against an HTTP provider, and a 429
 * does not know what a sim-hour is. 60 ticks held 15 real seconds at the 250 ms tick it was tuned
 * on; here it would silence a mind for 150 seconds of stream over one transient failure.
 */
export const STREAM_MIND_CONFIG: Partial<MindConfig> = { dozeTicks: 6 }
/** The call ledger and the alerts. A `.db` beside the minds, so `SJ_FRESH=1` takes it too. */
export const LIVE_OPS_DB = '_ops.db'
/**
 * ★ THE TOWN'S LAWS, AND WHY THEY ARE NOT IN THE WORLD DB.
 *
 * Rulings, the rulebook, the codex and the construct registry go here. Three reasons, and the
 * first is a law somebody already wrote down: `arbiter/src/schema.ts` says of the construct
 * tables "these tables live in the arbiter's database, never in the world's". The gateway
 * SERVES the world db to strangers, so putting an ops-plane table in it is a one-way-glass
 * breach through the API rather than through a prompt.
 *
 * Second, the world db is an event log replayed on resume. Rulings are not events and cannot
 * be replayed; they need a table that simply persists. It also needs `sqlite-vec` for
 * `rulings_vec`, which `openArbiterDb` loads and `openDb` alone does not.
 *
 * Third — and this is the one that decides the directory — a town's laws must reset when the
 * town does. `agentDbDir` is what `SJ_FRESH=1` wipes in the same breath as the world; a new
 * day 0 that kept yesterday's rulebook is the same class of state `amnesiaRefusal` already
 * refuses for memories. The leading underscore keeps it out of the `<mindId>.db` namespace the
 * amnesia guard walks, exactly like `_ops.db`.
 */
export const LIVE_ARBITER_DB = '_arbiter.db'
/**
 * The words the town has for stuff. Rendered into the adjudication prompt AND enforced against
 * the answer, so a ruling can never mint a recipe out of a material nobody has a word for.
 * Same table `g11-deepworld.ts` proved the sanity gate against; a stream with no table gets
 * only the checks that need no table, which is how a live run once denied its own well.
 */
export const STREAM_VOCABULARY = {
  itemKinds: [
    'wood', 'stone', 'rope', 'cloth', 'fiber', 'hide', 'clay', 'axe', 'hoe', 'knife',
    'seed_pouch', 'waterskin', 'bucket', 'torch', 'garment', 'plank', 'bread', 'wheat',
    'fish', 'venison', 'rabbit_meat', 'berries', 'mushroom', 'herb', 'stew',
  ],
  structureKinds: ['house', 'storehouse', 'shed', 'wagon', 'well', 'fire_pit', 'bridge', 'grave'],
} as const
/** The sentence-transformer cache. `SJ_MODELS_DIR` moves it; nothing downloads at run time. */
export const DEFAULT_MODELS_DIR = fileURLToPath(new URL('../../../data/models/', import.meta.url))

export type LiveCastOpts = {
  /** Directory of `<id>.db` files. Created if absent; wiped with the world on `SJ_FRESH=1`. */
  agentDbDir: string
  minds?: readonly MindSpec[]
  /** Dollars. Reaching it stops the minds and calls `onSpendStop`. */
  spendCapUsd?: number
  /** What a stream does when the cap lands. Default is a loud message and nothing else, so a
   *  test can assert the stop without taking the test runner down with it. */
  onSpendStop?: (spent: number, cap: number) => void
  /** The rate tripwire's window. A test cannot wait fifteen real minutes to prove a flow. */
  rateWindowRealMinutes?: number
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
  /** Adjudication and codification, pre-built. Only a test passes this: a real stream lets
   *  `createLiveCast` build the real one below, because the real one needs the bridge and the
   *  tick, which do not exist until `attach`. */
  arbiter?: SeamArbiter
  /**
   * ★ ON BY DEFAULT INSIDE `SJ_LIVE=1`, and the argument is the call path.
   *
   * Spec §4 is an entire section of the product, and what makes this a simulation rather than
   * five minds picking from a fixed list is that a mind can attempt something the engine has
   * no verb for. A live stream with the god dark ships the demo, not the product.
   *
   * The cost objection does not survive the call path: the arbiter fires only when the world
   * has ALREADY refused an intent with `unknown verb:` (`agentRuntime.ts` `#reroutesUnknownVerb`,
   * once per turn), so it is a per-NOVELTY call and not a per-turn one — and stages 1 and 2 of
   * `adjudicate` resolve a repeat with zero LLM calls, so the second mind to try the same thing
   * costs nothing at all.
   *
   * `SJ_ARBITER=0` sets this false. It exists as the operator's kill switch if a ruling ever
   * starts leaking, and as the control arm for measuring what the god costs.
   */
  useArbiter?: boolean
  log?: (line: string) => void
}

/**
 * ★ THE STATE THE PERSISTENCE LANE SAID WOULD BE INVISIBLE UNTIL IT WAS CATASTROPHIC.
 *
 * Agent memory is not in the world db. A world at day 0 whose minds still remember the town
 * that stood yesterday is strictly worse than either a clean reset or a clean resume — the
 * buildings gone, the day counter back to 0, and five people who remember all of it. There is
 * no reading under which that is the right state, so it is refused rather than served.
 *
 * `startDevWorld`'s `fresh` already deletes world and minds as one unit, so the only ways into
 * this state are a hand-deleted world db and a hand-copied mind. Both deserve a sentence.
 */
export function amnesiaRefusal(remembering: ReadonlyArray<{ id: string; memories: number }>): string {
  const who = remembering.map((r) => `${r.id} (${r.memories})`).join(', ')
  return [
    'stream: could not start — this is a new town at tick 0, and its minds remember an older one.',
    `        still holding memories: ${who}`,
    '        A world reset with the minds left standing is worse than either a clean reset or a',
    '        clean resume. Start both over with SJ_FRESH=1, or put the world db back.',
  ].join('\n')
}

/**
 * Wait for something to stop being busy, but never for longer than `deadlineMs`. Returns
 * whether it settled, so a caller can say which of the two happened rather than guess.
 */
export async function settle(
  busy: () => boolean, deadlineMs: number, pollMs = 200,
): Promise<boolean> {
  const until = Date.now() + deadlineMs
  while (busy()) {
    if (Date.now() >= until) return false
    await new Promise((r) => setTimeout(r, Math.min(pollMs, Math.max(1, until - Date.now()))))
  }
  return true
}

/**
 * ★ THE RATE TRIPWIRE — the guard the `$5` cap cannot be.
 *
 * At the seam lane's measured **$0.053/hour** the total cap is **94 hours of streaming**. It stops
 * a lane's mistake and it cannot stop a runaway on a process meant to run for weeks: a regression
 * has to be ~90x the normal rate before the cap lands inside an hour. A total is the wrong
 * instrument for a leak — you need the FLOW.
 *
 * PER MIND, deliberately. The bill scales with the cast and not with the world, so a total ceiling
 * would false-fire the day somebody streams ten people. The arithmetic behind the number:
 *
 * | | $/mind/sim-day |
 * |---|---|
 * | measured, five minds over 1 252 ticks | **0.0106** |
 * | the same run's worst 15 minutes — the nightly reflection burst, 34% of a day's spend in 90 s | ~0.0154 |
 * | **this ceiling** | **0.10** — 9.4x the measured rate, 6.5x the worst measured window |
 *
 * So it survives the reflection burst, a doubled prompt and a doubled cast, and it kills a 10x
 * regression inside one 15-minute window instead of four days from now. One sim-day is one real
 * hour at this tick, so `usdPerSimDay` and $/real-hour are the same number.
 */
export const LIVE_RATE_CEILING_USD_PER_MIND_DAY = 0.10
/** The projection window. Long enough that one reflection burst cannot carry it, short enough
 *  that a runaway dies in minutes. `checkSpend`'s own default, and g11 uses the same 15. */
export const LIVE_RATE_WINDOW_REAL_MINUTES = 15

export function rateStopMessage(rate: number, ceiling: number, minds: number): string {
  return [
    `STREAM STOPPED: the live cast is spending $${rate.toFixed(4)}/hour, over its`
      + ` $${ceiling.toFixed(4)}/hour ceiling (${minds} mind(s) x`
      + ` $${LIVE_RATE_CEILING_USD_PER_MIND_DAY.toFixed(2)}).`,
    `        Measured over the last ${LIVE_RATE_WINDOW_REAL_MINUTES} real minutes. This is a RATE`,
    '        stop, not the total cap — the town is nowhere near its $5 and is burning too fast.',
    '        Every mind is stopped and no further call will be made. The town on disk is intact.',
  ].join('\n')
}

export function spendStopMessage(spent: number, cap: number): string {
  return [
    `STREAM STOPPED: the live cast has spent $${spent.toFixed(4)} of its $${cap.toFixed(2)} cap.`,
    '        Every mind is stopped and no further call will be made. The town on disk is intact',
    '        and `pnpm stream` will resume it with the scripted cast for $0.00/hour.',
  ].join('\n')
}

/**
 * ★ THE CAP IS PER TOWN, NOT PER PROCESS, AND THAT HAS TO BE SAID OUT LOUD RATHER THAN MET.
 *
 * The call ledger lives in `agentDbDir` and resumes with the town, so a town that has already
 * spent its cap over twenty boots is a town that has spent its cap. That is the right reading
 * for an ANOMALY STOP — the point is to bound total exposure, not to reset it every time
 * somebody restarts — but it means a resumed boot can be over the line before its first tick.
 *
 * Without this it would still stop: the tick watchdog fires within ten ticks, and before that
 * `LlmClient`'s own `budgetUsd` would throw `BudgetExceededError` out of the pre-flight. Both
 * are twenty-five confusing seconds and a stack trace. This is one sentence, before anything.
 */
export function capReachedRefusal(spent: number, cap: number, agentDbDir: string): string {
  return [
    `stream: could not start — this town has already spent $${spent.toFixed(4)} of its`
    + ` $${cap.toFixed(2)} cap.`,
    '        The cap is per TOWN, not per process: the call ledger resumes with the world, so',
    '        restarting does not reset it. That is the point of an anomaly stop.',
    '        `pnpm stream` (no SJ_LIVE) resumes this same town scripted, for $0.00/hour.',
    `        SJ_FRESH=1 starts a new town and a new ledger, throwing away ${agentDbDir}.`,
  ].join('\n')
}

/** Total dollars in a call ledger, across every caller. `sumCostUsd` is per-caller and the cap
 *  is not: five minds on two callers each would clear a per-caller cap ten times over. */
export function ledgerTotalUsd(db: Database.Database): number {
  const row = db.prepare('SELECT COALESCE(SUM(cost_usd), 0) AS total FROM llm_calls').get() as { total: number }
  return row.total
}

/**
 * ★ WHAT THE PRE-FLIGHT COST, AND ONLY WHAT THE PRE-FLIGHT COST.
 *
 * The ledger is resumed with the town, so on the second boot `ledgerTotalUsd` is the whole
 * history — the first RESUMED live boot printed `pre-flight … $0.047463` for twelve calls that
 * had cost about a tenth of a cent, which is a number an operator would act on. The ledger has
 * a `caller` column for exactly this reason and g11 scopes its own query the same way.
 */
export function preflightCostUsd(db: Database.Database, since: number): number {
  const row = db.prepare(
    "SELECT COALESCE(SUM(cost_usd), 0) AS total FROM llm_calls WHERE caller = 'preflight' AND ts >= ?",
  ).get(since) as { total: number }
  return row.total
}

// Where a mind's clock and half-run plan are kept between processes. Its own database, keyed
// by the world tick it was taken at: a snapshot from AHEAD of the world is a snapshot of a tick
// SQLite rolled back, and putting it back would give a mind a plan for a moment that never
// happened. See `restorableSnapshot`.
function ensureRuntimeTable(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS mind_runtime (
    agent_id TEXT PRIMARY KEY, tick INTEGER NOT NULL, snapshot TEXT NOT NULL
  )`)
}

export function restorableSnapshot(
  row: { tick: number; snapshot: string } | undefined, worldTick: number,
): RuntimeSnapshot | null {
  if (row === undefined || row.tick > worldTick) return null
  try { return JSON.parse(row.snapshot) as RuntimeSnapshot } catch { return null }
}

const countMemories = (db: Database.Database): number => {
  try {
    return Number((db.prepare('SELECT COUNT(*) AS n FROM memories').get() as { n: number }).n)
  } catch { return 0 }
}

/**
 * Build a cast of minds for `startDevWorld`. Async because two things have to happen before a
 * single body moves and both of them can refuse the whole run:
 *
 *   1. the embedder loads (128 MB of ONNX off local disk, ~1 s, no network)
 *   2. the provider pre-flight runs — three calls on the REAL turn schema. G11b once spent 38
 *      minutes and $0.76 discovering its provider could not emit an action field at all.
 *
 * Everything that needs the world — the bridge, the minds, the amnesia guard, the thought
 * channel — happens in `attach`, because a bridge needs the loop and the loop needs the handler
 * the bridge returns.
 */
export async function createLiveCast(opts: LiveCastOpts): Promise<LiveCast> {
  const log = opts.log ?? ((line: string) => console.log(line))
  const minds = opts.minds ?? FOUNDER_MINDS
  const cap = opts.spendCapUsd ?? LIVE_SPEND_STOP_USD
  mkdirSync(opts.agentDbDir, { recursive: true })

  const opsDb = openAgentDb(join(opts.agentDbDir, LIVE_OPS_DB))
  migrateLlmTables(opsDb)

  // Before the pre-flight, because the pre-flight spends and a town that is already over its
  // cap must not spend another cent to be told so.
  const alreadySpent = ledgerTotalUsd(opsDb)
  if (alreadySpent >= cap) {
    opsDb.close()
    throw new Error(capReachedRefusal(alreadySpent, cap, opts.agentDbDir))
  }

  const makeClient = (caller: string, agentId?: string): LlmClient =>
    opts.makeClient !== undefined
      ? opts.makeClient(opsDb, caller, agentId)
      : new LlmClient({
        db: opsDb, caller, ...(agentId === undefined ? {} : { agentId }),
        // The per-caller backstop. The global cap is the tick watchdog below; this one stops a
        // single caller running away between two reads of the ledger, which the watchdog
        // cannot see. `sumCostUsd` is per caller, so five minds share one 'turn' budget.
        budgetUsd: cap,
      })

  if (opts.preflight !== false) {
    if (!process.env['OPENROUTER_API_KEY']) {
      throw new Error('SJ_LIVE=1 needs OPENROUTER_API_KEY — run with node --env-file=<repo>/.env')
    }
    // Scoped to THIS boot's pre-flight rows: the ledger is resumed with the town, so the whole
    // sum would be the whole history of the town and not the cost of these twelve calls.
    const startedAt = Date.now()
    const result = await runPreflight({
      llm: makeClient('preflight'), provider: 'default', hardAllowList: false, model: MIND_MODEL,
      identity: minds[0]?.identity, personality: minds[0]?.personality, rounds: PREFLIGHT_ROUNDS,
      costUsd: () => preflightCostUsd(opsDb, startedAt),
    })
    log(`stream: pre-flight — action ${result.actions}/${result.calls} over ${result.roundsRun}`
      + ` round(s), ${result.roundsPassed} passed, $${result.costUsd.toFixed(6)};`
      + ` this town has spent $${ledgerTotalUsd(opsDb).toFixed(4)} of its $${cap.toFixed(2)} so far`)
    if (!result.passed) throw new Error(preflightRefusal(result))
  }

  const embedder = opts.embedder ?? await Embedder.create(opts.modelsDir ?? DEFAULT_MODELS_DIR)

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
  const arbiterDb = wantsArbiter && opts.arbiter === undefined
    ? openArbiterDb(join(opts.agentDbDir, LIVE_ARBITER_DB))
    : null
  if (arbiterDb !== null) {
    // Seeded once per town, not once per boot: the codex is what the town knows and what it
    // has earned since, and re-seeding a resumed town would throw a UNIQUE constraint on the
    // first genesis row anyway. Emptiness is the test because it is the only state that can
    // mean "this town has never had a codex".
    const codex = new CodexStore(arbiterDb)
    if (codex.known().length === 0) for (const entry of GENESIS_CODEX) codex.insert(entry)
  }

  let booted: BootedMinds | null = null
  let bridge: EngineBridge | null = null
  let stopped = false
  let saveRuntime: (tick: number) => void = () => {}

  const stopMinds = (): void => {
    if (stopped) return
    stopped = true
    booted?.stop()
    bridge?.drain('the moment passes')
  }

  return {
    attach({ loop, store, config, db, world }): TickHandler {
      const worldTick = loop.state.tick

      // ── the guard, before a single mind is booted ──
      const remembering = minds
        .map((m) => ({ id: m.id, memories: countMemories(dbFor(m.id)) }))
        .filter((r) => r.memories > 0)
      if (worldTick === 0 && remembering.length > 0) throw new Error(amnesiaRefusal(remembering))
      if (worldTick > 0 && remembering.length === 0) {
        log(`stream: this town is ${worldTick} ticks old and every mind behind it is new —`
          + ' the bodies remember more than the people in them do')
      }

      bridge = new EngineBridge({ loop, store, simConfig: config })
      const restoring = new Map<string, RuntimeSnapshot>()
      for (const m of minds) {
        const row = dbFor(m.id).prepare('SELECT tick, snapshot FROM mind_runtime WHERE agent_id = ?')
          .get(m.id) as { tick: number; snapshot: string } | undefined
        const snap = restorableSnapshot(row, worldTick)
        if (snap !== null) restoring.set(m.id, snap)
      }

      // ── ★ THE GOD LAYER, ASSEMBLED. Spec §4, in the town a person can watch. ──
      //
      // Built here and not at `createLiveCast` time because `makeArbiter` needs the tick and
      // `onCodified` needs the bridge, and neither exists until a loop does.
      //
      // ★ THE ARBITER BILLS THE OPS LEDGER, NOT ITS OWN DATABASE. `makeClient` points at
      // `opsDb`, which is what `ledgerTotalUsd` reads every ten ticks for the $5 stop and the
      // rate ceiling. An arbiter billing its own db would spend OUTSIDE the anomaly stop —
      // the exact failure the stop exists to prevent, and it would be invisible.
      const arbiter: SeamArbiter | undefined = opts.arbiter ?? (arbiterDb === null
        ? undefined
        : (() => {
            const built = makeArbiter({
              db: arbiterDb, llm: makeClient('arbiter'), embedder,
              tick: () => loop.state.tick, vocabulary: STREAM_VOCABULARY,
              // A codification is a world fact, so it goes in the world's log — where the
              // chronicle already renders `discovery_made` for the viewer. The arbiter owns no
              // world and cannot do this itself; it has already minted the verb by the time
              // this runs, so nothing here can fail the codification.
              onCodified: (d: Codified) => {
                bridge?.announce(DISCOVERY_EVENT, {
                  recipeId: d.recipeId, name: d.name, kind: d.kind,
                  byId: d.credit.agentId, intent: d.credit.intent, makes: d.makes,
                })
              },
            })
            return {
              adjudicate: built.adjudicate,
              codify: (recipe: { id: string }, credit) => built.codify(recipe as Recipe, credit),
            }
          })())

      booted = bootMinds({
        minds, bridge, embedder, dbFor,
        turnLlm: (id) => makeClient('turn', id),
        reflectionLlm: (id) => makeClient('reflection', id),
        mindConfig: { ...STREAM_MIND_CONFIG, ...opts.mindConfig },
        day: Math.floor(worldTick / MINUTES_PER_DAY),
        restoring,
        ...(arbiter === undefined ? {} : { arbiter }),
        // ★ WHAT THE BUBBLE OVER A HEAD SAYS IS NOW WHAT THE MIND ACTUALLY THOUGHT. The same
        // table, the same socket frame, the same viewer — and the string is no longer one of
        // ten canned lines keyed by verb.
        onThought: (t) => { if (!stopped) publishThought(db, t) },
      })
      saveRuntime = (tick: number): void => {
        for (const { agentId, snapshot } of booted?.snapshots() ?? []) {
          dbFor(agentId).prepare(
            'INSERT INTO mind_runtime (agent_id, tick, snapshot) VALUES (?, ?, ?)'
            + ' ON CONFLICT(agent_id) DO UPDATE SET tick = excluded.tick, snapshot = excluded.snapshot',
          ).run(agentId, tick, JSON.stringify(snapshot))
        }
      }

      log(`stream: LIVE — ${minds.length} minds on ${MIND_MODEL}, cap $${cap.toFixed(2)},`
        + ` memory in ${opts.agentDbDir}`)
      // Said out loud in both directions. "Can a mind here do something the engine has no verb
      // for?" is the one question a viewer cannot answer by watching, and it is the difference
      // between the product and a demo.
      log(arbiter === undefined
        ? 'stream: the arbiter is OFF — an invented act falls back to experiment and the world answers it'
        : `stream: the arbiter is ON — a mind may attempt what the engine has no verb for; laws in ${LIVE_ARBITER_DB}`)

      // ── the money, on the world's own clock ──
      bridge.onTick((tick) => {
        if (tick % LIVE_RUNTIME_SAVE_TICKS === 0) saveRuntime(tick)
        if (tick % LIVE_SPEND_CHECK_TICKS !== 0 || stopped) return
        const spent = ledgerTotalUsd(opsDb)
        if (spent >= cap) {
          console.error(spendStopMessage(spent, cap))
          stopMinds()
          opts.onSpendStop?.(spent, cap)
          return
        }
        // The flow, not the total. A leak is visible here four days before it is visible above.
        const ceiling = LIVE_RATE_CEILING_USD_PER_MIND_DAY * minds.length
        const rate = projectDailySpend(opsDb, {
          windowRealMinutes: opts.rateWindowRealMinutes ?? LIVE_RATE_WINDOW_REAL_MINUTES,
        }).usdPerSimDay
        if (rate <= ceiling) return
        console.error(rateStopMessage(rate, ceiling, minds.length))
        stopMinds()
        opts.onSpendStop?.(spent, cap)
      })

      return bridge.wrapTickHandler(world)
    },

    async stop(): Promise<void> {
      stopMinds()
      // ★ A NIGHT HALF-REFLECTED IS PAID FOR AND THEN THROWN AWAY, AND IT TAKES THE PROCESS
      // WITH IT. `runSleepReflection` writes its facts and its scene summaries AFTER the model
      // answers; close the mind's database while one is in flight and better-sqlite3 throws
      // "The database connection is not open" out of a promise nobody is awaiting. `stop` is
      // wired to SIGTERM, and a container gives about ten seconds before SIGKILL, so this
      // waits a bounded five and then closes anyway — losing the night is survivable, hanging
      // the shutdown is not.
      const settled = await settle(() => booted?.reflecting() === true, REFLECTION_SETTLE_MS)
      if (!settled) log('stream: a night was still being reflected on when the town closed')
      // The last plan each mind was halfway through, written at the tick it stopped rather
      // than at the last multiple of 48 — a clean shutdown should lose nothing at all.
      try { saveRuntime(bridge?.currentTick() ?? 0) } catch { /* a closed db loses the plan, not the memory */ }
      for (const db of mindDbs.values()) db.close()
      arbiterDb?.close()
      opsDb.close()
    },
  }
}

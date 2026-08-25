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
import { MINUTES_PER_DAY, type SimConfig } from '@sj/shared'
import type { EventStore, TickHandler, TickLoop } from '@sj/engine'
import {
  Embedder, EngineBridge, LlmClient, MIND_MODEL, PREFLIGHT_ROUNDS, bootMinds, migrateLlmTables,
  openAgentDb, preflightRefusal, runPreflight,
  FOUNDER_MINDS, type BootedMinds, type MindConfig, type MindSpec, type RuntimeSnapshot,
  type SeamArbiter,
} from '@sj/agents'
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
/** The call ledger and the alerts. A `.db` beside the minds, so `SJ_FRESH=1` takes it too. */
export const LIVE_OPS_DB = '_ops.db'
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
  /** Adjudication and codification. Absent, an invented verb falls back to `experiment` and
   *  the world answers it; the arbiter is the gateway's to wire and no lane has asked yet. */
  arbiter?: SeamArbiter
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

export function spendStopMessage(spent: number, cap: number): string {
  return [
    `STREAM STOPPED: the live cast has spent $${spent.toFixed(4)} of its $${cap.toFixed(2)} cap.`,
    '        Every mind is stopped and no further call will be made. The town on disk is intact',
    '        and `pnpm stream` will resume it with the scripted cast for $0.00/hour.',
  ].join('\n')
}

/** Total dollars in a call ledger, across every caller. `sumCostUsd` is per-caller and the cap
 *  is not: five minds on two callers each would clear a per-caller cap ten times over. */
export function ledgerTotalUsd(db: Database.Database): number {
  const row = db.prepare('SELECT COALESCE(SUM(cost_usd), 0) AS total FROM llm_calls').get() as { total: number }
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
    const result = await runPreflight({
      llm: makeClient('preflight'), provider: 'default', hardAllowList: false, model: MIND_MODEL,
      identity: minds[0]?.identity, personality: minds[0]?.personality, rounds: PREFLIGHT_ROUNDS,
      costUsd: () => ledgerTotalUsd(opsDb),
    })
    log(`stream: pre-flight — action ${result.actions}/${result.calls} over ${result.roundsRun}`
      + ` round(s), ${result.roundsPassed} passed, $${result.costUsd.toFixed(6)}`)
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

      booted = bootMinds({
        minds, bridge, embedder, dbFor,
        turnLlm: (id) => makeClient('turn', id),
        reflectionLlm: (id) => makeClient('reflection', id),
        ...(opts.mindConfig === undefined ? {} : { mindConfig: opts.mindConfig }),
        day: Math.floor(worldTick / MINUTES_PER_DAY),
        restoring,
        ...(opts.arbiter === undefined ? {} : { arbiter: opts.arbiter }),
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

      // ── the money, on the world's own clock ──
      bridge.onTick((tick) => {
        if (tick % LIVE_RUNTIME_SAVE_TICKS === 0) saveRuntime(tick)
        if (tick % LIVE_SPEND_CHECK_TICKS !== 0 || stopped) return
        const spent = ledgerTotalUsd(opsDb)
        if (spent < cap) return
        console.error(spendStopMessage(spent, cap))
        stopMinds()
        opts.onSpendStop?.(spent, cap)
      })

      return bridge.wrapTickHandler(world)
    },

    async stop(): Promise<void> {
      // The last plan each mind was halfway through, written at the tick it stopped rather
      // than at the last multiple of 48 — a clean shutdown should lose nothing at all.
      try { saveRuntime(bridge?.currentTick() ?? 0) } catch { /* a closed db loses the plan, not the memory */ }
      stopMinds()
      for (const db of mindDbs.values()) db.close()
      opsDb.close()
    },
  }
}

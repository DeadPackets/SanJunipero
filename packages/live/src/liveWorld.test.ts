// Every row here must FAIL against a scripted cast: a test that passes whether or not a mind is
// behind the body proves nothing about the seam.
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { OPAQUE_REFUSAL, openAgentDb, type MindSpec } from '@sj/agents'
import { LlmClient, insertAlert, insertTurnOutcome, migrateLlmTables } from '@sj/llm'
import { FakeEmbedder } from '@sj/llm/testutil'
import { DAYS_PER_YEAR, MINUTES_PER_DAY } from '@sj/shared'
import { unregisterVerb, VERBS } from '@sj/engine'
import { EventStore } from '@sj/engine/store'
import { thoughtsSince, type LiveCast } from '@sj/gateway'
import { startDevWorld, foundersFor, townStructuresFor, type DevWorld } from '@sj/town'
import {
  LIVE_ALLOW_PROVIDER_FALLBACKS,
  LIVE_OPS_DB,
  RATE_STOP_ALERT_KIND,
  amnesiaRefusal,
  capReachedRefusal,
  createLiveCast,
  dailyReachedRefusal,
  ledgerTotalUsd,
  preflightCostUsd,
  restorableSnapshot,
  settle,
} from './liveWorld.js'

// What no puppet in `founders.ts` will ever say, because `founders.ts` cannot speak at all.
const SPOKEN = 'A mind said this and no script could have.'
const THOUGHT = 'A mind thought this and no script could have.'

const NO_USAGE = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 }
// What the chronicler answers. No scripted cast can produce either: `founders.ts` has no words.
const NARRATED_CHAPTER = {
  title: 'The day the well was watched',
  text: 'They kept to the well and said little.',
  citations: [],
}
const NARRATED_BIOGRAPHY = { title: 'Amara, who keeps the tally', body: 'She was seen counting.' }

// Two of the five, so a row costs two runtimes rather than five. Ids match the town's bodies.
const TWO: MindSpec[] = [
  {
    id: 'amara',
    sex: 'f',
    ageDays: 34 * DAYS_PER_YEAR,
    identity: {
      name: 'Amara',
      age: 34,
      backstory: 'Keeps the tally.',
      temperament: 'exacting',
      voiceCard: {
        register: 'plain',
        rhythm: 'short',
        tics: [],
        neverSays: [],
        exampleLines: ['Put it back.'],
        wordBudget: { typical: 12, burst: 22 },
      },
    },
    personality: {
      temperament: 'exacting',
      values: ['a full store'],
      beliefs: ['what is counted keeps'],
      current: { mood: 'watchful', worries: [], goals: ['get through the day'] },
    },
  },
  {
    id: 'omar',
    sex: 'm',
    ageDays: 46 * DAYS_PER_YEAR,
    identity: {
      name: 'Omar',
      age: 46,
      backstory: 'Sits with the sick.',
      temperament: 'unhurried',
      voiceCard: {
        register: 'low',
        rhythm: 'slow',
        tics: [],
        neverSays: [],
        exampleLines: ['Now then.'],
        wordBudget: { typical: 16, burst: 28 },
      },
    },
    personality: {
      temperament: 'unhurried',
      values: ['sitting with the sick'],
      beliefs: ['a hand does more'],
      current: { mood: 'attentive', worries: [], goals: ['get through the day'] },
    },
  },
]

/** A model that never leaves the process: it answers each schema with the first canned value that
 *  parses. `LlmClient`'s real cost accounting is covered by `agents/src/llm/client.test.ts`. */
function fakeLlm(db: Database.Database, agentId: string | null, turn: unknown): LlmClient {
  // The narrator's two schemas sit in the same list: both are `.strict()`, so neither can be
  // mistaken for a mind's turn and the order does not matter.
  const canned = [
    turn,
    { facts: [] },
    { scenes: [] },
    { summary: '' },
    { edits: [] },
    NARRATED_CHAPTER,
    NARRATED_BIOGRAPHY,
    { hits: [] }, // the tier-2.5 verdict
    { rulings: [] }, // the recognizer's classification
    {},
  ]
  return {
    async object<T>(o: { schema: { safeParse(v: unknown): { success: boolean; data?: T } } }) {
      for (const c of canned) {
        const parsed = o.schema.safeParse(c)
        if (parsed.success) return { value: parsed.data as T, usage: NO_USAGE }
      }
      throw new Error('no canned answer fits this schema')
    },
    async text() {
      return { text: 'the day passes', usage: NO_USAGE }
    },
    totalCostUsd: () => 0,
    alert: (kind: string, detail: string) => {
      insertAlert(db, { agentId, kind, detail })
    },
    noteTurnOutcome: (outcome: { acted: boolean; spoke: boolean; planContinued: boolean }) => {
      insertTurnOutcome(db, { agentId, provider: null, ...outcome })
    },
    forCaller() {
      return this
    },
  } as unknown as LlmClient
}

// The tile the SCRIPTED patrol walks to on this same map, so the act a mind chooses here is one
// the world is known to accept — and so `action_started walk` actually fires.
const WELLSIDE = foundersFor(townStructuresFor('showcase')).find((f) => f.id === 'amara')!.patrol[1]

// `VERBS` has no `smoke_fish`, so the world refuses this with `unknown verb:` and the runtime
// re-offers it to the arbiter as freeform words. That refusal is the only doorway to spec §4.
const INVENTED_VERB = 'smoke_fish'
const INVENTING_TURN = {
  thought: THOUGHT,
  importance: 7,
  action: { verb: INVENTED_VERB, params: { over: 'green wood' } },
}

// `canon: ['food_preserving']` is an UNEARNED rung whose prerequisite (`cooking`) the genesis
// codex knows, so `withinAdjacency` lets it through. `requires`/`costs` are empty on purpose.
const SMOKE_RECIPE = {
  id: 'recipe:smoke_fish',
  name: 'Smoke Fish Over Green Wood',
  durationTicks: 2,
  costs: [],
  requires: [],
  outcomeTable: [
    {
      weight: 1,
      success: true,
      label: 'The fish darkens and firms in the smoke.',
      effects: [{ op: 'spawn_item', kind: 'smoked_fish', qty: 1, to: 'agent' }],
    },
  ],
  rngStream: 'recipe:smoke_fish',
  canon: ['food_preserving'],
}
const SMOKE_VERDICT = {
  kind: 'attempt',
  recipe: SMOKE_RECIPE,
  summary: 'Hang the fish in the smoke of green wood so it keeps past the week.',
}
const REFUSING_VERDICT = {
  kind: 'impossible',
  class: 'insufficient_skill',
  reason: 'the smoke will not hold without a knack for it nobody here has shown',
}

const SPEAKING_TURN = {
  thought: THOUGHT,
  importance: 5,
  speech: SPOKEN,
  action: { verb: 'walk', params: { x: WELLSIDE.x, y: WELLSIDE.y } },
}
const SILENT_TURN = { thought: THOUGHT, importance: 2 }

// Every mind turns on the tick it is asked to, so a row does not have to step out the 120-tick
// boredom floor five times over.
const EAGER = {
  idleGapTicks: 0,
  boredomTicks: 1,
  bodyAlarm: { hunger: 0, energy: 0, warmth: 0, thirst: 0, affliction: Infinity },
}

const dirs: string[] = []
const worlds: DevWorld[] = []
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'sj-live-'))
  dirs.push(d)
  return d
}

const alertsOf = (db: Database.Database, kind: string): string[] =>
  (db.prepare('SELECT detail FROM alerts WHERE kind = ?').all(kind) as { detail: string }[]).map(
    (r) => r.detail,
  )

/** N mind calls inside the rate window, priced at nothing — the tripwire counts calls. */
const callsTo = (db: Database.Database, caller: string, n: number): void => {
  const insert = db.prepare(
    `INSERT INTO llm_calls
       (ts, agent_id, caller, model, input_tokens, output_tokens, cache_read_tokens,
        reasoning_tokens, cost_usd, latency_ms, ok, error, provider)
     VALUES (?, NULL, ?, 'm', 0, 0, 0, 0, 0, 0, 1, NULL, 'Wafer')`,
  )
  db.transaction(() => {
    for (let i = 0; i < n; i++) insert.run(Date.now(), caller)
  })()
}

/** One ledger row at a chosen wall-clock time — the rolling day is the thing under test. */
const billTo = (db: Database.Database, ts: number, usd: number): void => {
  db.prepare(
    `INSERT INTO llm_calls
       (ts, agent_id, caller, model, input_tokens, output_tokens, cache_read_tokens,
        reasoning_tokens, cost_usd, latency_ms, ok, error, provider)
     VALUES (?, NULL, 'turn', 'm', 0, 0, 0, 0, ?, 0, 1, NULL, NULL)`,
  ).run(ts, usd)
}

afterEach(async () => {
  for (const w of worlds.splice(0)) await w.stop()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

async function liveWorld(opts: {
  dir: string
  turn?: unknown
  minds?: MindSpec[]
  spendCapUsd?: number
  spendDailyUsd?: number
  onSpendStop?: (spent: number, cap: number) => void
  rateWindowRealMinutes?: number
  spendAlertRealMinutes?: number
  fresh?: boolean
  /** What the god answers. Absent, the arbiter caller gets the same canned client as a mind,
   *  which fits no verdict schema and therefore THROWS — which is the failure row below. */
  verdict?: unknown
  useArbiter?: boolean
  /** Where the day's chapter is written. Absent, no day is narrated. */
  narratorDbPath?: string
}): Promise<{
  world: DevWorld
  cast: LiveCast
  opsDb: ReturnType<typeof openAgentDb>
  /** Every `caller` the cast asked for a client under — the one seam every spend goes through. */
  callers: Set<string>
}> {
  const agentDbDir = join(opts.dir, 'minds')
  const callers = new Set<string>()
  let seen: ReturnType<typeof openAgentDb> | null = null
  let cast: LiveCast | null = null
  // Through the factory, exactly as `serve.ts` does it: built out here the cast would already
  // hold the per-mind files open when `fresh` deleted them.
  const world = await startDevWorld({
    dbPath: join(opts.dir, 'world.db'),
    port: 0,
    world: { map: 'showcase', ...(opts.fresh === undefined ? {} : { fresh: opts.fresh }) },
    realMsPerTick: 10_000_000,
    agentDbDir,
    cast: async () => {
      cast = await createLiveCast({
        agentDbDir,
        minds: opts.minds ?? TWO,
        ...(opts.narratorDbPath === undefined ? {} : { narratorDbPath: opts.narratorDbPath }),
        preflight: false,
        embedder: new FakeEmbedder(),
        mindConfig: EAGER,
        ...(opts.spendCapUsd === undefined ? {} : { spendCapUsd: opts.spendCapUsd }),
        ...(opts.spendDailyUsd === undefined ? {} : { spendDailyUsd: opts.spendDailyUsd }),
        ...(opts.onSpendStop === undefined ? {} : { onSpendStop: opts.onSpendStop }),
        ...(opts.rateWindowRealMinutes === undefined
          ? {}
          : { rateWindowRealMinutes: opts.rateWindowRealMinutes }),
        ...(opts.spendAlertRealMinutes === undefined
          ? {}
          : { spendAlertRealMinutes: opts.spendAlertRealMinutes }),
        log: () => {},
        ...(opts.useArbiter === undefined ? {} : { useArbiter: opts.useArbiter }),
        makeClient: (opsDb, caller, agentId) => {
          seen = opsDb
          callers.add(caller)
          // The god gets its own canned answer. Same ledger, deliberately — an arbiter that
          // billed anywhere else would spend outside the money guards, so the rig must not.
          const canned =
            caller === 'arbiter' && opts.verdict !== undefined
              ? opts.verdict
              : (opts.turn ?? SPEAKING_TURN)
          return fakeLlm(opsDb, agentId ?? null, canned)
        },
      })
      return cast
    },
  })
  worlds.push(world)
  return { world, cast: cast!, opsDb: seen!, callers }
}

/** Take WHOLE ticks — `world.tick()`, not `loop.step()`. The observer scan runs inside a whole
 *  tick, which is where the canned thought lines are published from. */
async function run(world: DevWorld, ticks: number): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    world.tick()
    for (let k = 0; k < 12; k++) await Promise.resolve()
    await new Promise((r) => setImmediate(r))
  }
}

function eventsOf(dir: string, type: string): Record<string, unknown>[] {
  const db = new Database(join(dir, 'world.db'), { readonly: true, fileMustExist: true })
  try {
    return (
      db.prepare('SELECT payload FROM events WHERE type = ? ORDER BY seq').all(type) as {
        payload: string
      }[]
    ).map((r) => JSON.parse(r.payload) as Record<string, unknown>)
  } finally {
    db.close()
  }
}

function thoughtTexts(dir: string): string[] {
  const db = new Database(join(dir, 'world.db'), { readonly: true, fileMustExist: true })
  try {
    return thoughtsSince(db, 0).map((t) => t.text)
  } finally {
    db.close()
  }
}

describe('★ THE SEAM — a served world whose bodies are driven by minds', () => {
  it('★ a mind SPEAKS INTO THE STREAM — a sentence no scripted founder could produce', async () => {
    const dir = tmp()
    const { world } = await liveWorld({ dir })
    await run(world, 6)

    expect(world.live).toBe(true)
    const spoke = eventsOf(dir, 'agent_spoke')
    expect(spoke.length).toBeGreaterThan(0)
    expect(spoke.map((p) => p.text)).toContain(SPOKEN)
    expect(spoke.map((p) => p.agentId)).toEqual(expect.arrayContaining(['amara']))
  }, 30_000)

  it('★ AND THE SAME WORLD WITH THE SCRIPTED CAST SAYS NOTHING — the row above is not vacuous', async () => {
    const dir = tmp()
    const world = await startDevWorld({
      dbPath: join(dir, 'world.db'),
      port: 0,
      world: { map: 'showcase' },
      realMsPerTick: 10_000_000,
    })
    worlds.push(world)
    await run(world, 6)

    expect(world.live).toBe(false)
    expect(eventsOf(dir, 'agent_spoke')).toHaveLength(0)
    expect(eventsOf(dir, 'action_started').length).toBeGreaterThan(0)
  }, 30_000)

  it('the thought bubble carries what the mind THOUGHT, not one of ten canned lines', async () => {
    const dir = tmp()
    const { world } = await liveWorld({ dir })
    await run(world, 6)

    // The minds ARE walking, so a world still publishing the canned lines would publish one.
    expect(eventsOf(dir, 'action_started').some((p) => p.verb === 'walk')).toBe(true)
    const texts = thoughtTexts(dir)
    expect(texts).toContain(THOUGHT)
    // `THOUGHT_LINES.walk`, and the fallback for a verb the table has no line for.
    expect(texts).not.toContain('The path is clear enough.')
    expect(texts).not.toContain('Hm.')
    expect(new Set(texts)).toEqual(new Set([THOUGHT]))
  }, 30_000)

  it('★ THE PUPPET STRINGS ARE OFF: a cast that never acts leaves every body standing still', async () => {
    // The scripted patrol walks from tick 1. If `FoundersOpts.minds` did not cut the policy
    // loop, these bodies would move even though no mind ever asked them to.
    const dir = tmp()
    const { world } = await liveWorld({ dir, turn: SILENT_TURN })
    await run(world, 8)

    expect(eventsOf(dir, 'action_started')).toHaveLength(0)
    // And the scripted larder top-up is gone with it: a live town feeds itself or it does not.
    expect(
      eventsOf(dir, 'needs_changed')
        .flatMap((p) => p.changes as { delta: number }[])
        .filter((c) => c.delta > 0),
    ).toHaveLength(0)
  }, 30_000)

  // Both are spend the scripted path cannot make, and both must be booked in the one ledger the
  // cap and the daily budget are read off — never a client of their own.
  it('★ dreams and births are on the same ledger as every other call', async () => {
    const { callers } = await liveWorld({ dir: tmp() })

    expect([...callers]).toContain('dream')
    expect([...callers]).toContain('naming')
  }, 30_000)
})

describe('★ the money, inside the served world', () => {
  it('stops every mind and calls the stop the moment the ledger reaches the cap', async () => {
    const stops: { spent: number; cap: number }[] = []
    const dir = tmp()
    const { world, opsDb } = await liveWorld({
      dir,
      spendCapUsd: 0.25,
      onSpendStop: (spent, cap) => stops.push({ spent, cap }),
    })
    await run(world, 4)
    expect(stops).toHaveLength(0)

    opsDb
      .prepare(
        `INSERT INTO llm_calls
       (ts, agent_id, caller, model, input_tokens, output_tokens, cache_read_tokens,
        reasoning_tokens, cost_usd, latency_ms, ok, error, provider)
       VALUES (?, NULL, 'turn', 'm', 0, 0, 0, 0, ?, 0, 1, NULL, NULL)`,
      )
      .run(Date.now(), 0.3)
    expect(ledgerTotalUsd(opsDb)).toBeCloseTo(0.3, 6)

    await run(world, 10) // the watchdog reads every LIVE_SPEND_CHECK_TICKS
    expect(stops).toHaveLength(1)
    expect(stops[0]!.cap).toBe(0.25)

    const atStop = eventsOf(dir, 'agent_spoke').length
    await run(world, 10)
    expect(eventsOf(dir, 'agent_spoke').length).toBe(atStop)
  }, 40_000)

  // The total cap stops a lane's mistake and cannot stop a leak on a process meant to run for
  // weeks. This row thinks FAR UNDER the cap and fast, the exact shape the cap is blind to.
  it('★ stops a town thinking too fast even though it is nowhere near its cap', async () => {
    const stops: { spent: number; cap: number }[] = []
    const dir = tmp()
    const { world, opsDb } = await liveWorld({
      dir,
      spendCapUsd: 5,
      rateWindowRealMinutes: 15,
      onSpendStop: (spent, cap) => stops.push({ spent, cap }),
    })
    await run(world, 4)
    expect(stops).toHaveLength(0)

    // The guard judges a span of at least two sim-hours (120 ticks), in which TWO minds may
    // make 2 x 2 x 14 = 56 calls. 400 is far over the wire and costs nothing at all — this is a
    // call guard, not a money one.
    callsTo(opsDb, 'turn', 400)
    expect(ledgerTotalUsd(opsDb)).toBe(0)

    await run(world, 130)
    expect(stops, 'a runaway went unnoticed under a distant cap').toHaveLength(1)
    expect(stops[0]!.spent).toBeLessThan(5)

    const atStop = eventsOf(dir, 'agent_spoke').length
    await run(world, 10)
    expect(eventsOf(dir, 'agent_spoke').length).toBe(atStop)
  }, 40_000)

  // A rate stop that lives only in the process is no stop at all: `restart: unless-stopped`
  // brings the container back, and the runaway pays a pre-flight and reruns for another window.
  it('★ a rate stop outlives the process and refuses the next boot', async () => {
    const stops: { spent: number; cap: number }[] = []
    const dir = tmp()
    const { world, opsDb } = await liveWorld({
      dir,
      spendCapUsd: 5,
      rateWindowRealMinutes: 15,
      onSpendStop: (spent, cap) => stops.push({ spent, cap }),
    })
    await run(world, 4)
    callsTo(opsDb, 'turn', 400)
    await run(world, 130)
    expect(stops).toHaveLength(1)
    expect(alertsOf(opsDb, RATE_STOP_ALERT_KIND)).toHaveLength(1)
    await worlds.splice(worlds.indexOf(world), 1)[0]!.stop()

    await expect(liveWorld({ dir, spendCapUsd: 5 })).rejects.toThrow(/calling far too often/)
    await expect(liveWorld({ dir, spendCapUsd: 5 })).rejects.toThrow(/SJ_FRESH=1/)
  }, 60_000)

  // ★ Run C died at $0.5656/sim-day against a $0.50 ceiling on 203 mind calls — 4.7 a mind a
  // sim-hour, an ordinary town. The dollars had moved because the ROUTING had.
  it('★ a failover to the dearest allowed back end costs more and stops nothing', async () => {
    const stops: { spent: number; cap: number }[] = []
    const dir = tmp()
    const { world, opsDb } = await liveWorld({
      dir,
      spendCapUsd: 5,
      rateWindowRealMinutes: 15,
      spendAlertRealMinutes: 0,
      onSpendStop: (spent, cap) => stops.push({ spent, cap }),
    })
    // Run C's own flow — 113 calls for two minds over one window — at run C's own dollars.
    callsTo(opsDb, 'turn', 113)
    billTo(opsDb, Date.now(), 0.28)

    await run(world, 20)
    expect(stops, 'an ordinary town was stopped for what its provider charged').toHaveLength(0)
  }, 40_000)

  // ★ The guard once divided a real-time window by the loop's CURRENT speed, so idle pacing
  // dropping to 0.1x read a healthy town as ten times too fast and stopped it. The rate is
  // calls over the sim-hours the ticks covered, and the dial has nothing to divide.
  it('★ a loop slowed by idle pacing is not read as a runaway', async () => {
    const stops: { spent: number; cap: number }[] = []
    const dir = tmp()
    const { world, opsDb } = await liveWorld({
      dir,
      spendCapUsd: 5,
      rateWindowRealMinutes: 15,
      onSpendStop: (spent, cap) => stops.push({ spent, cap }),
    })
    await run(world, 4)
    world.loop.setSpeed(0.1)
    // 40 calls by TWO minds over the ~130 ticks (2.2 sim-hours) below: 9 an hour, under 14.
    callsTo(opsDb, 'turn', 40)
    await run(world, 130)
    expect(stops, 'a slowed loop was read as a runaway').toHaveLength(0)
  }, 40_000)

  // The lifetime cap cannot be the running budget: at the measured 5-mind rate a $5 total kills a
  // stream after 47 real hours. The budget that governs a weeks-long run is the rolling day.
  it('★ stops a town over its DAILY budget while its lifetime cap is nowhere near', async () => {
    const stops: { spent: number; cap: number }[] = []
    const dir = tmp()
    const { world, opsDb } = await liveWorld({
      dir,
      spendCapUsd: 50,
      spendDailyUsd: 0.05,
      rateWindowRealMinutes: 15,
      onSpendStop: (spent, cap) => stops.push({ spent, cap }),
    })
    await run(world, 4)
    expect(stops).toHaveLength(0)

    // Yesterday's spend, outside the window: it must not count against today.
    billTo(opsDb, Date.now() - 26 * 60 * 60 * 1000, 40)
    await run(world, 10)
    expect(stops, 'a call a day old was billed to today').toHaveLength(0)

    // An hour ago: inside the rolling day, outside the 15-minute rate window, so the daily
    // budget is the only line this row can cross.
    billTo(opsDb, Date.now() - 60 * 60 * 1000, 0.06)
    await run(world, 10)
    expect(stops).toHaveLength(1)
    expect(ledgerTotalUsd(opsDb), 'and the lifetime total was never the trigger').toBeLessThan(50)

    const atStop = eventsOf(dir, 'agent_spoke').length
    await run(world, 10)
    expect(eventsOf(dir, 'agent_spoke').length).toBe(atStop)
  }, 40_000)

  it('refuses a boot that is already over the day, before the pre-flight spends a cent', async () => {
    const dir = tmp()
    const { world, opsDb } = await liveWorld({ dir, spendDailyUsd: 0.25 })
    await run(world, 2)
    billTo(opsDb, Date.now(), 0.4)
    await worlds.splice(worlds.indexOf(world), 1)[0]!.stop()

    await expect(liveWorld({ dir, spendDailyUsd: 0.25 })).rejects.toThrow(/daily budget/)
  }, 60_000)

  // A run that never reconciles is a run whose dollar figures have no second opinion. The stale
  // pin this exists for read 2x.
  it('★ reconciles the ledger against the provider bill when the town closes', async () => {
    const dir = tmp()
    const { world, opsDb } = await liveWorld({ dir })
    await run(world, 2)
    opsDb
      .prepare(
        `INSERT INTO llm_calls
       (ts, agent_id, caller, model, input_tokens, output_tokens, cache_read_tokens,
        reasoning_tokens, cost_usd, estimated_cost_usd, reported_cost_usd, latency_ms, ok,
        error, provider)
       VALUES (?, NULL, 'turn', 'm', 0, 0, 0, 0, 0.02, 0.01, 0.02, 0, 1, NULL, 'p')`,
      )
      .run(Date.now())
    expect(alertsOf(opsDb, 'llm_price_reconciliation')).toHaveLength(0)

    await worlds.splice(worlds.indexOf(world), 1)[0]!.stop()

    const closed = openAgentDb(join(dir, 'minds', LIVE_OPS_DB))
    const alerts = alertsOf(closed, 'llm_price_reconciliation')
    closed.close()
    expect(alerts, 'the town closed without ever checking its own prices').toHaveLength(1)
    expect(alerts[0]).toContain('2.00x out')
  }, 40_000)

  // Rehearsal 3 paid $0.0652 — 9.2% of its dollars — for calls that came back with nothing, and
  // no ops surface said so.
  it('★ says what the run bought and who served it when the town closes', async () => {
    const dir = tmp()
    const { world, opsDb } = await liveWorld({ dir })
    await run(world, 2)
    opsDb
      .prepare(
        `INSERT INTO llm_calls
       (ts, agent_id, caller, model, input_tokens, output_tokens, cache_read_tokens,
        reasoning_tokens, cost_usd, estimated_cost_usd, latency_ms, ok, error, provider)
       VALUES (?, 'amara', 'turn', 'm', 0, 0, 0, 0, 0.013, 0.013, 0, 0, ?, NULL)`,
      )
      .run(Date.now(), 'No output generated.')
    expect(alertsOf(opsDb, 'llm_dead_calls')).toHaveLength(0)

    await worlds.splice(worlds.indexOf(world), 1)[0]!.stop()

    const closed = openAgentDb(join(dir, 'minds', LIVE_OPS_DB))
    const dead = alertsOf(closed, 'llm_dead_calls')
    const mix = alertsOf(closed, 'llm_provider_mix')
    closed.close()
    expect(dead, 'a paid call that bought nothing went unreported').toHaveLength(1)
    expect(dead[0]).toContain('amara')
    expect(dead[0]).toContain('1 empty')
    expect(mix.length, 'the run closed without naming who served it').toBeGreaterThan(0)
  }, 40_000)

  // The projected-burn alert fires at $0.40/sim-day, well under either hard stop.
  it('★ warns the operator about a projected burn well before a hard stop kills the run', async () => {
    const dir = tmp()
    const { world, opsDb } = await liveWorld({
      dir,
      spendCapUsd: 50,
      spendDailyUsd: 50,
      rateWindowRealMinutes: 15,
      spendAlertRealMinutes: 0,
    })
    await run(world, 4)
    expect(alertsOf(opsDb, 'spend_projection')).toHaveLength(0)

    // Art, which the rate tripwire excludes by design: only the operator alert can speak here.
    // $0.30 in a 15-minute window projects to $0.96/sim-day, over the $0.40 threshold.
    opsDb
      .prepare(
        `INSERT INTO llm_calls
       (ts, agent_id, caller, model, input_tokens, output_tokens, cache_read_tokens,
        reasoning_tokens, cost_usd, estimated_cost_usd, latency_ms, ok, error, provider)
       VALUES (?, NULL, 'forge', 'm', 0, 0, 0, 0, 0.3, 0.3, 0, 1, NULL, NULL)`,
      )
      .run(Date.now())

    await run(world, 12)
    const alerts = alertsOf(opsDb, 'spend_projection')
    expect(alerts.length, 'the operator was never told').toBeGreaterThan(0)
    expect(alerts[0]).toContain('projected $0.96/sim-day over a $0.40 threshold')
  }, 40_000)

  // 9 of rehearsal 3's 309 calls were served off the pin: a cold prefix and an unpriced route
  // each time.
  it('★ pins the provider as an allow-list for every mind-facing call', () => {
    const db = new Database(':memory:')
    migrateLlmTables(db)
    for (const caller of ['turn', 'reflection', 'dream', 'naming', 'arbiter', 'semantic']) {
      const body = new LlmClient({
        db,
        caller,
        allowProviderFallbacks: LIVE_ALLOW_PROVIDER_FALLBACKS,
      }).requestBody()
      expect(body.provider.allow_fallbacks, caller).toBe(false)
    }
    db.close()
  })

  it('names the amount, the budget and the way out', () => {
    const msg = dailyReachedRefusal(3.1234, 3)
    expect(msg).toContain('$3.1234')
    expect(msg).toContain('$3.00')
    expect(msg).toContain('SJ_SPEND_DAILY_USD')
    expect(msg).toContain('Nothing was spent')
  })

  it('leaves the measured rate alone — the real stream must not trip its own wire', async () => {
    const stops: { spent: number; cap: number }[] = []
    const dir = tmp()
    const { world, opsDb } = await liveWorld({
      dir,
      spendCapUsd: 5,
      rateWindowRealMinutes: 15,
      onSpendStop: (spent, cap) => stops.push({ spent, cap }),
    })
    // Run C's measured 4.7 calls a mind a sim-hour, for two minds over a 12-sim-hour window,
    // and a nightly reflection burst on top of it.
    callsTo(opsDb, 'turn', 113)
    callsTo(opsDb, 'reflection', 12)

    await run(world, 20)
    expect(stops, 'the tripwire fired on an ordinary night').toHaveLength(0)
  }, 40_000)

  // The tripwire is per MIND, so town work must not be billed to the cast: the narrator, the
  // arbiter and the tier-2.5 pass cost the same however many minds are alive.
  it("★ counts a mind's own calls and no others", async () => {
    const stops: { spent: number; cap: number }[] = []
    const dir = tmp()
    const { world, opsDb } = await liveWorld({
      dir,
      spendCapUsd: 5,
      rateWindowRealMinutes: 15,
      onSpendStop: (spent, cap) => stops.push({ spent, cap }),
    })
    for (const caller of ['narrator', 'arbiter', 'semantic', 'forge', 'preflight', 'constructs']) {
      callsTo(opsDb, caller, 300)
    }

    await run(world, 20)
    expect(stops, 'town work was charged to the cast').toHaveLength(0)
  }, 40_000)

  // ★ The allow-list is pinned with `allow_fallbacks:false`, so one call served by anyone else
  // is a leak past the pin — and it is still only ever a line on the ops surface.
  it('★ names a back end that got past the allow-list, and never stops the town for it', async () => {
    const stops: { spent: number; cap: number }[] = []
    const dir = tmp()
    const { world, opsDb } = await liveWorld({
      dir,
      spendCapUsd: 5,
      rateWindowRealMinutes: 15,
      onSpendStop: (spent, cap) => stops.push({ spent, cap }),
    })
    opsDb
      .prepare(
        `INSERT INTO llm_calls
       (ts, agent_id, caller, model, input_tokens, output_tokens, cache_read_tokens,
        reasoning_tokens, cost_usd, latency_ms, ok, error, provider)
       VALUES (?, NULL, 'turn', 'm', 0, 0, 0, 0, 0.01, 0, 1, NULL, 'Baidu')`,
      )
      .run(Date.now())

    await run(world, 20)
    const mix = alertsOf(opsDb, 'llm_provider_off_allow_list')
    expect(mix.length, 'the routing left the pin and nobody was told').toBeGreaterThan(0)
    expect(mix[0]).toContain('Baidu 1')
    expect(mix[0]).toContain('[Wafer, DeepInfra]')
    expect(mix[0]).toContain('$0.0100')
    expect(stops, 'a leaked back end must never stop a town').toHaveLength(0)
  }, 40_000)
})

describe('★ the cap is per town, not per process', () => {
  it('refuses a resumed town that has already spent its cap, before spending another cent', async () => {
    const dir = tmp()
    const { world, opsDb } = await liveWorld({ dir, spendCapUsd: 0.25 })
    await run(world, 2)
    opsDb
      .prepare(
        `INSERT INTO llm_calls
       (ts, agent_id, caller, model, input_tokens, output_tokens, cache_read_tokens,
        reasoning_tokens, cost_usd, latency_ms, ok, error, provider)
       VALUES (?, NULL, 'turn', 'm', 0, 0, 0, 0, 0.40, 0, 1, NULL, NULL)`,
      )
      .run(Date.now())
    await worlds.splice(worlds.indexOf(world), 1)[0]!.stop()

    // The ledger resumed with the town, so the second boot is already over the line.
    await expect(liveWorld({ dir, spendCapUsd: 0.25 })).rejects.toThrow(/already spent/)
    // …and it says the two ways out rather than only that it will not start.
    await expect(liveWorld({ dir, spendCapUsd: 0.25 })).rejects.toThrow(/SJ_FRESH=1/)
  }, 60_000)

  it('names the amount, the cap and the directory a fresh start would throw away', () => {
    const msg = capReachedRefusal(5.1234, 5, 'data/minds')
    expect(msg).toContain('$5.1234')
    expect(msg).toContain('$5.00')
    expect(msg).toContain('data/minds')
    expect(msg).toContain('per TOWN, not per process')
  })

  it('reports what the PRE-FLIGHT cost, not what the town has ever cost', () => {
    // The ledger resumes with the world, so an unscoped sum reports the town's whole history
    // as what the pre-flight cost.
    const dir = tmp()
    const db = openAgentDb(join(dir, 'ledger.db'))
    db.exec(`CREATE TABLE IF NOT EXISTS llm_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, agent_id TEXT, caller TEXT, model TEXT,
      input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER,
      reasoning_tokens INTEGER, cost_usd REAL, latency_ms INTEGER, ok INTEGER, error TEXT,
      provider TEXT)`)
    const put = (ts: number, caller: string, usd: number): void => {
      db.prepare(
        'INSERT INTO llm_calls (ts, caller, model, cost_usd, ok) VALUES (?, ?, ?, ?, 1)',
      ).run(ts, caller, 'm', usd)
    }
    put(1000, 'preflight', 0.001) // a previous boot's pre-flight
    put(2000, 'turn', 0.9) // a previous boot's town
    put(3000, 'preflight', 0.002) // THIS boot's pre-flight
    expect(preflightCostUsd(db, 2500)).toBeCloseTo(0.002, 6)
    expect(ledgerTotalUsd(db)).toBeCloseTo(0.903, 6)
    expect(ledgerTotalUsd(db, 2500), 'the window the daily budget reads').toBeCloseTo(0.002, 6)
    db.close()
  })
})

describe("★ a mind's memory across a resume", () => {
  it('REFUSES a new day-0 town whose minds remember an older one', async () => {
    const dir = tmp()
    const { world } = await liveWorld({ dir })
    await run(world, 4)
    await worlds.splice(worlds.indexOf(world), 1)[0]!.stop()
    const amara = openAgentDb(join(dir, 'minds', 'amara.db'))
    const held = (amara.prepare('SELECT COUNT(*) AS n FROM memories').get() as { n: number }).n
    amara.close()
    expect(held).toBeGreaterThan(0)

    rmSync(join(dir, 'world.db'), { force: true })
    rmSync(join(dir, 'world.db-wal'), { force: true })
    rmSync(join(dir, 'world.db-shm'), { force: true })

    await expect(liveWorld({ dir })).rejects.toThrow(/minds remember an older one/)
  }, 40_000)

  it('carries the memory AND the half-run plan across a clean stop and start', async () => {
    const dir = tmp()
    const first = await liveWorld({ dir })
    await run(first.world, 4)
    const tickWas = first.world.loop.tick
    await worlds.splice(worlds.indexOf(first.world), 1)[0]!.stop()

    const amara = openAgentDb(join(dir, 'minds', 'amara.db'))
    const memoriesBefore = (
      amara.prepare('SELECT COUNT(*) AS n FROM memories').get() as { n: number }
    ).n
    const row = amara
      .prepare('SELECT tick, snapshot FROM mind_runtime WHERE agent_id = ?')
      .get('amara') as { tick: number; snapshot: string }
    const versions = (
      amara
        .prepare('SELECT COUNT(*) AS n FROM personality_versions WHERE agent_id = ?')
        .get('amara') as { n: number }
    ).n
    amara.close()
    expect(memoriesBefore).toBeGreaterThan(0)
    expect(row.tick).toBe(tickWas)
    expect((JSON.parse(row.snapshot) as { stats: { turns: number } }).stats.turns).toBeGreaterThan(
      0,
    )
    expect(versions).toBe(1)

    const second = await liveWorld({ dir })
    expect(second.world.resumedAtTick).toBe(tickWas)
    await run(second.world, 2)
    const again = openAgentDb(join(dir, 'minds', 'amara.db'))
    // Not wiped, not re-seeded, and still exactly one personality: `hasPersonality` saw the row.
    expect(
      (again.prepare('SELECT COUNT(*) AS n FROM memories').get() as { n: number }).n,
    ).toBeGreaterThanOrEqual(memoriesBefore)
    expect(
      (
        again
          .prepare('SELECT COUNT(*) AS n FROM personality_versions WHERE agent_id = ?')
          .get('amara') as { n: number }
      ).n,
    ).toBe(1)
    again.close()
  }, 60_000)

  it('★ A CHILD BORN INTO THIS TOWN IS STILL IN IT AFTER A RESTART', async () => {
    const dir = tmp()
    const first = await liveWorld({ dir })
    await run(first.world, 2)
    const bornTick = first.world.loop.tick
    await worlds.splice(worlds.indexOf(first.world), 1)[0]!.stop()

    // The birth by hand: gestation is the engine's business and is not what is under test.
    const wdb = new Database(join(dir, 'world.db'))
    wdb.prepare('INSERT INTO events (tick, type, payload) VALUES (?, ?, ?)').run(
      bornTick,
      'agent_born',
      JSON.stringify({
        id: 'agent_born_1',
        name: 'Mira',
        sex: 'f',
        motherId: 'amara',
        fatherId: 'omar',
        x: 3,
        y: 3,
      }),
    )
    wdb.close()

    // A boot that was handed the two FOUNDERS and nothing else.
    const second = await liveWorld({ dir })
    await run(second.world, 2)
    expect(second.world.loop.state.agents.agent_born_1).toBeDefined()
    expect(existsSync(join(dir, 'minds', 'agent_born_1.db'))).toBe(true)
    const child = openAgentDb(join(dir, 'minds', 'agent_born_1.db'))
    expect(
      (
        child
          .prepare('SELECT COUNT(*) AS n FROM personality_versions WHERE agent_id = ?')
          .get('agent_born_1') as { n: number }
      ).n,
    ).toBe(1)
    child.close()
  }, 60_000)

  it('SJ_FRESH takes the minds with the world, in one breath', async () => {
    const dir = tmp()
    const first = await liveWorld({ dir })
    await run(first.world, 4)
    await worlds.splice(worlds.indexOf(first.world), 1)[0]!.stop()

    const second = await liveWorld({ dir, fresh: true })
    expect(second.world.resumedAtTick).toBeNull()
    const amara = openAgentDb(join(dir, 'minds', 'amara.db'))
    // A brand new file: whatever it holds now was written after the wipe, and the guard above
    // proves a world at tick 0 with an unwiped mind would have refused to start at all.
    expect(
      (amara.prepare('SELECT COUNT(*) AS n FROM memories WHERE tick < 1').get() as { n: number }).n,
    ).toBe(0)
    amara.close()
  }, 60_000)

  it('refuses to put back a plan from AHEAD of the world — the tick SQLite rolled back', () => {
    const snap = JSON.stringify({ stats: { turns: 3 } })
    expect(restorableSnapshot({ tick: 40, snapshot: snap }, 41)).not.toBeNull()
    expect(restorableSnapshot({ tick: 41, snapshot: snap }, 41)).not.toBeNull()
    expect(restorableSnapshot({ tick: 42, snapshot: snap }, 41)).toBeNull()
    expect(restorableSnapshot(undefined, 41)).toBeNull()
    expect(restorableSnapshot({ tick: 1, snapshot: 'not json' }, 41)).toBeNull()
  })

  it('names every mind that is still remembering, and the way out', () => {
    const msg = amnesiaRefusal([
      { id: 'amara', memories: 12 },
      { id: 'omar', memories: 4 },
    ])
    expect(msg).toContain('amara (12)')
    expect(msg).toContain('omar (4)')
    expect(msg).toContain('SJ_FRESH=1')
  })
})

describe('★ what the first live boot broke', () => {
  it('the fresh wipe runs BEFORE the cast opens anything, so the ledger is still on disk', async () => {
    const dir = tmp()
    const { world, opsDb } = await liveWorld({ dir, fresh: true })
    await run(world, 2)

    const onDisk = join(dir, 'minds', LIVE_OPS_DB)
    expect(existsSync(onDisk), 'the ledger the cap reads was deleted after it was opened').toBe(
      true,
    )
    opsDb
      .prepare(
        `INSERT INTO llm_calls
       (ts, agent_id, caller, model, input_tokens, output_tokens, cache_read_tokens,
        reasoning_tokens, cost_usd, latency_ms, ok, error, provider)
       VALUES (?, NULL, 'turn', 'm', 0, 0, 0, 0, 0.5, 0, 1, NULL, NULL)`,
      )
      .run(Date.now())
    // And a reader that opens the PATH — which is all a restarted process has — sees it.
    const reopened = new Database(onDisk, { readonly: true, fileMustExist: true })
    try {
      expect(
        (
          reopened.prepare('SELECT COALESCE(SUM(cost_usd), 0) AS t FROM llm_calls').get() as {
            t: number
          }
        ).t,
      ).toBeCloseTo(0.5, 6)
    } finally {
      reopened.close()
    }
  }, 40_000)

  it('a world that cannot take its port stops the cast instead of leaving it booted', async () => {
    const dir = tmp()
    const blocker = createServer()
    const taken = await new Promise<number>((resolve) => {
      blocker.listen(0, () => {
        resolve((blocker.address() as { port: number }).port)
      })
    })
    let stopped = 0
    try {
      await expect(
        startDevWorld({
          dbPath: join(dir, 'world.db'),
          port: taken,
          world: { map: 'showcase' },
          realMsPerTick: 10_000_000,
          agentDbDir: join(dir, 'minds'),
          cast: async () => ({
            attach: ({ world }) => world,
            ops: null,
            stop: async () => {
              stopped += 1
            },
          }),
        }),
      ).rejects.toThrow()
    } finally {
      await new Promise((r) => blocker.close(r))
    }
    expect(stopped, 'five minds were left holding databases and the process never exited').toBe(1)

    // A failed listen never returns the object `close()` is on, orphaning its pump timer, and
    // vitest reports the orphan's throw as an unhandled error — so wait out two poll intervals.
    await new Promise((r) => setTimeout(r, 600))
  }, 30_000)
})

describe('★ closing the town without closing a database under a mind', () => {
  // `runSleepReflection` writes its facts AFTER the model answers, so closing the mind's db
  // mid-flight throws out of a promise nobody awaits — a stream that dies on SIGTERM.
  it('waits while a reflection is still in flight', async () => {
    let busy = true
    setTimeout(() => {
      busy = false
    }, 120)
    const at = Date.now()
    expect(await settle(() => busy, 5_000, 20)).toBe(true)
    expect(Date.now() - at).toBeGreaterThanOrEqual(100)
  })

  it('and gives up rather than hanging the shutdown', async () => {
    const at = Date.now()
    expect(await settle(() => true, 200, 20)).toBe(false)
    // Bounded: it must not sit past its own deadline waiting out one more poll.
    expect(Date.now() - at).toBeLessThan(1_000)
  })
})

// Every row here asserts the ROUND TRIP and not the call: a novel intent reached the god AND came
// back as something the world or the mind can perceive.
describe('★ a mind attempts what the engine has no verb for, and a god rules on it', () => {
  const rulebookOf = (dir: string): { recipe_id: string; verb: string }[] => {
    const db = new Database(join(dir, 'minds', '_arbiter.db'), {
      readonly: true,
      fileMustExist: true,
    })
    try {
      return db.prepare('SELECT recipe_id, verb FROM rulebook').all() as {
        recipe_id: string
        verb: string
      }[]
    } finally {
      db.close()
    }
  }
  const memoriesOf = (dir: string, id: string): string[] => {
    const db = new Database(join(dir, 'minds', `${id}.db`), { readonly: true, fileMustExist: true })
    try {
      return (
        db.prepare('SELECT text FROM memories WHERE agent_id = ?').all(id) as {
          text: string
        }[]
      ).map((r) => r.text)
    } finally {
      db.close()
    }
  }

  it('★ THE ROUND TRIP: the invented act becomes physics the engine did not have at boot', async () => {
    const dir = tmp()
    const { world } = await liveWorld({ dir, turn: INVENTING_TURN, verdict: SMOKE_VERDICT })
    await run(world, 8)

    // 1. The engine did not know this verb when the world booted, and knows it now. Nothing
    //    but a codification can have put it there.
    expect(VERBS[SMOKE_RECIPE.id]).toBeDefined()

    // 2. It is LAW, not a one-off: a durable rulebook row in the arbiter's own database.
    expect(rulebookOf(dir).map((r) => r.recipe_id)).toContain(SMOKE_RECIPE.id)

    // 3. The world was TOLD — `onCodified` -> `bridge.announce` -> the event log the gateway
    //    serves and the chronicle renders. This is the half a viewer can actually see.
    const discoveries = eventsOf(dir, 'discovery_made')
    expect(discoveries.map((p) => p.name)).toContain(SMOKE_RECIPE.name)
    const mine = discoveries.find((p) => p.name === SMOKE_RECIPE.name)!
    expect(mine.byId).toBe('amara')
    // `humanizeIntent` takes the underscore out of the coined verb, so the chronicle renders
    // `smoke fish green wood` and not the identifier the schema made of it.
    expect(String(mine.intent)).toContain(INVENTED_VERB.replace(/_/g, ' '))
    expect(String(mine.intent)).not.toContain(INVENTED_VERB)

    // 4. ★ AND THE BODY DID IT. The mind's own hands ran a verb that did not exist eight ticks
    //    ago. Without this row the three above are satisfied by a god talking to itself.
    expect(eventsOf(dir, 'action_started').some((p) => p.verb === SMOKE_RECIPE.id)).toBe(true)
  }, 30_000)

  it('★ a refusal comes back in words the MIND can read, and teaches it something', async () => {
    const dir = tmp()
    const { world } = await liveWorld({ dir, turn: INVENTING_TURN, verdict: REFUSING_VERDICT })
    await run(world, 8)

    // The other half of the round trip. An impossible verdict is not a dropped turn: it is
    // written into the mind's memory, and the next prompt reads it back.
    const said = memoriesOf(dir, 'amara')
    expect(said.some((t) => t.startsWith('You realize you cannot:'))).toBe(true)
    // `insufficient_skill` earns the one sanctioned door — a refusal must leave one open.
    expect(said.some((t) => t.includes('perhaps someone nearby knows the craft'))).toBe(true)
    // And nothing was codified: a refusal must not mint physics.
    expect(rulebookOf(dir)).toHaveLength(0)
  }, 30_000)

  it('★ a god that THROWS does not eat the turn — the world answers instead', async () => {
    const dir = tmp()
    // No `verdict`, so the arbiter's client is handed the mind's canned turn, fits no verdict
    // schema, and throws out of `adjudicate`. This is a provider 500 in miniature.
    const { world, opsDb } = await liveWorld({ dir, turn: INVENTING_TURN })
    await run(world, 8)

    // The failure was recorded where an operator looks...
    const alerts = opsDb.prepare("SELECT kind FROM alerts WHERE kind = 'adjudicate_failed'").all()
    expect(alerts.length).toBeGreaterThan(0)
    // ...and the intent still reached the world as `experiment`, which never starts an activity
    // (`validate()` always declines), so the perceivable outcome is a memory, not an event.
    expect(
      memoriesOf(dir, 'amara').some((t) => t.includes('You lack the knowledge to attempt this')),
    ).toBe(true)
    // A god that fell over must not have minted law on the way down.
    expect(rulebookOf(dir)).toHaveLength(0)
  }, 30_000)

  it('★ THE TOWN DOES NOT FORGET ITS OWN LAWS ACROSS A RESTART', async () => {
    // A rulebook is durable but the engine's `VERBS` registry is in-memory, so a restart is when
    // a codified verb can silently stop existing while its ruling stays on disk.
    const dir = tmp()
    const first = await liveWorld({ dir, turn: INVENTING_TURN, verdict: SMOKE_VERDICT })
    await run(first.world, 8)
    const tickWas = first.world.loop.tick
    expect(rulebookOf(dir).map((r) => r.recipe_id)).toContain(SMOKE_RECIPE.id)
    await worlds.splice(worlds.indexOf(first.world), 1)[0]!.stop()

    // `VERBS` is module state and the first boot already put the verb there, so leaving it
    // registered would let this pass on a purely in-memory arbiter.
    unregisterVerb(SMOKE_RECIPE.id)
    expect(VERBS[SMOKE_RECIPE.id]).toBeUndefined()

    const second = await liveWorld({ dir, turn: INVENTING_TURN, verdict: SMOKE_VERDICT })
    expect(second.world.resumedAtTick).toBe(tickWas)

    // Re-registered from the durable rulebook, before a single tick of the resumed town.
    expect(VERBS[SMOKE_RECIPE.id]).toBeDefined()
    // One law, not two: a resumed town must not re-mint what it already knows.
    expect(rulebookOf(dir).filter((r) => r.recipe_id === SMOKE_RECIPE.id)).toHaveLength(1)

    // And the codex was not re-seeded on top of itself — genesis is inserted once per TOWN.
    const arb = new Database(join(dir, 'minds', '_arbiter.db'), {
      readonly: true,
      fileMustExist: true,
    })
    try {
      const n = (
        arb.prepare("SELECT COUNT(*) AS n FROM codex WHERE id = 'cooking'").get() as { n: number }
      ).n
      expect(n).toBe(1)
      // The ruling itself survived too, so a rephrasing still short-circuits for free.
      expect(
        (arb.prepare('SELECT COUNT(*) AS n FROM rulings').get() as { n: number }).n,
      ).toBeGreaterThan(0)
    } finally {
      arb.close()
    }
  }, 45_000)

  it('★ SJ_ARBITER=0 leaves no god and no database, and the turn still lands', async () => {
    const dir = tmp()
    const { world } = await liveWorld({
      dir,
      turn: INVENTING_TURN,
      verdict: SMOKE_VERDICT,
      useArbiter: false,
    })
    await run(world, 8)

    // Off means off: not a wired arbiter that declines, but no arbiter and no laws on disk.
    expect(existsSync(join(dir, 'minds', '_arbiter.db'))).toBe(false)
    expect(eventsOf(dir, 'discovery_made')).toHaveLength(0)

    // With no adjudicator wired `#reroutesUnknownVerb` declines to re-route at all, and the
    // refusal still reaches the mind — in the world's words, never the engine's registry's.
    const memories = memoriesOf(dir, 'amara')
    expect(memories.some((t) => t.includes(`unknown verb: ${INVENTED_VERB}`))).toBe(false)
    expect(memories.some((t) => t.includes(OPAQUE_REFUSAL))).toBe(true)
  }, 30_000)
})

describe('the ops db sits inside the minds directory', () => {
  it('so the fresh wipe takes the ledger too', () => {
    // `wipeAgentMemory` deletes `*.db` under agentDbDir. A ledger kept anywhere else would
    // survive a fresh boot and the next run's cap would start half spent.
    expect(LIVE_OPS_DB.endsWith('.db')).toBe(true)
  })
})

// A sim-day passes every 48 real minutes, so this rehearsal is the whole of what a live stream does
// at the top of every hour — with a scripted client, and for $0.00.
describe('★ the chronicle, written on the day boundary', () => {
  /** A day of ticks without `run`'s per-tick microtask drain: this rehearsal is about the day
   *  boundary, not about what a mind managed between two of them. */
  const sprint = async (world: DevWorld, ticks: number): Promise<void> => {
    for (let i = 0; i < ticks; i++) {
      world.tick()
      if (i % 60 === 0) await new Promise((r) => setImmediate(r))
    }
    // A turn still in flight when the town closes writes to a database that is already shut.
    for (let k = 0; k < 24; k++) await new Promise((r) => setImmediate(r))
  }

  const narratorRows = (dir: string, sql: string): Record<string, unknown>[] => {
    const db = new Database(join(dir, 'minds', '_narrator.db'), { readonly: true })
    const rows = db.prepare(sql).all() as Record<string, unknown>[]
    db.close()
    return rows
  }

  it('writes the day that just closed, and bills it to the same ledger the minds spend from', async () => {
    const dir = tmp()
    const { world, callers, opsDb } = await liveWorld({
      dir,
      turn: SILENT_TURN,
      narratorDbPath: join(dir, 'minds', '_narrator.db'),
    })
    // day 0 closes at tick 1440; the tick after it is what the world reaches next
    await sprint(world, MINUTES_PER_DAY + 1)
    // The write is dispatched off the tick handler, so the world is a tick ahead of the prose.
    expect(
      await settle(() => narratorRows(dir, 'SELECT day FROM chapters').length === 0, 5_000),
    ).toBe(true)

    expect(narratorRows(dir, 'SELECT day, title FROM chapters')).toEqual([
      { day: 0, title: NARRATED_CHAPTER.title },
    ])
    expect(narratorRows(dir, 'SELECT kind, day FROM publications ORDER BY kind')).toEqual([
      { kind: 'biography', day: 0 },
      { kind: 'newspaper', day: 0 },
      { kind: 'timelapse_caption', day: 0 },
    ])
    expect(
      narratorRows(dir, "SELECT subject_id FROM publications WHERE kind = 'biography'"),
    ).toEqual([{ subject_id: 'amara' }])

    // A chronicler billing anywhere but the ops db the cap is read off would spend outside the
    // anomaly stop. Each rider on the boundary bills under its own name, so spend is attributable.
    expect([...callers]).toEqual(expect.arrayContaining(['narrator', 'semantic', 'constructs']))
    // and the semantic pass ran rather than falling over: no unreadable-verdict alert
    expect(alertsOf(opsDb, 'semantic_firsts_unreadable')).toEqual([])
  }, 120_000)

  // The recognizer's cost must not grow with the town's age: `agent_moved` alone is a row per
  // tile crossed, and re-parsing every one of them each sim-day blocks the loop for longer daily.
  it('★ the recognizer reads what is new, not the whole log again', async () => {
    const dir = tmp()
    const readTypeFrom = vi.spyOn(EventStore.prototype, 'readTypeFrom')
    const moved = (): number[] =>
      readTypeFrom.mock.calls.filter(([, type]) => type === 'agent_moved').map(([from]) => from)
    const { world } = await liveWorld({ dir, turn: SILENT_TURN })
    await sprint(world, MINUTES_PER_DAY + 1)
    expect(await settle(() => moved().length === 0, 10_000)).toBe(true)

    readTypeFrom.mockClear()
    await sprint(world, MINUTES_PER_DAY)
    expect(await settle(() => moved().length === 0, 10_000)).toBe(true)
    expect(moved().every((from) => from > 0)).toBe(true)
    readTypeFrom.mockRestore()
  }, 180_000)

  it('leaves the day unwritten when the daily budget is already spent', async () => {
    const dir = tmp()
    const { world, opsDb } = await liveWorld({
      dir,
      turn: SILENT_TURN,
      spendDailyUsd: 1,
      onSpendStop: () => {},
      narratorDbPath: join(dir, 'minds', '_narrator.db'),
    })
    // Billed BETWEEN two watchdog reads, so the cast is still running when the boundary lands:
    // this is the chronicle's own budget check, not the stop the watchdog would reach a tick later.
    await sprint(world, MINUTES_PER_DAY - 5)
    billTo(opsDb, Date.now(), 2)
    await sprint(world, 6)
    expect(narratorRows(dir, 'SELECT day FROM chapters')).toEqual([])
    expect(narratorRows(dir, 'SELECT day FROM publications')).toEqual([])
  }, 120_000)
})

// ★ THE SEAM, ASSERTED THE ONLY WAY IT CAN HONESTLY BE ASSERTED: every row here must FAIL
// against a scripted cast. A test that passes whether or not a mind is behind the body is the
// vacuous guard this project keeps finding, and the whole point of this file is the one thing
// a scripted founder can never do — say a sentence a model wrote.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { FakeEmbedder, insertAlert, openAgentDb, type LlmClient, type MindSpec } from '@sj/agents'
import { startDevWorld, type DevWorld, type LiveCast } from './devWorld.js'
import { foundersFor, townStructuresFor } from './founders.js'
import {
  LIVE_OPS_DB, amnesiaRefusal, capReachedRefusal, createLiveCast, ledgerTotalUsd,
  preflightCostUsd, restorableSnapshot, settle,
} from './liveWorld.js'
import { thoughtsSince } from './observer.js'

// What no puppet in `founders.ts` will ever say, because `founders.ts` cannot speak at all.
const SPOKEN = 'A mind said this and no script could have.'
const THOUGHT = 'A mind thought this and no script could have.'

const NO_USAGE = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 }

// Two of the five, so a row costs two runtimes rather than five. Ids match the town's bodies.
const TWO: MindSpec[] = [
  {
    id: 'amara', sex: 'f', ageDays: 34 * 364,
    identity: {
      name: 'Amara', age: 34, backstory: 'Keeps the tally.', temperament: 'exacting',
      voiceCard: {
        register: 'plain', rhythm: 'short', tics: [], neverSays: [],
        exampleLines: ['Put it back.'], wordBudget: { typical: 12, burst: 22 },
      },
    },
    personality: {
      temperament: 'exacting', values: ['a full store'], beliefs: ['what is counted keeps'],
      current: { mood: 'watchful', worries: [], goals: ['get through the day'] },
    },
  },
  {
    id: 'omar', sex: 'm', ageDays: 46 * 364,
    identity: {
      name: 'Omar', age: 46, backstory: 'Sits with the sick.', temperament: 'unhurried',
      voiceCard: {
        register: 'low', rhythm: 'slow', tics: [], neverSays: [],
        exampleLines: ['Now then.'], wordBudget: { typical: 16, burst: 28 },
      },
    },
    personality: {
      temperament: 'unhurried', values: ['sitting with the sick'], beliefs: ['a hand does more'],
      current: { mood: 'attentive', worries: [], goals: ['get through the day'] },
    },
  },
]

/**
 * A model that never leaves the process, in the shape `g11-deepworld.ts`'s own dry client
 * takes: it answers each schema with the first canned value that parses. `LlmClient`'s real
 * cost accounting is covered by `agents/src/llm/client.test.ts`; what these rows need is a
 * mind that decides, for nothing.
 */
function fakeLlm(db: Database.Database, agentId: string | null, turn: unknown): LlmClient {
  const canned = [turn, { facts: [] }, { scenes: [] }, { summary: '' }, { edits: [] }, {}]
  return {
    async object<T>(o: { schema: { safeParse(v: unknown): { success: boolean; data?: T } } }) {
      for (const c of canned) {
        const parsed = o.schema.safeParse(c)
        if (parsed.success) return { value: parsed.data as T, usage: NO_USAGE }
      }
      throw new Error('no canned answer fits this schema')
    },
    async text() { return { text: 'the day passes', usage: NO_USAGE } },
    totalCostUsd: () => 0,
    alert: (kind: string, detail: string) => insertAlert(db, { agentId, kind, detail }),
  } as unknown as LlmClient
}

// The tile the SCRIPTED patrol walks to on this same map, so the act a mind chooses here is
// one the world is known to accept — and so `action_started walk` actually fires, which is
// what makes the canned-thought row below capable of failing.
const WELLSIDE = foundersFor(townStructuresFor('showcase')).find((f) => f.id === 'amara')!.patrol[1]

const SPEAKING_TURN = {
  thought: THOUGHT, importance: 5, speech: SPOKEN,
  action: { verb: 'walk', params: { x: WELLSIDE.x, y: WELLSIDE.y } },
}
const SILENT_TURN = { thought: THOUGHT, importance: 2 }

// Every mind turns on the tick it is asked to, so a row does not have to step out the 120-tick
// boredom floor five times over.
const EAGER = {
  idleGapTicks: 0, boredomTicks: 1,
  bodyAlarm: { hunger: 0, energy: 0, warmth: 0, thirst: 0, affliction: Infinity },
}

const dirs: string[] = []
const worlds: DevWorld[] = []
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'sj-live-'))
  dirs.push(d)
  return d
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
  onSpendStop?: (spent: number, cap: number) => void
  fresh?: boolean
}): Promise<{ world: DevWorld; cast: LiveCast; opsDb: ReturnType<typeof openAgentDb> }> {
  const agentDbDir = join(opts.dir, 'minds')
  let seen: ReturnType<typeof openAgentDb> | null = null
  let cast: LiveCast | null = null
  // ★ THROUGH THE FACTORY, exactly as `serve.ts` does it. Built out here instead, the cast
  // would already hold the per-mind files open when `fresh` deleted them — which is what the
  // first live boot did, unlinking the very ledger the spend cap reads.
  const world = await startDevWorld({
    dbPath: join(opts.dir, 'world.db'), port: 0, map: 'showcase', realMsPerTick: 10_000_000,
    agentDbDir, ...(opts.fresh === undefined ? {} : { fresh: opts.fresh }),
    cast: async () => {
      cast = await createLiveCast({
        agentDbDir,
        minds: opts.minds ?? TWO,
        preflight: false,
        embedder: new FakeEmbedder(),
        mindConfig: EAGER,
        ...(opts.spendCapUsd === undefined ? {} : { spendCapUsd: opts.spendCapUsd }),
        ...(opts.onSpendStop === undefined ? {} : { onSpendStop: opts.onSpendStop }),
        log: () => {},
        makeClient: (opsDb, _caller, agentId) => {
          seen = opsDb
          return fakeLlm(opsDb, agentId ?? null, opts.turn ?? SPEAKING_TURN)
        },
      })
      return cast
    },
  })
  worlds.push(world)
  return { world, cast: cast!, opsDb: seen! }
}

/** Take WHOLE ticks — `world.tick()`, not `loop.step()` — and let every promise a turn started
 *  settle before the next one. The observer scan runs inside a whole tick and not inside a
 *  step, which is exactly where the canned thought lines are published from. */
async function run(world: DevWorld, ticks: number): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    world.tick()
    for (let k = 0; k < 12; k++) await Promise.resolve()
    await new Promise((r) => setImmediate(r))
  }
}

/** The world's own log, read back out of the db the way any other reader would. */
function eventsOf(dir: string, type: string): Array<Record<string, unknown>> {
  const db = new Database(join(dir, 'world.db'), { readonly: true, fileMustExist: true })
  try {
    return (db.prepare('SELECT payload FROM events WHERE type = ? ORDER BY seq').all(type) as
      Array<{ payload: string }>).map((r) => JSON.parse(r.payload) as Record<string, unknown>)
  } finally { db.close() }
}

function thoughtTexts(dir: string): string[] {
  const db = new Database(join(dir, 'world.db'), { readonly: true, fileMustExist: true })
  try { return thoughtsSince(db, 0).map((t) => t.text) } finally { db.close() }
}

describe('★ THE SEAM — a served world whose bodies are driven by minds', () => {
  it('★ a mind SPEAKS INTO THE STREAM — a sentence no scripted founder could produce', async () => {
    const dir = tmp()
    const { world } = await liveWorld({ dir })
    await run(world, 6)

    expect(world.live).toBe(true)
    const spoke = eventsOf(dir, 'agent_spoke')
    expect(spoke.length).toBeGreaterThan(0)
    expect(spoke.map((p) => p['text'])).toContain(SPOKEN)
    expect(spoke.map((p) => p['agentId'])).toEqual(expect.arrayContaining(['amara']))
  }, 30_000)

  it('★ AND THE SAME WORLD WITH THE SCRIPTED CAST SAYS NOTHING — the row above is not vacuous',
    async () => {
      const dir = tmp()
      const world = await startDevWorld({
        dbPath: join(dir, 'world.db'), port: 0, map: 'showcase', realMsPerTick: 10_000_000,
      })
      worlds.push(world)
      await run(world, 6)

      expect(world.live).toBe(false)
      expect(eventsOf(dir, 'agent_spoke')).toHaveLength(0)
      // …and it is a town that is genuinely running: the puppets walk.
      expect(eventsOf(dir, 'action_started').length).toBeGreaterThan(0)
    }, 30_000)

  it('the thought bubble carries what the mind THOUGHT, not one of ten canned lines', async () => {
    const dir = tmp()
    const { world } = await liveWorld({ dir })
    await run(world, 6)

    // The minds ARE walking, so a world still publishing the canned lines would publish one.
    expect(eventsOf(dir, 'action_started').some((p) => p['verb'] === 'walk')).toBe(true)
    const texts = thoughtTexts(dir)
    expect(texts).toContain(THOUGHT)
    // `THOUGHT_LINES.walk`, and the fallback for a verb the table has no line for.
    expect(texts).not.toContain('The path is clear enough.')
    expect(texts).not.toContain('Hm.')
    expect(new Set(texts)).toEqual(new Set([THOUGHT]))
  }, 30_000)

  it('★ THE PUPPET STRINGS ARE OFF: a cast that never acts leaves every body standing still',
    async () => {
      // The scripted patrol walks from tick 1. If `FoundersOpts.minds` did not cut the policy
      // loop, these bodies would move even though no mind ever asked them to.
      const dir = tmp()
      const { world } = await liveWorld({ dir, turn: SILENT_TURN })
      await run(world, 8)

      expect(eventsOf(dir, 'action_started')).toHaveLength(0)
      // And the scripted larder top-up is gone with it: a live town feeds itself or it does not.
      expect(eventsOf(dir, 'need_changed').filter((p) => Number(p['delta']) > 0)).toHaveLength(0)
    }, 30_000)
})

describe('★ the money, inside the served world', () => {
  it('stops every mind and calls the stop the moment the ledger reaches the cap', async () => {
    const stops: Array<{ spent: number; cap: number }> = []
    const dir = tmp()
    const { world, opsDb } = await liveWorld({
      dir, spendCapUsd: 0.25, onSpendStop: (spent, cap) => stops.push({ spent, cap }),
    })
    await run(world, 4)
    expect(stops).toHaveLength(0)

    opsDb.prepare(
      `INSERT INTO llm_calls
       (ts, agent_id, caller, model, input_tokens, output_tokens, cache_read_tokens,
        reasoning_tokens, cost_usd, latency_ms, ok, error, provider)
       VALUES (?, NULL, 'turn', 'm', 0, 0, 0, 0, ?, 0, 1, NULL, NULL)`,
    ).run(Date.now(), 0.30)
    expect(ledgerTotalUsd(opsDb)).toBeCloseTo(0.30, 6)

    await run(world, 10)     // the watchdog reads every LIVE_SPEND_CHECK_TICKS
    expect(stops).toHaveLength(1)
    expect(stops[0]!.cap).toBe(0.25)

    // And the minds are actually stopped, not merely reported: nothing more is said.
    const atStop = eventsOf(dir, 'agent_spoke').length
    await run(world, 10)
    expect(eventsOf(dir, 'agent_spoke').length).toBe(atStop)
  }, 40_000)
})

describe('★ the cap is per town, not per process', () => {
  it('refuses a resumed town that has already spent its cap, before spending another cent', async () => {
    const dir = tmp()
    const { world, opsDb } = await liveWorld({ dir, spendCapUsd: 0.25 })
    await run(world, 2)
    opsDb.prepare(
      `INSERT INTO llm_calls
       (ts, agent_id, caller, model, input_tokens, output_tokens, cache_read_tokens,
        reasoning_tokens, cost_usd, latency_ms, ok, error, provider)
       VALUES (?, NULL, 'turn', 'm', 0, 0, 0, 0, 0.40, 0, 1, NULL, NULL)`,
    ).run(Date.now())
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
    // The first resumed live boot printed `pre-flight … $0.047463` for twelve calls that had
    // cost about a tenth of a cent, because the ledger resumes with the world.
    const dir = tmp()
    const db = openAgentDb(join(dir, 'ledger.db'))
    db.exec(`CREATE TABLE IF NOT EXISTS llm_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, agent_id TEXT, caller TEXT, model TEXT,
      input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER,
      reasoning_tokens INTEGER, cost_usd REAL, latency_ms INTEGER, ok INTEGER, error TEXT,
      provider TEXT)`)
    const put = (ts: number, caller: string, usd: number): void => {
      db.prepare('INSERT INTO llm_calls (ts, caller, model, cost_usd, ok) VALUES (?, ?, ?, ?, 1)')
        .run(ts, caller, 'm', usd)
    }
    put(1000, 'preflight', 0.001)   // a previous boot's pre-flight
    put(2000, 'turn', 0.9)          // a previous boot's town
    put(3000, 'preflight', 0.002)   // THIS boot's pre-flight
    expect(preflightCostUsd(db, 2500)).toBeCloseTo(0.002, 6)
    expect(ledgerTotalUsd(db)).toBeCloseTo(0.903, 6)
    db.close()
  })
})

describe('★ a mind\'s memory across a resume', () => {
  it('REFUSES a new day-0 town whose minds remember an older one', async () => {
    const dir = tmp()
    // Boot once, let two minds write memories, stop.
    const { world } = await liveWorld({ dir })
    await run(world, 4)
    await worlds.splice(worlds.indexOf(world), 1)[0]!.stop()
    const amara = openAgentDb(join(dir, 'minds', 'amara.db'))
    const held = (amara.prepare('SELECT COUNT(*) AS n FROM memories').get() as { n: number }).n
    amara.close()
    expect(held).toBeGreaterThan(0)

    // Now throw the WORLD away by hand and leave the minds standing.
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
    const memoriesBefore = (amara.prepare('SELECT COUNT(*) AS n FROM memories').get() as { n: number }).n
    const row = amara.prepare('SELECT tick, snapshot FROM mind_runtime WHERE agent_id = ?')
      .get('amara') as { tick: number; snapshot: string }
    const versions = (amara.prepare(
      'SELECT COUNT(*) AS n FROM personality_versions WHERE agent_id = ?').get('amara') as { n: number }).n
    amara.close()
    expect(memoriesBefore).toBeGreaterThan(0)
    expect(row.tick).toBe(tickWas)
    expect(JSON.parse(row.snapshot).stats.turns).toBeGreaterThan(0)
    expect(versions).toBe(1)

    const second = await liveWorld({ dir })
    expect(second.world.resumedAtTick).toBe(tickWas)
    await run(second.world, 2)
    const again = openAgentDb(join(dir, 'minds', 'amara.db'))
    // Not wiped, not re-seeded, and still exactly one personality: `hasPersonality` saw the row.
    expect((again.prepare('SELECT COUNT(*) AS n FROM memories').get() as { n: number }).n)
      .toBeGreaterThanOrEqual(memoriesBefore)
    expect((again.prepare('SELECT COUNT(*) AS n FROM personality_versions WHERE agent_id = ?')
      .get('amara') as { n: number }).n).toBe(1)
    again.close()
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
    expect((amara.prepare('SELECT COUNT(*) AS n FROM memories WHERE tick < 1').get() as { n: number }).n)
      .toBe(0)
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
    const msg = amnesiaRefusal([{ id: 'amara', memories: 12 }, { id: 'omar', memories: 4 }])
    expect(msg).toContain('amara (12)')
    expect(msg).toContain('omar (4)')
    expect(msg).toContain('SJ_FRESH=1')
  })
})

// ★ BOTH OF THESE ARE REGRESSIONS FROM THE FIRST REAL LIVE BOOT, NOT IMAGINED CASES. That boot
// printed "the world db was deleted along with 3 agent memory db(s)" — the three were the call
// ledger and its WAL, unlinked out from under the open handle — and then hung for ever on a
// taken port with five minds still booted and nothing holding a reference to stop them.
describe('★ what the first live boot broke', () => {
  it('the fresh wipe runs BEFORE the cast opens anything, so the ledger is still on disk', async () => {
    const dir = tmp()
    const { world, opsDb } = await liveWorld({ dir, fresh: true })
    await run(world, 2)

    const onDisk = join(dir, 'minds', LIVE_OPS_DB)
    expect(existsSync(onDisk), 'the ledger the cap reads was deleted after it was opened')
      .toBe(true)
    opsDb.prepare(
      `INSERT INTO llm_calls
       (ts, agent_id, caller, model, input_tokens, output_tokens, cache_read_tokens,
        reasoning_tokens, cost_usd, latency_ms, ok, error, provider)
       VALUES (?, NULL, 'turn', 'm', 0, 0, 0, 0, 0.5, 0, 1, NULL, NULL)`,
    ).run(Date.now())
    // And a reader that opens the PATH — which is all a restarted process has — sees it.
    const reopened = new Database(onDisk, { readonly: true, fileMustExist: true })
    try {
      expect((reopened.prepare('SELECT COALESCE(SUM(cost_usd), 0) AS t FROM llm_calls').get() as { t: number }).t)
        .toBeCloseTo(0.5, 6)
    } finally { reopened.close() }
  }, 40_000)

  it('a world that cannot take its port stops the cast instead of leaving it booted', async () => {
    const dir = tmp()
    // Hold a port, then ask the world for it.
    const blocker = createServer()
    const taken = await new Promise<number>((resolve) => {
      blocker.listen(0, () => resolve((blocker.address() as { port: number }).port))
    })
    let stopped = 0
    try {
      await expect(startDevWorld({
        dbPath: join(dir, 'world.db'), port: taken, map: 'showcase', realMsPerTick: 10_000_000,
        agentDbDir: join(dir, 'minds'),
        cast: async () => ({ attach: ({ world }) => world, stop: async () => { stopped += 1 } }),
      })).rejects.toThrow()
    } finally {
      await new Promise((r) => blocker.close(r))
    }
    expect(stopped, 'five minds were left holding databases and the process never exited').toBe(1)

    // ★ AND NOTHING IS STILL POLLING. `createGateway` builds its pump timer BEFORE it listens,
    // and `close()` — the only thing that clears it — is on the object a failed listen never
    // returns. The orphan fired every 250 ms against a db the caller had closed and threw an
    // UNCAUGHT `The database connection is not open`. Vitest reports that as an unhandled
    // error rather than a failure, so this waits past two poll intervals for it.
    await new Promise((r) => setTimeout(r, 600))
  }, 30_000)
})

describe('★ closing the town without closing a database under a mind', () => {
  // `runSleepReflection` writes its facts and scene summaries AFTER the model answers. Close
  // the mind's db while one is in flight and better-sqlite3 throws "The database connection is
  // not open" out of a promise nobody awaits — a stream that dies on SIGTERM instead of
  // shutting down. `stop` waits for the night, but only for as long as a container will let it.
  it('waits while a reflection is still in flight', async () => {
    let busy = true
    setTimeout(() => { busy = false }, 120)
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

describe('★ the default stays scripted and free', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const src = (name: string): string => readFileSync(join(here, name), 'utf8')

  it('nothing on the scripted path can reach an LLM: no static @sj/agents import', () => {
    // The claim `serve.ts` makes in its own header — that `pnpm stream` loads no onnxruntime
    // and spends $0.00 — is only true while this holds. A static import anywhere on the
    // scripted path would load the whole mind stack for a world that never uses it.
    // The prose in `devWorld.ts` NAMES the package while arguing why it must not import it,
    // so this reads the import statements and not the file.
    const imports = (name: string): string[] =>
      src(name).split('\n').filter((l) => /^\s*import\b/.test(l) || /\bfrom '@sj\//.test(l))
    for (const file of ['devWorld.ts', 'founders.ts', 'server.ts', 'api.ts']) {
      expect(imports(file).join('\n')).not.toContain('@sj/agents')
    }
    // And the one file that does import it is the one that is allowed to.
    expect(imports('liveWorld.ts').join('\n')).toContain('@sj/agents')
  })

  it('serve.ts reaches the live world only through a dynamic import behind the flag', () => {
    const s = src('serve.ts')
    expect(s).not.toMatch(/^import .*liveWorld/m)
    expect(s).toContain("import('./liveWorld.js')")
    expect(s).toContain("process.env['SJ_LIVE'] === '1'")
  })

  it('the ops db sits inside the minds directory, so the fresh wipe takes the ledger too', () => {
    // `wipeAgentMemory` deletes `*.db` under agentDbDir. A ledger kept anywhere else would
    // survive a fresh boot and the next run's cap would start half spent.
    expect(LIVE_OPS_DB.endsWith('.db')).toBe(true)
  })
})

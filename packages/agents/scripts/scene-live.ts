// LIVE — one real scene between two founders, opened through the real coordinator and taken by
// two real `AgentRuntime`s on the real client. Everything but the opening word is production
// path. Two arms over the same opener: the persona's TYPICAL word cap, which is what this lane
// picked for a scene, and the persona's BURST, which is the ordinary turn's rule and the control.
import { writeFileSync } from 'node:fs'
import { EventStore, openDb } from '@sj/engine/store'
import { fold, genesisState, RngStreams, TickLoop } from '@sj/engine'
import { SimConfigSchema, type SimConfig, type TileId } from '@sj/shared'
import { LlmClient, migrateLlmTables } from '@sj/llm'
import { FakeEmbedder } from '@sj/llm/testutil'
import { EngineBridge } from '../src/runtime/bridge.js'
import { AgentRuntime } from '../src/runtime/agentRuntime.js'
import { openAgentDb } from '../src/memory/schema.js'
import { MemoryStore } from '../src/memory/store.js'
import { TieStore } from '../src/memory/ties.js'
import { PersonalityStore } from '../src/personality.js'
import { SceneCoordinator, type SceneMind } from '../src/scene/coordinator.js'
import { makeSceneLlm } from '../src/scene/sceneLlm.js'
import { FOUNDER_MINDS } from '../src/live/founderMinds.js'
import type { MindConfig } from '../src/wake.js'
import type { IdentityCore } from '../src/prompt/assemble.js'
// Relative, like `manipulator-live.ts`: a script is outside the package graph, which is the only
// reason it may read the chronicle's own cast guard without @sj/agents declaring @sj/narrator.
import { namesOutsideRoll } from '../../narrator/src/chronicle.js'

// Per caller, per arm: two arms of one scene each cannot pass $0.40 of the lane's $0.50 ceiling.
const SCENE_CAP_USD = 0.15
const TURN_CAP_USD = 0.05
const OUT = process.env.SJ_OUT ?? '/tmp/scene-live.json'
const PAIR = (process.env.SJ_PAIR ?? 'amara,yusuf').split(',')
const OPENER = process.env.SJ_OPEN ?? 'Yusuf. The store is four days of bread, and that is all.'
const ARMS = (process.env.SJ_ARMS ?? 'typical,burst').split(',')
// Morning, and a slow tick: a scene of twelve lines takes a few real minutes, and the
// night gate must not close it before the twelfth.
const MORNING = 8 * 60
const TICK_MS = 400
const MAX_STEPS = 900

type Row = { agentId: string; name: string; text: string; aside: string; move: string }

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const flush = (): Promise<void> => new Promise((r) => setImmediate(r))

function simConfig(): SimConfig {
  return SimConfigSchema.parse({
    needs: { hungerDecayPerTick: 0 },
    structures: { sleepIndoorsOnly: false },
    warmth: { enabled: false },
  })
}

// The persona's burst as its typical: the arm that speaks under the ordinary turn's rule.
function atBurst(identity: IdentityCore): IdentityCore {
  const budget = identity.voiceCard.wordBudget
  if (budget === undefined) return identity
  return {
    ...identity,
    voiceCard: { ...identity.voiceCard, wordBudget: { ...budget, typical: budget.burst } },
  }
}

async function runArm(arm: string): Promise<{
  lines: Row[]
  summary: string
  deltas: unknown[]
  closeReason: string | undefined
  calls: {
    caller: string
    agentId: string
    input: number
    cached: number
    output: number
    ms: number
    ok: number
    provider: string | null
    blocks: string | null
  }[]
  costUsd: number
}> {
  const config = simConfig()
  const terrain: TileId[][] = Array.from({ length: 48 }, () =>
    Array.from({ length: 48 }, (): TileId => 0),
  )
  const store = new EventStore(openDb(':memory:'))
  let state = genesisState(config, terrain)
  const seed = (type: string, payload: unknown): void => {
    state = fold(state, store.append(state.tick, type, payload), config)
  }
  // Every founder has a body, so the roll the minds are given is the town's real twelve; only
  // the pair stands close enough to hear anything.
  let away = 0
  for (const m of FOUNDER_MINDS) {
    const near = PAIR.includes(m.id)
    const x = near ? 3 + PAIR.indexOf(m.id) : 30 + (away % 6) * 2
    const y = near ? 3 : 30 + Math.floor(away / 6) * 2
    if (!near) away += 1
    seed('agent_spawned', { id: m.id, name: m.identity.name, x, y, ageDays: m.ageDays })
  }
  const loop = new TickLoop({
    store,
    state,
    rng: new RngStreams(`scene-live-${arm}`),
    config,
    startTick: MORNING,
    onTick: (ctx) => {
      handler(ctx)
    },
  })
  const bridge = new EngineBridge({ loop, store, simConfig: config })
  // Nothing grows and nothing decays here: the only thing under test is the talk.
  const handler = bridge.wrapTickHandler(() => undefined)

  const embedder = await FakeEmbedder.create()
  const opsDb = openDb(':memory:')
  migrateLlmTables(opsDb)
  const minds = new Map<string, SceneMind>()
  const coordinator = new SceneCoordinator({
    bridge,
    mindFor: (id) => minds.get(id) ?? null,
    onError: (kind, detail) => {
      console.error(`  ! ${kind}: ${detail}`)
    },
  })
  const runtimes = new Map<string, AgentRuntime>()
  const living = (): { id: string; name: string }[] =>
    FOUNDER_MINDS.filter((m) => bridge.isAlive(m.id)).map((m) => ({
      id: m.id,
      name: m.identity.name,
    }))
  const config2: Partial<MindConfig> = { idleGapTicks: 5, boredomTicks: 10 }

  for (const id of PAIR) {
    const spec = FOUNDER_MINDS.find((m) => m.id === id)
    if (spec === undefined) throw new Error(`no founder called ${id}`)
    const db = openAgentDb(':memory:')
    migrateLlmTables(db)
    const personality = new PersonalityStore(db, id)
    personality.init(spec.personality, 0)
    const mem = new MemoryStore(db, id, embedder)
    const identity = arm === 'burst' ? atBurst(spec.identity) : spec.identity
    minds.set(id, {
      llm: makeSceneLlm(
        new LlmClient({ db: opsDb, caller: 'scene', agentId: id, budgetUsd: SCENE_CAP_USD }),
        {
          identity,
          personality: () => ({
            doc: personality.current().doc,
            autobiography: mem.autobiography(),
          }),
          livingCast: living,
        },
      ),
      ties: new TieStore(db, id),
      remember: async (m) => {
        await mem.insertMemory({
          ...m,
          kind: 'speech_heard',
          tags: { people: [], place: null, objects: [], topics: [] },
        })
      },
      warmth: (otherId) => runtimes.get(id)?.warmthToward(otherId) ?? 0,
    })
    const runtime = new AgentRuntime({
      db,
      llm: new LlmClient({ db: opsDb, caller: 'turn', agentId: id, budgetUsd: TURN_CAP_USD }),
      embedder,
      identity: spec.identity,
      personality,
      bridge,
      config: config2,
      scenes: coordinator,
    })
    runtime.start(id)
    runtimes.set(id, runtime)
  }

  // The opening word. This is the one stage direction in the run: the two lines
  // `AgentRuntime.#noteAccepted` runs when a mind's own turn says something out loud. Said
  // before the first tick, so no ordinary turn is ever taken with the scene not yet open.
  const opener = PAIR[0]!
  void bridge.submit(opener, { verb: 'speak', params: { text: OPENER } })
  coordinator.noteSpoken(opener, OPENER, bridge.currentTick())
  const scene = coordinator.sceneFor(opener)
  if (scene === null) throw new Error('nobody heard the opening word')
  console.log(`[${arm}] scene ${scene.id}: ${scene.participants.join(' + ')}`)

  let lastSeen = 0
  const names = new Map(FOUNDER_MINDS.map((m) => [m.id, m.identity.name]))
  const seenLines: Row[] = []
  const drain = (): void => {
    for (const l of scene.thread.slice(lastSeen)) {
      const row: Row = {
        agentId: l.agentId,
        name: names.get(l.agentId) ?? l.agentId,
        text: l.text,
        aside: l.aside,
        move: l.move,
      }
      seenLines.push(row)
      console.log(`  ${row.name}: ${row.text}`)
      if (row.aside.length > 0) console.log(`     (${row.aside})`)
    }
    lastSeen = scene.thread.length
  }
  for (let i = 0; i < MAX_STEPS && scene.closedTick === null; i++) {
    loop.step()
    await flush()
    await flush()
    drain()
    await sleep(TICK_MS)
  }
  // The line that caps the scene is appended and closed inside one step, so the last one is
  // only ever there to read after the loop has already stopped.
  drain()
  // Stopped first: a mind whose scene has ended wakes for an ordinary turn within a tick, and
  // that turn would land in the ledger this run is counting.
  for (const r of runtimes.values()) r.stop()
  // `closedTick` is stamped before the close call is made, so the scene reads shut while the
  // account of it is still being written. An announcement rides the next tick, so keep turning.
  for (let i = 0; i < 120 && store.readTypeFrom(0, 'scene_closed').length === 0; i++) {
    loop.step()
    await flush()
    await sleep(500)
  }

  const closed = store
    .readTypeFrom(0, 'scene_closed')
    .map((e) => e.payload as { summary: string; deltas: unknown[]; closeReason: string })
  const calls = opsDb
    .prepare(
      `SELECT caller, agent_id AS agentId, input_tokens AS input, cache_read_tokens AS cached,
              output_tokens AS output, latency_ms AS ms, ok, provider, block_tokens AS blocks
       FROM llm_calls ORDER BY id`,
    )
    .all() as {
    caller: string
    agentId: string
    input: number
    cached: number
    output: number
    ms: number
    ok: number
    provider: string | null
    blocks: string | null
  }[]
  const costUsd = (
    opsDb.prepare('SELECT COALESCE(SUM(cost_usd), 0) AS c FROM llm_calls').get() as { c: number }
  ).c
  return {
    lines: seenLines,
    summary: closed[0]?.summary ?? '',
    deltas: closed[0]?.deltas ?? [],
    closeReason: scene.closeReason,
    calls,
    costUsd,
  }
}

/** The longest run of consecutive lines that alternate speakers. A pass, a leave or the end of
 *  the scene breaks it, so this is how far the talk carried before somebody had nothing to say. */
function longestAlternatingRun(lines: readonly Row[]): number {
  let best = lines.length === 0 ? 0 : 1
  let run = best
  for (let i = 1; i < lines.length; i++) {
    run = lines[i]!.agentId === lines[i - 1]!.agentId ? 1 : run + 1
    if (run > best) best = run
  }
  return best
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length === 0
    ? 0
    : (s[Math.floor((s.length - 1) / 2)]! + s[Math.ceil((s.length - 1) / 2)]!) / 2
}

async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error('needs OPENROUTER_API_KEY — run with node --env-file=<repo>/.env')
    process.exit(1)
  }
  const roll = FOUNDER_MINDS.map((m) => ({ name: m.identity.name, alive: true }))
  const out: Record<string, unknown> = {}
  for (const arm of ARMS) {
    console.log(`\n=== arm: ${arm} ===`)
    const r = await runArm(arm)
    const chars = r.lines.map((l) => l.text.length)
    const words = r.lines.map((l) => l.text.split(/\s+/u).filter((w) => w.length > 0).length)
    const strangers = r.lines.flatMap((l) =>
      namesOutsideRoll(l.text.replace(/\bI['\u2019]\p{L}+/gu, 'I'), roll),
    )
    const sceneCalls = r.calls.filter((c) => c.caller === 'scene')
    const turnCalls = r.calls.filter((c) => c.caller === 'turn')
    // The opener is not a scene call; every other line is one line and one call.
    const spokenLines = r.lines.length - 1
    console.log(`\n  --- ${arm} ---`)
    console.log(`  lines ${r.lines.length} (${spokenLines} taken by the floor)`)
    console.log(`  scene calls ${sceneCalls.length}, turn calls ${turnCalls.length}`)
    console.log(`  calls per line ${(sceneCalls.length / Math.max(1, spokenLines)).toFixed(2)}`)
    console.log(
      `  chars median ${median(chars)} mean ${(chars.reduce((a, b) => a + b, 0) / Math.max(1, chars.length)).toFixed(0)} max ${Math.max(0, ...chars)}`,
    )
    console.log(`  words median ${median(words)} max ${Math.max(0, ...words)}`)
    console.log(`  longest alternating run ${longestAlternatingRun(r.lines)}`)
    console.log(`  strangers named ${strangers.length === 0 ? '(none)' : strangers.join(', ')}`)
    console.log(
      `  prompt tokens median ${median(sceneCalls.map((c) => c.input))} cached median ${median(sceneCalls.map((c) => c.cached))}`,
    )
    console.log(
      `  output tokens max ${Math.max(0, ...sceneCalls.map((c) => c.output))} latency p50 ${median(sceneCalls.map((c) => c.ms))}ms max ${Math.max(0, ...sceneCalls.map((c) => c.ms))}ms`,
    )
    console.log(`  closed as ${r.closeReason}; spent $${r.costUsd.toFixed(6)}`)
    console.log(`  summary: ${r.summary}`)
    console.log(`  ties: ${JSON.stringify(r.deltas)}`)
    out[arm] = {
      ...r,
      stats: {
        lines: r.lines.length,
        sceneCalls: sceneCalls.length,
        turnCalls: turnCalls.length,
        charsMedian: median(chars),
        charsMean: chars.reduce((a, b) => a + b, 0) / Math.max(1, chars.length),
        charsMax: Math.max(0, ...chars),
        wordsMedian: median(words),
        wordsMax: Math.max(0, ...words),
        run: longestAlternatingRun(r.lines),
        strangers,
        inputMedian: median(sceneCalls.map((c) => c.input)),
        cachedMedian: median(sceneCalls.map((c) => c.cached)),
        outputMax: Math.max(0, ...sceneCalls.map((c) => c.output)),
        latencyP50: median(sceneCalls.map((c) => c.ms)),
        latencyMax: Math.max(0, ...sceneCalls.map((c) => c.ms)),
      },
    }
    writeFileSync(OUT, JSON.stringify(out, null, 2))
  }
  console.log(`\nwrote ${OUT}`)
}

void main()

import { describe, expect, it } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { EventStore, openDb } from '@sj/engine/store'
import { fold, genesisState, RngStreams, TickLoop } from '@sj/engine'
import { NO_PARAMS, SimConfigSchema, type SimConfig, type TileId } from '@sj/shared'
import { SCENE_CORPUS_LINES } from '@sj/shared/testutil'
import { LlmClient, migrateLlmTables } from '@sj/llm'
import { FakeEmbedder } from '@sj/llm/testutil'
import { EngineBridge } from './bridge.js'
import { AgentRuntime } from './agentRuntime.js'
import { openAgentDb } from '../memory/schema.js'
import { TieStore } from '../memory/ties.js'
import { PersonalityStore, type PersonalityDoc } from '../personality.js'
import { SceneCoordinator, type SceneMind } from '../scene/coordinator.js'
import type { SceneClose, SceneLlm, SceneTurn } from '../scene/scene.js'
import { tamarIdentity } from '../testutil/fixtures.js'
import type { MindConfig } from '../wake.js'

const NADIA = 'nadia'
const OMAR = 'omar'
const NOON = 12 * 60

const ZERO_USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: undefined },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
}
const FAST: Partial<MindConfig> = {
  idleGapTicks: 0,
  boredomTicks: 1,
  bodyAlarm: { hunger: 0, energy: 0, warmth: 0, thirst: 0, affliction: Infinity },
}

const CLOSED = { plan: null, journal: null, recall: null, reconsider_at: null }

/** The turn model every mind here is on: it says one thing, then holds still. */
function turnModel(speech: string | null, counter: { n: number }): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: async () => {
      counter.n += 1
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              thought: 'I stand here.',
              ...CLOSED,
              speech: counter.n === 1 ? speech : null,
              action: { verb: 'wait', params: NO_PARAMS },
              importance: 3,
            }),
          },
        ],
        finishReason: { unified: 'stop' as const, raw: undefined },
        usage: ZERO_USAGE,
        warnings: [],
      }
    },
  })
}

function sceneTurn(i: number): SceneTurn {
  const line = SCENE_CORPUS_LINES[i % SCENE_CORPUS_LINES.length]!
  return {
    thought: line.thought,
    speech: line.speech,
    to: null,
    gesture: null,
    move: line.move,
    stance: null,
    answer: null,
    ask: null,
    leave: false,
    importance: line.importance,
  }
}

function simConfig(): SimConfig {
  return SimConfigSchema.parse({
    needs: { hungerDecayPerTick: 0 },
    structures: { sleepIndoorsOnly: false },
    warmth: { enabled: false },
  })
}

function baseDoc(): PersonalityDoc {
  return {
    temperament: 'calm',
    values: ['loyalty'],
    beliefs: [],
    current: { mood: 'settled', worries: [], goals: [] },
  }
}

const PAIR: readonly { id: string; name: string; x: number }[] = [
  { id: NADIA, name: 'Nadia', x: 3 },
  { id: OMAR, name: 'Omar', x: 4 },
]

async function twoMinds(opts: {
  speech: string
  mindConfig?: Partial<MindConfig>
  who?: readonly { id: string; name: string; x: number }[]
}) {
  const who = opts.who ?? PAIR
  const config = simConfig()
  const terrain: TileId[][] = Array.from({ length: 24 }, () =>
    Array.from({ length: 24 }, (): TileId => 0),
  )
  const worldDb = openDb(':memory:')
  const store = new EventStore(worldDb)
  let state = genesisState(config, terrain)
  const seed = (type: string, payload: unknown): void => {
    state = fold(state, store.append(state.tick, type, payload), config)
  }
  for (const w of who) seed('agent_spawned', { ...w, y: 3, ageDays: 30 })
  const loop = new TickLoop({
    store,
    state,
    rng: new RngStreams('scene-seam'),
    config,
    startTick: NOON,
    onTick: (ctx) => {
      handler(ctx)
    },
  })
  const bridge = new EngineBridge({ loop, store, simConfig: config })
  let queued: { type: string; payload: unknown }[] = []
  const handler = bridge.wrapTickHandler(({ emit }) => {
    for (const q of queued) emit(q.type, q.payload)
    queued = []
  })
  const emitNext = (type: string, payload: unknown): void => {
    queued.push({ type, payload })
  }

  const embedder = await FakeEmbedder.create()
  const turnCalls = new Map<string, { n: number }>()
  const sceneCalls = new Map<string, number>()
  const minds = new Map<string, SceneMind>()
  const runtimes = new Map<string, AgentRuntime>()
  const coordinator = new SceneCoordinator({ bridge, mindFor: (id) => minds.get(id) ?? null })

  for (const { id, name } of who) {
    const db = openAgentDb(':memory:')
    migrateLlmTables(db)
    const personality = new PersonalityStore(db, id)
    personality.init(baseDoc(), 0)
    const counter = { n: 0 }
    turnCalls.set(id, counter)
    const sceneLlm: SceneLlm = {
      line: async () => {
        const n = (sceneCalls.get(id) ?? 0) + 1
        sceneCalls.set(id, n)
        return sceneTurn(n)
      },
      close: async (): Promise<SceneClose> => ({ summary: 'They spoke.', deltas: [] }),
    }
    minds.set(id, {
      llm: sceneLlm,
      ties: new TieStore(db, id),
      remember: async () => {},
      warmth: () => 0,
    })
    const runtime = new AgentRuntime({
      db,
      llm: new LlmClient({
        model: turnModel(id === NADIA ? opts.speech : null, counter),
        db,
        caller: 'turn',
        agentId: id,
        maxRetries: 0,
      }),
      embedder,
      identity: { ...tamarIdentity, name },
      personality,
      bridge,
      config: { ...FAST, ...opts.mindConfig },
      scenes: coordinator,
    })
    runtime.start(id)
    runtimes.set(id, runtime)
  }
  return { loop, bridge, coordinator, turnCalls, sceneCalls, runtimes, minds, emitNext }
}

const flush = (): Promise<void> => new Promise((r) => setImmediate(r))

async function stepUntil(loop: TickLoop, done: () => boolean, max = 60): Promise<void> {
  for (let i = 0; i < max && !done(); i++) {
    loop.step()
    await flush()
    await flush()
  }
}

describe('the runtime hands its mind to a scene', () => {
  it('opens a scene on a word somebody heard, and then only the floor-holder is asked', async () => {
    const h = await twoMinds({ speech: 'Omar. Six planks, you said.' })
    await stepUntil(h.loop, () => h.coordinator.open().length > 0)
    const scene = h.coordinator.open()[0]
    expect(scene, 'a word Omar heard opened a scene').toBeDefined()
    expect(scene?.participants).toEqual([NADIA, OMAR])
    expect(scene?.floor, 'the line named Omar').toBe(OMAR)

    const turnsBefore = new Map([...h.turnCalls].map(([id, c]) => [id, c.n]))
    await stepUntil(h.loop, () => (h.sceneCalls.get(OMAR) ?? 0) > 0)
    expect(h.sceneCalls.get(OMAR) ?? 0, 'the floor-holder answered').toBeGreaterThan(0)
    for (const [id, c] of h.turnCalls) {
      expect(c.n, `${id} took no ordinary turn inside the scene`).toBe(turnsBefore.get(id))
    }
    expect(h.sceneCalls.get(NADIA) ?? 0, 'Nadia listened for free until the floor came back').toBe(
      0,
    )
  })

  // Nothing closes a talk for being late any more, so this is the last thing that can reach a
  // mouth still going while the body behind it gives out.
  it('a body alarm reaches the mind holding the floor once its line is said, and the talk goes on', async () => {
    const h = await twoMinds({
      speech: 'Omar. Six planks, you said.',
      mindConfig: { bodyAlarm: { hunger: 0, energy: 10, warmth: 0, thirst: 0, affliction: 1 } },
    })
    await stepUntil(h.loop, () => (h.sceneCalls.get(OMAR) ?? 0) > 0)
    const holder = h.coordinator.open()[0]?.floor
    expect(holder, 'somebody is holding the floor').toBeTruthy()
    const before = h.turnCalls.get(holder!)!.n
    h.emitNext('needs_changed', { id: holder!, changes: [{ need: 'energy', delta: -96 }] })
    await stepUntil(h.loop, () => h.turnCalls.get(holder!)!.n > before, 40)
    expect(h.turnCalls.get(holder!)!.n, 'the alarm bought a turn').toBeGreaterThan(before)
    expect(h.coordinator.open(), 'and the talk went on around it').toHaveLength(1)
    expect(h.coordinator.open()[0]!.participants).toContain(holder)
  })

  // An audience member is not a participant, so `sceneFor` gives it nothing and the wake ladder
  // runs. Every scene line reaches it as heard speech; if hearing bought a turn, ten bystanders
  // around a twelve-line scene would spend 47x what the conversation itself cost.
  it('lets a bystander overhear a whole scene for nothing', async () => {
    const SALMA = 'salma'
    const FAR = 'tarek'
    const h = await twoMinds({
      speech: 'Omar. Six planks, you said.',
      // The real pacing: an idle gap that a cheap `heard` branch would walk straight past.
      mindConfig: { idleGapTicks: 30, boredomTicks: 60, napTicks: 500 },
      who: [...PAIR, { id: SALMA, name: 'Salma', x: 5 }, { id: FAR, name: 'Tarek', x: 22 }],
    })
    await stepUntil(h.loop, () => (h.sceneCalls.get(OMAR) ?? 0) > 0)
    expect(h.coordinator.sceneFor(SALMA), 'in earshot, and still her own mind').toBeNull()
    for (let i = 0; i < 20; i++) {
      h.loop.step()
      await flush()
      await flush()
    }
    const overheard = h.turnCalls.get(SALMA)?.n ?? 0
    expect(h.sceneCalls.get(OMAR) ?? 0, 'the talk did run').toBeGreaterThan(0)
    expect(overheard, 'hearing bought her nothing the silence did not').toBe(
      h.turnCalls.get(FAR)?.n ?? 0,
    )
  })

  it('carries the open scene through a snapshot and puts it back once', async () => {
    const h = await twoMinds({ speech: 'Omar. Six planks, you said.' })
    await stepUntil(h.loop, () => (h.sceneCalls.get(OMAR) ?? 0) > 0)
    const saved = [...h.runtimes.values()].map((r) => r.snapshot())
    const live = h.coordinator.open()[0]!
    expect(saved.every((s) => s.scene?.id === live.id)).toBe(true)
    expect(saved[0]?.scene?.thread).toEqual(live.thread)

    const fresh = new SceneCoordinator({
      bridge: h.bridge,
      mindFor: (id) => h.minds.get(id) ?? null,
    })
    for (const s of saved) fresh.adopt(s.scene)
    expect(fresh.open(), 'two minds, one scene').toHaveLength(1)
    expect(fresh.open()[0]?.floor).toBe(live.floor)
  })
})

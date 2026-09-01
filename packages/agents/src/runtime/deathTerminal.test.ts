import { describe, expect, it } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { EventStore, openDb } from '@sj/engine/store'
import {
  RngStreams,
  TickLoop,
  createWorldTick,
  fold,
  genesisState,
  type TickHandler,
  type TileId,
} from '@sj/engine'
import { SimConfigSchema } from '@sj/shared'
import { LlmClient, migrateLlmTables } from '@sj/llm'
import { FakeEmbedder } from '@sj/llm/testutil'
import { EngineBridge } from './bridge.js'
import { AgentRuntime } from './agentRuntime.js'
import { openAgentDb } from '../memory/schema.js'
import { PersonalityStore } from '../personality.js'
import { tamarIdentity } from '../testutil/fixtures.js'
import type { MindConfig } from '../wake.js'

// World one billed 768 turns — 40.5% of the run, $1.18 — to five corpses trying to drag
// themselves off their own graves. `intent.ts` refused every one of those acts; the mind read
// the refusal back as "did not take", woke on `plan_blocked`, and asked again.
const AGENT = 'tamar'

const ZERO_USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: undefined },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
}

// Every cadence rung switched off, so a mind that may think, thinks every tick.
const EAGER_MIND: Partial<MindConfig> = {
  idleGapTicks: 0,
  boredomTicks: 1,
  bodyAlarm: { hunger: 0, energy: 0, warmth: 0, thirst: 0, affliction: Infinity },
}

const flush = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve))

async function setup() {
  const config = SimConfigSchema.parse({
    needs: { hungerDecayPerTick: 0 },
    structures: { sleepIndoorsOnly: false },
    warmth: { enabled: false },
  })
  const terrain: TileId[][] = Array.from({ length: 24 }, () =>
    Array.from({ length: 24 }, (): TileId => 0),
  )
  const store = new EventStore(openDb(':memory:'))
  const rng = new RngStreams('death-terminal')
  let state = genesisState(config, terrain)
  state = fold(
    state,
    store.append(state.tick, 'agent_spawned', {
      id: AGENT,
      name: 'Tamar',
      x: 3,
      y: 3,
      ageDays: 30,
    }),
    config,
  )

  const worldTick = createWorldTick(config, rng)
  // A one-shot the test arms: the kill rides the real tick, so `collapseDeathSystem` declares
  // the death, drops what the body held and sets the grave, exactly as a world does.
  let killAt: number | null = null
  let handler: TickHandler = () => {}
  const loop = new TickLoop({
    store,
    state,
    rng,
    config,
    onTick: (ctx) => {
      handler(ctx)
    },
  })
  const bridge = new EngineBridge({ loop, store, simConfig: config })
  handler = bridge.wrapTickHandler((ctx) => {
    for (const e of worldTick(loop.state).events) ctx.emit(e.type, e.payload)
    if (killAt !== null && ctx.tick >= killAt) {
      killAt = null
      ctx.emit('hp_changed', { agentId: AGENT, delta: -config.health.maxHp })
    }
  })

  let calls = 0
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      calls += 1
      return {
        content: [
          {
            type: 'text' as const,
            // The world-one shape: a body on the floor reaching for something out of reach.
            text: JSON.stringify({
              thought: 'Just the arm.',
              importance: 1,
              action: { verb: 'walk', params: { x: 9, y: 9 } },
            }),
          },
        ],
        finishReason: { unified: 'stop' as const, raw: undefined },
        usage: ZERO_USAGE,
        warnings: [],
      }
    },
  })

  const db = openAgentDb(':memory:')
  migrateLlmTables(db)
  const personality = new PersonalityStore(db, AGENT)
  personality.init(
    {
      temperament: 'calm',
      values: ['loyalty'],
      beliefs: [],
      current: { mood: 'settled', worries: [], goals: [] },
    },
    0,
  )
  const runtime = new AgentRuntime({
    db,
    llm: new LlmClient({ model, db, caller: 'turn', agentId: AGENT, maxRetries: 0 }),
    embedder: await FakeEmbedder.create(),
    identity: tamarIdentity,
    personality,
    bridge,
    config: EAGER_MIND,
  })
  runtime.start(AGENT)
  const step = async (n: number): Promise<void> => {
    for (let i = 0; i < n; i++) {
      loop.step()
      await flush()
    }
  }
  return { loop, runtime, db, step, kill: () => (killAt = loop.state.tick + 1), calls: () => calls }
}

describe('★ death is terminal', () => {
  it('a died agent takes no further turn and calls no further model', async () => {
    const { loop, runtime, step, kill, calls } = await setup()
    await step(20)
    expect(runtime.stats().turns, 'a living mind must be thinking, or this proves nothing').toBeGreaterThan(0)

    kill()
    await step(2)
    expect(loop.state.agents[AGENT]?.alive).toBe(false)

    const turnsAtDeath = runtime.stats().turns
    const callsAtDeath = calls()
    await step(200)

    expect(runtime.stats().turns).toBe(turnsAtDeath)
    expect(calls()).toBe(callsAtDeath)
  })

  it('unwinds where it fell: no plan, and the record it wrote stays on disk, closed to writes', async () => {
    const { db, runtime, step, kill } = await setup()
    const memories = (): number =>
      (db.prepare('SELECT count(*) AS n FROM memories').get() as { n: number }).n
    await step(20)
    kill()
    await step(20)
    const written = memories()

    await step(100)
    expect(runtime.snapshot().plan.queue).toEqual([])
    // A life stops being written the moment it ends — and the db is kept, not deleted: the
    // gateway and the narrator read a dead mind's memories for as long as the town stands.
    expect(memories()).toBe(written)
    expect(db.open).toBe(true)
    expect(written).toBeGreaterThan(0)
  })
})

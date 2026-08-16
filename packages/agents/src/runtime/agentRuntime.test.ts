import { describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { MockLanguageModelV4 } from 'ai/test'
import type { LanguageModel } from 'ai'
import {
  createWorldTick,
  EventStore,
  fold,
  genesisState,
  openDb,
  replayFromGenesis,
  RngStreams,
  TickLoop,
  type TickHandler,
  type TileId,
} from '@sj/engine'
import { SimConfigSchema, stateHash, type SimConfig } from '@sj/shared'
import { EngineBridge } from './bridge.js'
import { AgentRuntime } from './agentRuntime.js'
import { openAgentDb } from '../memory/schema.js'
import { MemoryStore, type MemoryRow } from '../memory/store.js'
import { PersonalityStore, type PersonalityDoc } from '../personality.js'
import { migrateLlmTables } from '../llm/callLog.js'
import { LlmClient } from '../llm/client.js'
import { FakeEmbedder } from '../testutil/fakeEmbedder.js'
import { tamarIdentity } from '../testutil/fixtures.js'
import type { ReflectionLlm } from '../reflection.js'
import type { DreamLlm } from '../dream.js'

import type { MindConfig } from '../wake.js'

const AGENT = 'tamar'
const BREAD_ID = 'item_1'
const STRUCTURE_ID = 'structure_1'
const DAWN_TICK = 360 // 06:00 of day 0

const BENIGN_TURN = { thought: 'I rest.', importance: 1 }

const ZERO_USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: undefined },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
}

const FAST_MIND: Partial<MindConfig> = { idleGapTicks: 0, boredomTicks: 1, bodyAlarm: { hunger: 0, energy: 0, warmth: 0 } }

function fastSimConfig(): SimConfig {
  return SimConfigSchema.parse({ needs: { hungerDecayPerTick: 0.5 } })
}

function baseDoc(): PersonalityDoc {
  return { temperament: 'calm', values: ['loyalty'], beliefs: [], current: { mood: 'settled', worries: [], goals: [] } }
}

function buildWorld(simConfig?: SimConfig) {
  const config = simConfig ?? fastSimConfig()
  const terrain: TileId[][] = Array.from({ length: 24 }, () => Array.from({ length: 24 }, (): TileId => 0))
  const engineDb = openDb(':memory:')
  const store = new EventStore(engineDb)
  const rng = new RngStreams('c3-t12-test')
  let state = genesisState(config, terrain)
  const emit = (type: string, payload: unknown) => {
    const ev = store.append(state.tick, type, payload)
    state = fold(state, ev, config)
  }
  emit('agent_spawned', { id: AGENT, name: 'Tamar', x: 3, y: 3, ageDays: 30 })
  emit('need_changed', { id: AGENT, need: 'hunger', delta: -70 })
  emit('structure_planned', { id: STRUCTURE_ID, kind: 'storehouse', x: 5, y: 5, w: 1, h: 1, maxHp: 50, flammable: true, builderId: AGENT })
  emit('structure_completed', { id: STRUCTURE_ID })
  emit('item_spawned', { id: BREAD_ID, kind: 'bread', qty: 6, loc: { t: 'structure', id: STRUCTURE_ID } })
  return { config, terrain, engineDb, store, rng, state }
}

function turnModel(responses: unknown[], fallback: unknown = BENIGN_TURN): MockLanguageModelV4 {
  let i = 0
  return new MockLanguageModelV4({
    doGenerate: async () => {
      const r = i < responses.length ? responses[i]! : fallback
      i += 1
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(r) }],
        finishReason: { unified: 'stop' as const, raw: undefined },
        usage: ZERO_USAGE,
        warnings: [],
      }
    },
  })
}

type CapturedMessage = { role: string; text: string }

function capturingModel(responses: unknown[]): { model: MockLanguageModelV4; prompts: CapturedMessage[][] } {
  const prompts: CapturedMessage[][] = []
  let i = 0
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      const msgs = (options.prompt as Array<{ role: string; content: unknown }>).map((m) => ({
        role: m.role,
        text: Array.isArray(m.content)
          ? (m.content as Array<{ text?: string }>).map((p) => p.text ?? '').join('')
          : String(m.content),
      }))
      prompts.push(msgs)
      const r = responses[Math.min(i, responses.length - 1)]!
      i += 1
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(r) }],
        finishReason: { unified: 'stop' as const, raw: undefined },
        usage: ZERO_USAGE,
        warnings: [],
      }
    },
  })
  return { model, prompts }
}

function throwingModel(): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: async () => {
      throw new Error('provider down')
    },
  })
}

function gatedModel(): { model: MockLanguageModelV4; calls: { count: number }; resolve: (text: string) => void } {
  const calls = { count: 0 }
  let resolveFn!: (text: string) => void
  const promise = new Promise<string>((resolve) => {
    resolveFn = resolve
  })
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      calls.count += 1
      const text = await promise
      return {
        content: [{ type: 'text' as const, text }],
        finishReason: { unified: 'stop' as const, raw: undefined },
        usage: ZERO_USAGE,
        warnings: [],
      }
    },
  })
  return { model, calls, resolve: resolveFn }
}

class ScriptedReflectionLlm implements ReflectionLlm {
  calls: string[] = []
  async extractFacts(dayMemories: MemoryRow[]) {
    this.calls.push('extractFacts')
    return dayMemories.length > 0
      ? [{ subject: 'meadow', predicate: 'is', object: 'home', srcMemoryId: dayMemories[0]!.id }]
      : []
  }
  async summarizeScenes(dayMemories: MemoryRow[]) {
    this.calls.push('summarizeScenes')
    return [{ title: 'The meadow', text: 'A quiet meadow.', memoryIds: dayMemories.map((m) => m.id) }]
  }
  async summarizeDay() {
    this.calls.push('summarizeDay')
    return { title: 'First day', text: 'A first day at the meadow.' }
  }
  async updateLedger() {
    this.calls.push('updateLedger')
    return 'A person.'
  }
  async autobiographyParagraph(): Promise<string> {
    this.calls.push('autobiographyParagraph')
    return 'I lived a day.'
  }
  async proposeEdit(): Promise<null> {
    this.calls.push('proposeEdit')
    return null
  }
}

class ScriptedDreamLlm implements DreamLlm {
  calls = 0
  mood = 'peaceful'
  async composeDream() {
    this.calls += 1
    return { text: 'A dream of bread.', mood: this.mood }
  }
}

async function setup(opts: {
  model: LanguageModel
  mindConfig?: Partial<MindConfig>
  reflectionLlm?: ReflectionLlm
  dreamLlm?: DreamLlm
  embedder?: { embed(t: string): Promise<Float32Array> }
  maxRetries?: number
  simConfig?: SimConfig
}) {
  const world = buildWorld(opts.simConfig)
  const worldTick = createWorldTick(world.config, world.rng)
  let handler: TickHandler = () => {}
  const loop = new TickLoop({
    store: world.store,
    state: world.state,
    rng: world.rng,
    config: world.config,
    onTick: (ctx) => handler(ctx),
  })
  const bridge = new EngineBridge({ loop, store: world.store, simConfig: world.config })
  handler = bridge.wrapTickHandler(({ emit }) => {
    for (const e of worldTick(loop.state).events) emit(e.type, e.payload)
  })

  const agentDb = openAgentDb(':memory:')
  migrateLlmTables(agentDb)
  const embedder = opts.embedder ?? (await FakeEmbedder.create())
  const personality = new PersonalityStore(agentDb, AGENT)
  personality.init(baseDoc(), 0)
  const llm = new LlmClient({ model: opts.model, db: agentDb, caller: 'turn', agentId: AGENT, maxRetries: opts.maxRetries ?? 2 })
  const runtime = new AgentRuntime({
    db: agentDb,
    llm,
    embedder,
    identity: tamarIdentity,
    personality,
    bridge,
    config: opts.mindConfig,
    reflectionLlm: opts.reflectionLlm,
    dreamLlm: opts.dreamLlm,
  })
  runtime.start(AGENT)
  const mem = new MemoryStore(agentDb, AGENT, embedder)
  return { world, loop, bridge, runtime, llm, mem, personality, agentDb }
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

async function stepUntil(loop: TickLoop, predicate: () => boolean, max = 500): Promise<number> {
  let i = 0
  while (!predicate() && i < max) {
    loop.step()
    await flush()
    i += 1
  }
  return i
}

function startedVerbs(db: Database.Database): string[] {
  return (db.prepare("SELECT payload FROM events WHERE type = 'action_started' ORDER BY seq").all() as Array<{ payload: string }>)
    .map((r) => (JSON.parse(r.payload) as { verb: string }).verb)
}

function completedVerbs(db: Database.Database): string[] {
  return (db.prepare("SELECT payload FROM events WHERE type = 'action_completed' ORDER BY seq").all() as Array<{ payload: string }>)
    .map((r) => (JSON.parse(r.payload) as { verb: string }).verb)
}

function spokeTexts(db: Database.Database): string[] {
  return (db.prepare("SELECT payload FROM events WHERE type = 'agent_spoke' ORDER BY seq").all() as Array<{ payload: string }>)
    .map((r) => (JSON.parse(r.payload) as { text: string }).text)
}

function memoriesOfKind(db: Database.Database, kind: string): Array<{ tick: number; text: string; importance: number }> {
  return db
    .prepare("SELECT tick, text, importance FROM memories WHERE agent_id = ? AND kind = ? ORDER BY id")
    .all(AGENT, kind) as Array<{ tick: number; text: string; importance: number }>
}

function journalRows(db: Database.Database): Array<{ tick: number; text: string }> {
  return db.prepare("SELECT tick, text FROM journal WHERE agent_id = ? ORDER BY id").all(AGENT) as Array<{ tick: number; text: string }>
}

function alertKinds(db: Database.Database): string[] {
  return (db.prepare('SELECT kind FROM alerts ORDER BY id').all() as Array<{ kind: string }>).map((r) => r.kind)
}

describe('EngineBridge + AgentRuntime against the real engine', () => {
  it('executes a plan queue end-to-end through the frozen submitIntent', async () => {
    const { world, loop } = await setup({
      model: turnModel([
        {
          thought: 'I should fetch and eat some bread.',
          plan: [
            { verb: 'walk', params: { x: 5, y: 6 } },
            { verb: 'take', params: { itemId: BREAD_ID } },
            { verb: 'eat', params: { itemId: BREAD_ID } },
          ],
          importance: 5,
        },
      ]),
      mindConfig: FAST_MIND,
    })
    await stepUntil(loop, () => completedVerbs(world.engineDb).length >= 3, 100)
    expect(completedVerbs(world.engineDb)).toEqual(['walk', 'take', 'eat'])
    expect(loop.state.agents[AGENT]!.needs.hunger).toBeGreaterThan(30)
  })

  it('submits speech and records a thought memory with its importance', async () => {
    const { world, loop, agentDb } = await setup({
      model: turnModel([{ thought: 'Good, the storehouse still has bread.', speech: 'The storehouse is stocked.', importance: 4 }]),
      mindConfig: FAST_MIND,
    })
    await stepUntil(loop, () => spokeTexts(world.engineDb).length >= 1, 100)
    expect(spokeTexts(world.engineDb)).toContain('The storehouse is stocked.')
    expect(memoriesOfKind(agentDb, 'thought').some((t) => t.importance === 4)).toBe(true)
  })

  it('journals, stores a journal memory, and delays the next wake by journalTicks', async () => {
    const { loop, agentDb } = await setup({
      model: turnModel([{ thought: 'I will write it down.', journal: 'First day at the meadow.', importance: 6 }]),
      mindConfig: { ...FAST_MIND, boredomTicks: 5, journalTicks: 10 },
    })
    await stepUntil(loop, () => journalRows(agentDb).length >= 1, 100)
    const journal = journalRows(agentDb)
    expect(journal).toHaveLength(1)
    expect(journal[0]!.text).toBe('First day at the meadow.')
    expect(memoriesOfKind(agentDb, 'journal').map((m) => m.text)).toContain('First day at the meadow.')

    const t1 = journal[0]!.tick
    await stepUntil(loop, () => memoriesOfKind(agentDb, 'thought').length >= 2, 200)
    const thoughts = memoriesOfKind(agentDb, 'thought')
    const t2 = thoughts[thoughts.length - 1]!.tick
    expect(t2 - t1).toBeGreaterThanOrEqual(10)
  })

  it('never blocks the tick loop while a turn is in flight', async () => {
    const gate = gatedModel()
    const { loop, runtime } = await setup({ model: gate.model, mindConfig: FAST_MIND })
    loop.step()
    await flush()
    const startTick = loop.tick
    for (let i = 0; i < 20; i++) loop.step()
    expect(loop.tick).toBe(startTick + 20)
    expect(gate.calls.count).toBe(1)
    expect(runtime.stats().turns).toBe(0)
    gate.resolve(JSON.stringify({ thought: 'I think.', importance: 3 }))
    await flush()
    expect(runtime.stats().turns).toBe(1)
  })

  it('dozes off on provider failure without crashing the town', async () => {
    const { loop, runtime, agentDb } = await setup({
      model: throwingModel(),
      mindConfig: { ...FAST_MIND, dozeTicks: 20 },
    })
    expect(() => loop.step()).not.toThrow()
    await flush()
    expect(runtime.stats().dozes).toBe(1)
    expect(alertKinds(agentDb)).toContain('doze_off')
    for (let i = 0; i < 19; i++) {
      expect(() => loop.step()).not.toThrow()
      await flush()
    }
    expect(runtime.stats().dozes).toBe(1)
  })

  it('respects the doze backoff even when body_alarm keeps firing during an outage', async () => {
    // Default bodyAlarm thresholds; hunger starts at 30 and decays 0.5/tick,
    // so the alarm rings from ~tick 11 onward while the provider stays down.
    const { loop, runtime } = await setup({
      model: throwingModel(),
      mindConfig: { dozeTicks: 20 },
    })
    for (let i = 0; i < 25; i++) {
      loop.step()
      await flush()
    }
    expect(runtime.stats().dozes).toBe(1)
  })

  it('surfaces a rejected intent in-world', async () => {
    const { loop, agentDb } = await setup({
      model: turnModel([{ thought: 'I will try to eat.', action: { verb: 'eat', params: { itemId: 'nope' } }, importance: 3 }]),
      mindConfig: FAST_MIND,
    })
    await stepUntil(loop, () => memoriesOfKind(agentDb, 'action').length >= 1, 100)
    expect(memoriesOfKind(agentDb, 'action').some((m) => /You realize you cannot/.test(m.text))).toBe(true)
  })

  it('runs reflection once per night, dreams, and resets the day at dawn', async () => {
    const reflection = new ScriptedReflectionLlm()
    const dream = new ScriptedDreamLlm()
    const { loop, runtime, mem, personality, agentDb } = await setup({
      model: turnModel([{ thought: 'Time to rest.', action: { verb: 'sleep', params: {} }, importance: 5 }]),
      mindConfig: { ...FAST_MIND, dreamChance: 1 },
      reflectionLlm: reflection,
      dreamLlm: dream,
    })
    await stepUntil(loop, () => mem.summaryNodes('day', 0).length === 1, 100)
    expect(runtime.stats().reflections).toBe(1)
    expect(dream.calls).toBe(1)
    expect(memoriesOfKind(agentDb, 'dream').length).toBe(1)
    expect(runtime.dayLogSnapshot().length).toBeGreaterThanOrEqual(1)

    await stepUntil(loop, () => loop.tick >= DAWN_TICK, 2000)
    expect(runtime.stats().reflections).toBe(1)
    expect(personality.current().doc.current.mood).toBe('peaceful')
    // The dawn reset drops yesterday's log; the morning wake may already have
    // written the new day's first entry.
    expect(runtime.dayLogSnapshot().length).toBeLessThanOrEqual(1)
  })

  it('a direct action preempts a running plan and is held until the body is free', async () => {
    const { world, loop, agentDb } = await setup({
      model: turnModel([
        {
          thought: 'Walk the long way round.',
          plan: [
            { verb: 'walk', params: { x: 12, y: 12 } },
            { verb: 'walk', params: { x: 3, y: 3 } },
          ],
          importance: 4,
          reconsider_at: '00:05',
        },
        { thought: 'No — I am spent. I lie down where I stand.', action: { verb: 'sleep', params: {} }, importance: 6 },
      ]),
      mindConfig: FAST_MIND,
    })
    await stepUntil(loop, () => completedVerbs(world.engineDb).length >= 2, 80)
    // The sleep from the reconsider turn must land after the in-flight walk,
    // and the rest of the plan (the second walk) must be abandoned.
    expect(completedVerbs(world.engineDb)).toEqual(['walk', 'sleep'])
    expect(startedVerbs(world.engineDb)).toEqual(['walk', 'sleep'])
    expect(loop.state.agents[AGENT]!.asleep).toBe(true)
    // One 'already busy' rejection must not have discarded the intent.
    expect(memoriesOfKind(agentDb, 'action')).toHaveLength(0)
  })

  it('does not reflect on a merely attempted sleep that the engine rejected', async () => {
    const reflection = new ScriptedReflectionLlm()
    const { loop, runtime, mem, agentDb } = await setup({
      model: turnModel([
        {
          thought: 'Eat, then rest.',
          plan: [
            { verb: 'eat', params: { itemId: 'nope' } },
            { verb: 'sleep', params: {} },
          ],
          importance: 4,
        },
      ]),
      mindConfig: FAST_MIND,
      reflectionLlm: reflection,
    })
    await stepUntil(loop, () => memoriesOfKind(agentDb, 'action').length >= 1, 100)
    for (let i = 0; i < 10; i++) {
      loop.step()
      await flush()
    }
    // The plan head was rejected, so sleep never reached the engine: no reflection.
    expect(loop.state.agents[AGENT]!.asleep).toBe(false)
    expect(runtime.stats().reflections).toBe(0)
    expect(mem.summaryNodes('day', 0)).toHaveLength(0)
  })

  it('reflects exactly once for a night that spans midnight', async () => {
    const reflection = new ScriptedReflectionLlm()
    const { loop, runtime, mem, bridge } = await setup({
      model: turnModel([]),
      mindConfig: { idleGapTicks: 100000, boredomTicks: 100000 },
      reflectionLlm: reflection,
      simConfig: SimConfigSchema.parse({ needs: { hungerDecayPerTick: 0, energyDecayAwakePerTick: 0 } }),
    })
    while (loop.tick < 1350) {
      loop.step()
      await flush()
    }
    void bridge.submit(AGENT, { verb: 'sleep', params: {} })
    await stepUntil(loop, () => runtime.stats().reflections >= 1, 50)
    expect(runtime.stats().reflections).toBe(1)
    expect(mem.summaryNodes('day', 0)).toHaveLength(1)

    // Sleep on past midnight: still the same night — no second reflection.
    while (loop.tick < 1500) {
      loop.step()
      await flush()
    }
    expect(loop.state.agents[AGENT]!.asleep).toBe(true)
    expect(runtime.stats().reflections).toBe(1)
    expect(mem.summaryNodes('day', 1)).toHaveLength(0)
  })

  it('keeps golden replay deterministic across mind writes', async () => {
    const { world, loop, agentDb } = await setup({
      model: turnModel([
        {
          thought: 'I should fetch and eat some bread.',
          plan: [
            { verb: 'walk', params: { x: 5, y: 6 } },
            { verb: 'take', params: { itemId: BREAD_ID } },
            { verb: 'eat', params: { itemId: BREAD_ID } },
          ],
          importance: 5,
        },
        { thought: 'Good, the storehouse still has bread.', speech: 'The storehouse is stocked.', importance: 4 },
        { thought: 'I will write it down.', journal: 'First day at the meadow.', importance: 6 },
      ]),
      mindConfig: { ...FAST_MIND, journalTicks: 10 },
    })
    await stepUntil(loop, () => loop.tick >= 80 && memoriesOfKind(agentDb, 'journal').length >= 1, 300)
    const liveHash = stateHash(loop.state)
    const replayed = replayFromGenesis(world.store, world.config, world.terrain)
    expect(stateHash(replayed)).toBe(liveHash)
  })

  it('does not execute the next plan item when the head is rejected', async () => {
    const { world, loop, agentDb } = await setup({
      model: turnModel([
        {
          thought: 'Eat, then walk.',
          plan: [
            { verb: 'eat', params: { itemId: 'nope' } },
            { verb: 'walk', params: { x: 5, y: 6 } },
          ],
          importance: 5,
        },
      ]),
      mindConfig: FAST_MIND,
    })
    await stepUntil(loop, () => memoriesOfKind(agentDb, 'action').length >= 1, 100)
    expect(memoriesOfKind(agentDb, 'action').some((m) => /You realize you cannot/.test(m.text))).toBe(true)
    // Let any wrongly-submitted head drain and complete before asserting, so a
    // regression of the rejection race (head submitted despite the block) shows up.
    for (let i = 0; i < 15; i++) {
      loop.step()
      await flush()
    }
    expect(startedVerbs(world.engineDb)).toEqual([])
    expect(completedVerbs(world.engineDb)).toEqual([])
  })

  it('submits a plan head only after a busy agent finishes its action', async () => {
    const { world, loop, agentDb } = await setup({
      model: turnModel([
        {
          thought: 'Walk over, then eat.',
          action: { verb: 'walk', params: { x: 5, y: 6 } },
          plan: [
            { verb: 'take', params: { itemId: BREAD_ID } },
            { verb: 'eat', params: { itemId: BREAD_ID } },
          ],
          importance: 5,
        },
      ]),
      mindConfig: FAST_MIND,
    })
    await stepUntil(loop, () => completedVerbs(world.engineDb).length >= 3, 150)
    expect(completedVerbs(world.engineDb)).toEqual(['walk', 'take', 'eat'])
    expect(memoriesOfKind(agentDb, 'action').length).toBe(0)
  })

  it('retrieves ambient memories before inserting the current perception (finding 9)', async () => {
    const { model, prompts } = capturingModel([BENIGN_TURN])
    const { loop, runtime } = await setup({ model, mindConfig: FAST_MIND })
    await stepUntil(loop, () => runtime.stats().turns >= 1, 30)
    // First turn ever: the store held nothing before this perception, so the
    // scene must not present the current moment back as a remembered one.
    const first = prompts[0]!
    expect(first.some((m) => m.text.includes('What you remember:'))).toBe(false)
  })

  it('repairs an invalid generation with an assistant/user exchange instead of blind-retrying', async () => {
    const bad = { thought: 'I speak wrongly.', importance: 'very' }
    const good = { thought: 'Righted.', speech: 'All is well.', importance: 2 }
    const { model, prompts } = capturingModel([bad, good])
    const { world, loop, runtime } = await setup({ model, mindConfig: FAST_MIND })
    await stepUntil(loop, () => runtime.stats().turns >= 1, 50)

    expect(runtime.stats().dozes).toBe(0)
    expect(spokeTexts(world.engineDb)).toContain('All is well.')

    // The second call is the repair: it appends the bad output as the
    // assistant's own words and the correction as a user message.
    expect(prompts.length).toBe(2)
    const repair = prompts[1]!
    const assistantMsg = repair[repair.length - 2]!
    const userMsg = repair[repair.length - 1]!
    expect(assistantMsg.role).toBe('assistant')
    expect(assistantMsg.text).toContain('I speak wrongly.')
    expect(userMsg.role).toBe('user')
    expect(userMsg.text).toMatch(/rejected/i)
    expect(userMsg.text).toContain('importance')
  })

  it('the body answers its own alarm: a sleeper whose turn submits nothing is woken by a runtime wake', async () => {
    const stillSim = SimConfigSchema.parse({ needs: { hungerDecayPerTick: 0, energyDecayAwakePerTick: 0 } })
    const { world, loop } = await setup({
      model: turnModel([{ thought: 'Time to rest.', action: { verb: 'sleep', params: {} }, importance: 5 }]),
      mindConfig: FAST_MIND,
      simConfig: stillSim,
    })
    await stepUntil(loop, () => loop.state.agents[AGENT]!.asleep, 30)
    expect(loop.state.agents[AGENT]!.asleep).toBe(true)

    // Sleep through to dawn. The morning turn is thought-only (BENIGN fallback);
    // the runtime itself must answer with the wake verb.
    await stepUntil(loop, () => loop.tick >= DAWN_TICK && !loop.state.agents[AGENT]!.asleep, 500)
    expect(loop.state.agents[AGENT]!.asleep).toBe(false)
    expect(startedVerbs(world.engineDb)).toContain('wake')
    const woke = world.engineDb
      .prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'agent_woke'")
      .get() as { n: number }
    expect(woke.n).toBeGreaterThanOrEqual(1)
  })

  it('a sleeper whose every intent the world rejects still rises', async () => {
    const stillSim = SimConfigSchema.parse({ needs: { hungerDecayPerTick: 0, energyDecayAwakePerTick: 0 } })
    const { world, loop, agentDb } = await setup({
      model: turnModel(
        [{ thought: 'Time to rest.', action: { verb: 'sleep', params: {} }, importance: 5 }],
        // Every later turn targets the storehouse's own tile: the engine
        // rejects it ('no path to that spot'), just as in the live run.
        { thought: 'To the storehouse.', action: { verb: 'walk', params: { x: 5, y: 5 } }, importance: 4 },
      ),
      mindConfig: FAST_MIND,
      simConfig: stillSim,
    })
    await stepUntil(loop, () => loop.state.agents[AGENT]!.asleep, 30)
    await stepUntil(loop, () => loop.tick >= DAWN_TICK && !loop.state.agents[AGENT]!.asleep, 500)
    expect(loop.state.agents[AGENT]!.asleep).toBe(false)
    expect(startedVerbs(world.engineDb)).toContain('wake')
    expect(memoriesOfKind(agentDb, 'action').some((m) => /no path to that spot/.test(m.text))).toBe(true)
  })

  it('backs off on non-provider turn failures', async () => {
    const { loop, runtime, agentDb } = await setup({
      model: turnModel([{ thought: 'I think.', importance: 3 }]),
      mindConfig: { ...FAST_MIND, dozeTicks: 20 },
      embedder: { async embed(): Promise<Float32Array> { throw new Error('embedder down') } },
    })
    expect(() => loop.step()).not.toThrow()
    await flush()
    expect(runtime.stats().turns).toBe(0)
    expect(alertKinds(agentDb).filter((k) => k === 'turn_crash')).toHaveLength(1)
    for (let i = 0; i < 19; i++) {
      expect(() => loop.step()).not.toThrow()
      await flush()
    }
    expect(runtime.stats().turns).toBe(0)
    expect(alertKinds(agentDb).filter((k) => k === 'turn_crash')).toHaveLength(1)
  })
})

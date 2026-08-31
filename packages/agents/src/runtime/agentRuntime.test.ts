import { afterEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { MockLanguageModelV4 } from 'ai/test'
import type { LanguageModel } from 'ai'
import { EventStore, openDb } from '@sj/engine/store'
import {
  createWorldTick,
  fold,
  genesisState,
  replayFromGenesis,
  registerVerb,
  RngStreams,
  TickLoop,
  unregisterVerb,
  type TickHandler,
  type TileId,
} from '@sj/engine'
import {
  MINUTES_PER_DAY,
  SimConfigSchema,
  stateHash,
  type DiscoveryCredit,
  type SimConfig,
} from '@sj/shared'
import { EngineBridge } from './bridge.js'
import {
  AgentRuntime,
  CRAFT_HINT,
  OPAQUE_REFUSAL,
  REFUSAL_MEMORY_TICKS,
  REPEATED_REFUSAL,
  refusalMemoryText,
} from './agentRuntime.js'
import { wireArbiter, type Adjudicator, type AgentCtx, type SeamArbiter } from './arbiterSeam.js'
import { openAgentDb } from '../memory/schema.js'
import { MemoryStore, type MemoryRow } from '../memory/store.js'
import { PersonalityStore, type PersonalityDoc } from '../personality.js'
import { migrateLlmTables, LlmClient } from '@sj/llm'
import { FakeEmbedder } from '@sj/llm/testutil'
import { splitSentences } from '../prompt/assemble.js'
import { tamarIdentity } from '../testutil/fixtures.js'
import type { ReflectionLlm } from '../reflection.js'
import type { DreamLlm } from '../dream.js'

import type { MindConfig } from '../wake.js'

const AGENT = 'tamar'
const BREAD_ID = 'item_1'
const STRUCTURE_ID = 'structure_1'
const DAWN_TICK = 360 // 06:00 of day 0
// Night 0 runs from dusk of day 0 to dawn of day 1. Ticks 0..359 are the pre-dawn of day 0 —
// night -1, a night nobody lived — so a fresh town must not reflect there.
const NIGHT_0_TICK = 1350
const DAY_1_DAWN_TICK = 1440 + DAWN_TICK
const SLOW_BODY = SimConfigSchema.parse({
  needs: { hungerDecayPerTick: 0, energyDecayAwakePerTick: 0 },
  structures: { sleepIndoorsOnly: false },
  warmth: { enabled: false },
})

const BENIGN_TURN = { thought: 'I rest.', importance: 1 }

const ZERO_USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: undefined },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
}

const FAST_MIND: Partial<MindConfig> = {
  idleGapTicks: 0,
  boredomTicks: 1,
  // Every rung switched off: these rows drive the cadence themselves.
  bodyAlarm: { hunger: 0, energy: 0, warmth: 0, thirst: 0, affliction: Infinity },
}

// Empty 24x24 grass, no structures: the C9 bed law would refuse every sleep these rows drive.
function fastSimConfig(): SimConfig {
  return SimConfigSchema.parse({
    needs: { hungerDecayPerTick: 0.5 },
    structures: { sleepIndoorsOnly: false },
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

function buildWorld(simConfig?: SimConfig) {
  const config = simConfig ?? fastSimConfig()
  const terrain: TileId[][] = Array.from({ length: 24 }, () =>
    Array.from({ length: 24 }, (): TileId => 0),
  )
  const engineDb = openDb(':memory:')
  const store = new EventStore(engineDb)
  const rng = new RngStreams('c3-t12-test')
  let state = genesisState(config, terrain)
  const emit = (type: string, payload: unknown) => {
    const ev = store.append(state.tick, type, payload)
    state = fold(state, ev, config)
  }
  emit('agent_spawned', { id: AGENT, name: 'Tamar', x: 3, y: 3, ageDays: 30 })
  emit('needs_changed', { id: AGENT, changes: [{ need: 'hunger', delta: -70 }] })
  emit('structure_planned', {
    id: STRUCTURE_ID,
    kind: 'storehouse',
    x: 5,
    y: 5,
    w: 1,
    h: 1,
    maxHp: 50,
    flammable: true,
    builderId: AGENT,
  })
  emit('structure_completed', { id: STRUCTURE_ID })
  emit('item_spawned', {
    id: BREAD_ID,
    kind: 'bread',
    qty: 6,
    loc: { t: 'structure', id: STRUCTURE_ID },
  })
  return { config, terrain, engineDb, store, rng, state }
}

// The required-action schema: a fixture that names no act is answering the old shape, and the
// real contract now is "name wait when nothing new begins" — added here once, not at 20 sites.
const askedShape = (r: unknown): unknown =>
  r !== null && typeof r === 'object' && 'thought' in r && !('action' in r)
    ? { ...r, action: { verb: 'wait', params: {} } }
    : r

function turnModel(responses: unknown[], fallback: unknown = BENIGN_TURN): MockLanguageModelV4 {
  let i = 0
  return new MockLanguageModelV4({
    doGenerate: async () => {
      const r = i < responses.length ? responses[i]! : fallback
      i += 1
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(askedShape(r)) }],
        finishReason: { unified: 'stop' as const, raw: undefined },
        usage: ZERO_USAGE,
        warnings: [],
      }
    },
  })
}

/** Everything the mind was told on one turn, as one string. */
const saidOn = (prompts: CapturedMessage[][], turn: number): string =>
  prompts[turn]!.filter((m) => m.role === 'user')
    .map((m) => m.text)
    .join('\n')

type CapturedMessage = { role: string; text: string }

function capturingModel(responses: unknown[]): {
  model: MockLanguageModelV4
  prompts: CapturedMessage[][]
} {
  const prompts: CapturedMessage[][] = []
  let i = 0
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      const msgs = (options.prompt as { role: string; content: unknown }[]).map((m) => ({
        role: m.role,
        text: Array.isArray(m.content)
          ? (m.content as { text?: string }[]).map((p) => p.text ?? '').join('')
          : String(m.content),
      }))
      prompts.push(msgs)
      const r = responses[Math.min(i, responses.length - 1)]!
      i += 1
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(askedShape(r)) }],
        finishReason: { unified: 'stop' as const, raw: undefined },
        usage: ZERO_USAGE,
        warnings: [],
      }
    },
  })
  return { model, prompts }
}

// A back end that answers with nothing at all — the empty call R20 made visible, which ran at
// 6.0% of the last live gate. `content: []` is a landed call carrying no answer.
function blankModel(
  blanks: number,
  then: unknown = BENIGN_TURN,
): { model: MockLanguageModelV4; prompts: CapturedMessage[][] } {
  const prompts: CapturedMessage[][] = []
  let i = 0
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      prompts.push(
        (options.prompt as { role: string; content: unknown }[]).map((m) => ({
          role: m.role,
          text: Array.isArray(m.content)
            ? (m.content as { text?: string }[]).map((p) => p.text ?? '').join('')
            : String(m.content),
        })),
      )
      const blank = i < blanks
      i += 1
      return {
        content: blank ? [] : [{ type: 'text' as const, text: JSON.stringify(askedShape(then)) }],
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

function gatedModel(): {
  model: MockLanguageModelV4
  calls: { count: number }
  resolve: (text: string) => void
} {
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
  async gist(text: string) {
    this.calls.push('gist')
    return `gist: ${text.slice(0, 20)}`
  }
  async extractFacts(dayMemories: MemoryRow[]) {
    this.calls.push('extractFacts')
    return dayMemories.length > 0
      ? [{ subject: 'meadow', predicate: 'is', object: 'home', srcMemoryId: dayMemories[0]!.id }]
      : []
  }
  async summarizeScenes(dayMemories: MemoryRow[]) {
    this.calls.push('summarizeScenes')
    return [
      { title: 'The meadow', text: 'A quiet meadow.', memoryIds: dayMemories.map((m) => m.id) },
    ]
  }
  async summarizeDay() {
    this.calls.push('summarizeDay')
    return {
      title: 'First day',
      text: 'A first day at the meadow.',
      standing: ['Keep the fire in.'],
    }
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
  onThought?: (t: { tick: number; agentId: string; text: string }) => void
  adjudicator?: Adjudicator
  budgetUsd?: number
}) {
  const world = buildWorld(opts.simConfig)
  const worldTick = createWorldTick(world.config, world.rng)
  let handler: TickHandler = () => {}
  const loop = new TickLoop({
    store: world.store,
    state: world.state,
    rng: world.rng,
    config: world.config,
    onTick: (ctx) => {
      handler(ctx)
    },
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
  const llm = new LlmClient({
    model: opts.model,
    db: agentDb,
    caller: 'turn',
    agentId: AGENT,
    maxRetries: opts.maxRetries ?? 2,
    ...(opts.budgetUsd === undefined ? {} : { budgetUsd: opts.budgetUsd }),
  })
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
    onThought: opts.onThought,
    adjudicator: opts.adjudicator,
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
  return (
    db.prepare("SELECT payload FROM events WHERE type = 'action_started' ORDER BY seq").all() as {
      payload: string
    }[]
  ).map((r) => (JSON.parse(r.payload) as { verb: string }).verb)
}

function completedVerbs(db: Database.Database): string[] {
  return (
    db.prepare("SELECT payload FROM events WHERE type = 'action_completed' ORDER BY seq").all() as {
      payload: string
    }[]
  ).map((r) => (JSON.parse(r.payload) as { verb: string }).verb)
}

function spokeTexts(db: Database.Database): string[] {
  return (
    db.prepare("SELECT payload FROM events WHERE type = 'agent_spoke' ORDER BY seq").all() as {
      payload: string
    }[]
  ).map((r) => (JSON.parse(r.payload) as { text: string }).text)
}

function memoriesOfKind(
  db: Database.Database,
  kind: string,
): { tick: number; text: string; importance: number }[] {
  return db
    .prepare(
      'SELECT tick, text, importance FROM memories WHERE agent_id = ? AND kind = ? ORDER BY id',
    )
    .all(AGENT, kind) as { tick: number; text: string; importance: number }[]
}

function journalRows(db: Database.Database): { tick: number; text: string }[] {
  return db.prepare('SELECT tick, text FROM journal WHERE agent_id = ? ORDER BY id').all(AGENT) as {
    tick: number
    text: string
  }[]
}

function turnOutcomes(
  db: Database.Database,
): { agent_id: string; acted: number; spoke: number; plan_continued: number }[] {
  return db
    .prepare('SELECT agent_id, acted, spoke, plan_continued FROM turn_outcomes ORDER BY id')
    .all() as {
    agent_id: string
    acted: number
    spoke: number
    plan_continued: number
  }[]
}

function alertKinds(db: Database.Database): string[] {
  return (db.prepare('SELECT kind FROM alerts ORDER BY id').all() as { kind: string }[]).map(
    (r) => r.kind,
  )
}

function alertDetails(db: Database.Database, kind: string): string[] {
  return (
    db.prepare('SELECT detail FROM alerts WHERE kind = ? ORDER BY id').all(kind) as {
      detail: string
    }[]
  ).map((r) => r.detail)
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

  // Run G paid for 610 turns that answered with a thought and nothing else, leaving no event,
  // no refusal and no alert. This row is the only trace such a turn ever leaves.
  it('books what each turn produced against the back end that served it', async () => {
    const { loop, agentDb } = await setup({
      model: turnModel([
        {
          thought: 'The bread is right there.',
          action: { verb: 'take', params: { itemId: BREAD_ID } },
          importance: 3,
        },
        { thought: 'I stand and think of nothing at all.', importance: 1 },
      ]),
      mindConfig: FAST_MIND,
    })
    await stepUntil(loop, () => turnOutcomes(agentDb).length >= 2, 200)
    // The second row is the honest idle: no plan, no act, no word, and it stays counted.
    expect(turnOutcomes(agentDb).slice(0, 2)).toEqual([
      { agent_id: AGENT, acted: 1, spoke: 0, plan_continued: 0 },
      { agent_id: AGENT, acted: 0, spoke: 0, plan_continued: 0 },
    ])
  })

  // w1a put 35 of its 104 speeches through `action`, and every one of them booked spoke: 0.
  it('books words as spoken whichever door they came through', async () => {
    const { world, loop, agentDb } = await setup({
      model: turnModel([
        {
          thought: 'They should know.',
          action: { verb: 'speak', params: { text: 'The storehouse is stocked.' } },
          importance: 3,
        },
      ]),
      mindConfig: FAST_MIND,
    })
    await stepUntil(loop, () => spokeTexts(world.engineDb).length >= 1, 100)
    expect(turnOutcomes(agentDb)[0]).toEqual({
      agent_id: AGENT,
      acted: 1,
      spoke: 1,
      plan_continued: 0,
    })
  })

  // Run G booked 610 turns as silence. A mind whose body is already walking somewhere has
  // nothing to add, and the queue drains whether it speaks up or not.
  it('carries a running plan on through a turn that names nothing, and books it as such', async () => {
    const { world, loop, agentDb } = await setup({
      model: turnModel(
        [
          {
            thought: 'Walk over, take the bread, eat it.',
            plan: [
              { verb: 'walk', params: { x: 5, y: 6 } },
              { verb: 'take', params: { itemId: BREAD_ID } },
              { verb: 'eat', params: { itemId: BREAD_ID } },
            ],
            importance: 4,
            reconsider_at: '00:05',
          },
        ],
        { thought: 'My hands are already at it. I let them work.', importance: 2 },
      ),
      mindConfig: FAST_MIND,
    })
    await stepUntil(loop, () => completedVerbs(world.engineDb).length >= 3, 200)
    expect(completedVerbs(world.engineDb)).toEqual(['walk', 'take', 'eat'])
    const rows = turnOutcomes(agentDb)
    // The turn that set the plan going, and the turn that let it run on: neither is silence.
    expect(rows[0]).toEqual({ agent_id: AGENT, acted: 0, spoke: 0, plan_continued: 1 })
    expect(rows[1]).toEqual({ agent_id: AGENT, acted: 0, spoke: 0, plan_continued: 1 })
  })

  it('books an interrupting act as an act, not as the plan it just threw away', async () => {
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
        {
          thought: 'No — I am spent. I lie down where I stand.',
          action: { verb: 'sleep', params: {} },
          importance: 6,
        },
      ]),
      mindConfig: FAST_MIND,
    })
    await stepUntil(loop, () => completedVerbs(world.engineDb).length >= 2, 80)
    expect(turnOutcomes(agentDb).slice(0, 2)).toEqual([
      { agent_id: AGENT, acted: 0, spoke: 0, plan_continued: 1 },
      { agent_id: AGENT, acted: 1, spoke: 0, plan_continued: 0 },
    ])
  })

  it('tells a mind what it is in the middle of, and asks it to carry on or break off', async () => {
    const { model, prompts } = capturingModel([
      {
        thought: 'Walk over, take the bread, eat it.',
        plan: [
          { verb: 'walk', params: { x: 5, y: 6 } },
          { verb: 'take', params: { itemId: BREAD_ID } },
          { verb: 'eat', params: { itemId: BREAD_ID } },
        ],
        importance: 4,
        reconsider_at: '00:05',
      },
      { thought: 'I let my hands work.', importance: 2 },
    ])
    const { loop, runtime } = await setup({ model, mindConfig: FAST_MIND })
    await stepUntil(loop, () => runtime.stats().turns >= 2, 200)
    const first = prompts[0]!.map((m) => m.text).join('\n')
    const second = prompts[1]!.map((m) => m.text).join('\n')
    // Nothing was underway on the first turn, so the open framing stands.
    expect(first).not.toContain('You are in the middle of:')
    expect(second).toContain('You are in the middle of: walk 5 6 (step 1 of 3).')
    expect(second).toContain('Answer wait and it goes on.')
  })

  it('submits speech and records a thought memory with its importance', async () => {
    const { world, loop, agentDb } = await setup({
      model: turnModel([
        {
          thought: 'Good, the storehouse still has bread.',
          speech: 'The storehouse is stocked.',
          importance: 4,
        },
      ]),
      mindConfig: FAST_MIND,
    })
    await stepUntil(loop, () => spokeTexts(world.engineDb).length >= 1, 100)
    expect(spokeTexts(world.engineDb)).toContain('The storehouse is stocked.')
    expect(memoriesOfKind(agentDb, 'thought').some((t) => t.importance === 4)).toBe(true)
  })

  it('journals, stores a journal memory, and delays the next wake by journalTicks', async () => {
    const { loop, agentDb } = await setup({
      model: turnModel([
        { thought: 'I will write it down.', journal: 'First day at the meadow.', importance: 6 },
      ]),
      mindConfig: { ...FAST_MIND, boredomTicks: 5, journalTicks: 10 },
    })
    await stepUntil(loop, () => journalRows(agentDb).length >= 1, 100)
    const journal = journalRows(agentDb)
    expect(journal).toHaveLength(1)
    expect(journal[0]!.text).toBe('First day at the meadow.')
    expect(memoriesOfKind(agentDb, 'journal').map((m) => m.text)).toContain(
      'First day at the meadow.',
    )

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
    expect(() => {
      loop.step()
    }).not.toThrow()
    await flush()
    expect(runtime.stats().dozes).toBe(1)
    expect(alertKinds(agentDb)).toContain('doze_off')
    for (let i = 0; i < 19; i++) {
      expect(() => {
        loop.step()
      }).not.toThrow()
      await flush()
    }
    expect(runtime.stats().dozes).toBe(1)
  })

  // ★ A crossed cap and a dead back end are different problems; the alert row must say which.
  it('★ a doze names its own cause: a crossed cap is not a dead provider', async () => {
    const { loop, agentDb } = await setup({
      model: turnModel([]),
      mindConfig: { ...FAST_MIND, dozeTicks: 20 },
      budgetUsd: 0,
    })
    loop.step()
    await flush()
    expect(alertDetails(agentDb, 'doze_off')[0]).toContain('budget exceeded')
    expect(alertDetails(agentDb, 'doze_off')[0]).not.toContain('providers unavailable')
  })

  it('★ and it is not vacuous: a dead back end still reads as one', async () => {
    const { loop, agentDb } = await setup({
      model: throwingModel(),
      mindConfig: { ...FAST_MIND, dozeTicks: 20 },
    })
    loop.step()
    await flush()
    expect(alertDetails(agentDb, 'doze_off')[0]).toContain('provider down')
  })

  it('respects the doze backoff even when body_alarm keeps firing during an outage', async () => {
    // 25 ticks at a 20-tick backoff holds two attempts and no more. Without the backoff a
    // ringing alarm would doze the mind every tick.
    const { loop, runtime } = await setup({
      model: throwingModel(),
      mindConfig: { dozeTicks: 20 },
    })
    for (let i = 0; i < 25; i++) {
      loop.step()
      await flush()
    }
    expect(runtime.stats().dozes).toBe(2)
  })

  it('surfaces a rejected intent in-world', async () => {
    const { loop, agentDb } = await setup({
      model: turnModel([
        {
          thought: 'I will try to eat.',
          action: { verb: 'eat', params: { itemId: 'nope' } },
          importance: 3,
        },
      ]),
      mindConfig: FAST_MIND,
    })
    await stepUntil(loop, () => memoriesOfKind(agentDb, 'action').length >= 1, 100)
    expect(
      memoriesOfKind(agentDb, 'action').some((m) => m.text.includes('You realize you cannot')),
    ).toBe(true)
    // A plain physics refusal is not a craft the town can teach.
    expect(memoriesOfKind(agentDb, 'action').some((m) => m.text.includes(CRAFT_HINT))).toBe(false)
  })

  // ★ The memory row alone was never enough: it is written with no tags, so it scores zero on
  // retrieval's heaviest term and mostly never came back. The next turn is told outright.
  it('★ tells the NEXT turn what did not take, and tells it once', async () => {
    const { model, prompts } = capturingModel([
      {
        thought: 'I will try to eat.',
        action: { verb: 'eat', params: { itemId: 'nope' } },
        importance: 3,
      },
      BENIGN_TURN,
      BENIGN_TURN,
    ])
    const { loop, runtime } = await setup({ model, mindConfig: FAST_MIND })
    await stepUntil(loop, () => runtime.stats().turns >= 3, 120)
    expect(saidOn(prompts, 0)).not.toContain('Last turn:')
    expect(saidOn(prompts, 1)).toContain('Last turn: eat did not take —')
    expect(saidOn(prompts, 2)).not.toContain('Last turn:')
  })

  it('runs reflection once per night, dreams, and resets the day at dawn', async () => {
    const reflection = new ScriptedReflectionLlm()
    const dream = new ScriptedDreamLlm()
    const { loop, runtime, mem, personality, agentDb, bridge } = await setup({
      model: turnModel([]),
      mindConfig: { idleGapTicks: 300, boredomTicks: 100000, dreamChance: 1 },
      reflectionLlm: reflection,
      dreamLlm: dream,
      simConfig: SLOW_BODY,
    })
    await stepUntil(loop, () => loop.tick >= NIGHT_0_TICK, 2000)
    void bridge.submit(AGENT, { verb: 'sleep', params: {} })
    await stepUntil(loop, () => mem.summaryNodes('day', 0).length === 1, 100)
    expect(runtime.stats().reflections).toBe(1)
    expect(dream.calls).toBe(1)
    expect(memoriesOfKind(agentDb, 'dream').length).toBe(1)
    expect(runtime.dayLogSnapshot().length).toBeGreaterThanOrEqual(1)

    await stepUntil(loop, () => loop.tick >= DAY_1_DAWN_TICK, 2000)
    expect(runtime.stats().reflections).toBe(1)
    expect(personality.current().doc.current.mood).toBe('peaceful')
    // The dawn reset drops yesterday's log; the morning wake may already have
    // written the new day's first entry.
    expect(runtime.dayLogSnapshot().length).toBeLessThanOrEqual(1)
  })

  // Every archived run edited its founders' authored personalities minutes after boot, over a
  // day log of one line, because the clamp folded night -1 onto night 0.
  it('does not reflect on the pre-dawn of a fresh world, which is a night nobody lived', async () => {
    const reflection = new ScriptedReflectionLlm()
    const { loop, runtime, mem, personality, bridge } = await setup({
      model: turnModel([]),
      mindConfig: { idleGapTicks: 300, boredomTicks: 100000 },
      reflectionLlm: reflection,
      simConfig: SLOW_BODY,
    })
    void bridge.submit(AGENT, { verb: 'sleep', params: {} })
    await stepUntil(loop, () => loop.tick >= DAWN_TICK, 2000)
    expect(loop.state.agents[AGENT]!.asleep).toBe(true)
    expect(runtime.stats().reflections).toBe(0)
    expect(mem.summaryNodes('day', 0)).toHaveLength(0)
    expect(personality.current().version).toBe(1)
  })

  it('a refused dream is alerted as a dream, not as the night that already landed', async () => {
    const reflection = new ScriptedReflectionLlm()
    const dream = new ScriptedDreamLlm()
    dream.composeDream = () => Promise.reject(new Error('the dream is over budget'))
    const { loop, mem, agentDb, bridge } = await setup({
      model: turnModel([]),
      mindConfig: { idleGapTicks: 300, boredomTicks: 100000, dreamChance: 1 },
      reflectionLlm: reflection,
      dreamLlm: dream,
      simConfig: SLOW_BODY,
    })
    await stepUntil(loop, () => loop.tick >= NIGHT_0_TICK, 2000)
    void bridge.submit(AGENT, { verb: 'sleep', params: {} })
    await stepUntil(loop, () => alertKinds(agentDb).includes('dream_failed'), 100)

    expect(alertKinds(agentDb)).not.toContain('reflection_failed')
    expect(alertDetails(agentDb, 'dream_failed')).toEqual(['the dream is over budget'])
    // The night's own work was already written when the dream was refused.
    expect(mem.summaryNodes('day', 0).length).toBe(1)
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
        {
          thought: 'No — I am spent. I lie down where I stand.',
          action: { verb: 'sleep', params: {} },
          importance: 6,
        },
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
      // Warmth is pinned off with the other two clocks: a body out in a spring night loses it
      // until the alarm rings, and a woken sleeper is not what this row is about.
      simConfig: SimConfigSchema.parse({
        needs: { hungerDecayPerTick: 0, energyDecayAwakePerTick: 0 },
        structures: { sleepIndoorsOnly: false },
        warmth: { enabled: false },
      }),
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

  it('exposes an in-flight signal while a nightly reflection is still running (g3 round 6)', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    class GatedReflectionLlm extends ScriptedReflectionLlm {
      override async extractFacts(dayMemories: MemoryRow[]) {
        await gate
        return super.extractFacts(dayMemories)
      }
    }
    const reflection = new GatedReflectionLlm()
    const { loop, runtime, mem, bridge } = await setup({
      model: turnModel([]),
      mindConfig: { idleGapTicks: 300, boredomTicks: 100000 },
      reflectionLlm: reflection,
      simConfig: SLOW_BODY,
    })
    await stepUntil(loop, () => loop.tick >= NIGHT_0_TICK, 2000)
    void bridge.submit(AGENT, { verb: 'sleep', params: {} })
    await stepUntil(loop, () => runtime.reflectionInFlight(), 100)
    expect(runtime.reflectionInFlight()).toBe(true)
    expect(mem.summaryNodes('day', 0)).toHaveLength(0)

    release()
    await stepUntil(loop, () => !runtime.reflectionInFlight(), 100)
    expect(runtime.reflectionInFlight()).toBe(false)
    expect(mem.summaryNodes('day', 0)).toHaveLength(1)
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
        {
          thought: 'Good, the storehouse still has bread.',
          speech: 'The storehouse is stocked.',
          importance: 4,
        },
        { thought: 'I will write it down.', journal: 'First day at the meadow.', importance: 6 },
      ]),
      mindConfig: { ...FAST_MIND, journalTicks: 10 },
    })
    await stepUntil(
      loop,
      () => loop.tick >= 80 && memoriesOfKind(agentDb, 'journal').length >= 1,
      300,
    )
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
    expect(
      memoriesOfKind(agentDb, 'action').some((m) => m.text.includes('You realize you cannot')),
    ).toBe(true)
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

  it('keeps the cache prefix byte-stable across consecutive turns: same system, dayLog only appended (g3 round 6)', async () => {
    const { model, prompts } = capturingModel([BENIGN_TURN, BENIGN_TURN])
    const { loop, runtime } = await setup({ model, mindConfig: FAST_MIND })
    await stepUntil(loop, () => runtime.stats().turns >= 2, 100)
    expect(prompts.length).toBeGreaterThanOrEqual(2)

    const [a, b] = [prompts[0]!, prompts[1]!]
    const sysA = a.find((m) => m.role === 'system')!
    const sysB = b.find((m) => m.role === 'system')!
    // The static system block (rules + capabilities + identity + personality)
    // must be byte-identical between turns within a day.
    expect(sysB.text).toBe(sysA.text)

    // Message 0 is the append-only dayLog: turn 2's must extend turn 1's, byte
    // for byte, so the provider prefix survives everything but scene + now.
    const dayLogA = a.find((m) => m.role === 'user')!.text
    const dayLogB = b.find((m) => m.role === 'user')!.text
    expect(dayLogB.startsWith(dayLogA)).toBe(true)
  })

  // The whole day log is re-sent every turn, and 82% of rehearsal 3's was already-read sentences.
  it('the day log drops what the last moment already said, and keeps what it did not', async () => {
    const { loop, runtime, agentDb } = await setup({ model: turnModel([]), mindConfig: FAST_MIND })
    await stepUntil(loop, () => runtime.stats().turns >= 6, 200)

    const moments = memoriesOfKind(agentDb, 'perception').map((m) => m.text)
    const logged = runtime.dayLogSnapshot().join(' ')
    expect(moments.length).toBeGreaterThanOrEqual(4)

    // It shrinks: a still scene renders the same sentences every turn and pays for them once.
    expect(logged.length).toBeLessThan(moments.join(' ').length / 2)

    const kept = new Set(splitSentences(logged))
    for (const [i, moment] of moments.entries()) {
      const before = new Set(i === 0 ? [] : splitSentences(moments[i - 1]!))
      for (const s of splitSentences(moment)) {
        if (!before.has(s)) expect(kept.has(s), s).toBe(true)
      }
    }
  })

  it('the makeable vocabulary rides the volatile block and never the frozen prefix (C11 R-H)', async () => {
    const { model, prompts } = capturingModel([BENIGN_TURN, BENIGN_TURN])
    const { loop, runtime } = await setup({ model, mindConfig: FAST_MIND })
    await stepUntil(loop, () => runtime.stats().turns >= 2, 100)

    const [a, b] = [prompts[0]!, prompts[1]!]
    // Last user message is block 6, `now`. It is the one place the words appear.
    const nowA = a.filter((m) => m.role === 'user').at(-1)!.text
    expect(nowA).toContain('a house (10 wood)')
    expect(nowA).toContain('stew (1 meat and 1 vegetable, at a fire someone is feeding')
    expect(a.find((m) => m.role === 'system')!.text).not.toContain('a house (10 wood)')
    // And not in the day log, which is the day's events: a standing fact repeated every turn
    // would compact the day out of the mind that lived it.
    expect(runtime.dayLogSnapshot().join(' ')).not.toContain('a house (10 wood)')
    expect(b.find((m) => m.role === 'user')!.text).not.toContain('a house (10 wood)')
  })

  // A blank answer is not a wrong answer: charging a mind a whole turn for one leaves a drift
  // in its memory that it never actually had.
  it('asks a blank answer again, unchanged — not as a correction for something never said', async () => {
    const { model, prompts } = blankModel(1)
    const { loop, runtime } = await setup({ model, mindConfig: FAST_MIND })
    await stepUntil(loop, () => runtime.stats().turns >= 1, 60)

    expect(prompts.length).toBe(2)
    // Byte-identical: nothing is appended, so the cached prefix is still the whole request.
    expect(prompts[1]).toEqual(prompts[0]!)
    expect(prompts[1]!.some((m) => /rejected/i.test(m.text))).toBe(false)
    expect(runtime.stats().turns).toBeGreaterThanOrEqual(1)
  })

  it('a second blank leaves the turn unspent: no drift it never had, and the body carries on', async () => {
    const thoughts: string[] = []
    const { model, prompts } = blankModel(2)
    const { loop, runtime, agentDb } = await setup({
      model,
      mindConfig: FAST_MIND,
      onThought: (t) => thoughts.push(t.text),
    })
    await stepUntil(loop, () => prompts.length >= 2, 60)

    // Asked twice and no more: the tripwire against hammering a back end that is answering.
    expect(prompts.length).toBe(2)
    expect(runtime.stats().turns).toBe(0)
    // FALLBACK_TURN used to be applied here as though the mind had really stood there musing.
    expect(thoughts).toEqual([])
    expect(alertKinds(agentDb)).toContain('blank_answer')
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

  // K20: 164 of run E's 368 refusals were an act named with nothing in it, and the world only
  // says so a beat later, with the moment already spent.
  it('asks again once when an act comes back with nothing named in it', async () => {
    const empty = {
      thought: 'I would speak.',
      action: { verb: 'speak', params: {} },
      importance: 3,
    }
    const filled = {
      thought: 'I would speak.',
      action: { verb: 'speak', params: { text: 'The bread is yours.' } },
      importance: 3,
    }
    const { model, prompts } = capturingModel([empty, filled])
    const { world, loop, runtime, agentDb } = await setup({ model, mindConfig: FAST_MIND })
    await stepUntil(loop, () => runtime.stats().turns >= 1, 50)

    expect(prompts.length).toBe(2)
    const again = prompts[1]!
    expect(again[again.length - 2]!.role).toBe('assistant')
    expect(again[again.length - 1]!.text).toContain('left speak empty')
    expect(spokeTexts(world.engineDb)).toContain('The bread is yours.')
    expect(alertKinds(agentDb)).not.toContain('empty_act_detail')
  })

  it('gives up after the one retry, and says so where an operator can see it', async () => {
    const empty = { thought: 'I would eat.', action: { verb: 'eat', params: {} }, importance: 3 }
    const { model, prompts } = capturingModel([empty, empty])
    const { loop, runtime, agentDb } = await setup({ model, mindConfig: FAST_MIND })
    await stepUntil(loop, () => runtime.stats().turns >= 1, 50)

    expect(prompts.length).toBe(2)
    expect(alertKinds(agentDb)).toContain('empty_act_detail')
  })

  it('perception prose offers a standable tile beside a visible structure (g3 round 6)', async () => {
    const { loop, runtime } = await setup({ model: turnModel([]), mindConfig: FAST_MIND })
    await stepUntil(loop, () => runtime.stats().turns >= 1, 30)
    // A storehouse is a thing you can walk into, so the prose names the doorway `enter`
    // measures against rather than the nearest open ground beside the wall.
    expect(runtime.dayLogSnapshot()[0]).toContain(
      'its doorway is at (5, 6); stand there and you can go in',
    )
  })

  it('the body answers its own alarm: a sleeper whose turn submits nothing is woken by a runtime wake', async () => {
    const stillSim = SimConfigSchema.parse({
      needs: { hungerDecayPerTick: 0, energyDecayAwakePerTick: 0 },
      structures: { sleepIndoorsOnly: false },
    })
    const { world, loop } = await setup({
      model: turnModel([
        { thought: 'Time to rest.', action: { verb: 'sleep', params: {} }, importance: 5 },
      ]),
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
    const stillSim = SimConfigSchema.parse({
      needs: { hungerDecayPerTick: 0, energyDecayAwakePerTick: 0 },
      structures: { sleepIndoorsOnly: false },
    })
    const { world, loop, agentDb } = await setup({
      model: turnModel(
        [{ thought: 'Time to rest.', action: { verb: 'sleep', params: {} }, importance: 5 }],
        // Every later turn targets the storehouse's own tile: the engine
        // rejects it ('no path to that spot'), just as in the live run.
        {
          thought: 'To the storehouse.',
          action: { verb: 'walk', params: { x: 5, y: 5 } },
          importance: 4,
        },
      ),
      mindConfig: FAST_MIND,
      simConfig: stillSim,
    })
    await stepUntil(loop, () => loop.state.agents[AGENT]!.asleep, 30)
    await stepUntil(loop, () => loop.tick >= DAWN_TICK && !loop.state.agents[AGENT]!.asleep, 500)
    expect(loop.state.agents[AGENT]!.asleep).toBe(false)
    expect(startedVerbs(world.engineDb)).toContain('wake')
    expect(
      memoriesOfKind(agentDb, 'action').some((m) => m.text.includes('no path to that spot')),
    ).toBe(true)
  })

  it('backs off on non-provider turn failures', async () => {
    const { loop, runtime, agentDb } = await setup({
      model: turnModel([{ thought: 'I think.', importance: 3 }]),
      mindConfig: { ...FAST_MIND, dozeTicks: 20 },
      embedder: {
        async embed(): Promise<Float32Array> {
          throw new Error('embedder down')
        },
      },
    })
    expect(() => {
      loop.step()
    }).not.toThrow()
    await flush()
    expect(runtime.stats().turns).toBe(0)
    expect(alertKinds(agentDb).filter((k) => k === 'turn_crash')).toHaveLength(1)
    for (let i = 0; i < 19; i++) {
      expect(() => {
        loop.step()
      }).not.toThrow()
      await flush()
    }
    expect(runtime.stats().turns).toBe(0)
    expect(alertKinds(agentDb).filter((k) => k === 'turn_crash')).toHaveLength(1)
  })

  it('fires the optional onThought hook once per turn with tick, agentId, and the turn thought', async () => {
    const seen: { tick: number; agentId: string; text: string }[] = []
    const { loop, runtime } = await setup({
      model: turnModel([BENIGN_TURN]),
      mindConfig: FAST_MIND,
      onThought: (t) => seen.push(t),
    })
    await stepUntil(loop, () => seen.length >= 1, 100)
    expect(runtime.stats().turns).toBeGreaterThanOrEqual(1)
    expect(seen[0]).toEqual({ tick: expect.any(Number) as number, agentId: AGENT, text: 'I rest.' })
    expect(seen[0]!.tick).toBeGreaterThan(0)
  })
})

describe('arbiter seam (T19)', () => {
  const freeformTurn = {
    thought: 'I will try something new.',
    action: { freeform: 'weave reeds into a basket' },
    importance: 4,
  }

  it('routes a freeform intent to the adjudicator and executes a map verdict as a Tier-1 act', async () => {
    const seen: { intent: string; ctx: AgentCtx }[] = []
    const adjudicator: Adjudicator = async (intent, ctx) => {
      seen.push({ intent, ctx })
      return { kind: 'map', verb: 'walk', params: { x: 5, y: 6 } }
    }
    const { loop, world } = await setup({
      model: turnModel([freeformTurn]),
      mindConfig: FAST_MIND,
      adjudicator,
    })
    await stepUntil(loop, () => startedVerbs(world.engineDb).includes('walk'), 100)

    expect(startedVerbs(world.engineDb)).toContain('walk')
    expect(startedVerbs(world.engineDb)).not.toContain('experiment')
    expect(seen).toHaveLength(1)
    expect(seen[0]!.intent).toBe('weave reeds into a basket')
    expect(seen[0]!.ctx.agentId).toBe(AGENT)
    expect(seen[0]!.ctx.name).toBe('Tamar')
  })

  it('writes a refusal memory for an impossible verdict, hinted when it is only a want of skill', async () => {
    const adjudicator: Adjudicator = async () => ({
      kind: 'impossible',
      reason: 'your hands do not yet know the weave',
      class: 'insufficient_skill',
    })
    const { loop, agentDb, world } = await setup({
      model: turnModel([freeformTurn]),
      mindConfig: FAST_MIND,
      adjudicator,
    })
    await stepUntil(loop, () => memoriesOfKind(agentDb, 'action').length >= 1, 100)

    expect(memoriesOfKind(agentDb, 'action')[0]!.text).toBe(
      'You realize you cannot: your hands do not yet know the weave — perhaps someone nearby knows the craft.',
    )
    expect(startedVerbs(world.engineDb)).not.toContain('experiment')
  })

  // A refusal a mind cannot act on is a refusal it repeats, at a full arbiter call each time.
  it("★ asks the god ONCE for one idea: the same intent again is answered from the mind's own past", async () => {
    let calls = 0
    const adjudicator: Adjudicator = async () => {
      calls += 1
      return {
        kind: 'impossible',
        reason: 'the reeds will not hold that shape',
        class: 'physically_impossible',
      }
    }
    const { loop, agentDb } = await setup({
      // The same idea, three turns running — and said differently the third time, because a
      // mind rephrases. `sameIntent` normalizes case, spacing and trailing punctuation.
      model: turnModel([
        freeformTurn,
        freeformTurn,
        { ...freeformTurn, action: { freeform: 'Weave reeds into a basket.' } },
      ]),
      mindConfig: FAST_MIND,
      adjudicator,
    })
    await stepUntil(loop, () => memoriesOfKind(agentDb, 'action').length >= 3, 400)

    // One call for three asks. The other two cost nothing at all.
    expect(calls).toBe(1)
    const texts = memoriesOfKind(agentDb, 'action').map((m) => m.text)
    expect(texts[0]).toBe('You realize you cannot: the reeds will not hold that shape')
    // ★ AND THE SECOND MEMORY IS DIFFERENT FROM THE FIRST. Handing a mind the identical
    // sentence a third time is the defect, not the call count.
    expect(texts[1]).toBe(REPEATED_REFUSAL)
    expect(texts[2]).toBe(REPEATED_REFUSAL)
    expect(REPEATED_REFUSAL).not.toBe(texts[0])
  })

  it('★ ANTI-VACUITY: a DIFFERENT idea still reaches the god, and so does the same one later', async () => {
    // A breaker that silences the second ask of anything would be worse than the loop: it
    // would cap a mind at one novel act per lifetime.
    const seen: string[] = []
    const adjudicator: Adjudicator = async (intent) => {
      seen.push(intent)
      return {
        kind: 'impossible',
        reason: 'the reeds will not hold that shape',
        class: 'physically_impossible',
      }
    }
    const { loop, agentDb } = await setup({
      model: turnModel([
        freeformTurn,
        { ...freeformTurn, action: { freeform: 'bank the fire with river clay' } },
      ]),
      mindConfig: FAST_MIND,
      adjudicator,
    })
    await stepUntil(loop, () => memoriesOfKind(agentDb, 'action').length >= 2, 400)

    expect(seen).toEqual(['weave reeds into a basket', 'bank the fire with river clay'])
    // The window is a window: it is measured in ticks and it expires.
    expect(REFUSAL_MEMORY_TICKS).toBeGreaterThan(0)
    expect(REFUSAL_MEMORY_TICKS).toBeLessThan(MINUTES_PER_DAY)
  })

  // ★ Run D spent 3 of its 9 rulings on `stand`, `think` and `none player`, ~11 ticks of
  // silence each. The body was already standing still; there is nothing for a god to rule on.
  it('★ a word for standing still is a quiet beat, not a ruling and not a refusal', async () => {
    const seen: string[] = []
    const adjudicator: Adjudicator = async (intent) => {
      seen.push(intent)
      return {
        kind: 'impossible',
        reason: 'the reeds will not hold',
        class: 'physically_impossible',
      }
    }
    const { loop, agentDb } = await setup({
      model: turnModel([
        { thought: 'I stand a while.', action: { verb: 'stand', params: {} }, importance: 2 },
        { thought: 'I let it be.', action: { verb: 'think', params: {} }, importance: 2 },
        { thought: 'Nothing for it.', action: { verb: 'none', params: {} }, importance: 2 },
        freeformTurn,
      ]),
      mindConfig: FAST_MIND,
      adjudicator,
    })
    await stepUntil(loop, () => seen.length >= 1, 400)

    expect(seen).toEqual(['weave reeds into a basket'])
    expect(
      memoriesOfKind(agentDb, 'action').filter((m) => m.text.includes(OPAQUE_REFUSAL)),
    ).toEqual([])
  })

  it('falls back to the world’s own answer when no adjudicator is wired', async () => {
    const { loop, agentDb } = await setup({
      model: turnModel([freeformTurn]),
      mindConfig: FAST_MIND,
    })
    await stepUntil(loop, () => memoriesOfKind(agentDb, 'action').length >= 1, 100)

    expect(memoriesOfKind(agentDb, 'action')[0]!.text).toContain(
      'You lack the knowledge to attempt this.',
    )
    expect(memoriesOfKind(agentDb, 'action')[0]!.text).toContain(
      'Perhaps someone in the town knows how.',
    )
  })

  it('falls back to the world when the adjudicator throws, and says so in an alert', async () => {
    const adjudicator: Adjudicator = async () => {
      throw new Error('the arbiter is unreachable')
    }
    const { loop, agentDb } = await setup({
      model: turnModel([freeformTurn]),
      mindConfig: FAST_MIND,
      adjudicator,
    })
    await stepUntil(loop, () => memoriesOfKind(agentDb, 'action').length >= 1, 100)

    expect(memoriesOfKind(agentDb, 'action')[0]!.text).toContain(
      'You lack the knowledge to attempt this.',
    )
    expect(alertKinds(agentDb)).toContain('adjudicate_failed')
  })

  // CAPABILITIES offers `experiment` as well as freeform, so a mind may name
  // either for the same try. Both are doors to the arbiter once one is wired.
  it('sends a named experiment to the adjudicator in its own words', async () => {
    const seen: string[] = []
    const adjudicator: Adjudicator = async (intent) => {
      seen.push(intent)
      return { kind: 'map', verb: 'walk', params: { x: 5, y: 6 } }
    }
    const { loop, world } = await setup({
      model: turnModel([
        {
          thought: 'I will try it.',
          action: { verb: 'experiment', params: { description: 'boil river water down for salt' } },
          importance: 4,
        },
      ]),
      mindConfig: FAST_MIND,
      adjudicator,
    })
    await stepUntil(loop, () => startedVerbs(world.engineDb).includes('walk'), 100)

    expect(seen).toEqual(['boil river water down for salt'])
    expect(startedVerbs(world.engineDb)).not.toContain('experiment')
  })

  it('lets an experiment reach the world unchanged when no arbiter is wired', async () => {
    const { loop, agentDb } = await setup({
      model: turnModel([
        {
          thought: 'I will try it.',
          action: { verb: 'experiment', params: { description: 'boil river water down for salt' } },
          importance: 4,
        },
      ]),
      mindConfig: FAST_MIND,
    })
    await stepUntil(loop, () => memoriesOfKind(agentDb, 'action').length >= 1, 100)
    expect(memoriesOfKind(agentDb, 'action')[0]!.text).toContain(
      'You lack the knowledge to attempt this.',
    )
  })

  it('leaves a named Tier-1 action untouched by the seam', async () => {
    const adjudicator: Adjudicator = async () => {
      throw new Error('must not be consulted')
    }
    const { loop, agentDb, world } = await setup({
      model: turnModel([
        { thought: 'I walk.', action: { verb: 'walk', params: { x: 5, y: 6 } }, importance: 2 },
      ]),
      mindConfig: FAST_MIND,
      adjudicator,
    })
    await stepUntil(loop, () => startedVerbs(world.engineDb).includes('walk'), 100)
    expect(startedVerbs(world.engineDb)).toContain('walk')
    expect(alertKinds(agentDb)).not.toContain('adjudicate_failed')
  })
})

describe('arbiter wiring expansion (T20)', () => {
  const RECIPE_VERB = 'recipe:t20_weave'
  afterEach(() => {
    unregisterVerb(RECIPE_VERB)
  })

  const unknownVerbTurn = {
    thought: 'I will patch the roof.',
    action: { verb: 'patch', params: { structureId: STRUCTURE_ID } },
    importance: 4,
  }

  it('re-frames an unknown verb as freeform and sends the flattened words to the arbiter', async () => {
    const seen: string[] = []
    const adjudicator: Adjudicator = async (intent) => {
      seen.push(intent)
      return {
        kind: 'impossible',
        reason: 'the roof is beyond mending',
        class: 'physically_impossible',
      }
    }
    const { loop, agentDb } = await setup({
      model: turnModel([unknownVerbTurn]),
      mindConfig: FAST_MIND,
      adjudicator,
    })
    await stepUntil(loop, () => memoriesOfKind(agentDb, 'action').length >= 1, 100)

    expect(seen).toEqual([`patch ${STRUCTURE_ID}`])
    expect(memoriesOfKind(agentDb, 'action')[0]!.text).toBe(
      'You realize you cannot: the roof is beyond mending',
    )
  })

  it('asks the arbiter once per turn: a second unknown verb falls back to refusal memory', async () => {
    let calls = 0
    const adjudicator: Adjudicator = async () => {
      calls += 1
      // A map onto another verb the world does not have: the retry fails too.
      return { kind: 'map', verb: 'patch_again', params: {} }
    }
    const { loop, agentDb } = await setup({
      model: turnModel([unknownVerbTurn]),
      mindConfig: FAST_MIND,
      adjudicator,
    })
    await stepUntil(loop, () => memoriesOfKind(agentDb, 'action').length >= 1, 100)

    expect(calls).toBe(1)
    expect(memoriesOfKind(agentDb, 'action')[0]!.text).toBe(
      `You realize you cannot: ${OPAQUE_REFUSAL}`,
    )
  })

  // ★ The gateway process installs no `unhandledRejection` handler: a voided promise kills it.
  it('★ a failed action-memory write lands as an alert, not as an unhandled rejection', async () => {
    const base = await FakeEmbedder.create()
    const embedder = {
      embed: async (t: string): Promise<Float32Array> => {
        if (t.startsWith('You realize you cannot'))
          throw new Error('The database connection is not open')
        return base.embed(t)
      },
    }
    const unhandled: unknown[] = []
    const onUnhandled = (err: unknown): void => {
      unhandled.push(err)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      const { loop, agentDb } = await setup({
        model: turnModel([unknownVerbTurn]),
        mindConfig: FAST_MIND,
        embedder,
      })
      await stepUntil(loop, () => alertKinds(agentDb).includes('memory_write_failed'), 100)
      expect(alertKinds(agentDb)).toContain('memory_write_failed')
      expect(alertDetails(agentDb, 'memory_write_failed')[0]).toContain(
        'database connection is not open',
      )
      await flush()
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('codifies an attempt verdict and then submits the new recipe verb', async () => {
    const codified: string[] = []
    const arbiter: SeamArbiter = {
      adjudicate: async () => ({
        kind: 'attempt',
        recipe: { id: RECIPE_VERB },
        summary: 'Weave reeds into a mat.',
      }),
      codify: (recipe) => {
        codified.push(recipe.id)
        registerVerb({
          kind: RECIPE_VERB,
          validate: () => null,
          duration: () => 1,
          onComplete: () => [],
        })
        return { ruleId: 1, verb: recipe.id }
      },
    }
    const { loop, runtime, world } = await setup({
      model: turnModel([
        { thought: 'A mat.', action: { freeform: 'weave reeds into a mat' }, importance: 5 },
      ]),
      mindConfig: FAST_MIND,
    })
    wireArbiter(runtime, arbiter)
    await stepUntil(loop, () => startedVerbs(world.engineDb).includes(RECIPE_VERB), 100)

    expect(codified).toEqual([RECIPE_VERB])
    expect(startedVerbs(world.engineDb)).toContain(RECIPE_VERB)
    expect(startedVerbs(world.engineDb)).not.toContain('experiment')
  })

  it('names the asking mind and its own words where the recipe becomes law (F-A)', async () => {
    const calls: { recipeId: string; credit: DiscoveryCredit | undefined }[] = []
    const INTENT = 'weave reeds into a mat'
    let asked = ''
    const arbiter: SeamArbiter = {
      adjudicate: async (intent) => {
        asked = intent
        return { kind: 'attempt', recipe: { id: RECIPE_VERB }, summary: 'Weave reeds into a mat.' }
      },
      codify: (recipe, credit) => {
        calls.push({ recipeId: recipe.id, credit })
        registerVerb({
          kind: RECIPE_VERB,
          validate: () => null,
          duration: () => 1,
          onComplete: () => [],
        })
        return { ruleId: 1, verb: recipe.id }
      },
    }
    const { loop, runtime, world } = await setup({
      model: turnModel([{ thought: 'A mat.', action: { freeform: INTENT }, importance: 5 }]),
      mindConfig: FAST_MIND,
    })
    wireArbiter(runtime, arbiter)
    await stepUntil(loop, () => startedVerbs(world.engineDb).includes(RECIPE_VERB), 100)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.credit).toEqual({ agentId: AGENT, intent: INTENT })
    // The SAME words the arbiter was asked, never a paraphrase.
    expect(calls[0]!.credit!.intent).toBe(asked)
  })

  it('falls back to the world when an attempt arrives with no way to codify it', async () => {
    const adjudicator: Adjudicator = async () => ({
      kind: 'attempt',
      recipe: { id: RECIPE_VERB },
      summary: 'Weave reeds into a mat.',
    })
    const { loop, agentDb } = await setup({
      model: turnModel([
        { thought: 'A mat.', action: { freeform: 'weave reeds into a mat' }, importance: 5 },
      ]),
      mindConfig: FAST_MIND,
      adjudicator,
    })
    await stepUntil(loop, () => memoriesOfKind(agentDb, 'action').length >= 1, 100)
    expect(memoriesOfKind(agentDb, 'action')[0]!.text).toContain(
      'You lack the knowledge to attempt this.',
    )
  })
})

describe('refusal prose teaches a path (T18)', () => {
  it('appends the hint only to an insufficient_skill verdict', () => {
    expect(refusalMemoryText('you have not the hands for it', 'insufficient_skill')).toBe(
      'You realize you cannot: you have not the hands for it — perhaps someone nearby knows the craft.',
    )
    expect(CRAFT_HINT).toBe(' — perhaps someone nearby knows the craft.')
  })

  // ★ One-way glass: the engine's registry names and param schemas must never enter a memory.
  it("★ never writes the engine's own words into a mind's memory", () => {
    for (const reason of [
      'unknown verb: dance',
      'no such agent',
      'walk needs a destination {x, y}',
      'enter needs a {structureId}',
      'eat needs an {itemId}',
    ]) {
      expect(refusalMemoryText(reason), reason).toBe(`You realize you cannot: ${OPAQUE_REFUSAL}`)
    }
  })

  it('★ and it is not vacuous: a world fact still reaches the mind in its own words', () => {
    for (const reason of [
      'collapsed and unable to act',
      'the dead do not act',
      'the roof is beyond mending',
      'you have not the hands for it',
      // The 31 param-shape refusals: the act exists, only the ask was malformed. They used to
      // be erased with the machinery, and five minds learned nothing from 36 of them.
      'a walk needs a place to end',
      'stowing needs the thing and the store to leave it in',
      'taking needs the thing to lift',
      'setting a thing down needs the thing named',
      'building needs the thing to raise, and the ground to raise it on',
    ]) {
      expect(refusalMemoryText(reason), reason).toBe(`You realize you cannot: ${reason}`)
    }
  })

  it('leaves every other refusal exactly as the world stated it', () => {
    for (const cls of [
      'physically_impossible',
      'beyond_adjacency',
      'insufficient_materials',
      undefined,
    ]) {
      expect(refusalMemoryText('no such craft exists under the sun', cls)).toBe(
        'You realize you cannot: no such craft exists under the sun',
      )
    }
  })

  it('is applied at prose time only — the reason it was given is unchanged', () => {
    const reason = 'you have not the hands for it'
    const prose = refusalMemoryText(reason, 'insufficient_skill')
    expect(prose.endsWith(CRAFT_HINT)).toBe(true)
    expect(prose.slice(0, -CRAFT_HINT.length)).toBe(`You realize you cannot: ${reason}`)
    expect(reason).toBe('you have not the hands for it')
  })
})

describe("a beat spent on one's own past", () => {
  const RECALL_TURN = {
    thought: 'I have stood here before.',
    recall: 'the storehouse',
    speech: 'I will say nothing.',
    action: { verb: 'walk', params: { x: 5, y: 6 } },
    journal: 'and write nothing either',
    importance: 6,
  }

  it('spends the whole beat: nothing else in that answer reaches the world', async () => {
    const { world, loop, runtime, agentDb } = await setup({
      model: turnModel([RECALL_TURN], RECALL_TURN),
      mindConfig: FAST_MIND,
    })
    await stepUntil(loop, () => runtime.stats().turns >= 2, 60)
    expect(spokeTexts(world.engineDb)).toEqual([])
    expect(startedVerbs(world.engineDb)).toEqual([])
    expect(journalRows(agentDb)).toEqual([])
    expect(memoriesOfKind(agentDb, 'thought').map((m) => m.text)).toContain(
      'I have stood here before.',
    )
    expect(alertKinds(agentDb)).toContain('recall_took_the_beat')
  })

  it("writes the miss as a recall, not as the turn's free ambient pass", async () => {
    const { loop, runtime, agentDb } = await setup({
      model: turnModel([RECALL_TURN], BENIGN_TURN),
      mindConfig: FAST_MIND,
    })
    await stepUntil(loop, () => runtime.stats().turns >= 2, 60)
    const modes = (
      agentDb.prepare('SELECT DISTINCT mode FROM recall_misses').all() as { mode: string }[]
    ).map((r) => r.mode)
    expect(modes).toContain('recall')
  })

  it('hands what came back to the next turn, once', async () => {
    const { model, prompts } = capturingModel([RECALL_TURN, BENIGN_TURN, BENIGN_TURN])
    const { loop, runtime } = await setup({ model, mindConfig: FAST_MIND })
    await stepUntil(loop, () => runtime.stats().turns >= 3, 90)
    expect(saidOn(prompts, 0)).not.toContain('You cast your mind back')
    expect(saidOn(prompts, 1)).toContain('You cast your mind back to the storehouse.')
    expect(saidOn(prompts, 2)).not.toContain('You cast your mind back')
  })

  it('reads its own book back, dated by the day the world counts', async () => {
    const { model, prompts } = capturingModel([
      { thought: 'Worth writing down.', journal: 'The roof held.', importance: 6 },
      BENIGN_TURN,
    ])
    const { loop, runtime } = await setup({
      model,
      mindConfig: { ...FAST_MIND, journalTicks: 0 },
    })
    await stepUntil(loop, () => runtime.stats().turns >= 2, 60)
    expect(prompts[0]!.map((m) => m.text).join('\n')).not.toContain('turn back the pages')
    expect(prompts[1]!.find((m) => m.role === 'user')!.text).toBe(
      'You turn back the pages of your own book:\nDay 1: The roof held.',
    )
  })
})

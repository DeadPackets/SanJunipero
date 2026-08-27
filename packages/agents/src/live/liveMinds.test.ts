// The dream rehearsal: a scripted provider, the real `LlmClient`, the real ops ledger. A row
// that passes with `dreamLlm` unwired proves nothing about the night.
import { describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { MockLanguageModelV4 } from 'ai/test'
import { EventStore, openDb } from '@sj/engine/store'
import {
  createWorldTick,
  fold,
  genesisState,
  RngStreams,
  TickLoop,
  type TickHandler,
  type TileId,
} from '@sj/engine'
import { SimConfigSchema } from '@sj/shared'
import { DREAM_PROMPT } from '../dream.js'
import { migrateLlmTables } from '../llm/callLog.js'
import { LlmClient } from '../llm/client.js'
import { openAgentDb } from '../memory/schema.js'
import type { PersonalityDoc } from '../personality.js'
import {
  autobiographyPrompt,
  extractFactsPrompt,
  proposeEditPrompt,
  summarizeDayPrompt,
  summarizeScenesPrompt,
  updateLedgerPrompt,
} from '../reflection.js'
import { EngineBridge } from '../runtime/bridge.js'
import { FakeEmbedder } from '../testutil/fakeEmbedder.js'
import { tamarIdentity } from '../testutil/fixtures.js'
import { bootMinds, type MindSpec } from './liveMinds.js'

const AGENT = 'tamar'
const DREAM_TEXT = 'the river ran uphill and nobody minded'

const ZERO_USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: undefined },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
}

const SLEEPING_TURN = {
  thought: 'Time to rest.',
  action: { verb: 'sleep', params: {} },
  importance: 5,
}

const doc: PersonalityDoc = {
  temperament: 'calm',
  values: ['loyalty'],
  beliefs: [],
  current: { mood: 'settled', worries: [], goals: [] },
}

// Keyed by the system prompt each caller actually sends, imported rather than re-typed: a
// prompt reworded in the source must not leave this rehearsal silently answering the wrong call.
const CANNED: { system: string; answer: unknown }[] = [
  { system: extractFactsPrompt([]).system, answer: { facts: [] } },
  { system: summarizeScenesPrompt([]).system, answer: { scenes: [] } },
  { system: summarizeDayPrompt([]).system, answer: { title: 'A day', text: 'It passed.' } },
  { system: updateLedgerPrompt('someone', null, []).system, answer: { doc: 'A person.' } },
  { system: autobiographyPrompt('', doc).system, answer: { paragraph: 'I lived a day.' } },
  { system: proposeEditPrompt('', doc, []).system, answer: { verdict: 'no_proposal' } },
  { system: DREAM_PROMPT, answer: { text: DREAM_TEXT, mood: 'unsettled' } },
]

function scriptedModel(): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: async (options) => {
      const parts = options.prompt as { role: string; content: unknown }[]
      const system = parts
        .filter((m) => m.role === 'system')
        .map((m) => (typeof m.content === 'string' ? m.content : ''))
        .join('\n')
      const hit = CANNED.find((c) => system.includes(c.system))
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(hit?.answer ?? SLEEPING_TURN) }],
        finishReason: { unified: 'stop' as const, raw: undefined },
        usage: ZERO_USAGE,
        warnings: [],
      }
    },
  })
}

function buildWorld() {
  const config = SimConfigSchema.parse({
    needs: { hungerDecayPerTick: 0.5 },
    structures: { sleepIndoorsOnly: false },
  })
  const terrain: TileId[][] = Array.from({ length: 24 }, () =>
    Array.from({ length: 24 }, (): TileId => 0),
  )
  const store = new EventStore(openDb(':memory:'))
  const rng = new RngStreams('live-minds-test')
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
  handler = bridge.wrapTickHandler(({ emit }) => {
    for (const e of worldTick(loop.state).events) emit(e.type, e.payload)
  })
  return { loop, bridge }
}

const SPEC: MindSpec = {
  id: AGENT,
  identity: tamarIdentity,
  personality: doc,
  ageDays: 30,
  sex: 'f',
}

async function bootOne(opts: { dreamBudgetUsd?: number } = {}) {
  const { loop, bridge } = buildWorld()
  const opsDb = openAgentDb(':memory:')
  migrateLlmTables(opsDb)
  const mindDb = openAgentDb(':memory:')
  const model = scriptedModel()
  const makeClient = (caller: string, agentId: string): LlmClient =>
    new LlmClient({
      model,
      db: opsDb,
      caller,
      agentId,
      maxRetries: 0,
      ...(caller === 'dream' && opts.dreamBudgetUsd !== undefined
        ? { budgetUsd: opts.dreamBudgetUsd }
        : {}),
    })
  const booted = bootMinds({
    minds: [SPEC],
    bridge,
    embedder: await FakeEmbedder.create(),
    dbFor: () => mindDb,
    turnLlm: (id) => makeClient('turn', id),
    reflectionLlm: (id) => makeClient('reflection', id),
    dreamLlm: (id) => makeClient('dream', id),
    mindConfig: {
      idleGapTicks: 0,
      boredomTicks: 1,
      dreamChance: 1,
      bodyAlarm: { hunger: 0, energy: 0, warmth: 0, thirst: 0, affliction: Infinity },
    },
  })
  return { loop, booted, opsDb, mindDb }
}

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

async function stepUntil(
  loop: { step: () => void },
  done: () => boolean,
  max = 400,
): Promise<void> {
  for (let i = 0; i < max && !done(); i += 1) {
    loop.step()
    await flush()
  }
}

const dreamRows = (db: Database.Database): { text: string }[] =>
  db.prepare("SELECT text FROM memories WHERE kind = 'dream'").all() as { text: string }[]

const daySummaries = (db: Database.Database): unknown[] =>
  db.prepare("SELECT id FROM summary_nodes WHERE level = 'day'").all()

const callersIn = (db: Database.Database): string[] =>
  (db.prepare('SELECT DISTINCT caller FROM llm_calls').all() as { caller: string }[]).map(
    (r) => r.caller,
  )

describe('★ a booted mind dreams, and the town pays for it through the one ledger', () => {
  it('the dream call is made, booked under "dream", and the memory row lands', async () => {
    const { loop, booted, opsDb, mindDb } = await bootOne()
    await stepUntil(loop, () => dreamRows(mindDb).length > 0)
    booted.stop()

    expect(dreamRows(mindDb).map((r) => r.text)).toEqual([DREAM_TEXT])
    expect(callersIn(opsDb)).toContain('dream')
  })

  it('a dream past its budget is refused before it spends, and the night still lands', async () => {
    const { loop, booted, opsDb, mindDb } = await bootOne({ dreamBudgetUsd: 0 })
    await stepUntil(loop, () => daySummaries(mindDb).length > 0)
    booted.stop()

    expect(daySummaries(mindDb).length).toBe(1)
    expect(dreamRows(mindDb)).toEqual([])
    expect(callersIn(opsDb)).not.toContain('dream')
  })
})

// A promise you made yesterday should colour how you meet someone at the well, not only how you
// talk once a scene has opened. The ordinary turn's "people here" line is where that lands.
import { describe, expect, it } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { EventStore, openDb } from '@sj/engine/store'
import { fold, genesisState, RngStreams, TickLoop } from '@sj/engine'
import { NO_PARAMS, SimConfigSchema, type SimConfig, type TileId } from '@sj/shared'
import { LlmClient, migrateLlmTables } from '@sj/llm'
import { FakeEmbedder } from '@sj/llm/testutil'
import { EngineBridge } from './bridge.js'
import { AgentRuntime } from './agentRuntime.js'
import { openAgentDb } from '../memory/schema.js'
import { TieStore } from '../memory/ties.js'
import { PersonalityStore, type PersonalityDoc } from '../personality.js'
import type { TieKind } from '../scene/scene.js'
import { tamarIdentity } from '../testutil/fixtures.js'
import type { MindConfig } from '../wake.js'

const TAMAR = 'tamar'
const YUSUF = 'yusuf'
const AWAY = 'nadia'
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
const WAIT = {
  thought: 'I stand here.',
  plan: null,
  journal: null,
  recall: null,
  mood: null,
  reconsider_at: null,
  speech: null,
  action: { verb: 'wait', params: NO_PARAMS },
  importance: 3,
}

function config(): SimConfig {
  return SimConfigSchema.parse({
    needs: { hungerDecayPerTick: 0 },
    structures: { sleepIndoorsOnly: false },
    warmth: { enabled: false },
  })
}

const doc = (): PersonalityDoc => ({
  temperament: 'calm',
  values: ['loyalty'],
  beliefs: [],
  current: { mood: 'settled', worries: [], goals: [] },
})

function capturing(): { model: MockLanguageModelV4; prompts: string[] } {
  const prompts: string[] = []
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      prompts.push(
        (options.prompt as { role: string; content: unknown }[])
          .map((m) =>
            Array.isArray(m.content)
              ? (m.content as { text?: string }[]).map((p) => p.text ?? '').join('')
              : String(m.content),
          )
          .join('\n'),
      )
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(WAIT) }],
        finishReason: { unified: 'stop' as const, raw: undefined },
        usage: ZERO_USAGE,
        warnings: [],
      }
    },
  })
  return { model, prompts }
}

const CAST = [
  { id: TAMAR, name: 'Tamar' },
  { id: YUSUF, name: 'Yusuf' },
  { id: AWAY, name: 'Nadia' },
]

async function oneTurn(held: readonly { personId: string; kind: TieKind; text: string }[]) {
  const cfg = config()
  const terrain: TileId[][] = Array.from({ length: 24 }, () =>
    Array.from({ length: 24 }, (): TileId => 0),
  )
  const store = new EventStore(openDb(':memory:'))
  let state = genesisState(cfg, terrain)
  const seed = (type: string, payload: unknown): void => {
    state = fold(state, store.append(state.tick, type, payload), cfg)
  }
  // Two bodies side by side, and one far enough off that nothing about her is in sight.
  seed('agent_spawned', { id: TAMAR, name: 'Tamar', x: 3, y: 3, ageDays: 30 })
  seed('agent_spawned', { id: YUSUF, name: 'Yusuf', x: 4, y: 3, ageDays: 30 })
  seed('agent_spawned', { id: AWAY, name: 'Nadia', x: 22, y: 22, ageDays: 30 })

  const loop = new TickLoop({
    store,
    state,
    rng: new RngStreams('turn-ties'),
    config: cfg,
    startTick: NOON,
    onTick: (ctx) => {
      handler(ctx)
    },
  })
  const bridge = new EngineBridge({ loop, store, simConfig: cfg })
  const handler = bridge.wrapTickHandler(() => {})

  const db = openAgentDb(':memory:')
  migrateLlmTables(db)
  const personality = new PersonalityStore(db, TAMAR)
  personality.init(doc(), 0)
  const ties = new TieStore(db, TAMAR)
  ties.apply(
    held.map((h) => ({ agentId: TAMAR, ...h })),
    NOON - 10,
  )

  const { model, prompts } = capturing()
  const runtime = new AgentRuntime({
    db,
    llm: new LlmClient({ model, db, caller: 'turn', agentId: TAMAR, maxRetries: 0 }),
    embedder: await FakeEmbedder.create(),
    identity: { ...tamarIdentity, name: 'Tamar' },
    personality,
    bridge,
    config: FAST,
    ties: { store: ties, cast: () => CAST },
  })
  runtime.start(TAMAR)
  for (let i = 0; i < 40 && prompts.length === 0; i += 1) {
    loop.step()
    await new Promise((r) => setImmediate(r))
  }
  runtime.stop()
  return prompts[0] ?? ''
}

describe('the ordinary turn knows what a mind is owed', () => {
  it('shows a tie about the person standing there', async () => {
    const said = await oneTurn([
      { personId: YUSUF, kind: 'promise', text: 'bring back the long rope' },
    ])
    expect(said).toContain('Yusuf: Between you: a promise: bring back the long rope.')
  })

  it('says nothing about a tie whose person is nowhere in sight', async () => {
    const said = await oneTurn([
      { personId: AWAY, kind: 'grudge', text: 'she took the last of the bread' },
    ])
    expect(said).not.toContain('she took the last of the bread')
    expect(said).not.toContain('Nadia: Between you')
  })

  it('holds two ties a person and no more, on the turn that pays full price', async () => {
    const said = await oneTurn([
      { personId: YUSUF, kind: 'promise', text: 'bring back the long rope' },
      { personId: YUSUF, kind: 'debt', text: 'two days of his work on your roof' },
      { personId: YUSUF, kind: 'slight', text: 'he named you a poor neighbour' },
    ])
    expect(said).toContain('a promise: bring back the long rope; a debt: two days of his work')
    expect(said).not.toContain('poor neighbour')
  })

  it('leaves a mind with no ties the prompt it always had', async () => {
    expect(await oneTurn([])).not.toContain('Between you:')
  })
})

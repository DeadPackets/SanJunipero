import { describe, expect, it } from 'vitest'
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
  type WorldState,
} from '@sj/engine'
import { MINUTES_PER_DAY, NO_PARAMS, SimConfigSchema } from '@sj/shared'
import { LlmClient, migrateLlmTables } from '@sj/llm'
import { FakeEmbedder } from '@sj/llm/testutil'
import { openAgentDb } from '../memory/schema.js'
import { PersonalityStore, type PersonalityDoc } from '../personality.js'
import { WantStore, type WantOccasion } from '../memory/wants.js'
import { tamarIdentity } from '../testutil/fixtures.js'
import { AgentRuntime } from './agentRuntime.js'
import { EngineBridge } from './bridge.js'

const AGENT = 'tamar'
const OTHER = 'amara'
const DAY = MINUTES_PER_DAY
const NOON = 12 * 60

const ZERO_USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: undefined },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
}

const doc: PersonalityDoc = {
  temperament: 'calm',
  values: ['loyalty'],
  beliefs: [],
  current: { mood: 'settled', worries: [], goals: [] },
}

const WAIT = { thought: 'I rest.', importance: 1 }

// Everything the contract feeds except esteem, so a mind fed all of these wants to be useful.
const NOT_ESTEEM: WantOccasion[] = [
  'scene',
  'partnered',
  'new_place',
  'slight',
  'law_broken',
  'child',
]

type Put = (tick: number, type: string, payload: unknown) => void

const hearth = (put: Put, id: string, x: number, y: number): void => {
  put(0, 'structure_planned', {
    id,
    kind: 'fire_pit',
    x,
    y,
    w: 1,
    h: 1,
    maxHp: 20,
    flammable: true,
    builderId: AGENT,
  })
  put(0, 'structure_completed', { id })
}

function world(before: (put: Put) => void = () => {}) {
  const config = SimConfigSchema.parse({
    needs: { hungerDecayPerTick: 0, energyDecayAwakePerTick: 0 },
    structures: { sleepIndoorsOnly: false },
    warmth: { enabled: false },
  })
  const terrain: TileId[][] = Array.from({ length: 24 }, () =>
    Array.from({ length: 24 }, (): TileId => 0),
  )
  const store = new EventStore(openDb(':memory:'))
  let state: WorldState = genesisState(config, terrain)
  const put: Put = (tick, type, payload) => {
    state = fold(state, store.append(tick, type, payload), config)
  }
  put(0, 'agent_spawned', { id: AGENT, name: 'Tamar', x: 3, y: 3, ageDays: 9000 })
  put(0, 'agent_spawned', { id: OTHER, name: 'Amara', x: 4, y: 3, ageDays: 9000 })
  before(put)
  return { config, store, state: () => state }
}

function bridgeOver(before: (put: Put) => void = () => {}): EngineBridge {
  const built = world(before)
  let handler: TickHandler = () => {}
  const loop = new TickLoop({
    store: built.store,
    state: built.state(),
    startTick: built.state().tick,
    rng: new RngStreams('town-stock'),
    config: built.config,
    onTick: (ctx) => {
      handler(ctx)
    },
  })
  const bridge = new EngineBridge({ loop, store: built.store, simConfig: built.config })
  handler = bridge.wrapTickHandler(() => {})
  return bridge
}

/** A mind that wakes on the morning of `day` and answers wait to everything. */
async function mind(opts: { before?: (put: Put) => void; fedButEsteem?: boolean }) {
  const built = world((put) => {
    // Abed at the hour the world starts: the morning cue is what a body RISING is told.
    put(0, 'agent_slept', { agentId: AGENT })
    opts.before?.(put)
  })
  const startTick = DAY + NOON
  const rng = new RngStreams('town-stock-mind')
  const worldTick = createWorldTick(built.config, rng)
  let handler: TickHandler = () => {}
  const loop = new TickLoop({
    store: built.store,
    state: { ...built.state(), tick: startTick },
    startTick,
    rng,
    config: built.config,
    snapshotEveryTicks: 1_000_000,
    onTick: (ctx) => {
      handler(ctx)
    },
  })
  const bridge = new EngineBridge({ loop, store: built.store, simConfig: built.config })
  handler = bridge.wrapTickHandler(({ emit }) => {
    for (const e of worldTick(loop.state).events) emit(e.type, e.payload)
  })

  const db = openAgentDb(':memory:')
  migrateLlmTables(db)
  const personality = new PersonalityStore(db, AGENT)
  personality.init(doc, 0)
  const wants = new WantStore(db, AGENT)
  wants.begin(0)
  if (opts.fedButEsteem === true) wants.feed(NOT_ESTEEM, startTick)

  const prompts: string[] = []
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      prompts.push(
        (options.prompt as { role: string; content: unknown }[])
          .filter((m) => m.role === 'user')
          .map((m) =>
            Array.isArray(m.content)
              ? (m.content as { text?: string }[]).map((p) => p.text ?? '').join('')
              : String(m.content),
          )
          .join('\n'),
      )
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              speech: null,
              plan: null,
              journal: null,
              recall: null,
              reconsider_at: null,
              ...WAIT,
              action: { verb: 'wait', params: NO_PARAMS },
            }),
          },
        ],
        finishReason: { unified: 'stop' as const, raw: undefined },
        usage: ZERO_USAGE,
        warnings: [],
      }
    },
  })
  const runtime = new AgentRuntime({
    db,
    llm: new LlmClient({ model, db, caller: 'turn', agentId: AGENT, maxRetries: 0 }),
    embedder: await FakeEmbedder.create(),
    identity: tamarIdentity,
    personality,
    bridge,
    config: {
      idleGapTicks: 0,
      boredomTicks: 1,
      bodyAlarm: { hunger: 0, energy: 0, warmth: 0, thirst: 0, affliction: Infinity },
    },
  })
  runtime.start(AGENT)
  for (let n = 0; n < 12 && prompts.length === 0; n += 1) {
    loop.step()
    await new Promise((r) => setImmediate(r))
  }
  // Enough turns past the first that the boredom wake has had its say.
  for (let n = 0; n < 40 && prompts.length < 2; n += 1) {
    loop.step()
    await new Promise((r) => setImmediate(r))
  }
  return {
    morning: prompts[0] ?? '',
    later: prompts.slice(1).join('\n'),
    stop: () => {
      runtime.stop()
      db.close()
    },
  }
}

describe('★ what the whole valley is holding', () => {
  it('counts nothing in an empty town but the mouths', () => {
    expect(bridgeOver().townStock()).toEqual({ wood: 0, food: 0, hearths: 0, mouths: 2 })
  })

  it('adds up the wood and the food on the shelves and the ground, and leaves hands out', () => {
    const stock = bridgeOver((put) => {
      put(0, 'structure_planned', {
        id: 'shed_1',
        kind: 'storehouse',
        x: 8,
        y: 8,
        w: 1,
        h: 1,
        maxHp: 20,
        flammable: true,
        builderId: AGENT,
      })
      put(0, 'structure_completed', { id: 'shed_1' })
      put(0, 'item_spawned', {
        id: 'logs',
        kind: 'wood',
        qty: 4,
        loc: { t: 'structure', id: 'shed_1' },
      })
      put(0, 'item_spawned', { id: 'log', kind: 'wood', qty: 1, loc: { t: 'tile', x: 6, y: 6 } })
      put(0, 'item_spawned', { id: 'armful', kind: 'wood', qty: 9, loc: { t: 'agent', id: AGENT } })
      put(0, 'item_spawned', {
        id: 'loaf',
        kind: 'bread',
        qty: 2,
        loc: { t: 'structure', id: 'shed_1' },
      })
      put(0, 'item_spawned', { id: 'catch', kind: 'fish', qty: 3, loc: { t: 'tile', x: 7, y: 7 } })
      put(0, 'item_spawned', { id: 'supper', kind: 'stew', qty: 1, loc: { t: 'agent', id: OTHER } })
      put(0, 'item_spawned', { id: 'board', kind: 'plank', qty: 6, loc: { t: 'tile', x: 5, y: 5 } })
    }).townStock()
    expect(stock.wood).toBe(5)
    expect(stock.food).toBe(5)
  })

  it('counts a hearth only where the walls are up and the kind holds a fire', () => {
    const stock = bridgeOver((put) => {
      hearth(put, 'fire_1', 8, 8)
      hearth(put, 'fire_2', 9, 9)
      put(0, 'structure_planned', {
        id: 'fire_3',
        kind: 'fire_pit',
        x: 10,
        y: 10,
        w: 1,
        h: 1,
        maxHp: 20,
        flammable: true,
        builderId: AGENT,
      })
      put(0, 'structure_planned', {
        id: 'well_1',
        kind: 'well',
        x: 11,
        y: 11,
        w: 1,
        h: 1,
        maxHp: 20,
        flammable: false,
        builderId: AGENT,
      })
      put(0, 'structure_completed', { id: 'well_1' })
    }).townStock()
    expect(stock.hearths).toBe(2)
  })

  it('takes neither the dead nor the departed for a mouth', () => {
    expect(
      bridgeOver((put) => {
        put(DAY, 'agent_departed', { agentId: OTHER })
      }).townStock().mouths,
    ).toBe(1)
    expect(
      bridgeOver((put) => {
        put(DAY, 'agent_died', { agentId: OTHER, cause: 'age' })
      }).townStock().mouths,
    ).toBe(1)
  })
})

describe('★ the short town in a mind’s morning', () => {
  it('tells every mind the numbers, and only on the morning', async () => {
    const t = await mind({
      before: (put) => {
        hearth(put, 'fire_1', 8, 8)
      },
    })
    try {
      expect(t.morning).toContain('The town has 0 logs for 1 hearth and 0 meals for 2 mouths.')
      // A turn that never came would pass the next row saying nothing at all.
      expect(t.later.length).toBeGreaterThan(0)
      expect(t.later).not.toContain('The town has')
    } finally {
      t.stop()
    }
  })

  it('says nothing at all while the shelves hold', async () => {
    const t = await mind({
      before: (put) => {
        hearth(put, 'fire_1', 8, 8)
        put(0, 'item_spawned', { id: 'logs', kind: 'wood', qty: 4, loc: { t: 'tile', x: 6, y: 6 } })
        put(0, 'item_spawned', {
          id: 'loaf',
          kind: 'bread',
          qty: 4,
          loc: { t: 'tile', x: 7, y: 7 },
        })
      },
    })
    try {
      expect(t.morning).not.toContain('The town has')
    } finally {
      t.stop()
    }
  })

  it('gives the mind that wants to be counted on a road, on the morning and when bored', async () => {
    const t = await mind({
      fedButEsteem: true,
      before: (put) => {
        hearth(put, 'fire_1', 8, 8)
      },
    })
    try {
      expect(t.morning).toContain('Today the thing you want most is to be counted on.')
      // The numbers ride inside that line, so nobody reads them twice in one breath.
      expect(t.morning).toContain('The town has')
      expect(t.morning.split('The town has').length - 1).toBe(1)
      expect(t.morning).not.toContain('Today the thing you want most is esteem')
      expect(t.later).toContain('Today the thing you want most is to be counted on.')
    } finally {
      t.stop()
    }
  })
})

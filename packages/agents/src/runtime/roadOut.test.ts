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
import { WantStore } from '../memory/wants.js'
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

type Put = (tick: number, type: string, payload: unknown) => void

async function mind(opts: {
  /** The morning this mind wakes on. */
  day: number
  /** The log written before the loop opens over it. */
  before?: (put: Put) => void
  /** What the mind answers, in order. */
  answers?: unknown[]
  /** The tick the wants were last fed on. Absent, they are fed the moment the mind starts. */
  fedAt?: number
}) {
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
  // Abed at the hour the world starts: the morning cue is what a body RISING is told, and an
  // awake body in daylight has already had its morning.
  put(0, 'agent_slept', { agentId: AGENT })
  opts.before?.(put)
  const startTick = opts.day * DAY + NOON

  const rng = new RngStreams('road-out')
  const worldTick = createWorldTick(config, rng)
  let handler: TickHandler = () => {}
  const loop = new TickLoop({
    store,
    state: { ...state, tick: startTick },
    startTick,
    rng,
    config,
    snapshotEveryTicks: 1_000_000,
    onTick: (ctx) => {
      handler(ctx)
    },
  })
  const bridge = new EngineBridge({ loop, store, simConfig: config })
  handler = bridge.wrapTickHandler(({ emit }) => {
    for (const e of worldTick(loop.state).events) emit(e.type, e.payload)
  })

  const db = openAgentDb(':memory:')
  migrateLlmTables(db)
  const personality = new PersonalityStore(db, AGENT)
  personality.init(doc, 0)
  // Written before the runtime opens its own store, which only ever fills the gaps.
  new WantStore(db, AGENT).begin(opts.fedAt ?? startTick)

  const prompts: string[] = []
  const answers = opts.answers ?? [WAIT]
  let i = 0
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
      const raw = (answers[Math.min(i, answers.length - 1)] ?? WAIT) as Record<string, unknown>
      i += 1
      const action = raw.action as { verb: string; params?: object } | undefined
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              speech: null,
              plan: null,
              journal: null,
              recall: null,
              mood: null,
              reconsider_at: null,
              ...raw,
              action:
                action === undefined
                  ? { verb: 'wait', params: NO_PARAMS }
                  : { verb: action.verb, params: { ...NO_PARAMS, ...action.params } },
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
  for (let n = 0; n < 20; n += 1) await new Promise((r) => setImmediate(r))
  return {
    prompts,
    said: prompts[0] ?? '',
    alerts: (): { kind: string; detail: string }[] =>
      db.prepare('SELECT kind, detail FROM alerts ORDER BY id').all() as {
        kind: string
        detail: string
      }[],
    stop: () => {
      runtime.stop()
      db.close()
    },
    settle: async (steps = 4) => {
      for (let n = 0; n < steps; n += 1) {
        loop.step()
        await new Promise((r) => setImmediate(r))
      }
    },
    db: db,
  }
}

const partedAndGone = (put: Put, tick: number): void => {
  put(0, 'partnership_formed', { aId: AGENT, bId: OTHER })
  put(tick, 'partnership_dissolved', { aId: AGENT, bId: OTHER, byId: OTHER })
  put(tick, 'agent_departed', { agentId: OTHER })
}

const breach = (put: Put, tick: number, n: number): void => {
  for (let i = 0; i < n; i += 1) {
    put(tick, 'law_broken', {
      lawId: 'law_1',
      agentId: AGENT,
      verb: 'take',
      witnesses: [OTHER],
    })
  }
}

describe('★ the road out is offered only where something stands behind it', () => {
  it('says nothing to a mind whose life is going along', async () => {
    const t = await mind({ day: 1 })
    try {
      expect(t.said).not.toContain('leave_town')
    } finally {
      t.stop()
    }
  })

  it('says it to a mind that has had nobody’s company for six days', async () => {
    const t = await mind({ day: 6, fedAt: 0 })
    try {
      expect(t.said).toContain('days now without anybody')
      expect(t.said).toContain('name it leave_town')
    } finally {
      t.stop()
    }
  })

  it('does not say it at five', async () => {
    const t = await mind({ day: 5, fedAt: 0 })
    try {
      expect(t.said).not.toContain('days now without anybody')
    } finally {
      t.stop()
    }
  })

  it('names the partner who took it first, inside seven days and not past them', async () => {
    const near = await mind({
      day: 3,
      before: (put) => {
        partedAndGone(put, 2 * DAY)
      },
    })
    try {
      expect(near.said).toContain('Amara left down the valley road')
    } finally {
      near.stop()
    }
    const far = await mind({
      day: 9,
      before: (put) => {
        partedAndGone(put, DAY)
      },
    })
    try {
      expect(far.said).not.toContain('Amara left down the valley road')
    } finally {
      far.stop()
    }
  })

  it('says it after three breaches the town watched, and not after two', async () => {
    const three = await mind({
      day: 2,
      before: (put) => {
        breach(put, DAY, 3)
      },
    })
    try {
      expect(three.said).toContain('times now the town has seen you break')
    } finally {
      three.stop()
    }
    const two = await mind({
      day: 2,
      before: (put) => {
        breach(put, DAY, 2)
      },
    })
    try {
      expect(two.said).not.toContain('times now the town has seen you break')
    } finally {
      two.stop()
    }
  })
})

describe('★ a leaving nobody can name a reason for', () => {
  const LEAVING = { thought: 'Enough.', importance: 8, action: { verb: 'leave_town' } }

  it('is written down, and never refused', async () => {
    const t = await mind({ day: 1, answers: [LEAVING] })
    try {
      await t.settle()
      expect(t.alerts().map((a) => a.kind)).toContain('departure_without_cause')
    } finally {
      t.stop()
    }
  })

  it('is not written down when the road was offered', async () => {
    const t = await mind({ day: 6, fedAt: 0, answers: [LEAVING] })
    try {
      await t.settle()
      expect(t.alerts().map((a) => a.kind)).not.toContain('departure_without_cause')
    } finally {
      t.stop()
    }
  })
})

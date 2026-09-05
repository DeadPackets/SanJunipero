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
import { SimConfigSchema, stateHash } from '@sj/shared'
import { DREAM_PROMPT } from '../dream.js'
import { migrateLlmTables, LlmClient } from '@sj/llm'
import { FakeEmbedder } from '@sj/llm/testutil'
import { openAgentDb } from '../memory/schema.js'
import type { PersonalityDoc } from '../personality.js'
import {
  autobiographyPrompt,
  extractFactsPrompt,
  listTiesPrompt,
  proposeEditPrompt,
  summarizeDayPrompt,
  summarizeScenesPrompt,
  updateLedgerPrompt,
} from '../reflection.js'
import { EngineBridge } from '../runtime/bridge.js'
import { TieStore } from '../memory/ties.js'
import { tamarIdentity } from '../testutil/fixtures.js'
import { FOUNDER_MINDS } from './founderMinds.js'
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

// The two night dumps share one system line so the day caches between them; what tells them
// apart is the instruction that follows it.
const instruction = (p: { messages: { content: string }[] }): string => p.messages[1]!.content

// Keyed by bytes each caller actually sends, imported rather than re-typed: a prompt reworded
// in the source must not leave this rehearsal silently answering the wrong call.
const CANNED: { key: string; answer: unknown }[] = [
  { key: instruction(extractFactsPrompt([])), answer: { facts: [] } },
  { key: instruction(summarizeScenesPrompt([])), answer: { scenes: [] } },
  { key: summarizeDayPrompt([]).system, answer: { title: 'A day', text: 'It passed.' } },
  { key: updateLedgerPrompt('someone', null, []).system, answer: { doc: 'A person.' } },
  // Its last line names the roll, which the living cast decides, so the key is its opening line.
  { key: instruction(listTiesPrompt([], [])).split('\n')[0]!, answer: { ties: [] } },
  { key: autobiographyPrompt('', doc).system, answer: { paragraph: 'I lived a day.' } },
  { key: proposeEditPrompt('', doc, []).system, answer: { verdict: 'no_proposal' } },
  { key: DREAM_PROMPT, answer: { text: DREAM_TEXT, mood: 'unsettled' } },
]

function scriptedModel(): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: async (options) => {
      const parts = options.prompt as { role: string; content: unknown }[]
      // A key is either the system line or the instruction the dump is followed by, so the
      // day itself never has to be searched.
      const sent = [parts[0], parts.at(-1)]
        .filter((m) => m !== undefined)
        .map((m) =>
          typeof m.content === 'string'
            ? m.content
            : (m.content as { text?: string }[]).map((c) => c.text ?? '').join('\n'),
        )
        .join('\n')
      const hit = CANNED.find((c) => sent.includes(c.key))
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(hit?.answer ?? SLEEPING_TURN) }],
        finishReason: { unified: 'stop' as const, raw: undefined },
        usage: ZERO_USAGE,
        warnings: [],
      }
    },
  })
}

// Dusk of day 0. A world booted in the pre-dawn is in night -1, which nobody lived and no mind
// reflects over, so the night these rows are about would never come.
const DUSK_DAY_0 = 1200

type Body = { id: string; name: string }
const ONE_BODY: Body[] = [{ id: AGENT, name: 'Tamar' }]

function buildWorld(startTick = DUSK_DAY_0, bodies: readonly Body[] = ONE_BODY) {
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
  bodies.forEach((b, i) => {
    state = fold(
      state,
      store.append(state.tick, 'agent_spawned', {
        id: b.id,
        name: b.name,
        x: 3 + i,
        y: 3,
        ageDays: 30,
      }),
      config,
    )
  })
  const worldTick = createWorldTick(config, rng)
  let handler: TickHandler = () => {}
  const loop = new TickLoop({
    store,
    state,
    rng,
    config,
    startTick,
    onTick: (ctx) => {
      handler(ctx)
    },
  })
  const bridge = new EngineBridge({ loop, store, simConfig: config })
  handler = bridge.wrapTickHandler(({ emit }) => {
    for (const e of worldTick(loop.state).events) emit(e.type, e.payload)
  })
  return { loop, bridge, store, config, terrain }
}

const SPEC: MindSpec = {
  id: AGENT,
  identity: tamarIdentity,
  personality: doc,
  ageDays: 30,
  sex: 'f',
}

async function bootOne(
  opts: {
    dreamBudgetUsd?: number
    startTick?: number
    minds?: readonly MindSpec[]
    bodies?: readonly Body[]
  } = {},
) {
  const { loop, bridge, store, config, terrain } = buildWorld(opts.startTick, opts.bodies)
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
    minds: opts.minds ?? [SPEC],
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
  return { loop, booted, bridge, opsDb, mindDb, store, config, terrain }
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

const tieRows = (db: Database.Database, agentId: string): { person_id: string; kind: string }[] =>
  db
    .prepare('SELECT person_id, kind FROM ties WHERE agent_id = ? ORDER BY person_id')
    .all(agentId) as { person_id: string; kind: string }[]

describe('★ kin are ties from the first tick', () => {
  it('every founder written with kin boots holding them, and nobody else holds any', async () => {
    const kinned = FOUNDER_MINDS.filter((m) => m.kin !== undefined && m.kin.length > 0)
    expect(kinned.length, 'Task 4 wrote kin into the founding cast').toBeGreaterThan(0)
    const { booted, mindDb } = await bootOne({ minds: FOUNDER_MINDS })
    booted.stop()

    for (const mind of kinned) {
      expect(tieRows(mindDb, mind.id), `${mind.id} boots without their kin`).toEqual(
        [...mind.kin!]
          .map((k) => ({ person_id: k.id, kind: 'kin' }))
          .sort((a, b) => a.person_id.localeCompare(b.person_id)),
      )
    }
    for (const mind of FOUNDER_MINDS.filter((m) => !kinned.includes(m))) {
      expect(tieRows(mindDb, mind.id), `${mind.id} was given kin nobody wrote`).toEqual([])
    }
  })
})

// Dusk of day 7: the first night a tie opened on the founding tick is older than its clock.
const DUSK_DAY_7 = 7 * 1440 + 1200

describe('★ a tie nobody has touched for seven sim-days is let go', () => {
  const letGoRows = (db: Database.Database): { text: string }[] =>
    db.prepare("SELECT text FROM memories WHERE text LIKE 'You have let go%'").all() as {
      text: string
    }[]

  it('closes on the night it ages out, and the mind remembers letting it go', async () => {
    const { loop, booted, mindDb } = await bootOne({ startTick: DUSK_DAY_7 })
    const ties = new TieStore(mindDb, AGENT)
    ties.apply(
      [
        { agentId: AGENT, personId: 'nadia', kind: 'grudge', text: 'She took the last loaf.' },
        { agentId: AGENT, personId: 'omar', kind: 'promise', text: 'A day on the well gate.' },
      ],
      0,
    )
    ties.apply(
      [{ agentId: AGENT, personId: 'omar', kind: 'debt', text: 'Two planks.' }],
      DUSK_DAY_7,
    )
    await stepUntil(loop, () => letGoRows(mindDb).length >= 2, 600)
    booted.stop()

    // Only Tamar has a body in this world, so the other two are named by the id the tie carries.
    expect(
      letGoRows(mindDb)
        .map((r) => r.text)
        .sort(),
    ).toEqual([
      'You have let go of what stood between you and nadia: She took the last loaf.',
      'You have let go of what stood between you and omar: A day on the well gate.',
    ])
    expect(
      ties.open().map((t) => t.kind),
      'today’s debt is not stale',
    ).toEqual(['debt'])
  })

  // A close can say a promise was kept; only this can say broken. The world witnesses it and
  // folds it to nothing, so the log it lands in still replays to the state it always reached.
  it('announces the lapse to the world, and the log still replays byte for byte', async () => {
    const h = await bootOne({ startTick: DUSK_DAY_7 })
    const ties = new TieStore(h.mindDb, AGENT)
    ties.apply(
      [
        { agentId: AGENT, personId: 'nadia', kind: 'grudge', text: 'She took the last loaf.' },
        { agentId: AGENT, personId: 'omar', kind: 'promise', text: 'A day on the well gate.' },
      ],
      0,
    )
    // An announcement rides the NEXT tick, so the log is what this waits on, not the memory row.
    await stepUntil(h.loop, () => h.store.readTypeFrom(0, 'tie_let_go').length >= 2, 600)
    h.booted.stop()

    const log = h.store.readFrom(0)
    const said = log
      .filter((e) => e.type === 'tie_let_go')
      .map((e) => e.payload as { agentId: string; personId: string; kind: string })
    expect(said.map((p) => `${p.personId}:${p.kind}`).sort()).toEqual([
      'nadia:grudge',
      'omar:promise',
    ])
    expect(new Set(said.map((p) => p.agentId))).toEqual(new Set([AGENT]))

    // The whole log, from genesis, through the fold that has to know the type.
    const replayed = log.reduce((s, e) => fold(s, e, h.config), genesisState(h.config, h.terrain))
    expect(replayed.tick).toBe(h.loop.state.tick)
    expect(stateHash(replayed)).toBe(stateHash(h.loop.state))
  })
})

const SCENE_TURN = {
  thought: 'Say it plainly.',
  speech: 'The well gate holds.',
  to: null,
  gesture: null,
  move: 'none',
  stance: null,
  answer: null,
  ask: null,
  leave: false,
  importance: 4,
}

describe('a town that is closing waits on the talk it is paying for', () => {
  it('holds `busy` from the ask until the line comes back', async () => {
    const { bridge } = buildWorld()
    const opsDb = openAgentDb(':memory:')
    migrateLlmTables(opsDb)
    const mindDb = openAgentDb(':memory:')
    let release = (): void => {}
    const held = new Promise<void>((r) => {
      release = r
    })
    const slow = new MockLanguageModelV4({
      doGenerate: async () => {
        await held
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(SCENE_TURN) }],
          finishReason: { unified: 'stop' as const, raw: undefined },
          usage: ZERO_USAGE,
          warnings: [],
        }
      },
    })
    const client = (model: MockLanguageModelV4, caller: string, agentId: string): LlmClient =>
      new LlmClient({ model, db: opsDb, caller, agentId, maxRetries: 0 })
    const booted = bootMinds({
      minds: [SPEC],
      bridge,
      embedder: await FakeEmbedder.create(),
      dbFor: () => mindDb,
      turnLlm: (id) => client(scriptedModel(), 'turn', id),
      sceneClient: (id) => client(slow, 'scene.line', id),
    })

    expect(booted.busy()).toBe(false)
    booted.scenes!.adopt({
      id: 'scene_1200_feedface',
      kind: 'talk',
      openedTick: DUSK_DAY_0,
      lastLineTick: DUSK_DAY_0,
      participants: [AGENT],
      audience: [],
      anchor: AGENT,
      floor: AGENT,
      thread: [],
      topic: null,
      stakes: 1,
      passes: 0,
      timeouts: 0,
      closedTick: null,
    })
    const line = booted.scenes!.takeFloor(AGENT, DUSK_DAY_0 + 1)
    await flush()
    expect(booted.busy()).toBe(true)

    release()
    await line
    expect(booted.busy()).toBe(false)
    booted.stop()
  })
})

describe('★ founders written as partners are partners in the world too', () => {
  const PAIR: MindSpec[] = [
    {
      ...SPEC,
      id: 'amina',
      identity: { ...tamarIdentity, name: 'Amina' },
      kin: [{ id: 'bilal', relation: 'partner' }],
    },
    {
      ...SPEC,
      id: 'bilal',
      identity: { ...tamarIdentity, name: 'Bilal' },
      sex: 'm',
      kin: [{ id: 'amina', relation: 'partner' }],
    },
  ]
  const BODIES: Body[] = [
    { id: 'amina', name: 'Amina' },
    { id: 'bilal', name: 'Bilal' },
  ]
  const formed = (store: EventStore): unknown[] =>
    store.readFrom(0).filter((e) => e.type === 'partnership_formed')

  it('announces the partnership once, from the lower mark alone', async () => {
    const { loop, booted, bridge, store } = await bootOne({ minds: PAIR, bodies: BODIES })
    loop.step()
    booted.stop()

    expect(formed(store), 'one event, not one per half').toHaveLength(1)
    expect(bridge.partnerOf('amina')).toBe('bilal')
    expect(bridge.partnerOf('bilal')).toBe('amina')
  })

  it('announces nothing on a second boot against the same world', async () => {
    const { loop, booted, bridge, store, opsDb, mindDb } = await bootOne({
      minds: PAIR,
      bodies: BODIES,
    })
    loop.step()
    booted.stop()
    void opsDb
    void mindDb

    const again = bootMinds({
      minds: PAIR,
      bridge,
      embedder: await FakeEmbedder.create(),
      dbFor: () => openAgentDb(':memory:'),
      turnLlm: (id) => {
        const db = openAgentDb(':memory:')
        migrateLlmTables(db)
        return new LlmClient({
          model: scriptedModel(),
          db,
          caller: 'turn',
          agentId: id,
          maxRetries: 0,
        })
      },
    })
    loop.step()
    again.stop()
    expect(formed(store), 'the world already knew').toHaveLength(1)
  })
})

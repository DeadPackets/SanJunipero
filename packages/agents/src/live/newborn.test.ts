// The birth rehearsal: a real world log, a real cast, a scripted provider, and the child's own
// database on disk. A row that passes without `wireBirths` proves nothing about the cast growing.
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { MockLanguageModelV4 } from 'ai/test'
import { EventStore, openDb } from '@sj/engine/store'
import { fold, genesisState, RngStreams, TickLoop, type TickHandler, type TileId } from '@sj/engine'
import { MINUTES_PER_DAY, SimConfigSchema } from '@sj/shared'
import { migrateLlmTables, LlmClient } from '@sj/llm'
import { FakeEmbedder } from '@sj/llm/testutil'
import { openAgentDb } from '../memory/schema.js'
import type { PersonalityDoc } from '../personality.js'
import { EngineBridge } from '../runtime/bridge.js'
import { tamarIdentity } from '../testutil/fixtures.js'
import { bootMinds, type MindSpec } from './liveMinds.js'
import { ensureChildren, needsHousehold } from './ensureChild.js'
import { resolveCast } from './resolveCast.js'
import { wireBirths } from './newborn.js'

const MOTHER = 'amara'
const FATHER = 'yusuf'
const CHILD = 'agent_3'
const SOCIAL_NAME = 'Little Bird'

const ZERO_USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: undefined },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
}

const IDLE_TURN = { thought: 'I wait.', importance: 1 }

const doc: PersonalityDoc = {
  temperament: 'exacting, quiet',
  values: ['a full store', 'honesty'],
  beliefs: ['what is counted keeps'],
  current: { mood: 'watchful', worries: [], goals: [] },
}

function specFor(id: string, sex: 'f' | 'm'): MindSpec {
  return {
    id,
    identity: { ...tamarIdentity, name: id },
    personality: doc,
    ageDays: 34 * 364,
    sex,
  }
}

// Answers the mother's naming call and nothing else; every other caller gets an idle turn.
// `refuseNaming` makes her answer with nothing, which is a call that happened and cost money.
function scriptedModel(refuseNaming: boolean, namingCalls: { n: number }): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: async (options) => {
      const parts = options.prompt as { role: string; content: unknown }[]
      const asked = parts
        .map((m) =>
          Array.isArray(m.content)
            ? (m.content as { text?: string }[]).map((p) => p.text ?? '').join('')
            : String(m.content),
        )
        .join('\n')
        .includes('what do you call')
      if (asked) namingCalls.n += 1
      const named = refuseNaming ? { name: '' } : { name: SOCIAL_NAME }
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(asked ? named : IDLE_TURN),
          },
        ],
        finishReason: { unified: 'stop' as const, raw: undefined },
        usage: ZERO_USAGE,
        warnings: [],
      }
    },
  })
}

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

async function town(
  opts: {
    namingBudgetUsd?: number
    startTick?: number
    maxMinds?: number
    refuseNaming?: boolean
  } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), 'sj-births-'))
  dirs.push(dir)
  const config = SimConfigSchema.parse({})
  const terrain: TileId[][] = Array.from({ length: 12 }, () =>
    Array.from({ length: 12 }, (): TileId => 0),
  )
  const store = new EventStore(openDb(':memory:'))
  const rng = new RngStreams('newborn-test')
  let state = genesisState(config, terrain)
  for (const id of [MOTHER, FATHER]) {
    state = fold(
      state,
      store.append(state.tick, 'agent_spawned', { id, name: id, x: 3, y: 3, ageDays: 9000 }),
      config,
    )
  }
  let handler: TickHandler = () => {}
  const loop = new TickLoop({
    store,
    state: { ...state, tick: opts.startTick ?? state.tick },
    rng,
    config,
    onTick: (ctx) => {
      handler(ctx)
    },
  })
  const bridge = new EngineBridge({ loop, store, simConfig: config })
  // No world systems: this rehearsal drives the birth by hand, not by gestation.
  let pending: { type: string; payload: unknown }[] = []
  handler = bridge.wrapTickHandler(({ emit }) => {
    for (const e of pending) emit(e.type, e.payload)
    pending = []
  })

  const opsDb = openAgentDb(join(dir, '_ops.db'))
  migrateLlmTables(opsDb)
  const mindDbs = new Map<string, Database.Database>()
  const dbFor = (id: string): Database.Database => {
    let db = mindDbs.get(id)
    if (db === undefined) {
      db = openAgentDb(join(dir, `${id}.db`))
      mindDbs.set(id, db)
    }
    return db
  }
  const namingCalls = { n: 0 }
  const model = scriptedModel(opts.refuseNaming ?? false, namingCalls)
  // A budget the run can lift: a name lost to a spent budget is asked for again on a later boot.
  let namingBudgetUsd = opts.namingBudgetUsd
  const makeClient = (caller: string, agentId?: string): LlmClient =>
    new LlmClient({
      model,
      db: opsDb,
      caller,
      ...(agentId === undefined ? {} : { agentId }),
      maxRetries: 0,
      ...(caller === 'naming' && namingBudgetUsd !== undefined
        ? { budgetUsd: namingBudgetUsd }
        : {}),
    })
  const real = await FakeEmbedder.create()
  // A crash mid-seeding, which is the one window a birth cannot survive on its own.
  let crashSeeding = false
  const embedder = {
    embed: async (t: string): Promise<Float32Array> => {
      if (crashSeeding) throw new Error('the process died mid-seeding')
      return real.embed(t)
    },
  }
  const FOUNDERS = [specFor(MOTHER, 'f'), specFor(FATHER, 'm')]
  const maxMinds = opts.maxMinds ?? 10

  // The one boot path: `resolveCast` decides who is in the town, and a restart is another call
  // to it over the same log.
  const boot = () => {
    const cast = resolveCast(FOUNDERS, store, maxMinds)
    const booted = bootMinds({
      minds: cast.filter((m) => !needsHousehold(m, dbFor(m.id))),
      bridge,
      embedder,
      dbFor,
      turnLlm: (id) => makeClient('turn', id),
    })
    const repairing = ensureChildren({
      cast: new Map(cast.map((m) => [m.id, m])),
      store,
      dbFor,
      opsDb,
      embedder,
      namingLlm: makeClient('naming'),
      boot: (spec) => {
        booted.add(spec)
      },
    })
    const stopBirths = wireBirths({
      booted,
      bridge,
      store,
      dbFor,
      embedder,
      opsDb,
      namingLlm: makeClient('naming'),
      maxMinds,
    })
    return {
      booted,
      repairing,
      stop: () => {
        stopBirths()
        booted.stop()
      },
    }
  }
  let running = boot()

  return {
    dir,
    get booted() {
      return running.booted
    },
    namingCalls,
    opsDb,
    dbFor,
    crash: (on: boolean) => {
      crashSeeding = on
    },
    fundNaming: () => {
      namingBudgetUsd = undefined
    },
    reboot: async () => {
      running.stop()
      running = boot()
      await running.repairing
    },
    stop: () => {
      running.stop()
      for (const db of mindDbs.values()) db.close()
      opsDb.close()
    },
    bear: (id = CHILD, name = 'Mira') => {
      pending.push({
        type: 'agent_born',
        payload: { id, name, sex: 'f', motherId: MOTHER, fatherId: FATHER, x: 3, y: 3 },
      })
    },
    settle: async (done: () => boolean, max = 200) => {
      for (let i = 0; i < max && !done(); i += 1) {
        loop.step()
        await new Promise((r) => setImmediate(r))
      }
    },
  }
}

const memoryTexts = (db: Database.Database, agentId: string): string[] =>
  (
    db.prepare('SELECT text FROM memories WHERE agent_id = ? ORDER BY id').all(agentId) as {
      text: string
    }[]
  ).map((r) => r.text)

const socialNames = (db: Database.Database): { agentId: string; socialName: string }[] =>
  db.prepare('SELECT agent_id AS agentId, social_name AS socialName FROM social_names').all() as {
    agentId: string
    socialName: string
  }[]

const personalityDay = (db: Database.Database, agentId: string): number | undefined =>
  (
    db.prepare('SELECT day FROM personality_versions WHERE agent_id = ?').get(agentId) as
      | { day: number }
      | undefined
  )?.day

const birthAlerts = (db: Database.Database): { kind: string; detail: string }[] =>
  db.prepare("SELECT kind, detail FROM alerts WHERE kind LIKE 'birth%' ORDER BY id").all() as {
    kind: string
    detail: string
  }[]

const callersIn = (db: Database.Database): string[] =>
  (db.prepare('SELECT DISTINCT caller FROM llm_calls').all() as { caller: string }[]).map(
    (r) => r.caller,
  )

describe('★ a born mind survives a restart', () => {
  it('rejoins the cast, with its memories, on a boot that only ever knew the founders', async () => {
    const t = await town()
    t.bear()
    await t.settle(() => socialNames(t.opsDb).length > 0)
    const before = memoryTexts(t.dbFor(CHILD), CHILD)
    expect(before.length).toBeGreaterThan(0)

    await t.reboot()

    expect([...t.booted.cast.keys()]).toContain(CHILD)
    expect(t.booted.runtimes.has(CHILD)).toBe(true)
    expect(memoryTexts(t.dbFor(CHILD), CHILD)).toEqual(before)
    // The same person, not a second one: the second boot must not re-stamp a personality.
    expect(t.dbFor(CHILD).prepare('SELECT COUNT(*) AS n FROM personality_versions').get()).toEqual({
      n: 1,
    })
    t.stop()
  })

  it('★ a child caught mid-seeding by a crash comes back with its household and its name', async () => {
    const t = await town()
    t.crash(true)
    t.bear()
    await t.settle(() => birthAlerts(t.opsDb).some((a) => a.kind === 'birth_failed'))

    // The window the concern names: a body in the world, and a person with no origin.
    expect(memoryTexts(t.dbFor(CHILD), CHILD)).toEqual([])
    expect(socialNames(t.opsDb)).toEqual([])
    expect(t.booted.runtimes.has(CHILD)).toBe(false)

    t.crash(false)
    await t.reboot()

    expect(memoryTexts(t.dbFor(CHILD), CHILD)).toContain(
      'You were born to your mother and your father, in this town.',
    )
    expect(socialNames(t.opsDb)).toEqual([{ agentId: CHILD, socialName: SOCIAL_NAME }])
    expect(t.booted.runtimes.has(CHILD)).toBe(true)
    t.stop()
  })

  it('★ and a name lost on its own is written on the next boot, without a second household', async () => {
    const t = await town({ namingBudgetUsd: 0 })
    t.bear()
    await t.settle(() => t.booted.runtimes.has(CHILD))
    const seeded = memoryTexts(t.dbFor(CHILD), CHILD)
    expect(seeded.length).toBeGreaterThan(0)
    expect(socialNames(t.opsDb)).toEqual([])

    t.fundNaming()
    await t.reboot()

    expect(socialNames(t.opsDb)).toEqual([{ agentId: CHILD, socialName: SOCIAL_NAME }])
    expect(memoryTexts(t.dbFor(CHILD), CHILD)).toEqual(seeded)
    t.stop()
  })

  it('★ a mother who answers with nothing is never asked twice, however often the town reboots', async () => {
    const t = await town({ refuseNaming: true })
    t.bear()
    await t.settle(() => t.namingCalls.n > 0)
    expect(socialNames(t.opsDb)).toEqual([{ agentId: CHILD, socialName: '' }])

    await t.reboot()
    await t.reboot()

    expect(t.namingCalls.n).toBe(1)
    expect(socialNames(t.opsDb)).toEqual([{ agentId: CHILD, socialName: '' }])
    t.stop()
  })

  it('two births on one tick cannot both take the last slot', async () => {
    const t = await town({ maxMinds: 3 })
    t.bear('agent_3', 'Mira')
    t.bear('agent_4', 'Idris')
    await t.settle(() => birthAlerts(t.opsDb).length > 0)

    expect(t.booted.runtimes.has('agent_3')).toBe(true)
    expect(t.booted.runtimes.has('agent_4')).toBe(false)
    expect(birthAlerts(t.opsDb).map((a) => a.kind)).toEqual(['birth_over_max_minds'])
    t.stop()
  })

  it('a birth past the population ceiling is folded into the world and says so', async () => {
    const t = await town({ maxMinds: 2 })
    t.bear()
    await t.settle(() => birthAlerts(t.opsDb).length > 0)

    expect(t.booted.runtimes.has(CHILD)).toBe(false)
    expect(birthAlerts(t.opsDb).map((a) => a.kind)).toEqual(['birth_over_max_minds'])
    expect(birthAlerts(t.opsDb)[0]!.detail).toContain('2 minds')
    t.stop()
  })
})

describe('★ a child born in the town gets a mind, a database and a name', () => {
  it('spawns a runtime with its own db, a household memory, and the mother’s name for it', async () => {
    const t = await town()
    t.bear()
    await t.settle(() => socialNames(t.opsDb).length > 0)

    expect([...t.booted.cast.keys()]).toContain(CHILD)
    expect(t.booted.runtimes.has(CHILD)).toBe(true)
    expect(readdirSync(t.dir)).toContain(`${CHILD}.db`)

    const seeded = memoryTexts(t.dbFor(CHILD), CHILD)
    expect(seeded).toContain('You were born to your mother and your father, in this town.')

    expect(socialNames(t.opsDb)).toEqual([{ agentId: CHILD, socialName: SOCIAL_NAME }])
    expect(callersIn(t.opsDb)).toContain('naming')
    t.stop()
  })

  it('stamps the first personality with the day it was born, not the day the town booted', async () => {
    const t = await town({ startTick: 3 * MINUTES_PER_DAY + 60 })
    t.bear()
    await t.settle(() => t.booted.runtimes.has(CHILD))

    expect(personalityDay(t.dbFor(CHILD), CHILD)).toBe(3)
    t.stop()
  })

  it('a naming call past its budget costs the town the name and not the child', async () => {
    const t = await town({ namingBudgetUsd: 0 })
    t.bear()
    await t.settle(() => t.booted.runtimes.has(CHILD))

    expect(t.booted.runtimes.has(CHILD)).toBe(true)
    expect(memoryTexts(t.dbFor(CHILD), CHILD).length).toBeGreaterThan(0)
    expect(socialNames(t.opsDb)).toEqual([])
    expect(callersIn(t.opsDb)).not.toContain('naming')
    t.stop()
  })
})

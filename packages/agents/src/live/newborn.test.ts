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
import { SimConfigSchema } from '@sj/shared'
import { migrateLlmTables } from '../llm/callLog.js'
import { LlmClient } from '../llm/client.js'
import { openAgentDb } from '../memory/schema.js'
import type { PersonalityDoc } from '../personality.js'
import { EngineBridge } from '../runtime/bridge.js'
import { FakeEmbedder } from '../testutil/fakeEmbedder.js'
import { tamarIdentity } from '../testutil/fixtures.js'
import { bootMinds, type MindSpec } from './liveMinds.js'
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
function scriptedModel(): MockLanguageModelV4 {
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
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(asked ? { name: SOCIAL_NAME } : IDLE_TURN),
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

async function town(opts: { namingBudgetUsd?: number } = {}) {
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
    state,
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
  const model = scriptedModel()
  const makeClient = (caller: string, agentId?: string): LlmClient =>
    new LlmClient({
      model,
      db: opsDb,
      caller,
      ...(agentId === undefined ? {} : { agentId }),
      maxRetries: 0,
      ...(caller === 'naming' && opts.namingBudgetUsd !== undefined
        ? { budgetUsd: opts.namingBudgetUsd }
        : {}),
    })
  const embedder = await FakeEmbedder.create()
  const booted = bootMinds({
    minds: [specFor(MOTHER, 'f'), specFor(FATHER, 'm')],
    bridge,
    embedder,
    dbFor,
    turnLlm: (id) => makeClient('turn', id),
  })
  const stopBirths = wireBirths({
    booted,
    bridge,
    store,
    dbFor,
    embedder,
    opsDb,
    namingLlm: makeClient('naming'),
    homeOf: () => '',
  })

  return {
    dir,
    booted,
    opsDb,
    dbFor,
    stop: () => {
      stopBirths()
      booted.stop()
      for (const db of mindDbs.values()) db.close()
      opsDb.close()
    },
    bear: () => {
      pending.push({
        type: 'agent_born',
        payload: {
          id: CHILD,
          name: 'Mira',
          sex: 'f',
          motherId: MOTHER,
          fatherId: FATHER,
          x: 3,
          y: 3,
        },
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

const callersIn = (db: Database.Database): string[] =>
  (db.prepare('SELECT DISTINCT caller FROM llm_calls').all() as { caller: string }[]).map(
    (r) => r.caller,
  )

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

import { describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { RngStream } from '@sj/engine'
import { openAgentDb } from './memory/schema.js'
import { MemoryStore, type MemoryRow, type MemoryTags } from './memory/store.js'
import { insertLlmCall, migrateLlmTables, BudgetExceededError, LlmClient } from '@sj/llm'
import { FakeEmbedder, mockModel } from '@sj/llm/testutil'
import { scanForLayoutLeak, scanPromptForGlassLeak } from './prompt/glassScan.js'
import { DREAM_PROMPT, dreamFragmentsMessage, makeDreamLlm, rollDream } from './dream.js'

const TICKS_PER_DAY = 1440
const AGENT = 'tamar'

function tagsFor(i: number): MemoryTags {
  return {
    people: [`person-${i}`],
    place: i % 2 === 0 ? 'storehouse' : 'river',
    objects: [`object-${i}`],
    topics: [`topic-${i}`],
  }
}

async function makeStore(agentId = AGENT): Promise<{ store: MemoryStore }> {
  const db = openAgentDb(':memory:')
  const store = new MemoryStore(db, agentId, await FakeEmbedder.create())
  return { store }
}

// 8 in-window memories (importances 1..8, spread over day-2..day) plus one
// out-of-window memory (day-3) with a higher importance — the day fence must drop it.
async function seedFragments(store: MemoryStore, day: number): Promise<void> {
  const importances = [1, 2, 3, 4, 5, 6, 7, 8]
  for (let n = 0; n < importances.length; n += 1) {
    const d = day - 2 + (n % 3)
    await store.insertMemory({
      tick: d * TICKS_PER_DAY + n + 1,
      kind: 'perception',
      text: `memory ${n + 1}`,
      importance: importances[n]!,
      tags: tagsFor(n + 1),
    })
  }
  await store.insertMemory({
    tick: (day - 3) * TICKS_PER_DAY + 100,
    kind: 'perception',
    text: 'out of window',
    importance: 9,
    tags: tagsFor(999),
  })
}

function findDreamDay(agentId: string): number {
  let day = 0
  while (RngStream.seed(agentId, `dream:${day}`).next() >= 0.35) day += 1
  return day
}

function findDryDay(agentId: string): number {
  let day = 0
  while (RngStream.seed(agentId, `dream:${day}`).next() < 0.35) day += 1
  return day
}

describe('rollDream', () => {
  it('dreams on a passing roll: top-6 in-window fragments, dream row stored', async () => {
    const day = findDreamDay(AGENT)
    const { store } = await makeStore()
    await seedFragments(store, day)

    const received: MemoryRow[][] = []
    const llm = {
      composeDream: async (fragments: MemoryRow[]) => {
        received.push([...fragments])
        return { text: 'a dream of the storehouse', mood: 'pensive' }
      },
    }

    const result = await rollDream({ mem: store, agentId: AGENT, day, llm, chance: 0.35 })
    expect(result.dreamed).toBe(true)
    if (!result.dreamed) throw new Error('expected a dream')
    expect(result.text).toBe('a dream of the storehouse')
    expect(result.mood).toBe('pensive')

    expect(received).toHaveLength(1)
    const fragments = received[0]!
    expect(fragments).toHaveLength(6)

    const sortedDesc = [1, 2, 3, 4, 5, 6, 7, 8].sort((a, b) => b - a)
    const seventhRanked = sortedDesc[6]! // importance 2
    for (const f of fragments) {
      expect(f.importance).toBeGreaterThanOrEqual(seventhRanked)
    }
    // exactly the top 6 of the in-window set; the out-of-window importance-9 is dropped
    expect(fragments.map((f) => f.importance).sort((a, b) => b - a)).toEqual([8, 7, 6, 5, 4, 3])
    expect(fragments.some((f) => f.importance === 9)).toBe(false)

    const row = store.getMemory(result.memoryId)
    expect(row).not.toBeNull()
    expect(row!.kind).toBe('dream')
    expect(row!.importance).toBe(6)
    // tags are the union of fragment tags
    for (const f of fragments) {
      expect(row!.tags.people).toContain(f.tags.people[0])
      expect(row!.tags.topics).toContain(f.tags.topics[0])
      expect(row!.tags.objects).toContain(f.tags.objects[0])
    }
  })

  it('does not dream on a failing roll: no LLM call, no row', async () => {
    const day = findDryDay(AGENT)
    const { store } = await makeStore()
    await seedFragments(store, day)

    let calls = 0
    const llm = {
      composeDream: async () => {
        calls += 1
        return { text: 'never', mood: 'never' }
      },
    }

    const result = await rollDream({ mem: store, agentId: AGENT, day, llm, chance: 0.35 })
    expect(result).toEqual({ dreamed: false })
    expect(calls).toBe(0)
    expect(store.memoriesOfDay(day).some((m) => m.kind === 'dream')).toBe(false)
  })

  it('is deterministic: identical inputs yield identical fragment order', async () => {
    const day = findDreamDay(AGENT)
    const orders: number[][] = []
    for (let run = 0; run < 2; run += 1) {
      const { store } = await makeStore()
      await seedFragments(store, day)
      const received: MemoryRow[] = []
      const llm = {
        composeDream: async (fragments: MemoryRow[]) => {
          received.push(...fragments)
          return { text: 'x', mood: 'y' }
        },
      }
      await rollDream({ mem: store, agentId: AGENT, day, llm, chance: 0.35 })
      orders.push(received.map((f) => f.id))
    }
    expect(orders[0]).toHaveLength(6)
    expect(orders[1]).toHaveLength(6)
    expect(orders[0]).toEqual(orders[1])
  })
})

describe('makeDreamLlm', () => {
  async function fragments(): Promise<MemoryRow[]> {
    const { store } = await makeStore()
    await store.insertMemory({
      tick: 100,
      kind: 'perception',
      text: 'the bread came out of the ashes',
      importance: 5,
      tags: tagsFor(1),
    })
    return store.memoriesOfDay(0)
  }

  function client(db: Database.Database, budgetUsd?: number): LlmClient {
    return new LlmClient({
      model: mockModel([{ json: { text: 'the storehouse had no door', mood: 'unsettled' } }]),
      db,
      caller: 'dream',
      agentId: AGENT,
      maxRetries: 0,
      ...(budgetUsd === undefined ? {} : { budgetUsd }),
    })
  }

  function opsDb(): Database.Database {
    const db = openAgentDb(':memory:')
    migrateLlmTables(db)
    return db
  }

  it('composes a dream through the client and books the call under caller "dream"', async () => {
    const db = opsDb()
    const dream = await makeDreamLlm(client(db)).composeDream(await fragments())

    expect(dream).toEqual({ text: 'the storehouse had no door', mood: 'unsettled' })
    const rows = db.prepare('SELECT caller, agent_id AS agentId FROM llm_calls').all() as {
      caller: string
      agentId: string
    }[]
    expect(rows).toEqual([{ caller: 'dream', agentId: AGENT }])
  })

  it('is refused by the budget guard before it can spend, and books nothing', async () => {
    const db = opsDb()
    insertLlmCall(db, {
      agentId: AGENT,
      caller: 'dream',
      model: 'm',
      provider: null,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      reasoningTokens: 0,
      costUsd: 0.5,
      reportedCostUsd: null,
      latencyMs: 0,
      ok: true,
      error: null,
    })
    const llm = makeDreamLlm(client(db, 0.1))

    await expect(llm.composeDream(await fragments())).rejects.toBeInstanceOf(BudgetExceededError)
    expect(db.prepare('SELECT COUNT(*) AS n FROM llm_calls').get()).toEqual({ n: 1 })
  })

  it('speaks to the mind and never to the machine', () => {
    const text = [DREAM_PROMPT, dreamFragmentsMessage([])].join('\n')
    expect(scanPromptForGlassLeak(text)).toEqual([])
    expect(scanForLayoutLeak(text)).toEqual([])
    for (const hint of ['you should', 'you must build', 'go inside', 'raise a', 'be sure to']) {
      expect(text.toLowerCase()).not.toContain(hint)
    }
  })
})

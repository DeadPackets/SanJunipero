import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import type { LlmClient, LlmMessage, LlmUsage } from '@sj/agents'
import { scanPromptForGlassLeak } from './glass.js'
import { migrateNarratorTables } from './schema.js'
import { NarratorStore } from './store.js'
import {
  DEFAULT_SEMANTIC_CONFIG,
  SEMANTIC_CONCEPTS,
  SEMANTIC_INSTRUCTION,
  detectSemanticFirsts,
} from './semanticFirsts.js'
import {
  AUTHORED_DAY,
  CHANGED_MIND_SPOKEN,
  DAY,
  GOOD_VERDICT,
  GOD_QUOTE,
  HONEST_ERROR_SPOKEN,
  LIE_SPOKEN,
  LIE_THOUGHT,
} from './fixtures/transcripts.js'

const emptyUsage = (): LlmUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  costUsd: 0,
})

class ScriptedLlm {
  objectCalls = 0
  systems: string[] = []
  constructor(private readonly value: unknown = GOOD_VERDICT) {}

  async object(opts: {
    system: string
    messages: LlmMessage[]
    schema: unknown
  }): Promise<{ value: unknown; usage: LlmUsage }> {
    this.objectCalls += 1
    this.systems.push(opts.system)
    return { value: this.value, usage: emptyUsage() }
  }

  async text(): Promise<{ text: string; usage: LlmUsage }> {
    return { text: '', usage: emptyUsage() }
  }
  totalCostUsd(): number {
    return 0
  }
  alert(): void {}
}

const rig = () => {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, agent_id TEXT, kind TEXT NOT NULL, detail TEXT NOT NULL)`)
  migrateNarratorTables(db)
  return { db, store: new NarratorStore(db) }
}

const run = async (llm: ScriptedLlm, over: Record<string, unknown> = {}) => {
  const { db, store } = rig()
  const milestones = await detectSemanticFirsts({
    db,
    store,
    llm: llm as unknown as LlmClient,
    day: DAY,
    records: AUTHORED_DAY,
    ...over,
  })
  return { db, store, milestones }
}

const alerts = (db: Database.Database): { kind: string; detail: string }[] =>
  db.prepare('SELECT kind, detail FROM alerts ORDER BY id').all() as {
    kind: string
    detail: string
  }[]

// A model whose answer the generator refuses outright — a hit citing neither an event nor a
// remembered record — because that throw used to take the whole chapter down with it.
class ThrowingLlm {
  objectCalls = 0
  async object(): Promise<never> {
    this.objectCalls += 1
    throw new Error('No object generated: response did not match schema.')
  }

  async text(): Promise<{ text: string; usage: LlmUsage }> {
    return { text: '', usage: emptyUsage() }
  }
  totalCostUsd(): number {
    return 0
  }
  alert(): void {}
}

describe('a verdict nobody can read', () => {
  it('is a night with no semantic firsts, an alert, and a chapter that still gets written', async () => {
    const { db, store } = rig()
    const llm = new ThrowingLlm()
    const milestones = await detectSemanticFirsts({
      db,
      store,
      llm: llm as unknown as LlmClient,
      day: DAY,
      records: AUTHORED_DAY,
    })
    expect(llm.objectCalls).toBe(1)
    expect(milestones).toEqual([])
    expect(store.semanticFirsts()).toEqual([])
    expect(alerts(db).map((a) => a.kind)).toEqual(['semantic_firsts_unreadable'])
  })
})

describe('the nightly pass', () => {
  it('takes the god reference and the lie, and nothing else from that day', async () => {
    const { store, milestones } = await run(new ScriptedLlm())
    expect(milestones.map((m) => m.kind)).toEqual(['first_god_afterlife', 'first_lie'])
    for (const m of milestones) {
      expect(m.tier).toBe(2.5)
      expect(m.domain).toBe('semantic')
      expect(m.day).toBe(DAY)
    }
    const rows = store.semanticFirsts()
    expect(rows.map((r) => r.conceptKind)).toEqual(['god_afterlife', 'lie'])
    expect(GOD_QUOTE).toContain(rows[0]!.quote)
    // Both sides of the glass, quoted, and both verbatim.
    expect(rows[1]!.quote).toBe(LIE_SPOKEN)
    expect(rows[1]!.quote2).toBe(LIE_THOUGHT)
    expect(rows[1]!.provenance2).toBe('mem_7')
  })

  it('a thought that comes after the words is a change of mind, not a lie', async () => {
    const { store } = await run(new ScriptedLlm())
    expect(store.semanticFirsts().some((r) => r.quote === CHANGED_MIND_SPOKEN)).toBe(false)
    const candidate = store.semanticCandidates().find((c) => c.quote === CHANGED_MIND_SPOKEN)
    expect(candidate?.reason).toBe('inner_record_postdates_speech')
  })

  it("being wrong is not lying — the honest error is nowhere in the night's work", async () => {
    const { store } = await run(new ScriptedLlm())
    const all = JSON.stringify([store.semanticFirsts(), store.semanticCandidates()])
    expect(all).not.toContain(HONEST_ERROR_SPOKEN)
  })

  it('voids a quote nobody said and keeps it as a candidate', async () => {
    const fabricated = {
      hits: [
        {
          conceptKind: 'god_afterlife',
          agentId: 'ada',
          day: DAY,
          sourceKind: 'speech',
          eventSeq: 101,
          quote: 'The gods walk among us at dusk.',
          confidence: 0.99,
          rationale: 'invented',
        },
      ],
    }
    const { store, milestones } = await run(new ScriptedLlm(fabricated))
    expect(milestones).toEqual([])
    expect(store.semanticFirsts()).toEqual([])
    expect(store.semanticCandidates()[0]).toMatchObject({
      conceptKind: 'god_afterlife',
      reason: 'quote_not_in_source',
    })
  })

  it('a joke on the same words voids the lie', async () => {
    const withJoke = {
      hits: [
        GOOD_VERDICT.hits[1],
        {
          conceptKind: 'joke',
          agentId: 'cass',
          day: DAY,
          sourceKind: 'speech',
          eventSeq: 118,
          quote: LIE_SPOKEN,
          confidence: 0.88,
          rationale: 'said grinning, with the knife in her hand',
        },
      ],
    }
    const { store, milestones } = await run(new ScriptedLlm(withJoke))
    expect(milestones.map((m) => m.kind)).toEqual(['first_joke'])
    expect(store.semanticCandidates().find((c) => c.conceptKind === 'lie')?.reason).toBe(
      'joke_on_the_same_words',
    )
  })

  it('holds a lie to a higher bar than everything else', async () => {
    const soft = { hits: [{ ...GOOD_VERDICT.hits[1]!, confidence: 0.85 }] }
    const { store, milestones } = await run(new ScriptedLlm(soft))
    expect(milestones).toEqual([])
    expect(store.semanticCandidates()[0]).toMatchObject({
      conceptKind: 'lie',
      reason: 'below_confidence',
    })
    expect(DEFAULT_SEMANTIC_CONFIG.lieMinConfidence).toBeGreaterThan(
      DEFAULT_SEMANTIC_CONFIG.minConfidence,
    )
  })

  it('refuses a lie whose two sides are days apart', async () => {
    const wide = {
      hits: [{ ...GOOD_VERDICT.hits[1]!, quote2: LIE_THOUGHT, provenance2: 'mem_7' }],
    }
    const { store } = await run(new ScriptedLlm(wide), { config: { lieTopicWindowTicks: 5 } })
    expect(store.semanticCandidates()[0]).toMatchObject({
      conceptKind: 'lie',
      reason: 'sides_out_of_window',
    })
  })

  it('asks nothing and writes nothing when it is switched off', async () => {
    const llm = new ScriptedLlm()
    const { store, milestones } = await run(llm, { config: { enabled: false } })
    expect(milestones).toEqual([])
    expect(store.semanticFirsts()).toEqual([])
    expect(llm.objectCalls).toBe(0)
  })

  it('scans only for what it has not found yet, and stops asking when the catalog is empty', async () => {
    const { db, store } = rig()
    const llm = new ScriptedLlm()
    await detectSemanticFirsts({
      db,
      store,
      llm: llm as unknown as LlmClient,
      day: DAY,
      records: AUTHORED_DAY,
    })
    expect(llm.objectCalls).toBe(1)
    expect(llm.systems[0]).toContain('metaphor: not the plain')
    const second = await detectSemanticFirsts({
      db,
      store,
      llm: llm as unknown as LlmClient,
      day: DAY + 1,
      records: AUTHORED_DAY,
    })
    // The second night is a recurrence, never a second milestone.
    expect(second).toEqual([])
    expect(store.semanticFirsts()).toHaveLength(2)
    expect(llm.objectCalls).toBe(2)
    expect(llm.systems[1]).not.toContain('god_afterlife')
    expect(llm.systems[1]).not.toContain('The lie contract')
    expect(llm.systems[1]).toContain('metaphor: not the plain')
    const empty = await detectSemanticFirsts({
      db,
      store,
      llm: llm as unknown as LlmClient,
      day: DAY + 2,
      records: AUTHORED_DAY,
      config: { concepts: ['god_afterlife', 'lie'] },
    })
    expect(empty).toEqual([])
    expect(llm.objectCalls).toBe(2)
  })
})

describe('the prompt', () => {
  it('shows the model every concept id it may answer with, and no others', () => {
    for (const c of SEMANTIC_CONCEPTS) expect(SEMANTIC_INSTRUCTION).toContain(c)
  })

  it('carries the whole lie contract, including that being wrong is not lying', () => {
    expect(SEMANTIC_INSTRUCTION).toMatch(/verbatim/i)
    expect(SEMANTIC_INSTRUCTION).toMatch(/being wrong is not lying/i)
    expect(SEMANTIC_INSTRUCTION).toMatch(/joke/i)
  })

  it('is ops-side and never goes near a mind — which is why it may hold the taxonomy', () => {
    expect(scanPromptForGlassLeak(SEMANTIC_INSTRUCTION).length).toBeGreaterThan(0)
  })
})

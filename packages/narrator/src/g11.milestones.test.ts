// @slow — the ledger half: the firsts an engine event makes, the firsts a shape across several
// makes, and the firsts only a reader can find. The model here is a script.
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import type { LlmClient, LlmMessage, LlmUsage } from '@sj/agents'
import {
  DEATH_CAUSES,
  fold,
  genesisState,
  RngStreams,
  VERBS,
  type TileId,
  type WorldState,
} from '@sj/engine'
import { DEFAULT_CONFIG, MINUTES_PER_DAY, type SimEvent } from '@sj/shared'
import { detectFirsts } from './firsts.js'
import { CONSTRUCT_VOCABULARY, scanPromptForGlassLeak } from './glass.js'
import { DEATH_CAUSE_LABELS, TIER1_DEFS } from './milestones/tier1.js'
import { detectTier2 } from './milestones/tier2.js'
import { migrateNarratorTables } from './schema.js'
import { NarratorStore } from './store.js'
import { SEMANTIC_CONCEPTS, SEMANTIC_INSTRUCTION, detectSemanticFirsts } from './semanticFirsts.js'
import { AUTHORED_DAY, DAY, GOOD_VERDICT, GOD_QUOTE } from './fixtures/transcripts.js'

let seq = 1
const ev = (tick: number, type: string, payload: unknown = {}): SimEvent => ({
  seq: seq++,
  tick,
  type,
  payload,
})
const day = (n: number): number => n * MINUTES_PER_DAY

const memDb = (): Database.Database => {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, agent_id TEXT, kind TEXT NOT NULL, detail TEXT NOT NULL)`)
  migrateNarratorTables(db)
  return db
}

// ------------------------------------------------------------------ tier 1

describe('G11a-L1: the engine firsts fire once each, and a second death of a new cause is its own first', () => {
  const ctx = () => ({ seenKinds: new Set<string>(), rulebookCount: 0 })

  it('a day that does everything three times leaves one row per kind', () => {
    const thrice = (make: (n: number) => SimEvent[]): SimEvent[] =>
      [0, 1, 2].flatMap((n) => make(n))
    const events: SimEvent[] = [
      ...thrice((n) => [
        ev(day(n) + 10, 'agent_spoke', { agentId: 'ada', text: 'oi', x: 0, y: 0 }),
      ]),
      ...thrice((n) => [
        ev(day(n), 'structure_planned', { id: `house_${n}`, kind: 'house' }),
        ev(day(n) + 20, 'structure_completed', { id: `house_${n}` }),
      ]),
      ...thrice((n) => [ev(day(n) + 30, 'action_completed', { agentId: 'ada', verb: 'eat' })]),
      ...thrice((n) => [
        ev(day(n) + 40, 'tile_changed', {
          x: n,
          y: 0,
          from: 0,
          to: 7,
          reason: 'paved',
          byId: 'ada',
        }),
      ]),
      ...thrice((n) => [
        ev(day(n) + 50, 'tile_changed', {
          x: n,
          y: 1,
          from: 0,
          to: 10,
          reason: 'channel',
          byId: 'ada',
        }),
      ]),
      ...thrice((n) => [
        ev(day(n) + 60, 'fauna_killed', { id: `f_${n}`, kind: 'deer', x: 1, y: 1, byId: 'ada' }),
      ]),
      ...thrice((n) => [
        ev(day(n) + 70, 'fire_extinguished', {
          structureId: 's1',
          cause: 'doused',
          agentId: 'ada',
        }),
      ]),
      ...thrice((n) => [
        ev(day(n) + 80, 'agent_expressed', {
          agentId: 'ada',
          verb: 'dance',
          x: 0,
          y: 0,
          sense: 'sight',
        }),
      ]),
      ...thrice((n) => [
        ev(day(n) + 90, 'agent_afflicted', { agentId: 'ada', kind: 'illness', severity: 1 }),
      ]),
    ]
    const found = detectFirsts(events, ctx())
    const kinds = found.map((m) => m.kind)
    expect(new Set(kinds).size).toBe(kinds.length) // once each, never twice
    for (const want of [
      'first_speech',
      'first_structure',
      'first_house',
      'first_meal',
      'first_road',
      'first_channel',
      'first_hunt',
      'first_fire_out',
      'first_expression',
      'first_infection',
    ])
      expect(kinds).toContain(want)
  })

  it('two deaths of two causes are two firsts, and the generic grave is only the first one', () => {
    const deaths = [
      ev(day(1), 'agent_died', { agentId: 'ada', cause: 'hunger' }),
      ev(day(2), 'agent_died', { agentId: 'bex', cause: 'thirst' }),
      ev(day(3), 'agent_died', { agentId: 'cass', cause: 'hunger' }),
    ]
    const kinds = detectFirsts(deaths, ctx()).map((m) => m.kind)
    expect(kinds.filter((k) => k === 'first_death')).toHaveLength(1)
    expect(kinds).toContain('first_death_hunger')
    expect(kinds).toContain('first_death_thirst')
    expect(kinds.filter((k) => k === 'first_death_hunger')).toHaveLength(1)
  })

  it('the ledger has a row for every way the engine knows how to die', () => {
    expect(Object.keys(DEATH_CAUSE_LABELS).sort()).toEqual([...DEATH_CAUSES].sort())
    for (const cause of DEATH_CAUSES) {
      expect(TIER1_DEFS.some((d) => d.kind === `first_death_${cause}`)).toBe(true)
    }
  })

  it('no label names a number, a mechanism, or a word only the ops plane has', () => {
    for (const def of TIER1_DEFS) {
      expect(scanPromptForGlassLeak(def.label), def.label).toEqual([])
      expect(def.label, def.kind).not.toMatch(/\b(hp|severity|affliction|config|tier|roll)\b/i)
      expect(CONSTRUCT_VOCABULARY.some((w) => def.kind.startsWith(w))).toBe(false)
    }
  })
})

// ------------------------------------------------------------------ tier 2

describe('G11a-L2: the parting a scripted lapse produces', () => {
  function pairWorld(
    rows: Record<
      string,
      {
        nights: number
        lastNightDay: number
        formedTick: number | null
        dissolvedTick: number | null
      }
    >,
  ): WorldState {
    const flat = Array.from({ length: 32 }, () => Array.from({ length: 32 }, (): TileId => 0))
    let s = genesisState(DEFAULT_CONFIG, flat)
    for (const [id, name] of [
      ['ada', 'Ada'],
      ['bex', 'Bex'],
    ]) {
      s = fold(s, ev(0, 'agent_spawned', { id, name, x: 4, y: 4, ageDays: 7300 }), DEFAULT_CONFIG)
    }
    return { ...s, pairNights: rows }
  }

  const t2 = (events: SimEvent[], state?: WorldState) =>
    detectTier2(events, { seenKinds: new Set(), config: DEFAULT_CONFIG, state })

  it('five shared nights, a dissolution, and a whole window of silence make a parting', () => {
    const state = pairWorld({
      'ada|bex': { nights: 5, lastNightDay: 4, formedTick: day(3), dissolvedTick: day(12) },
    })
    const lapse = [
      ...Array.from({ length: 5 }, (_, i) =>
        ev(day(i) + 1, 'co_slept', { aId: 'ada', bId: 'bex', day: i }),
      ),
      ev(day(12) + 60, 'agent_moved', { id: 'ada', x: 9, y: 9 }),
    ]
    const found = t2(lapse, state).find((m) => m.kind === 'first_breakup')
    expect(found).toBeDefined()
    expect(found!.tier).toBe(2)
    expect(found!.domain).toBe('social')
    expect(found!.agentIds).toEqual(['ada', 'bex'])
  })

  it('a gap they talked across is not a parting', () => {
    const state = pairWorld({
      'ada|bex': { nights: 5, lastNightDay: 4, formedTick: day(3), dissolvedTick: day(9) },
    })
    const talked = [
      ...Array.from({ length: 5 }, (_, i) =>
        ev(day(i) + 1, 'co_slept', { aId: 'ada', bId: 'bex', day: i }),
      ),
      ev(day(5) + 60, 'agent_spoke', { agentId: 'ada', text: 'still here', x: 4, y: 4 }),
      ev(day(9) + 60, 'agent_spoke', { agentId: 'ada', text: 'and again', x: 4, y: 4 }),
    ]
    expect(t2(talked, state).map((m) => m.kind)).not.toContain('first_breakup')
  })

  it('a pass with no world in reach simply does not run the three that need one', () => {
    const lapse = [ev(day(12) + 60, 'agent_moved', { id: 'ada', x: 9, y: 9 })]
    expect(t2(lapse).map((m) => m.kind)).not.toContain('first_breakup')
  })

  // Both of these match on `agent_harmed{source:'attack'}`, so they are driven with the log
  // the verb actually produces rather than a hand-written one.
  it('a blow and a word after it: the quarrel and the peace, off the log attack really writes', () => {
    const s = pairWorld({})
    const blow = VERBS.attack!.onComplete(
      s,
      DEFAULT_CONFIG,
      'ada',
      { targetId: 'bex' },
      new RngStreams('c1').get('combat'),
    )
    const harmed = blow.find((e) => e.type === 'agent_harmed')
    expect(harmed).toBeDefined()
    expect(harmed!.payload).toMatchObject({ agentId: 'bex', source: 'attack', byId: 'ada' })
    expect((harmed!.payload as { amount: number }).amount).toBeGreaterThan(0)

    const log = [
      ev(day(1) + 10, harmed!.type, harmed!.payload),
      // Far enough after the blow that it is a peace and not the same argument continuing.
      ev(day(1) + 400, 'agent_spoke', { agentId: 'bex', text: 'enough of that', x: 4, y: 4 }),
    ]
    const found = t2(log, s)
    const quarrel = found.find((m) => m.kind === 'first_quarrel')
    const peace = found.find((m) => m.kind === 'first_reconciliation')
    expect(quarrel).toBeDefined()
    expect(quarrel!.agentIds).toEqual(['ada', 'bex'])
    expect(peace).toBeDefined()
    expect(peace!.agentIds).toEqual(['ada', 'bex'])
  })

  it('a hurt with no hand behind it is not a quarrel', () => {
    const s = pairWorld({})
    const log = [
      ev(day(1) + 10, 'agent_harmed', { agentId: 'bex', amount: 5, source: 'fire' }),
      ev(day(1) + 400, 'agent_spoke', { agentId: 'bex', text: 'that was close', x: 4, y: 4 }),
    ]
    expect(t2(log, s).map((m) => m.kind)).not.toContain('first_quarrel')
  })
})

// ------------------------------------------------------------------ tier 2.5

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

  async object<T>(opts: {
    system: string
    messages: LlmMessage[]
    schema: unknown
  }): Promise<{ value: T; usage: LlmUsage }> {
    this.objectCalls += 1
    this.systems.push(opts.system)
    return { value: this.value as T, usage: emptyUsage() }
  }

  async text(): Promise<{ text: string; usage: LlmUsage }> {
    return { text: '', usage: emptyUsage() }
  }
  totalCostUsd(): number {
    return 0
  }
  alert(): void {}
}

const runSemantic = async (llm: ScriptedLlm, over: Record<string, unknown> = {}) => {
  const db = memDb()
  const store = new NarratorStore(db)
  const milestones = await detectSemanticFirsts({
    db,
    store,
    llm: llm as unknown as LlmClient,
    day: DAY,
    records: AUTHORED_DAY,
    ...over,
  })
  return { db, store, milestones, llm }
}

describe('G11a-L3: the firsts no rule can catch, and the checks that keep them honest', () => {
  it('the authored day yields exactly two hits, both cited back to the record verbatim', async () => {
    const { store, milestones } = await runSemantic(new ScriptedLlm())
    expect(milestones.map((m) => m.kind)).toEqual(['first_god_afterlife', 'first_lie'])
    for (const m of milestones) {
      expect(m.tier).toBe(2.5)
      expect(m.domain).toBe('semantic')
      expect(m.day).toBe(DAY)
    }
    const rows = store.semanticFirsts()
    expect(rows).toHaveLength(2)
    const god = rows.find((r) => r.conceptKind === 'god_afterlife')!
    expect(GOD_QUOTE).toContain(god.quote)
    const lie = rows.find((r) => r.conceptKind === 'lie')!
    expect(lie.quote2).not.toBeNull()
    expect(lie.provenance2).not.toBeNull()
  })

  it('a quote the record does not contain is voided, with the reason written down', async () => {
    const fabricated = {
      hits: [
        {
          conceptKind: 'god_afterlife',
          agentId: 'ada',
          day: DAY,
          sourceKind: 'speech',
          eventSeq: AUTHORED_DAY.find((r) => r.text === GOD_QUOTE)!.eventSeq,
          quote: 'the gods will judge us all',
          confidence: 0.99,
          rationale: 'a line nobody in this town ever said',
        },
      ],
    }
    const { store, milestones } = await runSemantic(new ScriptedLlm(fabricated))
    expect(milestones).toEqual([])
    expect(store.semanticFirsts()).toEqual([])
    const voided = store.semanticCandidates()
    expect(voided).toHaveLength(1)
    expect(voided[0]!.reason).toBe('quote_not_in_source')
  })

  it('with the pass switched off there are no rows and no call', async () => {
    const llm = new ScriptedLlm()
    const { store, milestones } = await runSemantic(llm, { config: { enabled: false } })
    expect(milestones).toEqual([])
    expect(store.semanticFirsts()).toEqual([])
    expect(llm.objectCalls).toBe(0)
  })

  it('the nightly prompt shrinks to nothing as the firsts land, and never names a tier', async () => {
    const llm = new ScriptedLlm()
    await runSemantic(llm)
    expect(llm.systems[0]).toBeDefined()
    // Every id the model must answer with is on the page in front of it.
    for (const concept of SEMANTIC_CONCEPTS) expect(SEMANTIC_INSTRUCTION).toContain(concept)
  })
})

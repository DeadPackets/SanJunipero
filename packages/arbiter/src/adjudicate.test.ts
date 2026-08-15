import { describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { FakeEmbedder, type LlmClient, type LlmMessage, type LlmUsage } from '@sj/agents'
import { makeArbiter, type AgentCtx, type Arbiter } from './adjudicate.js'
import { openArbiterDb } from './schema.js'
import { RulingsStore } from './rulings.js'
import { FORBIDDEN_FRAMING } from './prompt.js'
import type { Recipe, Verdict } from './verdict.js'

const boilSaltRecipe: Recipe = {
  id: 'recipe:boil_salt',
  name: 'Boil River Water for Salt',
  skillCheck: { track: 'cooking', difficulty: 2 },
  durationTicks: 5,
  costs: [],
  requires: [{ type: 'adjacent_fire' }],
  outcomeTable: [
    { weight: 1, success: true, label: 'A crust of salt forms as the water boils away.', effects: [{ op: 'spawn_item', kind: 'salt', qty: 1, to: 'agent' }] },
    { weight: 1, success: false, label: 'The water boils to nothing; the pot is bare.', effects: [{ op: 'none' }] },
  ],
  rngStream: 'recipe:boil_salt',
  interruptible: true,
  canon: ['fire', 'pottery'],
}

const boilSaltVerdict: Verdict = {
  kind: 'attempt',
  recipe: boilSaltRecipe,
  summary: 'Boil river water until only salt remains.',
}

const basketVerdict: Verdict = {
  kind: 'attempt',
  recipe: {
    id: 'recipe:basket',
    name: 'Weave Reed Basket',
    durationTicks: 4,
    costs: [],
    requires: [{ type: 'held_item', kind: 'reeds', qty: 3 }],
    outcomeTable: [
      { weight: 1, success: true, label: 'The reeds weave into a tight basket.', effects: [{ op: 'spawn_item', kind: 'basket', qty: 1, to: 'agent' }] },
    ],
    rngStream: 'recipe:basket',
    interruptible: true,
    canon: ['fire'],
  },
  summary: 'Weave reeds into a basket.',
}

const impossibleVerdict: Verdict = {
  kind: 'impossible',
  reason: 'You have no reeds here.',
  class: 'insufficient_materials',
}

const ctx: AgentCtx = {
  agentId: 'a1',
  name: 'Tamar',
  skills: { cooking: 80, farming: 120 },
  inventory: [
    { kind: 'wood', qty: 2 },
    { kind: 'clay_pot', qty: 1 },
  ],
  position: { x: 3, y: 5 },
}

function emptyUsage(): LlmUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 }
}

// Scripted LlmClient: never talks to OpenRouter; records object-call count and
// returns whatever verdict the script decides.
class ScriptedLlm {
  objectCalls = 0
  constructor(private readonly respond: (intent: string) => Verdict) {}

  async object<T>(opts: { system: string; messages: LlmMessage[]; schema: unknown }): Promise<{ value: T; usage: LlmUsage }> {
    this.objectCalls += 1
    const content = opts.messages.at(-1)?.content ?? ''
    const intent = content.split('\n').at(-1)?.replace(/^Intent: /, '') ?? ''
    return { value: this.respond(intent) as unknown as T, usage: emptyUsage() }
  }

  async text(): Promise<{ text: string; usage: LlmUsage }> {
    return { text: '', usage: emptyUsage() }
  }

  totalCostUsd(): number {
    return 0
  }

  alert(): void {}
}

async function makeRig(llm: ScriptedLlm): Promise<{ db: Database.Database; arbiter: Arbiter; embedder: FakeEmbedder }> {
  const db = openArbiterDb(':memory:')
  const embedder = await FakeEmbedder.create()
  const arbiter = makeArbiter({ db, llm: llm as unknown as LlmClient, embedder, tick: () => 100 })
  return { db, arbiter, embedder }
}

describe('makeArbiter adjudicate three-stage funnel', () => {
  it('rulebook short-circuit returns map with zero LLM calls', async () => {
    const llm = new ScriptedLlm(() => basketVerdict)
    const { arbiter } = await makeRig(llm)

    arbiter.codify(boilSaltRecipe)

    const verdict = await arbiter.adjudicate('I try to boil river water for salt', ctx)
    expect(verdict).toEqual({ kind: 'map', verb: 'recipe:boil_salt', params: {} })
    expect(llm.objectCalls).toBe(0)
  })

  it('similarity short-circuit returns the stored verdict verbatim with zero LLM calls', async () => {
    const llm = new ScriptedLlm(() => basketVerdict)
    const { db, arbiter, embedder } = await makeRig(llm)

    await new RulingsStore(db, embedder).record('extract salt by boiling river water', boilSaltVerdict, 100)

    const verdict = await arbiter.adjudicate('extract salt by boiling river water', ctx)
    expect(verdict).toEqual(boilSaltVerdict)
    expect(llm.objectCalls).toBe(0)
  })

  it('novel path reaches the LLM exactly once and records the ruling', async () => {
    const llm = new ScriptedLlm(() => basketVerdict)
    const { db, arbiter } = await makeRig(llm)

    const verdict = await arbiter.adjudicate('I weave a basket from reeds', ctx)
    expect(verdict).toEqual(basketVerdict)
    expect(llm.objectCalls).toBe(1)

    const row = db.prepare('SELECT intent_text FROM rulings WHERE intent_text = ?').get('I weave a basket from reeds')
    expect(row).not.toBeUndefined()
  })

  it('impossible path returns, records, and stays framing-free', async () => {
    const llm = new ScriptedLlm(() => impossibleVerdict)
    const { db, arbiter } = await makeRig(llm)

    const verdict = await arbiter.adjudicate('I build a house of smoke', ctx)
    expect(verdict).toEqual(impossibleVerdict)
    expect(llm.objectCalls).toBe(1)
    expect(FORBIDDEN_FRAMING.test(verdict.kind === 'impossible' ? verdict.reason : '')).toBe(false)

    const row = db.prepare('SELECT intent_text FROM rulings WHERE intent_text = ?').get('I build a house of smoke')
    expect(row).not.toBeUndefined()
  })
})

describe('framing-free outputs contract', () => {
  it('every scripted verdict carries framing-free reason/summary/name/label', () => {
    const texts = [
      boilSaltVerdict.summary,
      boilSaltVerdict.recipe.name,
      boilSaltVerdict.recipe.outcomeTable.map((r) => r.label).join('\n'),
      basketVerdict.summary,
      basketVerdict.recipe.name,
      basketVerdict.recipe.outcomeTable.map((r) => r.label).join('\n'),
      impossibleVerdict.reason,
    ]
    for (const text of texts) {
      expect(FORBIDDEN_FRAMING.test(text)).toBe(false)
    }
  })

  it('FORBIDDEN_FRAMING catches a scripted verdict that leaks the machinery', () => {
    expect(FORBIDDEN_FRAMING.test('the AI says no')).toBe(true)
  })
})

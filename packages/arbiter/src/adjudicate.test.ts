import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { EMBEDDING_DIM, FakeEmbedder, type LlmClient, type LlmMessage, type LlmUsage } from '@sj/agents'
import { unregisterVerb } from '@sj/engine'
import { makeArbiter, type AgentCtx, type Arbiter } from './adjudicate.js'
import { openArbiterDb } from './schema.js'
import { ReviewStore } from './review.js'
import { CodexStore } from './codex.js'
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

const basketRecipe: Recipe = {
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
}

const basketVerdict: Verdict = {
  kind: 'attempt',
  recipe: basketRecipe,
  summary: 'Weave reeds into a basket.',
}

const ropeRecipe: Recipe = {
  id: 'recipe:rope',
  name: 'Twist Reeds to Rope',
  durationTicks: 4,
  costs: [],
  requires: [{ type: 'held_item', kind: 'reeds', qty: 2 }],
  outcomeTable: [
    { weight: 1, success: true, label: 'The reeds twist into a strong rope.', effects: [{ op: 'spawn_item', kind: 'rope', qty: 1, to: 'agent' }] },
  ],
  rngStream: 'recipe:rope',
  interruptible: true,
  canon: ['fire'],
}

const ropeVerdict: Verdict = {
  kind: 'attempt',
  recipe: ropeRecipe,
  summary: 'Twist reeds to rope.',
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

// The shared FakeEmbedder is sha256-based: distinct text yields near-orthogonal
// vectors, so a rephrase cannot reach SIMILARITY_SHORT_CIRCUIT through it. This
// deterministic bag-of-words embedder gives token-overlap similarity instead, so
// a word-reorder rephrase (same bag, different normalized name) lands on the
// stored ruling and exercises stage 2 without any live model.
const STOPWORDS = new Set(['a', 'an', 'the', 'for', 'by', 'to', 'of', 'i', 'try', 'want', 'attempt', 'and', 'with'])

function unitVec(bytes: Uint8Array): Float32Array {
  const v = new Float32Array(EMBEDDING_DIM)
  let digest = Buffer.from(bytes)
  let i = 0
  while (i < EMBEDDING_DIM) {
    for (const b of digest) {
      if (i >= EMBEDDING_DIM) break
      v[i] = b / 127.5 - 1
      i += 1
    }
    digest = createHash('sha256').update(digest).digest()
  }
  let norm = 0
  for (const x of v) norm += x * x
  norm = Math.sqrt(norm)
  for (let j = 0; j < v.length; j += 1) v[j]! /= norm
  return v
}

class LexicalEmbedder {
  async embed(text: string): Promise<Float32Array> {
    const v = new Float32Array(EMBEDDING_DIM)
    for (const raw of text.toLowerCase().split(/\W+/)) {
      if (raw === '' || STOPWORDS.has(raw)) continue
      const stem = raw.replace(/(ing|ed|s)$/, '')
      const wv = unitVec(createHash('sha256').update(`w:${stem}`).digest())
      for (let j = 0; j < EMBEDDING_DIM; j += 1) v[j]! += wv[j]!
    }
    let norm = 0
    for (const x of v) norm += x * x
    norm = Math.sqrt(norm)
    if (norm > 0) for (let j = 0; j < EMBEDDING_DIM; j += 1) v[j]! /= norm
    return v
  }
}

type EmbedderLike = { embed(t: string): Promise<Float32Array> }

async function makeRig(llm: ScriptedLlm, embedder?: EmbedderLike): Promise<{ db: Database.Database; arbiter: Arbiter; embedder: EmbedderLike }> {
  const db = openArbiterDb(':memory:')
  const codex = new CodexStore(db)
  codex.insert({ id: 'fire', era: 'agriculture', name: 'Fire', prerequisiteId: null })
  codex.insert({ id: 'pottery', era: 'agriculture', name: 'Pottery', prerequisiteId: null })
  const emb = embedder ?? (await FakeEmbedder.create())
  const arbiter = makeArbiter({ db, llm: llm as unknown as LlmClient, embedder: emb, tick: () => 100 })
  return { db, arbiter, embedder: emb }
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

  it('stage-2 short-circuit resolves an active codified recipe to map with zero LLM calls', async () => {
    const llm = new ScriptedLlm(() => boilSaltVerdict)
    const { db, arbiter, embedder } = await makeRig(llm, new LexicalEmbedder())

    await new RulingsStore(db, embedder).record('weave reeds to basket', basketVerdict, 100)
    arbiter.codify(basketRecipe)

    const verdict = await arbiter.adjudicate('basket weave reeds', ctx)
    expect(verdict).toEqual({ kind: 'map', verb: 'recipe:basket', params: {} })
    expect(llm.objectCalls).toBe(0)
  })

  it('stage-2 short-circuit falls through to the LLM after revert (not the stored verdict)', async () => {
    const llm = new ScriptedLlm(() => impossibleVerdict)
    const { db, arbiter, embedder } = await makeRig(llm, new LexicalEmbedder())

    await new RulingsStore(db, embedder).record('twist reeds to rope', ropeVerdict, 100)
    arbiter.codify(ropeRecipe)
    arbiter.revert('recipe:rope', 'physics wrong')

    const verdict = await arbiter.adjudicate('rope twist reeds', ctx)
    expect(verdict).toEqual(impossibleVerdict)
    expect(llm.objectCalls).toBe(1)
  })

  it('arbiter.revert routes through the review queue, leaving no stale pending disposition', async () => {
    unregisterVerb('recipe:boil_salt')
    const llm = new ScriptedLlm(() => impossibleVerdict)
    const { db, arbiter } = await makeRig(llm)
    const review = new ReviewStore(db)

    const { ruleId } = arbiter.codify(boilSaltRecipe)
    expect(review.pending()).toHaveLength(1)

    arbiter.revert('recipe:boil_salt', 'physics wrong')

    expect(review.pending()).toEqual([])
    const row = db.prepare('SELECT status FROM ruling_reviews WHERE rule_id = ?').get(ruleId) as { status: string }
    expect(row.status).toBe('reverted')
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
      ropeVerdict.summary,
      ropeVerdict.recipe.name,
      ropeVerdict.recipe.outcomeTable.map((r) => r.label).join('\n'),
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

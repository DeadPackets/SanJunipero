import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { EMBEDDING_DIM, FakeEmbedder, type LlmClient, type LlmMessage, type LlmUsage } from '@sj/agents'
import { fold, genesisState, submitIntent, unregisterVerb, VERBS } from '@sj/engine'
import { DEFAULT_CONFIG } from '@sj/shared'
import { makeArbiter, type AgentCtx, type Arbiter } from './adjudicate.js'
import { openArbiterDb } from './schema.js'
import { ReviewStore } from './review.js'
import { CodexStore } from './codex.js'
import { RulingsStore } from './rulings.js'
import { FORBIDDEN_FRAMING } from './prompt.js'
import type { Recipe, Verdict } from './verdict.js'

// A credit for a test that is not about the credit; the two-argument codify is required so
// an uncredited discovery cannot be minted in silence.
const CODIFY_CREDIT = { agentId: 'a1', intent: 'a mind asked for this' }

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
  lastSystem = ''
  constructor(private readonly respond: (intent: string, system: string) => Verdict) {}

  async object<T>(opts: { system: string; messages: LlmMessage[]; schema: unknown }): Promise<{ value: T; usage: LlmUsage }> {
    this.objectCalls += 1
    this.lastSystem = opts.system
    const content = opts.messages.at(-1)?.content ?? ''
    const intent = content.split('\n').at(-1)?.replace(/^Intent: /, '') ?? ''
    return { value: this.respond(intent, opts.system) as unknown as T, usage: emptyUsage() }
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
  codex.insert({ id: 'fire', era: 'handwork', name: 'Fire', prerequisiteId: null })
  codex.insert({ id: 'pottery', era: 'handwork', name: 'Pottery', prerequisiteId: null })
  const emb = embedder ?? (await FakeEmbedder.create())
  const arbiter = makeArbiter({ db, llm: llm as unknown as LlmClient, embedder: emb, tick: () => 100 })
  return { db, arbiter, embedder: emb }
}

describe('makeArbiter adjudicate three-stage funnel', () => {
  it('rulebook short-circuit returns map with zero LLM calls', async () => {
    const llm = new ScriptedLlm(() => basketVerdict)
    const { arbiter } = await makeRig(llm)

    arbiter.codify(boilSaltRecipe, CODIFY_CREDIT)

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
    arbiter.codify(basketRecipe, CODIFY_CREDIT)

    const verdict = await arbiter.adjudicate('basket weave reeds', ctx)
    expect(verdict).toEqual({ kind: 'map', verb: 'recipe:basket', params: {} })
    expect(llm.objectCalls).toBe(0)
  })

  it('stage-2 short-circuit falls through to the LLM after revert (not the stored verdict)', async () => {
    const llm = new ScriptedLlm(() => impossibleVerdict)
    const { db, arbiter, embedder } = await makeRig(llm, new LexicalEmbedder())

    await new RulingsStore(db, embedder).record('twist reeds to rope', ropeVerdict, 100)
    arbiter.codify(ropeRecipe, CODIFY_CREDIT)
    arbiter.revert('recipe:rope', 'physics wrong')

    const verdict = await arbiter.adjudicate('rope twist reeds', ctx)
    expect(verdict).toEqual(impossibleVerdict)
    expect(llm.objectCalls).toBe(1)
  })

  it('stage-2 short-circuit returns stored context-independent impossible verdicts verbatim', async () => {
    const llm = new ScriptedLlm(() => ropeVerdict)
    const { db, arbiter, embedder } = await makeRig(llm, new LexicalEmbedder())
    const stored: Verdict = { kind: 'impossible', reason: 'no such craft exists under the sun', class: 'physically_impossible' }

    await new RulingsStore(db, embedder).record('twist reeds to rope', stored, 100)

    const verdict = await arbiter.adjudicate('rope twist reeds', ctx)
    expect(verdict).toEqual(stored)
    expect(llm.objectCalls).toBe(0)
  })

  it('stage-2 short-circuit falls through to the LLM for stored agent-contextual impossible verdicts', async () => {
    const llm = new ScriptedLlm(() => ropeVerdict)
    const { db, arbiter, embedder } = await makeRig(llm, new LexicalEmbedder())
    const stored: Verdict = { kind: 'impossible', reason: 'You have no reeds here.', class: 'insufficient_materials' }

    await new RulingsStore(db, embedder).record('twist reeds to rope', stored, 100)

    const verdict = await arbiter.adjudicate('rope twist reeds', ctx)
    expect(verdict).toEqual(ropeVerdict)
    expect(llm.objectCalls).toBe(1)
  })

  it('stage-2 short-circuit falls through for stored insufficient_skill impossible verdicts', async () => {
    const llm = new ScriptedLlm(() => ropeVerdict)
    const { db, arbiter, embedder } = await makeRig(llm, new LexicalEmbedder())
    const stored: Verdict = { kind: 'impossible', reason: 'Your hands are not yet practiced enough.', class: 'insufficient_skill' }

    await new RulingsStore(db, embedder).record('twist reeds to rope', stored, 100)

    const verdict = await arbiter.adjudicate('rope twist reeds', ctx)
    expect(verdict).toEqual(ropeVerdict)
    expect(llm.objectCalls).toBe(1)
  })

  it('a hallucinated map verb is never returned or recorded; retry then diegetic impossible', async () => {
    const llm = new ScriptedLlm(() => ({ kind: 'map', verb: 'recipe:ghost_dance', params: {} }))
    const { db, arbiter } = await makeRig(llm)

    const verdict = await arbiter.adjudicate('I dance the ghost dance', ctx)
    expect(verdict.kind).toBe('impossible')
    // Three: a dance is tried on the cheap expressive path first, and this script has no
    // ruling to give it, so it falls through to the two verdict attempts.
    expect(llm.objectCalls).toBe(3)
    // Never recorded — a hallucinated verb must not become immutable precedent.
    const n = (db.prepare('SELECT COUNT(*) AS n FROM rulings').get() as { n: number }).n
    expect(n).toBe(0)
  })

  it('a hallucinated map verb followed by a valid map on retry returns and records the valid one', async () => {
    let call = 0
    const llm = new ScriptedLlm(() => {
      call += 1
      return call === 1
        ? { kind: 'map', verb: 'recipe:ghost_dance', params: {} }
        : { kind: 'map', verb: 'walk', params: { x: 1, y: 1 } }
    })
    const { db, arbiter } = await makeRig(llm)

    const verdict = await arbiter.adjudicate('I wander toward the river', ctx)
    expect(verdict).toEqual({ kind: 'map', verb: 'walk', params: { x: 1, y: 1 } })
    expect(llm.objectCalls).toBe(2)
    const row = db.prepare('SELECT verdict_json FROM rulings').get() as { verdict_json: string }
    expect((JSON.parse(row.verdict_json) as Verdict).kind).toBe('map')
  })

  it('stage-2 short-circuit returns a stored map verdict whose verb is a live engine verb', async () => {
    const llm = new ScriptedLlm(() => impossibleVerdict)
    const { db, arbiter, embedder } = await makeRig(llm, new LexicalEmbedder())
    const stored: Verdict = { kind: 'map', verb: 'walk', params: {} }

    await new RulingsStore(db, embedder).record('twist reeds to rope', stored, 100)

    const verdict = await arbiter.adjudicate('rope twist reeds', ctx)
    expect(verdict).toEqual(stored)
    expect(llm.objectCalls).toBe(0)
  })

  it('stage-2 short-circuit re-checks stored map verdicts pointing at reverted recipe verbs', async () => {
    const llm = new ScriptedLlm(() => impossibleVerdict)
    const { db, arbiter, embedder } = await makeRig(llm, new LexicalEmbedder())
    const stored: Verdict = { kind: 'map', verb: 'recipe:rope', params: {} }

    await new RulingsStore(db, embedder).record('twist reeds to rope', stored, 100)
    arbiter.codify(ropeRecipe, CODIFY_CREDIT)
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

    const { ruleId } = arbiter.codify(boilSaltRecipe, CODIFY_CREDIT)
    expect(review.pending()).toHaveLength(1)

    arbiter.revert('recipe:boil_salt', 'physics wrong')

    expect(review.pending()).toEqual([])
    const row = db.prepare('SELECT status FROM ruling_reviews WHERE rule_id = ?').get(ruleId) as { status: string }
    expect(row.status).toBe('reverted')
  })
})

// Esen's smoked fish — the G9b run-4 regression (t917 and t1213), replayed.
// She stood at a lit hearth holding two fish, in a town whose codex carries
// `smoking_food` as an unearned rung resting on `fire`. Both asks came back
// `impossible / beyond_adjacency`, because the adjudication context named only
// what the town knew. The scripted model below rules the way that model ruled:
// it can only reach for the rung the context puts within its reach.
describe('the adjacency frontier reaches the arbiter (C9 batch-10, user ruling 1)', () => {
  const ESEN_INTENT =
    'I hang the two fish from my hands over the campfire’s smoke, close enough that the heat and smoke bathe them.'

  const esenCtx: AgentCtx = {
    agentId: 'esen',
    name: 'Esen',
    skills: { cooking: 60, fishing: 140 },
    inventory: [{ kind: 'fish', qty: 2 }, { kind: 'clay', qty: 2 }, { kind: 'fiber', qty: 2 }],
    position: { x: 18, y: 16 },
  }

  const smokedFishRecipe: Recipe = {
    id: 'recipe:smoked_fish',
    name: 'Smoke Fish Over the Hearth',
    skillCheck: { track: 'cooking', difficulty: 2 },
    durationTicks: 30,
    costs: [{ kind: 'fish', qty: 2 }],
    requires: [{ type: 'adjacent_fire' }],
    outcomeTable: [
      { weight: 3, success: true, label: 'The fish darken and firm in the smoke.', effects: [{ op: 'spawn_item', kind: 'smoked fish', qty: 2, to: 'agent' }] },
      { weight: 1, success: false, label: 'The fish scorch and fall into the ash.', effects: [{ op: 'none' }] },
    ],
    rngStream: 'recipe:smoked_fish',
    interruptible: true,
    canon: ['smoking_food'],
  }
  const smokedFish: Verdict = { kind: 'attempt', recipe: smokedFishRecipe, summary: 'Hang two fish in the hearth smoke.' }
  const beyondAdjacency: Verdict = {
    kind: 'impossible',
    reason: 'this would need a craft the town has not yet reached',
    class: 'beyond_adjacency',
  }

  // The G9b town's codex: ten practiced rungs and five one step out.
  async function makeSmokehouseRig(llm: ScriptedLlm): Promise<{ db: Database.Database; arbiter: Arbiter }> {
    const db = openArbiterDb(':memory:')
    const codex = new CodexStore(db)
    for (const [id, name] of [['fire', 'Fire'], ['pottery', 'Pottery'], ['weaving', 'Weaving'], ['fishing', 'Fishing']]) {
      codex.insert({ id: id!, era: 'handwork', name: name!, prerequisiteId: null })
    }
    for (const [id, name, prerequisiteId] of [
      ['salt_extraction', 'Salt extraction', 'fire'],
      ['smoking_food', 'Smoking food', 'fire'],
      ['basketry', 'Basketry', 'weaving'],
    ]) {
      codex.insert({ id: id!, era: 'arrangement', name: name!, prerequisiteId: prerequisiteId!, known: false })
    }
    // Two rungs out: it rests on a craft nobody has earned, so it stays off the frontier.
    codex.insert({ id: 'salt_curing', era: 'arrangement', name: 'Salt curing', prerequisiteId: 'salt_extraction', known: false })
    const arbiter = makeArbiter({ db, llm: llm as unknown as LlmClient, embedder: await FakeEmbedder.create(), tick: () => 917 })
    return { db, arbiter }
  }

  it('names the rungs one step out, and only those, in the context the arbiter reads', async () => {
    const llm = new ScriptedLlm(() => beyondAdjacency)
    const { arbiter } = await makeSmokehouseRig(llm)

    await arbiter.adjudicate(ESEN_INTENT, esenCtx)

    expect(llm.lastSystem).toContain('smoking_food')
    expect(llm.lastSystem).toContain('basketry')
    expect(llm.lastSystem).toContain('salt_extraction')
    // Two rungs out is not within reach, and the practiced list is unchanged.
    expect(llm.lastSystem).not.toContain('salt_curing')
    expect(llm.lastSystem).toContain('The town currently knows: fire, pottery, weaving, fishing')
  })

  // Run 5 proved the frontier line arrives and is read; five attempts then died
  // on the adjacency gate carrying ids that were never on it (C9 batch-11).
  it('tells the arbiter that those same ids are the only vocabulary its canon may use', async () => {
    const llm = new ScriptedLlm(() => beyondAdjacency)
    const { arbiter } = await makeSmokehouseRig(llm)

    await arbiter.adjudicate(ESEN_INTENT, esenCtx)

    expect(llm.lastSystem).toContain('Within reach, though nobody here has done it yet: basketry, salt_extraction, smoking_food')
    expect(llm.lastSystem).toContain('every id you put in the recipe\'s canon must be copied exactly from those two lines')
    expect(llm.lastSystem).toContain('An id that appears on neither line is a format error')
  })

  it('rules Esen’s smoked fish an attempt, where run 4 ruled it impossible', async () => {
    const llm = new ScriptedLlm((_intent, system) => (system.includes('smoking_food') ? smokedFish : beyondAdjacency))
    const { db, arbiter } = await makeSmokehouseRig(llm)

    const verdict = await arbiter.adjudicate(ESEN_INTENT, esenCtx)

    expect(verdict.kind, JSON.stringify(verdict)).toBe('attempt')
    if (verdict.kind === 'attempt') expect(verdict.recipe.canon).toEqual(['smoking_food'])
    // The deterministic gate agrees with the context it was given.
    expect(new CodexStore(db).withinAdjacency(['smoking_food'])).toBe(true)
  })

  it('still refuses a rung two steps out, so the frontier widens nothing', async () => {
    const twoStepsOut: Verdict = {
      kind: 'attempt',
      recipe: {
        ...smokedFishRecipe, id: 'recipe:salt_cured_fish', name: 'Salt-Cure the Fish',
        rngStream: 'recipe:salt_cured_fish', canon: ['salt_curing'],
      },
      summary: 'Pack the fish in salt to keep it.',
    }
    const llm = new ScriptedLlm(() => twoStepsOut)
    const { arbiter } = await makeSmokehouseRig(llm)

    const verdict = await arbiter.adjudicate('I pack the fish in salt until it keeps', esenCtx)

    expect(verdict.kind).toBe('impossible')
    if (verdict.kind === 'impossible') expect(verdict.class).toBe('beyond_adjacency')
  })
})

describe('FORBIDDEN_FRAMING enforced over live LLM output', () => {
  it('a framing-tainted attempt is retried, and the clean retry is returned and recorded', async () => {
    let call = 0
    const llm = new ScriptedLlm(() => {
      call += 1
      return call === 1
        ? { ...basketVerdict, summary: 'The AI grants you a basket.' }
        : basketVerdict
    })
    const { db, arbiter } = await makeRig(llm)

    const verdict = await arbiter.adjudicate('I weave reeds into a basket shape', ctx)
    expect(verdict).toEqual(basketVerdict)
    expect(llm.objectCalls).toBe(2)
    const row = db.prepare('SELECT verdict_json FROM rulings').get() as { verdict_json: string }
    expect(FORBIDDEN_FRAMING.test(row.verdict_json)).toBe(false)
  })

  it('an attempt tainted in an outcome label falls back to diegetic impossible and is never recorded', async () => {
    const tainted: Verdict = {
      ...basketVerdict,
      recipe: {
        ...basketRecipe,
        outcomeTable: [{ weight: 1, success: true, label: 'A neural loom hums as the basket forms.', effects: [{ op: 'none' }] }],
      },
    }
    const llm = new ScriptedLlm(() => tainted)
    const { db, arbiter } = await makeRig(llm)

    const verdict = await arbiter.adjudicate('I weave reeds into a basket shape', ctx)
    expect(verdict.kind).toBe('impossible')
    expect(FORBIDDEN_FRAMING.test(verdict.kind === 'impossible' ? verdict.reason : '')).toBe(false)
    expect(llm.objectCalls).toBe(2)
    expect((db.prepare('SELECT COUNT(*) AS n FROM rulings').get() as { n: number }).n).toBe(0)
  })

  it('an impossible verdict with a machinery-leaking reason gets a canned diegetic line, recorded clean', async () => {
    const llm = new ScriptedLlm(() => ({ kind: 'impossible', reason: 'The language model refuses this.', class: 'physically_impossible' }))
    const { db, arbiter } = await makeRig(llm)

    const verdict = await arbiter.adjudicate('I whistle the rain into being', ctx)
    expect(verdict.kind).toBe('impossible')
    if (verdict.kind === 'impossible') {
      expect(FORBIDDEN_FRAMING.test(verdict.reason)).toBe(false)
      expect(verdict.class).toBe('physically_impossible')
    }
    // Two: a whistle reaches the cheap expressive path first and gets no ruling from it.
    expect(llm.objectCalls).toBe(2)
    const row = db.prepare('SELECT verdict_json FROM rulings').get() as { verdict_json: string }
    expect(FORBIDDEN_FRAMING.test(row.verdict_json)).toBe(false)
  })
})

// The ground the asker can see is shown to the arbiter, so the ground the asker can see is
// what a recipe may require: the live run demanded sand for work against a wooden wall.
describe('the ground the arbiter was shown is the ground a recipe may ask for', () => {
  const sandVerdict: Verdict = {
    kind: 'attempt',
    summary: 'Bank the wall with sand.',
    recipe: { ...basketRecipe, id: 'recipe:bank_the_wall', name: 'Bank the Wall', requires: [{ type: 'adjacent_tile', tile: 'sand' }] },
  }
  const seeing = (ground: string[]): AgentCtx => ({ ...ctx, visible: { structures: [], ground } })

  it('refuses ground nobody in sight can point at, and retries instead of minting it', async () => {
    const llm = new ScriptedLlm(() => sandVerdict)
    const { db, arbiter } = await makeRig(llm)

    const verdict = await arbiter.adjudicate('I bank the wall against the wind', seeing(['grass', 'water']))
    expect(verdict.kind).toBe('impossible')
    expect(llm.objectCalls).toBe(2)
    expect((db.prepare('SELECT COUNT(*) AS n FROM rulings').get() as { n: number }).n).toBe(0)
    expect(arbiter.sanity(sandVerdict.kind === 'attempt' ? sandVerdict.recipe : basketRecipe, seeing(['grass'])))
      .toMatch(/sand/)
  })

  it('lets the same recipe through where the sand actually is', async () => {
    const llm = new ScriptedLlm(() => sandVerdict)
    const { arbiter } = await makeRig(llm)

    const verdict = await arbiter.adjudicate('I bank the wall against the wind', seeing(['grass', 'sand']))
    expect(verdict.kind).toBe('attempt')
    expect(llm.objectCalls).toBe(1)
  })

  it('an asker who was shown no world is judged as before', async () => {
    const llm = new ScriptedLlm(() => sandVerdict)
    const { arbiter } = await makeRig(llm)

    expect((await arbiter.adjudicate('I bank the wall against the wind', ctx)).kind).toBe('attempt')
  })
})

describe('retrieval efficiency', () => {
  it('embeds the intent once for retrieval plus once for recording (stages 2 and 3 share one similar call)', async () => {
    const inner = await FakeEmbedder.create()
    let embeds = 0
    const counting = { embed: (t: string) => { embeds += 1; return inner.embed(t) } }
    const llm = new ScriptedLlm(() => impossibleVerdict)
    const { arbiter } = await makeRig(llm, counting)

    await arbiter.adjudicate('I chart the river shallows', ctx)
    expect(embeds).toBe(2)
  })
})

describe('rulebook rehydration on construction', () => {
  const rehydrateRecipe: Recipe = { ...basketRecipe, id: 'recipe:rehydrate_basket', name: 'Rehydrate Basket', rngStream: 'recipe:rehydrate_basket' }
  const revertedRecipe: Recipe = { ...basketRecipe, id: 'recipe:rehydrate_gone', name: 'Rehydrate Gone', rngStream: 'recipe:rehydrate_gone' }

  it('re-registers active codified verbs after a process restart; reverted rows stay out', async () => {
    const llm = new ScriptedLlm(() => basketVerdict)
    const { db, arbiter, embedder } = await makeRig(llm)

    arbiter.codify(rehydrateRecipe, CODIFY_CREDIT)
    arbiter.codify(revertedRecipe, CODIFY_CREDIT)
    arbiter.revert('recipe:rehydrate_gone', 'physics wrong')
    // Simulate restart: the in-memory registry forgets, the db remembers.
    unregisterVerb('recipe:rehydrate_basket')
    expect(VERBS['recipe:rehydrate_basket']).toBeUndefined()

    makeArbiter({ db, llm: llm as unknown as LlmClient, embedder, tick: () => 200 })
    expect(VERBS['recipe:rehydrate_basket']).toBeDefined()
    expect(VERBS['recipe:rehydrate_gone']).toBeUndefined()

    unregisterVerb('recipe:rehydrate_basket')
  })
})

describe('live codification round trip (T20)', () => {
  const matRecipe: Recipe = {
    id: 'recipe:reed_mat',
    name: 'Weave Reed Mat',
    durationTicks: 2,
    costs: [],
    requires: [],
    outcomeTable: [
      { weight: 1, success: true, label: 'The reeds lie flat as a mat.', effects: [{ op: 'spawn_item', kind: 'mat', qty: 1, to: 'agent' }] },
    ],
    rngStream: 'recipe:reed_mat',
    interruptible: true,
    canon: ['fire'],
  }
  const matVerdict: Verdict = { kind: 'attempt', recipe: matRecipe, summary: 'Weave reeds into a mat.' }

  it('adjudicates once, codifies, and the same intent then resolves with no further LLM call', async () => {
    const llm = new ScriptedLlm(() => matVerdict)
    const { arbiter } = await makeRig(llm, new LexicalEmbedder())
    try {
      const first = await arbiter.adjudicate('weave reeds into a mat', ctx)
      expect(first).toEqual(matVerdict)
      expect(llm.objectCalls).toBe(1)

      // Codify: the recipe becomes a verb the engine itself answers for.
      expect(VERBS[matRecipe.id]).toBeUndefined()
      expect(arbiter.codify(matRecipe, CODIFY_CREDIT)).toEqual({ ruleId: expect.any(Number), verb: matRecipe.id })
      expect(VERBS[matRecipe.id]).toBeDefined()

      const state = fold(
        genesisState(DEFAULT_CONFIG),
        { seq: 1, tick: 0, type: 'agent_spawned', payload: { id: 'a1', name: 'Tamar', x: 5, y: 5, ageDays: 7300 } },
        DEFAULT_CONFIG,
      )
      const res = submitIntent(state, DEFAULT_CONFIG, 'a1', matRecipe.id, {})
      expect(res.ok).toBe(true)

      // Adjudicate once, physics forever: the second ask never reaches the model.
      const second = await arbiter.adjudicate('weave reeds into a mat', ctx)
      expect(second).toEqual({ kind: 'map', verb: matRecipe.id, params: {} })
      expect(llm.objectCalls).toBe(1)
    } finally {
      unregisterVerb(matRecipe.id)
    }
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

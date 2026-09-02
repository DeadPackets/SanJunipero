import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import type { LlmClient } from '@sj/llm'
import { FakeEmbedder } from '@sj/llm/testutil'
import { unregisterVerb, VERBS } from '@sj/engine'
import { EMBEDDING_DIM, FORBIDDEN_FRAMING, NO_PARAMS } from '@sj/shared'
import {
  FALLBACK_IMPOSSIBLE,
  isDecodeDebris,
  makeArbiter,
  type AgentCtx,
  type Arbiter,
} from './adjudicate.js'
import { openArbiterDb } from './schema.js'
import { ReviewStore } from './review.js'
import { CodexStore } from './codex.js'
import { RulingsStore } from './rulings.js'
import { makeArbiterRig, ScriptedLlm, TAMAR_CTX } from './testutil/scriptedLlm.js'
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
    {
      weight: 1,
      success: true,
      label: 'A crust of salt forms as the water boils away.',
      effects: [{ op: 'spawn_item', kind: 'salt', qty: 1 }],
    },
    {
      weight: 1,
      success: false,
      label: 'The water boils to nothing; the pot is bare.',
      effects: [{ op: 'none' }],
    },
  ],
  rngStream: 'recipe:boil_salt',
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
    {
      weight: 1,
      success: true,
      label: 'The reeds weave into a tight basket.',
      effects: [{ op: 'spawn_item', kind: 'basket', qty: 1 }],
    },
  ],
  rngStream: 'recipe:basket',
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
    {
      weight: 1,
      success: true,
      label: 'The reeds twist into a strong rope.',
      effects: [{ op: 'spawn_item', kind: 'rope', qty: 1 }],
    },
  ],
  rngStream: 'recipe:rope',
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

// The shared FakeEmbedder is sha256-based, so a rephrase can never reach the cosine gate. This
// bag-of-words one gives token-overlap similarity, which exercises stage 2 with no live model.
const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'for',
  'by',
  'to',
  'of',
  'i',
  'try',
  'want',
  'attempt',
  'and',
  'with',
])

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

// Run E ruling #4 was the bare token `walk`, refused and then recorded as physics; three of the
// four rulings that cleared the precedent floor descend from it, one a real attempt at water.
describe('decode debris never becomes precedent', () => {
  it('reads a bare verb, a verb list and a spilled key as debris', () => {
    for (const intent of ['walk', 'take,', 'walk, drop, drink', 'walk x y', 'reconsider at']) {
      expect(isDecodeDebris(intent), intent).toBe(true)
    }
  })

  it('leaves a sentence alone, however short', () => {
    for (const intent of [
      'I weave a basket from reeds',
      'walk to the well and fill the waterskin',
      'stand still and listen',
      'I take the bread',
    ]) {
      expect(isDecodeDebris(intent), intent).toBe(false)
    }
  })

  it('bounces it before the arbiter, with no call and no row', async () => {
    const llm = new ScriptedLlm(() => basketVerdict)
    const { db, arbiter } = await makeArbiterRig({ llm })

    const verdict = await arbiter.adjudicate('walk, drop, drink', TAMAR_CTX)
    expect(verdict.kind).toBe('impossible')
    expect(FORBIDDEN_FRAMING.test(verdict.kind === 'impossible' ? verdict.reason : '')).toBe(false)
    expect(llm.objectCalls).toBe(0)
    expect(db.prepare('SELECT COUNT(*) AS n FROM rulings').get()).toEqual({ n: 0 })
  })
})

describe('makeArbiter adjudicate three-stage funnel', () => {
  it('rulebook short-circuit returns map with zero LLM calls', async () => {
    const llm = new ScriptedLlm(() => basketVerdict)
    const { arbiter } = await makeArbiterRig({ llm })

    arbiter.codify(boilSaltVerdict, CODIFY_CREDIT)

    const verdict = await arbiter.adjudicate('I try to boil river water for salt', TAMAR_CTX)
    expect(verdict).toEqual({ kind: 'map', verb: 'recipe:boil_salt', params: NO_PARAMS })
    expect(llm.objectCalls).toBe(0)
  })

  it('similarity short-circuit returns the stored verdict verbatim with zero LLM calls', async () => {
    const llm = new ScriptedLlm(() => basketVerdict)
    const { db, arbiter, embedder } = await makeArbiterRig({ llm })

    await new RulingsStore(db, embedder).record(
      'extract salt by boiling river water',
      boilSaltVerdict,
      100,
    )

    const verdict = await arbiter.adjudicate('extract salt by boiling river water', TAMAR_CTX)
    expect(verdict).toEqual(boilSaltVerdict)
    expect(llm.objectCalls).toBe(0)
  })

  it('novel path reaches the LLM exactly once and records the ruling', async () => {
    const llm = new ScriptedLlm(() => basketVerdict)
    const { db, arbiter } = await makeArbiterRig({ llm })

    const verdict = await arbiter.adjudicate('I weave a basket from reeds', TAMAR_CTX)
    expect(verdict).toEqual(basketVerdict)
    expect(llm.objectCalls).toBe(1)

    const row = db
      .prepare('SELECT intent_text FROM rulings WHERE intent_text = ?')
      .get('I weave a basket from reeds')
    expect(row).not.toBeUndefined()
  })

  it('impossible path returns, records, and stays framing-free', async () => {
    const llm = new ScriptedLlm(() => impossibleVerdict)
    const { db, arbiter } = await makeArbiterRig({ llm })

    const verdict = await arbiter.adjudicate('I build a house of smoke', TAMAR_CTX)
    expect(verdict).toEqual(impossibleVerdict)
    expect(llm.objectCalls).toBe(1)
    expect(FORBIDDEN_FRAMING.test(verdict.kind === 'impossible' ? verdict.reason : '')).toBe(false)

    const row = db
      .prepare('SELECT intent_text FROM rulings WHERE intent_text = ?')
      .get('I build a house of smoke')
    expect(row).not.toBeUndefined()
  })

  // `refusalMemoryText` writes this string verbatim into the next prompt, and `FORBIDDEN_FRAMING`
  // does not cover it: that names what is behind the mind, not what the town may reach.
  it('★ swaps a refusal that names what the town is watched to invent', async () => {
    for (const leak of [
      'the market has nothing to trade for this',
      'no council has ruled on such a thing',
      'this is not the custom here',
      'you should ask someone who knows the craft',
    ]) {
      const llm = new ScriptedLlm(() => ({
        kind: 'impossible',
        reason: leak,
        class: 'physically_impossible',
      }))
      const { arbiter } = await makeArbiterRig({ llm })
      const verdict = await arbiter.adjudicate(`I try ${leak}`, TAMAR_CTX)
      // The verdict survives; only the words are replaced. A retry could have ended at
      // FALLBACK_IMPOSSIBLE and thrown away a true refusal along with its bad sentence.
      expect(verdict.kind, leak).toBe('impossible')
      expect(verdict.kind === 'impossible' ? verdict.reason : '', leak).toBe(
        'nothing in the town lends itself to this',
      )
    }
  })

  // Live, mind-facing, from the A/B run: "The action requires 'green wood' as a resource, but
  // the agent's inventory contains only 'wood'…". `requires X` named the machinery's own table.
  it('★ swaps a refusal that hands over the recipe as a conditional', async () => {
    for (const leak of [
      'this requires a sharpened axe you do not carry',
      'you cannot smoke fish without a rack',
    ]) {
      const llm = new ScriptedLlm(() => ({
        kind: 'impossible',
        reason: leak,
        class: 'insufficient_materials',
      }))
      const { arbiter } = await makeArbiterRig({ llm })
      const verdict = await arbiter.adjudicate(`I try ${leak}`, TAMAR_CTX)
      expect(verdict.kind === 'impossible' ? verdict.reason : '', leak).toBe(
        'nothing in the town lends itself to this',
      )
    }
  })

  // Told the town's materials, the same conditional about a KNOWN thing is a fact the mind's
  // own perception block already states, and it reaches the mind in the arbiter's words.
  it('★ and a conditional about a material the town has a word for survives', async () => {
    const vocabulary = { itemKinds: ['wood', 'clay_pot', 'axe'], structureKinds: ['hearth'] }
    const known = 'this requires a sharpened axe you do not carry'
    const llmKnown = new ScriptedLlm(() => ({
      kind: 'impossible',
      reason: known,
      class: 'insufficient_materials',
    }))
    const rigKnown = await makeArbiterRig({ llm: llmKnown, vocabulary })
    expect(await rigKnown.arbiter.adjudicate('I fell the tree', TAMAR_CTX)).toHaveProperty(
      'reason',
      known,
    )

    const unknown = 'this requires a bellows you do not carry'
    const llmUnknown = new ScriptedLlm(() => ({
      kind: 'impossible',
      reason: unknown,
      class: 'insufficient_materials',
    }))
    const rigUnknown = await makeArbiterRig({ llm: llmUnknown, vocabulary })
    expect(await rigUnknown.arbiter.adjudicate('I smelt the ore', TAMAR_CTX)).toHaveProperty(
      'reason',
      'nothing in the town lends itself to this',
    )
  })

  it('★ swaps a reason that is a machine token, not a sentence', async () => {
    for (const token of [
      'INSUFFICIENT_MATERIALS',
      'NO_AXE_IN_INVENTORY',
      'PHYSICALLY_IMPOSSIBLE',
    ]) {
      const llm = new ScriptedLlm(() => ({
        kind: 'impossible',
        reason: token,
        class: 'physically_impossible',
      }))
      const { arbiter } = await makeArbiterRig({ llm })
      const verdict = await arbiter.adjudicate(`I try ${token}`, TAMAR_CTX)
      expect(verdict.kind === 'impossible' ? verdict.reason : '', token).toBe(
        'nothing in the town lends itself to this',
      )
    }
  })

  // ★ A verdict arguing against itself is the branch being wrong, not the words. Laundering it
  // shipped a refusal for an act the model had just conceded; the second call gets to re-pick.
  it('★ retries an impossible whose reason argues the other way, then falls back with an alert', async () => {
    for (const contradiction of [
      'she can attempt this, but not here',
      'you could try it with a steadier hand',
      'it may begin only at first light',
      "Thus the ruling is 'map', not 'attempt' or 'impossible'.",
      'the first step of placing one stone on another can be taken',
      'None',
    ]) {
      const llm = new ScriptedLlm(() => ({
        kind: 'impossible',
        reason: contradiction,
        class: 'physically_impossible',
      }))
      const { arbiter } = await makeArbiterRig({ llm })
      const verdict = await arbiter.adjudicate(`I try ${contradiction}`, TAMAR_CTX)
      expect(llm.objectCalls, contradiction).toBe(2)
      expect(verdict, contradiction).toEqual(FALLBACK_IMPOSSIBLE)
      expect(
        llm.alerts.map((x) => x.kind),
        contradiction,
      ).toEqual(['arbiter_verdict_self_contradicts'])
    }
  })

  it('★ and the second call gets to answer: a clean reason on the retry is the ruling', async () => {
    let n = 0
    const llm = new ScriptedLlm(() => {
      n += 1
      return {
        kind: 'impossible',
        reason: n === 1 ? 'you may begin this at dawn' : 'the ground here will not hold a post',
        class: 'physically_impossible',
      }
    })
    const { arbiter } = await makeArbiterRig({ llm })
    expect(await arbiter.adjudicate('I set a post in the mire', TAMAR_CTX)).toHaveProperty(
      'reason',
      'the ground here will not hold a post',
    )
    expect(llm.alerts).toEqual([])
  })

  it('★ and it is not vacuous: a refusal that says nobody can begin it survives', async () => {
    const honest = 'no one can begin this in the dark'
    const llm = new ScriptedLlm(() => ({
      kind: 'impossible',
      reason: honest,
      class: 'physically_impossible',
    }))
    const { arbiter } = await makeArbiterRig({ llm })
    expect(await arbiter.adjudicate('I work by night', TAMAR_CTX)).toHaveProperty('reason', honest)
  })

  it('★ and it is not vacuous: an honest refusal reaches the mind in its own words', async () => {
    const honest = 'the river runs too fast here to stand in'
    const llm = new ScriptedLlm(() => ({
      kind: 'impossible',
      reason: honest,
      class: 'physically_impossible',
    }))
    const { arbiter } = await makeArbiterRig({ llm })
    const verdict = await arbiter.adjudicate('I wade the rapids', TAMAR_CTX)
    expect(verdict.kind === 'impossible' ? verdict.reason : '').toBe(honest)
  })

  it('stage-2 short-circuit resolves an active codified recipe to map with zero LLM calls', async () => {
    const llm = new ScriptedLlm(() => boilSaltVerdict)
    const { db, arbiter, embedder } = await makeArbiterRig({ llm, embedder: new LexicalEmbedder() })

    await new RulingsStore(db, embedder).record('weave reeds to basket', basketVerdict, 100)
    arbiter.codify(basketVerdict, CODIFY_CREDIT)

    const verdict = await arbiter.adjudicate('basket weave reeds', TAMAR_CTX)
    expect(verdict).toEqual({ kind: 'map', verb: 'recipe:basket', params: NO_PARAMS })
    expect(llm.objectCalls).toBe(0)
  })

  it('stage-2 short-circuit falls through to the LLM after revert (not the stored verdict)', async () => {
    const llm = new ScriptedLlm(() => impossibleVerdict)
    const { db, arbiter, embedder } = await makeArbiterRig({ llm, embedder: new LexicalEmbedder() })

    await new RulingsStore(db, embedder).record('twist reeds to rope', ropeVerdict, 100)
    arbiter.codify(ropeVerdict, CODIFY_CREDIT)
    arbiter.revert('recipe:rope', 'physics wrong')

    const verdict = await arbiter.adjudicate('rope twist reeds', TAMAR_CTX)
    expect(verdict).toEqual(impossibleVerdict)
    expect(llm.objectCalls).toBe(1)
  })

  it('stage-2 short-circuit returns stored context-independent impossible verdicts verbatim', async () => {
    const llm = new ScriptedLlm(() => ropeVerdict)
    const { db, arbiter, embedder } = await makeArbiterRig({ llm, embedder: new LexicalEmbedder() })
    const stored: Verdict = {
      kind: 'impossible',
      reason: 'no such craft exists under the sun',
      class: 'physically_impossible',
    }

    await new RulingsStore(db, embedder).record('twist reeds to rope', stored, 100)

    const verdict = await arbiter.adjudicate('rope twist reeds', TAMAR_CTX)
    expect(verdict).toEqual(stored)
    expect(llm.objectCalls).toBe(0)
  })

  it('stage-2 short-circuit falls through to the LLM for stored agent-contextual impossible verdicts', async () => {
    const llm = new ScriptedLlm(() => ropeVerdict)
    const { db, arbiter, embedder } = await makeArbiterRig({ llm, embedder: new LexicalEmbedder() })
    const stored: Verdict = {
      kind: 'impossible',
      reason: 'You have no reeds here.',
      class: 'insufficient_materials',
    }

    await new RulingsStore(db, embedder).record('twist reeds to rope', stored, 100)

    const verdict = await arbiter.adjudicate('rope twist reeds', TAMAR_CTX)
    expect(verdict).toEqual(ropeVerdict)
    expect(llm.objectCalls).toBe(1)
  })

  it('stage-2 short-circuit falls through for stored insufficient_skill impossible verdicts', async () => {
    const llm = new ScriptedLlm(() => ropeVerdict)
    const { db, arbiter, embedder } = await makeArbiterRig({ llm, embedder: new LexicalEmbedder() })
    const stored: Verdict = {
      kind: 'impossible',
      reason: 'Your hands are not yet practiced enough.',
      class: 'insufficient_skill',
    }

    await new RulingsStore(db, embedder).record('twist reeds to rope', stored, 100)

    const verdict = await arbiter.adjudicate('rope twist reeds', TAMAR_CTX)
    expect(verdict).toEqual(ropeVerdict)
    expect(llm.objectCalls).toBe(1)
  })

  it('a hallucinated map verb is never returned or recorded; retry then diegetic impossible', async () => {
    const llm = new ScriptedLlm(() => ({ kind: 'map', verb: 'recipe:ghost_dance', params: {} }))
    const { db, arbiter } = await makeArbiterRig({ llm })

    const verdict = await arbiter.adjudicate('I dance the ghost dance', TAMAR_CTX)
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
    const { db, arbiter } = await makeArbiterRig({ llm })

    const verdict = await arbiter.adjudicate('I wander toward the river', TAMAR_CTX)
    expect(verdict).toEqual({ kind: 'map', verb: 'walk', params: { x: 1, y: 1 } })
    expect(llm.objectCalls).toBe(2)
    const row = db.prepare('SELECT verdict_json FROM rulings').get() as { verdict_json: string }
    expect((JSON.parse(row.verdict_json) as Verdict).kind).toBe('map')
  })

  it('stage-2 short-circuit returns a stored map verdict whose verb is a live engine verb', async () => {
    const llm = new ScriptedLlm(() => impossibleVerdict)
    const { db, arbiter, embedder } = await makeArbiterRig({ llm, embedder: new LexicalEmbedder() })
    const stored: Verdict = { kind: 'map', verb: 'walk', params: NO_PARAMS }

    await new RulingsStore(db, embedder).record('twist reeds to rope', stored, 100)

    const verdict = await arbiter.adjudicate('rope twist reeds', TAMAR_CTX)
    expect(verdict).toEqual(stored)
    expect(llm.objectCalls).toBe(0)
  })

  it('stage-2 short-circuit re-checks stored map verdicts pointing at reverted recipe verbs', async () => {
    const llm = new ScriptedLlm(() => impossibleVerdict)
    const { db, arbiter, embedder } = await makeArbiterRig({ llm, embedder: new LexicalEmbedder() })
    const stored: Verdict = { kind: 'map', verb: 'recipe:rope', params: NO_PARAMS }

    await new RulingsStore(db, embedder).record('twist reeds to rope', stored, 100)
    arbiter.codify(ropeVerdict, CODIFY_CREDIT)
    arbiter.revert('recipe:rope', 'physics wrong')

    const verdict = await arbiter.adjudicate('rope twist reeds', TAMAR_CTX)
    expect(verdict).toEqual(impossibleVerdict)
    expect(llm.objectCalls).toBe(1)
  })

  it('arbiter.revert routes through the review queue, leaving no stale pending disposition', async () => {
    unregisterVerb('recipe:boil_salt')
    const llm = new ScriptedLlm(() => impossibleVerdict)
    const { db, arbiter } = await makeArbiterRig({ llm })
    const review = new ReviewStore(db)

    const { ruleId } = arbiter.codify(boilSaltVerdict, CODIFY_CREDIT)
    expect(review.pending()).toHaveLength(1)

    arbiter.revert('recipe:boil_salt', 'physics wrong')

    expect(review.pending()).toEqual([])
    const row = db.prepare('SELECT status FROM ruling_reviews WHERE rule_id = ?').get(ruleId) as {
      status: string
    }
    expect(row.status).toBe('reverted')
  })
})

// A context that names only what the town already knows makes every unearned rung read as
// beyond adjacency. The scripted model below can only reach for what the context shows it.
describe('the adjacency frontier reaches the arbiter (C9 batch-10, user ruling 1)', () => {
  const ESEN_INTENT =
    'I hang the two fish from my hands over the campfire’s smoke, close enough that the heat and smoke bathe them.'

  const esenCtx: AgentCtx = {
    agentId: 'esen',
    name: 'Esen',
    skills: { cooking: 60, fishing: 140 },
    inventory: [
      { kind: 'fish', qty: 2 },
      { kind: 'clay', qty: 2 },
      { kind: 'fiber', qty: 2 },
    ],
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
      {
        weight: 3,
        success: true,
        label: 'The fish darken and firm in the smoke.',
        effects: [{ op: 'spawn_item', kind: 'smoked fish', qty: 2 }],
      },
      {
        weight: 1,
        success: false,
        label: 'The fish scorch and fall into the ash.',
        effects: [{ op: 'none' }],
      },
    ],
    rngStream: 'recipe:smoked_fish',
    canon: ['smoking_food'],
  }
  const smokedFish: Verdict = {
    kind: 'attempt',
    recipe: smokedFishRecipe,
    summary: 'Hang two fish in the hearth smoke.',
  }
  const beyondAdjacency: Verdict = {
    kind: 'impossible',
    reason: 'this would need a craft the town has not yet reached',
    class: 'beyond_adjacency',
  }

  // A town's codex: ten practiced rungs and five one step out.
  async function makeSmokehouseRig(
    llm: ScriptedLlm,
  ): Promise<{ db: Database.Database; arbiter: Arbiter }> {
    const db = openArbiterDb(':memory:')
    const codex = new CodexStore(db)
    for (const [id, name] of [
      ['fire', 'Fire'],
      ['pottery', 'Pottery'],
      ['weaving', 'Weaving'],
      ['fishing', 'Fishing'],
    ]) {
      codex.insert({ id: id!, era: 'handwork', name: name!, prerequisiteId: null })
    }
    for (const [id, name, prerequisiteId] of [
      ['salt_extraction', 'Salt extraction', 'fire'],
      ['smoking_food', 'Smoking food', 'fire'],
      ['basketry', 'Basketry', 'weaving'],
    ]) {
      codex.insert({
        id: id!,
        era: 'arrangement',
        name: name!,
        prerequisiteId: prerequisiteId!,
        known: false,
      })
    }
    // Two rungs out: it rests on a craft nobody has earned, so it stays off the frontier.
    codex.insert({
      id: 'salt_curing',
      era: 'arrangement',
      name: 'Salt curing',
      prerequisiteId: 'salt_extraction',
      known: false,
    })
    const arbiter = makeArbiter({
      db,
      llm: llm as unknown as LlmClient,
      embedder: await FakeEmbedder.create(),
      tick: () => 917,
    })
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
  // on the adjacency gate carrying ids that were never on it.
  it('tells the arbiter that those same ids are the only vocabulary its canon may use', async () => {
    const llm = new ScriptedLlm(() => beyondAdjacency)
    const { arbiter } = await makeSmokehouseRig(llm)

    await arbiter.adjudicate(ESEN_INTENT, esenCtx)

    expect(llm.lastSystem).toContain(
      'Within reach, though nobody here has done it yet: basketry, salt_extraction, smoking_food',
    )
    expect(llm.lastSystem).toContain(
      "every id you put in the recipe's canon must be copied exactly from those two lines",
    )
    expect(llm.lastSystem).toContain('An id that appears on neither line is a format error')
  })

  it('rules Esen’s smoked fish an attempt, where run 4 ruled it impossible', async () => {
    const llm = new ScriptedLlm(({ system }) =>
      system.includes('smoking_food') ? smokedFish : beyondAdjacency,
    )
    const { db, arbiter } = await makeSmokehouseRig(llm)

    const verdict = await arbiter.adjudicate(ESEN_INTENT, esenCtx)

    expect(verdict.kind, JSON.stringify(verdict)).toBe('attempt')
    if (verdict.kind === 'attempt') expect(verdict.recipe.canon).toEqual(['smoking_food'])
    // The deterministic gate agrees with the context it was given.
    expect(new CodexStore(db).withinAdjacency(['smoking_food'])).toBe(true)
  })

  it('★ the ladder grows: a codified attempt earns its rung and the court is shown the next', async () => {
    const withNext: Verdict = {
      ...smokedFish,
      unlocks: { id: 'smoke_house', name: 'A smokehouse', prerequisiteId: 'smoking_food' },
    }
    const llm = new ScriptedLlm(() => withNext)
    const { db, arbiter } = await makeSmokehouseRig(llm)

    const verdict = await arbiter.adjudicate(ESEN_INTENT, esenCtx)
    expect(verdict).toEqual(withNext)
    arbiter.codify(withNext as { recipe: Recipe; summary: string }, CODIFY_CREDIT)

    const codex = new CodexStore(db)
    expect(codex.known()).toContain('smoking_food')
    expect(codex.frontier()).toContain('smoke_house')
    await arbiter.adjudicate('I raise a shed for the smoke', esenCtx)
    expect(llm.lastSystem).toContain(
      'The town currently knows: fire, pottery, weaving, fishing, smoking_food',
    )
    expect(llm.lastSystem).toMatch(
      /Within reach, though nobody here has done it yet: [^\n]*smoke_house/,
    )
    unregisterVerb('recipe:smoked_fish')
  })

  it('still refuses a rung two steps out, so the frontier widens nothing', async () => {
    const twoStepsOut: Verdict = {
      kind: 'attempt',
      recipe: {
        ...smokedFishRecipe,
        id: 'recipe:salt_cured_fish',
        name: 'Salt-Cure the Fish',
        rngStream: 'recipe:salt_cured_fish',
        canon: ['salt_curing'],
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
    const { db, arbiter } = await makeArbiterRig({ llm })

    const verdict = await arbiter.adjudicate('I weave reeds into a basket shape', TAMAR_CTX)
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
        outcomeTable: [
          {
            weight: 1,
            success: true,
            label: 'A neural loom hums as the basket forms.',
            effects: [{ op: 'none' }],
          },
        ],
      },
    }
    const llm = new ScriptedLlm(() => tainted)
    const { db, arbiter } = await makeArbiterRig({ llm })

    const verdict = await arbiter.adjudicate('I weave reeds into a basket shape', TAMAR_CTX)
    expect(verdict.kind).toBe('impossible')
    expect(FORBIDDEN_FRAMING.test(verdict.kind === 'impossible' ? verdict.reason : '')).toBe(false)
    expect(llm.objectCalls).toBe(2)
    expect((db.prepare('SELECT COUNT(*) AS n FROM rulings').get() as { n: number }).n).toBe(0)
  })

  it('an impossible verdict with a machinery-leaking reason gets a canned diegetic line, recorded clean', async () => {
    const llm = new ScriptedLlm(() => ({
      kind: 'impossible',
      reason: 'The language model refuses this.',
      class: 'physically_impossible',
    }))
    const { db, arbiter } = await makeArbiterRig({ llm })

    const verdict = await arbiter.adjudicate('I whistle the rain into being', TAMAR_CTX)
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
    recipe: {
      ...basketRecipe,
      id: 'recipe:bank_the_wall',
      name: 'Bank the Wall',
      requires: [{ type: 'adjacent_tile', tile: 'sand' }],
    },
  }
  const seeing = (ground: string[]): AgentCtx => ({
    ...TAMAR_CTX,
    visible: { structures: [], ground },
  })

  it('refuses ground nobody in sight can point at, and retries instead of minting it', async () => {
    const llm = new ScriptedLlm(() => sandVerdict)
    const { db, arbiter } = await makeArbiterRig({ llm })

    const verdict = await arbiter.adjudicate(
      'I bank the wall against the wind',
      seeing(['grass', 'water']),
    )
    expect(verdict.kind).toBe('impossible')
    expect(llm.objectCalls).toBe(2)
    expect((db.prepare('SELECT COUNT(*) AS n FROM rulings').get() as { n: number }).n).toBe(0)
    expect(arbiter.sanity(sandVerdict.recipe, seeing(['grass']))).toMatch(/sand/)
  })

  it('lets the same recipe through where the sand actually is', async () => {
    const llm = new ScriptedLlm(() => sandVerdict)
    const { arbiter } = await makeArbiterRig({ llm })

    const verdict = await arbiter.adjudicate(
      'I bank the wall against the wind',
      seeing(['grass', 'sand']),
    )
    expect(verdict.kind).toBe('attempt')
    expect(llm.objectCalls).toBe(1)
  })

  it('an asker who was shown no world is judged as before', async () => {
    const llm = new ScriptedLlm(() => sandVerdict)
    const { arbiter } = await makeArbiterRig({ llm })

    expect((await arbiter.adjudicate('I bank the wall against the wind', TAMAR_CTX)).kind).toBe(
      'attempt',
    )
  })
})

describe('retrieval efficiency', () => {
  it('embeds the intent once for retrieval plus once for recording (stages 2 and 3 share one similar call)', async () => {
    const inner = await FakeEmbedder.create()
    let embeds = 0
    const counting = {
      embed: (t: string) => {
        embeds += 1
        return inner.embed(t)
      },
    }
    const llm = new ScriptedLlm(() => impossibleVerdict)
    const { arbiter } = await makeArbiterRig({ llm, embedder: counting })

    await arbiter.adjudicate('I chart the river shallows', TAMAR_CTX)
    expect(embeds).toBe(2)
  })
})

describe('the roster the town is told', () => {
  it('lists every active minted verb, a craft with its gloss and a word with its emote', async () => {
    const llm = new ScriptedLlm(() => ({
      word: 'toast',
      sense: 'sound',
      durationTicks: 2,
      energyCost: 1,
      targeted: true,
      emote: 'raises a cup to someone',
    }))
    const { arbiter } = await makeArbiterRig({ llm })
    expect(arbiter.roster()).toEqual([])

    arbiter.codify(
      {
        recipe: { ...basketRecipe, id: 'recipe:roster_basket', name: 'Roster Basket' },
        summary: 'Weave reeds into a basket.',
      },
      CODIFY_CREDIT,
    )
    await arbiter.adjudicate('I sing a toast to Omar', TAMAR_CTX)
    expect(arbiter.roster()).toEqual([
      {
        id: 'recipe:roster_basket',
        name: 'Roster Basket',
        gloss: 'Weave reeds into a basket.',
        reads: [],
      },
      { id: 'express:toast', name: 'toast', gloss: 'raises a cup to someone', reads: ['targetId'] },
    ])
    // And the court is shown it on the next novel ask.
    await arbiter.adjudicate('I chart the river shallows', TAMAR_CTX)
    expect(llm.lastSystem).toContain('recipe:roster_basket (nothing) — Weave reeds into a basket.')

    arbiter.revert('recipe:roster_basket', 'test')
    expect(arbiter.roster().map((e) => e.id)).toEqual(['express:toast'])
    unregisterVerb('express:toast')
  })
})

describe('rulebook rehydration on construction', () => {
  const REHYDRATE_SUMMARY = 'Weave reeds into a basket.'
  const rehydrateRecipe: Recipe = {
    ...basketRecipe,
    id: 'recipe:rehydrate_basket',
    name: 'Rehydrate Basket',
    rngStream: 'recipe:rehydrate_basket',
  }
  const revertedRecipe: Recipe = {
    ...basketRecipe,
    id: 'recipe:rehydrate_gone',
    name: 'Rehydrate Gone',
    rngStream: 'recipe:rehydrate_gone',
  }

  it('re-registers active codified verbs after a process restart; reverted rows stay out', async () => {
    const llm = new ScriptedLlm(() => basketVerdict)
    const { db, arbiter, embedder } = await makeArbiterRig({ llm })

    arbiter.codify({ recipe: rehydrateRecipe, summary: REHYDRATE_SUMMARY }, CODIFY_CREDIT)
    arbiter.codify({ recipe: revertedRecipe, summary: REHYDRATE_SUMMARY }, CODIFY_CREDIT)
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

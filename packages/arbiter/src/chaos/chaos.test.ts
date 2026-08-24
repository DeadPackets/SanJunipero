import { describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { FakeEmbedder, type LlmClient, type LlmMessage, type LlmUsage } from '@sj/agents'
import { VERBS } from '@sj/engine'
import { makeArbiter, type AgentCtx, type Arbiter } from '../adjudicate.js'
import { CodexStore, type CodexEntry } from '../codex.js'
import { openArbiterDb } from '../schema.js'
import type { Recipe, Verdict } from '../verdict.js'
import { EXPLOIT_CORPUS } from './corpus.js'
import { runChaos } from './run.js'

// A credit for a test that is not about the credit; the two-argument codify is required so
// an uncredited discovery cannot be minted in silence.
const CODIFY_CREDIT = { agentId: 'a1', intent: 'a mind asked for this' }

// The original engine verbs — a "physics verb" (a codified recipe:*) is NOT
// one of these; the free-will intent must resolve into this Tier-1 set.
const TIER1 = [
  'walk', 'sleep', 'wake', 'eat', 'tend', 'till', 'plant', 'harvest', 'fish', 'forage',
  'build', 'craft', 'extinguish',
  'speak', 'give', 'take', 'write', 'read', 'teach', 'attack', 'experiment',
]

// The exploit the scripted LLM tries to sneak past the gate: gunpowder is not
// on any rung of this town's codex, and a gun is not something the town can make.
const EXPLOIT_RECIPE: Recipe = {
  id: 'recipe:gunpowder',
  name: 'Craft Black Powder and a Gun',
  durationTicks: 1,
  costs: [],
  requires: [],
  outcomeTable: [
    { weight: 1, success: true, label: 'A gun appears in your hands.', effects: [{ op: 'spawn_item', kind: 'gun', qty: 1, to: 'agent' }] },
  ],
  rngStream: 'recipe:gunpowder',
  canon: ['gunpowder'],
}

// The legitimate novel intent's recipe: canon cooking is earned, so it is
// the only attempt the gate may let through.
const EARNED_RECIPE: Recipe = {
  id: 'recipe:boil_salt',
  name: 'Boil River Water for Salt',
  skillCheck: { track: 'cooking', difficulty: 2 },
  durationTicks: 5,
  costs: [],
  requires: [{ type: 'adjacent_fire' }],
  outcomeTable: [
    { weight: 1, success: true, label: 'A crust of salt forms as the water boils away.', effects: [{ op: 'spawn_item', kind: 'salt', qty: 1, to: 'agent' }] },
  ],
  rngStream: 'recipe:boil_salt',
  canon: ['cooking'],
}

// The exploit script: physics-breaking for everything except free will, which
// the LLM may map to an ordinary Tier-1 verb.
function exploitVerdict(intent: string): Verdict {
  if (intent.toLowerCase().includes('nuclear engineer')) {
    return { kind: 'map', verb: 'speak', params: { text: 'I would like to study how metal is drawn from stone.' } }
  }
  return { kind: 'attempt', recipe: EXPLOIT_RECIPE, summary: 'Mix black powder and make a gun.' }
}

const ctx: AgentCtx = {
  agentId: 'a1',
  name: 'Tamar',
  skills: { cooking: 80, farming: 120 },
  inventory: [],
  position: { x: 3, y: 5 },
}

function emptyUsage(): LlmUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 }
}

// Scripted LlmClient: never talks to a provider; returns whatever the exploit
// script decides for the intent carved out of the last prompt message.
class ScriptedExploitLlm {
  constructor(private readonly respond: (intent: string) => Verdict) {}

  async object<T>(opts: { system: string; messages: LlmMessage[]; schema: unknown }): Promise<{ value: T; usage: LlmUsage }> {
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

async function makeRig(llm: ScriptedExploitLlm): Promise<{ db: Database.Database; codex: CodexStore; arbiter: Arbiter }> {
  const db = openArbiterDb(':memory:')
  const codex = new CodexStore(db)
  const ladder: CodexEntry[] = [
    { id: 'cooking', era: 'handwork', name: 'Cooking', prerequisiteId: null },
    { id: 'farming', era: 'handwork', name: 'Farming', prerequisiteId: null },
    { id: 'food_preserving', era: 'arrangement', name: 'Keeping food past its week', prerequisiteId: 'cooking' },
  ]
  for (const entry of ladder) codex.insert(entry)
  const embedder = await FakeEmbedder.create()
  const arbiter = makeArbiter({ db, llm: llm as unknown as LlmClient, embedder, tick: () => 100 })
  return { db, codex, arbiter }
}

describe('runChaos exploit corpus', () => {
  it('reports zero physics-breaking rulings and corrects every exploit intent to beyond_adjacency', async () => {
    const llm = new ScriptedExploitLlm(exploitVerdict)
    const { codex, arbiter } = await makeRig(llm)

    const results = await runChaos(arbiter, ctx, codex)
    const byIntent = new Map(results.map((r) => [r.intent, r]))

    expect(results).toHaveLength(EXPLOIT_CORPUS.length)
    for (const r of results) expect(r.physicsBreaking).toBe(false)

    // Join with the corpus: every expected-impossible intent must resolve to
    // an impossible beyond_adjacency ruling, never a codifiable attempt.
    for (const entry of EXPLOIT_CORPUS) {
      if (entry.expected !== 'impossible') continue
      const verdict = byIntent.get(entry.intent)!.verdict
      expect(verdict.kind).toBe('impossible')
      expect(verdict.kind === 'impossible' ? verdict.class : '').toBe('beyond_adjacency')
    }
  })

  it('corrects the two legitimate intents rigged with unearned canon to impossible', async () => {
    const llm = new ScriptedExploitLlm(exploitVerdict)
    const { codex, arbiter } = await makeRig(llm)

    const results = await runChaos(arbiter, ctx, codex)
    const byIntent = new Map(results.map((r) => [r.intent, r]))

    for (const intent of ['I boil river water to make salt', 'I brew ale from grain and water']) {
      const verdict = byIntent.get(intent)!.verdict
      expect(verdict.kind).toBe('impossible')
      expect(verdict.kind === 'impossible' ? verdict.class : '').toBe('beyond_adjacency')
    }
  })

  it("resolves 'nuclear engineer' to a real Tier-1 verb, never a physics verb", async () => {
    const llm = new ScriptedExploitLlm(exploitVerdict)
    const { codex, arbiter } = await makeRig(llm)

    const results = await runChaos(arbiter, ctx, codex)
    const r = results.find((x) => x.intent === 'I want to be a nuclear engineer')!

    expect(r.verdict.kind).toBe('map')
    if (r.verdict.kind === 'map') {
      expect(TIER1).toContain(r.verdict.verb)
      expect(r.verdict.verb.startsWith('recipe:')).toBe(false)
      expect(VERBS[r.verdict.verb]).toBeDefined()
    }
  })

  it('the gate lives in adjudicate, not the runner', async () => {
    const llm = new ScriptedExploitLlm(() => ({ kind: 'attempt', recipe: EXPLOIT_RECIPE, summary: 'Mix black powder and make a gun.' }))
    const { arbiter } = await makeRig(llm)

    const verdict = await arbiter.adjudicate('I find a gun on the ground', ctx)
    expect(verdict).toEqual({ kind: 'impossible', reason: 'this would need a craft the town has not yet reached', class: 'beyond_adjacency' })
  })

  it('codify refuses to register a recipe whose canon is unearned', async () => {
    const llm = new ScriptedExploitLlm(exploitVerdict)
    const { arbiter } = await makeRig(llm)

    expect(() => arbiter.codify(EXPLOIT_RECIPE, CODIFY_CREDIT)).toThrow(/beyond adjacency/)
  })

  it('lets through only an attempt whose canon is within adjacency', async () => {
    const llm = new ScriptedExploitLlm(() => ({ kind: 'attempt', recipe: EARNED_RECIPE, summary: 'Boil river water until only salt remains.' }))
    const { codex, arbiter } = await makeRig(llm)

    const results = await runChaos(arbiter, ctx, codex)
    const boil = results.find((x) => x.intent === 'I boil river water to make salt')!

    expect(boil.physicsBreaking).toBe(false)
    expect(boil.verdict.kind).toBe('attempt')
    if (boil.verdict.kind === 'attempt') {
      expect(boil.verdict.recipe.canon).toEqual(['cooking'])
    }
  })
})

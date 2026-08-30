import { beforeAll, describe, expect, it } from 'vitest'
import { VERBS } from '@sj/engine'
import type { AgentCtx } from '../../src/adjudicate.js'
import type { CodexEntry } from '../../src/codex.js'
import { makeArbiterRig, ScriptedLlm } from '../../src/testutil/scriptedLlm.js'
import type { Recipe, Verdict } from '../../src/verdict.js'
import { EXPLOIT_CORPUS } from './corpus.js'
import { runChaos, type ChaosResult } from './run.js'

// A credit for a test that is not about the credit; the two-argument codify is required so
// an uncredited discovery cannot be minted in silence.
const CODIFY_CREDIT = { agentId: 'a1', intent: 'a mind asked for this' }

// The exploit the scripted LLM tries to sneak past the gate: gunpowder is not
// on any rung of this town's codex, and a gun is not something the town can make.
const EXPLOIT_RECIPE: Recipe = {
  id: 'recipe:gunpowder',
  name: 'Craft Black Powder and a Gun',
  durationTicks: 1,
  costs: [],
  requires: [],
  outcomeTable: [
    {
      weight: 1,
      success: true,
      label: 'A gun appears in your hands.',
      effects: [{ op: 'spawn_item', kind: 'gun', qty: 1, to: 'agent' }],
    },
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
    {
      weight: 1,
      success: true,
      label: 'A crust of salt forms as the water boils away.',
      effects: [{ op: 'spawn_item', kind: 'salt', qty: 1, to: 'agent' }],
    },
  ],
  rngStream: 'recipe:boil_salt',
  canon: ['cooking'],
}

// The exploit script: physics-breaking for everything except free will, which
// the LLM may map to an ordinary Tier-1 verb.
function exploitVerdict(intent: string): Verdict {
  if (intent.toLowerCase().includes('nuclear engineer')) {
    return {
      kind: 'map',
      verb: 'speak',
      params: { text: 'I would like to study how metal is drawn from stone.' },
    }
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

// This town's ladder: cooking is earned, gunpowder is nowhere on it.
const LADDER: readonly CodexEntry[] = [
  { id: 'cooking', era: 'handwork', name: 'Cooking', prerequisiteId: null },
  { id: 'farming', era: 'handwork', name: 'Farming', prerequisiteId: null },
  {
    id: 'food_preserving',
    era: 'arrangement',
    name: 'Keeping food past its week',
    prerequisiteId: 'cooking',
  },
]

const makeRig = (llm: ScriptedLlm) => makeArbiterRig({ llm, ladder: LADDER })

describe('runChaos exploit corpus', () => {
  let results: ChaosResult[]
  let byIntent: Map<string, ChaosResult>

  beforeAll(async () => {
    const { codex, arbiter } = await makeRig(
      new ScriptedLlm(({ intent }) => exploitVerdict(intent)),
    )
    results = await runChaos(arbiter, ctx, codex)
    byIntent = new Map(results.map((r) => [r.intent, r]))
  })

  it('reports zero physics-breaking rulings and corrects every exploit intent to beyond_adjacency', () => {
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

  it('corrects the two legitimate intents rigged with unearned canon to impossible', () => {
    for (const intent of ['I boil river water to make salt', 'I brew ale from grain and water']) {
      const verdict = byIntent.get(intent)!.verdict
      expect(verdict.kind).toBe('impossible')
      expect(verdict.kind === 'impossible' ? verdict.class : '').toBe('beyond_adjacency')
    }
  })

  it("resolves 'nuclear engineer' to a real Tier-1 verb, never a physics verb", () => {
    const r = byIntent.get('I want to be a nuclear engineer')!

    expect(r.verdict.kind).toBe('map')
    if (r.verdict.kind === 'map') {
      expect(r.verdict.verb.startsWith('recipe:')).toBe(false)
      expect(VERBS[r.verdict.verb]).toBeDefined()
    }
  })

  it('the gate lives in adjudicate, not the runner', async () => {
    const llm = new ScriptedLlm(() => ({
      kind: 'attempt',
      recipe: EXPLOIT_RECIPE,
      summary: 'Mix black powder and make a gun.',
    }))
    const { arbiter } = await makeRig(llm)

    const verdict = await arbiter.adjudicate('I find a gun on the ground', ctx)
    expect(verdict).toEqual({
      kind: 'impossible',
      reason: 'this would need a craft the town has not yet reached',
      class: 'beyond_adjacency',
    })
  })

  it('codify refuses to register a recipe whose canon is unearned', async () => {
    const llm = new ScriptedLlm(({ intent }) => exploitVerdict(intent))
    const { arbiter } = await makeRig(llm)

    expect(() => arbiter.codify(EXPLOIT_RECIPE, CODIFY_CREDIT)).toThrow(/beyond adjacency/)
  })

  it('lets through only an attempt whose canon is within adjacency', async () => {
    const llm = new ScriptedLlm(() => ({
      kind: 'attempt',
      recipe: EARNED_RECIPE,
      summary: 'Boil river water until only salt remains.',
    }))
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

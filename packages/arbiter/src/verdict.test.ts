import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { IntentParamsSchema } from '@sj/agents'
import { ExpressiveParams } from './expressive.js'
import {
  OutcomeEffectSchema,
  OutcomeTableSchema,
  RecipeSchema,
  VerdictSchema,
  rollOutcomeTable,
  skillFactor,
  type OutcomeRow,
  type Recipe,
} from './verdict.js'

const validRecipe: Recipe = {
  id: 'recipe:boil_salt',
  name: 'Boil Salt',
  durationTicks: 6,
  costs: [{ kind: 'firewood', qty: 1 }],
  requires: [{ type: 'held_item', kind: 'clay_pot', qty: 1 }],
  outcomeTable: [
    { weight: 1, success: true, label: 'The water boils away, leaving a crust of salt.', effects: [{ op: 'spawn_item', kind: 'salt', qty: 1, to: 'agent' }] },
    { weight: 1, success: false, label: 'The pot cracks and the water is lost.', effects: [{ op: 'none' }] },
  ],
  rngStream: 'craft',
  canon: ['fire'],
}

const validMap = { kind: 'map' as const, verb: 'craft', params: { recipe: 'recipe:boil_salt' } }
const validAttempt = { kind: 'attempt' as const, recipe: validRecipe, summary: 'Boil river water to extract salt.' }
const validImpossible = { kind: 'impossible' as const, reason: 'No fire is available.', class: 'physically_impossible' as const }

describe('VerdictSchema', () => {
  it('parses valid map, attempt, and impossible verdicts via the kind discriminator', () => {
    const map = VerdictSchema.parse(validMap)
    expect(map.kind).toBe('map')
    if (map.kind === 'map') {
      expect(map.verb).toBe('craft')
      expect(map.params.recipe).toBe('recipe:boil_salt')
    }

    const attempt = VerdictSchema.parse(validAttempt)
    expect(attempt.kind).toBe('attempt')
    if (attempt.kind === 'attempt') {
      expect(attempt.recipe.id).toBe('recipe:boil_salt')
      expect(attempt.summary).toBe('Boil river water to extract salt.')
    }

    const impossible = VerdictSchema.parse(validImpossible)
    expect(impossible.kind).toBe('impossible')
    if (impossible.kind === 'impossible') {
      expect(impossible.reason).toBe('No fire is available.')
      expect(impossible.class).toBe('physically_impossible')
    }
  })

  it('emits a grammar a constrained decoder can compile: no propertyNames, in either direction', () => {
    // `z.record` puts `propertyNames` in the emitted schema and a grammar compiler refuses it
    // outright, so the arbiter caller would break on the next such provider.
    for (const io of ['input', 'output'] as const) {
      expect(JSON.stringify(z.toJSONSchema(VerdictSchema, { io })), io).not.toContain('propertyNames')
    }
  })

  it('names every parameter a mapped verb can be handed, and the two schemas cannot drift', () => {
    type Branch = { properties: { kind: { const: string }; params?: { properties?: Record<string, unknown> } } }
    const emitted = z.toJSONSchema(VerdictSchema, { io: 'input' }) as unknown as { oneOf: Branch[] }
    const mapBranch = emitted.oneOf.find((b) => b.properties.kind.const === 'map')!
    const named = Object.keys(mapBranch.properties.params?.properties ?? {})
    // Everything the turn caller can name, the arbiter can map to.
    for (const key of Object.keys(IntentParamsSchema.shape)) expect(named).toContain(key)
    // The arbiter's own expressive verb takes `targetId`, which is in that set.
    for (const key of Object.keys(ExpressiveParams.shape)) expect(named).toContain(key)
  })

  it('stays loose, so a verb minted at runtime can be handed a parameter nobody has written down', () => {
    const v = VerdictSchema.parse({ kind: 'map', verb: 'express:hum', params: { whittledFrom: 'ash' } })
    expect(v.kind).toBe('map')
    if (v.kind === 'map') expect(v.params.whittledFrom).toBe('ash')
  })

  it('rejects an extra key via strict', () => {
    expect(() => VerdictSchema.parse({ kind: 'map', verb: 'x', params: {}, bogus: 1 })).toThrow(/bogus/)
  })

  it('rejects an unknown kind (closed union)', () => {
    expect(VerdictSchema.safeParse({ kind: 'nuke' }).success).toBe(false)
  })
})

describe('OutcomeTableSchema', () => {
  it('rejects an empty table via min(1)', () => {
    expect(OutcomeTableSchema.safeParse([]).success).toBe(false)
  })

  it('rejects a weight of 0', () => {
    const row = { weight: 0, success: true, label: 'x', effects: [{ op: 'none' }] }
    expect(OutcomeTableSchema.safeParse([row]).success).toBe(false)
  })
})

describe('RecipeSchema', () => {
  it('rejects an id missing the recipe: prefix', () => {
    expect(RecipeSchema.safeParse({ ...validRecipe, id: 'boil_salt' }).success).toBe(false)
  })

  it('rejects difficulty 0 and 11', () => {
    const withSkill = { ...validRecipe, skillCheck: { track: 'cooking', difficulty: 0 } }
    expect(RecipeSchema.safeParse(withSkill).success).toBe(false)
    expect(RecipeSchema.safeParse({ ...validRecipe, skillCheck: { track: 'cooking', difficulty: 11 } }).success).toBe(false)
  })
})

describe('OutcomeEffectSchema', () => {
  it('rejects spawn_item missing the to field', () => {
    expect(OutcomeEffectSchema.safeParse({ op: 'spawn_item', kind: 'salt', qty: 1 }).success).toBe(false)
  })

  it('rejects an unknown op — the whitelist is closed', () => {
    expect(OutcomeEffectSchema.safeParse({ op: 'nuke' }).success).toBe(false)
  })
})

describe('effect magnitude caps (out-of-range LLM verdicts fail schema parse)', () => {
  it('caps spawn_item qty at 20', () => {
    expect(OutcomeEffectSchema.safeParse({ op: 'spawn_item', kind: 'salt', qty: 20, to: 'agent' }).success).toBe(true)
    expect(OutcomeEffectSchema.safeParse({ op: 'spawn_item', kind: 'salt', qty: 21, to: 'agent' }).success).toBe(false)
    expect(OutcomeEffectSchema.safeParse({ op: 'spawn_item', kind: 'salt', qty: 1_000_000_000, to: 'agent' }).success).toBe(false)
  })

  it('caps gain_skill xp at 100', () => {
    expect(OutcomeEffectSchema.safeParse({ op: 'gain_skill', track: 'cooking', xp: 100 }).success).toBe(true)
    expect(OutcomeEffectSchema.safeParse({ op: 'gain_skill', track: 'cooking', xp: 101 }).success).toBe(false)
  })

  it('caps |hp_delta| at 50', () => {
    expect(OutcomeEffectSchema.safeParse({ op: 'hp_delta', delta: -50 }).success).toBe(true)
    expect(OutcomeEffectSchema.safeParse({ op: 'hp_delta', delta: 50 }).success).toBe(true)
    expect(OutcomeEffectSchema.safeParse({ op: 'hp_delta', delta: -51 }).success).toBe(false)
    expect(OutcomeEffectSchema.safeParse({ op: 'hp_delta', delta: 51 }).success).toBe(false)
  })

  it('caps durationTicks at 1440 so a verdict cannot wedge an agent', () => {
    expect(RecipeSchema.safeParse({ ...validRecipe, durationTicks: 1440 }).success).toBe(true)
    expect(RecipeSchema.safeParse({ ...validRecipe, durationTicks: 1441 }).success).toBe(false)
  })

  it('caps outcome row weight at 1000', () => {
    const row = (weight: number) => [{ weight, success: true, label: 'x', effects: [{ op: 'none' }] }]
    expect(OutcomeTableSchema.safeParse(row(1000)).success).toBe(true)
    expect(OutcomeTableSchema.safeParse(row(1001)).success).toBe(false)
  })
})

describe('rollOutcomeTable', () => {
  const table: OutcomeRow[] = [
    { weight: 2, success: false, label: 'first', effects: [{ op: 'none' }] },
    { weight: 2, success: true, label: 'last', effects: [{ op: 'none' }] },
  ]

  it('returns the first row when rng.next() is 0.0', () => {
    expect(rollOutcomeTable(table, { next: () => 0.0 }).label).toBe('first')
  })

  it('returns the last row when rng.next() approaches 1.0', () => {
    expect(rollOutcomeTable(table, { next: () => 0.999999 }).label).toBe('last')
  })

  it('scales only the success row by factor (hand-computed cut point)', () => {
    const t: OutcomeRow[] = [
      { weight: 1, success: false, label: 'fail', effects: [{ op: 'none' }] },
      { weight: 1, success: true, label: 'win', effects: [{ op: 'none' }] },
    ]
    // factor 0.5 → weights [1, 0.5], total 1.5; failure covers [0,1), success (1,1.5].
    // rng.next()=0.6 → roll=0.9 → failure. (Scaling neither row: roll=1.2 → success;
    // scaling both: total=1.0, roll=0.6 → success.) So failure proves exactly the brief's claim.
    expect(rollOutcomeTable(t, { next: () => 0.6 }, 0.5).label).toBe('fail')
  })
})

describe('skillFactor', () => {
  it('computes 0.5 + 0.05*(level - difficulty)', () => {
    expect(skillFactor(5, 2)).toBeCloseTo(0.65)
    expect(skillFactor(2, 5)).toBeCloseTo(0.35)
  })

  it('clamps to [0.05, 0.95]', () => {
    expect(skillFactor(100, 1)).toBe(0.95)
    expect(skillFactor(1, 100)).toBe(0.05)
  })
})

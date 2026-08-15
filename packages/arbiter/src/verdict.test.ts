import { describe, expect, it } from 'vitest'
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
  interruptible: true,
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

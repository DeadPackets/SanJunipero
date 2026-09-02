import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { CLOSED_KEYS, NO_PARAMS } from '@sj/shared'
import { strictModeFaults } from '@sj/shared/testutil'
import { strictDialect } from './testutil/scriptedLlm.js'
import { ExpressiveParams } from './expressive.js'
import {
  OutcomeEffectSchema,
  OutcomeTableSchema,
  RecipeSchema,
  StrictVerdictSchema,
  VerdictSchema,
  readRuling,
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
    {
      weight: 1,
      success: true,
      label: 'The water boils away, leaving a crust of salt.',
      effects: [{ op: 'spawn_item', kind: 'salt', qty: 1 }],
    },
    {
      weight: 1,
      success: false,
      label: 'The pot cracks and the water is lost.',
      effects: [{ op: 'none' }],
    },
  ],
  rngStream: 'craft',
  canon: ['fire'],
}

const validMap = {
  kind: 'map' as const,
  verb: 'craft',
  params: { ...NO_PARAMS, recipe: 'recipe:boil_salt' },
}
const validAttempt = {
  kind: 'attempt' as const,
  recipe: validRecipe,
  summary: 'Boil river water to extract salt.',
}
const validImpossible = {
  kind: 'impossible' as const,
  reason: 'No fire is available.',
  class: 'physically_impossible' as const,
}

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
      expect(JSON.stringify(z.toJSONSchema(VerdictSchema, { io })), io).not.toContain(
        'propertyNames',
      )
    }
  })

  it('names every parameter a mapped verb can be handed, and the two schemas cannot drift', () => {
    type Branch = {
      properties: { kind: { const: string }; params?: { properties?: Record<string, unknown> } }
    }
    const emitted = z.toJSONSchema(VerdictSchema, { io: 'input' }) as unknown as { oneOf: Branch[] }
    const mapBranch = emitted.oneOf.find((b) => b.properties.kind.const === 'map')!
    const named = Object.keys(mapBranch.properties.params?.properties ?? {})
    // Everything the turn caller can name, the arbiter can map to.
    expect(named).toEqual([...CLOSED_KEYS])
    // The arbiter's own expressive verb takes `targetId`, which is in that set.
    for (const key of Object.keys(ExpressiveParams.shape)) expect(named).toContain(key)
  })

  it('maps to a grammar a strict decoder can be handed, in either direction', () => {
    // The map branch only: the attempt branch's recipe still carries two optional fields the
    // engine's own item state names the same way, and widening those is not a params change.
    for (const io of ['input', 'output'] as const) {
      const emitted = z.toJSONSchema(VerdictSchema, { io }) as unknown as { oneOf: unknown[] }
      const mapBranch = emitted.oneOf.find(
        (b) => (b as { properties: { kind: { const: string } } }).properties.kind.const === 'map',
      )
      expect(strictModeFaults(mapBranch), io).toEqual([])
    }
  })

  it('takes any verb the town mints, and only the keys the grammar names', () => {
    const v = VerdictSchema.parse({ kind: 'map', verb: 'express:hum', params: NO_PARAMS })
    expect(v.kind).toBe('map')
    expect(
      VerdictSchema.safeParse({
        kind: 'map',
        verb: 'express:hum',
        params: { ...NO_PARAMS, whittledFrom: 'ash' },
      }).success,
    ).toBe(false)
    expect(VerdictSchema.safeParse({ kind: 'map', verb: 'express:hum', params: {} }).success).toBe(
      false,
    )
  })

  it('an attempt may propose the next rung, in the closed shape and no other', () => {
    const unlocks = { id: 'salt_curing', name: 'Salt curing', prerequisiteId: 'fire' }
    const v = VerdictSchema.parse({ ...validAttempt, unlocks })
    expect(v.kind === 'attempt' ? v.unlocks : null).toEqual(unlocks)
    expect(
      VerdictSchema.safeParse({ ...validAttempt, unlocks: { ...unlocks, id: 'Salt Curing' } })
        .success,
    ).toBe(false)
    expect(
      VerdictSchema.safeParse({ ...validAttempt, unlocks: { ...unlocks, era: 'works' } }).success,
    ).toBe(false)
  })

  it('rejects an extra key via strict', () => {
    expect(() =>
      VerdictSchema.parse({ kind: 'map', verb: 'x', params: NO_PARAMS, bogus: 1 }),
    ).toThrow(/bogus/)
  })

  it('rejects an unknown kind (closed union)', () => {
    expect(VerdictSchema.safeParse({ kind: 'nuke' }).success).toBe(false)
  })
})

// Measured live 2026-09-02 against the pinned ruling model: it refuses a schema whose root is
// not an object ('got type: "None"') and refuses `oneOf` anywhere ("'oneOf' is not permitted"),
// on top of the optional-key rule `strictModeFaults` already knows.
describe('StrictVerdictSchema', () => {
  it('★ is the dialect a strict decoder takes: object at the root, no oneOf, no optional key', () => {
    for (const io of ['input', 'output'] as const) {
      const emitted = z.toJSONSchema(StrictVerdictSchema, { io }) as { type?: string }
      expect(emitted.type, io).toBe('object')
      expect(JSON.stringify(emitted), io).not.toContain('oneOf')
      expect(strictModeFaults(emitted), io).toEqual([])
    }
  })

  it('★ carries every field the live verdict leaves out, required and nullable', () => {
    const wire = { verdict: strictDialect(validAttempt) }
    expect(StrictVerdictSchema.safeParse(wire).success).toBe(true)
    // Each of them written null, none of them left out — which is what the decoder cannot do.
    const recipe = (wire.verdict as { recipe: Record<string, unknown> }).recipe
    expect(recipe.skillCheck).toBeNull()
    expect((wire.verdict as { unlocks: unknown }).unlocks).toBeNull()
    expect(StrictVerdictSchema.safeParse({ verdict: validAttempt }).success).toBe(false)
  })
})

describe('readRuling', () => {
  it('★ reads the strict dialect back as the verdict the town keeps: null is absent', () => {
    const verdict = readRuling({ verdict: strictDialect(validAttempt) })
    expect(verdict).toEqual(validAttempt)
    if (verdict?.kind !== 'attempt') throw new Error('not an attempt')
    expect('skillCheck' in verdict.recipe).toBe(false)
    expect('unlocks' in verdict).toBe(false)
    expect('durability' in verdict.recipe.outcomeTable[0]!.effects[0]!).toBe(false)
  })

  it('★ keeps a skill check, a durability and an unlock the court did name', () => {
    const named = {
      ...validAttempt,
      unlocks: { id: 'salting', name: 'Salting', prerequisiteId: 'fire' },
      recipe: {
        ...validRecipe,
        skillCheck: { track: 'cooking', difficulty: 4 },
        outcomeTable: [
          {
            ...validRecipe.outcomeTable[0]!,
            effects: [{ op: 'spawn_item' as const, kind: 'knife', qty: 1, durability: 30 }],
          },
        ],
      },
    }
    expect(readRuling({ verdict: strictDialect(named) })).toEqual(named)
  })

  it('★ refuses an answer off the union, wrapped or bare', () => {
    expect(readRuling({ verdict: { kind: 'nuke' } })).toBeNull()
    expect(readRuling({ kind: 'map', verb: 'walk', params: NO_PARAMS })).toBeNull()
  })

  // A params key answered null is the act naming nothing there, not a key to drop: the closed
  // grammar requires all thirteen, so the round trip has to keep them.
  it('★ keeps the nulls the closed grammar requires while dropping the ones that mean absence', () => {
    const verdict = readRuling({
      verdict: { kind: 'map', verb: 'walk', params: { ...NO_PARAMS, x: 3, y: 4 } },
    })
    expect(verdict).toEqual({ kind: 'map', verb: 'walk', params: { ...NO_PARAMS, x: 3, y: 4 } })
  })
})

// The dialect is derived from `OutcomeEffectSchema`, never restated, so an op added to the town's
// effects is in it the same day. This test fails on a new op until it is sampled here — and the
// derivation is what makes the sample pass without a second edit in verdict.ts.
describe('the strict dialect covers every effect the town can emit', () => {
  const samples: Record<string, Record<string, unknown>> = {
    spawn_item: { op: 'spawn_item', kind: 'salt', qty: 1 },
    gain_skill: { op: 'gain_skill', track: 'cooking', xp: 10 },
    hp_delta: { op: 'hp_delta', delta: -3 },
    mark: { op: 'mark', on: 'target', key: 'debt', value: 'two planks' },
    witness: { op: 'witness', label: 'She dances by the fire.', sense: 'sight' },
    name_place: { op: 'name_place', text: 'The Two Waters' },
    transfer: { op: 'transfer', to: 'target' },
    need_delta: { op: 'need_delta', need: 'social', delta: 5 },
    none: { op: 'none' },
  }
  const ops = OutcomeEffectSchema.options.map((o) => (o.shape.op as z.ZodLiteral<string>).value)

  it('★ every op in the union has a sample here', () => {
    expect([...ops].sort()).toEqual(Object.keys(samples).sort())
  })

  it.each(ops)('★ %s survives the round trip null-filled', (op) => {
    const attempt = {
      ...validAttempt,
      recipe: {
        ...validRecipe,
        outcomeTable: [{ ...validRecipe.outcomeTable[0]!, effects: [samples[op]!] }],
      },
    }
    // Written the way the decoder answers — every key the op names, absence written null.
    const wire = { verdict: strictDialect(attempt) }
    expect(StrictVerdictSchema.safeParse(wire).success, op).toBe(true)
    const verdict = readRuling(wire)
    if (verdict?.kind !== 'attempt') throw new Error(`${op}: not an attempt`)
    expect(verdict.recipe.outcomeTable[0]!.effects[0], op).toEqual(samples[op])
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
    expect(
      RecipeSchema.safeParse({ ...validRecipe, skillCheck: { track: 'cooking', difficulty: 11 } })
        .success,
    ).toBe(false)
  })
})

describe('OutcomeEffectSchema', () => {
  it('takes spawn_item with only what the contract names, and refuses the old to field', () => {
    expect(OutcomeEffectSchema.safeParse({ op: 'spawn_item', kind: 'salt', qty: 1 }).success).toBe(
      true,
    )
    expect(
      OutcomeEffectSchema.safeParse({ op: 'spawn_item', kind: 'salt', qty: 1, to: 'agent' })
        .success,
    ).toBe(false)
  })

  it('takes the contract’s five grounding ops, each with its closed fields', () => {
    for (const effect of [
      { op: 'mark', on: 'target', key: 'debt', value: 'two planks' },
      { op: 'witness', label: 'raises a cup to the room', sense: 'sight' },
      { op: 'witness', label: 'calls the row', sense: 'sound', radius: 6 },
      { op: 'name_place', text: "the Widow's Well" },
      { op: 'transfer', to: 'target' },
      { op: 'need_delta', need: 'social', delta: 10 },
    ]) {
      expect(OutcomeEffectSchema.safeParse(effect).success, JSON.stringify(effect)).toBe(true)
    }
    expect(
      OutcomeEffectSchema.safeParse({ op: 'mark', on: 'town', key: 'k', value: 'v' }).success,
    ).toBe(false)
    expect(OutcomeEffectSchema.safeParse({ op: 'transfer', to: 'self' }).success).toBe(false)
    expect(
      OutcomeEffectSchema.safeParse({ op: 'need_delta', need: 'hunger', delta: 10 }).success,
    ).toBe(false)
  })

  it('rejects an unknown op — the whitelist is closed', () => {
    expect(OutcomeEffectSchema.safeParse({ op: 'nuke' }).success).toBe(false)
  })
})

describe('effect magnitude caps (out-of-range LLM verdicts fail schema parse)', () => {
  it('caps spawn_item qty at 20', () => {
    expect(OutcomeEffectSchema.safeParse({ op: 'spawn_item', kind: 'salt', qty: 20 }).success).toBe(
      true,
    )
    expect(OutcomeEffectSchema.safeParse({ op: 'spawn_item', kind: 'salt', qty: 21 }).success).toBe(
      false,
    )
    expect(
      OutcomeEffectSchema.safeParse({
        op: 'spawn_item',
        kind: 'salt',
        qty: 1_000_000_000,
      }).success,
    ).toBe(false)
  })

  it('caps gain_skill xp at 100', () => {
    expect(
      OutcomeEffectSchema.safeParse({ op: 'gain_skill', track: 'cooking', xp: 100 }).success,
    ).toBe(true)
    expect(
      OutcomeEffectSchema.safeParse({ op: 'gain_skill', track: 'cooking', xp: 101 }).success,
    ).toBe(false)
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
    const row = (weight: number) => [
      { weight, success: true, label: 'x', effects: [{ op: 'none' }] },
    ]
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
    // factor 0.5 -> weights [1, 0.5], total 1.5, so roll 0.9 is a failure. Scaling neither row,
    // or both, would make the same roll a success, which is what makes this row load-bearing.
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

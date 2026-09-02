import { z } from 'zod'
import { ClosedIntentParams } from '@sj/shared'

// Magnitude caps: an out-of-range LLM verdict fails schema parse and flows
// through the existing invalid-verdict path instead of entering the world.
export const OutcomeEffectSchema = z.discriminatedUnion('op', [
  z
    .object({
      op: z.literal('spawn_item'),
      kind: z.string().min(1),
      qty: z.number().int().positive().max(20),
      durability: z.number().int().positive().max(200).optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('gain_skill'),
      track: z.string().min(1),
      xp: z.number().int().positive().max(100),
    })
    .strict(),
  z.object({ op: z.literal('hp_delta'), delta: z.number().int().min(-50).max(50) }).strict(), // negative = damage, positive = heal
  // A tag the town can read off a person, a building or a thing: "marked: debt two planks".
  z
    .object({
      op: z.literal('mark'),
      on: z.enum(['self', 'target', 'structure', 'item']),
      key: z.string().min(1).max(24),
      value: z.string().min(1).max(60),
    })
    .strict(),
  // What the others see or hear, in the third person, as far as a dance or a song carries.
  z
    .object({
      op: z.literal('witness'),
      label: z.string().min(1).max(120),
      sense: z.enum(['sight', 'sound']),
      radius: z.number().int().positive().max(30).optional(),
    })
    .strict(),
  z.object({ op: z.literal('name_place'), text: z.string().min(1).max(40) }).strict(),
  z.object({ op: z.literal('transfer'), to: z.literal('target') }).strict(),
  z
    .object({
      op: z.literal('need_delta'),
      need: z.enum(['energy', 'social', 'warmth']),
      delta: z.number().int().min(-50).max(50),
    })
    .strict(),
  z.object({ op: z.literal('none') }).strict(),
])
export type OutcomeEffect = z.infer<typeof OutcomeEffectSchema>

export const OutcomeRowSchema = z
  .object({
    weight: z.number().positive().max(1000), // relative weight; engine rolls cumulative sum over rng.next()*total
    success: z.boolean(), // true = this row is the success outcome; its weight is skill-scaled at roll time
    label: z.string().min(1), // in-world result narration (what the agent/others perceive)
    effects: z.array(OutcomeEffectSchema), // whitelisted engine effects ONLY — the LLM cannot emit raw events
  })
  .strict()
export type OutcomeRow = z.infer<typeof OutcomeRowSchema>
export const OutcomeTableSchema = z.array(OutcomeRowSchema).min(1)
export type OutcomeTable = z.infer<typeof OutcomeTableSchema>

export const RecipeRequirementSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('held_item'),
      kind: z.string().min(1),
      qty: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal('adjacent_tile'),
      tile: z.enum(['grass', 'dirt', 'water', 'forest', 'rock', 'sand', 'farmland']),
    })
    .strict(),
  z.object({ type: z.literal('adjacent_structure'), kind: z.string().min(1) }).strict(),
  z.object({ type: z.literal('adjacent_fire') }).strict(),
])
export type RecipeRequirement = z.infer<typeof RecipeRequirementSchema>

export const RecipeSchema = z
  .object({
    id: z.string().regex(/^recipe:[a-z0-9_]+$/), // deterministic slug
    name: z.string().min(1), // in-world name
    skillCheck: z
      .object({ track: z.string().min(1), difficulty: z.number().int().min(1).max(10) })
      .strict()
      .optional(),
    durationTicks: z.number().int().positive().max(1440),
    costs: z.array(
      z.object({ kind: z.string().min(1), qty: z.number().int().positive() }).strict(),
    ),
    requires: z.array(RecipeRequirementSchema),
    outcomeTable: OutcomeTableSchema,
    rngStream: z.string().min(1),
    canon: z.array(z.string()).min(1), // codex tech ids this recipe depends on (adjacency doctrine)
  })
  .strict()
export type Recipe = z.infer<typeof RecipeSchema>

export const ImpossibleClassSchema = z.enum([
  'physically_impossible',
  'beyond_adjacency',
  'insufficient_skill',
  'insufficient_materials',
])

// The verb the court maps to is a free word, so a minted one can be named here; its params are
// the closed grammar every act shares, which is what a strict decoder can be handed.
export const VerdictSchema = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('map'), verb: z.string().min(1), params: ClosedIntentParams })
    .strict(),
  z
    .object({ kind: z.literal('attempt'), recipe: RecipeSchema, summary: z.string().min(1) })
    .strict(),
  z
    .object({
      kind: z.literal('impossible'),
      reason: z.string().min(1),
      class: ImpossibleClassSchema,
    })
    .strict(),
])
export type Verdict = z.infer<typeof VerdictSchema>

export function skillFactor(level: number, difficulty: number): number {
  return Math.min(0.95, Math.max(0.05, 0.5 + 0.05 * (level - difficulty)))
}
export function rollOutcomeTable(
  table: OutcomeRow[],
  rng: { next(): number },
  factor = 1,
): OutcomeRow {
  const weights = table.map((r) => (r.success ? r.weight * factor : r.weight))
  const total = weights.reduce((a, b) => a + b, 0)
  let roll = rng.next() * total
  for (let i = 0; i < table.length; i++) {
    roll -= weights[i]!
    if (roll <= 0) return table[i]!
  }
  return table[table.length - 1]!
}

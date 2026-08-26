import { z } from 'zod'

export const VisionCriterionSchema = z
  .object({
    pass: z.boolean(),
    score: z.number().min(0).max(10),
    evidence: z.string().min(1),
  })
  .strict()
export type VisionCriterion = z.infer<typeof VisionCriterionSchema>

// `tiling` is terrain-only (2026-08-17 user ruling: generated repeating textures). Every
// other class marks it N/A, so no existing rubric moved.
export const CRITERIA = [
  'palette',
  'singleFigure',
  'transparency',
  'proportion',
  'facing',
  'density',
  'alignment',
  'tiling',
] as const
export type Criterion = (typeof CRITERIA)[number]

// Binary criteria: `pass:false` fails outright, whatever the score says.
export const HARD_FAIL_CRITERIA = ['singleFigure', 'transparency'] as const

export const VisionCriteriaSchema = z
  .object(
    Object.fromEntries(CRITERIA.map((k) => [k, VisionCriterionSchema])) as Record<
      Criterion,
      typeof VisionCriterionSchema
    >,
  )
  .strict()
export type VisionCriteria = z.infer<typeof VisionCriteriaSchema>

export const VisionVerdictSchema = z
  .object({
    assetId: z.string().min(1),
    model: z.string().min(1),
    rubricVersion: z.string().min(1),
    criteria: VisionCriteriaSchema,
    overall: z.enum(['pass', 'retry', 'blocked']),
    feedback: z.string(),
  })
  .strict()
export type VisionVerdict = z.infer<typeof VisionVerdictSchema>

// Filled by code, never asked of the model, and skipped by the derivation.
export const NA_CRITERIA_BY_CLASS: Record<string, readonly Criterion[]> = {
  icon: ['facing', 'alignment', 'proportion', 'tiling'],
  item: ['facing', 'alignment', 'tiling'],
  // terrain is the one class that DOES tile, and the one class that is not a subject.
  // `transparency` is code-guaranteed and unjudgeable: a full-bleed square hides the checker card.
  terrain: ['facing', 'alignment', 'proportion', 'singleFigure', 'transparency'],
  building: ['tiling'],
  portrait: ['alignment', 'tiling'],
  character: ['tiling'],
}

export const NA_CRITERION = (klass: string): VisionCriterion => ({
  pass: true,
  score: 10,
  evidence: `not applicable for class ${klass}`,
})

// A verdict stored before a criterion existed does not carry it (`tiling`, added 2026-08-17).
// Every reader of an archived verdict goes through here rather than indexing straight in.
export function criterionOf(v: VisionVerdict, c: Criterion): VisionCriterion | undefined {
  return v.criteria[c] as VisionCriterion | undefined
}

export function deriveOverall(
  c: VisionCriteria,
  o: { minScore: number; attempt: number; maxRetries: number; naFor?: readonly string[] },
): 'pass' | 'retry' | 'blocked' {
  const skip = new Set(o.naFor ?? [])
  const live = CRITERIA.filter((k) => !skip.has(k))
  const failed =
    live.some((k) => (HARD_FAIL_CRITERIA as readonly string[]).includes(k) && !c[k].pass) ||
    live.some((k) => c[k].score < o.minScore)
  if (!failed) return 'pass'
  return o.attempt > o.maxRetries ? 'blocked' : 'retry'
}

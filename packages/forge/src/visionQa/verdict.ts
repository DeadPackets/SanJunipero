import { z } from 'zod'

export const VisionCriterionSchema = z.object({
  pass: z.boolean(), score: z.number().min(0).max(10), evidence: z.string().min(1),
}).strict()
export type VisionCriterion = z.infer<typeof VisionCriterionSchema>

export const CRITERIA = ['palette', 'singleFigure', 'transparency', 'proportion', 'facing', 'density', 'alignment'] as const
export type Criterion = (typeof CRITERIA)[number]

// Binary criteria: `pass:false` fails outright, whatever the score says.
export const HARD_FAIL_CRITERIA = ['singleFigure', 'transparency'] as const

export const VisionCriteriaSchema = z.object(
  Object.fromEntries(CRITERIA.map(k => [k, VisionCriterionSchema])) as
    Record<Criterion, typeof VisionCriterionSchema>,
).strict()
export type VisionCriteria = z.infer<typeof VisionCriteriaSchema>

export const VisionVerdictSchema = z.object({
  assetId: z.string().min(1), model: z.string().min(1), rubricVersion: z.string().min(1),
  criteria: VisionCriteriaSchema,
  overall: z.enum(['pass', 'retry', 'blocked']),
  feedback: z.string(),
}).strict()
export type VisionVerdict = z.infer<typeof VisionVerdictSchema>

// Filled by code, never asked of the model, and skipped by the derivation (deviation D-5).
export const NA_CRITERIA_BY_CLASS: Record<string, readonly Criterion[]> = {
  icon: ['facing', 'alignment', 'proportion'],
  item: ['facing', 'alignment'],
  terrain: ['facing', 'alignment', 'proportion', 'singleFigure'],
  building: [],
  portrait: ['alignment'],
  character: [],
}

export const NA_CRITERION = (klass: string): VisionCriterion =>
  ({ pass: true, score: 10, evidence: `not applicable for class ${klass}` })

export function deriveOverall(
  c: VisionCriteria,
  o: { minScore: number; attempt: number; maxRetries: number; naFor?: readonly string[] },
): 'pass' | 'retry' | 'blocked' {
  const skip = new Set(o.naFor ?? [])
  const live = CRITERIA.filter(k => !skip.has(k))
  const failed =
    live.some(k => (HARD_FAIL_CRITERIA as readonly string[]).includes(k) && !c[k].pass) ||
    live.some(k => c[k].score < o.minScore)
  if (!failed) return 'pass'
  return o.attempt > o.maxRetries ? 'blocked' : 'retry'
}

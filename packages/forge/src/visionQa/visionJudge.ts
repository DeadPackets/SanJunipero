import { z } from 'zod'
import { generateText, Output, type LanguageModel } from 'ai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type { Footprint } from '@sj/shared'
import { encodePng, type RawImage } from '../post/raw.js'
import { DEFAULT_FORGE_CONFIG, type ForgeConfig } from '../forgeConfig.js'
import {
  CRITERIA,
  VisionCriterionSchema,
  VisionVerdictSchema,
  NA_CRITERIA_BY_CLASS,
  NA_CRITERION,
  deriveOverall,
  type VisionCriteria,
  type VisionVerdict,
} from './verdict.js'
import { RUBRIC_VERSION, buildRubricPrompt, paletteCard, checkerCard } from './rubric.js'

// Re-based on the 42 live calls booked by the batch-A audit; the pre-flight guess of
// $0.0025 was low by 2.2x. Only pre-flight plans read it — the ledger books reported cost.
export const EST_COST_PER_VISION_CALL = 0.0055

export type VisionGenerateFn = (args: {
  model: unknown
  schema: unknown
  messages: unknown[]
}) => Promise<{ object: unknown; providerMetadata?: unknown }>

export type VisionJudgeArgs = {
  assetId: string
  klass: string
  sprite: RawImage
  commission: string
  footprint?: Footprint | undefined
  expectedFacing?: string | undefined
  attempt?: number // ruling R-1: the gate passes the real attempt so the recorded overall is true
}
export type VisionJudgeFn = (
  args: VisionJudgeArgs,
) => Promise<{ verdict: VisionVerdict; costUsd: number }>

function requestSchema(naFor: readonly string[]) {
  const live = CRITERIA.filter((c) => !naFor.includes(c))
  // stripping, not strict: a reply that volunteers `overall` is ignored rather than rejected
  return z.object({
    ...Object.fromEntries(live.map((k) => [k, VisionCriterionSchema])),
    feedback: z.string(),
  })
}

function reportedCost(providerMetadata: unknown): number | undefined {
  const cost = (providerMetadata as { openrouter?: { usage?: { cost?: unknown } } } | undefined)
    ?.openrouter?.usage?.cost
  return typeof cost === 'number' ? cost : undefined
}

export function makeVisionJudge(opts: {
  apiKey: string
  model?: string
  refs: Buffer[]
  config?: ForgeConfig
  generateFn?: VisionGenerateFn
}): VisionJudgeFn {
  const config = opts.config ?? DEFAULT_FORGE_CONFIG
  const modelName = opts.model ?? config.visionQa.model
  const gen: VisionGenerateFn =
    opts.generateFn ??
    (async (args) => {
      const r = await generateText({
        model: args.model as LanguageModel,
        messages: args.messages as NonNullable<Parameters<typeof generateText>[0]['messages']>,
        output: Output.object({ schema: args.schema as z.ZodType }),
      })
      return { object: r.output, providerMetadata: r.finalStep.providerMetadata }
    })
  const model = opts.generateFn ? null : createOpenRouter({ apiKey: opts.apiKey }).chat(modelName)

  return async (a) => {
    const naFor = NA_CRITERIA_BY_CLASS[a.klass] ?? []
    const schema = requestSchema(naFor)
    const text = buildRubricPrompt({
      klass: a.klass,
      commission: a.commission,
      footprint: a.footprint,
      expectedFacing: a.expectedFacing,
      naFor,
    })
    const { object, providerMetadata } = await gen({
      model,
      schema,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text' as const, text },
            ...opts.refs.map((image) => ({
              type: 'image' as const,
              image,
              mediaType: 'image/png' as const,
            })),
            {
              type: 'image' as const,
              image: await encodePng(paletteCard()),
              mediaType: 'image/png' as const,
            },
            {
              type: 'image' as const,
              image: await encodePng(checkerCard(a.sprite)),
              mediaType: 'image/png' as const,
            },
          ],
        },
      ],
    })
    // `overall` is never the model's to give: parsing through the ask-schema drops it, then code derives it.
    const { feedback, ...asked } = schema.parse(object)
    const criteria = {
      ...asked,
      ...Object.fromEntries(naFor.map((k) => [k, NA_CRITERION(a.klass)])),
    } as VisionCriteria
    const verdict = VisionVerdictSchema.parse({
      assetId: a.assetId,
      model: modelName,
      rubricVersion: RUBRIC_VERSION,
      criteria,
      feedback,
      overall: deriveOverall(criteria, {
        minScore: config.visionQa.minScore,
        attempt: a.attempt ?? 1,
        maxRetries: config.visionQa.maxRetries,
        naFor,
      }),
    })
    return { verdict, costUsd: reportedCost(providerMetadata) ?? EST_COST_PER_VISION_CALL }
  }
}

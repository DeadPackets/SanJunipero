import { z } from 'zod'

// Ops-side only. This is deliberately NOT a SimConfigSchema branch: world law must not move,
// so golden replay (G1/G2) stays green by construction.
export const ForgeConfigSchema = z
  .object({
    visionQa: z
      .object({
        enabled: z.boolean().default(true),
        model: z.string().default('google/gemini-3.7-flash'),
        minScore: z.number().min(0).max(10).default(7),
        // 2 retries = 3 total attempts, the ceiling the codex `attempts` column accepts.
        maxRetries: z.number().int().min(0).max(5).default(2),
        costCapPerAssetUsd: z.number().min(0).default(0.05),
        rubricVersion: z.string().default('v1'),
      })
      .strict()
      .prefault({}),
    library: z
      .object({
        // Was a literal 24. The C-level bar puts icons on 64, an exact 8th of the generation.
        iconSizePx: z.number().int().min(16).max(128).default(64),
        furnitureIconSizePx: z.number().int().min(16).max(128).default(64),
      })
      .strict()
      .prefault({}),
    alignment: z
      .object({
        feetTolerancePx: z.number().int().min(0).default(2),
        baseFitToleranceQuarterTiles: z.number().int().min(0).default(1),
      })
      .strict()
      .prefault({}),
  })
  .strict()

export type ForgeConfig = z.infer<typeof ForgeConfigSchema>
export const DEFAULT_FORGE_CONFIG: ForgeConfig = ForgeConfigSchema.parse({})

function num(env: NodeJS.ProcessEnv, key: string): number | undefined {
  const raw = env[key]
  if (raw === undefined) return undefined
  const n = Number(raw)
  if (raw.trim() === '' || !Number.isFinite(n))
    throw new Error(`${key} must be a number, got ${JSON.stringify(raw)}`)
  return n
}

function bool(env: NodeJS.ProcessEnv, key: string): boolean | undefined {
  const raw = env[key]
  if (raw === undefined) return undefined
  if (raw === 'true') return true
  if (raw === 'false') return false
  throw new Error(`${key} must be "true" or "false", got ${JSON.stringify(raw)}`)
}

export function loadForgeConfig(env: NodeJS.ProcessEnv = process.env): ForgeConfig {
  const visionQa = {
    enabled: bool(env, 'FORGE_VISION_ENABLED'),
    model: env.FORGE_VISION_MODEL,
    minScore: num(env, 'FORGE_VISION_MIN_SCORE'),
    maxRetries: num(env, 'FORGE_VISION_MAX_RETRIES'),
  }
  return ForgeConfigSchema.parse({
    visionQa: Object.fromEntries(Object.entries(visionQa).filter(([, v]) => v !== undefined)),
  })
}

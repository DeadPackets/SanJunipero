import { z } from 'zod'
import { parseMeta } from './assetManifest.js'

const assetId = z
  .string()
  .regex(/^asset_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
const colorMap = z.object({ assetId, colorSpace: z.literal('srgb') }).strict()

export const MaterialSetManifestSchema = z
  .object({
    version: z.literal('v1-material-set'),
    kind: z.string().min(1),
    widthPx: z.number().int().positive(),
    heightPx: z.number().int().positive(),
    maps: z
      .object({
        baseColor: colorMap,
        normal: z
          .object({ assetId, colorSpace: z.literal('linear'), convention: z.literal('opengl') })
          .strict()
          .optional(),
        roughness: z
          .object({ assetId, colorSpace: z.literal('linear'), channel: z.literal('g') })
          .strict()
          .optional(),
        emissive: colorMap.optional(),
      })
      .strict(),
  })
  .strict()

export type MaterialSetManifest = z.infer<typeof MaterialSetManifestSchema>

export const parseMaterialSetManifest = (meta: string | null): MaterialSetManifest | null =>
  parseMeta(MaterialSetManifestSchema, meta)

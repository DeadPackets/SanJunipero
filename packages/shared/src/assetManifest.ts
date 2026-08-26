import { z } from 'zod'
import { FootprintSchema } from './assetCodex.js'

// v4 hi-res manifest contract (user ruling): cells ship at native model resolution,
// the webview scales down at draw time using per-cell feet anchors.
export const CellAnchorSchema = z
  .object({
    w: z.number().int().positive(),
    h: z.number().int().positive(),
    feetX: z.number().int().min(0),
    feetY: z.number().int().min(0),
  })
  .strict()
export type CellAnchor = z.infer<typeof CellAnchorSchema>

// A cell placed inside a packed character atlas (x/y = top-left in atlas pixels).
export const AtlasCellSchema = CellAnchorSchema.extend({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
}).strict()
export type AtlasCell = z.infer<typeof AtlasCellSchema>

export const CharacterAtlasManifestSchema = z
  .object({
    version: z.literal('v4-hires-atlas'),
    figureH: z.number().int().positive(),
    cells: z.record(z.string(), AtlasCellSchema),
  })
  .strict()
export type CharacterAtlasManifest = z.infer<typeof CharacterAtlasManifestSchema>

export const BuildingManifestSchema = z
  .object({
    version: z.literal('v4-hires-building'),
    kind: z.string().min(1),
    footprint: FootprintSchema,
    cell: CellAnchorSchema,
  })
  .strict()
export type BuildingManifest = z.infer<typeof BuildingManifestSchema>

export function parseCharacterAtlasManifest(meta: string | null): CharacterAtlasManifest | null {
  if (meta === null) return null
  try {
    const r = CharacterAtlasManifestSchema.safeParse(JSON.parse(meta))
    return r.success ? r.data : null
  } catch {
    return null
  }
}

export function parseBuildingManifest(meta: string | null): BuildingManifest | null {
  if (meta === null) return null
  try {
    const r = BuildingManifestSchema.safeParse(JSON.parse(meta))
    return r.success ? r.data : null
  } catch {
    return null
  }
}

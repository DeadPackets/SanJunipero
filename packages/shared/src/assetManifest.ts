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

// A cell point is a pixel on the painted cell, hand-measured, so an effect lands ON the art
// (the flame, the chimney mouth, a window painted lit) and never beside it.
export const CellPointSchema = z
  .object({ x: z.number().int().min(0), y: z.number().int().min(0) })
  .strict()
export type CellPoint = z.infer<typeof CellPointSchema>

export const BuildingPointsSchema = z
  .object({
    flame: CellPointSchema.optional(),
    chimney: CellPointSchema.optional(),
    window: CellPointSchema.optional(),
  })
  .strict()
export type BuildingPoints = z.infer<typeof BuildingPointsSchema>

export const BuildingManifestSchema = z
  .object({
    version: z.literal('v4-hires-building'),
    kind: z.string().min(1),
    footprint: FootprintSchema,
    cell: CellAnchorSchema,
    points: BuildingPointsSchema.optional(),
  })
  .strict()
export type BuildingManifest = z.infer<typeof BuildingManifestSchema>

/** Manifest text off a codex row: unreadable JSON and a row that fails the schema both read as
 *  no manifest at all. */
export function parseMeta<T>(schema: z.ZodType<T>, meta: string | null): T | null {
  if (meta === null) return null
  try {
    const r = schema.safeParse(JSON.parse(meta))
    return r.success ? r.data : null
  } catch {
    return null
  }
}

export const parseCharacterAtlasManifest = (meta: string | null): CharacterAtlasManifest | null =>
  parseMeta(CharacterAtlasManifestSchema, meta)

export const parseBuildingManifest = (meta: string | null): BuildingManifest | null =>
  parseMeta(BuildingManifestSchema, meta)

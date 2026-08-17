import { z } from 'zod'

export const TERRAIN_TILE_KINDS = ['grass', 'earth', 'water', 'forest', 'rock', 'sand', 'farmland', 'road'] as const
export type TerrainTileKind = (typeof TERRAIN_TILE_KINDS)[number]
export const TerrainTileKindSchema = z.enum(TERRAIN_TILE_KINDS)

// TERRAIN V2: the codex kind a CONTINUOUS world-space material is registered under, distinct
// from the flat per-tile kinds which stay for the fallback path. The forge writes this string
// and the renderer reads it, so — like roadAutotileKind — it lives here or it drifts.
export const MATERIAL_KIND_PREFIX = 'material:'

// widened past TerrainTileKind on purpose: TERRAIN V2.1 adds `road-calm`, a material with no
// TileId of its own — a road tile picks between it and `road` by shape, not by terrain id.
export function materialKind(kind: string): string {
  return `${MATERIAL_KIND_PREFIX}${kind}`
}

export const TerrainTileManifestSchema = z.object({
  version: z.literal('v1-terrain-tile'),
  kind: TerrainTileKindSchema,
  variant: z.number().int().min(0).max(3),
  wPx: z.number().int().positive(),
  hPx: z.number().int().positive(),
}).strict()
export type TerrainTileManifest = z.infer<typeof TerrainTileManifestSchema>

export function parseTerrainTileManifest(meta: string | null): TerrainTileManifest | null {
  if (meta === null) return null
  let raw: unknown
  try { raw = JSON.parse(meta) } catch { return null }
  const r = TerrainTileManifestSchema.safeParse(raw)
  return r.success ? r.data : null
}

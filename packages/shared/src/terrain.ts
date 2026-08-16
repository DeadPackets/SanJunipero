import { z } from 'zod'

export const TERRAIN_TILE_KINDS = ['grass', 'earth', 'water', 'forest', 'rock', 'sand', 'farmland', 'road'] as const
export type TerrainTileKind = (typeof TERRAIN_TILE_KINDS)[number]
export const TerrainTileKindSchema = z.enum(TERRAIN_TILE_KINDS)

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

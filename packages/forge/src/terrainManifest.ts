import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { RoadAutotileKeySchema } from '@sj/shared'

export const TilesetManifest = z
  .object({
    tileW: z.literal(32),
    tileH: z.literal(16),
    cols: z.literal(4),
    rows: z.literal(4),
    seasons: z.record(
      z.enum(['spring', 'summer', 'autumn', 'winter']),
      z.object({ file: z.string(), tiles: z.array(z.string()).length(16) }),
    ),
    scaffolding: z.object({ file: z.string() }),
    // Additive and optional so an existing manifest parses unchanged.
    autotile: z
      .object({
        road: z
          .object({
            file: z.string(),
            tiles: z.partialRecord(RoadAutotileKeySchema, z.number().int().min(0)),
          })
          .strict()
          .refine((r) => Object.keys(r.tiles).length === 15, {
            message: 'all 15 road tiles required',
          }),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((m) => Object.keys(m.seasons).length === 4, { message: 'all 4 seasons required' })

const DEFAULT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'content', 'tilesets')

export function loadTilesetManifest(dir: string = DEFAULT_DIR): z.infer<typeof TilesetManifest> {
  const m = TilesetManifest.parse(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')))
  const files = [
    ...Object.values(m.seasons).map((s) => s.file),
    m.scaffolding.file,
    ...(m.autotile ? [m.autotile.road.file] : []),
  ]
  for (const f of files)
    if (!existsSync(join(dir, f))) throw new Error(`tileset manifest references missing file ${f}`)
  return m
}

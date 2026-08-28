import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

// The Signpost UI's rasters, drawn by `scripts/gen-ui.ts`. They ship TWICE: `content/ui` holds
// the authored piece beside its manifest, and `packages/web/src/ui/px` is the directory the web
// bundler resolves `frame-cream.png` and its siblings from. The producer runs a live generation
// at import time, so the roster cannot live in it — it lives here, where web and test both reach.
export const UI_CONTENT_DIR = fileURLToPath(new URL('../content/ui', import.meta.url))
export const UI_PX_DIR = fileURLToPath(new URL('../../web/src/ui/px', import.meta.url))

/** What W1 and W2 reference by name. A piece dropped from the producer takes its manifest row
 *  with it, so the roster is pinned here rather than read back out of the manifest. */
export const UI_PIECE_IDS = [
  'signpost-arm',
  'signpost-post',
  'paper',
  'nameplate',
  'speech',
  'speech-tail',
  'ring-pip',
] as const

const Provenance = z.union([
  z.object({ source: z.literal('code-painted'), painter: z.string() }).strict(),
  z
    .object({
      source: z.literal('generated'),
      model: z.string(),
      genPx: z.number().int(),
      factor: z.number().int(),
      promptSha256: z.string().regex(/^[0-9a-f]{64}$/),
      usd: z.number().positive(),
      candidate: z.string(),
    })
    .strict(),
])

export const UiManifest = z
  .object({
    version: z.literal('v1-signpost-ui'),
    pieces: z.record(
      z.string(),
      z
        .object({
          file: z.string(),
          w: z.number().int().positive(),
          h: z.number().int().positive(),
          /** The nine-slice inset, or null for a piece drawn at one size. */
          slice: z.number().int().positive().nullable(),
          note: z.string(),
          provenance: Provenance,
        })
        .strict(),
    ),
  })
  .strict()

export type UiManifest = z.infer<typeof UiManifest>

export function loadUiManifest(dir: string = UI_CONTENT_DIR): UiManifest {
  const m = UiManifest.parse(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')))
  for (const p of Object.values(m.pieces))
    if (!existsSync(join(dir, p.file))) throw new Error(`ui manifest references missing ${p.file}`)
  return m
}

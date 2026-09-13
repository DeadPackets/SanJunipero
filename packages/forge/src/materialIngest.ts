import { MaterialSetManifestSchema, type AssetRecord, type MaterialSetManifest } from '@sj/shared'
import sharp from 'sharp'
import { z } from 'zod'
import type { AssetCodex } from './codex.js'
import { decodePng } from './post/raw.js'

const inputSchema = z
  .object({
    class: z.enum(['building', 'terrain']),
    kind: z.string().min(1),
    maps: z
      .object({
        baseColor: z.instanceof(Buffer),
        normal: z.instanceof(Buffer).optional(),
        roughness: z.instanceof(Buffer).optional(),
        emissive: z.instanceof(Buffer).optional(),
      })
      .strict(),
  })
  .strict()

export async function registerMaterialSet(
  codex: AssetCodex,
  input: z.infer<typeof inputSchema>,
): Promise<AssetRecord> {
  const v = inputSchema.parse(input)
  let width = 0,
    height = 0
  for (const [channel, png] of Object.entries(v.maps)) {
    if (!png) continue
    const meta = await sharp(png).metadata()
    if (meta.format !== 'png' || meta.depth !== 'uchar' || (meta.pages ?? 1) !== 1)
      throw new Error(`${channel}: expected a single 8-bit PNG`)
    const image = await decodePng(png)
    if (channel === 'baseColor') {
      width = image.width
      height = image.height
    } else if (image.width !== width || image.height !== height) {
      throw new Error(`${channel}: dimensions must match baseColor (${width}x${height})`)
    }
    if (channel !== 'roughness' && channel !== 'normal') continue
    for (let i = 0; i < image.data.length; i += 4) {
      const r = image.data[i]!,
        g = image.data[i + 1]!,
        b = image.data[i + 2]!
      if (image.data[i + 3] !== 255) throw new Error(`${channel}: pixels must be opaque`)
      if (channel === 'roughness' && (r !== g || g !== b))
        throw new Error('roughness: RGB channels must contain the same grayscale value')
      if (channel === 'normal') {
        const length = Math.hypot(r / 127.5 - 1, g / 127.5 - 1, b / 127.5 - 1)
        if (b < 128 || Math.abs(length - 1) > 0.15)
          throw new Error('normal: expected unit tangent vectors facing positive Z')
      }
    }
  }

  const common = {
    class: v.class,
    footprint: { w: 1, h: 1 },
    widthPx: width,
    heightPx: height,
    status: 'ready' as const,
    score: null,
    attempts: 1,
    costUsd: 0,
  }
  const maps: Partial<MaterialSetManifest['maps']> = {}
  for (const [channel, png] of Object.entries(v.maps)) {
    if (!png) continue
    const record = codex.register({
      ...common,
      kind: `material-map:${v.kind}:${channel}`,
      desc: `${v.kind} ${channel} material map`,
      png,
    })
    if (channel === 'baseColor' || channel === 'emissive')
      maps[channel] = { assetId: record.id, colorSpace: 'srgb' }
    else if (channel === 'normal')
      maps.normal = { assetId: record.id, colorSpace: 'linear', convention: 'opengl' }
    else if (channel === 'roughness')
      maps.roughness = { assetId: record.id, colorSpace: 'linear', channel: 'g' }
  }
  const manifest = MaterialSetManifestSchema.parse({
    version: 'v1-material-set',
    kind: v.kind,
    widthPx: width,
    heightPx: height,
    maps,
  })
  return codex.register({
    ...common,
    kind: `material:${v.kind}`,
    desc: `${v.kind} material set`,
    meta: JSON.stringify(manifest),
    png: v.maps.baseColor,
  })
}

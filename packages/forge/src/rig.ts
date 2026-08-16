import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { decodePng, type RawImage } from './post/raw.js'
import { paletteRgb, type Rgb } from './palette.js'

export type AgeBand = 'child' | 'adult' | 'elder'

export const RigManifest = z.object({
  bodies: z.array(z.object({ id: z.string(), age: z.enum(['child', 'adult', 'elder']), file: z.string() })),
  hair: z.array(z.object({ id: z.string(), file: z.string(), ramp: z.array(z.string()).length(4) })),
  clothing: z.array(z.object({ id: z.string(), file: z.string(), ramp: z.array(z.string()).length(4) })),
}).strict()

export type RigSpec = {
  body: string; age: AgeBand
  hair?: { id: string; ramp: [string, string, string, string] }
  clothing?: { id: string; ramp: [string, string, string, string] }
}

export function swapColors(img: RawImage, from: Rgb[], to: Rgb[]): RawImage {
  if (from.length !== to.length) throw new Error('swapColors: ramp length mismatch')
  const map = new Map(from.map((f, i) => [(f[0] << 16) | (f[1] << 8) | f[2], to[i]!]))
  const out = new Uint8ClampedArray(img.data)
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] === 0) continue
    const t = map.get((out[i]! << 16) | (out[i + 1]! << 8) | out[i + 2]!)
    if (t) { out[i] = t[0]; out[i + 1] = t[1]; out[i + 2] = t[2] }
  }
  return { width: img.width, height: img.height, data: out }
}

export function composeLayers(layers: RawImage[]): RawImage {
  const base = layers[0]
  if (!base) throw new Error('composeLayers: no layers')
  for (const l of layers) if (l.width !== base.width || l.height !== base.height)
    throw new Error(`composeLayers: size mismatch ${l.width}x${l.height} vs ${base.width}x${base.height}`)
  const out = new Uint8ClampedArray(base.data)
  for (const layer of layers.slice(1))
    for (let i = 0; i < out.length; i += 4)
      if (layer.data[i + 3] !== 0) { out[i] = layer.data[i]!; out[i + 1] = layer.data[i + 1]!; out[i + 2] = layer.data[i + 2]!; out[i + 3] = 255 }
  return { width: base.width, height: base.height, data: out }
}

const DEFAULT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'content', 'rigs')
// ramps must be master-palette hexes; curation (Step 4) guarantees it for committed content
const hexRamp = (ramp: readonly string[]): Rgb[] => paletteRgb(ramp)

export async function composeCharacter(spec: RigSpec, dir: string = DEFAULT_DIR): Promise<RawImage> {
  const manifest = RigManifest.parse(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')))
  const body = manifest.bodies.find(b => b.id === spec.body && b.age === spec.age)
  if (!body) throw new Error(`no rig body ${spec.body}/${spec.age}`)
  const layers: RawImage[] = [await decodePng(readFileSync(join(dir, body.file)))]
  for (const [kind, pick] of [['clothing', spec.clothing], ['hair', spec.hair]] as const) {
    if (!pick) continue
    const entry = manifest[kind].find(e => e.id === pick.id)
    if (!entry) throw new Error(`no rig ${kind} ${pick.id}`)
    layers.push(swapColors(await decodePng(readFileSync(join(dir, entry.file))), hexRamp(entry.ramp), hexRamp(pick.ramp)))
  }
  return composeLayers(layers)
}

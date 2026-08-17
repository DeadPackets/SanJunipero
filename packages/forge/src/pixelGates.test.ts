import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { decodePng, type RawImage } from './post/raw.js'
import {
  integerScaleGate, pixelGridGate, alphaBinaryGate, paletteGate,
  nativeDensityGate, classDensityGate, tileSeamGate, tilesetVarietyGate,
  pixelBarReport, SEAM_RATIO_MAX, SEAM_ABSOLUTE_FLOOR,
} from './pixelGates.js'

const fixture = (name: string): Promise<RawImage> =>
  decodePng(readFileSync(new URL(`./fixtures/pixel-gates/${name}`, import.meta.url)))

const solid = (w: number, h: number, rgba: [number, number, number, number]): RawImage => {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i)
  return { width: w, height: h, data }
}

describe('integerScaleGate', () => {
  it('RED on the real bed: 512 raw shipped at 192 is a 2.667x downscale', () => {
    const r = integerScaleGate({ w: 512, h: 512 }, { w: 192, h: 192 })
    expect(r.ok).toBe(false)
    expect(r.factor).toBeNull()
    expect(r.failures[0]).toContain('512x512 -> 192x192')
    expect(r.failures[0]).toContain('2.667')
  })
  it('RED on the real wall piece: 512 -> 256x160 scales x and y differently', () => {
    const r = integerScaleGate({ w: 512, h: 512 }, { w: 256, h: 160 })
    expect(r.ok).toBe(false)
    expect(r.failures.join(' ')).toContain('anisotropic')
  })
  it('GREEN on the real chair: 512 -> 128 is exactly 4x', () => {
    expect(integerScaleGate({ w: 512, h: 512 }, { w: 128, h: 128 })).toEqual({ ok: true, failures: [], factor: 4 })
  })
  it('a shipped size larger than the raw is an upscale, never allowed', () => {
    const r = integerScaleGate({ w: 128, h: 128 }, { w: 256, h: 256 })
    expect(r.ok).toBe(false)
    expect(r.failures.join(' ')).toContain('upscale')
  })
})

describe('pixelGridGate', () => {
  it('RED on the real floor material: 512 px of art under a 128 px tile is not 4-block art', async () => {
    const r = pixelGridGate(await fixture('floor-512.png'), 4)
    expect(r.ok).toBe(false)
    expect(r.badBlocks).toBeGreaterThan(0)
    expect(r.failures[0]).toContain('pixel grid 4')
  })
  it('GREEN when the art really is block-uniform at the claimed size', () => {
    const img = solid(8, 8, [0xff, 0xf6, 0xe9, 255])
    expect(pixelGridGate(img, 4).ok).toBe(true)
  })
  it('a claimed pixel size that does not divide the canvas fails outright', async () => {
    const r = pixelGridGate(await fixture('chair-128.png'), 5)
    expect(r.ok).toBe(false)
    expect(r.failures.join(' ')).toContain('does not divide')
  })
  it('a fractional claimed pixel size fails outright', async () => {
    const r = pixelGridGate(await fixture('bed-192.png'), 1.5)
    expect(r.ok).toBe(false)
    expect(r.failures.join(' ')).toContain('not a positive integer')
  })
})

describe('alphaBinaryGate', () => {
  it('RED on a real shipped preview: 2658 pixels are neither opaque nor clear', async () => {
    const r = alphaBinaryGate(await fixture('soft-alpha-preview.png'))
    expect(r.ok).toBe(false)
    expect(r.softPixels).toBe(2658)
  })
  it('GREEN on the real chair sprite, which post-processing already binarized', async () => {
    expect(alphaBinaryGate(await fixture('chair-128.png')).ok).toBe(true)
  })
  it('a class that is allowed soft alpha reports the count and passes', async () => {
    const r = alphaBinaryGate(await fixture('soft-alpha-preview.png'), { allowSoftAlpha: true })
    expect(r.ok).toBe(true)
    expect(r.softPixels).toBe(2658)
  })
})

describe('paletteGate', () => {
  it('RED on a crop of the real generation: every opaque pixel is off the master palette', async () => {
    const r = paletteGate(await fixture('raw-crop-offpalette.png'))
    expect(r.ok).toBe(false)
    expect(r.offPalette).toBe(128 * 128)
    expect(r.offenders[0]!.count).toBeGreaterThan(0)
    expect(r.offenders.length).toBeLessThanOrEqual(8)
  })
  it('GREEN on the real chair sprite, which was quantized to the palette', async () => {
    const r = paletteGate(await fixture('chair-128.png'))
    expect(r.ok).toBe(true)
    expect(r.offPalette).toBe(0)
  })
})

describe('nativeDensityGate', () => {
  it('RED on every shipped library item: 24 px over a 1x1 footprint on the 32x16 tile is 0.75 art px', () => {
    const r = nativeDensityGate({
      name: 'bed', canvas: { w: 24, h: 24 }, footprint: { w: 1, h: 1 }, tile: { w: 32, h: 16 },
    })
    expect(r.ok).toBe(false)
    expect(r.density).toBeCloseTo(0.75, 6)
    expect(r.failures.join(' ')).toContain('0.75')
  })
  it('GREEN at the C-level target: 128 px over a 1x1 footprint on the 128x64 interior tile', () => {
    const r = nativeDensityGate({
      name: 'chair', canvas: { w: 128, h: 128 }, footprint: { w: 1, h: 1 }, tile: { w: 128, h: 64 },
    })
    expect(r).toMatchObject({ ok: true, density: 1 })
  })
  it('the mock bed was already at density 1 — its defect was the 2.667x downscale, not its size', () => {
    expect(nativeDensityGate({
      name: 'bed', canvas: { w: 192, h: 192 }, footprint: { w: 1, h: 2 }, tile: { w: 128, h: 64 },
    })).toMatchObject({ ok: true, density: 1 })
  })
})

describe('classDensityGate', () => {
  it('RED on treatment C as shipped: the 512 floor sits beside furniture authored at 128', () => {
    const r = classDensityGate([
      { name: 'mat-floor', density: 4 },
      { name: 'mat-flagstone', density: 2 },
      { name: 'furniture-chair', density: 1 },
    ])
    expect(r.ok).toBe(false)
    expect(r.densities).toEqual([1, 2, 4])
    expect(r.failures[0]).toContain('mat-floor')
  })
  it('GREEN when every member shares one density', () => {
    expect(classDensityGate([{ name: 'a', density: 1 }, { name: 'b', density: 1 }]).ok).toBe(true)
  })
})

describe('tileSeamGate', () => {
  it('RED on the real repeating wall piece: the wrap seam is far above its own interior noise', async () => {
    const r = tileSeamGate(await fixture('wall-plain-256x160.png'))
    expect(r.ok).toBe(false)
    expect(r.wrapH / r.baselineH).toBeGreaterThan(SEAM_RATIO_MAX)
    expect(r.wrapH).toBeGreaterThan(SEAM_ABSOLUTE_FLOOR)
  })
  it('GREEN on a flat field, which wraps onto itself perfectly', () => {
    expect(tileSeamGate(solid(16, 16, [0xff, 0xf6, 0xe9, 255])).ok).toBe(true)
  })
})

describe('tilesetVarietyGate', () => {
  it('RED on the real treatment-C wall run: the plain piece comes back every 4 tiles', () => {
    const r = tilesetVarietyGate(
      ['plain', 'window', 'plain', 'dresser', 'plain', 'window', 'plain', 'door'], { minPeriod: 5 })
    expect(r.ok).toBe(false)
    expect(r.shortestPeriod).toBe(2)
    expect(r.failures[0]).toContain('plain')
  })
  it('GREEN when no piece recurs inside the minimum period', () => {
    expect(tilesetVarietyGate(['a', 'b', 'c', 'd', 'e', 'a'], { minPeriod: 5 }).ok).toBe(true)
  })
})

describe('pixelBarReport', () => {
  it('names the one thing wrong with the real bed: the downscale, nothing else', async () => {
    const r = await pixelBarReport({
      name: 'furniture-bed', img: await fixture('bed-192.png'), raw: { w: 512, h: 512 },
      footprint: { w: 1, h: 2 }, tile: { w: 128, h: 64 },
    })
    expect(r.ok).toBe(false)
    expect(r.failures).toHaveLength(1)
    expect(r.failures[0]).toContain('2.667')
  })
  it('collects failures from every gate it was handed', async () => {
    const r = await pixelBarReport({
      name: 'wall-plain', img: await fixture('wall-plain-256x160.png'),
      raw: { w: 512, h: 512 }, artPx: 3, seam: true,
    })
    expect(r.ok).toBe(false)
    expect(r.failures.length).toBeGreaterThanOrEqual(3)
    expect(r.failures.join(' ')).toContain('anisotropic')
    expect(r.failures.join(' ')).toContain('seam')
  })
})

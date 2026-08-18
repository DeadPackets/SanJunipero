import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { decodePng, type RawImage } from './post/raw.js'
import { MASTER_PALETTE, paletteRgb } from './palette.js'
import { quantize } from './post/quantize.js'
import { paletteGate } from './pixelGates.js'
import { PALETTE_RAMPS, RAMP_STEPS, derivedPalette, onARamp } from './ramps.js'

const fixture = (n: string): Promise<RawImage> =>
  decodePng(readFileSync(new URL(`./fixtures/pixel-gates/${n}`, import.meta.url)))

const tones = (img: RawImage): Set<number> => {
  const s = new Set<number>()
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] === 0) continue
    s.add((img.data[i]! << 16) | (img.data[i + 1]! << 8) | img.data[i + 2]!)
  }
  return s
}

describe('PALETTE_RAMPS', () => {
  it('names every member of the master palette exactly once', () => {
    const claimed = Object.values(PALETTE_RAMPS).flat(2)
    expect(claimed).toHaveLength(MASTER_PALETTE.length)
    expect(new Set(claimed).size).toBe(MASTER_PALETTE.length)
    expect([...claimed].sort((a, b) => a - b)).toEqual(MASTER_PALETTE.map((_, i) => i))
  })

  it('keeps the warm accents apart, because four unrelated hues are not a ramp', () => {
    // #F7A66B orange, #E8785A red, #8A6FA8 purple, #F4E289 yellow — interpolating between
    // them would invent arbitrary colour, which is exactly what the ruling forbids
    expect(PALETTE_RAMPS.accent).toHaveLength(4)
    for (const r of PALETTE_RAMPS.accent!) expect(r).toHaveLength(1)
  })
})

describe('derivedPalette', () => {
  it('is the master palette plus tones interpolated INSIDE a ramp, never between ramps', () => {
    const d = derivedPalette()
    const master = paletteRgb()
    for (const m of master) expect(d).toContainEqual(m)
    expect(d.length).toBeGreaterThan(master.length)
    // every derived tone lies on a segment between two adjacent members of one ramp
    for (const c of d) expect(onARamp(c), `#${c.map(v => v.toString(16)).join('')}`).toBe(true)
  })

  it('holds no duplicates, so the count is the real width of the palette', () => {
    const d = derivedPalette()
    expect(new Set(d.map(([r, g, b]) => (r << 16) | (g << 8) | b)).size).toBe(d.length)
  })

  it('refuses to call an arbitrary colour derived', () => {
    expect(onARamp([0, 255, 0])).toBe(false)      // pure green is nowhere on this palette
    expect(onARamp([255, 0, 255])).toBe(false)    // the chroma key itself
    expect(onARamp(paletteRgb()[0]!)).toBe(true)  // a master member is trivially on its ramp
  })

  it('widens with the step count and stays inside the ramps', () => {
    expect(derivedPalette(4).length).toBeGreaterThan(derivedPalette(2).length)
    for (const c of derivedPalette(4)) expect(onARamp(c)).toBe(true)
  })
})

describe('the portrait, re-quantized under derived ramps', () => {
  it('RED-proves the master palette costs the face: skin and hair collapse', async () => {
    const shipped = await fixture('portrait-neutral-128.png')
    const master = tones(quantize(shipped, paletteRgb()))
    const derived = tones(quantize(shipped, derivedPalette()))
    expect(derived.size).toBeGreaterThan(master.size)
  })

  it('passes the palette gate under the derived ramps and fails under the master', async () => {
    const shipped = await fixture('portrait-neutral-128.png')
    const q = quantize(shipped, derivedPalette())
    expect(paletteGate(q, { palette: derivedPalette() }).ok).toBe(true)
    expect(paletteGate(q).ok).toBe(false)
    // and the exemption it replaces is gone: nothing passes just by asking
    expect(paletteGate(shipped, { palette: derivedPalette() }).ok).toBe(false)
  })

  it('is a WIDER gate, not an open one: the raw generation still fails it', async () => {
    expect(paletteGate(await fixture('raw-crop-offpalette.png'), { palette: derivedPalette() }).ok).toBe(false)
  })

  it('publishes the step count it used, so the width is on the record', () => {
    expect(RAMP_STEPS).toBeGreaterThanOrEqual(2)
    expect(derivedPalette().length).toBe(derivedPalette(RAMP_STEPS).length)
  })
})

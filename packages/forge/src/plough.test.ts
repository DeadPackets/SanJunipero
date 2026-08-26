import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { decodePng, type RawImage } from './post/raw.js'
import { paletteGate, tileSeamGate } from './pixelGates.js'
import { MATERIAL_PX } from './terrainGen.js'
import { FURROW_PITCH_PX, ploughFurrows } from './plough.js'

// Fold every pixel onto its phase of (x + 2y) mod pitch and ask how far the profile moves (the
// ridge) against how far individual lines stray from it (one-off marks). A measurement, not a gate.
function furrowPeriodicity(
  m: RawImage,
  pitch: number,
): { withinPitch: number; acrossPitch: number } {
  const lines = new Map<number, { s: number; n: number }>()
  for (let y = 0; y < m.height; y++)
    for (let x = 0; x < m.width; x++) {
      const i = (y * m.width + x) * 4
      const key = x + 2 * y
      const e = lines.get(key) ?? { s: 0, n: 0 }
      e.s += (m.data[i]! + m.data[i + 1]! + m.data[i + 2]!) / 3
      e.n++
      lines.set(key, e)
    }
  const phase = Array.from({ length: pitch }, () => ({ s: 0, n: 0 }))
  for (const [key, e] of lines) {
    const p = phase[key % pitch]!
    p.s += e.s / e.n
    p.n++
  }
  const mean = phase.map((p) => p.s / p.n)
  const withinPitch = Math.max(...mean) - Math.min(...mean)
  let acrossPitch = 0,
    n = 0
  for (const [key, e] of lines) {
    acrossPitch += Math.abs(e.s / e.n - mean[key % pitch]!)
    n++
  }
  return { withinPitch, acrossPitch: acrossPitch / n }
}

const material = (name: string): Promise<RawImage> =>
  decodePng(readFileSync(new URL(`../content/tilesets/materials/${name}.png`, import.meta.url)))

describe('ploughFurrows', () => {
  it('RED-proves the rejected art: it has no furrow in it at all', async () => {
    // FROZEN, because the moment the content was fixed this test stopped being RED against it
    const rejected = await decodePng(
      readFileSync(new URL('./fixtures/pixel-gates/rejected-farmland_0.png', import.meta.url)),
    )
    const p = furrowPeriodicity(rejected, FURROW_PITCH_PX)
    // The rejected material self-tiles into rows of isometric cottages: whatever profile you fold
    // it onto, the lines stray from it by just as much — no repeating structure at this pitch.
    expect(p.withinPitch / p.acrossPitch).toBeLessThan(2)
  })

  it('and the material that replaces it does have one, by a factor of thirty', async () => {
    const p = furrowPeriodicity(await material('terrain_farmland_0'), FURROW_PITCH_PX)
    expect(p.withinPitch / p.acrossPitch).toBeGreaterThan(20)
  })

  it('gives the soil a furrow that repeats, and repeats at the pitch it claims', async () => {
    const ploughed = ploughFurrows(await material('terrain_earth_0'))
    const p = furrowPeriodicity(ploughed, FURROW_PITCH_PX)
    expect(p.withinPitch / p.acrossPitch).toBeGreaterThan(20)
    expect(p.withinPitch).toBeGreaterThan(10)
  })

  it('wraps by arithmetic: the pitch divides the material, so the furrow cannot break', async () => {
    expect(MATERIAL_PX % FURROW_PITCH_PX).toBe(0)
    const ploughed = ploughFurrows(await material('terrain_earth_0'))
    expect(tileSeamGate(ploughed).failures).toEqual([])
  })

  it('stays on the master palette and fully opaque', async () => {
    const ploughed = ploughFurrows(await material('terrain_earth_0'))
    expect(paletteGate(ploughed).failures).toEqual([])
    for (let i = 3; i < ploughed.data.length; i += 4) expect(ploughed.data[i]).toBe(255)
  })

  it('refuses a pitch that does not divide the material, because that is the seam', async () => {
    await expect(async () =>
      ploughFurrows(await material('terrain_earth_0'), { pitch: 7 }),
    ).rejects.toThrow(/pitch 7/)
  })
})

import { describe, it, expect } from 'vitest'
import { applyTint, type Tint } from './tints.js'

// Spec §7 atmosphere: deep blue moonlit night, golden dawn, grey-green storm, snow-blued winter.
// Nothing ships against these; the renderer's own LUT was calibrated from them by hand.
const TINTS: Record<'day' | 'night' | 'dawn' | 'storm' | 'winter', Tint> = {
  day: { r: 1.0, g: 1.0, b: 1.0 },
  night: { r: 0.45, g: 0.52, b: 0.95 },
  dawn: { r: 1.12, g: 0.94, b: 0.78 },
  storm: { r: 0.72, g: 0.82, b: 0.76 },
  winter: { r: 0.86, g: 0.93, b: 1.1 },
}

describe('atmosphere tints', () => {
  it('defines the five spec moods', () => {
    expect(Object.keys(TINTS).sort()).toEqual(['dawn', 'day', 'night', 'storm', 'winter'])
  })
  it('night is blue-heavy, dawn is warm', () => {
    expect(TINTS.night.b).toBeGreaterThan(TINTS.night.r)
    expect(TINTS.dawn.r).toBeGreaterThan(TINTS.dawn.b)
  })
  it('applyTint multiplies channels, clamps, and preserves alpha', () => {
    const img = { width: 1, height: 1, data: new Uint8ClampedArray([200, 100, 50, 123]) }
    const out = applyTint(img, { r: 0.5, g: 1, b: 6 })
    expect([...out.data]).toEqual([100, 100, 255, 123])
    expect([...img.data]).toEqual([200, 100, 50, 123]) // pure
  })
})

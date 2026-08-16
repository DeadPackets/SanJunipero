import { describe, it, expect } from 'vitest'
import { TINTS, applyTint } from './tints.js'

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

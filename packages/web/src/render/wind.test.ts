import { describe, expect, it } from 'vitest'
import { advanceWind, crownOffsetPx, wind, windNow } from './wind.js'

describe('★ U6 — one wind the whole town reads', () => {
  it('stays inside [-1, 1] over an hour, sampled every 50 ms', () => {
    let lo = Infinity,
      hi = -Infinity
    for (let t = 0; t < 3600; t += 0.05) {
      const w = wind(t)
      lo = Math.min(lo, w)
      hi = Math.max(hi, w)
    }
    expect(lo).toBeGreaterThanOrEqual(-1)
    expect(hi).toBeLessThanOrEqual(1)
    // and it USES the range: a gust reaches past half strength both ways
    expect(lo).toBeLessThan(-0.5)
    expect(hi).toBeGreaterThan(0.5)
  })

  it('is a wind, not a strobe: no two samples 50 ms apart differ by more than a hundredth', () => {
    for (let t = 0; t < 600; t += 0.05)
      expect(Math.abs(wind(t + 0.05) - wind(t))).toBeLessThan(0.03)
  })

  it('the shared clock advances the getter every reader sees', () => {
    const before = windNow()
    advanceWind(16.7 * 60 * 3)
    expect(windNow()).not.toBe(before)
    expect(Math.abs(windNow())).toBeLessThanOrEqual(1)
  })

  it('a crown leans by whole pixels only, and never further than three', () => {
    for (let t = 0; t < 600; t += 0.1) {
      for (const phase of [0, 1.3, 2.7, 5.9]) {
        const off = crownOffsetPx(wind(t), phase)
        expect(Number.isInteger(off)).toBe(true)
        expect(Math.abs(off)).toBeLessThanOrEqual(3)
      }
    }
  })
})

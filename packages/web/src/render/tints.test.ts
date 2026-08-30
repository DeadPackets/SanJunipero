import { describe, expect, it } from 'vitest'
import { CLOCK_STOPS, WEATHER_DIAG, clockTint, gradingMatrix, skyLevel } from './tints.js'

describe('clock tint LUT', () => {
  it('pins the calibrated stops', () => {
    expect(CLOCK_STOPS[0]).toEqual({ minute: 0, tint: [0.45, 0.52, 0.95] })
    expect(CLOCK_STOPS.at(-1)).toEqual({ minute: 1440, tint: [0.45, 0.52, 0.95] })
    expect(CLOCK_STOPS.map((s) => s.minute)).toEqual([0, 300, 390, 480, 1050, 1140, 1230, 1440])
  })

  it('deep night at 04:00 packs to 0x7385F2', () => {
    expect(clockTint(240)).toBe(0x7385f2)
  })

  it('06:45 lands mid-lerp between dawn and full day (channel math, not a magic hex)', () => {
    const lerp = (a: number, b: number): number => Math.round(((a + b) / 2) * 255)
    const expected = (lerp(1.0, 1.0) << 16) | (lerp(0.94, 1.0) << 8) | lerp(0.78, 1.0)
    expect(clockTint(435)).toBe(expected)
  })

  it('full day is white', () => {
    expect(clockTint(700)).toBe(0xffffff)
  })
})

// The three clocks the picture used to read — a boolean at 20:00, a phase step at 19:00 and
// 21:00, a continuous tint — are replaced by this one curve (D4).
describe('skyLevel — the one day clock', () => {
  it('is 0 through the night and 1 through the day', () => {
    for (const m of [0, 120, 300, 1230, 1439]) expect(skyLevel(m)).toBe(0)
    for (const m of [480, 720, 1050]) expect(skyLevel(m)).toBe(1)
  })

  it('rises monotonically through dawn and falls monotonically through dusk', () => {
    for (let m = 300; m < 480; m++) expect(skyLevel(m + 1)).toBeGreaterThanOrEqual(skyLevel(m))
    for (let m = 1050; m < 1230; m++) expect(skyLevel(m + 1)).toBeLessThanOrEqual(skyLevel(m))
  })

  it('is continuous: no minute steps by more than a ramp minute is worth', () => {
    const maxStep = 1 / 60 // the shortest ramp is 90 minutes; 1/60 leaves slack for rounding
    for (let m = 0; m < 1440; m++)
      expect(Math.abs(skyLevel(m + 1) - skyLevel(m)), `minute ${m}`).toBeLessThanOrEqual(maxStep)
  })

  it('reads dusk at 19:00 as mostly day still — the lamps come on as the sky goes, not at once', () => {
    const dusk = skyLevel(1140)
    expect(dusk).toBeGreaterThan(0.8)
    expect(dusk).toBeLessThan(1)
    expect(skyLevel(1200)).toBeGreaterThan(0)
    expect(skyLevel(1200)).toBeLessThan(dusk)
  })
})

describe('weather grading', () => {
  it('holds blue at 1.00 and pulls red, so a storm is a blue cast and not a green one', () => {
    for (const [kind, [r, g, b]] of Object.entries(WEATHER_DIAG)) {
      expect(b, kind).toBe(1)
      expect(r, kind).toBeLessThan(g)
      expect(g, kind).toBeLessThanOrEqual(b)
    }
    expect(WEATHER_DIAG.storm).toEqual([0.72, 0.84, 1.0])
    expect(WEATHER_DIAG.rain).toEqual([0.84, 0.92, 1.0])
  })

  it('lays the diagonal on the pixi 4×5 matrix', () => {
    const m = gradingMatrix('storm')!
    expect(m).toBeInstanceOf(Float32Array)
    expect(m[0]).toBeCloseTo(0.72, 6)
    expect(m[6]).toBeCloseTo(0.84, 6)
    expect(m[12]).toBeCloseTo(1.0, 6)
    expect(m[18]).toBe(1)
  })

  it('cloudy is no longer identical to sunny', () => {
    expect(gradingMatrix('cloudy')).not.toBeNull()
  })

  it('sunny is identity (no filter)', () => {
    expect(gradingMatrix('sunny')).toBeNull()
  })
})

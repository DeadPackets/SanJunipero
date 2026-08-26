import { describe, expect, it } from 'vitest'
import { CLOCK_STOPS, clockTint, gradingMatrix } from './tints.js'

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

describe('weather grading', () => {
  it('storm/rain greys toward green, any season', () => {
    const m = gradingMatrix('storm', 'spring')!
    expect(m).toBeInstanceOf(Float32Array)
    expect(m[0]).toBeCloseTo(0.72, 6)
    expect(m[6]).toBeCloseTo(0.82, 6)
    expect(m[12]).toBeCloseTo(0.76, 6)
    expect(m[18]).toBe(1)
    expect(gradingMatrix('rain', 'summer')![0]).toBeCloseTo(0.72, 6)
  })

  it('winter snow/clear cools toward blue, clamped to 1.0 headroom', () => {
    for (const kind of ['snow', 'clear']) {
      const m = gradingMatrix(kind, 'winter')!
      expect(m[0]).toBeCloseTo(0.86, 6)
      expect(m[6]).toBeCloseTo(0.93, 6)
      expect(m[12]).toBeCloseTo(1.0, 6)
    }
  })

  it('clear outside winter is identity (no filter)', () => {
    expect(gradingMatrix('sunny', 'summer')).toBeNull()
    expect(gradingMatrix('clear', 'spring')).toBeNull()
    expect(gradingMatrix('snow', 'summer')).toBeNull()
  })
})

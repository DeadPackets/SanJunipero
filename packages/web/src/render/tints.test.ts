import { describe, expect, it } from 'vitest'
import {
  CLOCK_STOPS,
  NIGHT_FLOOR,
  SUN_STOPS,
  WEATHER_DIAG,
  clockTint,
  gradingMatrix,
  skyLevel,
  sunTint,
} from './tints.js'
import { SUN_DOWN_MIN, SUN_UP_MIN } from '../ui/skyModel.js'
import { AA_RATIO, WORLD_TEXT_PAIRS, readableRatio } from './legibility.js'

describe('clock tint LUT', () => {
  it('pins the calibrated stops', () => {
    expect(CLOCK_STOPS[0]).toEqual({ minute: 0, tint: NIGHT_FLOOR })
    expect(CLOCK_STOPS.at(-1)).toEqual({ minute: 1440, tint: NIGHT_FLOOR })
    expect(CLOCK_STOPS.map((s) => s.minute)).toEqual([0, 300, 390, 480, 1050, 1140, 1230, 1440])
  })

  // ★ THE NIGHT FLOOR (task 18). 0.45/0.52 read as a hole in the picture: a roof under it
  // measured 0.536 of its own luma. The floor is lifted to a watchable blue and the hue held.
  it('★ the night floor is [0.5, 0.58, 0.95], and 04:00 packs to 0x8094F2', () => {
    expect(NIGHT_FLOOR).toEqual([0.5, 0.58, 0.95])
    expect(clockTint(240)).toBe(0x8094f2)
  })

  it('★ lifts the night without turning it: the same blue cast, brighter', () => {
    const [r, g, b] = NIGHT_FLOOR
    expect(b).toBe(0.95)
    expect(r).toBeLessThan(g)
    expect(g).toBeLessThan(b)
    // 0.536 → 0.590 of the material's own luma, measured off the floor rather than chosen
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    expect(lum).toBeGreaterThan(0.58)
    expect(lum).toBeLessThan(0.62)
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

describe('★ SUN_STOPS — the colour of the light that arrives', () => {
  it('★ is warm at every stop, and palest overhead', () => {
    for (const { minute, tint } of SUN_STOPS) {
      const [r, g, b] = tint
      expect(r, `${minute}`).toBe(1)
      expect(g, `${minute}`).toBeGreaterThan(b)
      expect(b, `${minute}`).toBeLessThan(1)
    }
    const noon = (SUN_UP_MIN + SUN_DOWN_MIN) / 2
    expect(sunTint(noon) & 0xff).toBeGreaterThan(sunTint(SUN_UP_MIN) & 0xff)
  })

  it('★ covers the sun arc end to end, so no daylight minute falls off the table', () => {
    expect(SUN_STOPS[0]!.minute).toBe(SUN_UP_MIN)
    expect(SUN_STOPS.at(-1)!.minute).toBe(SUN_DOWN_MIN)
    for (let i = 0; i < SUN_STOPS.length - 1; i++)
      expect(SUN_STOPS[i + 1]!.minute).toBeGreaterThan(SUN_STOPS[i]!.minute)
  })

  it('★ warms toward the horizon at both ends, and moves a minute at a time', () => {
    const blue = (m: number): number => sunTint(m) & 0xff
    const noon = (SUN_UP_MIN + SUN_DOWN_MIN) / 2
    for (let m = SUN_UP_MIN; m < noon; m++)
      expect(blue(m + 1), `${m}`).toBeGreaterThanOrEqual(blue(m))
    for (let m = noon; m < SUN_DOWN_MIN; m++)
      expect(blue(m + 1), `${m}`).toBeLessThanOrEqual(blue(m))
    for (let m = SUN_UP_MIN; m < SUN_DOWN_MIN; m++)
      expect(Math.abs(blue(m + 1) - blue(m)), `${m}`).toBeLessThanOrEqual(1)
  })
})

// ── ★ WHAT ACTUALLY PRICES THE NIGHT FLOOR ───────────────────────────────────────────────
//
// The floor was asked to drop to 0.300 of luma so the lamps would have a dark to be bright
// against. It cannot, and the reason is not the picture. `screen.night` is a full-screen
// MULTIPLY on `app.stage` ABOVE `world`, so it darkens `worldText`, `bubbles` and `overlay` —
// the three layers `GRADED_LAYERS` deliberately keeps OUT of the weather grade. Speech is
// protected from the weather and not from the night, and `AA_RATIO` then sets the floor.

describe('★ the night floor is priced by the text law, not by the picture', () => {
  const scaled = (k: number): number => {
    const [r, g, b] = NIGHT_FLOOR
    const ch = (v: number): number => Math.round(v * k * 255)
    return (ch(r) << 16) | (ch(g) << 8) | ch(b)
  }
  const worstPair = (tint: number): number =>
    Math.min(...WORLD_TEXT_PAIRS.map((p) => readableRatio(p.ink, p.paper, tint)))

  it('★ 0.300 of luma puts EVERY pair under AA, black on white included', () => {
    const k = 0.3 / (0.2126 * NIGHT_FLOOR[0] + 0.7152 * NIGHT_FLOOR[1] + 0.0722 * NIGHT_FLOOR[2])
    const tint = scaled(k)
    expect(worstPair(tint)).toBeLessThan(AA_RATIO)
    // the ceiling for ANY two colours at that tint, which is what makes it unreachable
    expect(readableRatio(0x000000, 0xffffff, tint)).toBeLessThan(AA_RATIO)
  })

  it('★ today clears AA with room, and the deepest legal floor has almost none', () => {
    expect(worstPair(clockTint(0))).toBeGreaterThan(AA_RATIO)
    let deepest = 1
    while (deepest > 0.3 && worstPair(scaled(deepest - 0.002)) >= AA_RATIO) deepest -= 0.002
    // 0.896 of today's floor, where the thought bubble sits at 4.51:1 — 0.2% of margin, which
    // an antialiased glyph edge spends on its own. The floor moves when the night stops
    // multiplying the words, and not before.
    expect(deepest).toBeGreaterThan(0.85)
    expect(deepest).toBeLessThan(0.95)
    expect(worstPair(scaled(deepest))).toBeLessThan(4.6)
  })
})

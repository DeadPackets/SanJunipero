import { describe, expect, it } from 'vitest'
import type { WorldState } from '@sj/engine/state'
import { MINUTES_PER_DAY, dayPhaseFromTick } from '@sj/shared'
import { WEATHER_GLYPH } from './townStats.js'
import {
  SUN_DOWN_MIN,
  SUN_UP_MIN,
  GOLDEN_ELEVATION,
  SHADOW_MAX_STRETCH,
  SHADOW_REST,
  moonAltitude,
  shadowCast,
  skyKind,
  skyToken,
  skyWord,
} from './skyModel.js'

const at = (h: number, min = 0): number => h * 60 + min

describe('★ 5A — one traveller, and where it has got to is the clock', () => {
  it('puts the sun on the arc between its rise and its set, and the moon on the rest', () => {
    expect(skyToken(at(5)).kind).toBe('sun')
    expect(skyToken(at(12)).kind).toBe('sun')
    expect(skyToken(at(20, 59)).kind).toBe('sun')
    expect(skyToken(at(21)).kind).toBe('moon')
    expect(skyToken(at(0)).kind).toBe('moon')
    expect(skyToken(at(4, 59)).kind).toBe('moon')
  })

  // The arc and the light on the town read one boundary, or they disagree about when it got dark.
  it('★ agrees with the only phase derivation in the codebase', () => {
    for (let m = 0; m < MINUTES_PER_DAY; m += 7) {
      const night = dayPhaseFromTick(m) === 'night'
      expect(skyToken(m).kind === 'moon', `${m}`).toBe(night)
    }
    expect(SUN_UP_MIN).toBe(at(5))
    expect(SUN_DOWN_MIN).toBe(at(21))
  })

  it('starts each traveller at the left of the road and lands it at the right', () => {
    expect(skyToken(SUN_UP_MIN).along).toBe(0)
    expect(skyToken(SUN_DOWN_MIN - 1).along).toBeCloseTo(1, 1)
    expect(skyToken(SUN_DOWN_MIN).along).toBe(0)
    expect(skyToken(at(12)).along).toBeCloseTo(0.4375, 4)
  })

  it('walks it forward hour by hour, and never backwards inside a day', () => {
    let last = -1
    for (let m = SUN_UP_MIN; m < SUN_DOWN_MIN; m += 30) {
      const along = skyToken(m).along
      expect(along, `${m}`).toBeGreaterThan(last)
      last = along
    }
  })

  it('reads the day from a later tick, not just from the first one', () => {
    expect(skyToken(3 * MINUTES_PER_DAY + at(12)).along).toBeCloseTo(skyToken(at(12)).along, 6)
  })
})

describe('the words the bar sets beside the track', () => {
  it('names the weather and the temperature it actually is', () => {
    const state = { weather: { kind: 'storm', temperatureC: 4 } } as unknown as WorldState
    expect(skyWord(state)).toBe('STORM 4°')
    expect(skyKind(state)).toBe('storm')
  })

  it('says nothing about a sky it has not been told, rather than inventing one', () => {
    expect(skyWord(null)).toBe('')
    expect(WEATHER_GLYPH[skyKind(null)]).toBeDefined()
  })

  // WEATHER_GLYPH was written and never mounted; the bar is its home.
  it('has a drawn glyph for every kind the world can report', () => {
    for (const kind of ['sunny', 'cloudy', 'rain', 'storm', 'snow']) {
      expect(WEATHER_GLYPH[kind], kind).toBeDefined()
    }
  })
})

// ── ★ THE SAME TRAVELLER, ON THE GROUND (task 18) ────────────────────────────────────────
//
// `skyToken` says where the sun and the moon have got to. The moon over the town and every
// body's shadow read the SAME traveller, or the picture disagrees with itself about the hour.

describe('★ the moon lights the town it is drawn over', () => {
  it('★ is nothing while the sun is up, and highest in the middle of the night', () => {
    for (const h of [6, 12, 18, 20]) expect(moonAltitude(at(h)), `${h}:00`).toBe(0)
    expect(moonAltitude(at(21))).toBeCloseTo(0, 6)
    expect(moonAltitude(at(1))).toBeGreaterThan(0.99) // 21:00 to 05:00, so 01:00 is the top
  })

  it('rises and sets with the same token the sky model reports', () => {
    for (const m of [0, 200, 1300, 1439]) {
      const tok = skyToken(m)
      expect(moonAltitude(m) > 0, `minute ${m}`).toBe(tok.kind === 'moon' && tok.along > 0)
    }
    expect(moonAltitude(at(2))).toBeCloseTo(Math.sin(Math.PI * skyToken(at(2)).along), 12)
  })

  it('never leaves the unit band, at any minute of any day', () => {
    for (let m = 0; m < MINUTES_PER_DAY * 2; m++) {
      expect(moonAltitude(m)).toBeGreaterThanOrEqual(0)
      expect(moonAltitude(m)).toBeLessThanOrEqual(1)
    }
  })
})

describe('★ golden hour: a low sun throws a long shadow', () => {
  it('★ casts nothing at all at noon — the blob under the feet is the whole of it', () => {
    expect(shadowCast(at(12))).toEqual(SHADOW_REST)
  })

  it('★ draws out through the golden band and is home before the sun sets', () => {
    const dusk = shadowCast(at(20, 30))
    expect(dusk.scaleX).toBeGreaterThan(1.5)
    expect(dusk.scaleX).toBeLessThanOrEqual(SHADOW_MAX_STRETCH)
    const higher = shadowCast(at(17))
    expect(higher.scaleX).toBeLessThan(dusk.scaleX)
    expect(higher.scaleX).toBeGreaterThanOrEqual(1)
    // and nothing snaps at the minute the light goes: the last lit minute is already at rest
    expect(shadowCast(at(20, 59)).scaleX).toBeLessThan(1.05)
  })

  it('★ falls AWAY from the sun: east at dawn, west at dusk', () => {
    expect(shadowCast(at(6)).dx).toBeGreaterThan(0)
    expect(shadowCast(at(20, 30)).dx).toBeLessThan(0)
    expect(shadowCast(at(12)).dx).toBe(0)
  })

  it('★ softens as it lengthens — a long shadow is a weak one', () => {
    expect(shadowCast(at(20, 30)).alpha).toBeLessThan(1)
    expect(shadowCast(at(12)).alpha).toBe(1)
  })

  it('★ the night has no cast shadow at all: the moon is a wash, not a lamp', () => {
    for (const h of [22, 0, 3]) expect(shadowCast(at(h)), `${h}:00`).toEqual(SHADOW_REST)
  })

  it('is continuous and bounded across the whole day', () => {
    let prev = shadowCast(0)
    for (let m = 1; m < MINUTES_PER_DAY; m++) {
      const c = shadowCast(m)
      expect(c.scaleX).toBeGreaterThanOrEqual(1)
      expect(c.scaleX).toBeLessThanOrEqual(SHADOW_MAX_STRETCH)
      expect(Math.abs(c.scaleX - prev.scaleX), `minute ${m}`).toBeLessThan(0.1)
      prev = c
    }
  })

  it("the golden band is a fraction of the sun's own height, not an hour of its own", () => {
    expect(GOLDEN_ELEVATION).toBeGreaterThan(0)
    expect(GOLDEN_ELEVATION).toBeLessThan(1)
  })
})

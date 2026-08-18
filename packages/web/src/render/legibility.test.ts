import { describe, expect, it } from 'vitest'
import {
  AA_RATIO, LANDMARK_INK, LANDMARK_PLATE, LIGHT_BANDS, WORLD_TEXT_PAIRS, bandRatios,
  readableRatio, tintedBy, worldTextOffenders,
} from './legibility.js'
import { TILE_COLORS } from './ground.js'
import { SPEECH_FILL, SPEECH_INK, THOUGHT_FILL, THOUGHT_INK } from './textFaces.js'
import { clockTint } from './tints.js'

describe('the two light bands the town is actually read in', () => {
  it('takes them from the clock, never from a second copy of the numbers', () => {
    expect(LIGHT_BANDS.day).toBe(clockTint(720))
    expect(LIGHT_BANDS.night).toBe(clockTint(0))
    expect(LIGHT_BANDS.day).toBe(0xffffff)
  })

  it('multiplies a colour the way the night quad does', () => {
    expect(tintedBy(0xffffff, LIGHT_BANDS.day)).toBe(0xffffff)
    expect(tintedBy(0x000000, LIGHT_BANDS.night)).toBe(0x000000)
    // the night quad is a MULTIPLY blend, so white takes the tint exactly
    expect(tintedBy(0xffffff, LIGHT_BANDS.night)).toBe(LIGHT_BANDS.night)
  })

  it('agrees with WCAG on a pair nobody argues about', () => {
    expect(readableRatio(0x000000, 0xffffff, LIGHT_BANDS.day)).toBeCloseTo(21, 1)
  })
})

// ★ THE NIGHT TINT IS A MULTIPLY OVER THE WHOLE STAGE, WORLD TEXT INCLUDED. A ratio quoted for
// the MATERIAL is not the ratio the viewer gets after dark, and the difference is the whole
// gap between "AA" and "unreadable". The ceiling under the deep-night tint is 6.37:1 — black
// on white — so there is not much room, and every pair below has to be chosen inside it.
describe('every word the world says clears AA in BOTH bands, not just in daylight', () => {
  it('names the pairs it is checking, so a new world surface cannot skip the law', () => {
    expect(WORLD_TEXT_PAIRS.length).toBeGreaterThanOrEqual(3)
    for (const p of WORLD_TEXT_PAIRS) expect(p.what.length).toBeGreaterThan(0)
  })

  it('has no offender', () => {
    expect(worldTextOffenders(WORLD_TEXT_PAIRS)).toEqual([])
  })

  it('a landmark name is on a plate, never straight on the ground it names', () => {
    const r = bandRatios(LANDMARK_INK, LANDMARK_PLATE)
    expect(r.day).toBeGreaterThanOrEqual(AA_RATIO)
    expect(r.night).toBeGreaterThanOrEqual(AA_RATIO)
    // and the ground it used to be painted on could never have carried it
    for (const ground of Object.values(TILE_COLORS)) {
      expect(bandRatios(LANDMARK_INK, ground).night).toBeLessThan(AA_RATIO)
    }
  })

  it('keeps speech and thought on different PAPER, both of which hold the ink after dark', () => {
    expect(SPEECH_FILL).not.toBe(THOUGHT_FILL)
    for (const [ink, fill] of [[SPEECH_INK, SPEECH_FILL], [THOUGHT_INK, THOUGHT_FILL]] as const) {
      expect(bandRatios(ink, fill).night).toBeGreaterThanOrEqual(AA_RATIO)
    }
  })
})

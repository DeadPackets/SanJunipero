import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  AA_RATIO, LANDMARK_INK, LANDMARK_PLATE, LIGHT_BANDS, UI_BOUNDARY_RATIO, WORLD_TEXT_PAIRS,
  bandRatios, groundMarkOffenders, over, readableRatio, tintedBy, worldTextOffenders,
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

// ── ★ THE DOOR SILL WAS A MARK WITH NO PAPER, AND NOW IT IS NOT DRAWN AT ALL ──────────────
//
// `web-polish` measured this mark honestly and improved it as far as a ground mark can go: a
// dimmed rim fails 1.4.11 on every ground it can be laid on, an opaque one fails after dark,
// and NO single colour clears both bands — so the sill was given the stepped ledge, whose
// contrast is with itself. Every one of those numbers still holds and they are kept below.
//
// ★ WHAT CHANGED IS THE QUESTION. The user retired the affordance itself: *"the 'click to
// inspect or enter building' squares [must] be retired and instead replaced with accurate
// hitboxes of the actual structures themselves."* A honey slab lying on the grass is not the
// door of a house that is drawn standing up out of the grass — and in the running product it
// does not even land under the drawn door, because the art's lowest row sits at the sprite's
// own anchor while the sill is cut from the true ground plan below it. The building's own
// doorway is the mark; the hover tag says what a click will do.
//
// So the measurements below are the standing reason nobody may put a mark back on the GROUND,
// and the last case is the guard that nobody has.

/** The tile tones the block lattice can plat under a doorway: grass, the bare earth and rock
 *  of a yard, sand, the road strip and the path the feet made. Water, forest, farmland and
 *  the channel are not door ground and are not held to this. */
const DOOR_GROUNDS = ([0, 1, 4, 5, 7, 8] as const).map((t) => TILE_COLORS[t])

/** The retired sill's own colours — `--ink` and `--honey`, what `DOOR_LINTEL` and `DOOR_SILL`
 *  were. They live here because they are a measurement of a thing that is gone, and a constant
 *  exported from the product for a test to cite is a fact nothing enforces. */
const RETIRED_RIM = 0x43394a, RETIRED_FILL = 0xf2c879

describe('★ why "you can go in here" is not a mark on the ground', () => {
  it('reproduces what shipped: a 45 % rim fails the boundary floor on EVERY door ground', () => {
    const dimmed = DOOR_GROUNDS.map((g) => over(RETIRED_RIM, g, 0.45))
    for (const [i, g] of DOOR_GROUNDS.entries()) {
      expect(readableRatio(dimmed[i]!, g, LIGHT_BANDS.day)).toBeLessThan(UI_BOUNDARY_RATIO)
      expect(readableRatio(dimmed[i]!, g, LIGHT_BANDS.night)).toBeLessThan(UI_BOUNDARY_RATIO)
    }
  })

  it('★ and OPAQUE was not the fix either — the night multiply takes it back under', () => {
    const grass = TILE_COLORS[0]
    expect(readableRatio(RETIRED_RIM, grass, LIGHT_BANDS.day)).toBeGreaterThan(UI_BOUNDARY_RATIO)
    expect(readableRatio(RETIRED_RIM, grass, LIGHT_BANDS.night)).toBeLessThan(UI_BOUNDARY_RATIO)
  })

  it('★★ THE DUAL-BAND SET FOR A GROUND-DEPENDENT MARK IS EMPTY, at any colour', () => {
    // Every colour a lane might reach for, over the six grounds, in both bands. Not one of
    // them clears — the dark ones die at night, the light ones die on sand. A mark whose
    // legibility is a function of the ground cannot be an affordance on ground this varied.
    const candidates = [0x43394a, 0x241f2b, 0xfff6e9, 0xf8dca2, 0xffffff, 0xf2c879, 0x000000]
    for (const c of candidates) {
      expect(
        groundMarkOffenders(`#${c.toString(16)}`, c, DOOR_GROUNDS),
        `a single mark colour cleared both bands: #${c.toString(16)}`,
      ).not.toEqual([])
    }
  })

  it('the honey fill was warmth and was never the affordance, at any alpha', () => {
    for (const a of [0.45, 0.85, 1]) {
      const grass = TILE_COLORS[0]
      expect(readableRatio(over(RETIRED_FILL, grass, a), grass, LIGHT_BANDS.day))
        .toBeLessThan(UI_BOUNDARY_RATIO)
    }
  })

  it('★ AND THE MARK IS GONE: entities.ts paints nothing on a door tile', () => {
    const src = readFileSync(new URL('./entities.ts', import.meta.url), 'utf8')
    const code = src.split('\n').map((l) => l.trim())
      .filter((l) => !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*'))
      .join('\n')
    for (const gone of ['doorSillPolygon', 'DOOR_SILL', 'DOOR_LINTEL', 'DOOR_RIM', 'layoutDoor']) {
      expect(code, gone).not.toContain(gone)
    }
    // the ledge pair itself is still proved above for the landmarks that DO use it
    expect(bandRatios(LANDMARK_INK, LANDMARK_PLATE).night).toBeGreaterThanOrEqual(AA_RATIO)
  })
})

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  AA_RATIO, LANDMARK_INK, LANDMARK_PLATE, LIGHT_BANDS, UI_BOUNDARY_RATIO, WORLD_TEXT_PAIRS,
  bandRatios, groundMarkOffenders, over, readableRatio, tintedBy, worldTextOffenders,
} from './legibility.js'
import {
  DOOR_HOVER_FILL_ALPHA, DOOR_LINTEL, DOOR_RIM_ALPHA, DOOR_RIM_INK, DOOR_RIM_LIT, DOOR_SILL,
  DOOR_SILL_FILL_ALPHA,
} from './entities.js'
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

// ── ★ THE DOOR SILL: A MARK WITH NO PAPER OF ITS OWN ──────────────────────────────────────

/** The tile tones the block lattice can plat under a doorway: grass, the bare earth and rock
 *  of a yard, sand, the road strip and the path the feet made. Water, forest, farmland and
 *  the channel are not door ground and are not held to this. */
const DOOR_GROUNDS = ([0, 1, 4, 5, 7, 8] as const).map((t) => TILE_COLORS[t])

describe('★ the one affordance for "you can go in here"', () => {
  it('reproduces what shipped: a 45 % rim fails the boundary floor on EVERY door ground', () => {
    const dimmed = DOOR_GROUNDS.map((g) => over(DOOR_LINTEL, g, 0.45))
    for (const [i, g] of DOOR_GROUNDS.entries()) {
      expect(readableRatio(dimmed[i]!, g, LIGHT_BANDS.day)).toBeLessThan(UI_BOUNDARY_RATIO)
      expect(readableRatio(dimmed[i]!, g, LIGHT_BANDS.night)).toBeLessThan(UI_BOUNDARY_RATIO)
    }
  })

  it('★ and OPAQUE was not the fix either — the night multiply takes it back under', () => {
    const grass = TILE_COLORS[0]
    expect(readableRatio(DOOR_LINTEL, grass, LIGHT_BANDS.day)).toBeGreaterThan(UI_BOUNDARY_RATIO)
    expect(readableRatio(DOOR_LINTEL, grass, LIGHT_BANDS.night)).toBeLessThan(UI_BOUNDARY_RATIO)
  })

  it('★★ THE DUAL-BAND SET FOR A GROUND-DEPENDENT RIM IS EMPTY, which is why there is a ledge', () => {
    // Every colour a lane might reach for, over the six grounds, in both bands. Not one of
    // them clears — the dark ones die at night, the light ones die on sand. This is the
    // measurement that makes the two-tone edge a conclusion rather than a taste, and it is
    // the test that goes red if somebody flattens the ledge back to one line.
    const candidates = [0x43394a, 0x241f2b, 0xfff6e9, 0xf8dca2, 0xffffff, 0xf2c879, 0x000000]
    for (const c of candidates) {
      expect(
        groundMarkOffenders(`#${c.toString(16)}`, c, DOOR_GROUNDS),
        `a single rim colour cleared both bands: #${c.toString(16)}`,
      ).not.toEqual([])
    }
  })

  it('★ so the sill wears the stepped ledge, whose contrast is with ITSELF and not the ground', () => {
    expect(DOOR_RIM_INK).toBe(LANDMARK_INK)
    expect(DOOR_RIM_LIT).toBe(LANDMARK_PLATE)
    const r = bandRatios(DOOR_RIM_INK, DOOR_RIM_LIT)
    expect(r.day).toBeGreaterThanOrEqual(UI_BOUNDARY_RATIO)
    expect(r.night).toBeGreaterThanOrEqual(UI_BOUNDARY_RATIO)
    // and it clears AA, not merely the boundary floor, in both bands
    expect(Math.min(r.day, r.night)).toBeGreaterThanOrEqual(AA_RATIO)
  })

  it('★ and the node is NEVER dimmed — an alpha on the graphics takes the rim with the fill', () => {
    const src = readFileSync(new URL('./entities.ts', import.meta.url), 'utf8')
    const body = src.slice(src.indexOf('function layoutDoor('), src.indexOf('function drawPips('))
    expect(body).not.toMatch(/door\.alpha\s*=/)
    expect(body).toMatch(/color: DOOR_RIM_INK, alignment: 0\.5, alpha: DOOR_RIM_ALPHA/)
    expect(body).toMatch(/color: DOOR_RIM_LIT, alignment: 0\.5, alpha: DOOR_RIM_ALPHA/)
    expect(DOOR_RIM_ALPHA).toBe(1)
    // hover brightens the STEP; the outline is already at full strength and has nowhere to go
    expect(DOOR_HOVER_FILL_ALPHA).toBeGreaterThan(DOOR_SILL_FILL_ALPHA)
    // nowhere else either — the hover handlers used to set it. Comments may quote the old
    // line, and one above this very function does.
    const code = src.split('\n').map((l) => l.trim()).filter((l) => !l.startsWith('//') && !l.startsWith('*'))
    expect(code.filter((l) => /door\.alpha\s*=(?!=)/.test(l))).toEqual([])
  })

  it('the honey fill is warmth and was never the affordance, at any alpha', () => {
    for (const a of [0.45, 0.85, 1]) {
      const grass = TILE_COLORS[0]
      expect(readableRatio(over(DOOR_SILL, grass, a), grass, LIGHT_BANDS.day))
        .toBeLessThan(UI_BOUNDARY_RATIO)
    }
  })
})

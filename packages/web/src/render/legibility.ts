import { luma } from './groundField.js'
import { clockTint } from './tints.js'
import { SPEECH_FILL, SPEECH_INK, THOUGHT_FILL, THOUGHT_INK } from './textFaces.js'

/** The night is a full-screen MULTIPLY quad over the whole stage, so a bubble measured against
 *  its own paper is not what a viewer sees — the ceiling under the deep-night tint is 6.37:1. */
export const AA_RATIO = 4.5

/** The two extremes of the day, read off the clock rather than copied from it. */
export const LIGHT_BANDS = {
  day: clockTint(720),    // 12:00 — identity, the material's own colour
  night: clockTint(0),    // 00:00 — the deep-blue multiply
} as const
export type LightBand = keyof typeof LIGHT_BANDS

/** What the multiply quad does to one colour. */
export function tintedBy(rgb: number, tint: number): number {
  const ch = (shift: number): number =>
    Math.round((((rgb >> shift) & 0xff) * ((tint >> shift) & 0xff)) / 255)
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}

/** WCAG 2.x contrast between two colours AS THE VIEWER SEES THEM under `tint`. */
export function readableRatio(fg: number, bg: number, tint: number): number {
  const [a, b] = [luma(tintedBy(fg, tint)), luma(tintedBy(bg, tint))]
  const [hi, lo] = a > b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}

export function bandRatios(fg: number, bg: number): Record<LightBand, number> {
  return { day: readableRatio(fg, bg, LIGHT_BANDS.day), night: readableRatio(fg, bg, LIGHT_BANDS.night) }
}

/** The landmark pair lives here, not in landmarks.ts: the choice is a legibility decision and
 *  this module is the one that has to prove it. */
export const LANDMARK_INK = 0x241f2b       // --deep:  15.02:1 day / 5.19:1 night
export const LANDMARK_PLATE = 0xfff6e9     // --cream
export const LANDMARK_EDGE = 0x241f2b      // the stepped ledge every slab in the town wears

export type WorldTextPair = { what: string; ink: number; paper: number }

/** Every surface the world writes words on. A new one that is not on this list is not
 *  covered by the law, which is why the list is asserted non-empty and named. */
export const WORLD_TEXT_PAIRS: readonly WorldTextPair[] = [
  { what: 'speech bubble', ink: SPEECH_INK, paper: SPEECH_FILL },
  { what: 'thought bubble', ink: THOUGHT_INK, paper: THOUGHT_FILL },
  { what: 'landmark name', ink: LANDMARK_INK, paper: LANDMARK_PLATE },
  // a hover tag and a name tag are drawn on the speech material (tooltip.ts, characters.ts)
  { what: 'hover tag', ink: SPEECH_INK, paper: SPEECH_FILL },
]

/** `what — band ratio` for every pair that fails AA in either band. A regression says which
 *  surface and which half of the day. */
export function worldTextOffenders(pairs: readonly WorldTextPair[]): string[] {
  const out: string[] = []
  for (const p of pairs) {
    const r = bandRatios(p.ink, p.paper)
    for (const band of ['day', 'night'] as const) {
      if (r[band] < AA_RATIO) out.push(`${p.what} — ${band} ${r[band].toFixed(2)}:1`)
    }
  }
  return out
}

// ── ★ A MARK DRAWN ON THE GROUND, WHICH IS THE OTHER HALF OF THE PROBLEM ──────────────────
//
// An affordance drawn on the terrain brings no paper of its own: its background is whichever
// tile tone the lattice platted under it, times the light band — hence the `grounds` sweep.

/** WCAG 1.4.11: the floor for a UI component's own boundary. Lower than AA because a shape
 *  is not a glyph — but a floor, and one that a 45 % opacity cannot reach. */
export const UI_BOUNDARY_RATIO = 3

/** `fg` laid over `bg` at `alpha`. A translucent mark's real colour is the composite, so this
 *  is what has to be measured — never the material's own hex. */
export function over(fg: number, bg: number, alpha: number): number {
  const ch = (shift: number): number =>
    Math.round(alpha * ((fg >> shift) & 0xff) + (1 - alpha) * ((bg >> shift) & 0xff))
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}

/** `what — band ratio on tile` for every ground/band a mark fails on. Empty is the pass. */
export function groundMarkOffenders(
  what: string, colour: number, grounds: readonly number[], floor = UI_BOUNDARY_RATIO,
): string[] {
  const out: string[] = []
  for (const g of grounds) {
    for (const band of ['day', 'night'] as const) {
      const r = readableRatio(colour, g, LIGHT_BANDS[band])
      if (r < floor) out.push(`${what} — ${band} ${r.toFixed(2)}:1 on #${g.toString(16).padStart(6, '0')}`)
    }
  }
  return out
}

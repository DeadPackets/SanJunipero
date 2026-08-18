import { luma } from './groundField.js'
import { clockTint } from './tints.js'
import { SPEECH_FILL, SPEECH_INK, THOUGHT_FILL, THOUGHT_INK } from './textFaces.js'

/**
 * ★ A CONTRAST RATIO AFTER DARK BELONGS TO SOMEBODY, AND IT IS NOT THE MATERIAL.
 *
 * The night is a full-screen MULTIPLY quad over `app.stage` (atmosphere.ts), so it multiplies
 * every pixel the town draws — the ground, the buildings, and every word the world says. A
 * bubble whose ink measures 10.2:1 against its own paper measures **4.41:1 to a viewer** once
 * the quad is over it, and that is below AA.
 *
 * The ceiling under the deep-night tint is **6.37:1** (pure black on pure white), so there is
 * very little room. Every world-text pair in `WORLD_TEXT_PAIRS` is chosen to clear AA inside
 * that ceiling, in BOTH bands, and the test names the offenders rather than trusting the
 * material's number.
 */
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

/**
 * ★ A LABEL WITH NO GROUND UNDER IT IS NOT A LABEL. A place name used to be `#5D5751` painted
 * straight on the terrain: **1.26–4.98:1 by day and 1.11–2.85:1 at night**, depending on which
 * tile it fell across, and never once clearing AA after dark. It gets the same cream paper
 * every other floating slab in the town wears. These live HERE, not in landmarks.ts, because
 * the pair is a legibility decision and this module is the one that has to prove it.
 */
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

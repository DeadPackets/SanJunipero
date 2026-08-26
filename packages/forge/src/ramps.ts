// A class may answer to a wider palette, never to none: extra tones are allowed ONLY where they
// interpolate between ADJACENT members of one ramp — between two creams, never across two hues.
import { MASTER_PALETTE, paletteRgb, type Rgb } from './palette.js'

// The palette's own groups, as index runs. `accent` is FOUR UNRELATED HUES, listed as four ramps
// of one so every member is accounted for and nothing interpolates across it.
export const PALETTE_RAMPS: Record<string, readonly (readonly number[])[]> = {
  cream: [[0, 1, 2, 3, 4]],
  honey: [[5, 6, 7, 8, 9]],
  sage: [[10, 11, 12, 13, 14]],
  rose: [[15, 16, 17, 18]],
  water: [[19, 20, 21, 22, 23]],
  grey: [[24, 25, 26, 27, 28]],
  shadow: [[29, 30, 31, 32]],
  accent: [[33], [34], [35], [36]],
  skin: [[37, 38, 39]],
}

// 2 inserts one tone between every neighbouring pair, turning a five-step ramp into nine — which
// returns the four skin tones and the dark hair outline the master palette was flattening.
export const RAMP_STEPS = 2

// Every adjacent pair inside every ramp, as index pairs.
function rampPairs(): [number, number][] {
  const out: [number, number][] = []
  for (const ramps of Object.values(PALETTE_RAMPS))
    for (const ramp of ramps)
      for (let i = 0; i + 1 < ramp.length; i++) out.push([ramp[i]!, ramp[i + 1]!])
  return out
}

const key = ([r, g, b]: Rgb): number => (r << 16) | (g << 8) | b

export function derivedPalette(steps: number = RAMP_STEPS): Rgb[] {
  const master = paletteRgb()
  const seen = new Map<number, Rgb>()
  for (const c of master) seen.set(key(c), c)
  for (const [a, b] of rampPairs()) {
    const p = master[a]!,
      q = master[b]!
    for (let s = 1; s < steps; s++) {
      const t = s / steps
      const c: Rgb = [
        Math.round(p[0] + (q[0] - p[0]) * t),
        Math.round(p[1] + (q[1] - p[1]) * t),
        Math.round(p[2] + (q[2] - p[2]) * t),
      ]
      if (!seen.has(key(c))) seen.set(key(c), c)
    }
  }
  return [...seen.values()]
}

// Rounding to whole bytes puts a derived tone up to half a unit off the true segment on each
// channel; a colour further off than this is not on the ramp, it is near it.
export const RAMP_TOLERANCE = 1.5

/** Does this colour lie on a segment between two ADJACENT members of one ramp? */
export function onARamp(c: Rgb, tolerance: number = RAMP_TOLERANCE): boolean {
  const master = paletteRgb()
  for (const p of master) if (p[0] === c[0] && p[1] === c[1] && p[2] === c[2]) return true
  for (const [ai, bi] of rampPairs()) {
    const p = master[ai]!,
      q = master[bi]!
    // project c onto pq, clamp to the segment, and measure how far off it landed
    let num = 0,
      den = 0
    for (let k = 0; k < 3; k++) {
      num += (c[k]! - p[k]!) * (q[k]! - p[k]!)
      den += (q[k]! - p[k]!) ** 2
    }
    if (den === 0) continue
    const t = Math.min(1, Math.max(0, num / den))
    let d = 0
    for (let k = 0; k < 3; k++) d += (c[k]! - (p[k]! + (q[k]! - p[k]!) * t)) ** 2
    if (Math.sqrt(d) <= tolerance) return true
  }
  return false
}

export const MASTER_PALETTE_SIZE = MASTER_PALETTE.length

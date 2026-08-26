import type { RawImage } from './post/raw.js'
import { paletteRgb } from './palette.js'

export const PASS_SCORE = 7
export const MAX_ATTEMPTS = 3
export const CANDIDATES_PER_ATTEMPT = 3

const PALETTE_SET = new Set(paletteRgb().map(([r, g, b]) => (r << 16) | (g << 8) | b))

export function mechanicalGate(img: RawImage, expected: { w: number; h: number; requireAlpha: boolean }): { ok: boolean; failures: string[] } {
  const failures: string[] = []
  if (img.width !== expected.w || img.height !== expected.h)
    failures.push(`size ${img.width}x${img.height}, expected ${expected.w}x${expected.h}`)
  let transparent = 0, offPalette = 0
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] === 0) { transparent++; continue }
    if (!PALETTE_SET.has((img.data[i]! << 16) | (img.data[i + 1]! << 8) | img.data[i + 2]!)) offPalette++
  }
  if (transparent === img.width * img.height) failures.push('empty: sprite is fully transparent')
  if (expected.requireAlpha && transparent === 0) failures.push('no alpha: expected transparent background pixels')
  if (offPalette > 0) failures.push(`palette: ${offPalette} opaque pixels off the master palette`)
  return { ok: failures.length === 0, failures }
}

// bestOf chooses; it never ships a candidate that failed a gate.

export type GateVerdict = { key: string; failures: readonly string[] }

/** The message a refusal must carry: empty means a candidate was clean and the run may go on, a
 *  non-empty string is meant to be thrown. It names EVERY candidate, not just the winner. */
export function refusalMessage(what: string, cands: readonly GateVerdict[]): string {
  if (cands.length === 0 || cands.some((c) => c.failures.length === 0)) return ''
  const detail = cands
    .map((c) => `    ${c.key}\n${c.failures.map((f) => `      ${f}`).join('\n')}`)
    .join('\n')
  return `${what}: all ${cands.length} candidate${cands.length === 1 ? '' : 's'} FAILED their `
    + `gates and none may be shipped.\n${detail}`
}

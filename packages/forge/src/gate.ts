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

// ── ★ A GATE THAT COMPUTES A VERDICT MAY NOT HAVE THAT VERDICT DISCARDED ───────────────────
//
// USER RULING. Every generator in this package chose a winner the same way and wrote it
// differently, which is why nobody saw it was one policy. There are SEVEN of them in three
// disguises — and a count by disguise undercounts, because each disguise was pasted between
// siblings:
//
//   least-bad `bestOf` reduce     gen-cast-v5, gen-cast-v4, gen-character-v4
//   `(clean.length ? clean : …)`  gen-structures-v5, gen-dwellings-v2, gen-dwellings
//   `rank = fails.length * 100`   gen-library-v2 — a failure ranks worse, never excluded
//
// ★ `gen-dwellings-v2` is the one that matters and was not on the first list: it is live, it
// writes `content/buildings`, and it wrote the ten dwelling cells the town stands on. Those
// cells are measured clean today — but the policy that could have shipped a bad one was live
// the whole time.
//
// So a gate could measure a cell, write the number into a report, and be overruled by its own
// caller. It happened: `amara/contact-b-ne` was measured at 1.1855 opaque area against a 1.18
// silhouette tolerance and committed — a figure in the wrong costume with the words TACTICAL
// GEAR set beside her in silver, which a viewer saw in the running product. The audit that
// followed found three more the same way. This is the vacuous-guard family in its purest form:
// the check ran, the check was right, and nothing was downstream of it.
//
// Choosing and deciding are now separate. A ranker may still pick the least-bad candidate; it
// may not ship one that has a failure against it.

export type GateVerdict = { key: string; failures: readonly string[] }

/**
 * The message a refusal must carry. Empty means at least one candidate was clean and the run
 * may go on; a non-empty string is meant to be thrown.
 *
 * ★ IT NAMES EVERY CANDIDATE, NOT JUST THE WINNER. The operator's first question is always
 * "is the model wrong or is the threshold wrong", and only seeing all N sets of margins
 * answers it: three candidates failing the same gate by 0.005 is a threshold, three failing
 * different gates by a mile is a prompt.
 */
export function refusalMessage(what: string, cands: readonly GateVerdict[]): string {
  if (cands.length === 0 || cands.some((c) => c.failures.length === 0)) return ''
  const detail = cands
    .map((c) => `    ${c.key}\n${c.failures.map((f) => `      ${f}`).join('\n')}`)
    .join('\n')
  return `${what}: all ${cands.length} candidate${cands.length === 1 ? '' : 's'} FAILED their `
    + `gates and none may be shipped.\n${detail}`
}

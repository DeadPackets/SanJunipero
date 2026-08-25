// Character standard v3 (mirror standard): 2 authored facings + 1 sleep cell derive
// the full 24-cell sheet in code. SW = flip(SE), NW = flip(NE); passing-a = passing-b;
// sleep-se/sw = the one sleep cell, sleep-ne/nw = its flip. Facing-correct by construction.
import type { RawImage } from './post/raw.js'
import {
  FACINGS, POSES_V2, mirrorX, cellDistance, paletteJaccard, opaqueArea, opaqueBbox,
  headRegionDiff, silhouetteBound, footSpan, HEAD_DIFF_MAX,
  PALETTE_JACCARD_MIN, SILHOUETTE_AREA_TOL, STRIDE_MIN_RATIO, CONTACT_PASSING_MIN_RATIO,
  STANCE_MIN_RATIO,
  type Facing, type PoseV2, type GateFailure,
} from './sheet.js'

export const AUTHORED_FACINGS = ['se', 'ne'] as const
export type AuthoredFacing = typeof AUTHORED_FACINGS[number]
export const MIRROR_OF: Record<'sw' | 'nw', AuthoredFacing> = { sw: 'se', nw: 'ne' }

// 1×4 wide-canvas strip order per authored facing (3 unique walk frames + idle).
export const STRIP_POSES_V4 = ['idle', 'contact-a', 'passing', 'contact-b'] as const
export type StripPoseV4 = typeof STRIP_POSES_V4[number]

// Playback F1-F2-F1-F3 (user ruling 3): contact-a → passing → contact-b → passing.
export const WALK_CYCLE_V4 = ['contact-a', 'passing', 'contact-b', 'passing'] as const
export const WALK_FRAME_MS = 180

// The renderer's 24-cell contract, named as the cell files are: `${pose}-${facing}`.
export const CELL_NAMES_V4: readonly string[] =
  POSES_V2.flatMap(p => FACINGS.map(f => `${p}-${f}`))

export type AuthoredSet = {
  strips: Record<AuthoredFacing, Record<StripPoseV4, RawImage>>
  sleep: RawImage
}

// Derive the full 24-cell sheet from 9 authored cells. Zero spend, zero failure modes.
export function deriveSheet(authored: AuthoredSet): Map<string, RawImage> {
  const out = new Map<string, RawImage>()
  const facingCells = (strip: Record<StripPoseV4, RawImage>): Record<Exclude<PoseV2, 'sleep'>, RawImage> => ({
    'idle': strip['idle'],
    'contact-a': strip['contact-a'],
    'passing-a': strip['passing'],
    'contact-b': strip['contact-b'],
    'passing-b': strip['passing'],
  })
  for (const f of AUTHORED_FACINGS) {
    const cells = facingCells(authored.strips[f])
    for (const [p, img] of Object.entries(cells)) out.set(`${p}-${f}`, img)
  }
  for (const [derived, source] of Object.entries(MIRROR_OF) as ['sw' | 'nw', AuthoredFacing][]) {
    const cells = facingCells(authored.strips[source])
    for (const [p, img] of Object.entries(cells)) out.set(`${p}-${derived}`, mirrorX(img))
  }
  const sleepFlip = mirrorX(authored.sleep)
  out.set('sleep-se', authored.sleep)
  out.set('sleep-sw', authored.sleep)
  out.set('sleep-ne', sleepFlip)
  out.set('sleep-nw', sleepFlip)
  return out
}

// Stride check WITHIN a strip (3 unique frames): contacts must differ from each other
// and from the passing frame. Ratios × the v1-calibrated cross-facing median.
export function strideGateV4(facing: string, strip: Record<StripPoseV4, RawImage>, median: number): GateFailure[] {
  const failures: GateFailure[] = []
  const check = (pa: StripPoseV4, pb: StripPoseV4, ratio: number, gate: GateFailure['gate']) => {
    const d = cellDistance(strip[pa], strip[pb])
    if (d < ratio * median)
      failures.push({ gate, a: `${facing}/${pa}`, b: `${facing}/${pb}`, value: d, limit: ratio * median })
  }
  check('contact-a', 'contact-b', STRIDE_MIN_RATIO, 'stride')
  check('contact-a', 'passing', CONTACT_PASSING_MIN_RATIO, 'contact-passing')
  check('contact-b', 'passing', CONTACT_PASSING_MIN_RATIO, 'contact-passing')
  return failures
}

/**
 * ★ THE GATE `strideGateV4` IS NOT. It asks whether two frames DIFFER; this asks whether a
 * contact frame is a contact POSE. See `footSpan` in `sheet.ts` for the calibration and for
 * the four standing figures that cleared every other gate in the package.
 *
 * NATIVE cells, not gate views: the separation is 0.19 wide and a 96px canvas cannot hold it.
 */
export function stanceGate(facing: string, idle: RawImage,
  contacts: { label: string; img: RawImage }[], min = STANCE_MIN_RATIO): GateFailure[] {
  const base = footSpan(idle)
  if (base === 0) throw new Error(`stanceGate: ${facing}/idle has no feet`)
  return contacts.flatMap(({ label, img }) => {
    const ratio = footSpan(img) / base
    return ratio >= min ? []
      : [{ gate: 'stance' as const, a: `${facing}/${label}`, b: `${facing}/idle`, value: ratio, limit: min }]
  })
}

// The ONE coherence gate: palette-jaccard + silhouette (opaque area) + head, vs the master's
// figure for the same view. Catches identity drift in edit calls; nothing else.
//
// ★ THE HEAD TERM WAS MISSING, AND THAT IS THE FINDING. This gate runs BEFORE the money is
// spent and decides which candidate ships; `frameCoherenceGate` runs AFTER, over the committed
// cells, in `castAudit.test.ts`. It asks three questions and this one asked two — so the
// pre-spend gate was a STRICT SUBSET of the post-hoc audit and a candidate could clear the one
// that costs money and red the one that costs nothing. Two of the cast's known debts are
// exactly that: `omar ne/contact-a` at 0.2379, and salma's first replacement `ne/contact-a`,
// drawn live in this lane, at 0.3366 — clean on silhouette and palette, and a different head.
// Legs move between walk frames; heads do not, and the number that says so was only ever read
// after the fact.
export function coherenceGateV4(label: string, master: RawImage, cell: RawImage): GateFailure[] {
  const failures: GateFailure[] = []
  const jac = paletteJaccard(master, cell)
  if (jac < PALETTE_JACCARD_MIN)
    failures.push({ gate: 'palette', a: label, b: 'master', value: jac, limit: PALETTE_JACCARD_MIN })
  const areaRatio = opaqueArea(cell) / opaqueArea(master)
  if (Math.abs(areaRatio - 1) > SILHOUETTE_AREA_TOL)
    failures.push({ gate: 'silhouette', a: label, b: 'master', value: areaRatio, limit: silhouetteBound(areaRatio) })
  const head = headRegionDiff(master, cell)
  if (head > HEAD_DIFF_MAX)
    failures.push({ gate: 'head', a: label, b: 'master', value: head, limit: HEAD_DIFF_MAX })
  return failures
}

// A body asleep on a 2:1 dimetric ground plane runs ALONG the ground diagonal, so its long
// axis tilts up to the right; drawn flat across the screen it reads as pasted on rather than
// lying on. The band is signed, so the same number also catches a cell whose head points the
// wrong way — the mirrored one has the right magnitude and the wrong sign.
export const SLEEP_AXIS_DEG_MIN = -50
export const SLEEP_AXIS_DEG_MAX = -20

// Principal axis of the opaque mass, degrees, in image coordinates (y down): negative means
// the right-hand end of the body sits higher up the screen, which is where the head belongs.
export function sleepAxisDeg(sleep: RawImage): number {
  let n = 0, sx = 0, sy = 0
  const { width: w, height: h, data } = sleep
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3]! > 0) { n++; sx += x; sy += y }
  }
  if (n === 0) throw new Error('sleepAxisDeg: sleep cell has no opaque pixels')
  const mx = sx / n, my = sy / n
  let xx = 0, yy = 0, xy = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3]! > 0) {
      const dx = x - mx, dy = y - my
      xx += dx * dx; yy += dy * dy; xy += dx * dy
    }
  }
  return (0.5 * Math.atan2((2 * xy) / n, xx / n - yy / n) * 180) / Math.PI
}

export function sleepAxisGate(sleep: RawImage): GateFailure[] {
  const deg = sleepAxisDeg(sleep)
  if (deg >= SLEEP_AXIS_DEG_MIN && deg <= SLEEP_AXIS_DEG_MAX) return []
  const limit = deg > SLEEP_AXIS_DEG_MAX ? SLEEP_AXIS_DEG_MAX : SLEEP_AXIS_DEG_MIN
  return [{ gate: 'lying-axis', a: 'sleep', b: 'ground-plane', value: deg, limit }]
}

// Sleep coherence: palette vs master (a lying body voids the area check) + lying bbox.
export function sleepCoherenceGateV4(master: RawImage, sleep: RawImage): GateFailure[] {
  const failures: GateFailure[] = []
  const jac = paletteJaccard(master, sleep)
  if (jac < PALETTE_JACCARD_MIN)
    failures.push({ gate: 'palette', a: 'sleep', b: 'master', value: jac, limit: PALETTE_JACCARD_MIN })
  const bb = opaqueBbox(sleep)
  if (!bb) throw new Error('sleepCoherenceGateV4: sleep cell has no opaque pixels')
  const aspect = (bb.x1 - bb.x0 + 1) / (bb.y1 - bb.y0 + 1)
  if (aspect <= 1)
    failures.push({ gate: 'lying', a: 'sleep', b: 'master', value: aspect, limit: 1 })
  failures.push(...sleepAxisGate(sleep))
  return failures
}

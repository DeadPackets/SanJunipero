import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { decodePng, type RawImage } from './post/raw.js'
import {
  POSES_V2, WALK_POSES_V2, STRIP_POSES_V2, CELL_V2, FEET_Y_V2, SHEET_W_V2, SHEET_H_V2, POSE_CLAUSES_V2,
  NEAR_DUPE_RATIO, MIRROR_DUPE_RATIO, STRIDE_MIN_RATIO, CONTACT_PASSING_MIN_RATIO,
  PALETTE_JACCARD_MIN, PALETTE_EPS, PALETTE_MIN_SHARE, SILHOUETTE_AREA_TOL,
  HEAD_REGION_FRAC, HEAD_DIFF_MAX,
  sliceStrip, opaqueArea, paletteJaccard, headRegionDiff,
  crossFacingDupeGate, strideGate, frameCoherenceGate, sleepGate,
  pairwiseMedian, cellDistance, opaqueBbox, mirrorX,
} from './sheet.js'

type Px = [number, number, number, number]
function img(w: number, h: number, px: (x: number, y: number) => Px): RawImage {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(px(x, y), (y * w + x) * 4)
  return { width: w, height: h, data }
}
const CLEAR: Px = [0, 0, 0, 0]
const RED: Px = [200, 40, 40, 255]
const TEAL: Px = [20, 160, 170, 255]

// v1 fixture cells: the real material the v2 gates were tuned against.
const fx = async (p: string, f: string) =>
  decodePng(readFileSync(new URL(`./fixtures/character-v1/${p}-${f}.png`, import.meta.url)))
const FACINGS_FX = ['sw', 'se', 'ne', 'nw'] as const
const POSES_FX = ['idle', 'walk-a', 'walk-b'] as const
const v1 = new Map<string, RawImage>()
for (const f of FACINGS_FX) for (const p of POSES_FX) v1.set(`${f}/${p}`, await fx(p, f))
const v1median = pairwiseMedian([...v1.values()])

describe('character standard v2 constants', () => {
  it('exports the 6-pose row order and sheet geometry', () => {
    expect(POSES_V2).toEqual(['idle', 'contact-a', 'passing-a', 'contact-b', 'passing-b', 'sleep'])
    expect(STRIP_POSES_V2).toEqual(['idle', 'contact-a', 'passing-a', 'contact-b', 'passing-b'])
    expect(WALK_POSES_V2).toEqual(['contact-a', 'passing-a', 'contact-b', 'passing-b'])
    expect(CELL_V2).toBe(96)
    expect(FEET_Y_V2).toBe(88)
    expect(SHEET_W_V2).toBe(384) // 4 facing columns
    expect(SHEET_H_V2).toBe(576) // 6 pose rows
    for (const p of POSES_V2) expect(POSE_CLAUSES_V2[p].length).toBeGreaterThan(10)
  })
  it('exports the hard gate constants', () => {
    expect(NEAR_DUPE_RATIO).toBe(0.55)
    expect(MIRROR_DUPE_RATIO).toBe(0.35)
    expect(STRIDE_MIN_RATIO).toBe(0.35)
    expect(CONTACT_PASSING_MIN_RATIO).toBe(0.25)
    expect(PALETTE_JACCARD_MIN).toBe(0.80)
    expect(PALETTE_EPS).toBe(8)
    expect(PALETTE_MIN_SHARE).toBe(0.01)
    expect(SILHOUETTE_AREA_TOL).toBe(0.18)
    expect(HEAD_REGION_FRAC).toBe(0.40)
    expect(HEAD_DIFF_MAX).toBe(0.20)
  })
})

describe('sliceStrip', () => {
  // blob helper: solid block of RED at [x0, x0+w) spanning rows 4..15
  const strip = (blobs: [number, number][], w = 120) =>
    img(w, 20, (x, y) => (y >= 4 && blobs.some(([bx, bw]) => x >= bx && x < bx + bw) ? RED : CLEAR))

  it('slices 5 unevenly spaced, unevenly wide blobs into 5 segments', () => {
    const blobs: [number, number][] = [[2, 10], [17, 14], [36, 9], [52, 18], [78, 12]]
    const segs = sliceStrip(strip(blobs), 5)
    expect(segs.length).toBe(5)
    segs.forEach((s, i) => {
      expect(s.width).toBe(blobs[i]![1])
      expect(s.height).toBe(20)
      expect(opaqueArea(s)).toBe(blobs[i]![1] * 16)
    })
  })
  it('ignores speckle columns under the mass floor', () => {
    const base = strip([[2, 10], [17, 14], [36, 9], [52, 18], [78, 12]])
    base.data.set(RED, (10 * base.width + 33) * 4) // 1px stray between blobs 2 and 3
    expect(sliceStrip(base, 5).length).toBe(5)
  })
  it('merges the smallest gap when more clusters than frames', () => {
    // 6 substantial blobs; smallest gap (1px) is between the last two
    const segs = sliceStrip(strip([[2, 10], [20, 10], [38, 10], [56, 10], [74, 10], [85, 10]]), 5)
    expect(segs.length).toBe(5)
    expect(segs[4]!.width).toBe(21) // 74..94 merged
  })
  it('throws when fewer clusters than frames', () => {
    expect(() => sliceStrip(strip([[2, 10], [20, 10], [38, 10], [56, 10]]), 5)).toThrow()
  })
  it('throws on a fully transparent strip', () => {
    expect(() => sliceStrip(img(50, 10, () => CLEAR), 5)).toThrow()
  })
})

describe('paletteJaccard', () => {
  const half = (a: Px, b: Px) => img(20, 20, x => (x < 10 ? a : b))
  it('is 1 for identical images', () => {
    expect(paletteJaccard(half(RED, TEAL), half(RED, TEAL))).toBe(1)
  })
  it('penalizes a substantial color present in only one image', () => {
    expect(paletteJaccard(half(RED, RED), half(RED, TEAL))).toBe(0.5)
  })
  it('ignores colors below the population floor', () => {
    const speckled = img(20, 20, (x, y) => (x === 0 && y === 0 ? TEAL : RED)) // 1/400 < 1%
    expect(paletteJaccard(img(20, 20, () => RED), speckled)).toBe(1)
  })
  it('merges eps-close colors into one cluster', () => {
    const off: Px = [205, 45, 45, 255] // within eps 8 of RED
    expect(paletteJaccard(half(RED, RED), half(off, off))).toBe(1)
  })
})

describe('headRegionDiff', () => {
  const sprite = (headShift: number) => img(30, 40, (x, y) => {
    if (y >= 5 && y < 15 && x >= 10 + headShift && x < 20 + headShift) return RED // head
    if (y >= 15 && y < 35 && x >= 12 && x < 18) return TEAL // body
    return CLEAR
  })
  it('is 0 for identical sprites', () => {
    expect(headRegionDiff(sprite(0), sprite(0))).toBe(0)
  })
  it('ignores changes below the head region', () => {
    const legsOut = img(30, 40, (x, y) => {
      if (y >= 5 && y < 15 && x >= 10 && x < 20) return RED
      if (y >= 15 && y < 35 && x >= 8 && x < 22) return TEAL // fat body, same head
      return CLEAR
    })
    // head = top 40% of a 30-row bbox = 12 rows (5..16): body rows 15-16 overlap slightly
    expect(headRegionDiff(sprite(0), legsOut)).toBeLessThan(0.35)
  })
  it('flags a laterally shifted head', () => {
    expect(headRegionDiff(sprite(0), sprite(6))).toBeGreaterThan(0.3)
  })

  // ★ THE MIRROR PROPERTY, and the awkward case is the one that used to break it: two
  // bboxes of DIFFERENT width parity have their centres half a column apart, and an integer
  // offset has to round one way going and the other way coming back. The pair below is
  // 10 wide against 11 wide on purpose.
  it('★ gives the same number for a pair of sprites and their mirrors, at either parity', () => {
    const wide = (w: number) => img(30, 40, (x, y) => {
      if (y >= 5 && y < 15 && x >= 10 && x < 10 + w) return RED
      if (y >= 15 && y < 35 && x >= 12 && x < 18) return TEAL
      return CLEAR
    })
    for (const [a, b] of [[wide(10), wide(11)], [wide(11), wide(10)], [wide(10), wide(10)], [sprite(0), sprite(6)]] as const)
      expect(headRegionDiff(mirrorX(a), mirrorX(b)), 'headRegionDiff is not mirror-invariant')
        .toBeCloseTo(headRegionDiff(a, b), 12)
  })

  // Anti-vacuity: the same-parity values are the CALIBRATED ones and must not have moved.
  it('and the half-pixel alignment did not move the same-parity numbers it was calibrated on', () => {
    expect(headRegionDiff(sprite(0), sprite(0))).toBe(0)
    expect(headRegionDiff(sprite(0), sprite(6))).toBeCloseTo(0.4, 10) // 0.4 before the change too
  })
})

describe('crossFacingDupeGate — proven on the v1 sheet the user rejected', () => {
  it('fixture median matches the recorded 0.310', () => {
    expect(v1median).toBeGreaterThan(0.30)
    expect(v1median).toBeLessThan(0.32)
  })
  it('FAILS the ne/nw idle near-dupe (0.123) and the sw/se idle mirror (0.030), passes the rest', () => {
    const idleRow = FACINGS_FX.map(f => ({ label: `${f}/idle`, img: v1.get(`${f}/idle`)! }))
    const failures = crossFacingDupeGate(idleRow, v1median)
    expect(failures.length).toBe(2)
    const near = failures.find(f => f.gate === 'near-dupe')!
    expect([near.a, near.b].sort()).toEqual(['ne/idle', 'nw/idle'])
    expect(near.value).toBeCloseTo(0.123, 2)
    expect(near.value).toBeLessThan(near.limit)
    const mir = failures.find(f => f.gate === 'mirror-dupe')!
    expect([mir.a, mir.b].sort()).toEqual(['se/idle', 'sw/idle'])
    expect(mir.value).toBeCloseTo(0.030, 2)
    expect(mir.value).toBeLessThan(mir.limit)
  })
  it('old v1 thresholds would only have flagged, v2 ratios hard-fail: limits sit above the caught distances', () => {
    const failures = crossFacingDupeGate(FACINGS_FX.map(f => ({ label: `${f}/idle`, img: v1.get(`${f}/idle`)! })), v1median)
    const near = failures.find(f => f.gate === 'near-dupe')!
    expect(near.limit).toBeCloseTo(0.55 * v1median, 5) // ≈0.171 vs old lax 0.112
    const mir = failures.find(f => f.gate === 'mirror-dupe')!
    expect(mir.limit).toBeCloseTo(0.35 * v1median, 5) // ≈0.109 vs old 0.065
  })
  it('passes a legitimately distinct row (walk-b across facings has no sub-threshold pair)', () => {
    const row = FACINGS_FX.map(f => ({ label: `${f}/walk-b`, img: v1.get(`${f}/walk-b`)! }))
    expect(crossFacingDupeGate(row, v1median)).toEqual([])
  })
})

describe('strideGate — proven on the v1 rigid se stride', () => {
  it('FAILS the se contact pair (0.091, the rigid stride the user caught)', () => {
    const failures = strideGate('se', {
      'contact-a': v1.get('se/walk-a')!, 'contact-b': v1.get('se/walk-b')!,
      'passing-a': v1.get('sw/walk-a')!, 'passing-b': v1.get('sw/walk-b')!,
    }, v1median)
    expect(failures.length).toBe(1)
    expect(failures[0]!.gate).toBe('stride')
    expect(failures[0]!.a).toBe('se/contact-a')
    expect(failures[0]!.b).toBe('se/contact-b')
    expect(failures[0]!.value).toBeCloseTo(0.091, 2)
    expect(failures[0]!.limit).toBeCloseTo(0.35 * v1median, 5)
  })
  it('passes well-differentiated strides', () => {
    const failures = strideGate('ne', {
      'contact-a': v1.get('ne/walk-a')!, 'contact-b': v1.get('ne/walk-b')!,
      'passing-a': v1.get('nw/walk-a')!, 'passing-b': v1.get('nw/walk-b')!,
    }, v1median)
    expect(failures).toEqual([])
  })
  it('flags a contact frame reused as a passing frame', () => {
    const failures = strideGate('sw', {
      'contact-a': v1.get('sw/walk-a')!, 'contact-b': v1.get('sw/walk-b')!,
      'passing-a': v1.get('sw/walk-a')!, 'passing-b': v1.get('sw/idle')!,
    }, v1median)
    expect(failures.some(f => f.gate === 'contact-passing' && f.value === 0)).toBe(true)
  })
})

describe('frameCoherenceGate — tuned to pass every real v1 within-facing frame', () => {
  it('passes all 8 v1 walk frames against their facing idle', () => {
    for (const f of FACINGS_FX) {
      const failures = frameCoherenceGate(f, v1.get(`${f}/idle`)!,
        POSES_FX.filter(p => p !== 'idle').map(p => ({ label: p, img: v1.get(`${f}/${p}`)! })))
      expect(failures).toEqual([])
    }
  })
  it('FAILS a frame that grows an off-palette costume detail', () => {
    const mod = structuredClone(v1.get('sw/walk-a')!)
    for (let y = 40; y < 52; y++) for (let x = 40; x < 52; x++) {
      const i = (y * mod.width + x) * 4
      if (mod.data[i + 3] === 0) continue
      mod.data[i] = TEAL[0]; mod.data[i + 1] = TEAL[1]; mod.data[i + 2] = TEAL[2]
    }
    const failures = frameCoherenceGate('sw', v1.get('sw/idle')!, [{ label: 'contact-a', img: mod }])
    expect(failures.some(f => f.gate === 'palette')).toBe(true)
  })
  it('FAILS a frame whose silhouette area drifts past ±18%', () => {
    const idle = v1.get('sw/idle')!
    const mod = structuredClone(idle)
    const b = opaqueBbox(idle)!
    // paint a same-palette block beside the legs: +>18% area, head region untouched
    const grow = Math.ceil(opaqueArea(idle) * 0.25)
    let added = 0
    outer: for (let y = b.y1; y >= b.y0; y--) for (let x = 0; x < mod.width; x++) {
      const i = (y * mod.width + x) * 4
      if (mod.data[i + 3] !== 0) continue
      if (y < b.y0 + Math.ceil((b.y1 - b.y0 + 1) * 0.5)) continue // keep the head region clear
      mod.data[i] = 120; mod.data[i + 1] = 90; mod.data[i + 2] = 70; mod.data[i + 3] = 255
      if (++added >= grow) break outer
    }
    const failures = frameCoherenceGate('sw', idle, [{ label: 'contact-a', img: mod }])
    expect(failures.some(f => f.gate === 'silhouette')).toBe(true)
  })
  it('FAILS a frame whose head region moved', () => {
    const idle = v1.get('sw/idle')!
    const mod = structuredClone(idle)
    const b = opaqueBbox(idle)!
    // erase the left 60% of the top quarter of the sprite: the head changes shape
    const topRows = Math.ceil((b.y1 - b.y0 + 1) * 0.25)
    for (let y = b.y0; y < b.y0 + topRows; y++)
      for (let x = b.x0; x < b.x0 + Math.ceil((b.x1 - b.x0 + 1) * 0.6); x++)
        mod.data.fill(0, (y * mod.width + x) * 4, (y * mod.width + x) * 4 + 4)
    // restore one pixel at the original bbox top-right so the bbox top row survives
    const failures = frameCoherenceGate('sw', idle, [{ label: 'contact-a', img: mod }])
    expect(failures.some(f => f.gate === 'head')).toBe(true)
  })
})

describe('sleepGate', () => {
  // rotate 90°: same palette as idle, bbox flips to wider-than-tall — a valid lying pose
  const rotate90 = (src: RawImage): RawImage => {
    const out = new Uint8ClampedArray(src.data.length)
    for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
      const s = (y * src.width + x) * 4, d = (x * src.height + (src.height - 1 - y)) * 4
      out.set(src.data.subarray(s, s + 4), d)
    }
    return { width: src.height, height: src.width, data: out }
  }
  it('passes a lying same-palette sleep cell', () => {
    const idle = v1.get('sw/idle')!
    expect(sleepGate('sw', idle, rotate90(idle))).toEqual([])
  })
  it('FAILS an upright sleep cell (lying check)', () => {
    const idle = v1.get('sw/idle')!
    const failures = sleepGate('sw', idle, idle)
    expect(failures.some(f => f.gate === 'lying')).toBe(true)
  })
  it('FAILS a sleep cell with an off-palette blanket', () => {
    const idle = v1.get('sw/idle')!
    const lying = rotate90(idle)
    const b = opaqueBbox(lying)!
    for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x < b.x0 + Math.floor((b.x1 - b.x0) / 3); x++) {
      const i = (y * lying.width + x) * 4
      if (lying.data[i + 3] === 0) continue
      lying.data[i] = TEAL[0]; lying.data[i + 1] = TEAL[1]; lying.data[i + 2] = TEAL[2]
    }
    expect(sleepGate('sw', idle, lying).some(f => f.gate === 'palette')).toBe(true)
  })
})

describe('gate metric primitives on fixtures', () => {
  it('cellDistance reproduces the recorded evidence values', () => {
    expect(cellDistance(v1.get('ne/idle')!, v1.get('nw/idle')!)).toBeCloseTo(0.123, 2)
    expect(cellDistance(v1.get('se/walk-a')!, v1.get('se/walk-b')!)).toBeCloseTo(0.091, 2)
  })
  it('within-facing palette jaccard clears the gate with margin', () => {
    for (const f of FACINGS_FX) for (const p of ['walk-a', 'walk-b'] as const)
      expect(paletteJaccard(v1.get(`${f}/idle`)!, v1.get(`${f}/${p}`)!)).toBeGreaterThanOrEqual(PALETTE_JACCARD_MIN)
  })
  it('within-facing head drift stays under the gate with margin', () => {
    for (const f of FACINGS_FX) for (const p of ['walk-a', 'walk-b'] as const)
      expect(headRegionDiff(v1.get(`${f}/idle`)!, v1.get(`${f}/${p}`)!)).toBeLessThanOrEqual(HEAD_DIFF_MAX)
  })
})

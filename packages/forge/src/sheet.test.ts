import { describe, it, expect } from 'vitest'
import type { RawImage } from './post/raw.js'
import { FACINGS, POSES, assembleGrid, sliceGrid, mirrorX, cellDistance, duplicateReport, downscaleMajority, detectArtScale, snapToGrid, anchorToCanvas, defringe, sheetScale, registerToReference, despeckle, fillPinholes, unionPalette, erodeAlpha, resampleToArtHeight, erodeForPitch, estimatePitch, refineLattice, resampleModeLattice, sheetMetrics, sweepMagenta, driftField, resampleClusterLattice, mergeSheetColors, sweepMagentaCensus, repairOutlineBlends, opaqueBbox, upscaleNearest, distanceMatrix, pairwiseMedian, STRAIGHT_DUPE, MIRROR_DUPE } from './sheet.js'
import { quantize } from './post/quantize.js'

type Px = [number, number, number, number]
function img(w: number, h: number, px: (x: number, y: number) => Px): RawImage {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(px(x, y), (y * w + x) * 4)
  return { width: w, height: h, data }
}
const solid = (w: number, h: number, p: Px) => img(w, h, () => p)
const RED: Px = [255, 0, 0, 255], BLUE: Px = [0, 0, 255, 255], CLEAR: Px = [0, 0, 0, 0]

describe('sheet constants', () => {
  it('exports facing/pose orders and thresholds', () => {
    expect(FACINGS).toEqual(['sw', 'se', 'ne', 'nw'])
    expect(POSES).toEqual(['idle', 'walk-a', 'walk-b'])
    expect(STRAIGHT_DUPE).toBe(0.10)
    expect(MIRROR_DUPE).toBe(0.06)
  })
})

describe('assembleGrid / sliceGrid', () => {
  it('round-trips a 2x2 grid of distinct 2x2 cells', () => {
    const cells = [
      [solid(2, 2, RED), solid(2, 2, BLUE)],
      [solid(2, 2, [0, 255, 0, 255]), solid(2, 2, [1, 2, 3, 255])],
    ]
    const sheet = assembleGrid(cells, 2, 2)
    expect(sheet.width).toBe(4); expect(sheet.height).toBe(4)
    const back = sliceGrid(sheet, 2, 2)
    for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++)
      expect(back[r]![c]!.data).toEqual(cells[r]![c]!.data)
  })
  it('blits row-major: top-left pixel of sheet comes from cells[0][0]', () => {
    const sheet = assembleGrid([[solid(1, 1, RED), solid(1, 1, BLUE)]], 1, 1)
    expect([...sheet.data.slice(0, 4)]).toEqual(RED)
    expect([...sheet.data.slice(4, 8)]).toEqual(BLUE)
  })
  it('throws on a size-mismatched cell', () => {
    expect(() => assembleGrid([[solid(2, 2, RED), solid(1, 2, BLUE)]], 2, 2)).toThrow()
  })
  it('sliceGrid throws when dimensions do not divide evenly', () => {
    expect(() => sliceGrid(solid(3, 2, RED), 2, 1)).toThrow()
  })
})

describe('mirrorX', () => {
  it('flips horizontally and is an involution', () => {
    const src = img(2, 1, x => (x === 0 ? RED : BLUE))
    const flipped = mirrorX(src)
    expect([...flipped.data.slice(0, 4)]).toEqual(BLUE)
    expect([...flipped.data.slice(4, 8)]).toEqual(RED)
    expect(mirrorX(flipped).data).toEqual(src.data)
  })
})

describe('cellDistance', () => {
  it('is 0 for identical images', () => {
    expect(cellDistance(solid(2, 2, RED), solid(2, 2, RED))).toBe(0)
  })
  it('is 1 for fully-opaque vs fully-transparent', () => {
    expect(cellDistance(solid(2, 2, RED), solid(2, 2, CLEAR))).toBe(1)
  })
  it('is symmetric', () => {
    const a = img(2, 2, x => (x === 0 ? RED : CLEAR))
    const b = solid(2, 2, BLUE)
    expect(cellDistance(a, b)).toBeCloseTo(cellDistance(b, a), 12)
  })
  it('ignores pixels transparent in both images', () => {
    const a = img(2, 1, x => (x === 0 ? RED : CLEAR))
    const b = img(2, 1, x => (x === 0 ? RED : CLEAR))
    expect(cellDistance(a, b)).toBe(0)
  })
})

describe('downscaleMajority', () => {
  it('dominant color wins over speckle noise', () => {
    // 4x4 -> 1x1: 13 red, 3 blue speckles -> red
    const speckles = new Set([1, 6, 11])
    const src = img(4, 4, (x, y) => (speckles.has(y * 4 + x) ? BLUE : RED))
    expect([...downscaleMajority(src, 1, 1).data]).toEqual(RED)
  })
  it('outputs transparent iff more than half the block is transparent', () => {
    // 9 of 16 transparent -> transparent
    const mostlyClear = img(4, 4, (x, y) => (y * 4 + x < 9 ? CLEAR : RED))
    expect(downscaleMajority(mostlyClear, 1, 1).data[3]).toBe(0)
    // exactly 8 of 16 transparent -> opaque, majority color
    const halfClear = img(4, 4, (x, y) => (y * 4 + x < 8 ? CLEAR : RED))
    expect([...downscaleMajority(halfClear, 1, 1).data]).toEqual(RED)
  })
  // Was "first-seen scan order", which is the property that made the whole thing
  // orientation-dependent: reversing the block reversed the answer.
  it('breaks frequency ties the same way whichever end of the block it reads from', () => {
    const src = img(2, 2, (x, y) => (y === 0 ? BLUE : RED)) // 2 blue then 2 red
    expect([...downscaleMajority(src, 1, 1).data]).toEqual(BLUE)
    const reversed = img(2, 2, (x, y) => (y === 0 ? RED : BLUE))
    expect([...downscaleMajority(reversed, 1, 1).data]).toEqual(BLUE)
  })
  it('preserves quadrant colors on a clean 2x downscale', () => {
    const src = img(4, 4, (x, y) => (x < 2 ? (y < 2 ? RED : BLUE) : (y < 2 ? [0, 255, 0, 255] as Px : CLEAR)))
    const out = downscaleMajority(src, 2, 2)
    expect([...out.data.slice(0, 4)]).toEqual(RED)
    expect([...out.data.slice(4, 8)]).toEqual([0, 255, 0, 255])
    expect([...out.data.slice(8, 12)]).toEqual(BLUE)
    expect(out.data[15]).toBe(0)
  })

  // ★ THE PROPERTY THAT MAKES A GATE A GATE AND NOT A COIN. Half of every character sheet
  // is `mirrorX` of the other half, so the reduction the gates measure through has to
  // commute with a flip. It did not: `floor(i*src/n)` boxes are not their own mirror on a
  // non-integer factor, and the tie-break read left to right. Both are fixed; this asserts
  // the consequence over the AWKWARD sizes — odd source, even output and the reverse — which
  // is where every one of the disagreements lived.
  it('★ commutes with a horizontal flip, at every source/output parity', () => {
    const offenders: string[] = []
    for (const src of [31, 32, 33, 96, 127, 128]) for (const out of [7, 8, 9, 10]) {
      const x = img(src, 5, (px, py) => [(px * 37 + py * 11) % 256, (px * 13) % 256, py * 40, px % 7 === 0 ? 0 : 255])
      const lhs = downscaleMajority(mirrorX(x), out, 3), rhs = mirrorX(downscaleMajority(x, out, 3))
      let diff = 0
      for (let i = 0; i < lhs.data.length; i++) if (lhs.data[i] !== rhs.data[i]) diff++
      if (diff > 0) offenders.push(`${src}->${out}: ${diff} bytes`)
    }
    expect(offenders, 'downscaleMajority(flip(x)) is not flip(downscaleMajority(x))').toEqual([])
  })

  // Anti-vacuity: a downscale that threw everything away would also "commute".
  it('and still carries the source through — the mirror test is not passing on empty output', () => {
    const x = img(33, 5, (px) => (px < 11 ? RED : px < 22 ? BLUE : CLEAR))
    const out = downscaleMajority(x, 9, 3)
    expect([...out.data.slice(0, 4)]).toEqual(RED)
    expect([...out.data.slice(4 * 4, 4 * 4 + 4)]).toEqual(BLUE)
    expect(out.data[8 * 4 + 3]).toBe(0)
  })
})

// 70x70 image drawn from 7px art blocks with varied colors per block
function sevenPxBlockImage(): RawImage {
  const palette: Px[] = [RED, BLUE, [0, 255, 0, 255], [255, 255, 0, 255], [128, 64, 32, 255]]
  return img(70, 70, (x, y) => {
    const bx = Math.floor(x / 7), by = Math.floor(y / 7)
    return palette[(bx * 3 + by * 5 + (bx * by) % 7) % palette.length]!
  })
}

describe('detectArtScale', () => {
  it('detects the 7px block size of a synthetic big-pixel image', () => {
    expect(detectArtScale(sevenPxBlockImage())).toBe(7)
  })
  it('honors an explicit candidate list', () => {
    expect(detectArtScale(sevenPxBlockImage(), [5, 7, 9])).toBe(7)
  })
})

describe('snapToGrid', () => {
  it('reduces a 7px-block 70x70 image to its native 10x10', () => {
    const src = sevenPxBlockImage()
    const out = snapToGrid(src)
    expect(out.width).toBe(10); expect(out.height).toBe(10)
    for (let by = 0; by < 10; by++) for (let bx = 0; bx < 10; bx++)
      expect([...out.data.slice((by * 10 + bx) * 4, (by * 10 + bx) * 4 + 4)],
        `block ${bx},${by}`).toEqual([...src.data.slice((by * 7 * 70 + bx * 7) * 4, (by * 7 * 70 + bx * 7) * 4 + 4)])
  })
})

describe('anchorToCanvas', () => {
  it('centers the opaque bbox horizontally and rests its bottom on feetY', () => {
    // 2 wide x 3 tall red block at (1,1) in a 4x5 image
    const src = img(4, 5, (x, y) => (x >= 1 && x <= 2 && y >= 1 && y <= 3 ? RED : CLEAR))
    const out = anchorToCanvas(src, 8, 8, 6)
    expect(out.width).toBe(8); expect(out.height).toBe(8)
    const opaque: [number, number][] = []
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++)
      if (out.data[(y * 8 + x) * 4 + 3]! > 0) opaque.push([x, y])
    // bbox is 2x3 -> left = (8-2)/2 = 3, rows 4..6
    expect(opaque).toEqual([[3, 4], [4, 4], [3, 5], [4, 5], [3, 6], [4, 6]])
  })
  it('throws when the sprite exceeds the canvas', () => {
    const tall = solid(2, 10, RED)
    expect(() => anchorToCanvas(tall, 8, 8, 6)).toThrow()   // 10 tall cannot rest at feetY 6
    const wide = solid(10, 2, RED)
    expect(() => anchorToCanvas(wide, 8, 8, 6)).toThrow()
  })
  it('throws on a fully transparent sprite', () => {
    expect(() => anchorToCanvas(solid(4, 4, CLEAR), 8, 8, 6)).toThrow()
  })
})

describe('defringe', () => {
  const MAGENTA: Px = [255, 0, 255, 255]
  const GREEN: Px = [110, 148, 85, 255] // sage: clean under every predicate branch
  it('replaces a magenta-haloed edge pixel with its clean neighbor color', () => {
    // col 0 transparent, col 1 magenta halo, col 2 green body
    const src = img(3, 3, x => (x === 0 ? CLEAR : x === 1 ? MAGENTA : GREEN))
    const out = defringe(src)
    for (let y = 0; y < 3; y++) {
      expect([...out.data.slice((y * 3 + 1) * 4, (y * 3 + 1) * 4 + 4)]).toEqual(GREEN)
      expect([...out.data.slice((y * 3 + 2) * 4, (y * 3 + 2) * 4 + 4)]).toEqual(GREEN)
      expect(out.data[(y * 3) * 4 + 3]).toBe(0)
    }
  })
  it('replaces maroon-family and red-heavy fringe pixels (v2 predicate)', () => {
    const MAROON: Px = [150, 60, 90, 255]    // r>g+30 and b>g+15
    const REDDISH: Px = [200, 100, 105, 255] // b-g small, but r>g+50
    for (const bad of [MAROON, REDDISH]) {
      const src = img(3, 1, x => (x === 0 ? CLEAR : x === 1 ? bad : GREEN))
      expect([...defringe(src).data.slice(4, 8)]).toEqual(GREEN)
    }
  })
  it('catches lavender halo pixels (v3 branch) while sage and cream stay untouched', () => {
    const LAVENDER: Px = [170, 140, 180, 255] // b>g+25 and r>g+10
    const src = img(3, 1, x => (x === 0 ? CLEAR : x === 1 ? LAVENDER : GREEN))
    expect([...defringe(src).data.slice(4, 8)]).toEqual(GREEN)
    const CREAM: Px = [245, 240, 230, 255] // r≈g≈b
    for (const good of [GREEN, CREAM]) {
      const edge = img(3, 1, x => (x === 0 ? CLEAR : good))
      expect([...defringe(edge).data.slice(4, 8)]).toEqual(good)
    }
  })
  it('leaves magenta-contaminated interior pixels untouched', () => {
    // 5x5 fully opaque green with magenta center: center is not on a transparency edge
    const src = img(5, 5, (x, y) => (x === 2 && y === 2 ? MAGENTA : GREEN))
    expect([...defringe(src).data.slice((2 * 5 + 2) * 4, (2 * 5 + 2) * 4 + 4)]).toEqual(MAGENTA)
  })
  it('does not touch legitimately pink (dusty rose) pixels, even on the edge', () => {
    const ROSE: Px = [242, 198, 194, 255] // r-g=44<50, b-g<15 -> clean
    const src = img(3, 1, x => (x === 0 ? CLEAR : ROSE))
    expect([...defringe(src).data.slice(4, 8)]).toEqual(ROSE)
  })
  it('desaturates toward r=b=(r+b)/2 when no clean neighbor exists', () => {
    const src = img(2, 1, x => (x === 0 ? CLEAR : [200, 100, 255, 255] as Px))
    expect([...defringe(src).data.slice(4, 8)]).toEqual([228, 100, 228, 255])
  })
})

describe('sheetScale', () => {
  it('returns the modal detected scale across images', () => {
    const six = img(60, 60, (x, y) => {
      const palette: Px[] = [RED, BLUE, [0, 255, 0, 255], [255, 255, 0, 255]]
      const bx = Math.floor(x / 6), by = Math.floor(y / 6)
      return palette[(bx * 3 + by * 5 + (bx * by) % 7) % palette.length]!
    })
    expect(sheetScale([sevenPxBlockImage(), sevenPxBlockImage(), sevenPxBlockImage(), six])).toBe(7)
  })
})

describe('registerToReference', () => {
  it('recovers a synthetic horizontal shift', () => {
    const ref = img(12, 6, (x, y) => (x >= 2 && x <= 4 && y >= 1 && y <= 4 ? RED : CLEAR))
    const shifted = img(12, 6, (x, y) => (x >= 5 && x <= 7 && y >= 1 && y <= 4 ? RED : CLEAR))
    expect(registerToReference(ref, shifted).dx).toBe(-3)
    expect(registerToReference(ref, ref).dx).toBe(0)
  })
})

describe('despeckle', () => {
  it('removes opaque islands smaller than minIsland, keeps larger ones', () => {
    // 2x2 blob at (0,0), single at (4,0), pair at (0,4)-(1,4)
    const on = new Set(['0,0', '1,0', '0,1', '1,1', '4,0', '0,4', '1,4'])
    const src = img(5, 5, (x, y) => (on.has(`${x},${y}`) ? RED : CLEAR))
    const out = despeckle(src, 3)
    expect(out.data[(0 * 5 + 0) * 4 + 3]).toBe(255)  // 4-blob kept
    expect(out.data[(0 * 5 + 4) * 4 + 3]).toBe(0)    // single removed
    expect(out.data[(4 * 5 + 0) * 4 + 3]).toBe(0)    // pair removed
    expect(out.data[(4 * 5 + 1) * 4 + 3]).toBe(0)
  })
})

describe('fillPinholes', () => {
  it('fills small enclosed transparent holes with the neighboring color', () => {
    const src = img(5, 5, (x, y) => (x === 2 && y === 2 ? CLEAR : RED))
    const out = fillPinholes(src, 2)
    expect([...out.data.slice((2 * 5 + 2) * 4, (2 * 5 + 2) * 4 + 4)]).toEqual(RED)
  })
  it('leaves large holes and border-touching transparency alone', () => {
    // 2x2 hole (size 4 > maxHole 2) in a 6x6 opaque block
    const big = img(6, 6, (x, y) => (x >= 2 && x <= 3 && y >= 2 && y <= 3 ? CLEAR : RED))
    expect(fillPinholes(big, 2).data[(2 * 6 + 2) * 4 + 3]).toBe(0)
    // border-touching single transparent pixel
    const edge = img(3, 3, (x, y) => (x === 0 && y === 1 ? CLEAR : RED))
    expect(fillPinholes(edge, 2).data[(1 * 3) * 4 + 3]).toBe(0)
  })
})

describe('unionPalette', () => {
  it('keeps both images\' dominant colors and quantizing preserves them exactly', () => {
    const a = solid(4, 4, [10, 20, 30, 255])
    const b = solid(4, 4, [200, 210, 220, 255])
    const pal = unionPalette([a, b], 48)
    expect(pal).toContainEqual([10, 20, 30])
    expect(pal).toContainEqual([200, 210, 220])
    const qa = quantize(a, pal)
    expect([...qa.data.slice(0, 4)]).toEqual([10, 20, 30, 255])
  })
  it('caps the palette at k frequency-ranked colors', () => {
    const noisy = img(4, 4, (x, y) => [x * 16, y * 16, 128, 255] as Px) // 16 distinct colors
    expect(unionPalette([noisy], 5)).toHaveLength(5)
  })
})

describe('erodeAlpha', () => {
  it('removes a 1px halo ring and keeps the interior intact', () => {
    const MAGENTA: Px = [255, 0, 255, 255]
    // 7x7: 5x5 blob = 1px magenta ring around a 3x3 red core
    const src = img(7, 7, (x, y) => {
      if (x < 1 || y < 1 || x > 5 || y > 5) return CLEAR
      return x >= 2 && x <= 4 && y >= 2 && y <= 4 ? RED : MAGENTA
    })
    const out = erodeAlpha(src, 1)
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
      const inCore = x >= 2 && x <= 4 && y >= 2 && y <= 4
      expect(out.data[(y * 7 + x) * 4 + 3], `${x},${y}`).toBe(inCore ? 255 : 0)
      if (inCore) expect([...out.data.slice((y * 7 + x) * 4, (y * 7 + x) * 4 + 3)]).toEqual([255, 0, 0])
    }
  })
  it('radius 2 erodes twice', () => {
    const src = solid(6, 6, RED)
    const out = erodeAlpha(src, 2)
    let opaque = 0
    for (let i = 3; i < out.data.length; i += 4) if (out.data[i]! > 0) opaque++
    expect(opaque).toBe(4) // 6x6 -> 4x4 -> 2x2
  })
})

describe('erodeForPitch', () => {
  it('fully removes a 3px blend band at pitch 6, interior intact', () => {
    // targetH 8, bboxH 48 -> pitch 6 -> radius max(1, round(3)) = 3
    const MAGENTA: Px = [255, 0, 255, 255]
    const src = img(30, 48, (x, y) => {
      const depth = Math.min(x, y, 29 - x, 47 - y)
      return depth < 3 ? MAGENTA : RED
    })
    const out = erodeForPitch(src, 8)
    for (let y = 0; y < 48; y++) for (let x = 0; x < 30; x++) {
      const i = (y * 30 + x) * 4
      const depth = Math.min(x, y, 29 - x, 47 - y)
      if (depth < 3) expect(out.data[i + 3], `band ${x},${y}`).toBe(0)
      else {
        expect(out.data[i + 3], `core ${x},${y}`).toBe(255)
        expect([...out.data.slice(i, i + 3)]).toEqual([255, 0, 0])
      }
    }
  })
  it('never erodes below radius 1', () => {
    const tiny = solid(4, 4, RED) // pitch 4/8=0.5 -> radius max(1, round(0.25)) = 1
    const out = erodeForPitch(tiny, 8)
    let opaque = 0
    for (let i = 3; i < out.data.length; i += 4) if (out.data[i]! > 0) opaque++
    expect(opaque).toBe(4)
  })
})

describe('resampleToArtHeight', () => {
  const palette: Px[] = [RED, BLUE, [0, 255, 0, 255], [255, 255, 0, 255], [128, 64, 32, 255]]
  // sprite whose art blocks have a non-integer pitch, phased at the bbox bottom-left
  function pitched(pitch: number, cols: number, rows: number): RawImage {
    const w = Math.round(cols * pitch), h = Math.round(rows * pitch)
    return img(w, h, (x, y) => {
      const bi = Math.min(cols - 1, Math.floor(x / pitch))
      const bj = Math.min(rows - 1, Math.floor((h - 1 - y) / pitch))
      return palette[(bi * 3 + bj) % palette.length]!
    })
  }
  it('recovers exact block colors from a 7.25px-pitch sprite', () => {
    const out = resampleToArtHeight(pitched(7.25, 4, 8), 8)
    expect(out.height).toBe(8)
    expect(out.width).toBe(4)
    for (let j = 0; j < 8; j++) for (let i = 0; i < 4; i++) {
      const bj = 8 - 1 - j
      expect([...out.data.slice((j * 4 + i) * 4, (j * 4 + i) * 4 + 4)], `cell ${i},${j}`)
        .toEqual(palette[(i * 3 + bj) % palette.length])
    }
  })
  it('output height always equals targetH', () => {
    expect(resampleToArtHeight(solid(9, 37, RED), 8).height).toBe(8)
    expect(resampleToArtHeight(solid(5, 20, RED), 8).height).toBe(8)
  })
  it('same content at different pitches resamples identically', () => {
    const a = resampleToArtHeight(pitched(5, 4, 8), 8)
    const b = resampleToArtHeight(pitched(9, 4, 8), 8)
    expect(a.width).toBe(b.width)
    expect(a.data).toEqual(b.data)
  })
})

const PAL5: Px[] = [RED, BLUE, [0, 255, 0, 255], [255, 255, 0, 255], [40, 40, 40, 255]]
function pitchGrid(pitch: number, n: number, halo = 0): RawImage {
  const inner = Math.round(pitch * n), size = inner + 2 * halo
  return img(size, size, (x, y) => {
    const gx = x - halo, gy = y - halo
    if (gx < 0 || gy < 0 || gx >= inner || gy >= inner) return [255, 0, 255, 255] as Px
    const bi = Math.min(n - 1, Math.floor(gx / pitch)), bj = Math.min(n - 1, Math.floor(gy / pitch))
    return PAL5[(bi * 3 + bj * 2 + (bi * bj) % 7) % 5]!
  })
}

describe('estimatePitch', () => {
  it('recovers pitch 7.30 within ±0.1', () => {
    expect(Math.abs(estimatePitch(pitchGrid(7.3, 8)) - 7.3)).toBeLessThanOrEqual(0.1)
  })
  it('recovers pitch 6.05 within ±0.1', () => {
    expect(Math.abs(estimatePitch(pitchGrid(6.05, 8)) - 6.05)).toBeLessThanOrEqual(0.1)
  })
  it('is immune to a 2px halo band', () => {
    expect(Math.abs(estimatePitch(pitchGrid(7.3, 8, 2)) - 7.3)).toBeLessThanOrEqual(0.1)
  })
  it('throws on a fully transparent input', () => {
    expect(() => estimatePitch(solid(8, 8, CLEAR))).toThrow('estimatePitch: no opaque neighbor pairs')
  })
  it('throws on a 1x1 input (no neighbor pairs)', () => {
    expect(() => estimatePitch(solid(1, 1, RED))).toThrow('estimatePitch: no opaque neighbor pairs')
  })
})

describe('opaqueBbox', () => {
  it('returns null when the image has no opaque pixels', () => {
    expect(opaqueBbox(solid(3, 3, CLEAR))).toBeNull()
  })
  it('returns the tight box around opaque pixels', () => {
    const src = img(4, 3, (x, y) => (x >= 1 && x <= 2 && y >= 1 ? RED : CLEAR))
    expect(opaqueBbox(src)).toEqual({ x0: 1, x1: 2, y0: 1, y1: 2 })
  })
})

describe('upscaleNearest', () => {
  it('replicates each pixel into a k x k block', () => {
    const src = img(2, 1, x => (x === 0 ? RED : BLUE))
    const up = upscaleNearest(src, 2)
    expect(up.width).toBe(4); expect(up.height).toBe(2)
    for (const [x, y, want] of [[0, 0, RED], [1, 1, RED], [2, 0, BLUE], [3, 1, BLUE]] as const)
      expect([...up.data.slice((y * 4 + x) * 4, (y * 4 + x) * 4 + 4)]).toEqual(want)
  })
})

describe('distanceMatrix / pairwiseMedian', () => {
  const a = solid(2, 2, RED), b = solid(2, 2, BLUE), c = solid(2, 2, CLEAR)
  it('renders one header line plus one row per cell with cellDistance values', () => {
    const out = distanceMatrix([{ label: 'a', img: a }, { label: 'b', img: b }], false)
    const lines = out.split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toBe(['a'.padEnd(12), '0.000'.padStart(11), cellDistance(a, b).toFixed(3).padStart(11)].join(' '))
  })
  it('mirror=true measures against the mirrored column cell', () => {
    const asym = img(2, 1, x => (x === 0 ? RED : BLUE))
    const out = distanceMatrix([{ label: 'a', img: asym }, { label: 'm', img: mirrorX(asym) }], true)
    expect(out.split('\n')[1]).toContain('0.000')
  })
  it('pairwiseMedian returns the upper-median pairwise distance', () => {
    const ds = [cellDistance(a, b), cellDistance(a, c), cellDistance(b, c)].sort((x, y) => x - y)
    expect(pairwiseMedian([a, b, c])).toBe(ds[1])
  })
})

describe('refineLattice', () => {
  it('recovers a known lattice offset by coordinate descent', () => {
    const src = img(59, 61, (x, y) =>
      PAL5[(Math.floor((x - 3 + 70) / 7) * 3 + Math.floor((y - 5 + 70) / 7) * 2 + 1) % 5]!)
    const lat = refineLattice(src, 7.2, { ox: 2, oy: 6 })
    expect(Math.abs(lat.px - 7)).toBeLessThan(0.3)
    expect(Math.abs(lat.py - 7)).toBeLessThan(0.3)
    const modDist = (v: number, target: number, p: number) => {
      const d = (((v - target) % p) + p) % p
      return Math.min(d, p - d)
    }
    expect(modDist(lat.ox, 3, lat.px)).toBeLessThan(0.6)
    expect(modDist(lat.oy, 5, lat.py)).toBeLessThan(0.6)
  })
})

describe('resampleModeLattice', () => {
  it('picks the dominant color in a straddling cell', () => {
    const src = img(10, 10, x => (x < 6 ? RED : BLUE))
    const { out } = resampleModeLattice(src, { px: 10, py: 10, ox: 0, oy: 0 })
    expect(out.width).toBe(1)
    expect(out.height).toBe(1)
    expect([...out.data]).toEqual([255, 0, 0, 255])
  })
  it('nudges the sample window when no color dominates', () => {
    const GREEN: Px = [0, 255, 0, 255]
    const pal4: Px[] = [RED, BLUE, [255, 255, 0, 255], [40, 40, 40, 255]]
    // cell [0,12): central window is a 4-color mix (each ~25% < 40%); solid green from x=9
    const src = img(20, 12, (x, y) => (x >= 9 ? GREEN : pal4[(x + 2 * y) % 4]!))
    const { out } = resampleModeLattice(src, { px: 12, py: 12, ox: 0, oy: 0 })
    expect([...out.data.slice(0, 4)]).toEqual(GREEN)
  })
})

describe('sheetMetrics', () => {
  it('reports clean metrics on a perfect grid', () => {
    const src = img(28, 28, (x, y) => PAL5[(Math.floor(x / 7) + Math.floor(y / 7) * 2) % 5]!)
    const lat = { px: 7, py: 7, ox: 0, oy: 0 }
    const r = resampleModeLattice(src, lat)
    const m = sheetMetrics([{ out: r.out, dominance: r.dominance, eroded: src, lat, origin: r.origin }])
    expect(m.ambiguousPct).toBe(0)
    expect(m.reconErr).toBeLessThan(0.02)
    expect(m.dupRowCount).toBe(0)
  })
  it('counts adjacent identical opaque rows', () => {
    const out = img(2, 3, (_, y) => (y < 2 ? RED : BLUE))
    const m = sheetMetrics([{
      out, dominance: new Float32Array(6).fill(1), eroded: out,
      lat: { px: 1, py: 1, ox: 0, oy: 0 }, origin: { i0: 0, j0: 0 },
    }])
    expect(m.dupRowCount).toBe(1)
  })
})

describe('sweepMagenta', () => {
  it('replaces an enclosed magenta pixel with the neighbor mode color', () => {
    const src = img(3, 3, (x, y) => (x === 1 && y === 1 ? [255, 0, 255, 255] as Px : RED))
    expect([...sweepMagenta(src).data.slice((1 * 3 + 1) * 4, (1 * 3 + 1) * 4 + 4)]).toEqual(RED)
  })
  it('leaves dusty rose (r>g but b<g) untouched', () => {
    const ROSE: Px = [242, 198, 194, 255]
    const src = img(3, 3, (x, y) => (x === 1 && y === 1 ? ROSE : RED))
    expect([...sweepMagenta(src).data.slice((1 * 3 + 1) * 4, (1 * 3 + 1) * 4 + 4)]).toEqual(ROSE)
  })
})

describe('driftField', () => {
  const pal: Px[] = [RED, BLUE, [0, 255, 0, 255], [255, 255, 0, 255]]
  // 6 cols x 8 rows of 6px blocks; art-row band j drawn shifted down by d(j)
  function drifted(d: (j: number) => number): RawImage {
    return img(36, 6 * 8 + 2, (x, y) => {
      let j = 0
      for (let k = 0; k < 8; k++) if (6 * k + d(k) <= y) j = k
      const i = Math.min(5, Math.floor(x / 6))
      return pal[(i * 2 + j * 3 + ((i * j) % 5)) % 4]!
    })
  }
  it('recovers a linear 0->2px row drift monotonically, no jumps', () => {
    const d = (j: number) => Math.min(2, Math.floor(j / 3))
    const { rowOffsets } = driftField(drifted(d), 6, { ox: 0, oy: 0 })
    // bands 0..7 carry content; a trailing band past the drifted content is unconstrained
    for (let j = 1; j <= 7; j++) {
      expect(rowOffsets[j]! - rowOffsets[j - 1]!, `row ${j}`).toBeGreaterThanOrEqual(0)
      expect(rowOffsets[j]! - rowOffsets[j - 1]!, `row ${j}`).toBeLessThanOrEqual(1)
    }
    expect(rowOffsets[0]).toBe(0)
    expect(rowOffsets[7]).toBe(2)
  })
  it('yields all-zero offsets on an undrifted grid', () => {
    const { rowOffsets, colOffsets } = driftField(drifted(() => 0), 6, { ox: 0, oy: 0 })
    expect(rowOffsets.every(o => o === 0)).toBe(true)
    expect(colOffsets.every(o => o === 0)).toBe(true)
  })
})

describe('resampleClusterLattice', () => {
  it('does not split dominance across 5-bit bin boundaries', () => {
    // Δ2 pair straddling the 15|16 bin edge: binning splits it, ε-clustering must not
    const src = img(10, 10, (x, y) => ((x + y) % 2 === 0 ? [15, 15, 15, 255] as Px : [17, 17, 17, 255] as Px))
    const lat = { px: 10, py: 10, ox: 0, oy: 0 }
    const cluster = resampleClusterLattice(src, lat)
    const mode = resampleModeLattice(src, lat)
    expect(cluster.dominance[0]!).toBeGreaterThan(0.9)
    expect(mode.dominance[0]!).toBeLessThan(0.7)
    // weighted mean of the merged cluster
    expect(cluster.out.data[0]!).toBeGreaterThanOrEqual(15)
    expect(cluster.out.data[0]!).toBeLessThanOrEqual(17)
  })
})

describe('mergeSheetColors', () => {
  it('merges Δ6 colors to the population-weighted centroid, keeps Δ30 apart', () => {
    const a = solid(2, 2, [100, 100, 100, 255])  // 4 px
    const b = solid(2, 1, [106, 106, 106, 255])  // 2 px, Δ6 -> merges
    const c = solid(1, 1, [136, 136, 136, 255])  // Δ30 from b -> stays
    const [ma, mb, mc] = mergeSheetColors([a, b, c], 6)
    expect([...ma!.data.slice(0, 3)]).toEqual([102, 102, 102]) // (100*4+106*2)/6
    expect([...mb!.data.slice(0, 3)]).toEqual([102, 102, 102])
    expect([...mc!.data.slice(0, 3)]).toEqual([136, 136, 136])
  })
})

describe('sweepMagentaCensus', () => {
  it('repaints rare enclosed magenta but keeps a frequent wine outline', () => {
    const WINE: Px = [125, 28, 65, 255] // matches predicate, but frequent = palette
    const src = img(10, 10, (x, y) => {
      if (x === 5 && y === 5) return [255, 0, 255, 255] as Px // rare magenta
      return y < 5 ? WINE : RED
    })
    const out = sweepMagentaCensus(src)
    expect([...out.data.slice((5 * 10 + 5) * 4, (5 * 10 + 5) * 4 + 3)]).toEqual([255, 0, 0]) // neighbor mode = red
    expect([...out.data.slice((2 * 10 + 2) * 4, (2 * 10 + 2) * 4 + 3)]).toEqual([125, 28, 65])
  })
})

describe('repairOutlineBlends', () => {
  const WINE: Px = [125, 28, 65, 255], SKIN: Px = [230, 180, 150, 255]
  const BLEND: Px = [178, 104, 108, 255]  // midpoint of WINE and SKIN
  // transparent ring, wine outline ring, skin interior; edit overrides single pixels
  const ringSprite = (edit?: (x: number, y: number) => Px | null) => img(12, 12, (x, y) => {
    const e = edit?.(x, y)
    if (e) return e
    if (x === 0 || y === 0 || x === 11 || y === 11) return CLEAR
    if (x === 1 || y === 1 || x === 10 || y === 10) return WINE
    return SKIN
  })

  it('repaints a midpoint fill->outline blend on the border to the outline color', () => {
    const { out, repainted } = repairOutlineBlends(ringSprite((x, y) => (x === 5 && y === 1 ? BLEND : null)))
    expect(repainted).toBe(1)
    expect([...out.data.slice((1 * 12 + 5) * 4, (1 * 12 + 5) * 4 + 3)]).toEqual([125, 28, 65])
  })

  it('leaves an off-segment highlight untouched', () => {
    const HILITE: Px = [255, 255, 180, 255] // ~85 from the WINE->SKIN segment
    const { out, repainted } = repairOutlineBlends(ringSprite((x, y) => (x === 5 && y === 1 ? HILITE : null)))
    expect(repainted).toBe(0)
    expect([...out.data.slice((1 * 12 + 5) * 4, (1 * 12 + 5) * 4 + 3)]).toEqual([255, 255, 180])
  })

  it('snaps a t=0.25 blend to FILL, a t=0.55 blend to outline, leaves t=0.10 alone', () => {
    const T25: Px = [204, 142, 129, 255] // SKIN + 0.25*(WINE-SKIN)
    const T55: Px = [172, 96, 103, 255]  // SKIN + 0.55*(WINE-SKIN)
    const T10: Px = [220, 165, 142, 255] // SKIN + 0.10*(WINE-SKIN): fill-committed within noise
    const px = (1 * 12 + 5) * 4
    const low = repairOutlineBlends(ringSprite((x, y) => (x === 5 && y === 1 ? T25 : null)))
    expect(low.fillSnaps).toBe(1)
    expect(low.outlineSnaps).toBe(0)
    expect([...low.out.data.slice(px, px + 3)]).toEqual([230, 180, 150])
    const high = repairOutlineBlends(ringSprite((x, y) => (x === 5 && y === 1 ? T55 : null)))
    expect(high.outlineSnaps).toBe(1)
    expect(high.fillSnaps).toBe(0)
    expect([...high.out.data.slice(px, px + 3)]).toEqual([125, 28, 65])
    const noise = repairOutlineBlends(ringSprite((x, y) => (x === 5 && y === 1 ? T10 : null)))
    expect(noise.repainted).toBe(0)
    expect([...noise.out.data.slice(px, px + 3)]).toEqual([220, 165, 142])
  })

  it('keeps line weight: outline pixel count grows by at most outlineSnaps, fill-snaps are not outline-colored', () => {
    const T25: Px = [204, 142, 129, 255]
    const T55: Px = [172, 96, 103, 255]
    const src = ringSprite((x, y) => (x === 4 && y === 1 ? T25 : x === 7 && y === 1 ? T55 : null))
    const { out, outlineSnaps, fillSnaps } = repairOutlineBlends(src)
    expect(outlineSnaps).toBe(1)
    expect(fillSnaps).toBe(1)
    const countWine = (im: RawImage) => {
      let n = 0
      for (let i = 0; i < im.data.length; i += 4)
        if (im.data[i + 3]! > 0 && im.data[i] === 125 && im.data[i + 1] === 28 && im.data[i + 2] === 65) n++
      return n
    }
    expect(countWine(out)).toBeLessThanOrEqual(countWine(src) + outlineSnaps)
    expect([...out.data.slice((1 * 12 + 4) * 4, (1 * 12 + 4) * 4 + 3)]).toEqual([230, 180, 150]) // fill snap, not outline
  })

  it('makes zero repaints on a clean sprite', () => {
    const src = ringSprite()
    const { out, repainted } = repairOutlineBlends(src)
    expect(repainted).toBe(0)
    expect([...out.data]).toEqual([...src.data])
  })

  it('repairs an inner-corner blend whose only transparency is diagonal', () => {
    const src = img(10, 10, (x, y) => {
      if (x === 0 || y === 0 || x === 9 || y === 9 || (x === 1 && y === 1)) return CLEAR
      if (x === 2 && y === 2) return BLEND // silhouette only via the (1,1) diagonal
      if (x === 1 || y === 1 || x === 8 || y === 8) return WINE
      return SKIN
    })
    const { out, repainted } = repairOutlineBlends(src)
    expect(repainted).toBe(1)
    expect([...out.data.slice((2 * 10 + 2) * 4, (2 * 10 + 2) * 4 + 3)]).toEqual([125, 28, 65])
  })
})

describe('duplicateReport', () => {
  const half = (left: Px, right: Px) => img(4, 4, x => (x < 2 ? left : right))
  it('flags an exact mirror pair as a mirrored dupe and leaves distinct cells alone', () => {
    const a = half(RED, CLEAR)
    const findings = duplicateReport(
      [{ label: 'a', img: a }, { label: 'b', img: mirrorX(a) }, { label: 'c', img: solid(4, 4, BLUE) }],
      STRAIGHT_DUPE, MIRROR_DUPE)
    expect(findings).toEqual([{ a: 'a', b: 'b', distance: 0, mirrored: true }])
  })
  it('flags an exact straight duplicate', () => {
    const a = half(RED, BLUE)
    const findings = duplicateReport([{ label: 'x', img: a }, { label: 'y', img: a }], STRAIGHT_DUPE, MIRROR_DUPE)
    expect(findings).toEqual([{ a: 'x', b: 'y', distance: 0, mirrored: false }])
  })
})

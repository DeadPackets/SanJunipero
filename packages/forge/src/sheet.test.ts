import { describe, it, expect } from 'vitest'
import type { RawImage } from './post/raw.js'
import {
  FACINGS,
  POSES,
  assembleGrid,
  mirrorX,
  cellDistance,
  downscaleMajority,
  anchorToCanvas,
  despeckle,
  erodeAlpha,
  resampleToArtHeight,
  estimatePitch,
  refineLattice,
  resampleModeLattice,
  sweepMagenta,
  driftField,
  resampleClusterLattice,
  opaqueBbox,
} from './sheet.js'

type Px = [number, number, number, number]
function img(w: number, h: number, px: (x: number, y: number) => Px): RawImage {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(px(x, y), (y * w + x) * 4)
  return { width: w, height: h, data }
}
const solid = (w: number, h: number, p: Px) => img(w, h, () => p)
const RED: Px = [255, 0, 0, 255],
  BLUE: Px = [0, 0, 255, 255],
  CLEAR: Px = [0, 0, 0, 0]

describe('sheet constants', () => {
  it('exports the facing and pose orders', () => {
    expect(FACINGS).toEqual(['sw', 'se', 'ne', 'nw'])
    expect(POSES).toEqual(['idle', 'walk-a', 'walk-b'])
  })
})

describe('assembleGrid', () => {
  it('sizes a 2x2 grid of 2x2 cells', () => {
    const cells = [
      [solid(2, 2, RED), solid(2, 2, BLUE)],
      [solid(2, 2, [0, 255, 0, 255]), solid(2, 2, [1, 2, 3, 255])],
    ]
    const sheet = assembleGrid(cells, 2, 2)
    expect(sheet.width).toBe(4)
    expect(sheet.height).toBe(4)
  })
  it('blits row-major: top-left pixel of sheet comes from cells[0][0]', () => {
    const sheet = assembleGrid([[solid(1, 1, RED), solid(1, 1, BLUE)]], 1, 1)
    expect([...sheet.data.slice(0, 4)]).toEqual(RED)
    expect([...sheet.data.slice(4, 8)]).toEqual(BLUE)
  })
  it('throws on a size-mismatched cell', () => {
    expect(() => assembleGrid([[solid(2, 2, RED), solid(1, 2, BLUE)]], 2, 2)).toThrow()
  })
})

describe('mirrorX', () => {
  it('flips horizontally and is an involution', () => {
    const src = img(2, 1, (x) => (x === 0 ? RED : BLUE))
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
    const a = img(2, 2, (x) => (x === 0 ? RED : CLEAR))
    const b = solid(2, 2, BLUE)
    expect(cellDistance(a, b)).toBeCloseTo(cellDistance(b, a), 12)
  })
  it('ignores pixels transparent in both images', () => {
    const a = img(2, 1, (x) => (x === 0 ? RED : CLEAR))
    const b = img(2, 1, (x) => (x === 0 ? RED : CLEAR))
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
    const src = img(2, 2, (_x, y) => (y === 0 ? BLUE : RED)) // 2 blue then 2 red
    expect([...downscaleMajority(src, 1, 1).data]).toEqual(BLUE)
    const reversed = img(2, 2, (_x, y) => (y === 0 ? RED : BLUE))
    expect([...downscaleMajority(reversed, 1, 1).data]).toEqual(BLUE)
  })
  it('preserves quadrant colors on a clean 2x downscale', () => {
    const src = img(4, 4, (x, y) =>
      x < 2 ? (y < 2 ? RED : BLUE) : y < 2 ? ([0, 255, 0, 255] as Px) : CLEAR,
    )
    const out = downscaleMajority(src, 2, 2)
    expect([...out.data.slice(0, 4)]).toEqual(RED)
    expect([...out.data.slice(4, 8)]).toEqual([0, 255, 0, 255])
    expect([...out.data.slice(8, 12)]).toEqual(BLUE)
    expect(out.data[15]).toBe(0)
  })

  // Half of every character sheet is `mirrorX` of the other half, so the reduction the gates
  // measure through has to commute with a flip — asserted over the AWKWARD source/output parities.
  it('★ commutes with a horizontal flip, at every source/output parity', () => {
    const offenders: string[] = []
    for (const src of [31, 32, 33, 96, 127, 128])
      for (const out of [7, 8, 9, 10]) {
        const x = img(src, 5, (px, py) => [
          (px * 37 + py * 11) % 256,
          (px * 13) % 256,
          py * 40,
          px % 7 === 0 ? 0 : 255,
        ])
        const lhs = downscaleMajority(mirrorX(x), out, 3),
          rhs = mirrorX(downscaleMajority(x, out, 3))
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

describe('anchorToCanvas', () => {
  it('centers the opaque bbox horizontally and rests its bottom on feetY', () => {
    // 2 wide x 3 tall red block at (1,1) in a 4x5 image
    const src = img(4, 5, (x, y) => (x >= 1 && x <= 2 && y >= 1 && y <= 3 ? RED : CLEAR))
    const out = anchorToCanvas(src, 8, 8, 6)
    expect(out.width).toBe(8)
    expect(out.height).toBe(8)
    const opaque: [number, number][] = []
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) if (out.data[(y * 8 + x) * 4 + 3]! > 0) opaque.push([x, y])
    // bbox is 2x3 -> left = (8-2)/2 = 3, rows 4..6
    expect(opaque).toEqual([
      [3, 4],
      [4, 4],
      [3, 5],
      [4, 5],
      [3, 6],
      [4, 6],
    ])
  })
  it('throws when the sprite exceeds the canvas', () => {
    const tall = solid(2, 10, RED)
    expect(() => anchorToCanvas(tall, 8, 8, 6)).toThrow() // 10 tall cannot rest at feetY 6
    const wide = solid(10, 2, RED)
    expect(() => anchorToCanvas(wide, 8, 8, 6)).toThrow()
  })
  it('throws on a fully transparent sprite', () => {
    expect(() => anchorToCanvas(solid(4, 4, CLEAR), 8, 8, 6)).toThrow()
  })
})
describe('despeckle', () => {
  it('removes opaque islands smaller than minIsland, keeps larger ones', () => {
    // 2x2 blob at (0,0), single at (4,0), pair at (0,4)-(1,4)
    const on = new Set(['0,0', '1,0', '0,1', '1,1', '4,0', '0,4', '1,4'])
    const src = img(5, 5, (x, y) => (on.has(`${x},${y}`) ? RED : CLEAR))
    const out = despeckle(src, 3)
    expect(out.data[(0 * 5 + 0) * 4 + 3]).toBe(255) // 4-blob kept
    expect(out.data[(0 * 5 + 4) * 4 + 3]).toBe(0) // single removed
    expect(out.data[(4 * 5 + 0) * 4 + 3]).toBe(0) // pair removed
    expect(out.data[(4 * 5 + 1) * 4 + 3]).toBe(0)
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
    for (let y = 0; y < 7; y++)
      for (let x = 0; x < 7; x++) {
        const inCore = x >= 2 && x <= 4 && y >= 2 && y <= 4
        expect(out.data[(y * 7 + x) * 4 + 3], `${x},${y}`).toBe(inCore ? 255 : 0)
        if (inCore)
          expect([...out.data.slice((y * 7 + x) * 4, (y * 7 + x) * 4 + 3)]).toEqual([255, 0, 0])
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
describe('resampleToArtHeight', () => {
  const palette: Px[] = [RED, BLUE, [0, 255, 0, 255], [255, 255, 0, 255], [128, 64, 32, 255]]
  // sprite whose art blocks have a non-integer pitch, phased at the bbox bottom-left
  function pitched(pitch: number, cols: number, rows: number): RawImage {
    const w = Math.round(cols * pitch),
      h = Math.round(rows * pitch)
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
    for (let j = 0; j < 8; j++)
      for (let i = 0; i < 4; i++) {
        const bj = 8 - 1 - j
        expect([...out.data.slice((j * 4 + i) * 4, (j * 4 + i) * 4 + 4)], `cell ${i},${j}`).toEqual(
          palette[(i * 3 + bj) % palette.length],
        )
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
  const inner = Math.round(pitch * n),
    size = inner + 2 * halo
  return img(size, size, (x, y) => {
    const gx = x - halo,
      gy = y - halo
    if (gx < 0 || gy < 0 || gx >= inner || gy >= inner) return [255, 0, 255, 255] as Px
    const bi = Math.min(n - 1, Math.floor(gx / pitch)),
      bj = Math.min(n - 1, Math.floor(gy / pitch))
    return PAL5[(bi * 3 + bj * 2 + ((bi * bj) % 7)) % 5]!
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
    expect(() => estimatePitch(solid(8, 8, CLEAR))).toThrow(
      'estimatePitch: no opaque neighbor pairs',
    )
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
describe('refineLattice', () => {
  it('recovers a known lattice offset by coordinate descent', () => {
    const src = img(
      59,
      61,
      (x, y) =>
        PAL5[(Math.floor((x - 3 + 70) / 7) * 3 + Math.floor((y - 5 + 70) / 7) * 2 + 1) % 5]!,
    )
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
    const src = img(10, 10, (x) => (x < 6 ? RED : BLUE))
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
describe('sweepMagenta', () => {
  it('replaces an enclosed magenta pixel with the neighbor mode color', () => {
    const src = img(3, 3, (x, y) => (x === 1 && y === 1 ? ([255, 0, 255, 255] as Px) : RED))
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
    const { rowOffsets, colOffsets } = driftField(
      drifted(() => 0),
      6,
      { ox: 0, oy: 0 },
    )
    expect(rowOffsets.every((o) => o === 0)).toBe(true)
    expect(colOffsets.every((o) => o === 0)).toBe(true)
  })
})

describe('resampleClusterLattice', () => {
  it('does not split dominance across 5-bit bin boundaries', () => {
    // Δ2 pair straddling the 15|16 bin edge: binning splits it, ε-clustering must not
    const src = img(10, 10, (x, y) =>
      (x + y) % 2 === 0 ? ([15, 15, 15, 255] as Px) : ([17, 17, 17, 255] as Px),
    )
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

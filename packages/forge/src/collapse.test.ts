// ★ The forge carried three hand-written flood fills and four mean-RGB accumulators. Each one is
// gone now, and each collapse is pinned HERE against a verbatim copy of the code it replaced,
// measured on real shipped art. Change a shared helper and this file is what tells you it moved.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodePng, type RawImage } from './post/raw.js'
import { despeckle } from './sheet.js'
import { soleSilhouetteGate } from './pixelGates.js'
import { countIslands } from './library/postItem.js'
import { materialMean, seamReport, seasonTintFrom } from './terrainGen.js'

const fixture = (p: string): Promise<RawImage> =>
  decodePng(readFileSync(new URL(`./fixtures/${p}`, import.meta.url)))

const ALPHA_SAMPLES = [
  'character-v1/idle-sw.png',
  'character-v1/walk-a-ne.png',
  'pixel-gates/bed-192.png',
  'pixel-gates/chair-128.png',
  'pixel-gates/sleep-amara-64.png',
]

const OPAQUE_SAMPLES = ['pixel-gates/floor-512.png', 'pixel-gates/rejected-farmland_0.png']

// ---------------------------------------------------------------- the old code, verbatim

function oldDespeckle(img: RawImage, minIsland = 3): RawImage {
  const out = new Uint8ClampedArray(img.data)
  const seen = new Uint8Array(img.width * img.height)
  for (let start = 0; start < seen.length; start++) {
    if (seen[start] || img.data[start * 4 + 3] === 0) continue
    const stack = [start],
      island: number[] = []
    seen[start] = 1
    while (stack.length) {
      const p = stack.pop()!
      island.push(p)
      const x = p % img.width,
        y = (p / img.width) | 0
      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ] as const) {
        if (nx < 0 || ny < 0 || nx >= img.width || ny >= img.height) continue
        const n = ny * img.width + nx
        if (!seen[n] && img.data[n * 4 + 3]! > 0) {
          seen[n] = 1
          stack.push(n)
        }
      }
    }
    if (island.length < minIsland) for (const p of island) out.fill(0, p * 4, p * 4 + 4)
  }
  return { width: img.width, height: img.height, data: out }
}

function oldCountIslands(img: RawImage): number {
  const seen = new Uint8Array(img.width * img.height)
  let n = 0
  for (let start = 0; start < seen.length; start++) {
    if (seen[start] || img.data[start * 4 + 3] === 0) continue
    n++
    const stack = [start]
    seen[start] = 1
    while (stack.length) {
      const p = stack.pop()!
      const x = p % img.width,
        y = (p / img.width) | 0
      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ] as const) {
        if (nx < 0 || ny < 0 || nx >= img.width || ny >= img.height) continue
        const q = ny * img.width + nx
        if (!seen[q] && img.data[q * 4 + 3]! > 0) {
          seen[q] = 1
          stack.push(q)
        }
      }
    }
  }
  return n
}

/** The unrolled stack loop that used to sit inside `soleSilhouetteGate`. */
function oldSilhouetteSizes(img: RawImage): number[] {
  const { width: w, height: h, data } = img
  const seen = new Uint8Array(w * h)
  const stack: number[] = []
  const sizes: number[] = []
  for (let start = 0; start < w * h; start++) {
    if (seen[start] === 1 || data[start * 4 + 3] === 0) continue
    let n = 0
    stack.push(start)
    seen[start] = 1
    while (stack.length > 0) {
      const p = stack.pop()!
      n++
      const px = p % w,
        py = (p - px) / w
      if (px + 1 < w) {
        const q = p + 1
        if (seen[q] === 0 && data[q * 4 + 3] !== 0) {
          seen[q] = 1
          stack.push(q)
        }
      }
      if (px > 0) {
        const q = p - 1
        if (seen[q] === 0 && data[q * 4 + 3] !== 0) {
          seen[q] = 1
          stack.push(q)
        }
      }
      if (py + 1 < h) {
        const q = p + w
        if (seen[q] === 0 && data[q * 4 + 3] !== 0) {
          seen[q] = 1
          stack.push(q)
        }
      }
      if (py > 0) {
        const q = p - w
        if (seen[q] === 0 && data[q * 4 + 3] !== 0) {
          seen[q] = 1
          stack.push(q)
        }
      }
    }
    sizes.push(n)
  }
  return sizes
}

function oldMeanRgb(m: RawImage): [number, number, number] {
  let r = 0,
    g = 0,
    b = 0,
    n = 0
  for (let i = 0; i < m.data.length; i += 4) {
    r += m.data[i]!
    g += m.data[i + 1]!
    b += m.data[i + 2]!
    n++
  }
  return n === 0 ? [0, 0, 0] : [r / n, g / n, b / n]
}

function oldStripMean(
  img: RawImage,
  axis: 'x' | 'y',
  from: number,
  width: number,
): [number, number, number] {
  let r = 0,
    g = 0,
    b = 0,
    n = 0
  const outer = axis === 'x' ? img.height : img.width
  for (let o = 0; o < outer; o++) {
    for (let d = from; d < from + width; d++) {
      const i = (axis === 'x' ? o * img.width + d : d * img.width + o) * 4
      r += img.data[i]!
      g += img.data[i + 1]!
      b += img.data[i + 2]!
      n++
    }
  }
  return n === 0 ? [0, 0, 0] : [r / n, g / n, b / n]
}

/** The per-channel closure that used to sit inside `seasonTintFrom`. */
function oldSeasonMean(m: RawImage, k: number): number {
  let s = 0,
    n = 0
  for (let i = 0; i < m.data.length; i += 4) {
    s += m.data[i + k]!
    n++
  }
  return n === 0 ? 1 : Math.max(1, s / n)
}

const oldSeasonTintFrom = (
  seasonMat: RawImage,
  summerMat: RawImage,
): { r: number; g: number; b: number } => {
  const ratio = (k: number): number =>
    Math.min(1.6, Math.max(0.6, oldSeasonMean(seasonMat, k) / oldSeasonMean(summerMat, k)))
  return { r: ratio(0), g: ratio(1), b: ratio(2) }
}

// ---------------------------------------------------------------- the proofs

describe('★ one flood fill, three callers', () => {
  it.each(ALPHA_SAMPLES)('despeckle is pixel-identical on %s', async (name) => {
    const img = await fixture(name)
    for (const min of [3, 40]) {
      const now = despeckle(img, min),
        before = oldDespeckle(img, min)
      expect(now.width).toBe(before.width)
      expect(now.height).toBe(before.height)
      expect(Buffer.from(now.data)).toEqual(Buffer.from(before.data))
    }
  })

  it.each(ALPHA_SAMPLES)('countIslands is identical on %s', async (name) => {
    const img = await fixture(name)
    expect(countIslands(img)).toBe(oldCountIslands(img))
  })

  it.each(ALPHA_SAMPLES)('soleSilhouetteGate reads the same islands on %s', async (name) => {
    const img = await fixture(name)
    const sizes = oldSilhouetteSizes(img)
    const total = sizes.reduce((s, n) => s + n, 0)
    const body = sizes.length === 0 ? 0 : Math.max(...sizes)
    const g = soleSilhouetteGate(img)
    expect(g.islands).toBe(sizes.length)
    expect(g.detachedFraction).toBe(total === 0 ? 0 : (total - body) / total)
  })

  it('all three agree with each other on one image, which is why one fill serves them', async () => {
    const img = await fixture('character-v1/idle-se.png')
    expect(soleSilhouetteGate(img).islands).toBe(countIslands(img))
  })
})

describe('★ one mean-RGB accumulator, four callers', () => {
  it.each([...ALPHA_SAMPLES, ...OPAQUE_SAMPLES])(
    'materialMean over the whole image is identical on %s',
    async (name) => {
      const img = await fixture(name)
      expect(materialMean(img)).toEqual(oldMeanRgb(img))
    },
  )

  it.each(OPAQUE_SAMPLES)('the windowed mean matches the old edge strips on %s', async (name) => {
    const m = await fixture(name)
    for (const strip of [1, 3]) {
      expect(materialMean(m, { x: 0, y: 0, w: strip, h: m.height })).toEqual(
        oldStripMean(m, 'x', 0, strip),
      )
      expect(materialMean(m, { x: m.width - strip, y: 0, w: strip, h: m.height })).toEqual(
        oldStripMean(m, 'x', m.width - strip, strip),
      )
      expect(materialMean(m, { x: 0, y: 0, w: m.width, h: strip })).toEqual(
        oldStripMean(m, 'y', 0, strip),
      )
      expect(materialMean(m, { x: 0, y: m.height - strip, w: m.width, h: strip })).toEqual(
        oldStripMean(m, 'y', m.height - strip, strip),
      )
    }
  })

  it('seamReport still reads the same deltas off a real material', async () => {
    const m = await fixture('pixel-gates/floor-512.png')
    const strip = 3
    const toneDelta = (a: [number, number, number], b: [number, number, number]): number =>
      [0, 1, 2].reduce((s, k) => s + Math.abs(a[k]! - b[k]!), 0) / 3
    const r = seamReport(m)
    expect(r.horizontalDelta).toBe(
      toneDelta(oldStripMean(m, 'x', 0, strip), oldStripMean(m, 'x', m.width - strip, strip)),
    )
    expect(r.verticalDelta).toBe(
      toneDelta(oldStripMean(m, 'y', 0, strip), oldStripMean(m, 'y', m.height - strip, strip)),
    )
  })

  it('seasonTintFrom returns the same three ratios', async () => {
    const [a, b] = await Promise.all([
      fixture('pixel-gates/floor-512.png'),
      fixture('pixel-gates/rejected-farmland_0.png'),
    ])
    expect(seasonTintFrom(a, b)).toEqual(oldSeasonTintFrom(a, b))
    expect(seasonTintFrom(b, a)).toEqual(oldSeasonTintFrom(b, a))
    expect(seasonTintFrom(a, a)).toEqual(oldSeasonTintFrom(a, a))
  })
})

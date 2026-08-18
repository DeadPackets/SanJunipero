import { describe, it, expect } from 'vitest'
import {
  CHECKER_GUIDE_SIZE, STRIP_GUIDE_W, STRIP_GUIDE_H, STRIP_GUIDE_SLOTS,
  renderCheckerGuide, renderStripFrameGuide,
} from './guides.js'

const bytes = (a: Uint8ClampedArray): Buffer => Buffer.from(a.buffer, a.byteOffset, a.byteLength)

describe('renderCheckerGuide', () => {
  const g = renderCheckerGuide()
  it('is a 1024×1024 fully opaque image', () => {
    expect(CHECKER_GUIDE_SIZE).toBe(1024)
    expect(g.width).toBe(1024)
    expect(g.height).toBe(1024)
    for (const i of [3, g.data.length - 1]) expect(g.data[i]).toBe(255)
  })
  it('alternates black/white per pixel in both axes', () => {
    const lum = (x: number, y: number) => g.data[(y * g.width + x) * 4]!
    expect(lum(0, 0)).toBe(255)
    expect(lum(1, 0)).toBe(0)
    expect(lum(0, 1)).toBe(0)
    expect(lum(1, 1)).toBe(255)
    expect(lum(511, 512)).not.toBe(lum(512, 512))
  })
  // 1 s, not the 5 s default: vitest's structural toEqual walked all 4,194,304 bytes and took
  // ~3.4 s idle, so under a loaded batch it crossed the default and failed as a timeout.
  it('is deterministic', { timeout: 1000 }, () => {
    expect(bytes(renderCheckerGuide().data).equals(bytes(g.data))).toBe(true)
  })
})

describe('renderStripFrameGuide', () => {
  const g = renderStripFrameGuide()
  it('has the declared 1×5 geometry', () => {
    expect(STRIP_GUIDE_SLOTS).toBe(5)
    expect(g.width).toBe(STRIP_GUIDE_W)
    expect(g.height).toBe(STRIP_GUIDE_H)
    expect(STRIP_GUIDE_W).toBe(STRIP_GUIDE_H * STRIP_GUIDE_SLOTS)
  })
  it('is solid magenta outside the frame boxes', () => {
    const px = (x: number, y: number) => [...g.data.subarray((y * g.width + x) * 4, (y * g.width + x) * 4 + 4)]
    expect(px(0, 0)).toEqual([255, 0, 255, 255])
    expect(px(g.width - 1, g.height - 1)).toEqual([255, 0, 255, 255])
  })
  it('draws exactly 5 outlined boxes (10 vertical edges on the center row)', () => {
    const y = Math.floor(g.height / 2)
    let runs = 0, inRun = false
    for (let x = 0; x < g.width; x++) {
      const i = (y * g.width + x) * 4
      const dark = g.data[i]! < 128 && g.data[i + 2]! < 128
      if (dark && !inRun) runs++
      inRun = dark
    }
    expect(runs).toBe(10)
  })
  it('box interiors stay magenta so the figure area reads as chroma background', () => {
    const cx = Math.floor(STRIP_GUIDE_H / 2) // center of slot 0
    const i = (Math.floor(g.height / 2) * g.width + cx) * 4
    expect([g.data[i], g.data[i + 1], g.data[i + 2]]).toEqual([255, 0, 255])
  })
})

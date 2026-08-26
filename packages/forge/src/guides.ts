import type { RawImage } from './post/raw.js'

// Deterministic grid-guide reference images, appended to a generation as extra input_references.

export const CHECKER_GUIDE_SIZE = 1024

// 1×1 px black/white checkerboard: a maximal-frequency lattice cue for big-pixel output.
export function renderCheckerGuide(): RawImage {
  const s = CHECKER_GUIDE_SIZE
  const data = new Uint8ClampedArray(s * s * 4)
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const v = (x + y) % 2 === 0 ? 255 : 0
    data.set([v, v, v, 255], (y * s + x) * 4)
  }
  return { width: s, height: s, data }
}

export const STRIP_GUIDE_SLOTS = 5
export const STRIP_GUIDE_H = 256
export const STRIP_GUIDE_W = STRIP_GUIDE_H * STRIP_GUIDE_SLOTS

const STRIP_GUIDE_INSET = 8
const STRIP_GUIDE_LINE = 4

// Five outlined frame boxes on solid magenta: one slot per walk phase, interiors
// left magenta so the figure area still reads as chroma background.
export function renderStripFrameGuide(): RawImage {
  const w = STRIP_GUIDE_W, h = STRIP_GUIDE_H
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) data.set([255, 0, 255, 255], i * 4)
  const dark = [0x43, 0x39, 0x4a, 255] // style-bible shadow dark
  for (let slot = 0; slot < STRIP_GUIDE_SLOTS; slot++) {
    const x0 = slot * STRIP_GUIDE_H + STRIP_GUIDE_INSET, x1 = (slot + 1) * STRIP_GUIDE_H - 1 - STRIP_GUIDE_INSET
    const y0 = STRIP_GUIDE_INSET, y1 = h - 1 - STRIP_GUIDE_INSET
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const onEdge = x - x0 < STRIP_GUIDE_LINE || x1 - x < STRIP_GUIDE_LINE
        || y - y0 < STRIP_GUIDE_LINE || y1 - y < STRIP_GUIDE_LINE
      if (onEdge) data.set(dark, (y * w + x) * 4)
    }
  }
  return { width: w, height: h, data }
}

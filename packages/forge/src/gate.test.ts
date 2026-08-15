import { describe, it, expect } from 'vitest'
import { mechanicalGate } from './gate.js'
import { paletteRgb } from './palette.js'

const pal = paletteRgb()
function img(w: number, h: number, fill: [number, number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) data.set(fill, i * 4)
  return { width: w, height: h, data }
}

describe('mechanicalGate', () => {
  it('passes a compliant sprite (palette colors + transparent pixel present)', () => {
    const i = img(2, 2, [...pal[0]!, 255] as [number, number, number, number])
    i.data[3] = 0; i.data[0] = 0; i.data[1] = 0; i.data[2] = 0
    expect(mechanicalGate(i, { w: 2, h: 2, requireAlpha: true })).toEqual({ ok: true, failures: [] })
  })
  it('fails on wrong size', () => {
    const r = mechanicalGate(img(2, 2, [...pal[0]!, 255] as never), { w: 4, h: 4, requireAlpha: false })
    expect(r.ok).toBe(false)
    expect(r.failures.join()).toMatch(/size/)
  })
  it('fails when alpha is required but absent (chroma-key found no background)', () => {
    const r = mechanicalGate(img(2, 2, [...pal[0]!, 255] as never), { w: 2, h: 2, requireAlpha: true })
    expect(r.failures.join()).toMatch(/alpha/)
  })
  it('fails on any off-palette opaque pixel', () => {
    const r = mechanicalGate(img(1, 1, [1, 2, 3, 255]), { w: 1, h: 1, requireAlpha: false })
    expect(r.failures.join()).toMatch(/palette/)
  })
})

import { describe, it, expect } from 'vitest'
import { outlinePass } from './outline.js'
import { makeQuantizer } from './quantize.js'
import { paletteRgb } from '../palette.js'
import { OUTLINE_DARKEN } from '../palette.js'

const HONEY = [0xf2, 0xc8, 0x79] as const

function block3x3(): { width: number; height: number; data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(9 * 4)
  for (let i = 0; i < 9; i++) data.set([...HONEY, 255], i * 4)
  return { width: 3, height: 3, data }
}

describe('outlinePass', () => {
  it('recolors border pixels to the darkened-local-color palette snap; center untouched', () => {
    const out = outlinePass(block3x3())
    // expected snap computed the same way production does — dark shade of honey wood
    const pal = paletteRgb()
    const dark = HONEY.map(c => Math.round(c * OUTLINE_DARKEN)) as [number, number, number]
    const expected = pal[makeQuantizer(pal).nearest(...dark)]!
    expect([...out.data.slice(0, 3)]).toEqual(expected)          // corner = edge
    expect([...out.data.slice(0, 3)]).not.toEqual([...HONEY])    // actually changed
    const center = 4 * 4
    expect([...out.data.slice(center, center + 3)]).toEqual([...HONEY]) // interior kept
  })
  it('pixels adjacent to transparent neighbors are outlined even inside the canvas', () => {
    const img = block3x3()
    img.data[4 * 4 + 3] = 0 // punch a transparent hole in the center
    const out = outlinePass(img)
    const top = 1 * 4        // pixel (1,0) borders the transparent center (1,1) below it
    expect(out.data[top + 3]).toBe(255)
    expect([...out.data.slice(top, top + 3)]).not.toEqual([...HONEY])
  })
  it('does not mutate its input and leaves transparent pixels transparent', () => {
    const img = block3x3()
    img.data[3] = 0
    const before = new Uint8ClampedArray(img.data)
    const out = outlinePass(img)
    expect(img.data).toEqual(before)
    expect(out.data[3]).toBe(0)
  })
})

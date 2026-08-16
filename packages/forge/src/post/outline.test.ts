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

function block5x5(): { width: number; height: number; data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(25 * 4)
  for (let i = 0; i < 25; i++) data.set([...HONEY, 255], i * 4)
  return { width: 5, height: 5, data }
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
    const img = block5x5()
    img.data[(2 * 5 + 2) * 4 + 3] = 0 // transparent hole at (2,2), in-canvas
    const out = outlinePass(img)
    const probe = (1 * 5 + 2) * 4  // pixel (2,1); its only transparent 4-neighbor is the hole
    expect(out.data[probe + 3]).toBe(255)
    expect([...out.data.slice(probe, probe + 3)]).not.toEqual([...HONEY])
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

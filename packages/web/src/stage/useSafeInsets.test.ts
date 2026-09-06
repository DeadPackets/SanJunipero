import { describe, expect, it } from 'vitest'
import { BOTTOM_BAND, TOP_BAND, insetsOf } from './useSafeInsets.js'

describe('★ the chrome bands a bubble keeps out of', () => {
  const canvas = { top: 100, bottom: 900, height: 800 }

  it('reaches from the canvas edge to the far side of the deepest mark in each band', () => {
    const tops = [
      { top: 110, bottom: 170, height: 60 },
      { top: 180, bottom: 196, height: 16 },
    ]
    const bottoms = [{ top: 850, bottom: 880, height: 30 }]
    expect(insetsOf(canvas, tops, bottoms)).toEqual({ top: 96, bottom: 50 })
  })

  it('lets an empty mark reserve nothing, and never reserves more than the canvas', () => {
    expect(insetsOf(canvas, [{ top: 110, bottom: 110, height: 0 }], [])).toEqual({
      top: 0,
      bottom: 0,
    })
    expect(insetsOf(canvas, [{ top: 0, bottom: 2000, height: 2000 }], []).top).toBe(800)
  })

  it('names the marks the sheet draws at the two edges', () => {
    expect(TOP_BAND).toEqual(['.sky-bar', '.stage-stamp'])
    expect(BOTTOM_BAND).toEqual(['.stage-cue', '.lower-third'])
  })
})

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
    expect(TOP_BAND).toEqual(['.day-bar', '.signpost', '.stage-exit', '.stage-live'])
    expect(BOTTOM_BAND).toEqual(['.stage-cue', '.lower-third'])
  })

  // ★ The way out of a room and the way back to now are the row under the band, and the frame
  // moved them there without telling the canvas: 44px of chrome the world kept no body out of.
  it('★ keeps a body out from behind the two buttons in the row under the band', () => {
    const bar = { top: 100, bottom: 156, height: 56 }
    const exit = { top: 162, bottom: 206, height: 44 }
    expect(insetsOf(canvas, [bar, exit], []).top, 'the button is chrome too').toBe(106)
  })

  // ★ The arms take the top-left corner below 1001px wide or 621px tall and the bottom-right
  // one otherwise. Listed for the top band and standing at the bottom, they claimed 190px of
  // the picture; listed for neither, they claimed nothing at the size where they own the edge.
  it('★ reserves a band for the arms only at the edge they are actually standing at', () => {
    const arms = { top: 130, bottom: 218, height: 88 }
    expect(insetsOf(canvas, [arms], []).top, 'the arms own the top edge here').toBe(118)
    const corner = { top: 700, bottom: 876, height: 176 }
    expect(insetsOf(canvas, [corner], []).top, 'the arms in the corner claim the top').toBe(0)
  })
})

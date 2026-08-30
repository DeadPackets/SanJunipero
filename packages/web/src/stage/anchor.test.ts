import { describe, expect, it } from 'vitest'
import { keepOnStage, screenAnchor } from './anchor.js'

const VIEW = { x: -100, y: -50, w: 800, h: 600 }

describe('a mark stands where the town does', () => {
  it('puts the view origin at the stage origin, whatever the camera is on', () => {
    expect(screenAnchor(VIEW, 1, -100, -50)).toEqual({ x: 0, y: 0, onScreen: true })
  })

  it('multiplies by the zoom the world is drawn at', () => {
    expect(screenAnchor(VIEW, 2, -50, -50).x).toBe(100)
    expect(screenAnchor(VIEW, 0.5, 100, -50).x).toBe(100)
  })

  it('lands on whole pixels, so a plate never sits between two of them', () => {
    const a = screenAnchor(VIEW, 3, 10.4, 20.7)
    expect(Number.isInteger(a.x)).toBe(true)
    expect(Number.isInteger(a.y)).toBe(true)
  })

  it('says when the camera cannot see it, on every edge', () => {
    expect(screenAnchor(VIEW, 1, 350, 250).onScreen).toBe(true)
    expect(screenAnchor(VIEW, 1, -101, 250).onScreen).toBe(false)
    expect(screenAnchor(VIEW, 1, 701, 250).onScreen).toBe(false)
    expect(screenAnchor(VIEW, 1, 350, -51).onScreen).toBe(false)
    expect(screenAnchor(VIEW, 1, 350, 551).onScreen).toBe(false)
  })
})

// The ring is 124px across with an arm hung off each side, so a figure at x = 20 put its "Home"
// arm at x = -55: off-screen, and the one thing on it nobody could reach.
describe('a mark wider than the body it hangs off stays on the stage', () => {
  const REACH = { x: 100, y: 110 }
  const on = { onScreen: true }

  it('leaves a mark with room to spare exactly where it stands', () => {
    expect(keepOnStage({ x: 400, y: 300, ...on }, 800, 600, REACH)).toEqual({
      x: 400,
      y: 300,
      ...on,
    })
  })

  it('slides it in far enough to stay whole, and no further', () => {
    expect(keepOnStage({ x: 20, y: 300, ...on }, 800, 600, REACH).x).toBe(100)
    expect(keepOnStage({ x: 780, y: 300, ...on }, 800, 600, REACH).x).toBe(700)
    expect(keepOnStage({ x: 400, y: 4, ...on }, 800, 600, REACH).y).toBe(110)
    expect(keepOnStage({ x: 400, y: 596, ...on }, 800, 600, REACH).y).toBe(490)
  })

  // A stage narrower than the mark has no honest answer; the middle is the least bad one.
  it('centres it when the stage is smaller than the mark', () => {
    expect(keepOnStage({ x: 10, y: 10, ...on }, 120, 100, REACH)).toEqual({ x: 60, y: 50, ...on })
  })
})

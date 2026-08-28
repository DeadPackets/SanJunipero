import { describe, expect, it } from 'vitest'
import { screenAnchor } from './anchor.js'

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

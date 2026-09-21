// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import type { Scene } from '../render/scene.js'
import { keepOnStage, screenAnchor, useSubjectAnchor } from './anchor.js'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

it('keeps the ring arms beside the dock and follows inset changes without a render', async () => {
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
  vi.stubGlobal('cancelAnimationFrame', () => {})
  const scene = {
    viewRect: () => ({ x: -100, y: -50, w: 720, h: 450 }),
    getZoom: () => 2,
    pointOf: () => ({ sx: 350, sy: 175 }),
    safeInsets: { top: 140, bottom: 82, right: 504 },
  } as unknown as Scene
  function Probe() {
    const ref = useSubjectAnchor(
      scene,
      { id: 'dilara', kind: 'agent', name: 'Dilara' },
      {
        x: 145,
        y: 150,
      },
    )
    return createElement('div', { ref })
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => {
      root.render(createElement(Probe))
    })
    frames.shift()!(0)
    const ring = host.firstElementChild as HTMLElement
    expect(ring.style.transform).toBe('translate(791px, 450px)')
    expect(ring.style.visibility).toBe('visible')
    scene.safeInsets = { top: 140, bottom: 82, right: 0 }
    frames.shift()!(16)
    expect(ring.style.transform).toBe('translate(900px, 450px)')
    scene.safeInsets = { top: 400, bottom: 82, right: 504 }
    frames.shift()!(32)
    expect(ring.style.transform).toBe('translate(791px, 550px)')
  } finally {
    await act(async () => {
      root.unmount()
    })
    host.remove()
    vi.unstubAllGlobals()
  }
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

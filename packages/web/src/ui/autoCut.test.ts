import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDLE_HANDBACK_MS, director } from './autoCut.js'
import { DIRECTOR_ZOOM, DIRECTOR_ZOOM_WIDE, WIDE_VIEWPORT_PX, directorZoom } from './DirectorMode.js'

const src = (f: string): string => readFileSync(new URL(f, import.meta.url), 'utf8')

afterEach(() => {
  vi.useRealTimers()
})

// ★ The owner's 2026-08-28 pick — auto-director by default — reached the broadcast frame and
// never the desk, so a viewer at a laptop watched one static overview of a town.
describe('★ the camera goes to the story by itself, for every viewer', () => {
  const APP = src('../App.tsx')

  it('★ is armed by nothing at all: the desk gets the same director the stream does', () => {
    expect(APP).toContain('useAutoCut()')
    expect(APP).not.toContain('useAutoCut(route.broadcast)')
  })

  it('keeps ONE hand on it: the D key', () => {
    expect(APP).toContain('onDirector: toggleDirector')
  })
})

describe('★ the director hands back twenty seconds after the last input', () => {
  const armed = (): { target: EventTarget; d: ReturnType<typeof director>; off: () => void } => {
    const target = new EventTarget()
    const d = director(target)
    return { target, d, off: d.subscribe(() => {}) }
  }

  it('★ cuts before anybody has touched anything', () => {
    const { d, off } = armed()
    expect(d.get()).toBe(true)
    off()
  })

  it('★ a pan, a zoom or a click suspends it', () => {
    vi.useFakeTimers()
    for (const kind of ['pointerdown', 'keydown', 'wheel']) {
      const { target, d, off } = armed()
      target.dispatchEvent(new Event(kind))
      expect(d.get(), kind).toBe(false)
      off()
    }
  })

  it('★ takes the camera back exactly IDLE_HANDBACK_MS after the LAST input', () => {
    vi.useFakeTimers()
    const { target, d, off } = armed()
    expect(IDLE_HANDBACK_MS).toBe(20_000)
    target.dispatchEvent(new Event('wheel'))
    vi.advanceTimersByTime(IDLE_HANDBACK_MS - 1)
    expect(d.get()).toBe(false)
    target.dispatchEvent(new Event('wheel')) // the clock restarts on the second hand
    vi.advanceTimersByTime(IDLE_HANDBACK_MS - 1)
    expect(d.get()).toBe(false)
    vi.advanceTimersByTime(1)
    expect(d.get()).toBe(true)
    off()
  })

  it('publishes each change once, so a keystroke is not a re-render', () => {
    vi.useFakeTimers()
    const target = new EventTarget()
    const d = director(target)
    const seen = vi.fn()
    const off = d.subscribe(seen)
    target.dispatchEvent(new Event('keydown'))
    target.dispatchEvent(new Event('keydown'))
    target.dispatchEvent(new Event('keydown'))
    expect(seen).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(IDLE_HANDBACK_MS)
    expect(seen).toHaveBeenCalledTimes(2)
    off()
  })

  it('★ what the D key switched off stays off, however long the viewer sits still', () => {
    vi.useFakeTimers()
    const { target, d, off } = armed()
    d.toggle()
    expect(d.get()).toBe(false)
    target.dispatchEvent(new Event('pointerdown'))
    vi.advanceTimersByTime(IDLE_HANDBACK_MS * 3)
    expect(d.get()).toBe(false)
    d.toggle()
    expect(d.get()).toBe(true)
    off()
  })

  it('lets the window go: the last unsubscribe takes every listener and the timer with it', () => {
    vi.useFakeTimers()
    const { target, d, off } = armed()
    target.dispatchEvent(new Event('wheel'))
    off()
    target.dispatchEvent(new Event('wheel'))
    vi.advanceTimersByTime(IDLE_HANDBACK_MS * 2)
    expect(vi.getTimerCount()).toBe(0)
    expect(d.get()).toBe(false) // nobody is watching; nothing was published
  })
})

// ★ At 3× a 1440-wide screen frames one body 156px tall, and a two-person exchange — the one
// thing the director exists to find — cannot fit in the shot it cuts to.
describe('★ two speakers fit in the frame on a wide screen', () => {
  it('★ opens to 2× at 1280 and wider', () => {
    expect(WIDE_VIEWPORT_PX).toBe(1280)
    expect(directorZoom(WIDE_VIEWPORT_PX)).toBe(DIRECTOR_ZOOM_WIDE)
    expect(directorZoom(1440)).toBe(2)
    expect(directorZoom(2560)).toBe(2)
  })

  it('keeps the closer stop where a wider one would give the face away', () => {
    expect(directorZoom(WIDE_VIEWPORT_PX - 1)).toBe(DIRECTOR_ZOOM)
    expect(directorZoom(390)).toBe(3)
  })
})

// ★ The first cut of a round skipped the minimum, so arming the director yanked the camera the
// instant the heat landed — and toggling it off and on again did it every time.
describe('★ the first cut is a cut like any other', () => {
  const SRC = src('./DirectorMode.tsx')

  it('★ spends no bypass on it', () => {
    expect(SRC).not.toContain('const first =')
    expect(SRC).toContain('now - lastCutRef.current >= CUT_MIN_MS')
  })

  it('leaves the zoom to the camera, which already eases every stop it is given', () => {
    expect(SRC).toContain('scene.setZoom(directorZoom(')
    expect(src('../render/camera.ts')).toContain('easeOutCubic(t)')
  })
})

// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  document.body.replaceChildren()
  vi.useRealTimers()
})

it.each([false, true])(
  'restores prior root inert=%s after loading without blocking the loading card',
  async (inert) => {
    vi.resetModules()
    vi.useFakeTimers()
    const { detachFirstFrame, dismissFirstFrame } = await import('./firstFrame.js')
    document.body.innerHTML =
      '<div id="root"><div id="first-frame"><button>Retry</button></div></div>'
    const root = document.getElementById('root')
    if (!root) throw new Error('missing root')
    root.inert = inert
    detachFirstFrame()
    expect(root.inert).toBe(true)
    expect(document.getElementById('first-frame')?.parentElement).toBe(document.body)
    dismissFirstFrame()
    expect(root.inert).toBe(inert)
    vi.runAllTimers()
    expect(document.getElementById('first-frame')).toBeNull()
  },
)

it('does not release the town when loading cannot finish', async () => {
  vi.resetModules()
  const { detachFirstFrame, firstFrameStuck, dismissFirstFrame } = await import('./firstFrame.js')
  document.body.innerHTML = '<div id="root"><div id="first-frame"></div></div>'
  detachFirstFrame()
  firstFrameStuck('Unable to draw')
  dismissFirstFrame()
  expect(document.getElementById('root')?.inert).toBe(true)
})

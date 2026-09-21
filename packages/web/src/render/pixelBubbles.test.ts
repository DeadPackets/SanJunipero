// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import type { Scene } from './scene.js'
import type { WorldStore } from '../state/worldStore.js'
import { createPixelBubbles } from './pixelBubbles.js'
vi.mock('./agentAnchor.js', () => ({ agentScreenAnchor: () => ({ x: 200, y: 200, footY: 250 }) }))
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

it.each([true, false])(
  'replaces stale speech and measures before entrance animation (reduced motion: %s)',
  (reduced) => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    )
    vi.stubGlobal('matchMedia', () => ({ matches: reduced }))
    Object.defineProperty(document, 'fonts', { configurable: true, value: new EventTarget() })
    Object.defineProperty(Element.prototype, 'getAnimations', {
      configurable: true,
      value: () => [],
    })
    const root = document.createElement('div')
    const canvas = document.createElement('canvas')
    root.append(canvas)
    document.body.append(root)
    const scene = { app: { canvas, screen: { width: 600 } }, getZoom: () => 1 } as unknown as Scene
    const store = {
      getTick: () => 1,
      getMode: () => ({ live: true }),
      timeMoving: () => true,
      onEvents: () => () => {},
      openScenes: () => [],
      shotScene: () => null,
      getState: () => ({ agents: { amara: { name: 'Amara' } } }),
    } as unknown as WorldStore
    const bubbles = createPixelBubbles(scene, store)
    const balloon = root.querySelector<HTMLElement>('.pixel-balloon')!
    const animate = vi.fn()
    Object.defineProperty(balloon, 'animate', { configurable: true, value: animate })
    const width = vi.spyOn(balloon, 'offsetWidth', 'get').mockReturnValue(220)
    const height = vi.spyOn(balloon, 'offsetHeight', 'get').mockReturnValue(60)
    bubbles.spawnSpeech('amara', 'First words which should not linger behind new speech.')
    bubbles.tick(100)
    if (!reduced)
      expect(width.mock.invocationCallOrder[0]).toBeLessThan(animate.mock.invocationCallOrder[0]!)
    expect(root.querySelector('p')?.textContent).toContain('First words')
    bubbles.tick(116)
    bubbles.tick(132)
    expect(width).toHaveBeenCalledTimes(1)
    expect(height).toHaveBeenCalledTimes(1)
    bubbles.spawnSpeech('amara', 'The current answer.')
    bubbles.tick(148)
    expect(root.querySelector('p')?.textContent).not.toContain('First words')
    expect(root.querySelector('p')?.textContent).toContain('The current answer.')
    expect(width).toHaveBeenCalledTimes(2)
    bubbles.tick(448)
    expect(root.querySelector('p > span:last-child')?.textContent).toBe('The current answer.')
    bubbles.destroy()
  },
)

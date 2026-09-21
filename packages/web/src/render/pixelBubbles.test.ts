// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import type { Scene } from './scene.js'
import type { WorldStore, TownScene } from '../state/worldStore.js'
import { createPixelBubbles } from './pixelBubbles.js'
vi.mock('./agentAnchor.js', () => ({
  agentScreenAnchor: (_s: unknown, _w: unknown, id: string) =>
    id === 'outside' ? null : { x: 200, y: 200, footY: 250 },
}))
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})
function setup(reduced = true) {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  vi.stubGlobal('matchMedia', () => ({ matches: reduced }))
  Object.defineProperty(document, 'fonts', { configurable: true, value: new EventTarget() })
  Object.defineProperty(Element.prototype, 'getAnimations', { configurable: true, value: () => [] })
  const root = document.createElement('div'),
    canvas = document.createElement('canvas')
  root.append(canvas)
  document.body.append(root)
  const scene = { app: { canvas, screen: { width: 600 } }, getZoom: () => 1 } as unknown as Scene
  let revision = 0
  let tick = 1,
    moving = true,
    shot: TownScene | null = null
  let open: TownScene[] = []
  const store = {
    getTick: () => tick,
    viewSeq: () => revision,
    getMode: () => ({ live: true }),
    timeMoving: () => moving,
    onEvents: () => () => {},
    openScenes: () => open,
    shotScene: () => shot,
    getState: () => ({ agents: { amara: { name: 'Amara' }, halim: { name: 'Halim' } } }),
  } as unknown as WorldStore
  const bubbles = createPixelBubbles(scene, store)
  const balloon = root.querySelector<HTMLElement>('.pixel-balloon')!
  const animate = vi.fn()
  Object.defineProperty(balloon, 'animate', { configurable: true, value: animate })
  const width = vi.spyOn(balloon, 'offsetWidth', 'get').mockReturnValue(220)
  const height = vi.spyOn(balloon, 'offsetHeight', 'get').mockReturnValue(60)
  return {
    root,
    scene,
    bubbles,
    width,
    height,
    animate,
    text: () => root.querySelector('.pixel-reserved')?.textContent,
    focus: () => {
      shot = { id: 'talk', open: true, participants: ['amara', 'halim'] } as TownScene
      open = [shot]
    },
    outsideShot: () => {
      shot = { id: 'elsewhere', open: true, participants: ['outside'] } as TownScene
    },
    close: () => {
      open = []
      shot = null
    },
    forward: () => {
      revision++
      tick = 300
    },
    seek: () => {
      tick = 0
    },
    pause: () => {
      moving = false
    },
  }
}
it.each([true, false])(
  'gives speech a reading window before handoff (reduced motion: %s)',
  (reduced) => {
    const { root, bubbles, width, height, animate, text } = setup(reduced)
    bubbles.spawnSpeech('amara', 'First words which should not vanish behind new speech.')
    bubbles.tick(100)
    if (!reduced)
      expect(width.mock.invocationCallOrder[0]).toBeLessThan(animate.mock.invocationCallOrder[0]!)
    bubbles.tick(116)
    bubbles.tick(132)
    expect(width).toHaveBeenCalledTimes(1)
    expect(height).toHaveBeenCalledTimes(1)
    bubbles.spawnSpeech('halim', 'The current answer.')
    bubbles.tick(148)
    expect(text()).toContain('First words')
    bubbles.tick(4000)
    expect(text()).toBe('The current answer.')
    expect(width).toHaveBeenCalledTimes(2)
    bubbles.tick(4300)
    expect(root.querySelector('p > span:last-child')?.textContent).toBe('The current answer.')
    bubbles.destroy()
  },
)
it('rejects unrelated ambient speech during a focused conversation', () => {
  const { bubbles, text, focus } = setup()
  focus()
  bubbles.spawnSpeech('amara', 'Let us talk.')
  bubbles.tick(0)
  bubbles.spawnSpeech('omar', 'Unrelated words.')
  bubbles.tick(5000)
  expect(text()).toBe('Let us talk.')
})
it('bounds a burst to the latest two waiting lines without interrupting the current one', () => {
  const { bubbles, text } = setup()
  bubbles.spawnSpeech('amara', 'First.')
  bubbles.tick(0)
  for (const word of ['Second.', 'Third.', 'Fourth.']) bubbles.spawnSpeech('halim', word)
  bubbles.tick(100)
  expect(text()).toBe('First.')
  bubbles.tick(1500)
  expect(text()).toBe('Third.')
  bubbles.tick(3000)
  expect(text()).toBe('Fourth.')
})
it('finishes a queued goodbye after natural close but clears on a seek', () => {
  const { bubbles, root, text, focus, close, seek } = setup()
  focus()
  bubbles.spawnSpeech('amara', 'First.')
  bubbles.tick(0)
  bubbles.spawnSpeech('halim', 'Queued.')
  close()
  bubbles.tick(1600)
  expect(text()).toBe('Queued.')
  seek()
  bubbles.tick(1700)
  expect(root.querySelector<HTMLElement>('.pixel-speech-layer')?.hidden).toBe(true)
})
it('lets speech replace a thought immediately', () => {
  const { bubbles, text } = setup()
  bubbles.spawnThought('amara', 'Private pause.')
  bubbles.tick(0)
  bubbles.spawnSpeech('halim', 'Hello.')
  bubbles.tick(10)
  expect(text()).toBe('Hello.')
})

it('clears old speech on a forward replay jump', () => {
  const { bubbles, root, forward } = setup()
  bubbles.spawnSpeech('amara', 'Old words.')
  bubbles.tick(0)
  forward()
  bubbles.tick(100)
  expect(root.querySelector<HTMLElement>('.pixel-speech-layer')?.hidden).toBe(true)
})
it('keeps the current words readable while paused', () => {
  const { bubbles, root, pause, text } = setup()
  bubbles.spawnSpeech('amara', 'Stay for a moment.')
  bubbles.tick(0)
  pause()
  bubbles.tick(30000)
  expect(text()).toBe('Stay for a moment.')
  expect(root.querySelector<HTMLElement>('.pixel-speech-layer')?.hidden).toBe(false)
})
it('removes a standalone bubble when the camera selects a conversation', () => {
  const { bubbles, root, focus } = setup()
  bubbles.spawnSpeech('omar', 'Elsewhere.')
  bubbles.tick(0)
  focus()
  bubbles.tick(100)
  expect(root.querySelector<HTMLElement>('.pixel-speech-layer')?.hidden).toBe(true)
})

it('keeps the visible indoor conversation when the director cuts outside', () => {
  const { bubbles, scene, focus, outsideShot, text } = setup()
  scene.interior = { isActive: () => true, activeId: () => 'home' } as NonNullable<
    Scene['interior']
  >
  focus()
  bubbles.tick(0)
  outsideShot()
  bubbles.spawnSpeech('amara', 'Here in the room.')
  bubbles.tick(100)
  expect(text()).toBe('Here in the room.')
})

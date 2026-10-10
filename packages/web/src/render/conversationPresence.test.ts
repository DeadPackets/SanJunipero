// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import type { WorldStore, TownScene } from '../state/worldStore.js'
import type { Scene } from './scene.js'
import { createConversationPresence } from './conversationPresence.js'
vi.mock('./agentAnchor.js', () => ({
  agentScreenAnchor: (_s: unknown, _w: unknown, id: string) =>
    id === 'hidden' ? null : { x: id === 'amara' ? 200 : 320, y: 200, footY: 250 },
}))
afterEach(() => {
  document.body.replaceChildren()
})
function setup() {
  const parent = document.createElement('div'),
    canvas = document.createElement('canvas')
  parent.append(canvas)
  document.body.append(parent)
  let open = true,
    tick = 1,
    moving = true,
    live = true
  const talk = { id: 'talk', participants: ['amara', 'halim'], open: true } as TownScene
  const scene = {
    app: { canvas, screen: { width: 800, height: 600 } },
    safeInsets: { top: 60, right: 300, bottom: 50 },
  } as Scene
  const store = {
    getTick: () => tick,
    viewSeq: () => 0,
    getMode: () => ({ live }),
    timeMoving: () => moving,
    openScenes: () => (open ? [talk] : []),
    shotScene: () => (open ? talk : null),
    getState: () => ({ agents: { amara: { name: 'Amara' }, halim: { name: 'Halim' } } }),
  } as unknown as WorldStore
  const layer = createConversationPresence(scene, store)
  return {
    parent,
    layer,
    talk,
    close: () => {
      open = false
    },
    pause: () => {
      moving = false
    },
    seek: () => {
      tick = 0
      live = false
    },
  }
}
it('identifies a conversation before speech and stays through reply gaps and pause', () => {
  const { parent, layer, pause } = setup()
  layer.tick(0)
  expect(parent.textContent).toContain('Amara & Halim')
  expect(parent.textContent).toContain('In conversation')
  expect(parent.querySelectorAll('.conversation-person')).toHaveLength(2)
  layer.tick(2400)
  expect(parent.textContent).toContain('In conversation')
  pause()
  layer.tick(4000)
  expect(parent.querySelector<HTMLElement>('.conversation-presence')?.hidden).toBe(false)
  expect(parent.querySelector<HTMLElement>('.conversation-presence')?.dataset.paused).toBe('true')
  layer.destroy()
  expect(parent.querySelector('.conversation-presence')).toBeNull()
})
it('marks the displayed speaker and listeners, then closes without needing a summary', () => {
  const { parent, layer, close } = setup()
  const bubble = document.createElement('div')
  bubble.className = 'pixel-speech-layer'
  bubble.dataset.agentId = 'amara'
  bubble.dataset.speaking = 'true'
  bubble.dataset.sceneId = 'talk'
  parent.append(bubble)
  layer.tick(0)
  expect(parent.querySelector('[data-person="amara"]')?.getAttribute('data-role')).toBe('speaking')
  expect(parent.querySelector('[data-person="halim"]')?.getAttribute('data-role')).toBe('listening')
  expect(parent.querySelector<HTMLElement>('.conversation-caption')?.hidden).toBe(true)
  expect(parent.querySelectorAll('.conversation-person:not([hidden])')).toHaveLength(2)
  bubble.hidden = true
  layer.tick(1000)
  expect(parent.querySelector('[data-person="amara"]')?.getAttribute('data-role')).toBe('present')
  expect(parent.querySelector<HTMLElement>('.conversation-caption')?.hidden).toBe(false)
  close()
  layer.tick(3000)
  expect(parent.textContent).toContain('Conversation ended')
  expect(parent.querySelector<HTMLElement>('.conversation-caption')?.hidden).toBe(false)
  layer.tick(4100)
  expect(parent.querySelector<HTMLElement>('.conversation-presence')?.hidden).toBe(true)
})
it('clears ending effects on seek and never invents markers for hidden residents', () => {
  const { parent, layer, talk, close, seek } = setup()
  talk.participants = ['amara', 'hidden']
  layer.tick(0)
  expect(parent.querySelectorAll('.conversation-person')).toHaveLength(1)
  close()
  layer.tick(100)
  seek()
  layer.tick(150)
  expect(parent.querySelector<HTMLElement>('.conversation-presence')?.hidden).toBe(true)
})

it('updates the cast when a participant leaves the same conversation', () => {
  const { parent, layer, talk } = setup()
  layer.tick(0)
  talk.participants = ['amara']
  layer.tick(100)
  expect(parent.textContent).not.toContain('Halim')
  expect(parent.querySelector('[data-person="halim"]')).toBeNull()
})
it('does not call a thought or hidden balloon speaking', () => {
  const { parent, layer } = setup()
  const bubble = document.createElement('div')
  bubble.className = 'pixel-speech-layer'
  bubble.dataset.agentId = 'amara'
  bubble.dataset.sceneId = 'talk'
  bubble.dataset.speaking = 'false'
  parent.append(bubble)
  layer.tick(0)
  expect(parent.querySelector('[data-person="amara"]')?.getAttribute('data-role')).toBe('present')
  expect(parent.querySelector<HTMLElement>('.conversation-caption')?.hidden).toBe(false)
})

it('keeps the caption for speech from another scene', () => {
  const { parent, layer } = setup()
  const bubble = document.createElement('div')
  bubble.className = 'pixel-speech-layer'
  bubble.dataset.agentId = 'amara'
  bubble.dataset.speaking = 'true'
  bubble.dataset.sceneId = 'elsewhere'
  parent.append(bubble)
  layer.tick(0)
  expect(parent.querySelector<HTMLElement>('.conversation-caption')?.hidden).toBe(false)
})

it('shows the ending even if the last speech balloon is still visible', () => {
  const { parent, layer, close } = setup()
  const bubble = document.createElement('div')
  bubble.className = 'pixel-speech-layer'
  bubble.dataset.agentId = 'amara'
  bubble.dataset.speaking = 'true'
  bubble.dataset.sceneId = 'talk'
  parent.append(bubble)
  layer.tick(0)
  expect(parent.querySelector<HTMLElement>('.conversation-caption')?.hidden).toBe(true)
  close()
  layer.tick(100)
  expect(parent.querySelector<HTMLElement>('.conversation-caption')?.hidden).toBe(false)
  expect(parent.textContent).toContain('Conversation ended')
})

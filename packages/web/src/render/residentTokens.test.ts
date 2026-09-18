// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentBody } from '@sj/engine/state'
import type { WorldStore } from '../state/worldStore.js'
import type { Scene } from './scene.js'
import { createActLayer } from './acts.js'
import { createResidentTokens } from './residentTokens.js'

afterEach(() => {
  document.body.replaceChildren()
})

function setup(over: Partial<AgentBody> = {}) {
  let a = {
    id: 'nadia',
    name: 'Nadia',
    alive: true,
    asleep: false,
    activity: null,
    collapsedSinceTick: null,
    injuries: [],
    ill: false,
    hp: 100,
    needs: { hunger: 80, warmth: 80, energy: 80, social: 80 },
    ...over,
  } as AgentBody
  let tick = 100,
    live = true,
    deciding = false,
    paused = false
  let state = { agents: { nadia: a } }
  const listeners = new Set<() => void>()
  const host = document.createElement('div')
  const canvas = document.createElement('canvas')
  const speech = document.createElement('div')
  speech.className = 'pixel-speech-layer'
  speech.hidden = true
  host.append(canvas, speech)
  document.body.append(host)
  const store = {
    getState: () => state,
    getTick: () => tick,
    getMode: () => ({ live }),
    minds: () => new Map([['nadia', { state: deciding ? 'deciding' : 'idle' }]]),
    shotScene: () => null,
    timeMoving: () => true,
    getPaused: () => paused,
    subscribe: (fn: () => void) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  } as unknown as WorldStore
  const scene = {
    spatial: true,
    app: { canvas, screen: { width: 800, height: 600 } },
    tags: { setOccupied: () => undefined },
    pickedId: 'nadia',
    getZoom: () => 2,
    wantsMotion: () => true,
    viewRect: () => ({ x: 0, y: 0, w: 400, h: 300 }),
    pointOf: () => ({ sx: 200, sy: 180 }),
    interior: {
      isActive: () => false,
      activeId: () => 'house',
      speechAnchor: () => ({ x: 400, y: 220, footY: 310 }),
    },
  } as unknown as Scene
  const acts = createActLayer(scene, store)
  const tokens = createResidentTokens(scene, store, acts)
  const update = () => {
    acts.tick()
    tokens.tick()
  }
  return {
    host,
    scene,
    acts,
    tokens,
    speech,
    listeners,
    update,
    set(changes: Partial<AgentBody>) {
      a = { ...a, ...changes }
      state = { agents: { nadia: a } }
      tick++
      for (const fn of listeners) fn()
      update()
    },
    mind(value: boolean, isLive = true) {
      deciding = value
      live = isLive
      update()
    },
    pause() {
      paused = true
      update()
    },
    badge: () => host.querySelector('.resident-badge'),
  }
}

describe('approved resident tokens in the real rendering layer', () => {
  it('anchors sleep to the body and never to the roof above an indoor resident', () => {
    const h = setup({ asleep: true })
    h.update()
    expect(h.badge()?.textContent).toBe('Asleep')
    expect(h.host.querySelector<HTMLElement>('.resident-marker')?.style.transform).toBe(
      'translate(400px, 306px)',
    )
    h.set({ insideId: 'house' })
    expect(h.badge()).toBeNull()
    h.scene.interior!.isActive = () => true
    h.update()
    expect(h.badge()?.textContent).toBe('Asleep')
    expect(h.host.querySelector<HTMLElement>('.resident-marker')?.style.transform).toBe(
      'translate(400px, 251px)',
    )
    h.set({ insideId: 'other' })
    expect(h.badge()).toBeNull()
  })

  it('shows thinking only for a selected live mind and yields to speech', () => {
    const h = setup()
    h.mind(true)
    expect(h.badge()?.textContent).toBe('Thinking')
    h.mind(true, false)
    expect(h.badge()).toBeNull()
    h.mind(true)
    h.scene.pickedId = null
    h.update()
    expect(h.badge()).toBeNull()
    h.scene.pickedId = 'nadia'
    h.speech.hidden = false
    h.speech.dataset.agentId = 'nadia'
    h.update()
    expect(h.badge()).toBeNull()
    h.speech.hidden = true
    h.update()
    expect(h.badge()?.textContent).toBe('Thinking')
    h.mind(false)
    expect(h.badge()).toBeNull()
  })

  it('uses recorded work duration indoors and removes the marker when work ends', () => {
    const h = setup({
      insideId: 'house',
      activity: { verb: 'craft', ticksRemaining: 20 } as AgentBody['activity'],
    })
    h.scene.interior!.isActive = () => true
    h.acts.noteStart('nadia', 'craft', 40)
    h.update()
    expect(h.badge()?.textContent).toBe('Crafting')
    expect(h.host.querySelector<HTMLElement>('.resident-progress')?.style.transform).toBe(
      'scaleX(0.500)',
    )
    h.set({ activity: null })
    expect(h.badge()).toBeNull()
  })

  it('does not promise a progress bar for long construction', () => {
    const h = setup({ activity: { verb: 'build', ticksRemaining: 2880 } as AgentBody['activity'] })
    h.update()
    expect(h.badge()?.textContent).toBe('Building')
    expect(h.host.querySelector<HTMLElement>('.resident-progress')?.hidden).toBe(true)
  })

  it('keeps health alerts above sleep, respects pause, and disposes the layer', () => {
    const h = setup({ asleep: true })
    h.update()
    h.pause()
    expect(h.host.querySelector<HTMLElement>('.resident-token-layer')?.dataset.motion).toBe('off')
    h.set({ ill: true })
    expect(h.badge()).toBeNull()
    h.set({ ill: false, alive: false })
    expect(h.badge()).toBeNull()
    h.tokens.destroy()
    h.acts.destroy()
    expect(h.host.querySelector('.resident-token-layer')).toBeNull()
    expect(h.listeners.size).toBe(0)
  })
})

// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { Scene } from '../render/scene.js'
import { useSafeInsets } from './useSafeInsets.js'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const roots: ReturnType<typeof createRoot>[] = []
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount()
  })
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

it('ignores animated world labels while observing new chrome bands and their size', async () => {
  const observed = new Set<Element>()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(el: Element): void {
        observed.add(el)
      }
      unobserve(el: Element): void {
        observed.delete(el)
      }
      disconnect(): void {
        observed.clear()
      }
    },
  )
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
  vi.stubGlobal('cancelAnimationFrame', () => {})
  const host = document.createElement('div')
  host.className = 'app'
  host.innerHTML =
    '<canvas></canvas><div class="day-bar"></div><div class="paper" data-dock="on" data-open="yes" aria-modal="false"></div><div class="pixel-balloon"></div><div id="hook"></div>'
  document.body.append(host)
  const canvas = host.querySelector('canvas')!
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1440, 900))
  const dock = host.querySelector<HTMLElement>('.paper')!
  vi.spyOn(dock, 'getBoundingClientRect').mockReturnValue(new DOMRect(1450, 100, 504, 800))
  const scene = { app: { canvas }, safeInsets: { top: 0, bottom: 0 } } as unknown as Scene
  function Probe() {
    useSafeInsets(scene)
    return null
  }
  const root = createRoot(host.querySelector('#hook')!)
  roots.push(root)
  await act(async () => {
    root.render(createElement(Probe))
  })
  frames.splice(0).forEach((frame) => {
    frame(0)
  })
  expect(scene.safeInsets?.right, 'reserve the dock even before its opening slide finishes').toBe(
    504,
  )
  expect(observed.has(dock)).toBe(true)
  host.querySelector<HTMLElement>('.pixel-balloon')!.style.transform = 'translate(20px, 10px)'
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(frames).toHaveLength(0)
  expect(observed.has(host.querySelector('.day-bar')!)).toBe(true)
  const badge = document.createElement('div')
  badge.className = 'camera-bookmark'
  host.querySelector('.day-bar')!.append(badge)
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(observed.has(badge)).toBe(true)
  expect(frames).toHaveLength(1)
  frames.splice(0).forEach((frame) => {
    frame(0)
  })
  dock.dataset.open = 'no'
  await new Promise((resolve) => setTimeout(resolve, 0))
  frames.splice(0).forEach((frame) => {
    frame(0)
  })
  expect(scene.safeInsets?.right).toBe(0)
  dock.dataset.open = 'yes'
  dock.setAttribute('aria-modal', 'true')
  await new Promise((resolve) => setTimeout(resolve, 0))
  frames.splice(0).forEach((frame) => {
    frame(0)
  })
  expect(scene.safeInsets?.right, 'a mobile modal does not reserve a desktop dock column').toBe(0)
})

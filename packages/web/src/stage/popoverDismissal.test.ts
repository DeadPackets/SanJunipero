// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import { UsageMeter } from './UsageMeter.js'
import { InteriorHUD } from './InteriorHUD.js'

vi.mock('../ui/useEndpoint.js', () => ({
  endpoint: () => ({}),
  useFeed: () => ({ loaded: true, failed: false, data: null }),
}))

const roots: Root[] = []
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount()
  })
  document.body.replaceChildren()
})

async function mount() {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  const state = {
    tick: 1,
    structures: {
      home: { id: 'home', kind: 'house', name: 'Home', stage: 'complete', x: 0, y: 0 },
    },
    agents: {},
    items: {},
  }
  const store = {
    subscribe: () => () => {},
    getState: () => state,
    assetsSeq: () => 0,
    getConfig: () => DEFAULT_CONFIG,
    assetRecords: () => [],
  } as unknown as WorldStore
  await act(async () => {
    root.render(
      createElement(
        'div',
        null,
        createElement(UsageMeter),
        createElement(InteriorHUD, { store, id: 'home', onExit: () => {}, onPerson: () => {} }),
      ),
    )
  })
  const usage = host.querySelector<HTMLDetailsElement>('.usage-meter')
  const summary = host.querySelector<HTMLElement>('.usage-meter summary')
  const belongings = host.querySelector<HTMLButtonElement>('.interior-contents-button')
  if (!usage || !summary || !belongings) throw new Error('popover controls did not render')
  return { host, usage, summary, belongings }
}

it('closes the previous popover when opening the other control', async () => {
  const { usage, summary, belongings } = await mount()
  usage.open = true
  await act(async () => {
    belongings.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    belongings.click()
  })
  expect(usage.open).toBe(false)
  expect(belongings.getAttribute('aria-expanded')).toBe('true')
  await act(async () => {
    summary.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  })
  expect(belongings.getAttribute('aria-expanded')).toBe('false')
})

it('hands keyboard focus from one popover to the other', async () => {
  const { usage, summary, belongings } = await mount()
  usage.open = true
  await act(async () => {
    belongings.focus()
    belongings.click()
  })
  expect(usage.open).toBe(false)
  expect(belongings.getAttribute('aria-expanded')).toBe('true')
  await act(async () => {
    summary.focus()
  })
  expect(belongings.getAttribute('aria-expanded')).toBe('false')
})

it('Escape closes only the open popover and does not reach the room shortcut', async () => {
  const { usage, summary, belongings } = await mount()
  const roomShortcut = vi.fn()
  window.addEventListener('keydown', roomShortcut)
  usage.open = true
  const usageEscape = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  })
  await act(async () => {
    summary.dispatchEvent(usageEscape)
  })
  expect(usage.open).toBe(false)
  expect(usageEscape.defaultPrevented).toBe(true)
  await act(async () => {
    belongings.click()
  })
  const contentsEscape = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  })
  await act(async () => {
    belongings.dispatchEvent(contentsEscape)
  })
  expect(belongings.getAttribute('aria-expanded')).toBe('false')
  expect(contentsEscape.defaultPrevented).toBe(true)
  expect(roomShortcut).not.toHaveBeenCalled()
  window.removeEventListener('keydown', roomShortcut)
})

it('leaves Escape to an open mobile Almanac dialog', async () => {
  const { usage, belongings } = await mount()
  usage.open = true
  await act(async () => {
    belongings.click()
  })
  const paper = document.createElement('section')
  paper.className = 'paper'
  paper.dataset.open = 'yes'
  paper.setAttribute('aria-modal', 'true')
  document.body.append(paper)
  const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  await act(async () => {
    paper.dispatchEvent(escape)
  })
  expect(escape.defaultPrevented).toBe(false)
  expect(usage.open).toBe(true)
  expect(belongings.getAttribute('aria-expanded')).toBe('true')
})

it('leaves Escape to Controls even while stale popovers remain open', async () => {
  const { usage, belongings } = await mount()
  usage.open = true
  await act(async () => {
    belongings.click()
  })
  const controls = document.createElement('div')
  controls.className = 'key-map'
  document.body.append(controls)
  const reachesStage = vi.fn()
  window.addEventListener('keydown', reachesStage)
  const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  await act(async () => {
    controls.dispatchEvent(escape)
  })
  expect(escape.defaultPrevented).toBe(false)
  expect(reachesStage).toHaveBeenCalledTimes(1)
  expect(usage.open).toBe(true)
  expect(belongings.getAttribute('aria-expanded')).toBe('true')
  window.removeEventListener('keydown', reachesStage)
})

it('does not consume an Escape already handled by a child control', async () => {
  const { usage, summary } = await mount()
  usage.open = true
  const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  escape.preventDefault()
  await act(async () => {
    summary.dispatchEvent(escape)
  })
  expect(usage.open).toBe(true)
})

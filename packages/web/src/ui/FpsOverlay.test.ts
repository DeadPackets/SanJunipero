// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { FpsOverlay } from './FpsOverlay.js'

let root: Root | null = null
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(async () => {
  await act(async () => {
    root?.unmount()
    root = null
  })
  document.body.replaceChildren()
})

it.each([
  '<dialog open></dialog>',
  '<section class="paper" data-open="yes" aria-modal="true"></section>',
  '<div id="first-frame"></div>',
  '',
])('does not toggle behind blocked input or an already handled shortcut: %s', async (markup) => {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root?.render(createElement(FpsOverlay))
  })
  const blocker = document.createElement('div')
  blocker.innerHTML = markup
  document.body.append(blocker)
  const blocked = new KeyboardEvent('keydown', {
    key: 'P',
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  })
  if (!markup) blocked.preventDefault()
  await act(async () => {
    window.dispatchEvent(blocked)
  })
  expect(host.querySelector('.fps-overlay')).toBeNull()
  blocker.remove()
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', shiftKey: true, bubbles: true }))
  })
  expect(host.querySelector('.fps-overlay')).not.toBeNull()
})

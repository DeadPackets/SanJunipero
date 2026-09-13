// @vitest-environment happy-dom
import { act, createElement, Fragment } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cameraActionFor } from '../render/cameraNav.js'
import { FpsOverlay } from '../ui/FpsOverlay.js'
import { stageKeyFor } from './useStageKeys.js'
import { KEY_MAP, KEY_MAP_KEY, KeyMap } from './KeyMap.js'

const shut = renderToStaticMarkup(createElement(KeyMap, { open: false, onOpenChange: () => {} }))
const open = renderToStaticMarkup(createElement(KeyMap, { open: true, onOpenChange: () => {} }))

const roots: { unmount: () => void }[] = []
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Both listeners are on the window at once, which is the only way to catch a key two of them
 *  claim: `f` used to go fullscreen AND raise the frame meter. */
async function stage(): Promise<{ host: HTMLElement; asked: boolean[] }> {
  const asked: boolean[] = []
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  await act(async () => {
    root.render(
      createElement(Fragment, null, [
        createElement(KeyMap, {
          key: 'map',
          open: false,
          onOpenChange: (v: boolean) => asked.push(v),
        }),
        createElement(FpsOverlay, { key: 'fps' }),
      ]),
    )
  })
  return { host, asked }
}

async function press(key: string, over: Partial<KeyboardEventInit> = {}): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...over }))
  })
}

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount()
  })
  document.body.replaceChildren()
  vi.useRealTimers()
})

describe('the key map — heuristic 10 used to score zero', () => {
  it('★ is shut until it is asked for, and then says every key by name', () => {
    expect(shut).toBe('')
    expect(open).toContain('key-map-sheet')
    for (const row of KEY_MAP) {
      expect(open, row.says).toContain(row.says)
      for (const k of row.keys) expect(open, k).toContain(`>${k}</kbd>`)
    }
  })

  it('★ every key it claims is a key something actually binds', () => {
    const stage = KEY_MAP.filter((r) => r.keys.length === 1 && /^[A-Z]$/.test(r.keys[0] ?? ''))
    expect(stage.map((r) => r.keys[0])).toEqual(['S', 'F', 'D', 'T', 'A'])
    for (const r of stage) expect(stageKeyFor(r.keys[0]!), r.keys[0]).not.toBeNull()
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '-', 'Home'])
      expect(cameraActionFor(key), key).not.toBeNull()
  })

  it('★ opens on `?` — and the frame meter had to give the key up for it', async () => {
    expect(KEY_MAP_KEY).toBe('?')
    const { host, asked } = await stage()
    await press(KEY_MAP_KEY)
    expect(asked).toEqual([true])
    expect(host.querySelector('.fps-overlay'), 'the meter took `?` as well').toBeNull()

    // the meter now answers to Shift+P, and the key map does not answer to that
    await press('P', { shiftKey: true })
    expect(host.querySelector('.fps-overlay')).not.toBeNull()
    expect(asked).toEqual([true])
  })

  it('★ leaves `?` alone inside a field, where it is a question mark', async () => {
    const { asked } = await stage()
    const field = document.createElement('input')
    document.body.append(field)
    await act(async () => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: KEY_MAP_KEY, bubbles: true }))
    })
    expect(asked).toEqual([])
  })

  it('is a dialog with a name, and takes focus when it comes up', () => {
    expect(open).toContain('role="dialog"')
    expect(open).toContain('aria-label="What the town answers to"')
    expect(open).toContain('tabindex="-1"')
  })
})

// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AlmanacMoments } from './AlmanacMoments.js'
import type { Mark } from '../ui/timelineMarks.js'

const roots: Root[] = []
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount()
  })
  document.body.replaceChildren()
})

describe('an opened almanac moment', () => {
  it('holds its selected snapshot through a feed refresh and returns focus to its opener', async () => {
    const host = document.createElement('div')
    host.className = 'almanac'
    document.body.append(host)
    const root = createRoot(host)
    roots.push(root)
    const watch = vi.fn()
    const original: Mark = { tick: 100, kind: 'built', words: 'A house was built', weight: 8 }
    const render = async (marks: Mark[]) => {
      await act(async () => {
        root.render(createElement(AlmanacMoments, { marks, onWatch: watch }))
      })
    }
    await render([original])
    const opener = host.querySelector<HTMLButtonElement>('.almanac-event')!
    await act(async () => {
      opener.click()
    })
    expect(opener.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(host.querySelector('[data-primary]'))
    await render([{ ...original, words: 'Updated feed words' }])
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain(original.words)
    expect(host.querySelector('[role="dialog"]')?.textContent).not.toContain('Updated feed words')
    expect(opener.getAttribute('aria-expanded')).toBe('true')
    await act(async () => {
      host.querySelector<HTMLButtonElement>('.almanac-watch')!.click()
    })
    expect(watch).toHaveBeenCalledExactlyOnceWith(original.tick)
    expect(host.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(opener)
    expect(opener.getAttribute('aria-expanded')).toBe('false')
  })
})

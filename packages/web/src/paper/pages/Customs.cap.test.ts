// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConstructRecord } from '@sj/shared'
import { createWorldStore } from '../../state/worldStore.js'
import { CustomsPage } from './Customs.js'

const custom = (n: number): ConstructRecord => ({
  id: `construct_${n}`,
  type: 'festival',
  name: `Custom ${n}`,
  members: ['ada', 'bex'],
  firstDay: n,
  gatherings: 2,
  anchor: { x: n, y: n },
  quote: null,
  saidBy: null,
})

const roots: { unmount: () => void }[] = []
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** The endpoint lists oldest first, so the fixture does too. */
async function page(rows: ConstructRecord[]): Promise<HTMLElement> {
  vi.stubGlobal('fetch', () =>
    Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify(rows)) }),
  )
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  await act(async () => {
    root.render(createElement(CustomsPage, { store: createWorldStore() }))
  })
  await act(async () => {
    await Promise.resolve()
  })
  return host
}

const names = (host: HTMLElement): (string | null)[] =>
  [...host.querySelectorAll('.feed-head')].map((n) => n.textContent)

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount()
  })
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

// The customs endpoint lists oldest first and never stops growing; the page shows the newest
// dozen and says how many more there are, so a month-old town still opens on this week.
describe('★ the customs page shows the newest dozen', () => {
  it('takes the last twelve, newest first', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => custom(i))
    const shown = names(await page(rows))
    expect(shown).toHaveLength(12)
    expect(shown[0]).toBe('Custom 19')
    expect(shown.at(-1)).toBe('Custom 8')
  })

  it('shows a short town whole, and counts nothing', async () => {
    const host = await page([custom(0), custom(1)])
    expect(names(host)).toEqual(['Custom 1', 'Custom 0'])
    expect(host.textContent).not.toContain('more from earlier days')
  })

  it('counts the rest in plain words', async () => {
    const host = await page(Array.from({ length: 20 }, (_, i) => custom(i)))
    expect(host.textContent).toContain('And 8 more from earlier days.')
  })
})

// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { GameChronicle } from './Chronicle.js'
import { chronicleFeed } from '../../ui/feeds.js'
import { createWorldStore } from '../../state/worldStore.js'
import type { WorldState } from '@sj/engine/state'
import type { PageProps } from '../pages/types.js'

vi.mock('../../ui/useEndpoint.js', async (original) => {
  const real = await original<typeof import('../../ui/useEndpoint.js')>()
  return {
    ...real,
    useFeed: (feed: unknown) => ({
      loaded: true,
      failed: false,
      data:
        feed === chronicleFeed
          ? [
              {
                seq: 1,
                tick: 10,
                type: 'structure_built',
                label: 'A house was built',
                agentIds: [],
              },
            ]
          : null,
    }),
  }
})

const roots: Root[] = []
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount()
  })
  document.body.replaceChildren()
})

it('resets an opened event on a tab change without bringing it back on return', async () => {
  const state = { tick: 100, agents: {} } as WorldState
  const store = { ...createWorldStore(), getState: () => state }
  const props: PageProps = {
    store,
    tab: 'Timeline',
    subject: null,
    thing: null,
    momentId: null,
    scene: null,
    operatorToken: null,
    insideId: null,
    gapTicks: null,
    onSubject: vi.fn(),
    onInside: vi.fn(),
    onScrub: vi.fn(),
    onPlay: vi.fn(),
    onLive: vi.fn(),
    onNotice: vi.fn(),
    onMoment: vi.fn(),
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  const render = async (tab: string) => {
    await act(async () => {
      root.render(createElement(GameChronicle, { ...props, tab }))
    })
  }
  await render('Timeline')
  await act(async () => {
    const range = host.querySelector('select')!
    range.value = 'today'
    range.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await act(async () => {
    host.querySelector<HTMLButtonElement>('.sj-event-button')!.click()
  })
  expect(host.querySelector('.sj-event-head')?.textContent).toContain('A house was built')
  expect(document.activeElement).toBe(host.querySelector('.sj-back'))
  await render('Catch up')
  expect(host.querySelector('.sj-event-head')).toBeNull()
  expect(host.querySelector('.sj-event-button')).not.toBeNull()
  await render('Timeline')
  expect(host.querySelector('.sj-event-head')).toBeNull()
  expect(host.querySelector('.sj-event-button')).not.toBeNull()
  expect(host.querySelector('select')?.value).toBe('today')
})

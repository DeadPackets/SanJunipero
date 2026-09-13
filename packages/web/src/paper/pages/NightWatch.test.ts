// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MINUTES_PER_DAY, nightStartTick } from '@sj/shared'
import type { WorldState } from '@sj/engine/state'
import { createWorldStore, type WorldStore } from '../../state/worldStore.js'
import { townAsleep } from '../../ui/directorCut.js'
import { ChroniclePage } from './Chronicle.js'
import { NightWatch } from './NightWatch.js'

type Row = { tick: number; day: number; text: string; kind: 'journal' | 'dream' }

// 22:00 of day 3, which is inside the same night the town lay down at 20:00 in.
const NOW = 3 * MINUTES_PER_DAY + 22 * 60
const DUSK = nightStartTick(NOW)

const roots: { unmount: () => void }[] = []
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** A journal per body, served the way the gateway serves it: oldest first, both kinds merged. */
function gateway(byId: Readonly<Record<string, readonly Row[]>>): { calls: string[] } {
  const calls: string[] = []
  vi.stubGlobal('fetch', (url: string) => {
    calls.push(url)
    const id = /\/api\/agent\/([^/]+)\/journal/.exec(url)?.[1] ?? ''
    const rows = byId[decodeURIComponent(id)] ?? []
    return Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify(rows)) })
  })
  return { calls }
}

function town(
  bodies: Readonly<Record<string, { alive: boolean; asleep: boolean; name: string }>>,
  tick = NOW,
): WorldStore {
  const snap = { tick, agents: bodies } as unknown as WorldState
  return { ...createWorldStore(), getState: () => snap, getTick: () => tick }
}

async function watch(store: WorldStore): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  await act(async () => {
    root.render(createElement(NightWatch, { store, onSubject: () => {} }))
  })
  await act(async () => {
    await Promise.resolve()
  })
  return host
}

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount()
  })
  document.body.replaceChildren()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const ABED = {
  ada: { alive: true, asleep: true, name: 'Ada' },
  bo: { alive: true, asleep: true, name: 'Bo' },
}

describe('the night watch', () => {
  it('gives one card to each sleeping mind that wrote tonight, journal then dream', async () => {
    gateway({
      ada: [
        { tick: DUSK + 30, day: 3, text: 'The roof held.', kind: 'journal' },
        { tick: DUSK + 120, day: 3, text: 'A door that was not there.', kind: 'dream' },
      ],
      bo: [{ tick: DUSK + 40, day: 3, text: 'Nobody came to the fire.', kind: 'journal' }],
    })
    const host = await watch(town(ABED))
    const cards = [...host.querySelectorAll('.night-card')]
    expect(cards).toHaveLength(2)
    expect(cards[0]?.querySelector('.night-who')?.textContent).toBe('Ada')
    expect([...cards[0]!.querySelectorAll('p')].map((p) => p.textContent)).toEqual([
      'The roof held.',
      'A door that was not there.',
    ])
    expect(cards[1]?.querySelector('.night-dreamt')).toBeNull()
  })

  it('shows nothing at all when nobody has written yet', async () => {
    gateway({ cass: [], dev: [] })
    const host = await watch(
      town({
        cass: { alive: true, asleep: true, name: 'Cass' },
        dev: { alive: true, asleep: true, name: 'Dev' },
      }),
    )
    expect(host.querySelectorAll('.night-card')).toHaveLength(0)
    expect(host.textContent).toBe('')
  })

  it('★ reads tonight only, so last night’s page is not read back as this one', async () => {
    gateway({
      eve: [
        { tick: DUSK - MINUTES_PER_DAY, day: 2, text: 'Yesterday I walked out.', kind: 'journal' },
        { tick: DUSK + 10, day: 3, text: 'Tonight the well is low.', kind: 'journal' },
      ],
    })
    const host = await watch(town({ eve: { alive: true, asleep: true, name: 'Eve' } }))
    expect(host.querySelector('.night-said')?.textContent).toBe('Tonight the well is low.')
  })

  it('asks only for the sleeping cast, and every name it prints is a door', async () => {
    const { calls } = gateway({ fen: [{ tick: DUSK + 5, day: 3, text: 'Cold.', kind: 'journal' }] })
    const host = await watch(
      town({
        fen: { alive: true, asleep: true, name: 'Fen' },
        gil: { alive: true, asleep: false, name: 'Gil' },
        hal: { alive: false, asleep: true, name: 'Hal' },
      }),
    )
    expect(calls.filter((u) => u.includes('/journal')).map((u) => u.split('/')[3])).toEqual(['fen'])
    expect(host.querySelector('.night-who button.person-link')?.textContent).toBe('Fen')
  })

  it('the swap the integration lane gates on is the town’s own sleep', () => {
    expect(townAsleep(ABED)).toBe(true)
    expect(townAsleep({ ...ABED, gil: { alive: true, asleep: false } })).toBe(false)
    expect(townAsleep({})).toBe(false)
  })
})

const wroteBoth = (id: string): Row[] => [
  { tick: DUSK + 10, day: 3, text: `${id} banked the fire.`, kind: 'journal' },
  { tick: DUSK + 20, day: 3, text: `${id} was walking a road.`, kind: 'dream' },
]

/** ★ Twelve sleepers on a 30 s beat is a fetch every 2.5 s all night for two lines that were
 *  written once. Before this, three beats cost 48 reads; the card now hands its poll back. */
describe('★ the night poll stops when it has what it came for', () => {
  const beats = async (n: number): Promise<void> => {
    for (let i = 0; i < n; i++) {
      await act(async () => {
        vi.advanceTimersByTime(30_000)
      })
      await act(async () => {
        await Promise.resolve()
      })
    }
  }
  const TWELVE = Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [`p${i}`, { alive: true, asleep: true, name: `P${i}` }]),
  )

  it('★ reads each of twelve sleepers once, and not again once the card holds both', async () => {
    const { calls } = gateway(
      Object.fromEntries(Object.keys(TWELVE).map((id) => [id, wroteBoth(id)])),
    )
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const host = await watch(town(TWELVE))
    expect(host.querySelectorAll('.night-card')).toHaveLength(12)
    await beats(3)
    expect(calls.filter((u) => u.includes('/journal'))).toHaveLength(12)
  })

  it('keeps asking while a sleeper has written only one of the two', async () => {
    const { calls } = gateway({
      q0: [{ tick: DUSK + 10, day: 3, text: 'Half a page.', kind: 'journal' }],
    })
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    await watch(town({ q0: { alive: true, asleep: true, name: 'Q' } }))
    await beats(2)
    expect(calls.filter((u) => u.includes('/journal'))).toHaveLength(3)
  })
})

const NO_OP = (): void => undefined

async function record(store: WorldStore): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  await act(async () => {
    root.render(
      createElement(ChroniclePage, {
        tab: 'Record',
        subject: null,
        thing: null,
        momentId: null,
        store,
        scene: null,
        operatorToken: null,
        insideId: null,
        gapTicks: null,
        onSubject: NO_OP,
        onInside: NO_OP,
        onScrub: NO_OP,
        onPlay: NO_OP,
        onLive: NO_OP,
        onNotice: NO_OP,
        onMoment: NO_OP,
      }),
    )
  })
  await act(async () => {
    await Promise.resolve()
  })
  return host
}

describe('★ the Record swaps its front page for the night, and swaps nothing back', () => {
  it('gives the day the Standing and no night watch at all', async () => {
    gateway({})
    const host = await record(town({ r0: { alive: true, asleep: false, name: 'Rae' } }))
    expect(host.querySelector('.board-line'), 'the Standing never mounted').not.toBeNull()
    expect(host.querySelector('.night-cards')).toBeNull()
  })

  it('gives the night the watch, and the Standing goes down with the sun', async () => {
    gateway({ s0: wroteBoth('Sen') })
    const host = await record(town({ s0: { alive: true, asleep: true, name: 'Sen' } }))
    expect(host.querySelector('.night-card')).not.toBeNull()
    expect(host.querySelector('.board-line'), 'the Standing came back at night').toBeNull()
    expect(host.querySelector('.standing-line')).toBeNull()
  })

  // ★ A sleeping town nobody has written in yet shows the day log alone. The Standing does NOT
  // come back into the gap: the front page is the night's, written or not.
  it('★ shows neither when the town is asleep and nobody has written tonight', async () => {
    gateway({ t0: [] })
    const host = await record(town({ t0: { alive: true, asleep: true, name: 'Tam' } }))
    expect(host.querySelector('.night-card')).toBeNull()
    expect(host.querySelector('.board-line')).toBeNull()
    expect(host.querySelector('.standing-line')).toBeNull()
    expect(host.querySelector('.record-range'), 'the Record itself went with it').not.toBeNull()
  })
})

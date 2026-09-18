// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AssetRecord, SimEvent } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import { TYPE_CHARS_PER_S, typedChars, typingMs } from '../render/converse.js'
import { CAPTION_HOLD_MS, captionClip, lowerThirdLine } from '../ui/broadcast.js'
import { BUST_DESK_PX, BUST_PX, LowerThird } from './Broadcast.js'

// happy-dom's own `URL` resolves a bare path against localhost, so a file read has to be a path.
const src = (f: string): string => readFileSync(join(import.meta.dirname, f), 'utf8')
const SRC = src('./Broadcast.tsx')
const CSS = src('../ui/chrome.css').replace(/\/\*[\s\S]*?\*\//g, '')
const APP = src('../App.tsx')

const ART: AssetRecord = {
  id: 'asset_nadia',
  seq: 1,
  class: 'rig-part',
  desc: 'character sheet v4: nadia',
  kind: 'character:nadia',
  footprint: { w: 1, h: 1 },
  widthPx: 2000,
  heightPx: 3400,
  status: 'ready',
  score: null,
  attempts: 1,
  costUsd: 0,
  createdAt: 'now',
  meta: JSON.stringify({
    version: 'v4-hires-atlas',
    figureH: 800,
    cells: { 'idle-se': { x: 400, y: 850, w: 340, h: 810, feetX: 170, feetY: 805 } },
  }),
}

/** Only what the slab reads off a store: who spoke, what they are called, and their sheet. */
function fakeStore(startDressed = true): {
  store: WorldStore
  say: (id: string, text: string) => void
  dress: () => void
} {
  const subs = new Set<(evts: SimEvent[]) => void>()
  const viewers = new Set<() => void>()
  let dressed = startDressed
  const agents = {
    nadia: { id: 'nadia', name: 'Nadia' },
    yusuf: { id: 'yusuf', name: 'Yusuf' },
  }
  return {
    store: {
      onEvents: (fn: (evts: SimEvent[]) => void) => {
        subs.add(fn)
        return () => subs.delete(fn)
      },
      subscribe: (fn: () => void) => {
        viewers.add(fn)
        return () => viewers.delete(fn)
      },
      dressed: () => dressed,
      getState: () => ({ agents }),
      assetRecords: () => [ART],
    } as unknown as WorldStore,
    say: (agentId, text) => {
      const ev = { type: 'agent_spoke', payload: { agentId, text } } as unknown as SimEvent
      for (const fn of [...subs]) fn([ev])
    },
    dress: () => {
      dressed = true
      for (const fn of [...viewers]) fn()
    },
  }
}

const roots: { unmount: () => void }[] = []
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

async function mount(el: ReactElement): Promise<{
  host: HTMLElement
  again: (next: ReactElement) => Promise<void>
}> {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  await act(async () => {
    root.render(el)
  })
  return {
    host,
    again: async (next: ReactElement) => {
      await act(async () => {
        root.render(next)
      })
    },
  }
}

/** `ms` of the fake clock, which is the one the stage loop and `performance.now` both read. */
async function run(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

const typed = (host: HTMLElement): string =>
  host.querySelector('.lower-third-typed')?.textContent ?? ''
const ghost = (host: HTMLElement): string =>
  host.querySelector('.lower-third-ghost')?.textContent ?? ''

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount()
  })
  document.body.replaceChildren()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const LINE = 'I will never forgive that.'

describe('★ the caption belongs to the shot, and goes with it', () => {
  it('★ is only ever the line of somebody the camera is on', async () => {
    vi.useFakeTimers()
    const { store, say } = fakeStore()
    const { host, again } = await mount(
      createElement(LowerThird, { store, shot: ['nadia'] as readonly string[] }),
    )
    await act(async () => {
      say('nadia', LINE)
    })
    expect(ghost(host)).toBe(LINE)
    expect(host.querySelector('.lower-third-name')?.textContent).toBe('Nadia')

    // the camera moves off her, and the words go with the shot rather than sitting over a face
    // that never said them
    await again(createElement(LowerThird, { store, shot: ['yusuf'] as readonly string[] }))
    expect(host.querySelector('.lower-third')).toBeNull()
  })

  it('★ never puts a line over the wrong face, even while the words are still arriving', async () => {
    vi.useFakeTimers()
    const { store, say } = fakeStore()
    const { host } = await mount(
      createElement(LowerThird, { store, shot: ['nadia'] as readonly string[] }),
    )
    await act(async () => {
      say('yusuf', LINE)
    })
    expect(host.querySelector('.lower-third')).toBeNull()
  })

  // The App wiring: the one owner of the shot hands it down. There is no second guess at the
  // camera anywhere in the tree, which is a fact about the whole file and not about one call.
  it('★ is handed the shot by the one owner of it, never by a second guess at the camera', () => {
    expect(APP).toMatch(
      /<LowerThird\s+store=\{store\}\s+shot=\{insideId === null \? shot\.cast : roomCastKey\.split\(\x27 \x27\)\.filter\(Boolean\)\}/,
    )
    expect(APP).toMatch(/onShot=\{onShot\}/)
  })

  it('★ mounts at the desk as well as on the stream, at a quarter of the face', async () => {
    vi.useFakeTimers()
    expect(BUST_PX).toBe(96)
    expect(BUST_DESK_PX).toBe(28)
    const size = async (broadcast: boolean): Promise<string> => {
      const { store, say } = fakeStore()
      const { host } = await mount(
        createElement(LowerThird, { store, shot: ['nadia'] as readonly string[], broadcast }),
      )
      await act(async () => {
        say('nadia', LINE)
      })
      const bust = host.querySelector<HTMLElement>('.lower-third-bust')
      expect(bust).not.toBeNull()
      return bust?.style.backgroundSize ?? ''
    }
    const desk = await size(false)
    const stream = await size(true)
    // the crop is computed for the box it is drawn in, so the two sizes differ by that ratio
    expect(desk).not.toBe('')
    const px = (s: string): number => Number.parseFloat(s)
    expect(px(stream) / px(desk)).toBeCloseTo(BUST_PX / BUST_DESK_PX, 2)
    // the sheet draws the box at exactly the size the crop was computed for, or the head slides
    expect(CSS).toMatch(/\.lower-third-bust \{[^}]*width: 28px; height: 28px;/)
    expect(CSS).toMatch(
      /\[data-broadcast='on'\] \.lower-third-bust \{[^}]*width: 96px; height: 96px;/,
    )
  })

  // ★ Measured on three cold loads: twelve character sheets, 4 829 076 bytes, went out as CSS
  // backgrounds the instant the codex landed, ahead of the ground and outside the loader's cap.
  it('★ paints no bust before the town is dressed: a 28 px head costs the whole sheet', async () => {
    vi.useFakeTimers()
    const { store, say, dress } = fakeStore(false)
    const { host } = await mount(
      createElement(LowerThird, { store, shot: ['nadia'] as readonly string[] }),
    )
    await act(async () => {
      say('nadia', LINE)
    })
    const bust = (): HTMLElement | null => host.querySelector<HTMLElement>('.lower-third-bust')
    expect(bust(), 'the slab still holds the space').not.toBeNull()
    expect(bust()?.style.backgroundImage, 'no sheet url is on the wire yet').toBe('')
    expect(bust()?.className).toBe('lower-third-bust none')

    await act(async () => {
      dress()
    })
    expect(bust()?.style.backgroundImage).toContain('asset_nadia')
    expect(bust()?.className).toBe('lower-third-bust')
  })

  it('★ the desk asks the paper for nothing: an idle tab would poll for it forever', async () => {
    vi.useFakeTimers()
    const asked: string[] = []
    vi.stubGlobal('fetch', (url: string) => {
      asked.push(url)
      return Promise.reject(new Error('no gateway in a test'))
    })
    const { store } = fakeStore()
    await mount(createElement(LowerThird, { store, shot: [] as readonly string[] }))
    expect(asked).toEqual([])
    await mount(
      createElement(LowerThird, { store, shot: [] as readonly string[], broadcast: true }),
    )
    expect(asked).toContain('/api/dispatches')
  })
})

describe('★ the line arrives at reading pace, and the slab does not grow under it', () => {
  it('★ is written onto the node per frame, never re-rendered per character', async () => {
    vi.useFakeTimers()
    const { store, say } = fakeStore()
    const { host } = await mount(
      createElement(LowerThird, { store, shot: ['nadia'] as readonly string[] }),
    )
    await act(async () => {
      say('nadia', LINE)
    })
    expect(typed(host)).toBe('')
    const half = Math.floor((LINE.length / TYPE_CHARS_PER_S) * 1000) / 2
    await run(half)
    const part = typed(host)
    expect(part.length).toBeGreaterThan(0)
    expect(part.length).toBeLessThan(LINE.length)
    expect(LINE.startsWith(part)).toBe(true)
    await run(typingMs(LINE.length))
    expect(typed(host)).toBe(LINE)
    expect(SRC).not.toContain('setState(words.slice')
  })

  it('★ the ghost holds the finished width, and takes no ink doing it', async () => {
    vi.useFakeTimers()
    const { store, say } = fakeStore()
    const { host } = await mount(
      createElement(LowerThird, { store, shot: ['nadia'] as readonly string[] }),
    )
    await act(async () => {
      say('nadia', LINE)
    })
    // whole from the first frame, while the words the reader sees are still one letter long
    expect(ghost(host)).toBe(LINE)
    expect(typed(host)).toBe('')
    expect(host.querySelector('.lower-third-ghost')?.getAttribute('aria-hidden')).toBe('true')
    expect(CSS).toMatch(/\.lower-third-ghost \{ visibility: hidden; \}/)
    expect(CSS).toMatch(/\.lower-third-typed \{ position: absolute; inset: 0; \}/)
    expect(CSS).toMatch(/\.lower-third-words \{[^}]*position: relative;/)
  })

  it('★ types at the town’s own pace, the one the speech bubbles use', () => {
    expect(TYPE_CHARS_PER_S).toBe(28)
    expect(typedChars(10, 0)).toBe(0)
    expect(typedChars(10, 1000)).toBe(10)
    expect(typedChars(40, 500)).toBe(14)
    expect(typingMs(28)).toBe(1000)
  })

  it('★ the hold is time to READ: it starts when the line has finished arriving', async () => {
    vi.useFakeTimers()
    expect(CAPTION_HOLD_MS).toBe(6000)
    const { store, say } = fakeStore()
    const { host } = await mount(
      createElement(LowerThird, { store, shot: ['nadia'] as readonly string[] }),
    )
    await act(async () => {
      say('nadia', LINE)
    })
    const whole = CAPTION_HOLD_MS + typingMs(LINE.length)
    await run(whole - 1)
    expect(host.querySelector('.lower-third')).not.toBeNull()
    await run(1)
    expect(host.querySelector('.lower-third')).toBeNull()
    // a caption clipped to its cap is five seconds of typing; six more is a sentence a viewer reads
    expect(typingMs(captionClip('x'.repeat(400)).length)).toBe(5000)
  })

  // `STILL` is read once, at import, so the only way to take the other branch is a second module
  // graph. Vitest hands back a fresh Broadcast and the same react, so the hooks still line up.
  it('★ a viewer who asked for stillness gets the whole line at once', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    vi.resetModules()
    const still = await import('./Broadcast.js')
    const { store, say } = fakeStore()
    const { host } = await mount(
      createElement(still.LowerThird, { store, shot: ['nadia'] as readonly string[] }),
    )
    await act(async () => {
      say('nadia', LINE)
    })
    // not one frame of the stage loop has gone by and the whole line is already there
    expect(typed(host)).toBe(LINE)
    // and the hold is the reading time alone, with no typing added to it
    await run(CAPTION_HOLD_MS)
    expect(host.querySelector('.lower-third')).toBeNull()
  })
})

describe('the line the slab carries', () => {
  it('is the speech while there is speech, and the paper only behind it', () => {
    const spoken = { agentId: 'nadia', name: 'Nadia', words: 'I will never forgive that.' }
    expect(lowerThirdLine(spoken, { title: 'Day 4', body: 'The well ran dry.' })).toEqual({
      kind: 'speech',
      agentId: 'nadia',
      name: 'Nadia',
      words: 'I will never forgive that.',
    })
    expect(lowerThirdLine(null, { title: 'Day 4', body: 'The well ran dry.' })?.kind).toBe(
      'dispatch',
    )
    expect(lowerThirdLine(null, null)).toBeNull()
  })
})

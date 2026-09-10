// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, type SimEvent } from '@sj/shared'
import type { ViewRect } from '../render/cull.js'
import type { Scene } from '../render/scene.js'
import type { WorldStore } from '../state/worldStore.js'
import {
  CUE_CHIP_MS,
  cueChip,
  masterFor,
  SOUND_MASTER,
  type SoundCue,
  type Soundscape as Synth,
} from '../ui/sound.js'
import { heard, Soundscape } from './Soundscape.js'

/** The one thing a test cannot have is a sound card, so the device is swapped and every cue the
 *  component sends it is kept. All the mixing above it is the real code. */
const deck = vi.hoisted(() => ({
  plays: [] as (readonly SoundCue[])[],
  masters: [] as number[],
  hidden: [] as boolean[],
  muted: [] as boolean[],
  destroys: 0,
}))
vi.mock('../ui/sound.js', async (orig) => {
  const real = await orig<typeof import('../ui/sound.js')>()
  const synth: Synth = {
    play: (cues) => void deck.plays.push(cues),
    setMaster: (g) => void deck.masters.push(g),
    setHidden: (h) => void deck.hidden.push(h),
    setMuted: (m) => void deck.muted.push(m),
    destroy: () => void (deck.destroys += 1),
  }
  return { ...real, soundscapeOrSilence: () => synth }
})

/** The meadow scan is a whole-map sort. Counted here so a re-key onto the snapshot shows up. */
const scans = vi.hoisted(() => ({ n: 0 }))
vi.mock('../render/fireflies.js', async (orig) => {
  const real = await orig<typeof import('../render/fireflies.js')>()
  return {
    ...real,
    fireflySeeds: () => {
      scans.n += 1
      return []
    },
  }
})

const VIEW: ViewRect = { x: 0, y: 0, w: 800, h: 400 }
const ELSEWHERE: ViewRect = { x: 100000, y: 100000, w: 800, h: 400 }
const DAYTIME = 11 * 60

type Town = {
  store: WorldStore
  snapshot: () => void
  ratify: (agentId: string) => void
}

/** Only what the mix reads off a store: the world, the clock, and the events. */
function town(): Town {
  const subs = new Set<() => void>()
  const evs = new Set<(e: SimEvent[]) => void>()
  let state = {
    items: {},
    structures: {},
    agents: { nadia: { id: 'nadia', x: 3, y: 4 } },
    weather: { kind: 'clear' },
    terrain: { w: 4, h: 4 },
  }
  return {
    store: {
      subscribe: (fn: () => void) => {
        subs.add(fn)
        return () => subs.delete(fn)
      },
      getState: () => state,
      getTick: () => DAYTIME,
      getConfig: () => DEFAULT_CONFIG,
      openScenes: () => [],
      onEvents: (fn: (e: SimEvent[]) => void) => {
        evs.add(fn)
        return () => evs.delete(fn)
      },
    } as unknown as WorldStore,
    // a fresh identity is what a delta looks like to `useSyncExternalStore`
    snapshot: () => {
      state = { ...state }
      for (const fn of [...subs]) fn()
    },
    ratify: (agentId) => {
      const ev = { type: 'law_ratified', payload: { agentId } } as unknown as SimEvent
      for (const fn of [...evs]) fn([ev])
    },
  }
}

const roots: { unmount: () => void }[] = []
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

async function mount(store: WorldStore, view: ViewRect | null): Promise<HTMLElement> {
  const scene = view === null ? null : ({ viewRect: () => view } as unknown as Scene)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  await act(async () => {
    root.render(createElement(Soundscape, { store, scene }))
  })
  return host
}

const chips = (host: HTMLElement): (string | null)[] =>
  [...host.querySelectorAll('.sound-cue')].map((n) => n.textContent)

/** React keeps its own tracker beside the node, so a value written straight onto the element is
 *  not a change to it. This writes through the prototype's setter, which is the one it watches. */
function drag(el: HTMLInputElement, to: string): void {
  const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set
  set?.call(el, to)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount()
  })
  document.body.replaceChildren()
  localStorage.clear()
  deck.plays.length = 0
  deck.masters.length = 0
  deck.hidden.length = 0
  deck.muted.length = 0
  deck.destroys = 0
  scans.n = 0
  vi.useRealTimers()
})

const FRAME: ViewRect = { x: 0, y: 0, w: 800, h: 400 }
const near = (sx: number, sy: number): number => heard(FRAME, sx, sy).near
const pan = (sx: number): number => heard(FRAME, sx, 200).pan

describe('★ a sound has a place, not a count', () => {
  it('★ is loudest under the lens and falls away from it', () => {
    expect(near(400, 200)).toBe(1)
    expect(near(700, 200)).toBeLessThan(near(500, 200))
    expect(near(500, 200)).toBeLessThan(1)
  })

  // ★ THE BED PUMPED ON EVERY CUT. Fire and murmur were integer counts of what crossed a
  // point-in-rect test, so a camera move stepped the mix by a whole voice.
  it('★ leaves the frame smoothly rather than stepping off it', () => {
    const edge = near(800, 200)
    const past = near(830, 200)
    expect(edge).toBeGreaterThan(0)
    expect(edge).toBeLessThan(0.4)
    expect(past).toBeLessThan(edge)
    expect(near(2000, 200)).toBe(0)
  })

  it('★ carries the side of the frame it is on', () => {
    expect(pan(400)).toBe(0)
    expect(pan(800)).toBe(1)
    expect(pan(0)).toBe(-1)
    expect(pan(600)).toBeCloseTo(0.5, 6)
    expect(pan(-4000)).toBe(-1)
  })

  it('takes a frame with no size at all', () => {
    const dead = heard({ x: 0, y: 0, w: 0, h: 0 }, 0, 0)
    expect(Number.isFinite(dead.near)).toBe(true)
    expect(Number.isFinite(dead.pan)).toBe(true)
  })
})

describe('★ the synth hears every snapshot', () => {
  // ★ THE PRINTED CUE STRING WAS THE CHANGE DETECTOR. It is byte-identical from 20:30 to 05:00,
  // so a still night wrote no gain at all and the whole bed landed in one go at dawn.
  it('★ plays the cue list itself, never a string of its gains', async () => {
    const t = town()
    await mount(t.store, VIEW)
    const first = deck.plays.length
    expect(first).toBeGreaterThan(0)
    // a still night moves nothing in the mix, and the synth is still handed every snapshot of it
    await act(async () => {
      t.snapshot()
    })
    await act(async () => {
      t.snapshot()
    })
    expect(deck.plays.length).toBe(first + 2)
    const named = (i: number): string[] => deck.plays[i]?.map((c) => c.source) ?? []
    expect(named(deck.plays.length - 1)).toContain('wind')
    expect(named(deck.plays.length - 1)).toEqual(named(first - 1))
  })

  it('★ stamps a chip off the roll call of voices, not off their gains', async () => {
    vi.useFakeTimers()
    const t = town()
    const host = await mount(t.store, VIEW)
    const standing = chips(host)
    expect(standing).toContain(cueChip('wind'))
    // the mix is re-sent the whole time, and the chip still ages out on its own start
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CUE_CHIP_MS / 2)
      t.snapshot()
    })
    expect(chips(host)).toEqual(standing)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CUE_CHIP_MS)
      t.snapshot()
    })
    expect(chips(host)).toEqual([])
  })

  // ★ A TOWN LEFT ON A TAB kept synthesising forever at whatever the mix was when it went away.
  it('★ hands the tab going away to the synth', async () => {
    const t = town()
    await mount(t.store, VIEW)
    expect(deck.hidden).toEqual([])
    document.dispatchEvent(new Event('visibilitychange'))
    expect(deck.hidden).toEqual([document.hidden])
  })

  it('★ rings only for a bell the viewer can see ring', async () => {
    const seen = town()
    const host = await mount(seen.store, VIEW)
    await act(async () => {
      seen.ratify('nadia')
    })
    expect(chips(host)).toContain(cueChip('bell'))

    const offscreen = town()
    const away = await mount(offscreen.store, ELSEWHERE)
    await act(async () => {
      offscreen.ratify('nadia')
    })
    expect(chips(away)).not.toContain(cueChip('bell'))
  })

  it('★ hangs how loud off the note itself', async () => {
    localStorage.setItem('sj.sound', 'on')
    const t = town()
    const host = await mount(t.store, VIEW)
    const slider = host.querySelector<HTMLInputElement>('input.sound-level')
    expect(slider?.type).toBe('range')
    expect(deck.masters.at(-1)).toBe(masterFor(Number(slider?.value), DAYTIME))

    await act(async () => {
      if (slider !== null) drag(slider, '0.2')
    })
    expect(deck.masters.at(-1)).toBe(SOUND_MASTER * 0.2)
    // and the number outlives the tab, so a viewer sets it once
    expect(localStorage.getItem('sj.sound.level')).toBe('0.2')
  })

  // The firefly layer already caches this list against the terrain; keying it on `state` meant
  // a whole-map scan and sort four times a second that never once hit.
  it('rescans the meadow only when the ground itself changes', async () => {
    const t = town()
    await mount(t.store, VIEW)
    expect(scans.n).toBe(1)
    for (let i = 0; i < 8; i++)
      await act(async () => {
        t.snapshot()
      })
    expect(deck.plays.length).toBeGreaterThan(8)
    expect(scans.n).toBe(1)
  })
})

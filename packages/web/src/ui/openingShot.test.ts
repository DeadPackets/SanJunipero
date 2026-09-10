// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StrictMode, act, createElement, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { WorldState } from '@sj/engine/state'
import { createWorldStore, type WorldStore } from '../state/worldStore.js'
import { quietRound } from './autoCut.js'
import { QUIET_TURN_TICKS } from './directorCut.js'
import { DirectorMode, shotHold } from './DirectorMode.js'
import { ESTABLISH_HOLD_MS, SHOT_MIN_HOLD_MS } from './shot.js'

// ── ★ THE SESSION'S ONE ESTABLISHING SHOT ─────────────────────────────────────────────────
// It was taken by asking, in the render body, so it went to the first render that asked —
// including one React threw away, and one of a town with nobody outside to establish.

const roots: { unmount: () => void }[] = []
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

async function mount(el: ReactElement): Promise<void> {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  await act(async () => {
    root.render(el)
  })
}

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount()
  })
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

const abed = (asleep: boolean) => ({
  a: { id: 'a', name: 'Ada', alive: true, asleep },
  b: { id: 'b', name: 'Bo', alive: true, asleep },
})

/** A town whose bodies and minute a test can move, with no gateway cutting over the top. */
function town(): { store: WorldStore; at: (tick: number, asleep: boolean) => void } {
  const subs = new Set<() => void>()
  let snap = { tick: 0, agents: abed(true) } as unknown as WorldState
  const store: WorldStore = {
    ...createWorldStore(),
    subscribe: (fn) => {
      subs.add(fn)
      return () => {
        subs.delete(fn)
      }
    },
    getState: () => snap,
    getTick: () => snap.tick,
    getDirector: () => null,
  }
  return {
    store,
    at: (tick, asleep) => {
      snap = { tick, agents: abed(asleep) } as unknown as WorldState
      for (const fn of subs) fn()
    },
  }
}

describe('★ the opening shot a session gets exactly one of', () => {
  // ★ A SHOT NOBODY SAW MAY NOT SPEND IT. The session opens on a sleeping town, which the camera
  // answers with the overview, and the establishing shot went with it. The same hole swallows a
  // render React discards, which is every render under a concurrent root.
  it('★ waits for a town to establish, and still has it when one wakes up', async () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0)
    const { store, at } = town()
    const shots: string[][] = []
    await mount(
      createElement(
        StrictMode,
        null,
        createElement(DirectorMode, {
          store,
          scene: null,
          autoCut: true,
          opening: true,
          onShot: (cast) => {
            shots.push([...cast])
          },
        }),
      ),
    )
    expect(shots.at(-1), 'a sleeping town is nobody in frame').toEqual([])

    clock.mockReturnValue(100)
    await act(async () => {
      at(0, false)
    })
    expect(shots.at(-1), 'the round opens on the first face').toEqual(['a'])

    // An establishing shot lets go at 3.2 s. A single holds for the town's whole cut floor, 8 s,
    // so a camera that spent its opening is still on the same face here.
    clock.mockReturnValue(100 + ESTABLISH_HOLD_MS + 200)
    await act(async () => {
      at(QUIET_TURN_TICKS, false)
    })
    expect(shots.at(-1), 'the establishing shot ended and the round turned').toEqual(['b'])
    expect(ESTABLISH_HOLD_MS).toBeLessThan(SHOT_MIN_HOLD_MS.single)

    // The opening is spent, so this one is an ordinary shot and holds the town's whole cut
    // floor. A camera that never spends it establishes again every 3.2 s, for ever.
    clock.mockReturnValue(100 + ESTABLISH_HOLD_MS + 200 + ESTABLISH_HOLD_MS + 200)
    await act(async () => {
      at(QUIET_TURN_TICKS * 2, false)
    })
    expect(shots.at(-1), 'the second shot let go at the opening’s own floor').toEqual(['b'])
  })
})

// ── the other two closures the render body calls ──────────────────────────────────────────
// `quietRound` and `shotHold` are asked in the same render body. Neither loses anything to a
// second ask, which is the whole question a discarded render puts to them.

describe('asked twice, the way a discarded render asks', () => {
  it('the quiet round holds the same face and does not turn under itself', () => {
    const round = quietRound()
    const people = ['a', 'b', 'c']
    const first = round(people, 0)
    expect(round(people, 0)).toBe(first)
    // The face is held, not recomputed: the same turn with the cast in another order keeps it.
    expect(round(['b', 'a', 'c'], 0), 'the round turned under itself').toBe(first)
    const held = round(people, QUIET_TURN_TICKS)
    expect(round(people, QUIET_TURN_TICKS)).toBe(held)
    expect(round(people, QUIET_TURN_TICKS)).toBe(held)
    expect(round(people, QUIET_TURN_TICKS * 2)).not.toBe(held)
  })

  it('the shot on screen is the same shot when the same want is offered again', () => {
    const hold = shotHold()
    const want = {
      spec: { kind: 'twoShot' as const, target: { at: 'cast' as const, ids: ['a', 'b'] }, why: '' },
      byHand: false,
      turn: null,
      by: 'cut' as const,
      structureId: null,
      of: { castKey: 'a b', followed: null, sceneId: null, isCut: true, why: null },
    }
    const first = hold(want)
    expect(hold(want)?.shot).toBe(first?.shot)
    expect(hold(want)?.shot).toBe(first?.shot)
  })
})

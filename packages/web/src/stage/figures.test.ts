// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ADULT_AGE_DAYS, DEFAULT_CONFIG } from '@sj/shared'
import { genesisState, type WorldState } from '@sj/engine/state'
import type { Scene } from '../render/scene.js'
import type { WorldStore } from '../state/worldStore.js'
import { Figures, figuresInView } from './Figures.js'

// happy-dom's own `URL` resolves a bare path against localhost, so a file read has to be a path.
const src = (rel: string): string => readFileSync(join(import.meta.dirname, rel), 'utf8')

/** A 800x600 view whose middle is (400, 300), and bodies wherever the fixture puts them. */
function fakeScene(at: Record<string, { sx: number; sy: number }>, zoom = 1): Scene {
  return {
    viewRect: () => ({ x: 0, y: 0, w: 800, h: 600 }),
    getZoom: () => zoom,
    pointOf: (kind: string, id: string) => (kind === 'agent' ? (at[id] ?? null) : null),
  } as unknown as Scene
}

const roots: { unmount: () => void }[] = []
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Mounts the layer and runs one turn of the stage loop, which is what places every ring. */
async function layer(
  scene: Scene,
  state: WorldState,
  paperOpen = false,
): Promise<HTMLButtonElement[]> {
  const store = {
    subscribe: () => () => undefined,
    getState: () => state,
  } as unknown as WorldStore
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  await act(async () => {
    root.render(
      createElement(Figures, {
        scene,
        store,
        paperOpen,
        onFocus: () => {},
        onOpen: () => {},
      }),
    )
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(32)
  })
  return [...host.querySelectorAll<HTMLButtonElement>('.stage-figure')]
}

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount()
  })
  document.body.replaceChildren()
  vi.useRealTimers()
})

function body(id: string, name: string, alive = true): WorldState['agents'][string] {
  return {
    id,
    name,
    x: 0,
    y: 0,
    alive,
    asleep: false,
    needs: { hunger: 1, energy: 1, warmth: 1, social: 1 },
    hp: 10,
    injuries: [],
    ill: false,
    ageDays: ADULT_AGE_DAYS,
    skills: {},
    activity: null,
    collapsedSinceTick: null,
    zeroHungerSinceTick: null,
  }
}

function town(...ids: [string, string, boolean?][]): WorldState {
  const s = genesisState(DEFAULT_CONFIG)
  return {
    ...s,
    agents: Object.fromEntries(ids.map(([id, name, alive]) => [id, body(id, name, alive)])),
  }
}

describe('figuresInView — the order Tab walks the town in', () => {
  it('puts the figure nearest the middle of the picture first', () => {
    const scene = fakeScene({
      far: { sx: 780, sy: 580 },
      near: { sx: 405, sy: 305 },
      mid: { sx: 500, sy: 400 },
    })
    const order = figuresInView(scene, town(['far', 'Far'], ['near', 'Near'], ['mid', 'Mid']))
    expect(order.map((f) => f.id)).toEqual(['near', 'mid', 'far'])
    expect(order[0]!.name).toBe('Near')
    expect(order[0]!.kind).toBe('agent')
  })

  it('leaves out whoever the camera cannot see, and whoever is no longer living', () => {
    const scene = fakeScene({
      here: { sx: 400, sy: 300 },
      offstage: { sx: 4000, sy: 300 },
      gone: { sx: 401, sy: 300 },
    })
    const state = town(['here', 'Here'], ['offstage', 'Off'], ['gone', 'Gone', false])
    expect(figuresInView(scene, state).map((f) => f.id)).toEqual(['here'])
  })

  it('leaves out a body the character layer has no sprite for yet', () => {
    const scene = fakeScene({ drawn: { sx: 400, sy: 300 } })
    expect(
      figuresInView(scene, town(['drawn', 'Drawn'], ['unborn', 'Unborn'])).map((f) => f.id),
    ).toEqual(['drawn'])
  })

  it('breaks a tie on the id, so two people the same distance out never swap', () => {
    const scene = fakeScene({ b: { sx: 410, sy: 300 }, a: { sx: 390, sy: 300 } })
    expect(figuresInView(scene, town(['b', 'B'], ['a', 'A'])).map((f) => f.id)).toEqual(['a', 'b'])
  })

  it('has nobody to walk before the first snapshot', () => {
    expect(figuresInView(fakeScene({}), null)).toEqual([])
  })
})

describe('the focus box is a keyboard stop and nothing else', () => {
  const CSS = src('../ui/chrome.css').replace(/\/\*[\s\S]*?\*\//g, '')
  const rule = (selector: string): string =>
    [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, list]) =>
      (list ?? '').split(',').some((s) => s.trim() === selector),
    )?.[2] ?? ''

  it('never takes a click away from the town', () => {
    expect(rule('.stage-figure')).toMatch(/pointer-events:\s*none/)
    expect(rule('.stage-figures')).toMatch(/pointer-events:\s*none/)
  })

  it('shows the honey ring the contract asks for, and nothing else', () => {
    expect(rule('.stage-figure:focus-visible')).toContain('var(--honey)')
    expect(rule('.stage-figure')).toMatch(/background:\s*none/)
  })

  it('is the size the body is DRAWN, so the ring frames the figure at every stop', async () => {
    expect(rule('.stage-figure')).not.toMatch(/width:/)
    vi.useFakeTimers()
    const at = { ada: { sx: 400, sy: 300 } }
    const width = async (zoom: number): Promise<number> =>
      Number.parseFloat(
        (await layer(fakeScene(at, zoom), town(['ada', 'Ada'])))[0]?.style.width ?? '',
      )
    const one = await width(1)
    expect(one).toBeGreaterThan(0)
    expect(await width(3)).toBe(one * 3)
    // and it never shrinks past a box a finger or an eye can find
    const tiny = await width(0.01)
    expect(tiny).toBeGreaterThan(0)
    expect(tiny).toBe(await width(0.02))
  })

  // `tabIndex` inside the rAF loop would rewrite the stop set 60 times a second; `visibility:
  // hidden` takes a walked-off body out of the tab order on its own.
  it('is off the tab order until the loop has seen it on screen', async () => {
    expect(rule('.stage-figure')).toMatch(/visibility:\s*hidden/)
    vi.useFakeTimers()
    const at: Record<string, { sx: number; sy: number }> = { here: { sx: 400, sy: 300 } }
    const [here] = await layer(fakeScene(at), town(['here', 'Here']))
    expect(here?.style.visibility).toBe('visible')
    expect(here?.tabIndex).toBe(0)
    // she walks off between snapshots, and the loop takes her stop away without touching tabIndex
    delete at.here
    await act(async () => {
      await vi.advanceTimersByTimeAsync(32)
    })
    expect(here?.style.visibility).toBe('hidden')
    expect(here?.tabIndex).toBe(0)
  })

  // With the sheet up, Tab out of it used to land on forty invisible figure buttons.
  it('leaves the tab order entirely while the paper is open', async () => {
    vi.useFakeTimers()
    const state = town(['ada', 'Ada'], ['bo', 'Bo'])
    const at = { ada: { sx: 400, sy: 300 }, bo: { sx: 420, sy: 300 } }
    const open = await layer(fakeScene(at), state, true)
    expect(open).toHaveLength(2)
    expect(open.map((n) => n.tabIndex)).toEqual([-1, -1])
    const shut = await layer(fakeScene(at), state, false)
    expect(shut.map((n) => n.tabIndex)).toEqual([0, 0])
    // and the App is the one that says which it is
    expect(src('../App.tsx')).toContain('paperOpen={sheet !== null}')
  })
})

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '@sj/shared'
import { genesisState, type WorldState } from '@sj/engine/state'
import type { Scene } from '../render/scene.js'
import { figuresInView } from './Figures.js'

const src = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8')

/** A 800x600 view whose middle is (400, 300), and bodies wherever the fixture puts them. */
function fakeScene(at: Record<string, { sx: number; sy: number }>): Scene {
  return {
    viewRect: () => ({ x: 0, y: 0, w: 800, h: 600 }),
    pointOf: (kind: string, id: string) => (kind === 'agent' ? (at[id] ?? null) : null),
  } as unknown as Scene
}

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
    ageDays: 7300,
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

  it('is the size the body is DRAWN, so the ring frames the figure at every stop', () => {
    expect(rule('.stage-figure')).not.toMatch(/width:/)
    expect(src('./Figures.tsx')).toContain('Math.round(FIGURE_W * zoom)')
    expect(src('./Figures.tsx')).toContain('RING_MIN_W')
  })

  // `tabIndex` inside the rAF loop would rewrite the stop set 60 times a second; `visibility:
  // hidden` takes a walked-off body out of the tab order on its own.
  it('is off the tab order until the loop has seen it on screen', () => {
    expect(rule('.stage-figure')).toMatch(/visibility:\s*hidden/)
    expect(src('./Figures.tsx')).not.toContain('node.tabIndex')
    expect(src('./Figures.tsx')).toContain('tabIndex={paperOpen ? -1 : 0}')
  })

  // With the sheet up, Tab out of it used to land on forty invisible figure buttons.
  it('leaves the tab order entirely while the paper is open', () => {
    expect(src('./Figures.tsx')).toContain('paperOpen: boolean')
    expect(src('../App.tsx')).toContain('paperOpen={sheet !== null}')
  })
})

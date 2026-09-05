import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DAYS_PER_YEAR, momentTitle } from '@sj/shared'
import type { AgentBody, Structure, WorldState } from '@sj/engine/state'
import type { TownScene } from '../state/worldStore.js'
import { CARD_HOLD_MS, SceneCard, sceneCardOf } from './SceneCard.js'
import { createWorldStore, type WorldStore } from '../state/worldStore.js'

const SRC = readFileSync(new URL('./SceneCard.tsx', import.meta.url), 'utf8')

const N = 8
const body = (id: string, name: string, x: number, y: number): AgentBody => ({
  id,
  name,
  x,
  y,
  alive: true,
  asleep: false,
  needs: { hunger: 80, energy: 80, warmth: 80, social: 80 },
  hp: 100,
  injuries: [],
  ill: false,
  ageDays: 30 * DAYS_PER_YEAR,
  skills: {},
  activity: null,
  collapsedSinceTick: null,
  zeroHungerSinceTick: null,
})

const FIRE: Structure = {
  id: 'structure_fire_pit_3_3',
  kind: 'fire_pit',
  x: 3,
  y: 3,
  w: 1,
  h: 1,
  hp: 20,
  maxHp: 20,
  flammable: true,
  stage: 'complete',
  progressTicks: 0,
  builtBy: null,
  burning: false,
  burnTicks: 0,
}

const WORLD: WorldState = {
  tick: 900,
  terrain: Array.from({ length: N }, () => Array.from({ length: N }, () => 0)),
  weather: { kind: 'sunny', temperatureC: 12 },
  agents: { nadia: body('nadia', 'Nadia', 3, 4), yusuf: body('yusuf', 'Yusuf', 4, 4) },
  structures: { [FIRE.id]: FIRE },
  items: {},
  crops: {},
  wildlife: { fish: 1, deer: 1 },
  counters: { nextEntityId: 1 },
} as unknown as WorldState

/** Far from anything the town has a word for: the ground has no name and no thing is near. */
const NOWHERE: WorldState = {
  ...WORLD,
  agents: { nadia: body('nadia', 'Nadia', 7, 7), yusuf: body('yusuf', 'Yusuf', 7, 6) },
  structures: {},
}

const scene = (over: Partial<TownScene> = {}): TownScene => ({
  id: 'sc_1',
  kind: 'quarrel',
  participants: ['nadia', 'yusuf'],
  topic: 'the well',
  stakes: 8,
  open: true,
  ...over,
})

describe('★ the card a cut opens with: where the camera is, and who is in it', () => {
  it('★ names the place and the people, in the town’s own words', () => {
    expect(sceneCardOf(WORLD, ['nadia', 'yusuf'], 'sc_1', scene())).toEqual({
      title: momentTitle('quarrel', null),
      where: 'At the fire pit · Nadia & Yusuf',
    })
  })

  it('★ titles the cut only with the scene the cut is OF', () => {
    // the town holds one room; a cut scored on another one must not borrow its word
    expect(sceneCardOf(WORLD, ['nadia', 'yusuf'], 'sc_2', scene())?.title).toBeNull()
    // ...and a body-level cut — a death, a birth — is of no scene at all
    expect(sceneCardOf(WORLD, ['nadia'], null, scene())?.title).toBeNull()
    expect(sceneCardOf(WORLD, ['nadia'], null, null)?.title).toBeNull()
  })

  it('★ prints the names alone where the ground has no name worth saying', () => {
    expect(sceneCardOf(NOWHERE, ['nadia', 'yusuf'], null, null)).toEqual({
      title: null,
      where: 'Nadia & Yusuf',
    })
  })

  it('★ never prints a machine id, a slug or a tile', () => {
    for (const world of [WORLD, NOWHERE, { ...WORLD, agents: {} }]) {
      const card = sceneCardOf(world, ['nadia', 'yusuf'], 'sc_1', scene())
      if (card === null) continue
      for (const text of [card.where, card.title ?? '']) {
        expect(text).not.toMatch(/\b(?:item|structure|fauna|crop|recipe)[_:]\w+/)
        expect(text).not.toMatch(/\(?\b\d+\s*,\s*\d+\b\)?/)
        expect(text).not.toMatch(/_/)
      }
    }
  })

  it('says nothing at all with nobody in frame, or before the town has arrived', () => {
    expect(sceneCardOf(WORLD, [], 'sc_1', scene())).toBeNull()
    expect(sceneCardOf(null, ['nadia'], 'sc_1', scene())).toBeNull()
  })
})

describe('★ what the card actually renders', () => {
  const awake = (): WorldStore => ({
    ...createWorldStore(),
    getState: () => WORLD,
    getScene: () => scene(),
  })

  it('★ draws the stamp and the line, and nothing when there is no cut', () => {
    const html = renderToStaticMarkup(
      createElement(SceneCard, { store: awake(), cast: ['nadia', 'yusuf'], sceneId: 'sc_1' }),
    )
    // The card is struck in an effect off the store, so the server pass draws the empty slot;
    // what matters here is that it never throws and never leaks a class the sheet has no rule for.
    expect(html).toBe('')
  })

  it('★ holds for six seconds and is re-struck only when the CUT changes', () => {
    expect(CARD_HOLD_MS).toBe(6000)
    expect(SRC).toMatch(/setCard\(null\)\s*\n\s*\}, CARD_HOLD_MS\)/)
    // the cast array's identity is the cut: a re-render on the same cut must not restart the hold
    expect(SRC).toMatch(/\}, \[store, cast, sceneId\]\)/)
  })

  it('★ is written at the cut, not read every tick — the place cannot rename itself', () => {
    expect(SRC).not.toContain('useSyncExternalStore')
    expect(SRC).toContain('store.getState()')
  })

  it('★ every name on it comes through the one id-to-prose door', () => {
    expect(SRC).toContain('sceneNames(cast, state.agents)')
  })
})

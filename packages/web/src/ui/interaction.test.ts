import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '@sj/shared'
import { genesisState, type WorldState } from '@sj/engine/state'
import { CROP_STAGES, hoverLabel, itemCropDetail, lensFromKey, lensKeyAllowed } from './interaction.js'
import { LENSES } from './route.js'

function fixture(): WorldState {
  const s = genesisState(DEFAULT_CONFIG)
  return {
    ...s,
    agents: {
      rahel: { ...blankAgent('rahel', 'Rahel') },
      builder: { ...blankAgent('builder', 'Tomas') },
    },
    structures: {
      h1: structure('h1', 'hut', 'builder'),
      h2: { ...structure('h2', 'storehouse', null) },
      h3: { ...structure('h3', 'shed', 'ghost') }, // builder id no longer in the roster
    },
    items: {
      i1: { id: 'i1', kind: 'bread', qty: 3, loc: { t: 'tile', x: 1, y: 1 } },
      i2: { id: 'i2', kind: 'bread', qty: 3, owner: 'rahel', loc: { t: 'tile', x: 2, y: 2 } },
      i3: { id: 'i3', kind: 'axe', qty: 1, owner: 'nobody', loc: { t: 'tile', x: 3, y: 3 } },
    },
    crops: {
      c1: { id: 'c1', kind: 'wheat', x: 4, y: 4, plantedDay: 2, stage: 3, withered: false },
    },
  }
}

function blankAgent(id: string, name: string): WorldState['agents'][string] {
  return {
    id, name, x: 0, y: 0, alive: true, asleep: false,
    needs: { hunger: 1, energy: 1, warmth: 1, social: 1 },
    hp: 10, injuries: [], ill: false, ageDays: 7300, skills: {}, activity: null,
    collapsedSinceTick: null, zeroHungerSinceTick: null,
  }
}

function structure(id: string, kind: string, builtBy: string | null): WorldState['structures'][string] {
  return {
    id, kind, x: 0, y: 0, w: 2, h: 2, hp: 10, maxHp: 10, flammable: true,
    stage: 'complete', progressTicks: 0, builtBy, burning: false, burnTicks: 0,
  }
}

describe('hoverLabel', () => {
  const state = fixture()

  it('names a townsperson and nothing else', () => {
    expect(hoverLabel(state, 'agent', 'rahel')).toBe('Rahel')
  })

  it('credits the builder of a structure, and stays quiet when no one is remembered', () => {
    expect(hoverLabel(state, 'structure', 'h1')).toBe('hut — built by Tomas')
    expect(hoverLabel(state, 'structure', 'h2')).toBe('storehouse')
  })

  it('falls back to the raw builder id rather than inventing a name', () => {
    expect(hoverLabel(state, 'structure', 'h3')).toBe('shed — built by ghost')
  })

  it('counts an item and marks it when someone owns it', () => {
    expect(hoverLabel(state, 'item', 'i1')).toBe('bread ×3')
    expect(hoverLabel(state, 'item', 'i2')).toBe('bread ×3 · Rahel’s')
  })

  it('names an unknown owner by id rather than dropping the claim', () => {
    expect(hoverLabel(state, 'item', 'i3')).toBe('axe ×1 · nobody’s')
  })

  it('shows how far a crop has come', () => {
    expect(hoverLabel(state, 'crop', 'c1')).toBe(`wheat (stage 3/${CROP_STAGES})`)
  })

  it('returns null for anything the town does not have', () => {
    expect(hoverLabel(state, 'agent', 'nope')).toBeNull()
    expect(hoverLabel(state, 'structure', 'nope')).toBeNull()
    expect(hoverLabel(state, 'item', 'nope')).toBeNull()
    expect(hoverLabel(state, 'crop', 'nope')).toBeNull()
    expect(hoverLabel(null, 'agent', 'rahel')).toBeNull()
  })
})

describe('itemCropDetail', () => {
  const state = fixture()

  it('says who holds a thing, or that nobody has claimed it', () => {
    expect(itemCropDetail(state, 'item', 'i2')).toBe('bread ×3, owned by Rahel')
    expect(itemCropDetail(state, 'item', 'i1')).toBe('bread ×3, claimed by no one')
  })

  it('dates a crop and says how far it has come', () => {
    expect(itemCropDetail(state, 'crop', 'c1')).toBe(`wheat, planted day 2, stage 3/${CROP_STAGES}`)
  })

  it('says when a crop has withered instead of pretending it grows', () => {
    const withered: WorldState = {
      ...state,
      crops: { c1: { ...state.crops.c1!, withered: true } },
    }
    expect(itemCropDetail(withered, 'crop', 'c1')).toBe(`wheat, planted day 2, withered`)
  })

  it('returns null for anything the town does not have', () => {
    expect(itemCropDetail(state, 'item', 'nope')).toBeNull()
    expect(itemCropDetail(state, 'crop', 'nope')).toBeNull()
    expect(itemCropDetail(null, 'item', 'i1')).toBeNull()
  })
})

describe('lensFromKey', () => {
  it('walks right through the lens bar and wraps at the end', () => {
    expect(lensFromKey('ArrowRight', 'map')).toBe(LENSES[1])
    expect(lensFromKey('ArrowRight', LENSES[LENSES.length - 1]!)).toBe(LENSES[0])
  })

  it('walks left and wraps at the start', () => {
    expect(lensFromKey('ArrowLeft', LENSES[1]!)).toBe(LENSES[0])
    expect(lensFromKey('ArrowLeft', LENSES[0]!)).toBe(LENSES[LENSES.length - 1])
  })

  it('ignores every other key', () => {
    for (const key of ['ArrowUp', 'ArrowDown', 'a', 'Enter', ' ', 'Home']) {
      expect(lensFromKey(key, 'map'), key).toBeNull()
    }
  })
})

describe('lensKeyAllowed', () => {
  it('lets the arrows cycle lenses from ordinary chrome', () => {
    expect(lensKeyAllowed('BUTTON', false, false)).toBe(true)
    expect(lensKeyAllowed('DIV', false, false)).toBe(true)
  })

  it('never steals an arrow key from a text field', () => {
    expect(lensKeyAllowed('INPUT', false, false)).toBe(false)
    expect(lensKeyAllowed('TEXTAREA', false, false)).toBe(false)
    expect(lensKeyAllowed('SELECT', false, false)).toBe(false)
    expect(lensKeyAllowed('DIV', true, false)).toBe(false)
  })

  it('leaves the arrows to the map, which pans with them', () => {
    expect(lensKeyAllowed('DIV', false, true)).toBe(false)
  })
})

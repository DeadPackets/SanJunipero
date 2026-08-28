import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '@sj/shared'
import { genesisState, type WorldState } from '@sj/engine/state'
import { CROP_STAGES, hoverLabel } from './interaction.js'

function fixture(): WorldState {
  const s = genesisState(DEFAULT_CONFIG)
  return {
    ...s,
    agents: {
      rahel: { ...blankAgent('rahel', 'Rahel') },
      builder: { ...blankAgent('builder', 'Tomas') },
    },
    structures: {
      h1: structure('h1', 'house', 'builder'),
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
    id,
    name,
    x: 0,
    y: 0,
    alive: true,
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

function structure(
  id: string,
  kind: string,
  builtBy: string | null,
): WorldState['structures'][string] {
  return {
    id,
    kind,
    x: 0,
    y: 0,
    w: 2,
    h: 2,
    hp: 10,
    maxHp: 10,
    flammable: true,
    stage: 'complete',
    progressTicks: 0,
    builtBy,
    burning: false,
    burnTicks: 0,
  }
}

describe('hoverLabel', () => {
  const state = fixture()

  it('names a townsperson and nothing else', () => {
    expect(hoverLabel(state, 'agent', 'rahel')).toBe('Rahel')
  })

  it('credits the builder of a structure, and stays quiet when no one is remembered', () => {
    expect(hoverLabel(state, 'structure', 'h1')).toBe('house — built by Tomas')
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

import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '@sj/shared'
import { genesisState, type WorldState } from '@sj/engine/state'
import { readFileSync } from 'node:fs'
import { CROP_STAGES, escapeStep, hoverLabel, type StageUp } from './interaction.js'

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

  it('★ says nothing about a builder who is not a person here — never a raw id', () => {
    expect(hoverLabel(state, 'structure', 'h3')).toBe('shed')
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

// ── ★ ONE ESCAPE LADDER ──────────────────────────────────────────────────────────────────
//
// Escape used to be owned three times over: the stage hook, the sheet's own window listener
// and the ring's key handler. Three owners cannot agree an order, so a sheet over a pick came
// down together with the pick.
describe('escape puts down one thing at a time, topmost first', () => {
  const up = (over: Partial<StageUp> = {}): StageUp => ({
    paper: false,
    interior: false,
    subject: false,
    fullscreen: false,
    ...over,
  })

  it('★ the sheet comes down before the room, the room before the pick', () => {
    expect(escapeStep(up({ paper: true, interior: true, subject: true }))).toBe('paper')
    expect(escapeStep(up({ interior: true, subject: true }))).toBe('interior')
    expect(escapeStep(up({ subject: true }))).toBe('subject')
  })

  it('★ fullscreen is the last rung, never the first', () => {
    expect(escapeStep(up({ paper: true, fullscreen: true }))).toBe('paper')
    expect(escapeStep(up({ subject: true, fullscreen: true }))).toBe('subject')
    expect(escapeStep(up({ fullscreen: true }))).toBe('fullscreen')
  })

  it('★ answers nothing when the town is already bare', () => {
    expect(escapeStep(up())).toBeNull()
  })

  it('★ nothing else in the web tree listens for Escape', () => {
    const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8')
    for (const f of ['../paper/Paper.tsx', '../stage/SubjectRing.tsx'])
      expect(src(f), f).not.toContain('Escape')
    expect(src('../App.tsx')).toContain('escapeStep(')
  })
})

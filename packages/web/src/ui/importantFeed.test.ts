import { describe, expect, it } from 'vitest'
import {
  CHRONICLE_FALLBACK_ICON,
  CHRONICLE_ICONS,
  MILESTONE_ICON,
  chronicleIcon,
  type SimEvent,
} from '@sj/shared'
import { DEFAULT_CONFIG } from '@sj/shared'
import { genesisState, type WorldState } from '@sj/engine/state'
import { CHRONICLE_GLYPH, GLYPH_PALETTE, chronicleGlyph, chronicleLabel } from './importantFeed.js'

const EMOJI = /\p{Extended_Pictographic}/u

function fixture(): WorldState {
  const s = genesisState(DEFAULT_CONFIG)
  return {
    ...s,
    agents: {
      a1: agent('a1', 'Rahel'),
      a2: agent('a2', 'Tomas'),
    },
    structures: {
      s1: {
        id: 's1',
        kind: 'house',
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        hp: 5,
        maxHp: 5,
        flammable: true,
        stage: 'complete',
        progressTicks: 0,
        builtBy: 'a2',
        burning: false,
        burnTicks: 0,
      },
    },
  }
}

function agent(id: string, name: string): WorldState['agents'][string] {
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

const ev = (type: string, payload: unknown): SimEvent => ({ seq: 1, tick: 7, type, payload })

describe('chronicleLabel', () => {
  const state = fixture()

  it('writes the entries the town would remember', () => {
    expect(chronicleLabel(ev('agent_died', { agentId: 'a1', cause: 'exposure' }), state)).toBe(
      'Rahel froze.',
    )
    expect(
      chronicleLabel(
        ev('agent_born', { id: 'a3', name: 'Mira', motherId: 'a1', fatherId: 'a2' }),
        state,
      ),
    ).toBe('Mira was born.')
    expect(chronicleLabel(ev('co_slept', { aId: 'a1', bId: 'a2', day: 1 }), state)).toBe(
      'Rahel and Tomas kept house together.',
    )
    expect(chronicleLabel(ev('structure_completed', { id: 's1' }), state)).toBe(
      'The house is finished.',
    )
    expect(
      chronicleLabel(
        ev('structure_inscribed', { structureId: 's1', text: 'ours', agentId: 'a1' }),
        state,
      ),
    ).toBe('New words carved on the house.')
  })

  it('says nothing about a type it has no words for', () => {
    expect(chronicleLabel(ev('some_future_event', {}), state)).toBeNull()
    expect(chronicleLabel(ev('agent_moved', { id: 'a1', x: 1, y: 1 }), state)).toBeNull()
  })

  it('leaves a mystery to the chronicle endpoint, which holds the authored prose', () => {
    expect(chronicleLabel(ev('mystery_event', { kind: 'far_bell' }), state)).toBeNull()
  })

  it('falls back to raw ids rather than inventing a person before the first snapshot', () => {
    expect(chronicleLabel(ev('agent_died', { agentId: 'a1', cause: 'exposure' }), null)).toBe(
      'a1 froze.',
    )
  })
})

describe('the chronicle glyphs', () => {
  it('draws every icon the chronicle can carry, firsts included', () => {
    for (const icon of new Set([...Object.values(CHRONICLE_ICONS), MILESTONE_ICON])) {
      expect(CHRONICLE_GLYPH[icon], icon).toBeDefined()
    }
  })

  it('falls back to a drawn glyph rather than a hole for a future icon', () => {
    expect(chronicleGlyph('not_an_icon')).toBe(chronicleGlyph('star'))
    expect(chronicleGlyph('cross').pixels.length).toBeGreaterThan(0)
  })

  it('paints only in the master palette, and only on the 8×8 grid', () => {
    for (const [icon, glyph] of Object.entries(CHRONICLE_GLYPH)) {
      expect(glyph.label.length, icon).toBeGreaterThan(0)
      for (const [x, y, fill] of glyph.pixels) {
        expect(GLYPH_PALETTE, `${icon} ${fill}`).toContain(fill)
        expect(x, icon).toBeGreaterThanOrEqual(0)
        expect(x, icon).toBeLessThan(8)
        expect(y, icon).toBeGreaterThanOrEqual(0)
        expect(y, icon).toBeLessThan(8)
      }
    }
  })

  it('never borrows an emoji — the glyph is the town’s own pixels', () => {
    for (const glyph of Object.values(CHRONICLE_GLYPH)) expect(glyph.label).not.toMatch(EMOJI)
  })

  it('names each glyph for a reader who cannot see it', () => {
    expect(chronicleGlyph('cross').label).toMatch(/death|died/i)
    expect(chronicleGlyph('flame').label).toMatch(/fire/i)
  })
})

describe('the discovery glyph', () => {
  it('exists under the icon the chronicle names, and is not the fallback', () => {
    expect(chronicleGlyph('key').pixels).not.toEqual(chronicleGlyph(CHRONICLE_FALLBACK_ICON).pixels)
    expect(chronicleGlyph(chronicleIcon('discovery_made')).pixels).toEqual(
      chronicleGlyph('key').pixels,
    )
  })

  it('is 8×8 and paints only the palette', () => {
    for (const [x, y, fill] of chronicleGlyph('key').pixels) {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(8)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThan(8)
      expect(GLYPH_PALETTE).toContain(fill)
    }
  })

  it('is a shape no other chronicle glyph draws', () => {
    const all = Object.entries(CHRONICLE_GLYPH).map(([, g]) => JSON.stringify(g.pixels))
    expect(new Set(all).size).toBe(all.length)
  })

  it('says what it is, for a reader who cannot see it', () => {
    expect(chronicleGlyph('key').label).toBe('a discovery')
  })
})

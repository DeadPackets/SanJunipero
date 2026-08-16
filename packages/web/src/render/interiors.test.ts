import { describe, expect, it } from 'vitest'
import {
  CITY_FURNISHING_KINDS, DEFAULT_CONFIG, INTERIOR_KINDS,
  type AssetRecord, type LibraryItemManifest,
} from '@sj/shared'
import { genesisState, type WorldState } from '@sj/engine/state'
import {
  BED_FOOTPRINT, INTERIOR_FADE_MS, INTERIOR_LAYOUTS, advanceInterior, bedSlots, interiorOf,
  interiorTransition, roomFurnishings, roomPlan, type InteriorPhase,
} from './interiors.js'

function agent(id: string, over: Partial<WorldState['agents'][string]> = {}): WorldState['agents'][string] {
  return {
    id, name: id, x: 0, y: 0, alive: true, asleep: false,
    needs: { hunger: 1, energy: 1, warmth: 1, social: 1 },
    hp: 10, injuries: [], ill: false, ageDays: 7300, skills: {}, activity: null,
    collapsedSinceTick: null, zeroHungerSinceTick: null, ...over,
  }
}

function structure(id: string, kind: string): WorldState['structures'][string] {
  return {
    id, kind, x: 3, y: 4, w: 2, h: 2, hp: 10, maxHp: 10, flammable: true,
    stage: 'complete', progressTicks: 0, builtBy: null, burning: false, burnTicks: 0,
  }
}

function fixture(): WorldState {
  const s = genesisState(DEFAULT_CONFIG)
  return {
    ...s,
    agents: {
      amara: agent('amara', { insideId: 'hut1', asleep: true }),
      yusuf: agent('yusuf', { insideId: 'hut1' }),
      nadia: agent('nadia'),                                  // outside
      omar: agent('omar', { insideId: 'store1' }),
    },
    structures: {
      hut1: structure('hut1', 'hut'),
      store1: structure('store1', 'storehouse'),
      shed1: structure('shed1', 'shed'),
      stone: structure('stone', 'standing_stone'),
    },
    items: {
      i1: { id: 'i1', kind: 'bread', qty: 2, loc: { t: 'structure', id: 'store1' } },
      i2: { id: 'i2', kind: 'axe', qty: 1, loc: { t: 'structure', id: 'store1' } },
      i3: { id: 'i3', kind: 'timber', qty: 1, loc: { t: 'tile', x: 1, y: 1 } },
      i4: { id: 'i4', kind: 'stew', qty: 1, loc: { t: 'agent', id: 'amara' } },
    },
    crops: {},
  }
}

const libraryRecord = (kind: string, interior: LibraryItemManifest['interior']): AssetRecord => ({
  id: `rec-${kind}`, seq: 1, class: 'item', kind, status: 'ready',
  desc: kind, meta: JSON.stringify({
    version: 'v1-library-item', kind, category: 'furniture', spritePx: 24, iconPx: 24, interior,
  }),
  footprint: { w: 1, h: 1 }, widthPx: 24, heightPx: 24,
  score: 10, attempts: 1, costUsd: 0, createdAt: '2026-08-17T00:00:00Z',
})

describe('interiorOf', () => {
  it('reads occupancy and stored items off C9 engine truth', () => {
    const hut = interiorOf(fixture(), 'hut1')
    expect(hut).not.toBeNull()
    expect(hut!.kind).toBe('hut')
    expect(hut!.structure.id).toBe('hut1')
    expect(hut!.occupants).toEqual(['amara', 'yusuf'])
    expect(hut!.items).toEqual([])

    const store = interiorOf(fixture(), 'store1')!
    expect(store.kind).toBe('storehouse')
    expect(store.occupants).toEqual(['omar'])
    expect(store.items).toEqual(['i1', 'i2'])          // tile-held and carried items stay out
  })

  it('is null for a structure with no interior, and for an unknown id', () => {
    expect(interiorOf(fixture(), 'stone')).toBeNull()
    expect(interiorOf(fixture(), 'nope')).toBeNull()
  })

  it('returns an empty room rather than null when nobody is inside', () => {
    const shed = interiorOf(fixture(), 'shed1')!
    expect(shed.kind).toBe('shed')
    expect(shed.occupants).toEqual([])
    expect(shed.items).toEqual([])
  })

  it('orders occupants and items by id, so two viewers lay the same room out', () => {
    const s = fixture()
    const reversed: WorldState = {
      ...s,
      agents: { yusuf: s.agents['yusuf']!, amara: s.agents['amara']! },
    }
    expect(interiorOf(reversed, 'hut1')!.occupants).toEqual(interiorOf(s, 'hut1')!.occupants)
  })
})

describe('INTERIOR_LAYOUTS and roomFurnishings', () => {
  it('keeps the plan\'s three declared layouts intact', () => {
    expect(INTERIOR_LAYOUTS.hut).toEqual([
      { kind: 'bed', slot: { x: 2, y: 1 } },
      { kind: 'hearth', slot: { x: 0, y: 2 } },
      { kind: 'table', slot: { x: 1, y: 2 } },
    ])
    expect(INTERIOR_LAYOUTS.storehouse.map((f) => f.kind)).toEqual(['shelf', 'shelf', 'crate'])
    expect(INTERIOR_LAYOUTS.shed.map((f) => f.kind)).toEqual(['tools', 'crate'])
  })

  it('furnishes every interior kind from the C13 city template, resolving `tools`', () => {
    const hut = roomFurnishings('hut')
    expect(hut.map((f) => f.kind)).toEqual(['bed', 'hearth', 'table', 'chair', 'rug'])
    expect(roomFurnishings('storehouse').map((f) => f.kind))
      .toEqual(['shelf', 'shelf', 'crate', 'crate', 'barrel'])
    // the plan's `tools` is the library's anvil (interiorMeta's declared alias)
    expect(roomFurnishings('shed').map((f) => f.kind)).toEqual(['anvil', 'bench', 'shelf'])
    for (const kind of INTERIOR_KINDS) {
      for (const f of roomFurnishings(kind)) {
        expect(CITY_FURNISHING_KINDS as readonly string[]).toContain(f.kind)
        expect(f.slot.x).toBeGreaterThanOrEqual(0)
        expect(f.slot.y).toBeGreaterThanOrEqual(0)
      }
    }
  })
})

describe('roomPlan', () => {
  it('attaches the C13 library\'s meta.interior and sprite url to each furnishing', () => {
    const records = [
      libraryRecord('bed', { slots: { w: 1, h: 2 }, placement: 'floor', interiorKinds: ['hut'], isBed: true }),
      libraryRecord('hearth', {
        slots: { w: 1, h: 1 }, placement: 'wall', interiorKinds: ['hut'], isHearth: true, providesLight: true,
      }),
    ]
    const plan = roomPlan('hut', records)
    const bed = plan.find((p) => p.kind === 'bed')!
    expect(bed.meta?.isBed).toBe(true)
    expect(bed.meta?.slots).toEqual({ w: 1, h: 2 })
    expect(bed.url).toBe('/assets/rec-bed.png')
    const hearth = plan.find((p) => p.kind === 'hearth')!
    expect(hearth.meta?.placement).toBe('wall')
    expect(hearth.meta?.providesLight).toBe(true)
    // no record yet → the room still lays out, the caller draws a placeholder
    const table = plan.find((p) => p.kind === 'table')!
    expect(table.meta).toBeNull()
    expect(table.url).toBeNull()
  })

  it('renders with an empty codex — art independence', () => {
    const plan = roomPlan('shed', [])
    expect(plan.map((p) => p.kind)).toEqual(['anvil', 'bench', 'shelf'])
    expect(plan.every((p) => p.url === null && p.meta === null)).toBe(true)
  })
})

describe('bedSlots', () => {
  it('lays two sleepers down on the hut bed at distinct slots', () => {
    const slots = bedSlots('hut', ['amara', 'yusuf'])
    expect(Object.keys(slots).sort()).toEqual(['amara', 'yusuf'])
    expect(slots['amara']).not.toEqual(slots['yusuf'])
    // the bed sits at (2,1) and is 1×2, so its cells are (2,1) and (2,2)
    expect(slots['amara']).toEqual({ x: 2, y: 1 })
    expect(slots['yusuf']).toEqual({ x: 2, y: 2 })
  })

  it('maps nobody in a kind with no bed', () => {
    expect(bedSlots('shed', ['amara'])).toEqual({})
    expect(bedSlots('storehouse', ['amara', 'yusuf'])).toEqual({})
  })

  it('leaves a sleeper past the last bed cell unmapped rather than stacking bodies', () => {
    const slots = bedSlots('hut', ['a', 'b', 'c'])
    expect(Object.keys(slots)).toEqual(['a', 'b'])
    expect(BED_FOOTPRINT).toEqual({ w: 1, h: 2 })
  })

  it('takes the bed footprint from the library record when the codex has one', () => {
    const records = [libraryRecord('bed', {
      slots: { w: 1, h: 1 }, placement: 'floor', interiorKinds: ['hut'], isBed: true,
    })]
    const slots = bedSlots('hut', ['a', 'b'], records)
    expect(Object.keys(slots)).toEqual(['a'])         // a one-cell bed sleeps one
  })

  it('is pure — the same call twice returns the same mapping', () => {
    expect(bedSlots('hut', ['amara', 'yusuf'])).toEqual(bedSlots('hut', ['amara', 'yusuf']))
  })
})

describe('interiorTransition', () => {
  it('walks town → entering → inside when the viewer follows someone in', () => {
    expect(interiorTransition('town', true, 0, 0)).toBe('entering')
    expect(interiorTransition('entering', true, INTERIOR_FADE_MS, 0)).toBe('inside')
  })

  it('walks inside → exiting → town on the way out', () => {
    expect(interiorTransition('inside', false, 0, 0)).toBe('exiting')
    expect(interiorTransition('exiting', false, INTERIOR_FADE_MS, 0)).toBe('town')
  })

  it('is time-gated: before the fade elapses the phase holds', () => {
    expect(interiorTransition('entering', true, INTERIOR_FADE_MS - 1, 0)).toBe('entering')
    expect(interiorTransition('exiting', false, INTERIOR_FADE_MS - 1, 0)).toBe('exiting')
    expect(INTERIOR_FADE_MS).toBeGreaterThanOrEqual(150)   // UI mandate motion band
    expect(INTERIOR_FADE_MS).toBeLessThanOrEqual(300)
  })

  it('reverses mid-fade rather than finishing a transition the viewer abandoned', () => {
    expect(interiorTransition('entering', false, 10, 0)).toBe('exiting')
    expect(interiorTransition('exiting', true, 10, 0)).toBe('entering')
  })

  it('holds still when nothing changed', () => {
    expect(interiorTransition('town', false, 9999, 0)).toBe('town')
    expect(interiorTransition('inside', true, 9999, 0)).toBe('inside')
  })

  it('covers every phase from every phase without throwing', () => {
    const phases: InteriorPhase[] = ['town', 'entering', 'inside', 'exiting']
    for (const p of phases) for (const entered of [true, false]) {
      expect(phases).toContain(interiorTransition(p, entered, 1000, 0))
    }
  })
})

describe('advanceInterior', () => {
  it('stamps sinceMs only when the phase actually moves', () => {
    const a = advanceInterior({ phase: 'town', sinceMs: 0 }, true, 100)
    expect(a).toEqual({ phase: 'entering', sinceMs: 100 })
    const b = advanceInterior(a, true, 200)
    expect(b).toEqual({ phase: 'entering', sinceMs: 100 })   // still fading, clock untouched
    const c = advanceInterior(b, true, 100 + INTERIOR_FADE_MS)
    expect(c).toEqual({ phase: 'inside', sinceMs: 100 + INTERIOR_FADE_MS })
  })

  it('returns the same object when nothing moved, so a 60fps caller allocates nothing', () => {
    const state = { phase: 'inside' as const, sinceMs: 0 }
    expect(advanceInterior(state, true, 5000)).toBe(state)
  })
})

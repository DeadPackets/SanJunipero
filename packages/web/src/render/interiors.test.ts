import { describe, expect, it } from 'vitest'
import {
  CITY_FURNISHING_KINDS, DEFAULT_CONFIG, INTERIOR_KINDS,
  type AssetRecord, type InteriorMeta, type LibraryItemManifest,
} from '@sj/shared'
import { genesisState, type WorldState } from '@sj/engine/state'
import { TILE_H, TILE_W, tileToScreen } from './iso.js'
import { SLOT_TILES, slotSpanCentre } from './roomShell.js'
import {
  BED_FOOTPRINT, CONTACT_SHADOW_ALPHA, FURNITURE_OCCUPANCY, INTERIOR_FADE_MS, INTERIOR_LAYOUTS,
  LIBRARY_MAX_SPRITE_PX, advanceInterior, bedSlots, contactShadow, furnishingScale, interiorOf,
  interiorOrder, interiorPieces, interiorTransition, isFlat, occupancyOf, roomFurnishings,
  roomPlan, type InteriorPhase,
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

// ── TASK 67: furniture that touches the floor, and bodies that lie IN the bed (U4) ────────

const im = (over: Partial<InteriorMeta> = {}): InteriorMeta => ({
  slots: { w: 1, h: 1 }, placement: 'floor', interiorKinds: ['hut'], ...over,
})

const HUT_ITEMS = [
  { kind: 'bed', slot: { x: 2, y: 1 }, meta: im({ slots: { w: 1, h: 2 }, isBed: true }) },
  { kind: 'hearth', slot: { x: 0, y: 2 }, meta: im({ placement: 'wall', providesLight: true }) },
  { kind: 'table', slot: { x: 1, y: 2 }, meta: im() },
  { kind: 'chair', slot: { x: 1, y: 1 }, meta: im() },
  { kind: 'rug', slot: { x: 0, y: 0 }, meta: im({ slots: { w: 1, h: 2 } }) },
]

describe('occupancyOf — what standing "in" a thing means', () => {
  it('names the three ways a body meets a furnishing', () => {
    expect(occupancyOf('bed')).toBe('in')
    expect(occupancyOf('chair')).toBe('in')
    expect(occupancyOf('table')).toBe('at')
    expect(occupancyOf('shelf')).toBe('beside')
  })

  it('is TOTAL over CITY_FURNISHING_KINDS — a kind added to the template fails here', () => {
    for (const kind of CITY_FURNISHING_KINDS) {
      expect(Object.hasOwn(FURNITURE_OCCUPANCY, kind), kind).toBe(true)
      expect(['in', 'at', 'beside'], kind).toContain(FURNITURE_OCCUPANCY[kind])
    }
  })

  it('a kind nobody has classified is "beside" — plain depth order, never a throw', () => {
    expect(occupancyOf('orrery')).toBe('beside')
  })
})

describe('interiorOrder — a sleeper is IN the bed', () => {
  const sleeper = [{ id: 'amara', slot: { x: 2, y: 1 }, inside: 'bed:2,1' }]

  it('splits an "in" furnishing into a back half and a front half, and nothing else', () => {
    const ids = interiorPieces(HUT_ITEMS, []).map((p) => p.id)
    expect(ids).toContain('bed:2,1#back')
    expect(ids).toContain('bed:2,1#front')
    expect(ids).toContain('chair:1,1#back')
    expect(ids).toContain('table:1,2')          // 'at' — one piece
    expect(ids).toContain('rug:0,0')            // 'beside' — one piece
    expect(ids).not.toContain('table:1,2#back')
  })

  it('THE DEFECT, AS A TEST: the landed rule draws a sleeper ON TOP of the whole bed', () => {
    // interiorScene.ts sorted furniture at `slot.x + slot.y` and bodies at the same `+ 0.5`,
    // so a sleeping body was ALWAYS in front of the bed it was lying in.
    const landedZ = (id: string, slot: { x: number; y: number }): number =>
      slot.x + slot.y + (id === 'amara' ? 0.5 : 0)
    const landed = [
      { id: 'bed', slot: { x: 2, y: 1 } },
      { id: 'amara', slot: { x: 2, y: 1 } },
    ].sort((a, b) => landedZ(a.id, a.slot) - landedZ(b.id, b.slot)).map((e) => e.id)
    expect(landed).toEqual(['bed', 'amara'])    // the body last — on top of the bed. RED.
  })

  it('sorts the sleeper AFTER the bed’s back half and BEFORE its front half', () => {
    const order = interiorOrder(interiorPieces(HUT_ITEMS, sleeper))
    const back = order.indexOf('bed:2,1#back')
    const body = order.indexOf('amara')
    const front = order.indexOf('bed:2,1#front')
    expect(back).toBeGreaterThanOrEqual(0)
    expect(back).toBeLessThan(body)
    expect(body).toBeLessThan(front)
  })

  it('a body standing AT a table is behind it', () => {
    const atTable = [{ id: 'yusuf', slot: { x: 1, y: 2 }, inside: 'table:1,2' }]
    const order = interiorOrder(interiorPieces(HUT_ITEMS, atTable))
    expect(order.indexOf('yusuf')).toBeLessThan(order.indexOf('table:1,2'))
  })

  it('is deterministic — two calls agree, and arrival order does not matter', () => {
    const a = interiorOrder(interiorPieces(HUT_ITEMS, sleeper))
    const b = interiorOrder(interiorPieces(HUT_ITEMS, sleeper))
    expect(a).toEqual(b)
    expect(interiorOrder(interiorPieces([...HUT_ITEMS].reverse(), sleeper))).toEqual(a)
  })

  it('two furnishings on the same diagonal settle by id, not by arrival', () => {
    const diag = [
      { kind: 'crate', slot: { x: 2, y: 0 }, meta: im() },
      { kind: 'barrel', slot: { x: 0, y: 2 }, meta: im() },
    ]
    const one = interiorOrder(interiorPieces(diag, []))
    expect(interiorOrder(interiorPieces([...diag].reverse(), []))).toEqual(one)
  })

  it('an empty room renders the same order twice, and no items is no order', () => {
    const a = interiorOrder(interiorPieces(HUT_ITEMS, []))
    expect(interiorOrder(interiorPieces(HUT_ITEMS, []))).toEqual(a)
    expect(interiorOrder(interiorPieces([], []))).toEqual([])
  })
})

describe('furniture stands on its own ground', () => {
  // the landed rule was `slotToScreen(x, y) + TILE_H` for EVERYTHING, whatever its footprint
  const landedFoot = (s: { x: number; y: number }): { sx: number; sy: number } => {
    const p = tileToScreen(s.x * SLOT_TILES, s.y * SLOT_TILES)
    return { sx: p.sx, sy: p.sy + TILE_H }
  }

  it('THE DEFECT, AS A TEST: the landed foot is the FIRST slot’s centre, whatever the size', () => {
    for (const size of [{ w: 1, h: 1 }, { w: 1, h: 2 }, { w: 2, h: 2 }]) {
      expect(landedFoot({ x: 2, y: 1 })).toEqual(slotSpanCentre({ x: 2, y: 1 }, { w: 1, h: 1 }))
      // …so anything bigger than one slot stood off its own ground, and by how much:
      const off = slotSpanCentre({ x: 2, y: 1 }, size)
      const d = Math.hypot(off.sx - landedFoot({ x: 2, y: 1 }).sx, off.sy - landedFoot({ x: 2, y: 1 }).sy)
      expect(d, `${size.w}x${size.h}`).toBe(size.w === 1 && size.h === 1 ? 0 : Math.hypot(
        ((size.w - 1) - (size.h - 1)) * (SLOT_TILES * TILE_W / 4),
        ((size.w - 1) + (size.h - 1)) * (SLOT_TILES * TILE_H / 4),
      ))
    }
    // the hut's bed is 1×2: 16 world px sideways and 8 down, which is 48 × 24 at ROOM_ZOOM 3
    const bed = slotSpanCentre({ x: 2, y: 1 }, { w: 1, h: 2 })
    expect(bed.sx - landedFoot({ x: 2, y: 1 }).sx).toBe(-SLOT_TILES * TILE_W / 4)
    expect(bed.sy - landedFoot({ x: 2, y: 1 }).sy).toBe(SLOT_TILES * TILE_H / 4)
  })

  it('a one-slot piece is unchanged, so nothing that was already right has moved', () => {
    for (const s of [{ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 2, y: 2 }]) {
      expect(slotSpanCentre(s, { w: 1, h: 1 })).toEqual(landedFoot(s))
    }
  })
})

// WHAT THE BROWSER CAUGHT: the room drew library furniture at NATIVE size and bodies at
// CHAR_TARGET_PX, so a sleeper was three times the length of the bed he was lying in.
describe('furnishingScale — one room, one scale', () => {
  it('is the largest INTEGER factor that keeps the biggest library sprite inside a slot', () => {
    expect(furnishingScale(SLOT_TILES)).toBe(2)
    expect(Number.isInteger(furnishingScale(SLOT_TILES))).toBe(true)
    expect(LIBRARY_MAX_SPRITE_PX * furnishingScale(SLOT_TILES))
      .toBeLessThanOrEqual(SLOT_TILES * TILE_W)
  })

  it('puts a bed within reach of the person lying in it', () => {
    const CHAR_TARGET_PX = 52   // charAnim's own target, quoted so the mismatch is measured
    const bed = LIBRARY_MAX_SPRITE_PX * furnishingScale(SLOT_TILES)
    expect(LIBRARY_MAX_SPRITE_PX / CHAR_TARGET_PX).toBeLessThan(0.5)   // the landed mismatch
    expect(bed / CHAR_TARGET_PX).toBeGreaterThan(0.8)                  // and after
  })

  it('never shrinks anything, however small the grid', () => {
    expect(furnishingScale(1)).toBe(1)
    expect(furnishingScale(0)).toBe(1)
  })

  it('a rug lies on the floor; a bed stands on it', () => {
    expect(isFlat('rug')).toBe(true)
    expect(isFlat('bed')).toBe(false)
    expect(isFlat('anything-else')).toBe(false)
  })
})

describe('contactShadow — nothing floats', () => {
  it('is wider than it is tall, at the ratio a dimetric ground plane has', () => {
    const s = contactShadow(24)
    expect(s.rx).toBeGreaterThan(s.ry)
    expect(s.rx / s.ry).toBeCloseTo(2, 6)
    expect(s.alpha).toBe(CONTACT_SHADOW_ALPHA)
  })

  // WHAT THE BROWSER CAUGHT: centred on a bottom-anchored sprite's own anchor, the ellipse
  // hung out below the object and read as the object levitating over its shadow.
  it('lifts by its own half-height, so its near edge lands on the object’s lowest pixel', () => {
    const s = contactShadow(40)
    expect(s.lift).toBe(s.ry)
    expect(0 - s.lift + s.ry).toBe(0)   // the ellipse's bottom sits exactly on the anchor
  })

  it('scales with the thing it sits under, and never inverts', () => {
    expect(contactShadow(48).rx).toBeGreaterThan(contactShadow(24).rx)
    expect(contactShadow(0).rx).toBeGreaterThanOrEqual(0)
    expect(contactShadow(-10).rx).toBeGreaterThanOrEqual(0)
  })
})

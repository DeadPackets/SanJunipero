import { describe, expect, it } from 'vitest'
import {
  CITY_FURNISHING_KINDS, DEFAULT_CONFIG, INTERIOR_KINDS, isBeddedKind, isHearthKind, roomCapacity,
  type AssetRecord, type InteriorKind, type InteriorMeta, type LibraryItemManifest,
} from '@sj/shared'
import { genesisState, type WorldState } from '@sj/engine/state'
import {
  INTERIOR_TILE, ROOM_TILES, WALL_FACING, interiorPath, interiorToScreen, isWalkable, roomMapOf,
  roomTilesFor, slotToTile, standingTiles, walkableCount, wallOfTile, type RoomMap,
} from './interiorMap.js'
import { tileSpanCentre } from './roomShell.js'
import {
  BED_FOOTPRINT, CONTACT_SHADOW_ALPHA, FURNITURE_OCCUPANCY, INTERIOR_FADE_MS, INTERIOR_LAYOUTS,
  LIBRARY_TILE_PX, advanceInterior, bedSlots, contactShadow, furnishingDivisor, furnishingScale,
  interiorOf,
  interiorOrder, interiorPieces, interiorTransition, isFlat, occupancyOf, roomFurnishings,
  roomPlan, roomSizeOf, slotGridOf, type InteriorPhase,
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
      amara: agent('amara', { insideId: 'house1', asleep: true }),
      yusuf: agent('yusuf', { insideId: 'house1' }),
      nadia: agent('nadia'),                                  // outside
      omar: agent('omar', { insideId: 'store1' }),
    },
    structures: {
      house1: structure('house1', 'house'),
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
    const house = interiorOf(fixture(), 'house1')
    expect(house).not.toBeNull()
    expect(house!.kind).toBe('house')
    expect(house!.structure.id).toBe('house1')
    expect(house!.occupants).toEqual(['amara', 'yusuf'])
    expect(house!.items).toEqual([])

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
    expect(interiorOf(reversed, 'house1')!.occupants).toEqual(interiorOf(s, 'house1')!.occupants)
  })
})

describe('INTERIOR_LAYOUTS and roomFurnishings', () => {
  it('keeps the plan\'s three declared layouts intact', () => {
    expect(INTERIOR_LAYOUTS.house).toEqual([
      { kind: 'bed', slot: { x: 2, y: 1 } },
      { kind: 'hearth', slot: { x: 0, y: 2 } },
      { kind: 'table', slot: { x: 1, y: 2 } },
    ])
    expect(INTERIOR_LAYOUTS.storehouse.map((f) => f.kind)).toEqual(['shelf', 'shelf', 'crate'])
    expect(INTERIOR_LAYOUTS.shed.map((f) => f.kind)).toEqual(['tools', 'crate'])
    expect(INTERIOR_LAYOUTS.cabin.map((f) => f.kind)).toEqual(['hearth', 'bench'])
  })

  it('furnishes every interior kind from the C13 city template, resolving `tools`', () => {
    const house = roomFurnishings('house')
    expect(house.map((f) => f.kind)).toEqual(['bed', 'hearth', 'table', 'chair', 'rug'])
    expect(roomFurnishings('storehouse').map((f) => f.kind))
      .toEqual(['shelf', 'shelf', 'crate', 'crate', 'barrel'])
    // The town plan no longer stands a shed, so the room falls back to INTERIOR_LAYOUTS —
    // which is what that fallback is for. The plan's `tools` is still the library's anvil
    // (interiorMeta's declared alias).
    expect(roomFurnishings('shed').map((f) => f.kind)).toEqual(['anvil', 'crate'])
    expect(roomFurnishings('cabin').map((f) => f.kind)).toEqual(['hearth', 'bench', 'crate'])
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
      libraryRecord('bed', { slots: { w: 1, h: 2 }, placement: 'floor', interiorKinds: ['house'], isBed: true }),
      libraryRecord('hearth', {
        slots: { w: 1, h: 1 }, placement: 'wall', interiorKinds: ['house'], isHearth: true, providesLight: true,
      }),
    ]
    const plan = roomPlan('house', records)
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
    expect(plan.map((p) => p.kind)).toEqual(['anvil', 'crate'])
    expect(plan.every((p) => p.url === null && p.meta === null)).toBe(true)
  })
})

describe('bedSlots', () => {
  it('lays two sleepers down on the house bed at distinct slots', () => {
    const slots = bedSlots('house', ['amara', 'yusuf'])
    expect(Object.keys(slots).sort()).toEqual(['amara', 'yusuf'])
    expect(slots['amara']).not.toEqual(slots['yusuf'])
    // the bed sits at (2,1) and is 1×2, so its cells are (2,1) and (2,2)
    // INTERIOR TILES now, not template slots: `slotToTile` puts slot (2,1) on tile (9,2) and
    // the bed is 1x2, so the second sleeper takes the tile behind the first.
    expect(slots['amara']).toEqual(slotToTile({ x: 2, y: 1 }))
    expect(slots['yusuf']).toEqual({ x: 9, y: 3 })
  })

  it('maps nobody in a kind with no bed', () => {
    expect(bedSlots('shed', ['amara'])).toEqual({})
    expect(bedSlots('storehouse', ['amara', 'yusuf'])).toEqual({})
  })

  it('leaves a sleeper past the last bed cell unmapped rather than stacking bodies', () => {
    const slots = bedSlots('house', ['a', 'b', 'c'])
    expect(Object.keys(slots)).toEqual(['a', 'b'])
    expect(BED_FOOTPRINT).toEqual({ w: 1, h: 2 })
  })

  it('takes the bed footprint from the library record when the codex has one', () => {
    const records = [libraryRecord('bed', {
      slots: { w: 1, h: 1 }, placement: 'floor', interiorKinds: ['house'], isBed: true,
    })]
    const slots = bedSlots('house', ['a', 'b'], records)
    expect(Object.keys(slots)).toEqual(['a'])         // a one-cell bed sleeps one
  })

  it('is pure — the same call twice returns the same mapping', () => {
    expect(bedSlots('house', ['amara', 'yusuf'])).toEqual(bedSlots('house', ['amara', 'yusuf']))
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
  slots: { w: 1, h: 1 }, placement: 'floor', interiorKinds: ['house'], ...over,
})

// The house, on the interior tile lattice — `slotToTile` is the boundary between what the
// city template says (a 3x3 slot) and where the room actually puts it (a 12x6 tile map).
const HOUSE_ITEMS = [
  { kind: 'bed', tile: slotToTile({ x: 2, y: 1 }), meta: im({ slots: { w: 1, h: 2 }, isBed: true }) },
  { kind: 'hearth', tile: slotToTile({ x: 0, y: 2 }), meta: im({ placement: 'wall', providesLight: true }) },
  { kind: 'table', tile: slotToTile({ x: 1, y: 2 }), meta: im() },
  { kind: 'chair', tile: slotToTile({ x: 1, y: 1 }), meta: im() },
  { kind: 'rug', tile: slotToTile({ x: 0, y: 0 }), meta: im({ slots: { w: 1, h: 2 } }) },
]
const BED_ID = `bed:${slotToTile({ x: 2, y: 1 }).x},${slotToTile({ x: 2, y: 1 }).y}`
const TABLE_ID = `table:${slotToTile({ x: 1, y: 2 }).x},${slotToTile({ x: 1, y: 2 }).y}`
const CHAIR_ID = `chair:${slotToTile({ x: 1, y: 1 }).x},${slotToTile({ x: 1, y: 1 }).y}`
const RUG_ID = `rug:${slotToTile({ x: 0, y: 0 }).x},${slotToTile({ x: 0, y: 0 }).y}`

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
  const sleeper = [{ id: 'amara', tile: slotToTile({ x: 2, y: 1 }), inside: BED_ID }]

  it('splits an "in" furnishing into a back half and a front half, and nothing else', () => {
    const ids = interiorPieces(HOUSE_ITEMS, []).map((p) => p.id)
    expect(ids).toContain(`${BED_ID}#back`)
    expect(ids).toContain(`${BED_ID}#front`)
    expect(ids).toContain(`${CHAIR_ID}#back`)
    expect(ids).toContain(TABLE_ID)             // 'at' — one piece
    expect(ids).toContain(RUG_ID)               // 'beside' — one piece
    expect(ids).not.toContain(`${TABLE_ID}#back`)
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
    const order = interiorOrder(interiorPieces(HOUSE_ITEMS, sleeper))
    const back = order.indexOf(`${BED_ID}#back`)
    const body = order.indexOf('amara')
    const front = order.indexOf(`${BED_ID}#front`)
    expect(back).toBeGreaterThanOrEqual(0)
    expect(back).toBeLessThan(body)
    expect(body).toBeLessThan(front)
  })

  it('a body standing AT a table is behind it', () => {
    const atTable = [{ id: 'yusuf', tile: slotToTile({ x: 1, y: 2 }), inside: TABLE_ID }]
    const order = interiorOrder(interiorPieces(HOUSE_ITEMS, atTable))
    expect(order.indexOf('yusuf')).toBeLessThan(order.indexOf(TABLE_ID))
  })

  it('is deterministic — two calls agree, and arrival order does not matter', () => {
    const a = interiorOrder(interiorPieces(HOUSE_ITEMS, sleeper))
    const b = interiorOrder(interiorPieces(HOUSE_ITEMS, sleeper))
    expect(a).toEqual(b)
    expect(interiorOrder(interiorPieces([...HOUSE_ITEMS].reverse(), sleeper))).toEqual(a)
  })

  it('two furnishings on the same diagonal settle by id, not by arrival', () => {
    const diag = [
      { kind: 'crate', tile: slotToTile({ x: 2, y: 0 }), meta: im() },
      { kind: 'barrel', tile: slotToTile({ x: 0, y: 2 }), meta: im() },
    ]
    const one = interiorOrder(interiorPieces(diag, []))
    expect(interiorOrder(interiorPieces([...diag].reverse(), []))).toEqual(one)
  })

  it('an empty room renders the same order twice, and no items is no order', () => {
    const a = interiorOrder(interiorPieces(HOUSE_ITEMS, []))
    expect(interiorOrder(interiorPieces(HOUSE_ITEMS, []))).toEqual(a)
    expect(interiorOrder(interiorPieces([], []))).toEqual([])
  })
})

describe('furniture stands on its own ground', () => {
  // the landed rule was the FIRST cell's centre for EVERYTHING, whatever its footprint
  const landedFoot = (t: { x: number; y: number }): { sx: number; sy: number } => {
    const p = interiorToScreen(t.x, t.y)
    return { sx: p.sx, sy: p.sy + INTERIOR_TILE.h / 2 }
  }

  it('THE DEFECT, AS A TEST: the landed foot is the FIRST cell’s centre, whatever the size', () => {
    const at = { x: 9, y: 2 }
    for (const size of [{ w: 1, h: 1 }, { w: 1, h: 2 }, { w: 2, h: 2 }]) {
      expect(landedFoot(at)).toEqual(tileSpanCentre(at, { w: 1, h: 1 }))
      // …so anything bigger than one tile stood off its own ground, and by how much:
      const off = tileSpanCentre(at, size)
      const d = Math.hypot(off.sx - landedFoot(at).sx, off.sy - landedFoot(at).sy)
      expect(d, `${size.w}x${size.h}`).toBe(size.w === 1 && size.h === 1 ? 0 : Math.hypot(
        ((size.w - 1) - (size.h - 1)) * (INTERIOR_TILE.w / 4),
        ((size.w - 1) + (size.h - 1)) * (INTERIOR_TILE.h / 4),
      ))
    }
    // the house's bed is 1x2: 32 px sideways and 16 down on the interior lattice
    const bed = tileSpanCentre(at, { w: 1, h: 2 })
    expect(bed.sx - landedFoot(at).sx).toBe(-INTERIOR_TILE.w / 4)
    expect(bed.sy - landedFoot(at).sy).toBe(INTERIOR_TILE.h / 4)
  })

  it('a one-tile piece is unchanged, so nothing that was already right has moved', () => {
    for (const t of [{ x: 0, y: 0 }, { x: 5, y: 4 }, { x: 9, y: 4 }]) {
      expect(tileSpanCentre(t, { w: 1, h: 1 })).toEqual(landedFoot(t))
    }
  })
})

// WHAT THE BROWSER CAUGHT: the room drew library furniture at NATIVE size and bodies at
// CHAR_TARGET_PX, so a sleeper was three times the length of the bed he was lying in.
// ★ AND THEN THE LIBRARY SHIPPED AT 128 AND THE FACTOR WAS POINTING THE WRONG WAY. These three
// assertions were written for 24 px art and each one encoded that as a law. They are re-stated
// against the size the art is actually authored at, not weakened to let a number through:
// the factor is still ONE whole number for the whole room, it is now a divisor.
describe('furnishingScale — one room, one scale', () => {
  it('is the whole-number factor between the authored tile and the ground it lands on', () => {
    expect(furnishingDivisor()).toBe(1)
    expect(Number.isInteger(furnishingDivisor())).toBe(true)
    expect(furnishingScale()).toBe(1 / furnishingDivisor())
    // ON its ground, not inside it and not over it — the art is authored for exactly this
    // span, so "fits" and "fills" are the same claim now, and no sampler invents a pixel.
    expect(LIBRARY_TILE_PX * furnishingScale()).toBe(INTERIOR_TILE.w)
  })

  // ★ THIS ASSERTION WAS GREEN WHILE THE SLEEPER WAS HALF AGAIN THE LENGTH OF HIS BED.
  //
  // It divided the bed's INTERIOR sprite width by 4 to compare it with a body's TOWN height —
  // the exact conflation of the pixel factor with the world factor that caused the defect —
  // and then bounded the answer between 0.5 and 1.5, which is wide enough to hold both the bug
  // and the fix. The relationship it was reaching for is real, so it is re-stated in the space
  // the viewer actually sees, in `interiorScale.test.ts`. What survives here is the part that
  // is genuinely about `furnishingScale`: the bed's sprite covers its own ground and no more.
  it('puts a bed on exactly the ground a bed covers', () => {
    const bedSpanPx = (BED_FOOTPRINT.w + BED_FOOTPRINT.h) * (INTERIOR_TILE.w / 2)
    expect(bedSpanPx).toBe(192)                                      // what the library authors
    expect(bedSpanPx * furnishingScale()).toBe(192)                  // and what reaches the glass
    expect(24 / LIBRARY_TILE_PX).toBeLessThan(0.5)                   // the first mismatch: too small
  })

  it('never inflates anything', () => {
    expect(furnishingScale()).toBeLessThanOrEqual(1)
    expect(furnishingDivisor()).toBeGreaterThanOrEqual(1)
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

// ── ★ THE CABIN, AND WHY THIS ROOM AND NOT ANOTHER ONE FIRST ─────────────────────────────
//
// `world-fixes` proved the ENGINE's half of this walk and this lane does not re-prove it:
// `searchPath` from all five founders' doorsteps and from the storehouse door, every route
// `capped: false`, the body walked tile by tile, `enter`, warmth asserted UNCHANGED indoors,
// then `stoke`, then warmth up by exactly `2 x warmth.fireWarmth`.
//
// What it could not prove is that any of it is on screen, and its own report says so: *"a mind
// can feed a fire the viewer cannot see."* The cabin holds the founding valley's ONLY reachable
// indoor fire, so it is the room that makes the whole chain visible, and it is first for that
// reason and no other.
//
// THIS IS THE VIEWER'S HALF: that the room a body walks into is the room the engine says it is.
describe('★ the cabin is a room, and it is the room the engine says it is', () => {
  const HEARTH = libraryRecord('hearth', {
    slots: { w: 1, h: 1 }, placement: 'wall', interiorKinds: ['house'],
    isHearth: true, providesLight: true,
  })
  const BENCH = libraryRecord('bench', {
    slots: { w: 1, h: 2 }, placement: 'floor', interiorKinds: ['house'],
  })
  const CRATE = libraryRecord('crate', {
    slots: { w: 1, h: 1 }, placement: 'floor', interiorKinds: ['storehouse'],
  })
  const RECORDS = [HEARTH, BENCH, CRATE]

  // The same assembly `interiorScene.layoutRoom` runs: the plan becomes a room map, and a wall
  // furnishing goes on its wall. Written out rather than imported because the scene builds it
  // inside a Pixi closure — the pieces are these three lines and nothing else.
  const mapFor = (kind: InteriorKind): RoomMap => roomMapOf(
    roomPlan(kind, RECORDS).map((i) => ({
      kind: i.kind, slot: i.slot, size: i.meta?.slots ?? { w: 1, h: 1 },
      placement: i.meta?.placement ?? 'floor', flat: isFlat(i.kind),
    })), roomSizeOf(kind), slotGridOf(kind),
  )

  it('★ resolves an interior at all — before this it was null and the body vanished', () => {
    const state = {
      ...fixture(), structures: { cabin1: structure('cabin1', 'cabin') },
    } as unknown as WorldState
    const room = interiorOf(state, 'cabin1')
    expect(room).not.toBeNull()
    expect(room!.kind).toBe('cabin')
  })

  it('★ holds one fire, on a wall, facing that wall\'s own face', () => {
    const map = mapFor('cabin')
    const fires = map.pieces.filter((p) => p.kind === 'hearth')
    expect(fires).toHaveLength(1)
    const fire = fires[0]!
    expect(fire.placement).toBe('wall')
    // THE FIREPLACE/WALL FACING BUG, WHICH MUST NOT COME BACK: the facing is the wall's, by
    // construction, so a piece can never present a face its wall does not have.
    const wall = wallOfTile(fire.tile)
    expect(wall).not.toBeNull()
    expect(fire.facing).toBe(WALL_FACING[wall!])
  })

  it('★ and a body inside can walk from the threshold to a tile beside that fire', () => {
    const map = mapFor('cabin')
    const fire = map.pieces.find((p) => p.kind === 'hearth')!
    // the threshold is the room's near corner — the tile a body stands on the moment the door
    // closes behind it, and the same corner `thresholdPoly` draws the plate on
    const door = { x: ROOM_TILES.w - 1, y: ROOM_TILES.h - 1 }
    expect(isWalkable(map, door)).toBe(true)
    const perches = standingTiles(map, fire)
    expect(perches.length).toBeGreaterThan(0)
    const path = interiorPath(map, door, perches[0]!)
    expect(path).not.toBeNull()
    expect(path!.length).toBeGreaterThan(0)
    // not vacuous: the room is furniture as well as floor, so SOMETHING must be unwalkable
    expect(walkableCount(map)).toBeLessThan(ROOM_TILES.w * ROOM_TILES.h)
    expect(walkableCount(map)).toBeGreaterThan(0)
  })

  // ★ THE TWO HALVES AGREE. Over every kind the viewer draws a room for, what the room CONTAINS
  // is what the recipe row SAYS it contains. A room that draws a fire the config denies is a
  // fire nobody can stoke; a room that omits one the config promises is `world-fixes`' defect
  // coming back through the renderer.
  it('★ the fire in the room is the fire in the config, over every room there is', () => {
    for (const kind of INTERIOR_KINDS) {
      const kinds = mapFor(kind).pieces.map((p) => p.kind)
      expect(kinds.includes('hearth'), `${kind} hearth`).toBe(isHearthKind(DEFAULT_CONFIG, kind))
      expect(kinds.includes('bed'), `${kind} bed`).toBe(isBeddedKind(DEFAULT_CONFIG, kind))
    }
    // both answers present on both properties, or `false === false` satisfies the loop
    const hearths = INTERIOR_KINDS.filter((k) => isHearthKind(DEFAULT_CONFIG, k))
    const beds = INTERIOR_KINDS.filter((k) => isBeddedKind(DEFAULT_CONFIG, k))
    expect(hearths.length).toBeGreaterThan(0)
    expect(hearths.length).toBeLessThan(INTERIOR_KINDS.length)
    expect(beds.length).toBeGreaterThan(0)
    expect(beds.length).toBeLessThan(INTERIOR_KINDS.length)
  })

  it('★ and the room is as big as the building, because capacity IS floor', () => {
    // `roomCapacity` is `floor(w x h / 2)`, and it is the arithmetic the whole dwelling ladder
    // is priced on. A farmhouse drawn on a house's floor would put the picture at odds with it.
    for (const kind of INTERIOR_KINDS) {
      const plan = DEFAULT_CONFIG.structures.recipes[kind]
      if (plan === undefined) continue                       // shed has no row; it keeps the default
      expect(roomSizeOf(kind), kind).toEqual(roomTilesFor({ w: plan.w, h: plan.h }))
    }
    // the house's landed room is what FORCES the factor — it is derived, not chosen
    expect(roomSizeOf('house')).toEqual({ w: 12, h: 6 })
    expect(roomSizeOf('cabin')).toEqual({ w: 12, h: 6 })
    expect(roomSizeOf('storehouse')).toEqual({ w: 12, h: 6 })
    expect(roomSizeOf('cottage')).toEqual({ w: 18, h: 6 })
    expect(roomSizeOf('farmhouse')).toEqual({ w: 24, h: 6 })
    // and more bodies is strictly more floor, in the same order the ladder ranks them
    const floorOf = (k: InteriorKind): number => roomSizeOf(k).w * roomSizeOf(k).h
    expect(floorOf('house')).toBeLessThan(floorOf('cottage'))
    expect(floorOf('cottage')).toBeLessThan(floorOf('farmhouse'))
  })

  it('★ and the cabin is a refuge, not a home — warm, and you sleep on the boards', () => {
    const kinds = mapFor('cabin').pieces.map((p) => p.kind)
    expect(kinds).toContain('hearth')
    expect(kinds).not.toContain('bed')
    expect(bedSlots('cabin', ['amara'], RECORDS)).toEqual({})   // nowhere to lie down
    expect(mapFor('house').pieces.map((p) => p.kind)).toContain('bed')
  })
})

// ── ★ THE DESIGN QUESTION OF THIS LANE, AS A LAW ─────────────────────────────────────────
//
// `world-fixes` made the farmhouse a real rung: HALF THE FUEL PER BODY-NIGHT (0.375 against a
// house's 0.75), bought by giving up the one thing `structures.privateKinds` names. If a viewer
// cannot tell the two rooms apart, that trade is invisible and the ladder is a spreadsheet.
//
// THE ANSWER: THE ROOM SAYS IT WITH THE BED COUNT, AND THE COUNT IS NOT CHOSEN.
//
//   · a PRIVATE dwelling lays ONE bed. A house sleeps two and shows one, because the two are a
//     couple — `reproductionSystem` counts a night only under a roof in `privateKinds`, and
//     `bedSlots` already lays a partnered pair down one cell each in a single bed.
//     ONE BED IS WHAT PRIVACY LOOKS LIKE.
//   · a SHARED dwelling lays ONE BED PER BODY — `roomCapacity`, the same `floor(w x h / 2)` the
//     ladder is priced on. A cottage shows three, a farmhouse four. Nobody chose anybody.
//
// The seat says it a second time: a house has a CHAIR, which seats one; the shared dwellings
// have a BENCH, which seats whoever sits down. And no rug in a shared room — a rug is a comfort
// somebody owns.
describe('★ a shared room and a private room, and the difference is the ladder', () => {
  const beds = (kind: InteriorKind): number =>
    roomFurnishings(kind).filter((f) => f.kind === 'bed').length
  const planOf = (kind: InteriorKind): { w: number; h: number } => {
    const r = DEFAULT_CONFIG.structures.recipes[kind]!
    return { w: r.w, h: r.h }
  }
  const isPrivate = (kind: string): boolean =>
    DEFAULT_CONFIG.structures.privateKinds.includes(kind)

  it('★ one bed if the door is yours, one bed per body if it is not', () => {
    const bedded = INTERIOR_KINDS.filter((k) => isBeddedKind(DEFAULT_CONFIG, k))
    for (const kind of bedded) {
      const want = isPrivate(kind) ? 1 : roomCapacity(planOf(kind))
      expect(beds(kind), `${kind} beds`).toBe(want)
    }
    // NOT VACUOUS: the two branches must both be exercised, or one rule is untested
    expect(bedded.filter(isPrivate).length).toBeGreaterThan(0)
    expect(bedded.filter((k) => !isPrivate(k)).length).toBeGreaterThan(0)
    // and the counts really are different, which is the whole point of the picture
    expect(beds('house')).toBe(1)
    expect(beds('cottage')).toBe(3)
    expect(beds('farmhouse')).toBe(4)
  })

  it('★ so a house and a farmhouse cannot be mistaken for one another', () => {
    const house = roomFurnishings('house').map((f) => f.kind)
    const farm = roomFurnishings('farmhouse').map((f) => f.kind)
    expect(house.filter((k) => k === 'bed')).toHaveLength(1)
    expect(farm.filter((k) => k === 'bed')).toHaveLength(4)
    // a chair seats one; a bench seats whoever sits down
    expect(house).toContain('chair')
    expect(house).not.toContain('bench')
    expect(farm).toContain('bench')
    expect(farm).not.toContain('chair')
    // a rug is a comfort somebody owns
    expect(house).toContain('rug')
    expect(farm).not.toContain('rug')
    // and they share the one thing the ladder does NOT trade away
    expect(house).toContain('hearth')
    expect(farm).toContain('hearth')
  })

  it('★ and every body the world lets sleep there has somewhere to lie', () => {
    const bedRecord = libraryRecord('bed', {
      slots: { w: 1, h: 2 }, placement: 'floor', interiorKinds: ['house'], isBed: true,
    })
    for (const kind of INTERIOR_KINDS.filter((k) => isBeddedKind(DEFAULT_CONFIG, k))) {
      const sleepers = Array.from({ length: roomCapacity(planOf(kind)) }, (_, i) => `s${i}`)
      const laid = bedSlots(kind, sleepers, [bedRecord])
      expect(Object.keys(laid).sort(), `${kind} sleepers`).toEqual(sleepers.sort())
      // every sleeper in a cell of their own — nobody lies on anybody
      const cells = Object.values(laid).map((c) => `${c.x},${c.y}`)
      expect(new Set(cells).size, `${kind} distinct cells`).toBe(sleepers.length)
    }
  })
})

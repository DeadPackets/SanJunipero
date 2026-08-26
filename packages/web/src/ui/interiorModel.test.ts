import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, INTERIOR_KINDS, type AssetRecord } from '@sj/shared'
import { genesisState, type Item, type WorldState } from '@sj/engine/state'
import { GAMIFICATION_BAN } from './townStats.js'
import {
  ROOM_HOLDS_MAX,
  ROOM_STATE_ASLEEP,
  ROOM_STATE_IDLE,
  roomCard,
  roomStateOf,
  roomWord,
  type Provenance,
} from './interiorModel.js'

const EMOJI = /\p{Extended_Pictographic}/u
// P17: two words for one state is the defect U13 names. The room card may use neither.
const SYNONYM_BAN = /\b(resting|awake)\b/i

function agent(id: string, name: string, over: Partial<WorldState['agents'][string]> = {}) {
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
    ...over,
  }
}

function structure(id: string, kind: string, owner?: string): WorldState['structures'][string] {
  return {
    id,
    kind,
    x: 1,
    y: 1,
    w: 2,
    h: 2,
    hp: 10,
    maxHp: 10,
    flammable: true,
    stage: 'complete',
    progressTicks: 0,
    builtBy: null,
    burning: false,
    burnTicks: 0,
    ...(owner === undefined ? {} : { owner }),
  }
}

const item = (id: string, kind: string, qty: number, structureId: string): Item => ({
  id,
  kind,
  qty,
  loc: { t: 'structure', id: structureId },
})

function world(over: Partial<WorldState> = {}): WorldState {
  const s = genesisState(DEFAULT_CONFIG)
  return {
    ...s,
    agents: {
      amara: agent('amara', 'Amara', { insideId: 'house1', asleep: true }),
      yusuf: agent('yusuf', 'Yusuf', {
        insideId: 'house1',
        activity: { verb: 'weave', ticksRemaining: 4 },
      } as Partial<WorldState['agents'][string]>),
      nadia: agent('nadia', 'Nadia', { insideId: 'store1' }),
    },
    structures: {
      house1: structure('house1', 'house', 'amara'),
      store1: structure('store1', 'storehouse'),
      stone: structure('stone', 'standing_stone'),
    },
    items: {
      i1: item('i1', 'grain', 3, 'store1'),
      i2: item('i2', 'grain', 5, 'store1'),
      i3: item('i3', 'plank', 2, 'store1'),
      i4: item('i4', 'bowl', 1, 'house1'),
      i5: { id: 'i5', kind: 'grain', qty: 99, loc: { t: 'tile', x: 0, y: 0 } },
    },
    crops: {},
    ...over,
  }
}

const rec = (id: string, kind: string): AssetRecord =>
  ({
    id,
    class: 'item',
    kind,
    status: 'ready',
    seq: 1,
    meta: null,
  }) as unknown as AssetRecord

const RECORDS = [rec('a1', 'grain#icon'), rec('a2', 'plank#icon')]

const PROV: Provenance = {
  id: 'house1',
  kind: 'house',
  plannedTick: 1,
  builderId: 'yusuf',
  completedTick: 4320,
}

describe('roomCard — whose room this is', () => {
  it('names an owned house after its resident, with a typographic apostrophe', () => {
    const c = roomCard(world(), 'house1', RECORDS, null)!
    expect(c.title).toBe('Amara’s house')
    expect(c.title).not.toContain("'")
  })

  it('names a public building plainly, and lower case', () => {
    expect(roomCard(world(), 'store1', RECORDS, null)!.title).toBe('the storehouse')
  })

  it('is null for a structure with no interior, an unknown id, and no world', () => {
    expect(roomCard(world(), 'stone', RECORDS, null)).toBeNull()
    expect(roomCard(world(), 'nope', RECORDS, null)).toBeNull()
    expect(roomCard(null, 'house1', RECORDS, null)).toBeNull()
  })

  it('★ every room there is has the town\'s own word for it, not "room"', () => {
    for (const kind of INTERIOR_KINDS) {
      expect(roomWord(kind), kind).toBe(kind.replace(/_/g, ' '))
      expect(roomWord(kind), kind).not.toBe('room')
    }
    // and it holds for a kind nobody has thought of yet, which a list cannot do
    expect(roomWord('turf_lodge')).toBe('turf lodge')
  })
})

describe('roomCard — who built it', () => {
  it('reads the provenance as a sentence about a person and a day', () => {
    expect(roomCard(world(), 'house1', RECORDS, PROV)!.built).toBe('Raised by Yusuf, Day 3')
  })

  it('is NULL when provenance is absent — never the string "null", never "unknown"', () => {
    const c = roomCard(world(), 'house1', RECORDS, null)!
    expect(c.built).toBeNull()
    expect(c.built).not.toBe('null')
    expect(c.built).not.toBe('unknown')
  })

  it('names a builder the world has forgotten by the only name it has', () => {
    const c = roomCard(world(), 'house1', RECORDS, { ...PROV, builderId: 'ghost' })!
    expect(c.built).toBe('Raised by ghost, Day 3')
  })

  it('says the day it was begun when it is still rising', () => {
    const c = roomCard(world(), 'house1', RECORDS, { ...PROV, completedTick: null })!
    expect(c.built).toBe('Begun by Yusuf, Day 0 — still rising')
  })
})

describe('roomCard — who lives here and who is in', () => {
  it('lists the owner under lives, and everyone present under present', () => {
    const c = roomCard(world(), 'house1', RECORDS, null)!
    expect(c.lives).toEqual(['Amara'])
    expect(c.present.map((p) => p.name)).toEqual(['Amara', 'Yusuf'])
  })

  it('uses one word per state, and never a synonym of another', () => {
    const c = roomCard(world(), 'house1', RECORDS, null)!
    expect(c.present.find((p) => p.id === 'amara')!.state).toBe(ROOM_STATE_ASLEEP)
    expect(c.present.find((p) => p.id === 'yusuf')!.state).toBe('Weaving')
    for (const p of c.present) expect(p.state, p.state).not.toMatch(SYNONYM_BAN)
  })

  it('an awake person with nothing to do is between things, not resting', () => {
    expect(roomStateOf({ asleep: false, activity: null })).toBe(ROOM_STATE_IDLE)
    expect(ROOM_STATE_IDLE).not.toMatch(SYNONYM_BAN)
    expect(roomStateOf({ asleep: true, activity: { verb: 'sleep' } })).toBe(ROOM_STATE_ASLEEP)
  })

  it('a public building has nobody living in it, and that is not an error', () => {
    const c = roomCard(world(), 'store1', RECORDS, null)!
    expect(c.lives).toEqual([])
    expect(c.present.map((p) => p.name)).toEqual(['Nadia'])
  })
})

describe('roomCard — what it holds', () => {
  it('lists only this room’s items, merging duplicate kinds by summing qty', () => {
    const c = roomCard(world(), 'store1', RECORDS, null)!
    expect(c.holds).toEqual([
      { kind: 'grain', words: 'grain', qty: 8, iconUrl: '/assets/a1.png' },
      { kind: 'plank', words: 'plank', qty: 2, iconUrl: '/assets/a2.png' },
    ])
  })

  it('gives a kind with no icon in the codex a null, not a broken url', () => {
    expect(roomCard(world(), 'house1', RECORDS, null)!.holds).toEqual([
      { kind: 'bowl', words: 'bowl', qty: 1, iconUrl: null },
    ])
  })

  // WHAT THE BROWSER CAUGHT the first time this grid ever had data in it: it printed the
  // engine's slug, so `wheat_sheaf` reached a viewer as `wheat_s…`.
  it('says the kind in words — the slug resolves the icon and never reaches a viewer', () => {
    const stocked: WorldState['items'] = {
      w1: item('w1', 'wheat_sheaf', 12, 'store1'),
      m1: item('m1', 'field_mushroom', 3, 'store1'),
    }
    const c = roomCard(world({ items: stocked }), 'store1', RECORDS, null)!
    expect(c.holds.map((h) => h.words)).toEqual(['wheat sheaf', 'field mushroom'])
    expect(c.holds.map((h) => h.kind)).toEqual(['wheat_sheaf', 'field_mushroom'])
    for (const h of c.holds) expect(h.words, h.kind).not.toContain('_')
  })

  it('caps the grid and says honestly how much it left out', () => {
    const many: WorldState['items'] = {}
    for (let i = 0; i < 40; i++) many[`x${i}`] = item(`x${i}`, `kind${i}`, 1, 'store1')
    const c = roomCard(world({ items: many }), 'store1', RECORDS, null)!
    expect(c.holds).toHaveLength(ROOM_HOLDS_MAX)
    expect(c.more).toBe(40 - ROOM_HOLDS_MAX)
    expect(roomCard(world(), 'store1', RECORDS, null)!.more).toBe(0)
  })
})

describe('roomCard — the empty line', () => {
  it('says nobody is in NOW, never that nothing has happened yet', () => {
    const quiet = world()
    delete quiet.agents.amara
    delete quiet.agents.yusuf
    const c = roomCard(quiet, 'house1', RECORDS, null)!
    expect(c.present).toEqual([])
    expect(c.empty).toContain('now')
    expect(c.empty.toLowerCase()).not.toContain('yet')
    expect(c.empty.toLowerCase()).not.toContain('nothing has happened')
  })

  it('an unfurnished, unowned, empty room still says something true', () => {
    const bare = world({ items: {}, agents: {} })
    const c = roomCard(bare, 'store1', RECORDS, null)!
    expect(c.empty.length).toBeGreaterThan(0)
    expect(c.holds).toEqual([])
    expect(c.lives).toEqual([])
  })
})

describe('roomCard — the house style', () => {
  it('carries no gamification and no emoji anywhere in the card', () => {
    for (const id of ['house1', 'store1']) {
      const c = roomCard(world(), id, RECORDS, PROV)!
      const text = [
        c.title,
        c.built ?? '',
        c.empty,
        ...c.lives,
        ...c.holds.map((h) => h.words),
        ...c.present.map((p) => `${p.name} ${p.state}`),
      ].join(' ')
      expect(text, id).not.toMatch(GAMIFICATION_BAN)
      expect(text, id).not.toMatch(EMOJI)
    }
  })

  it('is pure — the same world twice gives the same card', () => {
    expect(roomCard(world(), 'house1', RECORDS, PROV)).toEqual(
      roomCard(world(), 'house1', RECORDS, PROV),
    )
  })
})

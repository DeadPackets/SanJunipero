import { describe, it, expect } from 'vitest'
import {
  ADULT_AGE_DAYS,
  DAYS_PER_YEAR,
  DEFAULT_CONFIG,
  SimConfigSchema,
  type SimEvent,
} from '@sj/shared'
import { genesisState, type TileId, type WorldState } from './state.js'
import { fold } from './fold.js'
import { doorTile } from './interiors.js'
import { hears } from './earshot.js'
import { composePerception } from './perception.js'
import { VERBS } from './verbs/index.js'
import { RngStream } from './rng.js'
import { ev } from './testutil/world.js'

// Noon: the witness radius scales with the light on the thing seen, so these rows are about
// the horizon, not about the dark.
const NOON = 720

function makeWorld(agents: { id: string; x: number; y: number }[]): WorldState {
  let s = genesisState(
    DEFAULT_CONFIG,
    Array.from({ length: 64 }, () => Array.from({ length: 64 }, (): TileId => 0)),
  )
  for (const a of agents)
    s = fold(
      s,
      // A grown adult, counted in this world's four-week years: 7 300 days is an elder here.
      ev('agent_spawned', { id: a.id, name: a.id, x: a.x, y: a.y, ageDays: 30 * DAYS_PER_YEAR }),
      DEFAULT_CONFIG,
    )
  return { ...s, tick: NOON }
}

describe('composePerception: information asymmetry', () => {
  it('agent at sightRadius+1 is invisible; at sightRadius is visible', () => {
    const sight = DEFAULT_CONFIG.movement.sightRadius
    const s = makeWorld([
      { id: 'a', x: 0, y: 0 },
      { id: 'near', x: sight, y: 0 },
      { id: 'far', x: sight + 1, y: 0 },
    ])
    const p = composePerception(s, DEFAULT_CONFIG, 'a', [])
    expect(p.visible.agents.map((g) => g.id)).toEqual(['near'])
  })

  it('speech at earshot+1 is unheard; at earshot is heard', () => {
    const earshot = DEFAULT_CONFIG.movement.earshotRadius
    const s = makeWorld([
      { id: 'a', x: 0, y: 0 },
      { id: 'near', x: earshot, y: 0 },
      { id: 'far', x: earshot + 1, y: 0 },
    ])
    const events = [
      ev('agent_spoke', { agentId: 'near', text: 'close words', x: earshot, y: 0 }),
      ev('agent_spoke', { agentId: 'far', text: 'far words', x: earshot + 1, y: 0 }),
    ]
    const p = composePerception(s, DEFAULT_CONFIG, 'a', events)
    expect(p.heard).toEqual([
      { speakerId: 'near', name: 'near', text: 'close words', distance: earshot },
    ])
  })

  it('an event that happened out of range appears nowhere in the packet', () => {
    const s = makeWorld([
      { id: 'a', x: 0, y: 0 },
      { id: 'far', x: 100, y: 100 },
    ])
    const events = [
      ev('agent_spoke', { agentId: 'far', text: 'out of range whisper', x: 100, y: 100 }),
    ]
    const p = composePerception(s, DEFAULT_CONFIG, 'a', events)
    expect(p.heard).toEqual([])
    expect(p.feltEvents).toEqual([])
    expect(JSON.stringify(p)).not.toContain('out of range whisper')
    expect(JSON.stringify(p)).not.toContain('far')
  })

  it("two agents' packets from the same state differ correctly (A hears B, C doesn't)", () => {
    const s = makeWorld([
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 1, y: 0 },
      { id: 'c', x: 50, y: 0 },
    ])
    const events = [ev('agent_spoke', { agentId: 'b', text: 'hello there', x: 1, y: 0 })]
    const pa = composePerception(s, DEFAULT_CONFIG, 'a', events)
    const pc = composePerception(s, DEFAULT_CONFIG, 'c', events)
    expect(pa.heard.map((h) => h.speakerId)).toEqual(['b'])
    expect(pa.heard[0]!.text).toBe('hello there')
    expect(pc.heard).toEqual([])
    // A also sees B; C does not (B is 49 away, beyond sight).
    expect(pa.visible.agents.map((g) => g.id)).toEqual(['b'])
    expect(pc.visible.agents.map((g) => g.id)).toEqual([])
  })
})

describe('composePerception: structure visibility by nearest tile', () => {
  it('sees a structure whose anchor is out of range but whose near edge is in range', () => {
    const sight = DEFAULT_CONFIG.movement.sightRadius // 12
    let s = makeWorld([{ id: 'a', x: 15, y: 0 }])
    // anchor (1,0) is 14 away; nearest footprint tile (4,0) is 11 away
    s = fold(
      s,
      ev('structure_planned', {
        id: 'structure_1',
        kind: 'storehouse',
        x: 1,
        y: 0,
        w: 4,
        h: 1,
        maxHp: 20,
        flammable: true,
        builderId: 'script',
      }),
      DEFAULT_CONFIG,
    )
    // entirely out of range: nearest tile (4,30) is > sight away
    s = fold(
      s,
      ev('structure_planned', {
        id: 'structure_2',
        kind: 'shed',
        x: 1,
        y: 30,
        w: 4,
        h: 1,
        maxHp: 20,
        flammable: true,
        builderId: 'script',
      }),
      DEFAULT_CONFIG,
    )
    const p = composePerception(s, DEFAULT_CONFIG, 'a', [])
    expect(sight).toBe(12)
    expect(p.visible.structures.map((st) => st.id)).toEqual(['structure_1'])
  })
})

// `enter` was tried 15 times and succeeded 0, because the prose named a tile beside the wall and
// the verb measured against the doorway. The packet now carries the doorway itself.
describe('composePerception: the doorway a body must stand on', () => {
  const house = (
    s: WorldState,
    id: string,
    kind: string,
    x: number,
    y: number,
    complete: boolean,
  ): WorldState => {
    let out = fold(
      s,
      ev('structure_planned', {
        id,
        kind,
        x,
        y,
        w: 2,
        h: 2,
        maxHp: 50,
        flammable: true,
        builderId: 'script',
      }),
      DEFAULT_CONFIG,
    )
    if (complete) out = fold(out, ev('structure_completed', { id }), DEFAULT_CONFIG)
    return out
  }

  it('names the same tile enter measures against', () => {
    const s = house(makeWorld([{ id: 'a', x: 6, y: 6 }]), 'structure_1', 'house', 2, 1, true)
    const seen = composePerception(s, DEFAULT_CONFIG, 'a', []).visible.structures[0]!
    expect(seen.door).toEqual(doorTile(s, s.structures.structure_1!))
  })

  it('is absent on a kind with no way in, and on a building still going up', () => {
    let s = house(makeWorld([{ id: 'a', x: 6, y: 6 }]), 'structure_1', 'shed', 2, 1, true)
    s = house(s, 'structure_2', 'house', 8, 1, false)
    const seen = composePerception(s, DEFAULT_CONFIG, 'a', []).visible.structures
    expect(seen.map((st) => st.door)).toEqual([undefined, undefined])
  })
})

describe('composePerception: felt events', () => {
  it('maps a rain weather change to rain_started for every agent', () => {
    const s = makeWorld([{ id: 'a', x: 0, y: 0 }])
    const events = [ev('weather_changed', { kind: 'rain', temperatureC: 10 })]
    expect(composePerception(s, DEFAULT_CONFIG, 'a', events).feltEvents).toEqual(['rain_started'])
  })

  it('does not re-tag rain_started when rain merely steps temperature (prevKind = kind)', () => {
    const s = makeWorld([{ id: 'a', x: 0, y: 0 }])
    const events = [ev('weather_changed', { kind: 'rain', temperatureC: 4, prevKind: 'rain' })]
    expect(composePerception(s, DEFAULT_CONFIG, 'a', events).feltEvents).toEqual([])
  })

  it('tags rain_started when the kind actually changes (prevKind differs)', () => {
    const s = makeWorld([{ id: 'a', x: 0, y: 0 }])
    const events = [ev('weather_changed', { kind: 'rain', temperatureC: 10, prevKind: 'sunny' })]
    expect(composePerception(s, DEFAULT_CONFIG, 'a', events).feltEvents).toEqual(['rain_started'])
  })

  it('ignores sunny weather changes', () => {
    const s = makeWorld([{ id: 'a', x: 0, y: 0 }])
    const events = [ev('weather_changed', { kind: 'sunny', temperatureC: 14 })]
    expect(composePerception(s, DEFAULT_CONFIG, 'a', events).feltEvents).toEqual([])
  })

  it('maps a self injury to you_were_attacked and ignores injuries to others', () => {
    const s = makeWorld([
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 1, y: 0 },
    ])
    const events = [
      ev('agent_injured', { agentId: 'a', kind: 'minor' }),
      ev('agent_injured', { agentId: 'b', kind: 'grave' }),
    ]
    expect(composePerception(s, DEFAULT_CONFIG, 'a', events).feltEvents).toEqual([
      'you_were_attacked',
    ])
  })
})

describe('composePerception: packet shape', () => {
  it('reflects self body, inventory, weather, and nearby ground items', () => {
    let s = makeWorld([{ id: 'a', x: 2, y: 3 }])
    s = fold(
      s,
      ev('item_spawned', { id: 'item_1', kind: 'wood', qty: 3, loc: { t: 'agent', id: 'a' } }),
      DEFAULT_CONFIG,
    )
    s = fold(
      s,
      ev('item_spawned', { id: 'item_2', kind: 'stone', qty: 1, loc: { t: 'tile', x: 3, y: 3 } }),
      DEFAULT_CONFIG,
    )
    s = fold(
      s,
      ev('agent_harmed', {
        agentId: 'a',
        amount: DEFAULT_CONFIG.health.injuryDamage.minor,
        source: 'attack',
      }),
      DEFAULT_CONFIG,
    )
    s = fold(s, ev('agent_injured', { agentId: 'a', kind: 'minor' }), DEFAULT_CONFIG)
    const p = composePerception(s, DEFAULT_CONFIG, 'a', [])
    expect(p.time.tick).toBe(s.tick)
    expect(p.self).toMatchObject({ x: 2, y: 3, activity: null })
    expect(p.self.body.hp).toBe(
      DEFAULT_CONFIG.health.maxHp - DEFAULT_CONFIG.health.injuryDamage.minor,
    )
    expect(p.self.body.injuries).toHaveLength(1)
    expect(p.self.body.injuries[0]!.kind).toBe('minor')
    expect(p.self.inventory.map((i) => i.kind)).toEqual(['wood'])
    expect(p.visible.items.map((i) => i.kind)).toEqual(['stone'])
    expect(p.weather).toEqual(s.weather)
  })
})

// You cannot read a birthday off a face, but you can tell a child from an old woman.
describe('composePerception: age reads off the body', () => {
  const YEAR = DAYS_PER_YEAR
  const withAge = (ageDays: number): WorldState => {
    const s = makeWorld([
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 1, y: 0 },
    ])
    return { ...s, agents: { ...s.agents, b: { ...s.agents.b!, ageDays } } }
  }
  const bandOf = (ageDays: number): string =>
    composePerception(withAge(ageDays), DEFAULT_CONFIG, 'a', []).visible.agents[0]!.ageBand

  it('carries the band of every agent in sight', () => {
    expect(bandOf(10 * YEAR)).toBe('child')
    expect(bandOf(30 * YEAR)).toBe('adult')
    expect(bandOf(70 * YEAR)).toBe('elder')
  })

  it('reads the same lines the aging system does', () => {
    expect(bandOf(DEFAULT_CONFIG.aging.childUntilYears * YEAR)).toBe('adult')
    expect(bandOf(DEFAULT_CONFIG.aging.elderFromYears * YEAR - 1)).toBe('adult')
    expect(bandOf(DEFAULT_CONFIG.aging.elderFromYears * YEAR)).toBe('elder')
  })
})

describe('composePerception: structure contents', () => {
  // Storehouse footprint tiles: (10,10),(11,10),(10,11),(11,11).
  const storehouse = { id: 'structure_1', kind: 'storehouse', x: 10, y: 10, w: 2, h: 2 }

  function makeStorehouseWorld(agent: { id: string; x: number; y: number }): WorldState {
    let s = makeWorld([agent])
    s = fold(
      s,
      ev('structure_planned', {
        id: storehouse.id,
        kind: storehouse.kind,
        x: storehouse.x,
        y: storehouse.y,
        w: storehouse.w,
        h: storehouse.h,
        maxHp: 20,
        flammable: true,
        builderId: 'script',
      }),
      DEFAULT_CONFIG,
    )
    s = fold(
      s,
      ev('item_spawned', {
        id: 'item_1',
        kind: 'bread',
        qty: 20,
        loc: { t: 'structure', id: storehouse.id },
      }),
      DEFAULT_CONFIG,
    )
    return s
  }

  it('agent adjacent to a structure sees its contained items', () => {
    const s = makeStorehouseWorld({ id: 'a', x: 12, y: 10 })
    const p = composePerception(s, DEFAULT_CONFIG, 'a', [])
    expect(p.visible.items).toEqual([{ id: 'item_1', kind: 'bread', qty: 20, x: 10, y: 10 }])
  })

  it('agent two tiles away does not see contained items', () => {
    const s = makeStorehouseWorld({ id: 'a', x: 13, y: 10 })
    const p = composePerception(s, DEFAULT_CONFIG, 'a', [])
    expect(p.visible.items).toEqual([])
  })

  it('perception never mutates the stored loc', () => {
    const s = makeStorehouseWorld({ id: 'a', x: 12, y: 10 })
    composePerception(s, DEFAULT_CONFIG, 'a', [])
    expect(s.items.item_1!.loc).toEqual({ t: 'structure', id: 'structure_1' })
  })
})

// A complete 2x2 house anchored at (10,10); its door is the tile south of centre, (10,12).
const HOUSE = { id: 'structure_1', kind: 'house', x: 10, y: 10, w: 2, h: 2 }
const DOOR = { x: 10, y: 12 }

function withHouse(s: WorldState): WorldState {
  const out = fold(
    s,
    ev('structure_planned', {
      id: HOUSE.id,
      kind: HOUSE.kind,
      x: HOUSE.x,
      y: HOUSE.y,
      w: HOUSE.w,
      h: HOUSE.h,
      maxHp: 50,
      flammable: true,
      builderId: 'script',
    }),
    DEFAULT_CONFIG,
  )
  return fold(out, ev('structure_completed', { id: HOUSE.id }), DEFAULT_CONFIG)
}

// Put an already-spawned agent inside the house, body parked on the door tile.
function goInside(s: WorldState, id: string, structureId = HOUSE.id): WorldState {
  const moved = fold(s, ev('agent_moved', { id, x: DOOR.x, y: DOOR.y }), DEFAULT_CONFIG)
  return fold(moved, ev('agent_entered', { agentId: id, structureId }), DEFAULT_CONFIG)
}

const spoke = (agentId: string, text: string, x: number, y: number, insideId?: string): SimEvent =>
  ev(
    'agent_spoke',
    insideId === undefined ? { agentId, text, x, y } : { agentId, text, x, y, insideId },
  )

describe('composePerception: earshot occlusion', () => {
  it('co-occupants hear each other regardless of where the house sits', () => {
    let s = withHouse(
      makeWorld([
        { id: 'a', x: 9, y: 12 },
        { id: 'b', x: 11, y: 12 },
      ]),
    )
    s = goInside(goInside(s, 'a'), 'b')
    const p = composePerception(s, DEFAULT_CONFIG, 'a', [
      spoke('b', 'inside words', DOOR.x, DOOR.y, HOUSE.id),
    ])
    expect(p.heard.map((h) => h.text)).toEqual(['inside words'])
  })

  it('two agents in different houses do not hear each other', () => {
    let s = withHouse(
      makeWorld([
        { id: 'a', x: 9, y: 12 },
        { id: 'b', x: 11, y: 12 },
      ]),
    )
    s = fold(
      s,
      ev('structure_planned', {
        id: 'structure_2',
        kind: 'house',
        x: 14,
        y: 10,
        w: 2,
        h: 2,
        maxHp: 50,
        flammable: true,
        builderId: 'script',
      }),
      DEFAULT_CONFIG,
    )
    s = fold(s, ev('structure_completed', { id: 'structure_2' }), DEFAULT_CONFIG)
    s = goInside(s, 'a')
    s = fold(s, ev('agent_moved', { id: 'b', x: 14, y: 12 }), DEFAULT_CONFIG)
    s = fold(s, ev('agent_entered', { agentId: 'b', structureId: 'structure_2' }), DEFAULT_CONFIG)
    const p = composePerception(s, DEFAULT_CONFIG, 'a', [
      spoke('b', 'other house', 14, 12, 'structure_2'),
    ])
    expect(p.heard).toEqual([])
  })

  it('speech from inside reaches the doorway and no further', () => {
    let s = withHouse(
      makeWorld([
        { id: 'inside', x: 9, y: 12 },
        { id: 'atDoor', x: 11, y: 13 }, // Chebyshev 1 from the door
        { id: 'nearby', x: 10, y: 14 }, // Chebyshev 2 — well inside earshot 8, still deaf
      ]),
    )
    s = goInside(s, 'inside')
    const events = [spoke('inside', 'a whisper', DOOR.x, DOOR.y, HOUSE.id)]
    expect(composePerception(s, DEFAULT_CONFIG, 'atDoor', events).heard.map((h) => h.text)).toEqual(
      ['a whisper'],
    )
    expect(composePerception(s, DEFAULT_CONFIG, 'nearby', events).heard).toEqual([])
  })

  it('the doorway rule is symmetric — outside speech reaches an insider only from the door', () => {
    let s = withHouse(
      makeWorld([
        { id: 'inside', x: 9, y: 12 },
        { id: 'atDoor', x: 11, y: 13 },
        { id: 'nearby', x: 10, y: 14 },
      ]),
    )
    s = goInside(s, 'inside')
    expect(
      composePerception(s, DEFAULT_CONFIG, 'inside', [
        spoke('atDoor', 'let me in', 11, 13),
      ]).heard.map((h) => h.text),
    ).toEqual(['let me in'])
    expect(
      composePerception(s, DEFAULT_CONFIG, 'inside', [spoke('nearby', 'too far', 10, 14)]).heard,
    ).toEqual([])
  })

  it('leaves the open-air rule alone — plain earshot both ways', () => {
    const earshot = DEFAULT_CONFIG.movement.earshotRadius
    const s = withHouse(
      makeWorld([
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: earshot, y: 0 },
      ]),
    )
    expect(
      composePerception(s, DEFAULT_CONFIG, 'a', [
        spoke('b', 'across the field', earshot, 0),
      ]).heard.map((h) => h.text),
    ).toEqual(['across the field'])
  })

  it('hears() is the pure rule the packet is built from', () => {
    let s = withHouse(
      makeWorld([
        { id: 'a', x: 9, y: 12 },
        { id: 'b', x: 11, y: 13 },
      ]),
    )
    s = goInside(s, 'a')
    const fromInside = spoke('a', 'hush', DOOR.x, DOOR.y, HOUSE.id)
    expect(hears(s, DEFAULT_CONFIG, fromInside.payload, 'b')).toBe(true)
    expect(hears(s, DEFAULT_CONFIG, fromInside.payload, 'a')).toBe(true) // the rule itself is speaker-agnostic
    const far = spoke('b', 'oi', 20, 20)
    expect(hears(s, DEFAULT_CONFIG, far.payload, 'a')).toBe(false)
  })

  it('speak stamps the speaker insideId, and only when indoors', () => {
    const rng = RngStream.seed('perception-test', 'actions')
    let s = withHouse(makeWorld([{ id: 'a', x: 9, y: 12 }]))
    expect(VERBS.speak!.onComplete(s, DEFAULT_CONFIG, 'a', { text: 'out here' }, rng)).toEqual([
      { type: 'agent_spoke', payload: { agentId: 'a', text: 'out here', x: 9, y: 12 } },
    ])
    s = goInside(s, 'a')
    expect(VERBS.speak!.onComplete(s, DEFAULT_CONFIG, 'a', { text: 'in here' }, rng)).toEqual([
      {
        type: 'agent_spoke',
        payload: { agentId: 'a', text: 'in here', x: DOOR.x, y: DOOR.y, insideId: HOUSE.id },
      },
    ])
  })
})

describe('composePerception: interior sight', () => {
  function peopledHouse(): WorldState {
    let s = withHouse(
      makeWorld([
        { id: 'a', x: 9, y: 12 },
        { id: 'mate', x: 11, y: 12 },
        { id: 'passerby', x: 13, y: 13 },
      ]),
    )
    s = goInside(goInside(s, 'a'), 'mate')
    s = fold(
      s,
      ev('item_spawned', {
        id: 'item_1',
        kind: 'bread',
        qty: 2,
        loc: { t: 'structure', id: HOUSE.id },
      }),
      DEFAULT_CONFIG,
    )
    s = fold(
      s,
      ev('item_spawned', { id: 'item_2', kind: 'stone', qty: 1, loc: { t: 'tile', x: 13, y: 13 } }),
      DEFAULT_CONFIG,
    )
    s = fold(
      s,
      ev('crop_planted', { id: 'crop_1', kind: 'wheat', x: 13, y: 12, plantedDay: 0 }),
      DEFAULT_CONFIG,
    )
    return s
  }

  it('an insider sees co-occupants and the house contents, never the meadow', () => {
    const p = composePerception(peopledHouse(), DEFAULT_CONFIG, 'a', [])
    expect(p.visible.agents.map((g) => g.id)).toEqual(['mate'])
    expect(p.visible.items.map((i) => i.id)).toEqual(['item_1'])
    expect(p.visible.structures.map((st) => st.id)).toEqual([HOUSE.id])
    expect(p.visible.crops).toEqual([])
  })

  it('an outsider standing right there sees no one inside', () => {
    const p = composePerception(peopledHouse(), DEFAULT_CONFIG, 'passerby', [])
    expect(p.visible.agents).toEqual([])
    expect(p.visible.items.map((i) => i.id)).toEqual(['item_2']) // not adjacent to the house: no peek
  })

  it('weather and own body still reach an insider', () => {
    const s = peopledHouse()
    const p = composePerception(s, DEFAULT_CONFIG, 'a', [
      ev('weather_changed', { kind: 'rain', temperatureC: 8 }),
    ])
    expect(p.feltEvents).toEqual(['rain_started'])
    expect(p.self).toMatchObject({ x: DOOR.x, y: DOOR.y })
    expect(p.weather).toEqual(s.weather)
  })
})

describe('composePerception: seen channel', () => {
  it('is empty when nothing was witnessed', () => {
    const s = makeWorld([{ id: 'a', x: 0, y: 0 }])
    expect(composePerception(s, DEFAULT_CONFIG, 'a', []).seen).toEqual([])
  })
})

const taken = (
  takerId: string,
  ownerId: string,
  x: number,
  y: number,
  itemId = 'item_1',
  kind = 'bread',
): SimEvent => ev('item_taken', { itemId, kind, takerId, ownerId, x, y })

describe('composePerception: ownership prose', () => {
  function ownedWorld(): WorldState {
    let s = makeWorld([
      { id: 'watcher', x: 0, y: 0 },
      { id: 'rahel', x: 2, y: 0 },
    ])
    s = fold(
      s,
      ev('agent_spawned', { id: 'yusuf', name: 'Yusuf', x: 3, y: 0, ageDays: ADULT_AGE_DAYS }),
      DEFAULT_CONFIG,
    )
    s = fold(
      s,
      ev('item_spawned', {
        id: 'item_1',
        kind: 'basket',
        qty: 1,
        loc: { t: 'tile', x: 1, y: 0 },
        owner: 'rahel',
      }),
      DEFAULT_CONFIG,
    )
    s = fold(
      s,
      ev('item_spawned', {
        id: 'item_2',
        kind: 'chair',
        qty: 1,
        loc: { t: 'agent', id: 'watcher' },
        owner: 'watcher',
        crafterMark: 'yusuf',
      }),
      DEFAULT_CONFIG,
    )
    s = fold(
      s,
      ev('item_spawned', {
        id: 'item_3',
        kind: 'stone',
        qty: 1,
        loc: { t: 'tile', x: 1, y: 1 },
      }),
      DEFAULT_CONFIG,
    )
    return s
  }

  it('names the owner of a thing on the ground and the maker of a thing in hand', () => {
    const p = composePerception(ownedWorld(), DEFAULT_CONFIG, 'watcher', [])
    expect(p.visible.items.find((i) => i.id === 'item_1')).toMatchObject({ ownerName: 'rahel' })
    expect(p.self.inventory.find((i) => i.id === 'item_2')).toMatchObject({
      ownerName: 'watcher',
      crafterMarkName: 'Yusuf',
    })
  })

  it('leaves an unowned thing unnamed rather than calling it no-one’s', () => {
    const p = composePerception(ownedWorld(), DEFAULT_CONFIG, 'watcher', [])
    const stone = p.visible.items.find((i) => i.id === 'item_3')!
    expect(stone).not.toHaveProperty('ownerName')
    expect(stone).not.toHaveProperty('crafterMarkName')
  })

  it('keeps naming a dead owner — the basket is still Rahel’s', () => {
    let s = ownedWorld()
    s = fold(s, ev('agent_died', { agentId: 'rahel', cause: 'starvation' }), DEFAULT_CONFIG)
    const p = composePerception(s, DEFAULT_CONFIG, 'watcher', [])
    expect(p.visible.agents.map((g) => g.id)).not.toContain('rahel')
    expect(p.visible.items.find((i) => i.id === 'item_1')).toMatchObject({ ownerName: 'rahel' })
  })

  it('never mutates the stored item while dressing it in a name', () => {
    const s = ownedWorld()
    composePerception(s, DEFAULT_CONFIG, 'watcher', [])
    expect(s.items.item_2!).not.toHaveProperty('crafterMarkName')
  })

  it('stops surfacing ownership when the flag is off', () => {
    const off = SimConfigSchema.parse({ ownership: { enabled: false } })
    const p = composePerception(ownedWorld(), off, 'watcher', [])
    expect(p.visible.items.find((i) => i.id === 'item_1')).not.toHaveProperty('ownerName')
    expect(p.self.inventory.find((i) => i.id === 'item_2')).not.toHaveProperty('crafterMarkName')
  })
})

describe('composePerception: witnessed takings', () => {
  function theftWorld(): WorldState {
    return makeWorld([
      { id: 'omar', x: 4, y: 4 },
      { id: 'salma', x: 5, y: 4 },
      { id: 'bystander', x: 6, y: 4 },
      { id: 'distant', x: 40, y: 40 },
    ])
  }

  it('a third party in sight of the spot sees who took whose', () => {
    const p = composePerception(theftWorld(), DEFAULT_CONFIG, 'bystander', [
      taken('omar', 'salma', 4, 4),
    ])
    expect(p.seen).toEqual([
      { kind: 'item_taken', takerName: 'omar', ownerName: 'salma', itemKind: 'bread' },
    ])
  })

  it('is blind past the sight radius', () => {
    expect(
      composePerception(theftWorld(), DEFAULT_CONFIG, 'distant', [taken('omar', 'salma', 4, 4)])
        .seen,
    ).toEqual([])
  })

  it('does not echo your own hands back at you', () => {
    expect(
      composePerception(theftWorld(), DEFAULT_CONFIG, 'omar', [taken('omar', 'salma', 4, 4)]).seen,
    ).toEqual([])
  })

  it('walls block the view — indoors you see only what happens in the room', () => {
    let s = withHouse(theftWorld())
    s = goInside(s, 'bystander')
    expect(
      composePerception(s, DEFAULT_CONFIG, 'bystander', [taken('omar', 'salma', 4, 4)]).seen,
    ).toEqual([])
    s = goInside(s, 'omar')
    expect(
      composePerception(s, DEFAULT_CONFIG, 'bystander', [taken('omar', 'salma', DOOR.x, DOOR.y)])
        .seen,
    ).toEqual([{ kind: 'item_taken', takerName: 'omar', ownerName: 'salma', itemKind: 'bread' }])
  })

  it('goes quiet when the flag is off', () => {
    const off = SimConfigSchema.parse({ ownership: { enabled: false } })
    expect(
      composePerception(theftWorld(), off, 'bystander', [taken('omar', 'salma', 4, 4)]).seen,
    ).toEqual([])
  })
})

describe('the ground underfoot: a benefit stated, never a rule given', () => {
  function paved(
    tiles: { x: number; y: number; tile: TileId }[],
    self = { x: 0, y: 0 },
  ): WorldState {
    const s = makeWorld([{ id: 'a', ...self }])
    const terrain = s.terrain.map((row, y) =>
      row.map((t, x) => tiles.find((p) => p.x === x && p.y === y)?.tile ?? t),
    )
    return { ...s, terrain }
  }
  const ground = (s: WorldState, config = DEFAULT_CONFIG) =>
    composePerception(s, config, 'a', []).ground

  it('reads the road under the feet and the road beside them, and nothing further off', () => {
    expect(ground(paved([{ x: 0, y: 0, tile: 7 }]))).toEqual({ wellTravelled: true })
    expect(ground(paved([{ x: 1, y: 1, tile: 7 }]))).toEqual({ wellTravelled: true })
    expect(ground(paved([{ x: 0, y: 1, tile: 8 }]))).toEqual({ wellTravelled: true })
    expect(ground(paved([{ x: 2, y: 0, tile: 7 }]))).toBeUndefined()
    expect(ground(paved([]))).toBeUndefined()
  })

  it('says it once however much road there is, and says nothing at all when roads are off', () => {
    const surrounded = paved([
      { x: 0, y: 0, tile: 7 },
      { x: 1, y: 0, tile: 7 },
      { x: 0, y: 1, tile: 7 },
      { x: 1, y: 1, tile: 8 },
    ])
    expect(ground(surrounded)).toEqual({ wellTravelled: true })
    const off = SimConfigSchema.parse({ roads: { enabled: false } })
    expect(ground(surrounded, off)).toBeUndefined()
  })
})

describe('night-witness: a torch does not let you see, it lets the dark see you', () => {
  const CFG = DEFAULT_CONFIG
  const DAY_CFG = SimConfigSchema.parse({ nightWitness: { enabled: false } })
  const LIGHTLESS_CFG = SimConfigSchema.parse({ light: { enabled: false } })
  const MIDNIGHT = 0
  const DUSK = 19 * 60
  const NIGHT_R = Math.round(CFG.movement.sightRadius * CFG.nightWitness.nightFactor)

  const night = (s: WorldState): WorldState => ({ ...s, tick: MIDNIGHT })
  const lit = (
    s: WorldState,
    itemId: string,
    kind: string,
    loc: unknown,
    config = CFG,
  ): WorldState => {
    const out = fold(s, ev('item_spawned', { id: itemId, kind, qty: 1, loc }, s.tick), config)
    return fold(out, ev('item_lit', { itemId, burnsUntilTick: s.tick + 500 }, s.tick), config)
  }
  const firePit = (
    s: WorldState,
    x: number,
    y: number,
    fueled: boolean,
    config = CFG,
  ): WorldState => {
    let out = fold(
      s,
      ev(
        'structure_planned',
        {
          id: 'structure_9',
          kind: 'fire_pit',
          x,
          y,
          w: 1,
          h: 1,
          maxHp: 10,
          flammable: false,
          builderId: 'a',
        },
        s.tick,
      ),
      config,
    )
    out = fold(out, ev('structure_completed', { id: 'structure_9' }, s.tick), config)
    if (!fueled) return out
    return fold(
      out,
      ev('structure_fueled', { structureId: 'structure_9', burnsUntilTick: s.tick + 500 }, s.tick),
      config,
    )
  }

  // A taking at (x,y) that 'a' at the origin may or may not witness.
  const takingAt = (x: number, y: number, tick = MIDNIGHT): SimEvent[] => [
    ev(
      'item_taken',
      { itemId: 'item_5', kind: 'bread', takerId: 'thief', ownerId: 'a', x, y },
      tick,
    ),
  ]

  const world = (): WorldState =>
    night(
      makeWorld([
        { id: 'a', x: 0, y: 0 },
        { id: 'thief', x: 6, y: 0 },
      ]),
    )

  it('a theft six paces off is unwitnessed at night and witnessed by day', () => {
    expect(NIGHT_R).toBeLessThan(6)
    expect(composePerception(world(), CFG, 'a', takingAt(6, 0)).seen).toEqual([])
    const byDay = makeWorld([
      { id: 'a', x: 0, y: 0 },
      { id: 'thief', x: 6, y: 0 },
    ])
    expect(composePerception(byDay, CFG, 'a', takingAt(6, 0)).seen).toHaveLength(1)
  })

  it('at dusk the sight still reaches six paces, and the light band reads dim', () => {
    const s = { ...world(), tick: DUSK }
    expect(composePerception(s, CFG, 'a', takingAt(6, 0, DUSK)).seen).toHaveLength(1)
    expect(composePerception(s, CFG, 'a', []).light).toBe('dim')
  })

  it('the same theft beside a fed fire is witnessed at full daylight range', () => {
    const bright = firePit(world(), 6, 1, true)
    expect(composePerception(bright, CFG, 'a', takingAt(6, 0)).seen).toHaveLength(1)
    const cold = firePit(world(), 6, 1, false)
    expect(composePerception(cold, CFG, 'a', takingAt(6, 0)).seen).toEqual([])
  })

  it('a body carrying a flame is seen at full range; an unlit one at the same distance is not', () => {
    const carried = lit(world(), 'item_7', 'torch', { t: 'agent', id: 'thief' })
    expect(composePerception(carried, CFG, 'a', []).visible.agents.map((g) => g.id)).toEqual([
      'thief',
    ])
    expect(composePerception(world(), CFG, 'a', []).visible.agents).toEqual([])
  })

  it('light at the eye buys nothing: the torch in your own hand shows you no further', () => {
    const own = lit(world(), 'item_7', 'torch', { t: 'agent', id: 'a' })
    expect(composePerception(own, CFG, 'a', []).visible.agents).toEqual([])
  })

  it("carries the light as one of three words at the body's own feet, never a number", () => {
    expect(composePerception(world(), CFG, 'a', []).light).toBe('dark')
    expect(composePerception(makeWorld([{ id: 'a', x: 0, y: 0 }]), CFG, 'a', []).light).toBe(
      'bright',
    )
    const held = lit(world(), 'item_7', 'torch', { t: 'agent', id: 'a' })
    expect(composePerception(held, CFG, 'a', []).light).toBe('bright')
    expect(typeof composePerception(world(), CFG, 'a', []).light).toBe('string')
  })

  it('a long room is dark past the darkness radius, and a lit hand shows the far end', () => {
    let s = night(
      makeWorld([
        { id: 'a', x: 1, y: 1 },
        { id: 'b', x: 10, y: 1 },
      ]),
    )
    s = fold(
      s,
      ev(
        'structure_planned',
        {
          id: 'structure_1',
          kind: 'storehouse',
          x: 0,
          y: 0,
          w: 14,
          h: 3,
          maxHp: 40,
          flammable: true,
          builderId: 'a',
        },
        s.tick,
      ),
      CFG,
    )
    s = fold(s, ev('structure_completed', { id: 'structure_1' }, s.tick), CFG)
    for (const id of ['a', 'b'])
      s = fold(s, ev('agent_entered', { agentId: id, structureId: 'structure_1' }, s.tick), CFG)
    expect(composePerception(s, CFG, 'a', []).visible.agents).toEqual([])
    const shown = lit(s, 'item_7', 'torch', { t: 'agent', id: 'b' })
    expect(composePerception(shown, CFG, 'a', []).visible.agents.map((g) => g.id)).toEqual(['b'])
  })

  it('sound does not care: earshot at midnight is earshot at noon', () => {
    const said = (s: WorldState) =>
      composePerception(s, CFG, 'a', [
        ev('agent_spoke', { agentId: 'thief', text: 'in the dark', x: 6, y: 0 }, s.tick),
      ]).heard.length
    expect(said(world())).toBe(1)
    expect(
      said(
        makeWorld([
          { id: 'a', x: 0, y: 0 },
          { id: 'thief', x: 6, y: 0 },
        ]),
      ),
    ).toBe(1)
  })

  it('with the law off, midnight witnesses exactly what noon does — but is still dark', () => {
    expect(composePerception(world(), DAY_CFG, 'a', takingAt(6, 0)).seen).toHaveLength(1)
    expect(composePerception(world(), DAY_CFG, 'a', []).visible.agents.map((g) => g.id)).toEqual([
      'thief',
    ])
    // This line used to read 'bright', so a mind read broad daylight at midnight while
    // light.nightWorkPenalty charged it half again. Who sees a theft is nightWitness; the dark is light.
    expect(composePerception(world(), DAY_CFG, 'a', []).light).toBe('dark')
    expect(composePerception(world(), LIGHTLESS_CFG, 'a', []).light).toBe('bright')
  })

  it('is a pure projection: the same state and log give the same witness set twice', () => {
    const s = firePit(world(), 6, 1, true)
    const once = composePerception(s, CFG, 'a', takingAt(6, 0))
    const twice = composePerception(s, CFG, 'a', takingAt(6, 0))
    expect(JSON.stringify(once)).toBe(JSON.stringify(twice))
  })
})

// The two things a body knows about itself that the packet used to drop: 59 of the live gate's
// 222 refusals, and a mind that restated one journey in forty-four turns without setting off.
describe('composePerception: the body knows where it is and what it is doing', () => {
  it('names the roof overhead, and says nothing at all under open sky', () => {
    const outside = withHouse(makeWorld([{ id: 'a', x: 9, y: 12 }]))
    expect(composePerception(outside, DEFAULT_CONFIG, 'a', []).self.inside).toBeUndefined()
    const inside = goInside(outside, 'a')
    expect(composePerception(inside, DEFAULT_CONFIG, 'a', []).self.inside).toEqual({
      id: HOUSE.id,
      kind: HOUSE.kind,
    })
  })

  it('names where the legs are already going, and only while they are walking', () => {
    const s = withHouse(makeWorld([{ id: 'a', x: 9, y: 12 }]))
    const busy = (activity: unknown): WorldState =>
      ({ ...s, agents: { ...s.agents, a: { ...s.agents.a!, activity } } }) as WorldState

    expect(composePerception(s, DEFAULT_CONFIG, 'a', []).self.activityToward).toBeUndefined()

    const walking = composePerception(
      busy({ verb: 'walk', params: { x: 20, y: 4 }, ticksRemaining: 12 }),
      DEFAULT_CONFIG,
      'a',
      [],
    )
    expect(walking.self.activity).toBe('walk')
    expect(walking.self.activityToward).toEqual({ x: 20, y: 4 })

    // A pair of hands busy with anything else is busy without a destination.
    const chopping = composePerception(
      busy({ verb: 'chop', params: { x: 20, y: 4 }, ticksRemaining: 3 }),
      DEFAULT_CONFIG,
      'a',
      [],
    )
    expect(chopping.self.activity).toBe('chop')
    expect(chopping.self.activityToward).toBeUndefined()
  })
})

// A body that looks ill looks ill: the live gate's healer thought about who might be sick in 33
// turns and tended nobody, because a pair of eyes got a name, a place and nothing else.
describe('composePerception: a body carries what ails it, where eyes can reach', () => {
  const sicken = (s: WorldState, id: string, kind: string, severity: number): WorldState =>
    fold(s, ev('agent_afflicted', { agentId: id, kind, severity }), DEFAULT_CONFIG)

  it('a well body carries nothing, so a healthy town reads exactly as it always did', () => {
    const s = makeWorld([
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 2, y: 0 },
    ])
    const seen = composePerception(s, DEFAULT_CONFIG, 'a', []).visible.agents[0]!
    expect(seen.condition).toBeUndefined()
    expect(Object.keys(seen).sort()).toEqual([
      'activityVerb',
      'ageBand',
      'asleep',
      'collapsed',
      'id',
      'name',
      'x',
      'y',
    ])
  })

  it('names the ailment in words and never in numbers', () => {
    let s = makeWorld([
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 2, y: 0 },
    ])
    s = sicken(s, 'b', 'illness', 2)
    const seen = composePerception(s, DEFAULT_CONFIG, 'a', []).visible.agents[0]!
    expect(seen.condition).toBe('flushed with fever')
    expect(seen.condition).not.toMatch(/[0-9]/)
  })

  it('one phrase, and it is the worst thing there is to see', () => {
    let s = makeWorld([
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 2, y: 0 },
    ])
    s = sicken(s, 'b', 'injury', 1)
    s = sicken(s, 'b', 'poison', 3)
    expect(composePerception(s, DEFAULT_CONFIG, 'a', []).visible.agents[0]!.condition).toBe(
      'grey-faced and doubled over',
    )
  })

  it('a wound with no affliction still shows, and so does an empty belly', () => {
    const base = makeWorld([
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 2, y: 0 },
    ])
    const hurt: WorldState = {
      ...base,
      agents: { ...base.agents, b: { ...base.agents.b!, hp: DEFAULT_CONFIG.health.maxHp * 0.2 } },
    }
    expect(composePerception(hurt, DEFAULT_CONFIG, 'a', []).visible.agents[0]!.condition).toBe(
      'badly hurt',
    )

    const starved: WorldState = {
      ...base,
      agents: {
        ...base.agents,
        b: { ...base.agents.b!, needs: { ...base.agents.b!.needs, hunger: 2 } },
      },
    }
    expect(composePerception(starved, DEFAULT_CONFIG, 'a', []).visible.agents[0]!.condition).toBe(
      'hollowed out with hunger',
    )
  })

  it('the dark hides a fever exactly as it hides the body wearing it', () => {
    let s = makeWorld([
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 11, y: 0 },
    ])
    s = sicken(s, 'b', 'illness', 3)
    expect(composePerception(s, DEFAULT_CONFIG, 'a', []).visible.agents[0]!.condition).toBe(
      'flushed with fever',
    )
    // Midnight: the horizon shrinks past the body, and the fever goes with it.
    const night: WorldState = { ...s, tick: 0 }
    expect(composePerception(night, DEFAULT_CONFIG, 'a', []).visible.agents).toEqual([])
  })
})

// A refactor gate, not a behaviour claim: any split of composePerception must reproduce these
// bytes verbatim.
describe('★ composePerception: one packet, every channel, byte for byte', () => {
  function richWorld(): WorldState {
    let s = makeWorld([
      { id: 'a', x: 6, y: 6 },
      { id: 'b', x: 8, y: 6 },
      { id: 'far', x: 40, y: 40 },
    ])
    const C = DEFAULT_CONFIG
    const at = (type: string, payload: unknown): void => {
      s = fold(s, ev(type, payload, NOON), C)
    }

    s = {
      ...s,
      terrain: s.terrain.map((row, y) => row.map((t, x) => (x === 6 && y === 7 ? 7 : t))),
    }
    at('item_spawned', { id: 'item_1', kind: 'garment', qty: 1, loc: { t: 'agent', id: 'b' } })
    at('item_equipped', { agentId: 'b', itemId: 'item_1', slot: 'body' })
    at('agent_afflicted', { agentId: 'b', kind: 'illness', severity: 2 })

    at('structure_planned', {
      id: 'structure_1',
      kind: 'house',
      x: 4,
      y: 4,
      w: 2,
      h: 2,
      maxHp: 50,
      flammable: true,
      builderId: 'a',
    })
    at('structure_completed', { id: 'structure_1' })
    at('structure_planned', {
      id: 'structure_2',
      kind: 'fire_pit',
      x: 8,
      y: 8,
      w: 1,
      h: 1,
      maxHp: 10,
      flammable: false,
      builderId: 'a',
    })
    at('structure_completed', { id: 'structure_2' })
    at('structure_fueled', { structureId: 'structure_2', burnsUntilTick: NOON + 500 })
    at('structure_planned', {
      id: 'structure_3',
      kind: 'storehouse',
      x: 7,
      y: 4,
      w: 2,
      h: 2,
      maxHp: 20,
      flammable: true,
      builderId: 'a',
    })
    at('structure_inscribed', {
      structureId: 'structure_3',
      agentId: 'b',
      text: 'raised in the first spring',
    })

    at('item_spawned', {
      id: 'item_2',
      kind: 'bread',
      qty: 3,
      loc: { t: 'tile', x: 5, y: 6 },
      owner: 'b',
    })
    at('item_spawned', {
      id: 'item_3',
      kind: 'plank',
      qty: 2,
      loc: { t: 'structure', id: 'structure_3' },
    })
    at('item_spawned', {
      id: 'item_4',
      kind: 'axe',
      qty: 1,
      loc: { t: 'agent', id: 'a' },
      owner: 'a',
      crafterMark: 'b',
    })

    at('crop_planted', { id: 'crop_1', kind: 'wheat', x: 5, y: 8, plantedDay: 0 })
    at('fauna_spawned', { id: 'fauna_1', kind: 'deer', x: 7, y: 8 })
    at('forageable_spawned', { id: 'forage_1', kind: 'berry_bush', x: 4, y: 7, stock: 4 })

    at('action_started', { agentId: 'a', verb: 'walk', duration: 6, params: { x: 12, y: 9 } })
    return s
  }

  const RECENT: SimEvent[] = [
    ev('agent_spoke', { agentId: 'b', text: 'the bread is yours', x: 8, y: 6 }, NOON),
    ev(
      'item_taken',
      { itemId: 'item_2', kind: 'bread', takerId: 'b', ownerId: 'far', x: 5, y: 6 },
      NOON,
    ),
    ev('agent_expressed', { agentId: 'b', verb: 'sing', x: 8, y: 6, sense: 'sound' }, NOON),
    ev('mystery_event', { kind: 'stone_hums', x: 7, y: 7 }, NOON),
    ev('weather_changed', { kind: 'rain', temperatureC: 9, prevKind: 'clear' }, NOON),
  ]

  it('is the same bytes it has always been', () => {
    const packet = composePerception(richWorld(), DEFAULT_CONFIG, 'a', RECENT)
    expect(JSON.stringify(packet, null, 1)).toMatchInlineSnapshot(`
      "{
       "time": {
        "tick": 720,
        "year": 0,
        "season": "spring",
        "dayOfSeason": 1,
        "dayOfYear": 0,
        "hour": 12,
        "minute": 0,
        "isNight": false
       },
       "self": {
        "body": {
         "needs": {
          "hunger": 100,
          "energy": 100,
          "warmth": 100,
          "social": 100
         },
         "hp": 100,
         "injuries": [],
         "ill": false,
         "thirst": 100,
         "afflictions": []
        },
        "x": 6,
        "y": 6,
        "activity": "walk",
        "activityToward": {
         "x": 12,
         "y": 9
        },
        "inventory": [
         {
          "id": "item_4",
          "kind": "axe",
          "qty": 1,
          "owner": "a",
          "crafterMark": "b",
          "loc": {
           "t": "agent",
           "id": "a"
          },
          "ownerName": "a",
          "crafterMarkName": "b"
         }
        ]
       },
       "weather": {
        "kind": "sunny",
        "temperatureC": 14
       },
       "ground": {
        "wellTravelled": true
       },
       "light": "bright",
       "visible": {
        "agents": [
         {
          "id": "b",
          "name": "b",
          "x": 8,
          "y": 6,
          "activityVerb": null,
          "collapsed": false,
          "asleep": false,
          "ageBand": "adult",
          "worn": "wrapped in a rough cloak",
          "condition": "flushed with fever"
         }
        ],
        "structures": [
         {
          "id": "structure_1",
          "kind": "house",
          "x": 4,
          "y": 4,
          "w": 2,
          "h": 2,
          "burning": false,
          "stage": "complete",
          "door": {
           "x": 4,
           "y": 6
          },
          "hearth": "cold",
          "bed": true
         },
         {
          "id": "structure_2",
          "kind": "fire_pit",
          "x": 8,
          "y": 8,
          "w": 1,
          "h": 1,
          "burning": false,
          "stage": "complete",
          "hearth": "lit"
         },
         {
          "id": "structure_3",
          "kind": "storehouse",
          "x": 7,
          "y": 4,
          "w": 2,
          "h": 2,
          "burning": false,
          "stage": "construction",
          "hasInscription": true,
          "inscription": {
           "text": "raised in the first spring",
           "by": "b"
          },
          "raised": {
           "done": 0,
           "needs": 1
          }
         }
        ],
        "items": [
         {
          "id": "item_2",
          "kind": "bread",
          "qty": 3,
          "x": 5,
          "y": 6,
          "ownerName": "b"
         },
         {
          "id": "item_3",
          "kind": "plank",
          "qty": 2,
          "x": 7,
          "y": 4
         }
        ],
        "crops": [
         {
          "id": "crop_1",
          "kind": "wheat",
          "x": 5,
          "y": 8,
          "stage": 0,
          "withered": false
         }
        ],
        "fauna": [
         {
          "id": "fauna_1",
          "kind": "deer",
          "x": 7,
          "y": 8
         }
        ],
        "forageables": [
         {
          "id": "forage_1",
          "kind": "berry_bush",
          "x": 4,
          "y": 7,
          "prose": "berry bushes heavy with fruit"
         }
        ]
       },
       "reach": {
        "atHand": [
         "item_2",
         "item_3"
        ],
        "noFooting": [
         {
          "x": 7,
          "y": 4
         },
         {
          "x": 4,
          "y": 4
         },
         {
          "x": 8,
          "y": 8
         }
        ]
       },
       "heard": [
        {
         "speakerId": "b",
         "name": "b",
         "text": "the bread is yours",
         "distance": 2
        }
       ],
       "seen": [
        {
         "kind": "item_taken",
         "takerName": "b",
         "ownerName": "far",
         "itemKind": "bread"
        },
        {
         "kind": "expression",
         "actorName": "b",
         "verb": "sing",
         "sense": "sound"
        },
        {
         "kind": "mystery",
         "mystery": "stone_hums",
         "prose": "The stone here hums, low, and the sound leaves it very slowly."
        }
       ],
       "feltEvents": [
        "rain_started"
       ]
      }"
    `)
  })

  // `time`, `self.body`, `inventory` and `weather` do not change indoors, so only what the
  // walls touch is asserted here.
  it('is the same bytes indoors, where the world shrinks to one room', () => {
    let s = richWorld()
    for (const id of ['a', 'b']) {
      s = fold(s, ev('agent_moved', { id, x: 4, y: 6 }, NOON), DEFAULT_CONFIG)
      s = fold(
        s,
        ev('agent_entered', { agentId: id, structureId: 'structure_1' }, NOON),
        DEFAULT_CONFIG,
      )
    }
    s = fold(
      s,
      ev(
        'item_spawned',
        { id: 'item_5', kind: 'bowl', qty: 1, loc: { t: 'structure', id: 'structure_1' } },
        NOON,
      ),
      DEFAULT_CONFIG,
    )
    const p = composePerception(s, DEFAULT_CONFIG, 'a', [
      ev(
        'agent_spoke',
        { agentId: 'b', text: 'shut the door', x: 4, y: 6, insideId: 'structure_1' },
        NOON,
      ),
      ev('mystery_event', { kind: 'stone_hums', x: 4, y: 6 }, NOON),
    ])
    expect(p.self.inside).toEqual({ id: 'structure_1', kind: 'house' })
    expect(p.ground).toBeUndefined()
    expect(
      JSON.stringify({ visible: p.visible, heard: p.heard, seen: p.seen }, null, 1),
    ).toMatchInlineSnapshot(`
        "{
         "visible": {
          "agents": [
           {
            "id": "b",
            "name": "b",
            "x": 4,
            "y": 6,
            "activityVerb": null,
            "collapsed": false,
            "asleep": false,
            "ageBand": "adult",
            "worn": "wrapped in a rough cloak",
            "condition": "flushed with fever"
           }
          ],
          "structures": [
           {
            "id": "structure_1",
            "kind": "house",
            "x": 4,
            "y": 4,
            "w": 2,
            "h": 2,
            "burning": false,
            "stage": "complete",
            "door": {
             "x": 4,
             "y": 6
            },
            "full": true,
            "hearth": "cold",
            "bed": true
           }
          ],
          "items": [
           {
            "id": "item_5",
            "kind": "bowl",
            "qty": 1,
            "x": 4,
            "y": 4
           }
          ],
          "crops": [],
          "fauna": [],
          "forageables": []
         },
         "heard": [
          {
           "speakerId": "b",
           "name": "b",
           "text": "shut the door",
           "distance": 0
          }
         ],
         "seen": []
        }"
      `)
  })
})

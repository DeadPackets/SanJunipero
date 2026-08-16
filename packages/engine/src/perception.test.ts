import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG, SimConfigSchema, type SimEvent } from '@sj/shared'
import { genesisState, type TileId, type WorldState } from './state.js'
import { fold } from './fold.js'
import { composePerception, hears } from './perception.js'
import { VERBS } from './verbs.js'
import { RngStream } from './rng.js'

let seq = 90000
const ev = (type: string, payload: unknown, tick = 0): SimEvent => ({ seq: seq++, tick, type, payload })

function makeWorld(agents: Array<{ id: string; x: number; y: number }>): WorldState {
  let s = genesisState(DEFAULT_CONFIG, Array.from({ length: 64 }, () => Array.from({ length: 64 }, (): TileId => 0)))
  for (const a of agents) s = fold(s, ev('agent_spawned', { id: a.id, name: a.id, x: a.x, y: a.y, ageDays: 7300 }), DEFAULT_CONFIG)
  return s
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
    expect(p.visible.agents.map(g => g.id)).toEqual(['near'])
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
    expect(p.heard).toEqual([{ speakerId: 'near', name: 'near', text: 'close words', distance: earshot }])
  })

  it('an event that happened out of range appears nowhere in the packet', () => {
    const s = makeWorld([{ id: 'a', x: 0, y: 0 }, { id: 'far', x: 100, y: 100 }])
    const events = [ev('agent_spoke', { agentId: 'far', text: 'out of range whisper', x: 100, y: 100 })]
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
    expect(pa.heard.map(h => h.speakerId)).toEqual(['b'])
    expect(pa.heard[0]!.text).toBe('hello there')
    expect(pc.heard).toEqual([])
    // A also sees B; C does not (B is 49 away, beyond sight).
    expect(pa.visible.agents.map(g => g.id)).toEqual(['b'])
    expect(pc.visible.agents.map(g => g.id)).toEqual([])
  })
})

describe('composePerception: structure visibility by nearest tile', () => {
  it('sees a structure whose anchor is out of range but whose near edge is in range', () => {
    const sight = DEFAULT_CONFIG.movement.sightRadius // 12
    let s = makeWorld([{ id: 'a', x: 15, y: 0 }])
    // anchor (1,0) is 14 away; nearest footprint tile (4,0) is 11 away
    s = fold(s, ev('structure_planned', {
      id: 'structure_1', kind: 'storehouse', x: 1, y: 0, w: 4, h: 1, maxHp: 20, flammable: true, builderId: 'script',
    }), DEFAULT_CONFIG)
    // entirely out of range: nearest tile (4,30) is > sight away
    s = fold(s, ev('structure_planned', {
      id: 'structure_2', kind: 'shed', x: 1, y: 30, w: 4, h: 1, maxHp: 20, flammable: true, builderId: 'script',
    }), DEFAULT_CONFIG)
    const p = composePerception(s, DEFAULT_CONFIG, 'a', [])
    expect(sight).toBe(12)
    expect(p.visible.structures.map(st => st.id)).toEqual(['structure_1'])
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
    const s = makeWorld([{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 0 }])
    const events = [
      ev('agent_injured', { agentId: 'a', kind: 'minor' }),
      ev('agent_injured', { agentId: 'b', kind: 'grave' }),
    ]
    expect(composePerception(s, DEFAULT_CONFIG, 'a', events).feltEvents).toEqual(['you_were_attacked'])
  })
})

describe('composePerception: packet shape', () => {
  it('reflects self body, inventory, weather, and nearby ground items', () => {
    let s = makeWorld([{ id: 'a', x: 2, y: 3 }])
    s = fold(s, ev('item_spawned', { id: 'item_1', kind: 'wood', qty: 3, loc: { t: 'agent', id: 'a' } }), DEFAULT_CONFIG)
    s = fold(s, ev('item_spawned', { id: 'item_2', kind: 'stone', qty: 1, loc: { t: 'tile', x: 3, y: 3 } }), DEFAULT_CONFIG)
    s = fold(s, ev('agent_injured', { agentId: 'a', kind: 'minor' }), DEFAULT_CONFIG)
    const p = composePerception(s, DEFAULT_CONFIG, 'a', [])
    expect(p.time.tick).toBe(s.tick)
    expect(p.self).toMatchObject({ x: 2, y: 3, activity: null })
    expect(p.self.body.hp).toBe(DEFAULT_CONFIG.health.maxHp - DEFAULT_CONFIG.health.injuryDamage.minor)
    expect(p.self.body.injuries).toHaveLength(1)
    expect(p.self.body.injuries[0]!.kind).toBe('minor')
    expect(p.self.inventory.map(i => i.kind)).toEqual(['wood'])
    expect(p.visible.items.map(i => i.kind)).toEqual(['stone'])
    expect(p.weather).toEqual(s.weather)
  })
})

// You cannot read a birthday off a face, but you can tell a child from an old woman.
describe('composePerception: age reads off the body', () => {
  const YEAR = 364 // DAYS_PER_YEAR
  const withAge = (ageDays: number): WorldState => {
    const s = makeWorld([{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 0 }])
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
    expect(bandOf((DEFAULT_CONFIG.aging.elderFromYears * YEAR) - 1)).toBe('adult')
    expect(bandOf(DEFAULT_CONFIG.aging.elderFromYears * YEAR)).toBe('elder')
  })
})

describe('composePerception: structure contents', () => {
  // Storehouse footprint tiles: (10,10),(11,10),(10,11),(11,11).
  const storehouse = { id: 'structure_1', kind: 'storehouse', x: 10, y: 10, w: 2, h: 2 }

  function makeStorehouseWorld(agent: { id: string; x: number; y: number }): WorldState {
    let s = makeWorld([agent])
    s = fold(s, ev('structure_planned', {
      id: storehouse.id, kind: storehouse.kind, x: storehouse.x, y: storehouse.y,
      w: storehouse.w, h: storehouse.h, maxHp: 20, flammable: true, builderId: 'script',
    }), DEFAULT_CONFIG)
    s = fold(s, ev('item_spawned', { id: 'item_1', kind: 'bread', qty: 20, loc: { t: 'structure', id: storehouse.id } }), DEFAULT_CONFIG)
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

// --- C9 Task 3: occlusion, interior sight, witnessed channel ---------------

// A complete 2x2 hut anchored at (10,10); its door is the tile south of centre, (10,12).
const HUT = { id: 'structure_1', kind: 'hut', x: 10, y: 10, w: 2, h: 2 }
const DOOR = { x: 10, y: 12 }

function withHut(s: WorldState): WorldState {
  let out = fold(s, ev('structure_planned', {
    id: HUT.id, kind: HUT.kind, x: HUT.x, y: HUT.y, w: HUT.w, h: HUT.h,
    maxHp: 50, flammable: true, builderId: 'script',
  }), DEFAULT_CONFIG)
  return fold(out, ev('structure_completed', { id: HUT.id }), DEFAULT_CONFIG)
}

// Put an already-spawned agent inside the hut, body parked on the door tile.
function goInside(s: WorldState, id: string, structureId = HUT.id): WorldState {
  const moved = fold(s, ev('agent_moved', { id, x: DOOR.x, y: DOOR.y }), DEFAULT_CONFIG)
  return fold(moved, ev('agent_entered', { agentId: id, structureId }), DEFAULT_CONFIG)
}

const spoke = (agentId: string, text: string, x: number, y: number, insideId?: string): SimEvent =>
  ev('agent_spoke', insideId === undefined ? { agentId, text, x, y } : { agentId, text, x, y, insideId })

describe('composePerception: earshot occlusion', () => {
  it('co-occupants hear each other regardless of where the hut sits', () => {
    let s = withHut(makeWorld([{ id: 'a', x: 9, y: 12 }, { id: 'b', x: 11, y: 12 }]))
    s = goInside(goInside(s, 'a'), 'b')
    const p = composePerception(s, DEFAULT_CONFIG, 'a', [spoke('b', 'inside words', DOOR.x, DOOR.y, HUT.id)])
    expect(p.heard.map(h => h.text)).toEqual(['inside words'])
  })

  it('two agents in different huts do not hear each other', () => {
    let s = withHut(makeWorld([{ id: 'a', x: 9, y: 12 }, { id: 'b', x: 11, y: 12 }]))
    s = fold(s, ev('structure_planned', {
      id: 'structure_2', kind: 'hut', x: 14, y: 10, w: 2, h: 2, maxHp: 50, flammable: true, builderId: 'script',
    }), DEFAULT_CONFIG)
    s = fold(s, ev('structure_completed', { id: 'structure_2' }), DEFAULT_CONFIG)
    s = goInside(s, 'a')
    s = fold(s, ev('agent_moved', { id: 'b', x: 14, y: 12 }), DEFAULT_CONFIG)
    s = fold(s, ev('agent_entered', { agentId: 'b', structureId: 'structure_2' }), DEFAULT_CONFIG)
    const p = composePerception(s, DEFAULT_CONFIG, 'a', [spoke('b', 'other hut', 14, 12, 'structure_2')])
    expect(p.heard).toEqual([])
  })

  it('speech from inside reaches the doorway and no further', () => {
    let s = withHut(makeWorld([
      { id: 'inside', x: 9, y: 12 },
      { id: 'atDoor', x: 11, y: 13 },   // Chebyshev 1 from the door
      { id: 'nearby', x: 10, y: 14 },   // Chebyshev 2 — well inside earshot 8, still deaf
    ]))
    s = goInside(s, 'inside')
    const events = [spoke('inside', 'a whisper', DOOR.x, DOOR.y, HUT.id)]
    expect(composePerception(s, DEFAULT_CONFIG, 'atDoor', events).heard.map(h => h.text)).toEqual(['a whisper'])
    expect(composePerception(s, DEFAULT_CONFIG, 'nearby', events).heard).toEqual([])
  })

  it('the doorway rule is symmetric — outside speech reaches an insider only from the door', () => {
    let s = withHut(makeWorld([
      { id: 'inside', x: 9, y: 12 },
      { id: 'atDoor', x: 11, y: 13 },
      { id: 'nearby', x: 10, y: 14 },
    ]))
    s = goInside(s, 'inside')
    expect(composePerception(s, DEFAULT_CONFIG, 'inside', [spoke('atDoor', 'let me in', 11, 13)])
      .heard.map(h => h.text)).toEqual(['let me in'])
    expect(composePerception(s, DEFAULT_CONFIG, 'inside', [spoke('nearby', 'too far', 10, 14)])
      .heard).toEqual([])
  })

  it('leaves the open-air rule alone — plain earshot both ways', () => {
    const earshot = DEFAULT_CONFIG.movement.earshotRadius
    const s = withHut(makeWorld([{ id: 'a', x: 0, y: 0 }, { id: 'b', x: earshot, y: 0 }]))
    expect(composePerception(s, DEFAULT_CONFIG, 'a', [spoke('b', 'across the field', earshot, 0)])
      .heard.map(h => h.text)).toEqual(['across the field'])
  })

  it('hears() is the pure rule the packet is built from', () => {
    let s = withHut(makeWorld([{ id: 'a', x: 9, y: 12 }, { id: 'b', x: 11, y: 13 }]))
    s = goInside(s, 'a')
    const fromInside = spoke('a', 'hush', DOOR.x, DOOR.y, HUT.id)
    expect(hears(s, DEFAULT_CONFIG, fromInside, 'b')).toBe(true)
    expect(hears(s, DEFAULT_CONFIG, fromInside, 'a')).toBe(true) // the rule itself is speaker-agnostic
    const far = spoke('b', 'oi', 20, 20)
    expect(hears(s, DEFAULT_CONFIG, far, 'a')).toBe(false)
  })

  it('speak stamps the speaker insideId, and only when indoors', () => {
    const rng = RngStream.seed('perception-test', 'actions')
    let s = withHut(makeWorld([{ id: 'a', x: 9, y: 12 }]))
    expect(VERBS.speak!.onComplete(s, DEFAULT_CONFIG, 'a', { text: 'out here' }, rng))
      .toEqual([{ type: 'agent_spoke', payload: { agentId: 'a', text: 'out here', x: 9, y: 12 } }])
    s = goInside(s, 'a')
    expect(VERBS.speak!.onComplete(s, DEFAULT_CONFIG, 'a', { text: 'in here' }, rng))
      .toEqual([{ type: 'agent_spoke', payload: { agentId: 'a', text: 'in here', x: DOOR.x, y: DOOR.y, insideId: HUT.id } }])
  })
})

describe('composePerception: interior sight', () => {
  function peopledHut(): WorldState {
    let s = withHut(makeWorld([
      { id: 'a', x: 9, y: 12 },
      { id: 'mate', x: 11, y: 12 },
      { id: 'passerby', x: 13, y: 13 },
    ]))
    s = goInside(goInside(s, 'a'), 'mate')
    s = fold(s, ev('item_spawned', { id: 'item_1', kind: 'bread', qty: 2, loc: { t: 'structure', id: HUT.id } }), DEFAULT_CONFIG)
    s = fold(s, ev('item_spawned', { id: 'item_2', kind: 'stone', qty: 1, loc: { t: 'tile', x: 13, y: 13 } }), DEFAULT_CONFIG)
    s = fold(s, ev('crop_planted', { id: 'crop_1', kind: 'wheat', x: 13, y: 12, plantedDay: 0 }), DEFAULT_CONFIG)
    return s
  }

  it('an insider sees co-occupants and the hut contents, never the meadow', () => {
    const p = composePerception(peopledHut(), DEFAULT_CONFIG, 'a', [])
    expect(p.visible.agents.map(g => g.id)).toEqual(['mate'])
    expect(p.visible.items.map(i => i.id)).toEqual(['item_1'])
    expect(p.visible.structures.map(st => st.id)).toEqual([HUT.id])
    expect(p.visible.crops).toEqual([])
  })

  it('an outsider standing right there sees no one inside', () => {
    const p = composePerception(peopledHut(), DEFAULT_CONFIG, 'passerby', [])
    expect(p.visible.agents).toEqual([])
    expect(p.visible.items.map(i => i.id)).toEqual(['item_2']) // not adjacent to the hut: no peek
  })

  it('weather and own body still reach an insider', () => {
    const s = peopledHut()
    const p = composePerception(s, DEFAULT_CONFIG, 'a', [ev('weather_changed', { kind: 'rain', temperatureC: 8 })])
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

// --- C9 Task 5: ownership prose + witnessed takings -------------------------

const taken = (takerId: string, ownerId: string, x: number, y: number, itemId = 'item_1', kind = 'bread'): SimEvent =>
  ev('item_taken', { itemId, kind, takerId, ownerId, x, y })

describe('composePerception: ownership prose', () => {
  function ownedWorld(): WorldState {
    let s = makeWorld([{ id: 'watcher', x: 0, y: 0 }, { id: 'rahel', x: 2, y: 0 }])
    s = fold(s, ev('agent_spawned', { id: 'yusuf', name: 'Yusuf', x: 3, y: 0, ageDays: 7300 }), DEFAULT_CONFIG)
    s = fold(s, ev('item_spawned', {
      id: 'item_1', kind: 'basket', qty: 1, loc: { t: 'tile', x: 1, y: 0 }, owner: 'rahel',
    }), DEFAULT_CONFIG)
    s = fold(s, ev('item_spawned', {
      id: 'item_2', kind: 'chair', qty: 1, loc: { t: 'agent', id: 'watcher' }, owner: 'watcher', crafterMark: 'yusuf',
    }), DEFAULT_CONFIG)
    s = fold(s, ev('item_spawned', {
      id: 'item_3', kind: 'stone', qty: 1, loc: { t: 'tile', x: 1, y: 1 },
    }), DEFAULT_CONFIG)
    return s
  }

  it('names the owner of a thing on the ground and the maker of a thing in hand', () => {
    const p = composePerception(ownedWorld(), DEFAULT_CONFIG, 'watcher', [])
    expect(p.visible.items.find(i => i.id === 'item_1')).toMatchObject({ ownerName: 'rahel' })
    expect(p.self.inventory.find(i => i.id === 'item_2'))
      .toMatchObject({ ownerName: 'watcher', crafterMarkName: 'Yusuf' })
  })

  it('leaves an unowned thing unnamed rather than calling it no-one’s', () => {
    const p = composePerception(ownedWorld(), DEFAULT_CONFIG, 'watcher', [])
    const stone = p.visible.items.find(i => i.id === 'item_3')!
    expect(stone).not.toHaveProperty('ownerName')
    expect(stone).not.toHaveProperty('crafterMarkName')
  })

  it('keeps naming a dead owner — the basket is still Rahel’s', () => {
    let s = ownedWorld()
    s = fold(s, ev('agent_died', { agentId: 'rahel', cause: 'starvation' }), DEFAULT_CONFIG)
    const p = composePerception(s, DEFAULT_CONFIG, 'watcher', [])
    expect(p.visible.agents.map(g => g.id)).not.toContain('rahel')
    expect(p.visible.items.find(i => i.id === 'item_1')).toMatchObject({ ownerName: 'rahel' })
  })

  it('never mutates the stored item while dressing it in a name', () => {
    const s = ownedWorld()
    composePerception(s, DEFAULT_CONFIG, 'watcher', [])
    expect(s.items.item_2!).not.toHaveProperty('crafterMarkName')
  })

  it('stops surfacing ownership when the flag is off', () => {
    const off = SimConfigSchema.parse({ ownership: { enabled: false } })
    const p = composePerception(ownedWorld(), off, 'watcher', [])
    expect(p.visible.items.find(i => i.id === 'item_1')).not.toHaveProperty('ownerName')
    expect(p.self.inventory.find(i => i.id === 'item_2')).not.toHaveProperty('crafterMarkName')
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
    const p = composePerception(theftWorld(), DEFAULT_CONFIG, 'bystander', [taken('omar', 'salma', 4, 4)])
    expect(p.seen).toEqual([{ kind: 'item_taken', takerName: 'omar', ownerName: 'salma', itemKind: 'bread' }])
  })

  it('is blind past the sight radius', () => {
    expect(composePerception(theftWorld(), DEFAULT_CONFIG, 'distant', [taken('omar', 'salma', 4, 4)]).seen)
      .toEqual([])
  })

  it('does not echo your own hands back at you', () => {
    expect(composePerception(theftWorld(), DEFAULT_CONFIG, 'omar', [taken('omar', 'salma', 4, 4)]).seen)
      .toEqual([])
  })

  it('walls block the view — indoors you see only what happens in the room', () => {
    let s = withHut(theftWorld())
    s = goInside(s, 'bystander')
    expect(composePerception(s, DEFAULT_CONFIG, 'bystander', [taken('omar', 'salma', 4, 4)]).seen).toEqual([])
    s = goInside(s, 'omar')
    expect(composePerception(s, DEFAULT_CONFIG, 'bystander', [taken('omar', 'salma', DOOR.x, DOOR.y)]).seen)
      .toEqual([{ kind: 'item_taken', takerName: 'omar', ownerName: 'salma', itemKind: 'bread' }])
  })

  it('goes quiet when the flag is off', () => {
    const off = SimConfigSchema.parse({ ownership: { enabled: false } })
    expect(composePerception(theftWorld(), off, 'bystander', [taken('omar', 'salma', 4, 4)]).seen).toEqual([])
  })
})

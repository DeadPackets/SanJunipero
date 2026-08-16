import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG, type SimEvent } from '@sj/shared'
import { genesisState, type TileId, type WorldState } from './state.js'
import { fold } from './fold.js'
import { composePerception } from './perception.js'

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

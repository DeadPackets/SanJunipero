import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG, isRoofedKind, type SimConfig, type SimEvent } from '@sj/shared'
import { genesisState, type TileId, type WorldState } from './state.js'
import { fold } from './fold.js'
import { submitIntent } from './intent.js'
import { composePerception } from './perception.js'
import { doorTile, occupantsOf, roomCapacity, roomIsFull } from './interiors.js'
import { makeGenesisWorld } from './genesis/world.js'

// ★ THE SCENERY AND THE ROOM. Two abundance defects the motive probe measured on a live night:
// the valley's cabins, cottages and farmhouses were buildings nobody could get into (278 wasted
// `enter` acts across three nights, five founders down in the street one step from a wall), and
// `enter` had no cap at all, so one roof sheltered the whole town and the second house anybody
// raised was worth exactly nothing.

const CFG: SimConfig = DEFAULT_CONFIG
const ev = (seq: number, type: string, payload: unknown): SimEvent => ({ seq, tick: 0, type, payload })
const OPEN = Array.from({ length: 10 }, () => '..........')

function world(): WorldState {
  return genesisState(CFG, OPEN.map((row) => [...row].map(() => 0 as TileId)))
}

/** A completed building of `kind` at (2,1), sized off its own recipe row. */
function withBuilding(s: WorldState, kind: string, id = 'structure_1'): WorldState {
  const row = CFG.structures.recipes[kind]
  const { w, h } = row ?? { w: 2, h: 2 }
  let out = fold(s, ev(1, 'structure_planned', {
    id, kind, x: 2, y: 1, w, h, maxHp: row?.maxHp ?? 50, flammable: true, builderId: 'genesis',
  }))
  out = fold(out, ev(2, 'structure_completed', { id }))
  return out
}

function withAgentAtDoor(s: WorldState, id: string): WorldState {
  const door = doorTile(s, s.structures.structure_1!)!
  return fold(s, ev(10, 'agent_spawned', { id, name: id, x: door.x, y: door.y, ageDays: 7300 }))
}

const enter = (s: WorldState, id: string): ReturnType<typeof submitIntent> =>
  submitIntent(s, CFG, id, 'enter', { structureId: 'structure_1' })

// ------------------------------------------------------------------ R1: the scenery ---

describe('★ a roof is a property of the kind, and the valley meant what it looked like', () => {
  const DWELLINGS = ['house', 'cabin', 'cottage', 'farmhouse', 'storehouse']

  it('lets a body into every kind the town plants, and into nothing with no roof over it', () => {
    for (const kind of DWELLINGS) {
      let s = withBuilding(world(), kind)
      s = withAgentAtDoor(s, 'a1')
      const r = enter(s, 'a1')
      expect(r.ok, `${kind}: ${r.ok ? '' : r.reason}`).toBe(true)
    }
    for (const kind of ['well', 'grave', 'standing_stone']) {
      let s = withBuilding(world(), kind)
      s = withAgentAtDoor(s, 'a1')
      expect(enter(s, 'a1'), kind).toMatchObject({ ok: false })
    }
  })

  // The exact sentence 80 of arm B's 111 refusals were, on a night when nobody built anything.
  it('never says "there is no way into a cabin" again', () => {
    for (const kind of ['cabin', 'cottage', 'farmhouse']) {
      let s = withBuilding(world(), kind)
      s = withAgentAtDoor(s, 'a1')
      const r = enter(s, 'a1')
      expect(r.ok || r.reason !== `there is no way into a ${kind}`, kind).toBe(true)
    }
  })

  // The whole point of a property over a roster: ask the world, not a list somebody kept.
  it('is asked of the kind, and the town template has no kind it cannot answer for', () => {
    const g = makeGenesisWorld(CFG)
    const kinds = new Set(g.events
      .filter((e) => e.type === 'structure_planned')
      .map((e) => String((e.payload as { kind: string }).kind)))
    expect(kinds.size).toBeGreaterThan(4)
    // Every dwelling the valley stands up is one a body can get under.
    for (const k of ['cabin', 'cottage', 'farmhouse', 'house', 'storehouse']) {
      expect(kinds.has(k), `the valley has no ${k}`).toBe(true)
      expect(isRoofedKind(CFG, k), `${k} is not roofed`).toBe(true)
    }
    for (const k of ['well', 'fire_pit']) expect(isRoofedKind(CFG, k), k).toBe(false)
  })

  // A refusal must still be possible, or the test above passes on a world where `enter` never
  // refuses anything.
  it('still refuses an unfinished building and one out of reach', () => {
    let site = fold(world(), ev(1, 'structure_planned', {
      id: 'structure_1', kind: 'cottage', x: 2, y: 1, w: 3, h: 2, maxHp: 60, flammable: true, builderId: 'g',
    }))
    site = fold(site, ev(10, 'agent_spawned', { id: 'a1', name: 'a1', x: 3, y: 3, ageDays: 7300 }))
    expect(enter(site, 'a1')).toMatchObject({ ok: false, reason: 'it is not finished' })

    const far = fold(withBuilding(world(), 'cottage'), ev(10,
      'agent_spawned', { id: 'a1', name: 'a1', x: 9, y: 9, ageDays: 7300 }))
    expect(enter(far, 'a1')).toMatchObject({ ok: false, reason: 'not close enough to the door' })
  })
})

// ------------------------------------------------------------------ R2: the room ---

describe('★ a room holds only so many bodies, and floor area is why', () => {
  it('is two tiles of floor a body, from the footprint and nothing else', () => {
    expect(roomCapacity({ w: 2, h: 2 })).toBe(2)   // house, cabin, storehouse
    expect(roomCapacity({ w: 3, h: 2 })).toBe(3)   // cottage
    expect(roomCapacity({ w: 4, h: 2 })).toBe(4)   // farmhouse
    expect(roomCapacity({ w: 1, h: 1 })).toBe(1)   // never zero: a hut holds its one body
  })

  it('fills a house at two and turns the third away', () => {
    let s = withBuilding(world(), 'house')
    for (const id of ['a1', 'a2', 'a3']) s = withAgentAtDoor(s, id)
    expect(enter(s, 'a1').ok).toBe(true)
    s = fold(s, ev(20, 'agent_entered', { agentId: 'a1', structureId: 'structure_1' }))
    expect(enter(s, 'a2').ok).toBe(true)
    s = fold(s, ev(21, 'agent_entered', { agentId: 'a2', structureId: 'structure_1' }))
    expect(occupantsOf(s, 'structure_1')).toEqual(['a1', 'a2'])
    expect(roomIsFull(s, s.structures.structure_1!)).toBe(true)
    expect(enter(s, 'a3')).toMatchObject({
      ok: false, reason: 'there is no floor left in there — 2 bodies fill it',
    })
  })

  it('holds four in a farmhouse and one in a hut — the same rule, not a special case', () => {
    let big = withBuilding(world(), 'farmhouse')
    const ids = ['a1', 'a2', 'a3', 'a4', 'a5']
    for (const id of ids) big = withAgentAtDoor(big, id)
    for (const id of ids.slice(0, 4)) {
      expect(enter(big, id).ok, id).toBe(true)
      big = fold(big, ev(30, 'agent_entered', { agentId: id, structureId: 'structure_1' }))
    }
    expect(enter(big, 'a5')).toMatchObject({
      ok: false, reason: 'there is no floor left in there — 4 bodies fill it',
    })
  })

  it('empties again when somebody steps out — full is a state, not a verdict', () => {
    let s = withBuilding(world(), 'house')
    for (const id of ['a1', 'a2', 'a3']) s = withAgentAtDoor(s, id)
    s = fold(s, ev(20, 'agent_entered', { agentId: 'a1', structureId: 'structure_1' }))
    s = fold(s, ev(21, 'agent_entered', { agentId: 'a2', structureId: 'structure_1' }))
    expect(enter(s, 'a3').ok).toBe(false)
    s = fold(s, ev(22, 'agent_exited', { agentId: 'a1', structureId: 'structure_1' }))
    expect(enter(s, 'a3').ok).toBe(true)
  })

  // ★ PHYSICS, NOT OWNERSHIP. Ownership is a concept the town has to invent; gating the door on
  // it would hand it over. The owner gets no key and no priority — only floor decides.
  it('never asks whose the building is', () => {
    let s = fold(world(), ev(1, 'structure_planned', {
      id: 'structure_1', kind: 'house', x: 2, y: 1, w: 2, h: 2,
      maxHp: 50, flammable: true, builderId: 'owner', owner: 'owner',
    }))
    s = fold(s, ev(2, 'structure_completed', { id: 'structure_1' }))
    for (const id of ['owner', 'stranger1', 'stranger2']) s = withAgentAtDoor(s, id)
    // Two strangers walk into somebody else's house, and it is theirs while they stand in it.
    s = fold(s, ev(20, 'agent_entered', { agentId: 'stranger1', structureId: 'structure_1' }))
    s = fold(s, ev(21, 'agent_entered', { agentId: 'stranger2', structureId: 'structure_1' }))
    expect(enter(s, 'owner')).toMatchObject({
      ok: false, reason: 'there is no floor left in there — 2 bodies fill it',
    })
    // And with room in it, a stranger is let in exactly as the owner would be.
    s = fold(s, ev(22, 'agent_exited', { agentId: 'stranger1', structureId: 'structure_1' }))
    expect(enter(s, 'owner').ok).toBe(true)
  })

  // The single sentence a mind gets. It must say WHICH kind of no.
  it('tells a full room apart from a wall with no way through it', () => {
    let full = withBuilding(world(), 'house')
    for (const id of ['a1', 'a2', 'a3']) full = withAgentAtDoor(full, id)
    full = fold(full, ev(20, 'agent_entered', { agentId: 'a1', structureId: 'structure_1' }))
    full = fold(full, ev(21, 'agent_entered', { agentId: 'a2', structureId: 'structure_1' }))
    const busy = enter(full, 'a3')
    const solid = enter(withAgentAtDoor(withBuilding(world(), 'well'), 'a1'), 'a1')
    expect(busy.ok).toBe(false)
    expect(solid.ok).toBe(false)
    expect(busy.ok || solid.ok ? '' : busy.reason).not.toBe(solid.ok ? '' : solid.reason)
    if (!busy.ok) expect(busy.reason).toContain('bodies fill it')
    if (!solid.ok) expect(solid.reason).toContain('no roof')
  })
})

// ---------------------------------------------------- what a mind sees before it walks ---

describe('★ full reaches the packet, so nobody pays a turn to find out', () => {
  const packetFor = (s: WorldState, id: string) =>
    composePerception(s, CFG, id, []).visible.structures.find((x) => x.id === 'structure_1')!

  it('carries the doorway and no `full` while there is room', () => {
    let s = withBuilding(world(), 'house')
    s = withAgentAtDoor(s, 'a1')
    expect(packetFor(s, 'a1').door).toEqual({ x: 2, y: 3 })
    expect(packetFor(s, 'a1').full).toBeUndefined()
  })

  it('carries `full` alongside the doorway once the floor is taken', () => {
    let s = withBuilding(world(), 'house')
    for (const id of ['a1', 'a2', 'a3']) s = withAgentAtDoor(s, id)
    s = fold(s, ev(20, 'agent_entered', { agentId: 'a1', structureId: 'structure_1' }))
    s = fold(s, ev(21, 'agent_entered', { agentId: 'a2', structureId: 'structure_1' }))
    const seen = packetFor(s, 'a3')
    expect(seen.door).toEqual({ x: 2, y: 3 })
    expect(seen.full).toBe(true)
    // And the packet agrees with the verb, which is the whole reason it is there.
    expect(enter(s, 'a3').ok).toBe(false)
  })

  it('says nothing about a roofless thing, full or otherwise', () => {
    const s = withAgentAtDoor(withBuilding(world(), 'well'), 'a1')
    expect(packetFor(s, 'a1').door).toBeUndefined()
    expect(packetFor(s, 'a1').full).toBeUndefined()
  })
})

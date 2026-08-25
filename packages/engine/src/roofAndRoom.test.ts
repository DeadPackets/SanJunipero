import { describe, it, expect } from 'vitest'
import {
  DEFAULT_CONFIG, isBeddedKind, isHearthKind, isRoofedKind, MINUTES_PER_DAY,
  type SimConfig, type SimEvent,
} from '@sj/shared'
import { genesisState, type TileId, type WorldState } from './state.js'
import { fold } from './fold.js'
import { submitIntent } from './intent.js'
import { composePerception } from './perception.js'
import { doorTile, occupantsOf, roomCapacity, roomIsFull, shelterLedger } from './interiors.js'
import { makeGenesisWorld } from './genesis/world.js'
import { buildableRecipe } from './verbs.js'
import { FOUNDER_IDS } from '@sj/shared'

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

// ------------------------------------------------------------- R1b: the ladder ---

// ★ THE LADDER RAN THE WRONG WAY AND NOTHING SAID SO.
//
// Every dwelling is priced at ONE rate — 2.5 wood and 720 ticks a tile — so a farmhouse is 20
// wood, 5 760 ticks and 4 sleeping slots, and so is a PAIR of houses, to the wood and to the
// tick. With no `hearth` and no `bed` on its row the farmhouse was therefore the same floor for
// the same price MINUS two fires and two beds: not a worse rung, a STRICTLY DOMINATED one. A
// mind that saved half again and worked half again got less, and `wants` would have pointed it
// straight up that ladder — "a drive with no road is not a drive", in its purest form.
//
// The fix was effectiveness and not price, and this is the law rather than the two rows: what a
// dearer roof buys is floor, and the fuel economy that comes with floor. `stoke` feeds the
// BUILDING for one armful and `besideAKeptFire` warms everybody in the room off it, so wood per
// body-night falls as the roof grows. No new dial, no retuned rate.
describe('★ a dearer dwelling is never a worse one', () => {
  const r = CFG.structures.recipes
  const buildableDwellings = Object.keys(r)
    .filter((k) => isRoofedKind(CFG, k) && buildableRecipe(CFG, k) !== null)
    .sort()
  const woodOf = (k: string) => r[k]!.inputs['wood']!
  const slotsOf = (k: string) => roomCapacity({ w: r[k]!.w, h: r[k]!.h })
  /** What one night of fire costs each body under this roof. A night is 720 ticks and an armful
   *  buys `fuelBurnTicks` of them, and the whole room drinks the one fire. */
  const woodPerBodyNight = (k: string) => isHearthKind(CFG, k)
    ? (MINUTES_PER_DAY / 2) / CFG.light.fuelBurnTicks / slotsOf(k)
    : Infinity

  it('is asked of every dwelling a pair of hands can raise, and there are three', () => {
    expect(buildableDwellings).toEqual(['cottage', 'farmhouse', 'house'])
  })

  it('★ buys something with every extra armful, and gives nothing back', () => {
    for (const dear of buildableDwellings) {
      for (const cheap of buildableDwellings) {
        if (woodOf(dear) <= woodOf(cheap)) continue
        expect(slotsOf(dear), `${dear} over ${cheap}: floor`).toBeGreaterThan(slotsOf(cheap))
        expect(woodPerBodyNight(dear), `${dear} over ${cheap}: fuel`).toBeLessThan(woodPerBodyNight(cheap))
        // And it gives nothing back: whatever the cheaper roof holds, the dearer one holds too.
        if (isHearthKind(CFG, cheap)) expect(isHearthKind(CFG, dear), `${dear} lost the fire`).toBe(true)
        if (isBeddedKind(CFG, cheap)) expect(isBeddedKind(CFG, dear), `${dear} lost the bed`).toBe(true)
      }
    }
  })

  // ★ VACUOUS GUARD: the loop above passes on an empty world and on a flat one. These are the
  // rungs as real numbers, and the price they were bought at is UNCHANGED — the tuning order on
  // this project is effectiveness → abundance → time-cost → difficulty LAST, and this fix never
  // reached the last step.
  it('★ is a real ladder — three rungs of fuel, at one unmoved rate', () => {
    expect(buildableDwellings.map(slotsOf)).toEqual([3, 4, 2])
    expect(buildableDwellings.map(woodPerBodyNight)).toEqual([0.5, 0.375, 0.75])
    for (const k of buildableDwellings) {
      const tiles = r[k]!.w * r[k]!.h
      expect(woodOf(k) / tiles, `${k} wood a tile`).toBe(2.5)
      expect(r[k]!.durationTicks / tiles, `${k} ticks a tile`).toBe(720)
    }
  })

  // ★ AND THE SMALL ROOF IS NOT DOMINATED IN RETURN. A house buys the cheapest door in the
  // world and the only PRIVATE one: `reproductionSystem` counts a night only under a kind named
  // here, so a couple's own roof is a thing no farmhouse can be. That is what the two-slot
  // dwelling keeps, and it is why the ladder is a trade rather than a ranking.
  it('★ leaves the house the one thing no bigger roof can buy', () => {
    expect(CFG.structures.privateKinds).toEqual(['house'])
    expect(woodOf('house')).toBe(Math.min(...buildableDwellings.map(woodOf)))
    for (const k of buildableDwellings) {
      if (k === 'house') continue
      expect(CFG.structures.privateKinds, k).not.toContain(k)
    }
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

// ---------------------------------------- R5: the fixtures pre-satisfy the only want we model ---

describe('★ the shelter ledger — roofs against bodies, which nobody was counting', () => {
  function genesisTown(bodies: number): WorldState {
    const g = makeGenesisWorld(CFG)
    let s = genesisState(CFG, g.terrain)
    let seq = 0
    for (const e of g.events) s = fold(s, ev(++seq, e.type, e.payload), CFG)
    for (let i = 0; i < bodies; i++) {
      s = fold(s, ev(++seq + 1000, 'agent_spawned',
        { id: `b${i}`, name: `b${i}`, x: 60 + i, y: 90, ageDays: 7300 }), CFG)
    }
    return s
  }

  it('counts only what is finished and has a roof over it', () => {
    let s = withBuilding(world(), 'house')
    s = withAgentAtDoor(s, 'a1')
    expect(shelterLedger(s, CFG)).toEqual({ roofs: 1, slots: 2, bodies: 1, per: 2 })
    // A well is finished and roofless; a half-raised house has a roof nowhere yet.
    s = fold(s, ev(39, 'structure_planned', {
      id: 'structure_2', kind: 'well', x: 7, y: 1, w: 1, h: 1,
      maxHp: 30, flammable: false, builderId: 'a1',
    }))
    s = fold(s, ev(39, 'structure_completed', { id: 'structure_2' }))
    s = fold(s, ev(40, 'structure_planned', {
      id: 'structure_3', kind: 'house', x: 6, y: 6, w: 2, h: 2,
      maxHp: 50, flammable: true, builderId: 'a1',
    }))
    expect(shelterLedger(s, CFG)).toMatchObject({ roofs: 1, slots: 2 })
  })

  // ★ THE NUMBER, AND IT IS THE WHOLE OF WHY THE ROOFS CAME DOWN. Sound, this village handed
  // five founders 21 bodies' worth of floor before the first tick — 4.2x — and the only want
  // this project models was answered at tick zero. Every production figure ever reported from
  // here was measured in that town. Two roofs held; the other seven are walls.
  it('★ puts the founding valley below 1.0, which sound it never was', () => {
    const led = shelterLedger(genesisTown(FOUNDER_IDS.length), CFG)
    expect(led.bodies).toBe(5)
    expect(led.roofs).toBe(2)                 // the storehouse and the cabin
    expect(led.slots).toBe(4)
    expect(led.per).toBe(0.8)
    expect(led.per, 'the founding cannot host the want it means to measure').toBeLessThan(1)

    // WHAT IT WAS. Put every roof back on and the same arithmetic gives the old town.
    let sound = genesisTown(FOUNDER_IDS.length)
    for (const st of Object.values(sound.structures)) {
      if (st.stage !== 'construction') continue
      sound = fold(sound, ev(500 + Number(st.id.split('_')[1]), 'structure_completed', { id: st.id }))
    }
    const before = shelterLedger(sound, CFG)
    expect(before).toMatchObject({ roofs: 9, slots: 21, bodies: 5 })
    expect(before.per).toBeCloseTo(4.2, 5)

    // And it was never the five OWNED houses that did it — structure ownership is not even in
    // the perception packet. Delete all five and the village still holds eleven against five.
    expect(21 - 5 * 2).toBe(11)
  })

  // 0.8 and not lower, and the reason is a hard constraint rather than a taste: every roof that
  // comes down has to be one a pair of hands can put back. The only other 2-slot kinds are the
  // cabin and the storehouse, both 2x2 — exactly a house's mass — so making either buildable
  // would mint a second name for `house`. A one-body want beats a wall that lies.
  it('is the floor reachable without standing up a wall nobody could finish', () => {
    for (const st of Object.values(genesisTown(0).structures)) {
      if (st.stage !== 'construction') continue
      expect(buildableRecipe(CFG, st.kind), `${st.kind} cannot be finished`).not.toBeNull()
    }
    for (const kind of ['cabin', 'storehouse']) {
      const row = CFG.structures.recipes[kind]!
      expect(row.w * row.h, kind).toBe(CFG.structures.recipes['house']!.w * CFG.structures.recipes['house']!.h)
      expect(buildableRecipe(CFG, kind), `${kind} became a second name for a house`).toBeNull()
    }
  })

  it('is the thing a run has to get below 1.0 before it can watch a town answer the cold', () => {
    expect(shelterLedger(genesisTown(30), CFG).per).toBeLessThan(1)
    expect(shelterLedger(genesisTown(4), CFG).per).toBe(1)
    expect(shelterLedger(genesisTown(2), CFG).per).toBe(2)
  })
})

// @slow — GATE G9a, the deterministic half of the living-world gate (addendum §17).
// Scripted actors only: no LLM, no network, no clock acceleration where the clock is
// the subject. Partnership runs on the REAL `coSleepNightsToPartner: 3`; only gestation
// and the conception roll are forced, because 72 sim-days of waiting tests nothing.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  DAYS_PER_YEAR, MINUTES_PER_DAY, SPAWN_AGE_YEARS, SimConfigSchema, stateHash,
  type SimConfig, type SimEvent,
} from '@sj/shared'
import { openDb } from './db.js'
import { EventStore } from './eventStore.js'
import { fold } from './fold.js'
import { submitIntent } from './intent.js'
import { doorTile } from './interiors.js'
import { applyLaw, effectiveConfig, TOGGLABLE_PATHS, type LawQueue } from './laws.js'
import { composePerception } from './perception.js'
import { replayFromGenesis, replayLatest } from './replay.js'
import { RngStream, RngStreams } from './rng.js'
import { genesisState, type TileId, type WorldState } from './state.js'
import { ageBand } from './systems/aging.js'
import { isPartnered, partnershipOf } from './systems/reproduction.js'
import { spoilDeadline } from './systems/spoilage.js'
import { TickLoop } from './tickLoop.js'
import { VERBS, type PendingEvent } from './verbs.js'
import { createWorldTick } from './worldTick.js'

// A quiet sky and no mysteries by default: every event this gate names is one a
// scripted actor or a named system caused, never weather noise.
const QUIET = { weather: { hourlyChangeChance: 0 }, mystery: { chancePerDay: 0 } }
const CFG: SimConfig = SimConfigSchema.parse(QUIET)
// The only acceleration in this file, and neither clock is under test here.
const FERTILE: SimConfig = SimConfigSchema.parse({
  ...QUIET, reproduction: { conceptionChancePerNight: 1, gestationDays: 1 },
})

const RNG = RngStream.seed('g9a', 'actions')

let seq = 900000
const ev = (type: string, payload: unknown, tick = 0): SimEvent => ({ seq: seq++, tick, type, payload })

const MAP = (n = 24): TileId[][] => Array.from({ length: n }, () => Array.from({ length: n }, (): TileId => 0))

type Box = { id: string; kind: string; x: number; y: number; w: number; h: number }
const HOUSE: Box = { id: 'structure_1', kind: 'house', x: 4, y: 4, w: 2, h: 2 }        // door (4,6)
const STORE: Box = { id: 'structure_2', kind: 'storehouse', x: 10, y: 4, w: 2, h: 2 } // door (10,6)

function raise(s: WorldState, config: SimConfig, box: Box, owner?: string): WorldState {
  const planned = fold(s, ev('structure_planned', {
    ...box, maxHp: 50, flammable: true, builderId: 'script',
    ...(owner === undefined ? {} : { owner }),
  }), config)
  return fold(planned, ev('structure_completed', { id: box.id }), config)
}

type Spawn = { id: string; x: number; y: number; sex?: 'f' | 'm'; ageDays?: number }

function spawn(s: WorldState, config: SimConfig, a: Spawn): WorldState {
  return fold(s, ev('agent_spawned', {
    id: a.id, name: a.id, x: a.x, y: a.y, ageDays: a.ageDays ?? 7300,
    ...(a.sex === undefined ? {} : { sex: a.sex }),
  }), config)
}

const indoors = (s: WorldState, config: SimConfig, id: string, box: Box): WorldState => {
  const door = doorTile(s, s.structures[box.id]!)!
  const moved = fold(s, ev('agent_moved', { id, x: door.x, y: door.y }), config)
  return fold(moved, ev('agent_entered', { agentId: id, structureId: box.id }), config)
}

const asleep = (s: WorldState, config: SimConfig, id: string): WorldState =>
  fold(s, ev('agent_slept', { agentId: id }), config)

function apply(s: WorldState, config: SimConfig, events: PendingEvent[], tick = 0): WorldState {
  return events.reduce((acc, e) => fold(acc, ev(e.type, e.payload, tick), config), s)
}

// One full world pass at a chosen moment of a chosen day — the real pipeline, so a row
// that passes here passes in a running town.
function pass(s: WorldState, config: SimConfig, day: number, hour = 0, seed = 'g9a'): {
  state: WorldState; events: PendingEvent[]
} {
  const tick = day * MINUTES_PER_DAY + hour * 60
  const advanced = fold({ ...s, tick: tick - 1 }, ev('tick_advanced', {}, tick), config)
  return createWorldTick(config, new RngStreams(seed))(advanced)
}

const nights = (s: WorldState, config: SimConfig, days: number[], seed = 'g9a'): WorldState =>
  days.reduce((acc, day) => pass(acc, config, day, 0, seed).state, s)

const typed = (events: PendingEvent[], type: string): PendingEvent[] => events.filter((e) => e.type === type)

// The config the tick wrapper would hand a verb: base ⊕ whatever the world has legislated.
const live = (s: WorldState, base = CFG): SimConfig => effectiveConfig(base, s.laws)

// A couple in their own house, asleep — the only shape the co-sleeping pass ever reads.
function couple(config: SimConfig): WorldState {
  let s = raise(genesisState(config, MAP()), config, HOUSE)
  s = spawn(s, config, { id: 'ada', x: 4, y: 6, sex: 'f', ageDays: 30 * DAYS_PER_YEAR })
  s = spawn(s, config, { id: 'bex', x: 4, y: 6, sex: 'm', ageDays: 32 * DAYS_PER_YEAR })
  for (const id of ['ada', 'bex']) { s = indoors(s, config, id, HOUSE); s = asleep(s, config, id) }
  return s
}

describe('G9a-1: partnership is counted at the real threshold, and an eight-day gap ends it', () => {
  it('three nights make a pair; two do not', () => {
    expect(CFG.reproduction.coSleepNightsToPartner).toBe(3) // the threshold is the thing under test
    const two = nights(couple(CFG), CFG, [1, 2])
    expect(partnershipOf(two, 'ada', 'bex')!.nights).toBe(2)
    expect(isPartnered(two, 'ada', 'bex', CFG)).toBe(false)
    expect(partnershipOf(two, 'ada', 'bex')!.formedTick).toBeNull()

    const three = nights(two, CFG, [3])
    expect(partnershipOf(three, 'ada', 'bex')!.nights).toBe(3)
    expect(isPartnered(three, 'ada', 'bex', CFG)).toBe(true)
    expect(partnershipOf(three, 'ada', 'bex')!.formedTick).toBe(3 * MINUTES_PER_DAY)
    expect(partnershipOf(three, 'ada', 'bex')!.dissolvedTick).toBeNull()
  })

  it('an eight-day gap dissolves it, and the breakup is stamped for C11 to read', () => {
    const partnered = nights(couple(CFG), CFG, [1, 2, 3])
    const apart = nights(partnered, CFG, [11]) // day 3 → day 11: an eight-day gap
    expect(partnershipOf(apart, 'ada', 'bex')).toEqual({
      nights: 1, lastNightDay: 11, formedTick: 3 * MINUTES_PER_DAY, dissolvedTick: 11 * MINUTES_PER_DAY,
    })
    expect(isPartnered(apart, 'ada', 'bex', CFG)).toBe(false)
  })
})

describe('G9a-2: conception, gestation and a child born at twelve', () => {
  it('runs the whole chain, and the newborn wakes as a twelve-year-old', () => {
    const twoNights = nights(couple(FERTILE), FERTILE, [1, 2])
    expect(twoNights.agents.ada!.pregnant).toBeUndefined() // two nights in is still two nights in

    // The third night both partners them and conceives, in that order.
    const third = pass(twoNights, FERTILE, 3)
    expect(typed(third.events, 'agent_conceived').map((e) => e.payload)).toEqual([
      { motherId: 'ada', fatherId: 'bex', day: 3 },
    ])
    const carrying = third.state
    expect(carrying.agents.ada!.pregnant).toEqual({ sinceDay: 3, byId: 'bex' })

    const delivery = pass(carrying, FERTILE, 4)
    const born = typed(delivery.events, 'agent_born')
    expect(born).toHaveLength(1)
    const p = born[0]!.payload as { id: string; sex: 'f' | 'm'; motherId: string; fatherId: string }
    expect(p.motherId).toBe('ada')
    expect(p.fatherId).toBe('bex')

    const child = delivery.state.agents[p.id]!
    // Born at twelve on this world's 364-day calendar; the same midnight's aging pass
    // then gives her the day she was born in, like everyone else.
    expect(Math.floor(child.ageDays / DAYS_PER_YEAR)).toBe(SPAWN_AGE_YEARS)
    expect(child.ageDays).toBe(SPAWN_AGE_YEARS * DAYS_PER_YEAR + 1)
    expect(ageBand(FERTILE, child.ageDays)).toBe('child')
    expect(child.parents).toEqual(['ada', 'bex'])
    expect(child.sex).toBe(p.sex)
    expect(child.insideId).toBe(HOUSE.id) // born where the mother lay
    expect(delivery.state.agents.ada!.pregnant).toBeUndefined()
  })

  it('goes silent under the reproduction law, and the law travels as an event', () => {
    const off = fold(couple(FERTILE), ev('config_changed', { path: 'reproduction.enabled', value: false }), FERTILE)
    const quiet = pass(off, FERTILE, 1)
    expect(typed(quiet.events, 'co_slept')).toEqual([])
    expect(quiet.state.pairNights).toBeUndefined()
  })
})

describe('G9a-3: the ownership chain — craft, give, and a taking the town can see', () => {
  // 24x24 of grass; the storehouse at (10,4) is the shelf everything moves through.
  function town(): WorldState {
    let s = raise(genesisState(CFG, MAP()), CFG, HOUSE)
    s = raise(s, CFG, STORE)
    s = spawn(s, CFG, { id: 'maker', x: 8, y: 5 })
    s = spawn(s, CFG, { id: 'owner', x: 9, y: 5 })
    s = spawn(s, CFG, { id: 'taker', x: 11, y: 5 })
    s = spawn(s, CFG, { id: 'near', x: 12, y: 8 })    // 4.5 tiles from the shelf: in sight
    s = spawn(s, CFG, { id: 'far', x: 10, y: 20 })    // 16 tiles away: out of sight
    s = spawn(s, CFG, { id: 'shut', x: 4, y: 6 })     // behind a wall
    s = indoors(s, CFG, 'shut', HOUSE)
    // A hand expert enough to leave a mark on what it makes.
    s = fold(s, ev('skill_gained', { agentId: 'maker', track: 'carpentry', xp: 500 }), CFG)
    s = fold(s, ev('item_spawned', { id: 'item_1', kind: 'wood', qty: 4, loc: { t: 'agent', id: 'maker' } }), CFG)
    // By daylight: from C11 Task 26 the witness radius scales with the light on the tile
    // looked at, and 4.5 tiles at midnight is past it. Who sees a theft is the point here,
    // and the dark has its own row in perception.test.ts.
    return { ...s, tick: 720 }
  }

  it('what is made is owned and marked, what is given changes hands, what is taken is witnessed', () => {
    let s = town()

    // craft → the plank is the maker's, and carries the maker's mark.
    expect(submitIntent(s, CFG, 'maker', 'craft', { recipe: 'plank' }).ok).toBe(true)
    s = apply(s, CFG, VERBS.craft!.onComplete(s, CFG, 'maker', { recipe: 'plank' }, RNG))
    const plank = Object.values(s.items).find((i) => i.kind === 'plank')!
    expect(plank.owner).toBe('maker')
    expect(plank.crafterMark).toBe('maker')

    // give → the only voluntary transfer of title the world has.
    expect(submitIntent(s, CFG, 'maker', 'give', { itemId: plank.id, targetId: 'owner' }).ok).toBe(true)
    s = apply(s, CFG, VERBS.give!.onComplete(s, CFG, 'maker', { itemId: plank.id, targetId: 'owner' }, RNG))
    expect(s.items[plank.id]!.owner).toBe('owner')
    expect(s.items[plank.id]!.crafterMark).toBe('maker') // a mark is not a title; it never moves

    // stow → onto the shelf, still the owner's.
    const stowParams = { itemId: plank.id, structureId: STORE.id }
    expect(submitIntent(s, CFG, 'owner', 'stow', stowParams).ok).toBe(true)
    s = apply(s, CFG, VERBS.stow!.onComplete(s, CFG, 'owner', stowParams, RNG))
    expect(s.items[plank.id]!.loc).toEqual({ t: 'structure', id: STORE.id })
    expect(s.items[plank.id]!.owner).toBe('owner')

    // take → the engine blocks nothing; it only makes the taking public.
    const takeEvents = VERBS.take!.onComplete(s, CFG, 'taker', { itemId: plank.id }, RNG)
    const taken = takeEvents.find((e) => e.type === 'item_taken')
    expect(taken).toBeDefined()
    expect(taken!.payload).toEqual({
      itemId: plank.id, kind: 'plank', takerId: 'taker', ownerId: 'owner', x: STORE.x, y: STORE.y,
    })
    expect(takeEvents.some((e) => e.type === 'item_owner_changed')).toBe(false) // taking is not title
    s = apply(s, CFG, takeEvents)
    expect(s.items[plank.id]!.owner).toBe('owner')

    // Witnessed by whoever could see the spot — and by nobody else.
    const takenEv = ev('item_taken', taken!.payload)
    const seenBy = (id: string) => composePerception(s, CFG, id, [takenEv]).seen
    expect(seenBy('near')).toEqual([
      { kind: 'item_taken', takerName: 'taker', ownerName: 'owner', itemKind: 'plank' },
    ])
    expect(seenBy('far')).toEqual([])
    expect(seenBy('shut')).toEqual([])
    expect(seenBy('taker')).toEqual([]) // you do not witness yourself

    // Prose has both names to work with: "owner's plank".
    const shelf = composePerception(s, CFG, 'taker', []).self.inventory.find((i) => i.id === plank.id)!
    expect(shelf.ownerName).toBe('owner')
    expect(shelf.crafterMarkName).toBe('maker')
  })

  it('with the ownership law off, nothing is claimed and no taking is recorded', () => {
    let s = fold(town(), ev('config_changed', { path: 'ownership.enabled', value: false }), CFG)
    // A verb called by hand must be handed the same config the tick wrapper would derive.
    s = apply(s, CFG, VERBS.craft!.onComplete(s, live(s), 'maker', { recipe: 'plank' }, RNG))
    const plank = Object.values(s.items).find((i) => i.kind === 'plank')!
    expect(plank.owner).toBeUndefined()
    expect(plank.crafterMark).toBeUndefined()

    // An item owned before the flip stays owned, inertly, and takes silently.
    let owned = fold(town(), ev('item_spawned', {
      id: 'item_9', kind: 'bread', qty: 1, loc: { t: 'structure', id: STORE.id }, owner: 'owner',
    }), CFG)
    owned = fold(owned, ev('config_changed', { path: 'ownership.enabled', value: false }), CFG)
    const events = VERBS.take!.onComplete(owned, live(owned), 'taker', { itemId: 'item_9' }, RNG)
    expect(events.some((e) => e.type === 'item_taken')).toBe(false)
    expect(owned.items.item_9!.owner).toBe('owner')
    expect(composePerception(owned, CFG, 'near', []).visible.items.every((i) => i.ownerName === undefined)).toBe(true)
  })
})

describe('G9a-4: a wall stops sound', () => {
  function room(): WorldState {
    let s = raise(genesisState(CFG, MAP()), CFG, HOUSE)
    for (const a of [
      { id: 'speaker', x: 4, y: 6 }, { id: 'roommate', x: 4, y: 6 },
      { id: 'doorway', x: 4, y: 7 }, { id: 'outside', x: 7, y: 6 },
    ]) s = spawn(s, CFG, a)
    s = indoors(s, CFG, 'speaker', HOUSE)
    return indoors(s, CFG, 'roommate', HOUSE)
  }

  const said = (s: WorldState): SimEvent => {
    const events = VERBS.speak!.onComplete(s, CFG, 'speaker', { text: 'the rain is late this year' }, RNG)
    return ev('agent_spoke', events[0]!.payload)
  }

  it('inside speech is heard by a co-occupant and at the doorway, and nowhere else', () => {
    const s = room()
    const spoke = said(s)
    expect((spoke.payload as { insideId?: string }).insideId).toBe(HOUSE.id)

    const heardBy = (id: string) => composePerception(s, CFG, id, [spoke]).heard.map((h) => h.speakerId)
    expect(heardBy('roommate')).toEqual(['speaker'])
    expect(heardBy('doorway')).toEqual(['speaker'])
    expect(heardBy('outside')).toEqual([]) // three tiles out, well inside plain earshot of 8
  })

  it('with occlusion off the wall stops being a wall, and plain earshot returns', () => {
    const s = fold(room(), ev('config_changed', { path: 'occlusion.enabled', value: false }), CFG)
    expect(composePerception(s, CFG, 'outside', [said(s)]).heard).toHaveLength(1)
  })
})

describe('G9a-5: a shelf buys time', () => {
  function larder(): WorldState {
    let s = raise(genesisState(CFG, MAP()), CFG, STORE)
    s = spawn(s, CFG, { id: 'cook', x: 9, y: 5 })
    s = fold(s, ev('item_spawned', {
      id: 'item_1', kind: 'fish', qty: 1, loc: { t: 'tile', x: 9, y: 6 }, spoilage: { spawnDay: 0, days: 2 },
    }), CFG)
    return fold(s, ev('item_spawned', {
      id: 'item_2', kind: 'fish', qty: 1, loc: { t: 'agent', id: 'cook' }, owner: 'cook',
      spoilage: { spawnDay: 0, days: 2 },
    }), CFG)
  }

  it('a stowed fish outlives a dropped one by the storehouse multiplier', () => {
    let s = larder()
    const params = { itemId: 'item_2', structureId: STORE.id }
    expect(submitIntent(s, CFG, 'cook', 'stow', params).ok).toBe(true)
    s = apply(s, CFG, VERBS.stow!.onComplete(s, CFG, 'cook', params, RNG))
    expect(s.items.item_2!.owner).toBe('cook') // shelving is not giving

    expect(spoilDeadline(s, s.items.item_1!, CFG)).toBe(2)
    expect(spoilDeadline(s, s.items.item_2!, CFG)).toBe(2 * CFG.spoilage.storehouseMultiplier)

    const day2 = pass(s, CFG, 2)
    expect(typed(day2.events, 'item_spoiled').map((e) => (e.payload as { id: string }).id)).toEqual(['item_1'])
    expect(day2.state.items.item_2).toBeDefined()

    const day4 = pass(day2.state, CFG, 4)
    expect(typed(day4.events, 'item_spoiled').map((e) => (e.payload as { id: string }).id)).toEqual(['item_2'])
    expect(day4.state.items.item_2).toBeUndefined()
  })

  it('with the spoilage law off nothing turns, and the deadline waits', () => {
    const off = fold(larder(), ev('config_changed', { path: 'spoilage.enabled', value: false }), CFG)
    expect(typed(pass(off, CFG, 4).events, 'item_spoiled')).toEqual([])
    expect(pass(off, CFG, 4).state.items.item_1).toBeDefined()
  })
})

describe('G9a-6: a tool wears out and breaks', () => {
  // The rule that decides *when* a tool wears is arbiter-side (`wearTools`, covered by
  // packages/arbiter/src/codify.test.ts); an engine test cannot import it without making
  // a package cycle. This row asserts the world's half: the wear lands, and the point
  // that empties it takes the tool out of the hand.
  function withRod(durability: number): WorldState {
    const s = spawn(genesisState(CFG, MAP()), CFG, { id: 'a1', x: 2, y: 2 })
    return fold(s, ev('item_spawned', {
      id: 'item_1', kind: 'rod', qty: 1, loc: { t: 'agent', id: 'a1' }, durability,
    }), CFG)
  }

  it('two uses of a two-point rod leave nothing in the hand', () => {
    expect(CFG.tools.wearEnabled).toBe(true)
    const wear = { type: 'item_worn', payload: { id: 'item_1', delta: -CFG.tools.wearPerUse } }
    let s = apply(withRod(2), CFG, [wear])
    expect(s.items.item_1!.durability).toBe(1)
    s = apply(s, CFG, [wear, { type: 'item_broke', payload: { id: 'item_1' } }])
    expect(s.items.item_1).toBeUndefined()
  })

  it('a thing with no durability of its own never wears', () => {
    const s = fold(spawn(genesisState(CFG, MAP()), CFG, { id: 'a1', x: 2, y: 2 }), ev('item_spawned', {
      id: 'item_1', kind: 'bread', qty: 1, loc: { t: 'agent', id: 'a1' },
    }), CFG)
    expect(() => apply(s, CFG, [{ type: 'item_worn', payload: { id: 'item_1', delta: -1 } }]))
      .toThrow(/no durability/)
  })
})

describe('G9a-7: what is carved can be read back', () => {
  const TEXT = 'here the first roof went up, and it held'

  function wall(config = CFG): WorldState {
    let s = raise(genesisState(config, MAP()), config, HOUSE)
    s = spawn(s, config, { id: 'carver', x: 4, y: 6 })
    s = spawn(s, config, { id: 'passerby', x: 12, y: 6 })  // in sight, out of arm's reach
    // By daylight, for the same reason the ownership chain above is: what "in sight" means
    // now depends on the light on the wall (C11 Task 26).
    return { ...s, tick: 720 }
  }

  it('an inscription is written, and read at arm\'s length only', () => {
    let s = wall()
    const params = { structureId: HOUSE.id, text: TEXT }
    const started = submitIntent(s, CFG, 'carver', 'inscribe', params)
    expect(started.ok).toBe(true)
    s = apply(s, CFG, VERBS.inscribe!.onComplete(s, CFG, 'carver', params, RNG))
    expect(s.structures[HOUSE.id]!.inscription).toEqual({ text: TEXT, by: 'carver' })

    const close = composePerception(s, CFG, 'carver', []).visible.structures.find((x) => x.id === HOUSE.id)!
    expect(close.inscription).toEqual({ text: TEXT, by: 'carver' })
    const across = composePerception(s, CFG, 'passerby', []).visible.structures.find((x) => x.id === HOUSE.id)!
    expect(across.hasInscription).toBe(true)
    expect(across.inscription).toBeUndefined()
  })

  it('with the inscription law off the hands find no way to mark it', () => {
    const s = fold(wall(), ev('config_changed', { path: 'inscription.enabled', value: false }), CFG)
    const r = submitIntent(s, CFG, 'carver', 'inscribe', { structureId: HOUSE.id, text: TEXT })
    expect(r).toEqual({ ok: false, reason: 'your hands find no way to mark this' })
  })
})

describe('G9a-8: the world keeps one hand hidden', () => {
  const CERTAIN: SimConfig = SimConfigSchema.parse({ ...QUIET, mystery: { chancePerDay: 1 } })

  function watchers(config: SimConfig): WorldState {
    let s = raise(genesisState(config, MAP()), config, HOUSE)
    s = spawn(s, config, { id: 'awake', x: 6, y: 6 })
    s = spawn(s, config, { id: 'dozing', x: 7, y: 6 })
    s = spawn(s, config, { id: 'distant', x: 20, y: 20 })
    s = spawn(s, config, { id: 'indoors', x: 4, y: 6 })
    s = indoors(s, config, 'indoors', HOUSE)
    return asleep(s, config, 'dozing')
  }

  it('fires once at midday when the roll is certain, and never when it is not', () => {
    expect(typed(pass(watchers(CERTAIN), CERTAIN, 1, 12).events, 'mystery_event')).toHaveLength(1)
    expect(typed(pass(watchers(CFG), CFG, 1, 12).events, 'mystery_event')).toEqual([])
    // Midday, not midnight: at midnight there is nobody awake to feel it.
    expect(typed(pass(watchers(CERTAIN), CERTAIN, 1, 0).events, 'mystery_event')).toEqual([])
  })

  it('a global one is felt by every open pair of eyes; a located one obeys the horizon', () => {
    const s = watchers(CFG)
    const global = ev('mystery_event', { kind: 'far_bell' })
    expect(composePerception(s, CFG, 'awake', [global]).feltEvents).toEqual(['far_bell'])
    expect(composePerception(s, CFG, 'indoors', [global]).feltEvents).toEqual(['far_bell'])
    expect(composePerception(s, CFG, 'dozing', [global]).feltEvents).toEqual([]) // a sleeper misses it

    const here = ev('mystery_event', { kind: 'stone_hums', x: 6, y: 7 })
    expect(composePerception(s, CFG, 'awake', [here]).seen).toEqual([
      { kind: 'mystery', mystery: 'stone_hums', prose: expect.stringContaining('hums') },
    ])
    expect(composePerception(s, CFG, 'distant', [here]).seen).toEqual([])
    expect(composePerception(s, CFG, 'indoors', [here]).seen).toEqual([])
  })

  it('with the mystery law off the roll is not drawn at all', () => {
    const off = fold(watchers(CERTAIN), ev('config_changed', { path: 'mystery.enabled', value: false }), CERTAIN)
    expect(typed(pass(off, CERTAIN, 1, 12).events, 'mystery_event')).toEqual([])
  })
})

describe('G9a-9: death of old age, under a forced roll', () => {
  const CERTAIN_DEATH: SimConfig = SimConfigSchema.parse({
    ...QUIET, aging: { naturalDeathBaseChancePerDay: 1 },
  })

  function elder(config: SimConfig): WorldState {
    const s = spawn(genesisState(config, MAP()), config, { id: 'elder', x: 3, y: 3, ageDays: 70 * DAYS_PER_YEAR })
    return fold(s, ev('item_spawned', {
      id: 'item_1', kind: 'bread', qty: 1, loc: { t: 'agent', id: 'elder' },
    }), config)
  }

  it('an elder dies at midnight and what she carried falls where she stood', () => {
    const midnight = pass(elder(CERTAIN_DEATH), CERTAIN_DEATH, 1)
    expect(ageBand(CERTAIN_DEATH, 70 * DAYS_PER_YEAR)).toBe('elder')
    const died = typed(midnight.events, 'agent_died')
    expect(died.map((e) => e.payload)).toEqual([{ agentId: 'elder', cause: 'old_age' }])
    expect(midnight.state.agents.elder!.alive).toBe(false)
    expect(midnight.state.items.item_1!.loc).toEqual({ t: 'tile', x: 3, y: 3 })
  })

  it('with the old-age law off the body still ages and the roll is skipped', () => {
    const off = fold(elder(CERTAIN_DEATH), ev('config_changed', {
      path: 'aging.deathOfOldAgeEnabled', value: false,
    }), CERTAIN_DEATH)
    const midnight = pass(off, CERTAIN_DEATH, 1)
    expect(typed(midnight.events, 'agent_aged')).toHaveLength(1)
    expect(typed(midnight.events, 'agent_died')).toEqual([])
    expect(midnight.state.agents.elder!.alive).toBe(true)
  })
})

describe('G9a-10: a law changes the world at a tick boundary, and the log remembers', () => {
  const FLIP_TICK = 1000
  const END_TICK = 2200

  type Run = {
    loop: TickLoop; store: EventStore
    events: Array<{ tick: number; type: string; payload: unknown }>
    preFlip: { state: WorldState; seq: number }
  }

  // One world, one operator, two flips posted between ticks — exactly how the admin
  // channel reaches the engine: `applyLaw` enqueues, the tick wrapper drains.
  function runWithOperator(): Run {
    const store = new EventStore(openDb(':memory:'))
    const queue: LawQueue = []
    const rng = new RngStreams('g9a-laws')
    const worldTick = createWorldTick(CFG, rng, queue)
    const events: Array<{ tick: number; type: string; payload: unknown }> = []
    const loop: TickLoop = new TickLoop({
      store, state: genesisState(CFG, MAP()), rng, config: CFG, snapshotEveryTicks: 500,
      onTick: ({ tick, emit }) => {
        const record = (type: string, payload: unknown) => { events.push({ tick, type, payload }); emit(type, payload) }
        if (tick === 1) {
          record('structure_planned', { ...HOUSE, maxHp: 50, flammable: true, builderId: 'script' })
          record('structure_completed', { id: HOUSE.id })
          record('agent_spawned', { id: 'ada', name: 'ada', x: 4, y: 6, ageDays: 7300 })
          record('agent_entered', { agentId: 'ada', structureId: HOUSE.id })
          record('agent_slept', { agentId: 'ada' })
          record('item_spawned', {
            id: 'item_1', kind: 'fish', qty: 1, loc: { t: 'tile', x: 6, y: 6 },
            spoilage: { spawnDay: 0, days: 1 },
          })
        }
        for (const e of worldTick(loop.state).events) record(e.type, e.payload)
      },
    })

    let preFlip: Run['preFlip'] | null = null
    for (let tick = 1; tick <= END_TICK; tick++) {
      loop.step()
      if (tick === FLIP_TICK) {
        preFlip = { state: structuredClone(loop.state), seq: store.lastSeq() }
        applyLaw(queue, 'spoilage.enabled', false)
        applyLaw(queue, 'mystery.chancePerDay', 1)
      }
    }
    return { loop, store, events, preFlip: preFlip! }
  }

  it('two flips land on the next tick and the world obeys them from that tick on', () => {
    const { loop, events } = runWithOperator()

    const flips = events.filter((e) => e.type === 'config_changed')
    expect(flips.map((e) => ({ tick: e.tick, ...(e.payload as object) }))).toEqual([
      { tick: FLIP_TICK + 1, path: 'spoilage.enabled', value: false },
      { tick: FLIP_TICK + 1, path: 'mystery.chancePerDay', value: 1 },
    ])
    // Legislation before physics: nothing of that tick ran before the flips.
    expect(events.filter((e) => e.tick === FLIP_TICK + 1)[0]!.type).toBe('config_changed')
    expect(loop.state.laws).toEqual({ 'spoilage.enabled': false, 'mystery.chancePerDay': 1 })

    // Behaviour, not bookkeeping: day 0's midday was silent under chance 0; day 1's is not.
    const mysteries = events.filter((e) => e.type === 'mystery_event')
    expect(mysteries.every((e) => e.tick > FLIP_TICK)).toBe(true)
    expect(mysteries).toHaveLength(1)
    expect(mysteries[0]!.tick).toBe(MINUTES_PER_DAY + 12 * 60)

    // The fish was overdue at the first midnight after the flip and did not turn.
    expect(events.some((e) => e.type === 'item_spoiled')).toBe(false)
    expect(loop.state.items.item_1).toBeDefined()
  })

  it('replays to the same hash from genesis, from the latest snapshot, and from a pre-flip one', () => {
    const { loop, store, preFlip } = runWithOperator()
    const live = stateHash(loop.state)

    expect(stateHash(replayFromGenesis(store, CFG, MAP()))).toBe(live)
    expect(stateHash(replayLatest(store, CFG, MAP()).state)).toBe(live)

    // A snapshot taken before any law existed, carried forward over the flips.
    expect(preFlip.state.laws).toBeUndefined()
    const forward = store.readFrom(preFlip.seq).reduce((s, e) => fold(s, e, CFG), preFlip.state)
    expect(stateHash(forward)).toBe(live)
    expect(forward.laws).toEqual(loop.state.laws)
  })

  it('refuses a path that is not a world law, and a value of the wrong shape', () => {
    const s = genesisState(CFG, MAP())
    expect(() => fold(s, ev('config_changed', { path: 'movement.sightRadius', value: 40 }), CFG))
      .toThrow(/not a world law/)
    expect(() => fold(s, ev('config_changed', { path: 'needs.eatRestoreHunger', value: 999 }), CFG))
      .toThrow(/not a world law/)
    expect(() => fold(s, ev('config_changed', { path: 'spoilage.enabled', value: 'off' }), CFG))
      .toThrow(/rejected/)
  })

  it('every C9 feature has a switch an operator can reach', () => {
    for (const path of [
      'reproduction.enabled', 'aging.deathOfOldAgeEnabled', 'spoilage.enabled', 'tools.wearEnabled',
      'mystery.enabled', 'occlusion.enabled', 'ownership.enabled', 'inscription.enabled',
    ]) expect(TOGGLABLE_PATHS[path]).toBeDefined()
  })
})

describe('G9a-11: the goldens are where the single deliberate regen left them', () => {
  // This row fails the moment a golden hash moves again, which is the signal that G9 must be
  // re-run before anything ships. It names the values as they stand after the latest
  // authorized regen, so moving a pin means coming here and saying why.
  //   G2 regen #4 (C9 Task 16):  6f2529fb…
  //   G2 regen #5 (C11 Task 37): 665a8249…
  //   G2 regen #6 (C11 Task 37b, the gate-remediation regen, ruling R-G): c1c51b42…
  //   G2 regen #7 (the `hut` → `house` rename lane): the value below.
  // G1 HAS NEVER MOVED and must not: it is the replay proof, and it is not a world run —
  // `TickLoop` folds the events it is handed and runs no world system, so no dial reaches it.
  // The rename lane measured it and it held, which is the check that says the rename touched
  // no law.
  const source = (name: string): string =>
    readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')

  it('G1 and G2 still pin the post-regen hashes', () => {
    expect(source('golden.test.ts')).toContain('f487a26bd9dfba5d6d0d04f41b57f8e85dc9afe7f9ae1caf608de8c182effeac')
    expect(source('g2.test.ts')).toContain('ec75f7f7e0948cb4cd6985d8d660ec93081ecc51ca4a0e733f25b9527c6b1bde')
  })
})

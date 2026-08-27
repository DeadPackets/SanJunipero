// @slow — GATE G11a, the living half: the herd, the cold, the flame, the table and the wood.
// Scripted actors only, no LLM, $0. Every row is an addendum §18 criterion.
import { describe, it, expect } from 'vitest'
import {
  DAYS_PER_SEASON,
  MINUTES_PER_DAY,
  SimConfigSchema,
  dayPhaseFromTick,
  glowRadiusFor,
  lightBandAt,
  litSourceWithin,
  type SimConfig,
} from '@sj/shared'
import { FAUNA_YIELD } from './data/faunaDefs.js'
import { fold } from './fold.js'
import { submitIntent } from './intent.js'
import { RngStreams } from './rng.js'
import { genesisState, type TileId, type WorldState } from './state.js'
import { ambientTempAt, isExposed } from './systems/warmth.js'
import {
  fishCatchChance,
  huntChance,
  mealRestore,
  nutritionOf,
  workPenalty,
  type PendingEvent,
} from './verbs.js'
import { createWorldTick } from './worldTick.js'
import { ev, grid } from './testutil/world.js'

const QUIET = {
  weather: { hourlyChangeChance: 0 },
  mystery: { chancePerDay: 0 },
  aging: { deathOfOldAgeEnabled: false },
}
const CFG: SimConfig = SimConfigSchema.parse(QUIET)

const MAP = (n = 24): TileId[][] => grid(n)

const spawn = (s: WorldState, config: SimConfig, id: string, x: number, y: number): WorldState =>
  fold(s, ev('agent_spawned', { id, name: id, x, y, ageDays: 7300 }), config)

const give = (
  s: WorldState,
  config: SimConfig,
  id: string,
  itemId: string,
  kind: string,
  qty = 1,
  extra: Record<string, unknown> = {},
): WorldState =>
  fold(s, ev('item_spawned', { id: itemId, kind, qty, loc: { t: 'agent', id }, ...extra }), config)

type Box = { id: string; kind: string; x: number; y: number; w: number; h: number }

const raise = (s: WorldState, config: SimConfig, box: Box, flammable = true): WorldState => {
  const planned = fold(
    s,
    ev('structure_planned', { ...box, maxHp: 50, flammable, builderId: 'script' }),
    config,
  )
  return fold(planned, ev('structure_completed', { id: box.id }), config)
}

function pass(
  s: WorldState,
  config: SimConfig,
  tick: number,
  seed = 'g11a-world',
): {
  state: WorldState
  events: PendingEvent[]
} {
  const advanced = fold({ ...s, tick: tick - 1 }, ev('tick_advanced', {}, tick), config)
  return createWorldTick(config, new RngStreams(seed))(advanced)
}

const apply = (
  s: WorldState,
  config: SimConfig,
  events: PendingEvent[],
  tick: number,
): WorldState => events.reduce((acc, e) => fold(acc, ev(e.type, e.payload, tick), config), s)

function doVerb(
  s: WorldState,
  config: SimConfig,
  tick: number,
  agentId: string,
  verb: string,
  params: Record<string, unknown> = {},
  limit = 600,
  seed = 'g11a-world',
): { state: WorldState; events: PendingEvent[]; refusal: string | null; duration: number } {
  const at: WorldState = { ...s, tick }
  const started = submitIntent(at, config, agentId, verb, params)
  if (!started.ok) return { state: s, events: [], refusal: started.reason, duration: 0 }
  const duration = (started.events[0]!.payload as { duration: number }).duration
  let state = apply(at, config, started.events, tick)
  const events: PendingEvent[] = [...started.events]
  for (let t = tick + 1; t <= tick + limit; t++) {
    const out = pass(state, config, t, seed)
    state = out.state
    events.push(...out.events)
    if (state.agents[agentId]!.activity === null) break
  }
  return { state, events, refusal: null, duration }
}

// ------------------------------------------------------------------ the herd

describe('G11a-F1: bodies with no minds — they run, they are hunted, and the caps are the ecology', () => {
  const DEER = 'fauna_1'

  function meadow(config: SimConfig = CFG): WorldState {
    let s = genesisState(config, MAP())
    s = fold(s, ev('fauna_spawned', { id: DEER, kind: 'deer', x: 12, y: 12 }), config)
    s = spawn(s, config, 'hunter', 11, 12)
    s = give(s, config, 'hunter', 'item_knife', 'knife')
    return { ...s, tick: 400 }
  }

  it('a deer inside the flee radius runs, and one outside it wanders on its own', () => {
    // The hunter is one tile away: well inside fleeRadius, so the move is a flight and
    // its direction is away from the body, not a roll.
    const near = pass(meadow(), CFG, 404)
    const flight = near.events.find((e) => e.type === 'fauna_moved')
    expect(flight).toBeDefined()
    expect(near.state.fauna![DEER]!.x).toBeGreaterThan(12) // away from the hunter at x 11

    // Take the hunter out of range and the deer's step is a wander: it still moves, and it
    // is not systematically away from anybody.
    const alone = fold(meadow(), ev('agent_moved', { id: 'hunter', x: 0, y: 0 }, 400), CFG)
    const out = pass(alone, CFG, 404)
    expect(out.events.some((e) => e.type === 'fauna_moved')).toBe(true)
  })

  it('the hunt turns on a forced roll, and a kill leaves venison and a hide', () => {
    const chance = huntChance(meadow(), CFG, 'hunter', 'deer')
    expect(chance).toBeCloseTo(1 / (1 + CFG.fauna.huntDifficulty.deer), 12)

    const seedFor = (want: boolean): string => {
      for (let i = 0; i < 500; i++) {
        const seed = `hunt-${i}`
        if (new RngStreams(seed).get('fauna').next() < chance === want) return seed
      }
      throw new Error('no seed')
    }

    const kill = doVerb(meadow(), CFG, 401, 'hunter', 'hunt', { faunaId: DEER }, 10, seedFor(true))
    expect(kill.refusal).toBeNull()
    expect(kill.events.some((e) => e.type === 'fauna_killed')).toBe(true)
    expect(kill.state.fauna?.[DEER]).toBeUndefined() // a taken body leaves the world outright
    const taken = kill.events
      .filter((e) => e.type === 'item_spawned')
      .map((e) => e.payload as { kind: string; qty: number })
      .map((p) => ({ kind: p.kind, qty: p.qty }))
    expect(taken).toEqual(FAUNA_YIELD.deer.map((y) => ({ kind: y.kind, qty: y.qty })))

    const miss = doVerb(meadow(), CFG, 401, 'hunter', 'hunt', { faunaId: DEER }, 10, seedFor(false))
    expect(miss.events.some((e) => e.type === 'fauna_killed')).toBe(false)
    expect(miss.state.fauna![DEER]!.alive).toBe(true)
    // A missed approach is not a nothing: the animal bolts.
    expect(miss.events.some((e) => e.type === 'fauna_moved')).toBe(true)
  })

  it('bare hands cannot hunt, and a school is not something you run down', () => {
    const unarmed = fold(
      meadow(),
      ev('item_qty_changed', { id: 'item_knife', delta: -1 }, 400),
      CFG,
    )
    expect(doVerb(unarmed, CFG, 401, 'hunter', 'hunt', { faunaId: DEER }).refusal).toBe(
      'you have nothing to hunt with',
    )
    let school = genesisState(CFG, MAP())
    school = fold(
      school,
      ev('fauna_spawned', { id: 'fauna_9', kind: 'fish', x: 12, y: 12, stock: 3 }),
      CFG,
    )
    school = spawn(school, CFG, 'hunter', 11, 12)
    school = give(school, CFG, 'hunter', 'item_knife', 'knife')
    expect(
      doVerb({ ...school, tick: 400 }, CFG, 401, 'hunter', 'hunt', { faunaId: 'fauna_9' }).refusal,
    ).toBe('that is not something you can run down')
  })

  it('a school measurably raises the odds of a cast, by exactly the bonus', () => {
    const terrain = MAP()
    for (let y = 0; y < 24; y++) terrain[y]![14] = 2
    let bare = spawn(genesisState(CFG, terrain), CFG, 'anna', 13, 12)
    bare = { ...bare, tick: 400 }
    const plain = fishCatchChance(bare, CFG, 'anna', 14, 12)
    const withSchool = fold(
      bare,
      ev('fauna_spawned', { id: 'fauna_9', kind: 'fish', x: 14, y: 12, stock: 3 }),
      CFG,
    )
    expect(fishCatchChance(withSchool, CFG, 'anna', 14, 12)).toBeCloseTo(
      plain * CFG.fauna.fishSchoolBonus,
      12,
    )

    // Out of the school's reach it is a plain cast again.
    const far = fold(
      bare,
      ev('fauna_spawned', { id: 'fauna_9', kind: 'fish', x: 14, y: 20, stock: 3 }),
      CFG,
    )
    expect(fishCatchChance(far, CFG, 'anna', 14, 12)).toBeCloseTo(plain, 12)
  })

  it('dawn puts back what was taken, never past the cap, and winter gives half the chances', () => {
    const DAWN = 6 * 60
    const summerDawn = DAYS_PER_SEASON * MINUTES_PER_DAY + DAWN
    const winterDawn = 3 * DAYS_PER_SEASON * MINUTES_PER_DAY + DAWN

    const empty = (tick: number) => ({ ...genesisState(CFG, MAP()), tick: tick - 1 })
    const born = (tick: number): Record<string, number> => {
      const out = pass(empty(tick), CFG, tick, 'stocking')
      const counts: Record<string, number> = {}
      for (const e of out.events.filter((x) => x.type === 'fauna_spawned')) {
        const kind = (e.payload as { kind: string }).kind
        counts[kind] = (counts[kind] ?? 0) + 1
      }
      return counts
    }

    const summer = born(summerDawn)
    const winter = born(winterDawn)
    // Grass takes deer and rabbits; a fish needs water this map has none of.
    expect(summer.fish).toBeUndefined()
    expect(winter.fish).toBeUndefined()
    expect(summer.deer!).toBeLessThanOrEqual(CFG.fauna.caps.deer)
    expect(summer.rabbit!).toBeLessThanOrEqual(CFG.fauna.caps.rabbit)
    // Half as many rolls at the same odds: fewer bodies, on the same seed and the same ground.
    expect((winter.deer ?? 0) + (winter.rabbit ?? 0)).toBeLessThan(
      (summer.deer ?? 0) + (summer.rabbit ?? 0),
    )

    // With the caps already met, the dawn puts back nothing at all.
    let full = genesisState(CFG, MAP())
    for (let i = 0; i < CFG.fauna.caps.deer; i++) {
      full = fold(
        full,
        ev('fauna_spawned', { id: `fauna_${i + 1}`, kind: 'deer', x: 2 + i, y: 2 }),
        CFG,
      )
    }
    for (let i = 0; i < CFG.fauna.caps.rabbit; i++) {
      full = fold(
        full,
        ev('fauna_spawned', {
          id: `fauna_${CFG.fauna.caps.deer + i + 1}`,
          kind: 'rabbit',
          x: 2 + i,
          y: 4,
        }),
        CFG,
      )
    }
    const none = pass({ ...full, tick: summerDawn - 1 }, CFG, summerDawn, 'stocking')
    expect(none.events.filter((e) => e.type === 'fauna_spawned')).toEqual([])
  })

  it('with the law off there are no bodies and no school bonus', () => {
    const OFF: SimConfig = SimConfigSchema.parse({ ...QUIET, fauna: { enabled: false } })
    const out = pass({ ...genesisState(OFF, MAP()), tick: 6 * 60 - 1 }, OFF, 6 * 60)
    expect(out.events.filter((e) => e.type === 'fauna_spawned')).toEqual([])
    const terrain = MAP()
    for (let y = 0; y < 24; y++) terrain[y]![14] = 2
    let s = spawn(genesisState(OFF, terrain), OFF, 'anna', 13, 12)
    s = fold(s, ev('fauna_spawned', { id: 'fauna_9', kind: 'fish', x: 14, y: 12, stock: 3 }), OFF)
    expect(fishCatchChance({ ...s, tick: 400 }, OFF, 'anna', 14, 12)).toBeCloseTo(
      OFF.wildlife.fishCatchBase,
      12,
    )
  })
})

// ------------------------------------------------------- the cold, and what stands against it

// The survivability ladder, proved as arithmetic and then as a night actually lived. A rung
// "closes" when the body comes through the night with at least a quarter of its energy left.
describe('G11a-C1: the survivability arithmetic audit — each winter rung, with the margin', () => {
  const WINTER_DAY = 3 * DAYS_PER_SEASON * MINUTES_PER_DAY + 12 * 60 // −4
  const WINTER_DUSK = 3 * DAYS_PER_SEASON * MINUTES_PER_DAY + 19 * 60 // −8
  const WINTER_NIGHT = 3 * DAYS_PER_SEASON * MINUTES_PER_DAY + 22 * 60 // −12
  // A `fire_pit`, not a `hearth`: the old heat-source roster named a structure kind this world
  // has never stood one of, and the recipe table now says so. Same 1x1 fire, real name.
  const HEARTH: Box = { id: 'structure_1', kind: 'fire_pit', x: 8, y: 8, w: 1, h: 1 }
  const HOUSE: Box = { id: 'structure_2', kind: 'house', x: 14, y: 14, w: 2, h: 2 }
  const NIGHT_TICKS = 8 * 60 // 21:00 to 05:00, the whole of a winter night

  it('the three winter bands are the ones the controller ratified', () => {
    const at = (tick: number): number => ambientTempAt({ ...genesisState(CFG, MAP()), tick }, CFG)
    expect([at(WINTER_DAY), at(WINTER_DUSK), at(WINTER_NIGHT)]).toEqual([-4, -8, -12])
    expect(CFG.warmth.comfortBand).toBe(8)
    expect(CFG.warmth.insulation.garment).toBe(12)
  })

  // One body, one winter night, one set of protections. Returns what the night cost it.
  function overnight(opts: {
    garment?: boolean
    indoors?: boolean
    hearth?: boolean
    energy: number
  }): {
    energyLeft: number
    coldTicks: number
    collapsed: boolean
    alive: boolean
  } {
    const start = WINTER_NIGHT
    let s = raise(genesisState(CFG, MAP()), CFG, HEARTH, false)
    s = raise(s, CFG, HOUSE)
    s = spawn(s, CFG, 'body', opts.hearth === true ? 9 : 4, opts.hearth === true ? 8 : 4)
    if (opts.garment === true) {
      s = give(s, CFG, 'body', 'item_coat', 'garment')
      s = fold(
        s,
        ev('item_equipped', { agentId: 'body', itemId: 'item_coat', slot: 'body' }, start - 1),
        CFG,
      )
    }
    if (opts.indoors === true) {
      s = fold(s, ev('agent_moved', { id: 'body', x: 14, y: 16 }, start - 1), CFG)
      s = fold(s, ev('agent_entered', { agentId: 'body', structureId: HOUSE.id }, start - 1), CFG)
    }
    if (opts.hearth === true) {
      s = fold(
        s,
        ev(
          'structure_fueled',
          {
            structureId: HEARTH.id,
            burnsUntilTick: start + NIGHT_TICKS + 1,
          },
          start - 1,
        ),
        CFG,
      )
    }
    s = fold(
      s,
      ev('need_changed', { id: 'body', need: 'energy', delta: opts.energy - 100 }, start - 1),
      CFG,
    )
    s = { ...s, tick: start - 1 }
    for (let t = start; t < start + NIGHT_TICKS; t++) s = pass(s, CFG, t).state
    const a = s.agents.body!
    return {
      energyLeft: a.needs.energy,
      coldTicks: a.coldTicksSinceRecovery ?? 0,
      collapsed: a.collapsedSinceTick !== null,
      alive: a.alive,
    }
  }

  it('RUNG 1 — a garment at −4: the night is come through with margin to spare', () => {
    const out = overnight({ garment: true, energy: 100 })
    expect(out.alive).toBe(true)
    expect(out.collapsed).toBe(false)
    expect(out.energyLeft / 100).toBeGreaterThanOrEqual(0.25)
  })

  it('RUNG 2 — a garment and four walls at −8: no cold reaches the body at all', () => {
    const out = overnight({ garment: true, indoors: true, energy: 100 })
    expect(out.coldTicks).toBe(0)
    expect(out.collapsed).toBe(false)
    expect(out.energyLeft / 100).toBeGreaterThanOrEqual(0.25)
  })

  it('RUNG 3 — a garment, four walls and a fed fire at −12: the same, with the fire to spare', () => {
    const inside = overnight({ garment: true, indoors: true, hearth: true, energy: 100 })
    expect(inside.coldTicks).toBe(0)
    expect(inside.energyLeft / 100).toBeGreaterThanOrEqual(0.25)
    // And out in it, beside a fire somebody is feeding: the fire alone is enough.
    const beside = overnight({ garment: true, hearth: true, energy: 100 })
    expect(beside.coldTicks).toBe(0)
    expect(beside.energyLeft / 100).toBeGreaterThanOrEqual(0.25)
  })

  // isExposed is a threshold, and at insulation 2 the garment was worth two degrees of it: at
  // winter's −4/−8/−12 a coat changed nothing at all. Rung 1 is now the coat's own rung.
  it('the garment is a threshold flip, and it flips the mildest winter hour and no other', () => {
    const at = (tick: number, garment: boolean): boolean => {
      let s = spawn(genesisState(CFG, MAP()), CFG, 'body', 4, 4)
      if (garment) {
        s = give(s, CFG, 'body', 'item_coat', 'garment')
        s = fold(
          s,
          ev('item_equipped', { agentId: 'body', itemId: 'item_coat', slot: 'body' }, 0),
          CFG,
        )
      }
      return isExposed({ ...s, tick }, CFG, 'body')
    }
    expect({ bare: at(WINTER_DAY, false), clothed: at(WINTER_DAY, true) }).toEqual({
      bare: true,
      clothed: false,
    })
    for (const tick of [WINTER_DUSK, WINTER_NIGHT]) {
      expect({ tick, bare: at(tick, false), clothed: at(tick, true) }).toEqual({
        tick,
        bare: true,
        clothed: true,
      })
    }
    // Where it does decide: an autumn dusk sits two degrees under the band, which is exactly
    // what a coat is worth.
    const AUTUMN_DUSK = 2 * DAYS_PER_SEASON * MINUTES_PER_DAY + 19 * 60
    expect(ambientTempAt({ ...genesisState(CFG, MAP()), tick: AUTUMN_DUSK }, CFG)).toBe(6)
    expect({ bare: at(AUTUMN_DUSK, false), clothed: at(AUTUMN_DUSK, true) }).toEqual({
      bare: true,
      clothed: false,
    })
  })

  it('the coat is what decides an autumn dusk: bare goes down, clothed walks home', () => {
    const AUTUMN_DUSK = 2 * DAYS_PER_SEASON * MINUTES_PER_DAY + 19 * 60
    const DUSK_TICKS = 2 * 60

    function dusk(garment: boolean): { collapsed: boolean; energyLeft: number } {
      let s = spawn(genesisState(CFG, MAP()), CFG, 'body', 4, 4)
      if (garment) {
        s = give(s, CFG, 'body', 'item_coat', 'garment')
        s = fold(
          s,
          ev('item_equipped', { agentId: 'body', itemId: 'item_coat', slot: 'body' }, 0),
          CFG,
        )
      }
      // A body at the end of a working day: little energy, and no warmth left to spend.
      s = fold(
        s,
        ev('need_changed', { id: 'body', need: 'energy', delta: -80 }, AUTUMN_DUSK - 1),
        CFG,
      )
      s = fold(
        s,
        ev('need_changed', { id: 'body', need: 'warmth', delta: -100 }, AUTUMN_DUSK - 1),
        CFG,
      )
      s = { ...s, tick: AUTUMN_DUSK - 1 }
      for (let t = AUTUMN_DUSK; t < AUTUMN_DUSK + DUSK_TICKS; t++) s = pass(s, CFG, t).state
      const a = s.agents.body!
      return { collapsed: a.collapsedSinceTick !== null, energyLeft: a.needs.energy }
    }

    const bare = dusk(false)
    const clothed = dusk(true)
    expect(bare.collapsed).toBe(true)
    expect(clothed.collapsed).toBe(false)
    expect(clothed.energyLeft).toBeGreaterThan(bare.energyLeft)
  })

  it('with the cold switched off nobody is ever exposed, whatever the season says', () => {
    const OFF: SimConfig = SimConfigSchema.parse({ ...QUIET, warmth: { enabled: false } })
    const s = spawn(genesisState(OFF, MAP()), OFF, 'body', 4, 4)
    expect(isExposed({ ...s, tick: WINTER_NIGHT }, OFF, 'body')).toBe(false)
  })
})

// ------------------------------------------------------------------ light

describe('G11a-C2: the dark charges for work, a flame answers it, and the flame is a hazard', () => {
  const NIGHT = 22 * 60
  const SHED: Box = { id: 'structure_1', kind: 'shed', x: 6, y: 5, w: 2, h: 2 }

  function nightWork(lit: boolean): WorldState {
    let s = spawn(genesisState(CFG, MAP()), CFG, 'wright', 4, 4)
    s = give(s, CFG, 'wright', 'item_stone', 'stone', 4)
    s = give(s, CFG, 'wright', 'item_torch', 'torch')
    if (lit)
      s = fold(
        s,
        ev('item_lit', { itemId: 'item_torch', burnsUntilTick: NIGHT + 500 }, NIGHT - 1),
        CFG,
      )
    return { ...s, tick: NIGHT - 1 }
  }

  it('the night phase is the one the single derivation names', () => {
    expect(dayPhaseFromTick(NIGHT)).toBe('night')
    expect(dayPhaseFromTick(12 * 60)).toBe('day')
    expect(dayPhaseFromTick(19 * 60)).toBe('dusk')
  })

  it('a paving in the dark takes half again as long, and a lit torch buys it back', () => {
    const blind = doVerb(nightWork(false), CFG, NIGHT, 'wright', 'pave', { x: 5, y: 4 }, 40)
    const carried = doVerb(nightWork(true), CFG, NIGHT, 'wright', 'pave', { x: 5, y: 4 }, 40)
    expect(blind.refusal).toBeNull()
    expect(carried.refusal).toBeNull()
    expect(blind.duration).toBe(Math.ceil(CFG.roads.paveDurationTicks * CFG.light.nightWorkPenalty))
    expect(carried.duration).toBe(CFG.roads.paveDurationTicks)
    expect(workPenalty({ ...nightWork(false), tick: NIGHT }, CFG, 'wright', 'pave')).toBe(
      CFG.light.nightWorkPenalty,
    )
    expect(workPenalty({ ...nightWork(true), tick: NIGHT }, CFG, 'wright', 'pave')).toBe(1)
    // Speech and walking cost the same at midnight as at noon: the night is a price change,
    // not a curfew.
    expect(workPenalty({ ...nightWork(false), tick: NIGHT }, CFG, 'wright', 'speak')).toBe(1)
  })

  it('a torch burns for exactly its fuel and then it is ash', () => {
    const s = nightWork(false)
    const struck = doVerb(s, CFG, NIGHT, 'wright', 'kindle', { itemId: 'item_torch' }, 4)
    expect(struck.refusal).toBeNull()
    const lit = struck.events.find((e) => e.type === 'item_lit')!.payload as {
      burnsUntilTick: number
    }
    const litAt = NIGHT + 1
    expect(lit.burnsUntilTick).toBe(litAt + CFG.light.torchBurnTicks)
    expect(glowRadiusFor(CFG, 'torch')).toBe(CFG.light.glowRadius.torch)

    let state = struck.state
    let outAt: number | null = null
    for (let t = litAt + 1; t <= litAt + CFG.light.torchBurnTicks + 3; t++) {
      const out = pass(state, CFG, t)
      state = out.state
      if (outAt === null && out.events.some((e) => e.type === 'item_burned_out')) outAt = t
    }
    expect(outAt).toBe(lit.burnsUntilTick + 1)
    expect(state.items.item_torch).toBeUndefined() // burnt out is burnt up: the stick is gone
    expect(litSourceWithin(state, 4, 4, state.tick, CFG, CFG.light.workRadius)).toBe(false)
  })

  it('a carried flame beside a wall is a fire waiting to happen', () => {
    const SURE: SimConfig = SimConfigSchema.parse({ ...QUIET, light: { fireRiskPerTick: 1 } })
    let s = raise(genesisState(SURE, MAP()), SURE, SHED)
    s = spawn(s, SURE, 'wright', 5, 5)
    s = give(s, SURE, 'wright', 'item_torch', 'torch')
    s = fold(
      s,
      ev('item_lit', { itemId: 'item_torch', burnsUntilTick: NIGHT + 500 }, NIGHT - 1),
      SURE,
    )
    const out = pass({ ...s, tick: NIGHT - 1 }, SURE, NIGHT)
    const lit = out.events.find((e) => e.type === 'fire_ignited')
    expect(lit).toBeDefined()
    expect(lit!.payload).toMatchObject({ structureId: SHED.id, cause: 'a carried flame' })

    // The same night with the risk at the world's own dial and no flame lit: nothing burns.
    const dark = fold(s, ev('item_snuffed', { itemId: 'item_torch' }, NIGHT - 1), CFG)
    const quiet = pass({ ...dark, tick: NIGHT - 1 }, CFG, NIGHT)
    expect(quiet.events.filter((e) => e.type === 'fire_ignited')).toEqual([])
  })

  it('the ground reads bright, dim or dark and never a number', () => {
    const s = genesisState(CFG, MAP())
    expect(lightBandAt(s, 4, 4, 12 * 60, CFG)).toBe('bright')
    expect(lightBandAt(s, 4, 4, 19 * 60, CFG)).toBe('dim')
    expect(lightBandAt(s, 4, 4, NIGHT, CFG)).toBe('dark')
  })
})

// ------------------------------------------------------------------ the table and the wood

describe('G11a-V1: three kinds at the table beat the same thing twice', () => {
  function fed(kinds: string[]): WorldState {
    let s = spawn(genesisState(CFG, MAP()), CFG, 'diner', 4, 4)
    const day = 0
    const recentFoods = kinds.map((kind) => ({ kind, day }))
    s = { ...s, agents: { ...s.agents, diner: { ...s.agents.diner!, recentFoods } }, tick: 400 }
    return s
  }

  it('the bonus is exactly bonusPerKind for each distinct kind past the first, and it caps', () => {
    const plain = mealRestore(fed(['bread']), CFG, 'diner', 'bread')
    expect(plain).toBeCloseTo(CFG.needs.eatRestoreHunger * nutritionOf(CFG, 'bread'), 12)

    const varied = mealRestore(fed(['bread', 'fish']), CFG, 'diner', 'venison')
    expect(varied).toBeCloseTo(
      CFG.needs.eatRestoreHunger *
        nutritionOf(CFG, 'venison') *
        (1 + 2 * CFG.foodVariety.bonusPerKind),
      12,
    )
    expect(varied).toBeGreaterThan(plain)

    // Six kinds would be worth 0.25 and the bonus stops at maxBonus.
    const feast = mealRestore(
      fed(['bread', 'fish', 'berries', 'wheat', 'mushroom', 'stew']),
      CFG,
      'diner',
      'venison',
    )
    expect(feast).toBeCloseTo(
      CFG.needs.eatRestoreHunger * nutritionOf(CFG, 'venison') * (1 + CFG.foodVariety.maxBonus),
      12,
    )
  })

  it('with the law off a meal is the flat restore it always was', () => {
    const OFF: SimConfig = SimConfigSchema.parse({ ...QUIET, foodVariety: { enabled: false } })
    expect(mealRestore(fed(['bread', 'fish']), OFF, 'diner', 'venison')).toBe(
      OFF.needs.eatRestoreHunger,
    )
  })

  it("a real meal writes the kind into the window, and the window is the config's width", () => {
    let s = spawn(genesisState(CFG, MAP()), CFG, 'diner', 4, 4)
    s = give(s, CFG, 'diner', 'item_loaf', 'bread', 2)
    s = { ...s, tick: 400 }
    const out = doVerb(s, CFG, 401, 'diner', 'eat', { itemId: 'item_loaf' }, 4)
    expect(out.refusal).toBeNull()
    expect(out.state.agents.diner!.recentFoods).toEqual([{ kind: 'bread', day: 0 }])
    expect(CFG.foodVariety.windowDays).toBe(3)
  })
})

describe('G11a-V2: a felled wood grows back, and a sapling is not timber yet', () => {
  it('a seeded tile matures into forest on the day the clock names', () => {
    const terrain = MAP()
    terrain[5]![5] = 3 // a standing tree, so the seed has somewhere to fall from
    let s = genesisState(CFG, terrain)
    s = fold(
      s,
      ev('tile_changed', { x: 6, y: 5, from: 0, to: 9, reason: 'seeded' }, MINUTES_PER_DAY),
      CFG,
    )
    expect(s.saplings?.['6,5']).toBe(1)

    // Only the midnights matter, so only the midnights are run.
    const NONE: SimConfig = SimConfigSchema.parse({
      ...QUIET,
      regrowth: { saplingChancePerDay: 0 },
    })
    let grewOn: number | null = null
    for (let day = 2; day <= 1 + CFG.regrowth.saplingDays + 1; day++) {
      const out = pass({ ...s, tick: day * MINUTES_PER_DAY - 1 }, NONE, day * MINUTES_PER_DAY)
      s = out.state
      const grown = out.events.find(
        (e) => e.type === 'tile_changed' && (e.payload as { reason?: string }).reason === 'grown',
      )
      if (grown !== undefined && grewOn === null) grewOn = day
    }
    expect(grewOn).toBe(1 + CFG.regrowth.saplingDays)
    expect(s.terrain[5]![6]).toBe(3)
    expect(s.saplings).toBeUndefined()
  })

  it('an edge tile is seeded at the dial, and never when the law is off', () => {
    const terrain = MAP()
    terrain[5]![5] = 3
    const SURE: SimConfig = SimConfigSchema.parse({
      ...QUIET,
      regrowth: { saplingChancePerDay: 1 },
    })
    const out = pass(
      { ...genesisState(SURE, terrain), tick: MINUTES_PER_DAY - 1 },
      SURE,
      MINUTES_PER_DAY,
    )
    const seeded = out.events.filter(
      (e) => e.type === 'tile_changed' && (e.payload as { reason?: string }).reason === 'seeded',
    )
    expect(seeded.length).toBe(4) // the four tiles orthogonally touching the tree

    const OFF: SimConfig = SimConfigSchema.parse({ ...QUIET, regrowth: { enabled: false } })
    const none = pass(
      { ...genesisState(OFF, terrain), tick: MINUTES_PER_DAY - 1 },
      OFF,
      MINUTES_PER_DAY,
    )
    expect(none.events.filter((e) => e.type === 'tile_changed')).toEqual([])
  })

  it('chopping a sapling clears it and yields nothing; felling a tree yields the timber', () => {
    const terrain = MAP()
    terrain[5]![6] = 9
    terrain[6]![5] = 3
    let s = spawn(genesisState(CFG, terrain), CFG, 'axeman', 5, 5)
    s = { ...s, tick: 600 }
    const sapling = doVerb(s, CFG, 601, 'axeman', 'chop', { x: 6, y: 5 }, 40)
    expect(sapling.refusal).toBeNull()
    expect(sapling.state.terrain[5]![6]).toBe(0)
    expect(sapling.events.filter((e) => e.type === 'item_spawned')).toEqual([])

    const tree = doVerb(s, CFG, 601, 'axeman', 'chop', { x: 5, y: 6 }, 80)
    expect(tree.refusal).toBeNull()
    expect(tree.state.terrain[6]![5]).toBe(0)
    const timber = tree.events.find((e) => e.type === 'item_spawned')!.payload as {
      kind: string
      qty: number
    }
    expect(timber.kind).toBe('wood')
    expect(timber.qty).toBeGreaterThan(0)
  })
})

import { describe, it, expect } from 'vitest'
import {
  isBeddedKind,
  isHearthKind,
  lightBandAt,
  MINUTES_PER_DAY,
  SimConfigSchema,
  structureGlowRadius,
  type SimConfig,
} from '@sj/shared'
import { fold } from './fold.js'
import { submitIntent } from './intent.js'
import { composePerception } from './perception.js'
import { RngStreams } from './rng.js'
import { genesisState, type TileId, type WorldState } from './state.js'
import { fumblesInTheDark, VERBS } from './verbs/index.js'
import { sleepRegenPerTick } from './systems/needs.js'
import { isExposed, warmthTargetFor } from './systems/warmth.js'
import { ev, grid } from './testutil/world.js'

// A house's hearth is a real fire: fed, lit, warming the room, cookable on — off one fact,
// structures.recipes.house.hearth, with no new agent state.

const quiet = {
  weather: { hourlyChangeChance: 0 },
  mystery: { chancePerDay: 0 },
  mapGrowth: { enabled: false },
  fauna: { enabled: false },
  desirePaths: { enabled: false },
}
const CFG: SimConfig = SimConfigSchema.parse(quiet)
const FUEL = CFG.light.fuelBurnTicks

const map = (): TileId[][] => grid(16)

// Minute 30, so no hour boundary rolls anything. 22:00 on a winter day is the coldest hour the
// warmth table has, and it is the hour the whole cold design exists for.
const WINTER_NIGHT = 273 * MINUTES_PER_DAY + 22 * 60 + 30

/** A body at (4, 4) and a finished house at (5, 4). Nothing else stands. */
function houseAndBody(tick = WINTER_NIGHT, weatherC = -10): WorldState {
  let s = genesisState(CFG, map())
  s = fold(s, ev('tick_advanced', {}, tick), CFG)
  s = fold(s, ev('weather_changed', { kind: 'sunny', temperatureC: weatherC }, tick), CFG)
  s = fold(s, ev('agent_spawned', { id: 'a1', name: 'a1', x: 4, y: 4, ageDays: 7300 }, tick), CFG)
  s = fold(
    s,
    ev(
      'structure_planned',
      {
        id: 'house_1',
        kind: 'house',
        x: 5,
        y: 4,
        w: 2,
        h: 2,
        maxHp: 50,
        flammable: true,
        builderId: 'a1',
      },
      tick,
    ),
    CFG,
  )
  return fold(s, ev('structure_completed', { id: 'house_1' }, tick), CFG)
}

const holding = (s: WorldState, id: string, kind: string, qty = 1): WorldState =>
  fold(s, ev('item_spawned', { id, kind, qty, loc: { t: 'agent', id: 'a1' } }, s.tick), CFG)

// A body that has gone in stands at its own doorway, which is where `enter` leaves it — the
// room's reach is proved in lighting.test.ts, on a body that has walked away from the door.
const indoors = (s: WorldState): WorldState =>
  fold(s, ev('agent_entered', { agentId: 'a1', structureId: 'house_1' }, s.tick), CFG)

/** Run a verb to completion the way the tick loop would. */
function apply(s: WorldState, verb: string, params: Record<string, unknown>): WorldState {
  const r = submitIntent(s, CFG, 'a1', verb, params)
  if (!r.ok) throw new Error(`${verb}: ${r.reason}`)
  const done = VERBS[verb]!.onComplete(s, CFG, 'a1', params, new RngStreams('he').get('actions'))
  let out = s
  for (const e of [
    ...r.events,
    { type: 'action_completed', payload: { agentId: 'a1', verb } },
    ...done,
  ]) {
    out = fold(out, ev(e.type, e.payload, s.tick), CFG)
  }
  return out
}

const light = (s: WorldState): 'bright' | 'dim' | 'dark' =>
  lightBandAt(s, s.agents.a1!.x, s.agents.a1!.y, s.tick, CFG)

/** The same world at the same tick with the fuel gone — so a guard measures the FIRE and never
 *  the hour, which is what advancing the clock past `fuelBurnTicks` measures instead. */
const burntDown = (s: WorldState): WorldState => ({
  ...s,
  structures: {
    ...s.structures,
    house_1: { ...s.structures.house_1!, fueledUntilTick: s.tick - 1 },
  },
})

describe('★ the hearth in a house is a fire, and four laws already knew what to do with one', () => {
  it('the kind says so once, and every law reads that one answer', () => {
    expect(isHearthKind(CFG, 'house')).toBe(true)
    expect(isHearthKind(CFG, 'fire_pit')).toBe(true)
    // ★ VACUOUS GUARD: this passes for the wrong reason if EVERY kind holds a fire.
    expect(isHearthKind(CFG, 'storehouse')).toBe(false)
    expect(isHearthKind(CFG, 'well')).toBe(false)
    // A house glows with the hearth's own radius and never a second number written beside it.
    expect(structureGlowRadius(CFG, 'house')).toBe(CFG.light.glowRadius.hearth)
    expect(structureGlowRadius(CFG, 'fire_pit')).toBe(CFG.light.glowRadius.fire_pit)
    expect(structureGlowRadius(CFG, 'storehouse')).toBeUndefined()
  })

  it('★ 1 — a body indoors can feed it, and an unfed house holds no fire at all', () => {
    const cold = indoors(holding(houseAndBody(), 'wood_1', 'wood'))
    expect(cold.structures.house_1!.fueledUntilTick).toBeUndefined()
    const fed = apply(cold, 'stoke', { structureId: 'house_1' })
    expect(fed.structures.house_1!.fueledUntilTick).toBe(cold.tick + FUEL)
    expect(fed.items.wood_1).toBeUndefined()
  })

  it('★ 2 — LIGHT: the room is dark until somebody feeds the hearth, and then it is not', () => {
    const cold = indoors(holding(houseAndBody(), 'wood_1', 'wood'))
    expect(light(cold)).toBe('dark')
    expect(fumblesInTheDark(cold, CFG, 'a1')).toBe(true)

    const fed = apply(cold, 'stoke', { structureId: 'house_1' })
    expect(light(fed)).toBe('bright')
    expect(fumblesInTheDark(fed, CFG, 'a1')).toBe(false)

    // ★ VACUOUS GUARD: it is the FIRE and not the roof. The same body in the same room the tick
    // after the fuel runs out is back in the dark, so nothing here is "indoors is bright".
    const spent = burntDown(fed)
    expect(light(spent)).toBe('dark')
    expect(fumblesInTheDark(spent, CFG, 'a1')).toBe(true)
  })

  it('★ 3 — WARMTH: walls stopped the cold getting in and never made the room warm', () => {
    const cold = indoors(holding(houseAndBody(), 'wood_1', 'wood'))
    // The walls already do the whole of what they ever did: this body is not exposed either way.
    expect(isExposed(cold, CFG, 'a1')).toBe(false)
    const before = warmthTargetFor(cold, CFG, 'a1')

    const fed = apply(cold, 'stoke', { structureId: 'house_1' })
    const after = warmthTargetFor(fed, CFG, 'a1')

    // The measured numbers, and the line they straddle: `prose.ts` says "You shiver against the
    // cold" below 30, so an indoor body on a winter night shivered beside its own fireplace.
    expect([before, after]).toEqual([10, 34])
    expect(before).toBeLessThan(CFG.needs.debuffThreshold)
    expect(after).toBeGreaterThan(CFG.needs.debuffThreshold)

    // ★ VACUOUS GUARD: it is the FIRE and not the walls, and not the passage of time.
    const spent = burntDown(fed)
    expect(warmthTargetFor(spent, CFG, 'a1')).toBe(before)
  })

  it('★ 3b — and a body INSIDE ANOTHER BUILDING gets nothing from it: a wall stops the heat', () => {
    let s = holding(houseAndBody(), 'wood_1', 'wood')
    s = fold(
      s,
      ev(
        'structure_planned',
        {
          id: 'house_2',
          kind: 'house',
          x: 5,
          y: 7,
          w: 2,
          h: 2,
          maxHp: 50,
          flammable: true,
          builderId: 'a1',
        },
        s.tick,
      ),
      CFG,
    )
    s = fold(s, ev('structure_completed', { id: 'house_2' }, s.tick), CFG)
    const fed = apply(indoors(s), 'stoke', { structureId: 'house_1' })
    expect(warmthTargetFor(fed, CFG, 'a1')).toBe(34)

    // Same tick, same fire, same tile — the body has simply stepped into the house next door.
    let next = fold(
      fed,
      ev('agent_exited', { agentId: 'a1', structureId: 'house_1' }, fed.tick),
      CFG,
    )
    next = fold(
      next,
      ev('agent_entered', { agentId: 'a1', structureId: 'house_2' }, next.tick),
      CFG,
    )
    expect(warmthTargetFor(next, CFG, 'a1')).toBe(10)
  })

  it('★ 4 — COOKING: a pot can go over a fire that is out of the weather', () => {
    // Meat, a vegetable and water in hand: everything the one authored `atFire` recipe wants.
    let s = indoors(houseAndBody())
    s = holding(s, 'wood_1', 'wood')
    s = holding(s, 'meat_1', 'venison')
    s = holding(s, 'veg_1', 'berries')
    s = fold(
      s,
      ev(
        'item_spawned',
        { id: 'skin_1', kind: 'waterskin', qty: 1, charges: 2, loc: { t: 'agent', id: 'a1' } },
        s.tick,
      ),
      CFG,
    )

    const unlit = submitIntent(s, CFG, 'a1', 'craft', { recipe: 'stew' })
    expect(unlit.ok).toBe(false)
    if (!unlit.ok) expect(unlit.reason).toBe('there is no fire lit here to cook on')

    const fed = apply(s, 'stoke', { structureId: 'house_1' })
    expect(submitIntent(fed, CFG, 'a1', 'craft', { recipe: 'stew' }).ok).toBe(true)

    // ★ VACUOUS GUARD: the fire is what changed, not the walls or the larder.
    const spent = burntDown(fed)
    expect(submitIntent(spent, CFG, 'a1', 'craft', { recipe: 'stew' }).ok).toBe(false)
  })

  it('★ 5 — and a mind can SEE it: the packet says whether the fire in the room is lit', () => {
    const cold = indoors(holding(houseAndBody(), 'wood_1', 'wood'))
    const roomOf = (s: WorldState) =>
      composePerception(s, CFG, 'a1', []).visible.structures.find((x) => x.id === 'house_1')
    expect(roomOf(cold)?.hearth).toBe('cold')
    expect(roomOf(apply(cold, 'stoke', { structureId: 'house_1' }))?.hearth).toBe('lit')

    // ★ VACUOUS GUARD: a building with no fire in it says nothing, rather than saying "cold".
    let shed = fold(
      cold,
      ev(
        'structure_planned',
        {
          id: 'store_1',
          kind: 'storehouse',
          x: 1,
          y: 1,
          w: 2,
          h: 2,
          maxHp: 40,
          flammable: true,
          builderId: 'a1',
        },
        cold.tick,
      ),
      CFG,
    )
    shed = fold(shed, ev('structure_completed', { id: 'store_1' }, shed.tick), CFG)
    shed = fold(shed, ev('agent_exited', { agentId: 'a1', structureId: 'house_1' }, shed.tick), CFG)
    const seen = composePerception(shed, CFG, 'a1', []).visible.structures
    expect(seen.find((x) => x.id === 'store_1')?.hearth).toBeUndefined()
    expect(seen.find((x) => x.id === 'house_1')?.hearth).toBe('cold')

    // A building still going up has no fire in it yet, whatever its kind will hold.
    let site = fold(
      houseAndBody(),
      ev(
        'structure_planned',
        {
          id: 'site_1',
          kind: 'house',
          x: 1,
          y: 1,
          w: 2,
          h: 2,
          maxHp: 50,
          flammable: true,
          builderId: 'a1',
        },
        WINTER_NIGHT,
      ),
      CFG,
    )
    site = fold(site, ev('agent_moved', { id: 'a1', x: 3, y: 3 }, site.tick), CFG)
    expect(
      composePerception(site, CFG, 'a1', []).visible.structures.find((x) => x.id === 'site_1')
        ?.hearth,
    ).toBeUndefined()
  })
})

// `sleep` validates that a body is under a roof and has never named the bed under it: one flat
// energyRegenAsleepPerTick answered bare ground, a storehouse floor and a founder's bed alike.
describe('★ a bed is worth something, and it was worth nothing', () => {
  const REGEN = CFG.needs.energyRegenAsleepPerTick

  /** A body asleep inside `kind`, having gone in from (4, 4) beside it. */
  function asleepIn(kind: string): WorldState {
    const row = CFG.structures.recipes[kind]!
    let s = genesisState(CFG, map())
    s = fold(s, ev('tick_advanced', {}, WINTER_NIGHT), CFG)
    s = fold(
      s,
      ev('agent_spawned', { id: 'a1', name: 'a1', x: 4, y: 4, ageDays: 7300 }, WINTER_NIGHT),
      CFG,
    )
    s = fold(
      s,
      ev(
        'structure_planned',
        {
          id: 'roof_1',
          kind,
          x: 5,
          y: 4,
          w: row.w,
          h: row.h,
          maxHp: row.maxHp,
          flammable: row.flammable,
          builderId: 'a1',
        },
        WINTER_NIGHT,
      ),
      CFG,
    )
    s = fold(s, ev('structure_completed', { id: 'roof_1' }, WINTER_NIGHT), CFG)
    return fold(s, ev('agent_entered', { agentId: 'a1', structureId: 'roof_1' }, WINTER_NIGHT), CFG)
  }

  it('★ a house sleeps a body faster than a roof with nothing but a floor under it', () => {
    expect(isBeddedKind(CFG, 'house')).toBe(true)
    // Vacuous guard: passes for the wrong reason if EVERY roof counts as a bed. The cabin and the
    // storehouse are 2x2, exactly a house's mass, and both are somewhere a body may lie down.
    expect(isBeddedKind(CFG, 'storehouse')).toBe(false)
    expect(isBeddedKind(CFG, 'cabin')).toBe(false)

    const inBed = sleepRegenPerTick(asleepIn('house'), CFG, 'a1')
    const onBoards = sleepRegenPerTick(asleepIn('storehouse'), CFG, 'a1')
    expect([onBoards, inBed]).toEqual([REGEN, REGEN * CFG.needs.bedRegenMultiplier])
    expect(inBed).toBeGreaterThan(onBoards)
  })

  it('★ and the boards are exactly as good as they always were — nothing got worse', () => {
    // The one number the whole world used before this change, unmoved for everybody without a
    // bed: out under the sky, in a storehouse, in the cabin. Only the bed is new.
    let outside = genesisState(CFG, map())
    outside = fold(
      outside,
      ev('agent_spawned', { id: 'a1', name: 'a1', x: 1, y: 1, ageDays: 7300 }, 0),
      CFG,
    )
    expect(sleepRegenPerTick(outside, CFG, 'a1')).toBe(REGEN)
    for (const kind of ['storehouse', 'cabin']) {
      expect(sleepRegenPerTick(asleepIn(kind), CFG, 'a1'), kind).toBe(REGEN)
    }
  })

  it('★ and a mind can SEE which roof has beds in it, before it walks to one', () => {
    const seen = (kind: string) => {
      const s = fold(
        asleepIn(kind),
        ev('agent_exited', { agentId: 'a1', structureId: 'roof_1' }, WINTER_NIGHT),
        CFG,
      )
      return composePerception(s, CFG, 'a1', []).visible.structures.find((x) => x.id === 'roof_1')
    }
    expect(seen('house')?.bed).toBe(true)
    expect(seen('storehouse')?.bed).toBeUndefined()
    expect(seen('cabin')?.bed).toBeUndefined()
  })
})

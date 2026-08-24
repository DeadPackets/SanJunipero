import { describe, it, expect } from 'vitest'
import {
  dayPhaseFromTick, glowRadiusFor, isDark, lightBandAt, SimConfigSchema, T_PATH, T_ROAD,
  type SimConfig, type SimEvent,
} from '@sj/shared'
import { fold } from './fold.js'
import { makeGenesisWorld } from './genesis/world.js'
import { submitIntent } from './intent.js'
import { RngStreams } from './rng.js'
import { genesisState, type TileId, type WorldState } from './state.js'
import { ambientTempAt, isExposed } from './systems/warmth.js'
import { claimInWorld, townSquareOf } from './town.js'
import { buildIsPlotted, isKindleable, isPlottedKind, isStokeable, workPenalty, type PendingEvent } from './verbs.js'
import { createWorldTick } from './worldTick.js'

// ★ A LAMP POST — the standing light this world had no way to make.
//
// Before this the only fixed flames were the square's own fire pit, placed by genesis, and the
// hearths inside houses. Everything else was a torch: 240 ticks in one hand, and it goes with
// the hand. The dark has charged `light.nightWorkPenalty` for work since C11, so the hazard was
// already shipped and the answer to it was not — which is the arm-B shape the motivation lane
// measured, in a different costume. This file is the road, not a new hazard: nothing here makes
// the night worse, and the tests below pin that it does not.

const QUIET = {
  weather: { hourlyChangeChance: 0 },
  mystery: { chancePerDay: 0 },
  aging: { deathOfOldAgeEnabled: false },
}
const CFG: SimConfig = SimConfigSchema.parse(QUIET)

const NIGHT = 22 * 60
const NOON = 12 * 60

let seq = 810000
const ev = (type: string, payload: unknown, tick = 0): SimEvent => ({ seq: seq++, tick, type, payload })

const MAP = (n = 24): TileId[][] => Array.from({ length: n }, () => Array.from({ length: n }, (): TileId => 0))

const spawn = (s: WorldState, id: string, x: number, y: number): WorldState =>
  fold(s, ev('agent_spawned', { id, name: id, x, y, ageDays: 7300 }), CFG)

const give = (s: WorldState, id: string, itemId: string, kind: string, qty = 1): WorldState =>
  fold(s, ev('item_spawned', { id: itemId, kind, qty, loc: { t: 'agent', id } }), CFG)

const apply = (s: WorldState, events: PendingEvent[], tick: number): WorldState =>
  events.reduce((acc, e) => fold(acc, ev(e.type, e.payload, tick), CFG), s)

function pass(s: WorldState, tick: number, config = CFG): { state: WorldState; events: PendingEvent[] } {
  const advanced = fold({ ...s, tick: tick - 1 }, ev('tick_advanced', {}, tick), config)
  return createWorldTick(config, new RngStreams('lamp'))(advanced)
}

function doVerb(
  s: WorldState, tick: number, agentId: string, verb: string,
  params: Record<string, unknown> = {}, limit = 400,
): { state: WorldState; events: PendingEvent[]; refusal: string | null; duration: number } {
  const at: WorldState = { ...s, tick }
  const started = submitIntent(at, CFG, agentId, verb, params)
  if (!started.ok) return { state: s, events: [], refusal: started.reason, duration: 0 }
  const duration = (started.events[0]!.payload as { duration: number }).duration
  let state = apply(at, started.events, tick)
  const events: PendingEvent[] = [...started.events]
  for (let t = tick + 1; t <= tick + limit; t++) {
    const out = pass(state, t)
    state = out.state
    events.push(...out.events)
    if (state.agents[agentId]!.activity === null) break
  }
  return { state, events, refusal: null, duration }
}

/** A wright standing at (4,4) with wood in hand, on a night with no moon in it. */
function wright(wood = 4): WorldState {
  let s = spawn(genesisState(CFG, MAP()), 'wright', 4, 4)
  s = give(s, 'wright', 'item_wood', 'wood', wood)
  return { ...s, tick: NIGHT - 1 }
}

/** Raise a lamp beside the wright and feed it. Returns the world with the flame burning. */
function lampLit(at = { x: 5, y: 4 }): { state: WorldState; id: string; tick: number } {
  const raised = doVerb(wright(), NIGHT, 'wright', 'build', { kind: 'lamp_post', ...at })
  expect(raised.refusal).toBeNull()
  const id = (raised.events.find((e) => e.type === 'structure_planned')!.payload as { id: string }).id
  const tick = raised.state.tick
  const fed = doVerb(raised.state, tick, 'wright', 'stoke', { structureId: id })
  expect(fed.refusal).toBeNull()
  return { state: fed.state, id, tick: fed.state.tick }
}

describe('a lamp post: the standing light a pair of hands can raise', () => {
  it('costs two wood and two hours, and the builder says where — no plot, no town needed', () => {
    const r = doVerb(wright(), NIGHT, 'wright', 'build', { kind: 'lamp_post', x: 5, y: 4 })
    expect(r.refusal).toBeNull()
    // ★ 120 ticks against a house's 2 880, and a night is 720. This is the number that makes
    // the want answerable: the dark arrives at dusk and the lamp is lit before dawn.
    expect(r.duration).toBe(Math.ceil(CFG.structures.recipes.lamp_post!.durationTicks * CFG.light.nightWorkPenalty))
    expect(r.duration).toBeLessThan(720)
    const planned = r.events.find((e) => e.type === 'structure_planned')!.payload as Record<string, unknown>
    expect(planned).toMatchObject({ kind: 'lamp_post', x: 5, y: 4, w: 1, h: 1, flammable: false })
    expect(r.events.some((e) => e.type === 'structure_completed')).toBe(true)
    // Two wood gone, two left.
    const wood = Object.values(r.state.items).filter((i) => i.kind === 'wood')
      .reduce((n, i) => n + i.qty, 0)
    expect(wood).toBe(2)
  })

  // ★ THIS TEST WAS VACUOUS ON ITS FIRST WRITING and a mutation proved it: the fixture map has
  // no town square, so `buildIsPlotted` is false for EVERY kind there and `sited: false` on the
  // lamp passed all eleven tests. A siting rule can only be measured in a town. The world below
  // is the genesis valley, which has one.
  it('★ in a TOWN, a house takes the plot and a lamp still takes a coordinate', () => {
    const g = makeGenesisWorld(CFG)
    const town = g.events.reduce((acc, e) => fold(acc, ev(e.type, e.payload), CFG), genesisState(CFG, g.terrain))
    expect(townSquareOf(town)).not.toBeNull()
    expect(isPlottedKind(CFG, 'house')).toBe(true)
    expect(isPlottedKind(CFG, 'lamp_post')).toBe(false)
    expect(buildIsPlotted(town, CFG, 'house')).toBe(true)
    expect(buildIsPlotted(town, CFG, 'lamp_post')).toBe(false)

    const door = claimInWorld(town, { along: 2, deep: 2 })!.door
    let s = fold(town, ev('agent_spawned', { id: 'a', name: 'a', x: door.x, y: door.y, ageDays: 10000 }), CFG)
    s = give(s, 'a', 'wood_a', 'wood', 12)
    // The house is the town's to place, and says so.
    expect(submitIntent(s, CFG, 'a', 'build', { kind: 'house' }).ok).toBe(true)
    expect(submitIntent(s, CFG, 'a', 'build', { kind: 'house', x: door.x, y: door.y - 3 }).ok).toBe(false)
    // The lamp is the opposite, in the same town, in the same breath.
    expect(submitIntent(s, CFG, 'a', 'build', { kind: 'lamp_post' }))
      .toEqual({ ok: false, reason: 'build needs {kind, x, y}' })
  })

  it('is refused without a coordinate even where there is no town at all', () => {
    expect(submitIntent(wright(), CFG, 'wright', 'build', { kind: 'lamp_post' }))
      .toEqual({ ok: false, reason: 'build needs {kind, x, y}' })
  })

  it('will not stand in the road, and the refusal says why', () => {
    for (const tile of [T_ROAD, T_PATH] as const) {
      const map = MAP()
      map[4]![5] = tile as TileId
      let s = spawn(genesisState(CFG, map), 'wright', 4, 4)
      s = give(s, 'wright', 'item_wood', 'wood', 4)
      const r = submitIntent({ ...s, tick: NIGHT }, CFG, 'wright', 'build', { kind: 'lamp_post', x: 5, y: 4 })
      expect(r).toEqual({
        ok: false,
        reason: 'that would stand in the way — the lamp post goes on the ground beside the way, not on it',
      })
    }
    // And the verge one tile over takes it, so the refusal is a redirection and not a wall.
    const map = MAP()
    map[4]![5] = T_ROAD as TileId
    let s = spawn(genesisState(CFG, map), 'wright', 4, 4)
    s = give(s, 'wright', 'item_wood', 'wood', 4)
    expect(submitIntent({ ...s, tick: NIGHT }, CFG, 'wright', 'build', { kind: 'lamp_post', x: 4, y: 5 }).ok).toBe(true)
  })
})

describe('★ the lamp answers the dark, and the dark it answers is the one that charges', () => {
  it('is dark beside an unfed post and not dark beside a fed one — same world, same tick', () => {
    const raised = doVerb(wright(), NIGHT, 'wright', 'build', { kind: 'lamp_post', x: 5, y: 4 })
    const id = (raised.events.find((e) => e.type === 'structure_planned')!.payload as { id: string }).id
    const t = raised.state.tick
    // A post nobody has fed is a post. Every tile round it is dark.
    expect(isDark(raised.state, 5, 4, t, CFG)).toBe(true)
    expect(isDark(raised.state, 4, 4, t, CFG)).toBe(true)

    const fed = doVerb(raised.state, t, 'wright', 'stoke', { structureId: id })
    expect(fed.refusal).toBeNull()
    const f = fed.state.tick
    // ★ THE PAIR, AND IT IS WHY THIS TEST IS NOT VACUOUS: one instant, one world, a tile that
    // is lit and a tile that is not. A build that lit the whole map passes neither half.
    expect(isDark(fed.state, 5, 4, f, CFG)).toBe(false)          // the post itself
    expect(isDark(fed.state, 9, 4, f, CFG)).toBe(false)          // four tiles off — its reach
    expect(isDark(fed.state, 10, 4, f, CFG)).toBe(true)          // five — past it
    expect(lightBandAt(fed.state, 5, 4, f, CFG)).toBe('bright')
    expect(lightBandAt(fed.state, 10, 4, f, CFG)).toBe('dark')
    expect(glowRadiusFor(CFG, 'lamp_post')).toBe(4)
  })

  it('★ buys back the night work penalty — the road the hazard never had', () => {
    const raised = doVerb(wright(), NIGHT, 'wright', 'build', { kind: 'lamp_post', x: 5, y: 4 })
    const id = (raised.events.find((e) => e.type === 'structure_planned')!.payload as { id: string }).id
    // Unfed: the dark charges half again, exactly as it has since C11.
    expect(workPenalty(raised.state, CFG, 'wright', 'pave')).toBe(CFG.light.nightWorkPenalty)
    const fed = doVerb(raised.state, raised.state.tick, 'wright', 'stoke', { structureId: id })
    expect(workPenalty(fed.state, CFG, 'wright', 'pave')).toBe(1)
    // And a mind standing in it is told so, in the words that were already there.
    expect(lightBandAt(fed.state, 4, 4, fed.state.tick, CFG)).toBe('bright')
  })

  it('goes out when its fuel does, and takes another armful', () => {
    const { state, id, tick } = lampLit()
    const until = state.structures[id]!.fueledUntilTick!
    expect(until).toBe(tick + CFG.light.fuelBurnTicks)
    // Read at a tick still inside the same night, so the CLOCK is not what changes the answer:
    // one armful of wood is 480 ticks and a night is 720, so a lamp wants feeding twice.
    const late = tick + 120
    expect(dayPhaseFromTick(late)).toBe('night')
    expect(isDark(state, 5, 4, late, CFG)).toBe(false)
    // Now take the fuel away at that same tick and the street is dark again — the flame is what
    // is doing the work, not the hour.
    const spent = fold(state, ev('structure_fueled', { structureId: id, burnsUntilTick: late - 1 }, late), CFG)
    expect(isDark(spent, 5, 4, late, CFG)).toBe(true)
    const again = doVerb(spent, late, 'wright', 'stoke', { structureId: id })
    expect(again.refusal).toBeNull()
    expect(isDark(again.state, 5, 4, again.state.tick, CFG)).toBe(false)
  })

  it('throws nothing while it is still being raised', () => {
    let s = wright()
    s = fold(s, ev('structure_planned', {
      id: 'structure_9', kind: 'lamp_post', x: 5, y: 4, w: 1, h: 1, maxHp: 15, flammable: false, builderId: 'wright',
    }, NIGHT), CFG)
    s = fold(s, ev('structure_fueled', { structureId: 'structure_9', burnsUntilTick: NIGHT + 999 }, NIGHT), CFG)
    expect(isDark(s, 5, 4, NIGHT, CFG)).toBe(true)
  })
})

describe('what a lamp is NOT — the three ways it could have quietly made the night worse', () => {
  it('is light and not warmth: a body beside a lit lamp is as exposed as one beside none', () => {
    const { state, tick } = lampLit()
    // The wright stands at (4,4), one tile from the post, well inside `warmth.heatRadius`.
    expect(isDark(state, 4, 4, tick, CFG)).toBe(false)
    expect(ambientTempAt(state, CFG)).toBeLessThan(CFG.warmth.comfortBand)
    expect(isExposed(state, CFG, 'wright')).toBe(true)
  })

  it('is not a new fire: only a CARRIED flame rolls against a wall, and a post is not carried', () => {
    const SURE: SimConfig = SimConfigSchema.parse({ ...QUIET, light: { fireRiskPerTick: 1 } })
    let s = spawn(genesisState(SURE, MAP()), 'wright', 4, 4)
    s = fold(s, ev('structure_planned', {
      id: 'shed', kind: 'shed', x: 6, y: 4, w: 2, h: 2, maxHp: 50, flammable: true, builderId: 'script',
    }, NIGHT - 1), SURE)
    s = fold(s, ev('structure_completed', { id: 'shed' }, NIGHT - 1), SURE)
    s = fold(s, ev('structure_planned', {
      id: 'lamp', kind: 'lamp_post', x: 5, y: 4, w: 1, h: 1, maxHp: 15, flammable: false, builderId: 'script',
    }, NIGHT - 1), SURE)
    s = fold(s, ev('structure_completed', { id: 'lamp' }, NIGHT - 1), SURE)
    s = fold(s, ev('structure_fueled', { structureId: 'lamp', burnsUntilTick: NIGHT + 500 }, NIGHT - 1), SURE)
    const out = pass({ ...s, tick: NIGHT - 1 }, NIGHT, SURE)
    // The lamp is alight, adjacent to a flammable shed, at a risk dial of ONE. Nothing ignites.
    expect(isDark(out.state, 5, 4, NIGHT, SURE)).toBe(false)
    expect(out.events.filter((e) => e.type === 'fire_ignited')).toEqual([])
  })

  it('is fed, never pocketed — and a house is not a fire, however much wood is in it', () => {
    expect(isStokeable(CFG, 'lamp_post')).toBe(true)
    expect(isStokeable(CFG, 'hearth')).toBe(true)
    expect(isStokeable(CFG, 'fire_pit')).toBe(true)
    expect(isStokeable(CFG, 'house')).toBe(false)
    expect(isStokeable(CFG, 'torch')).toBe(false)
    expect(isKindleable(CFG, 'lamp_post')).toBe(false)
    expect(isKindleable(CFG, 'torch')).toBe(true)
    expect(isKindleable(CFG, 'lantern')).toBe(true)
  })

  it('costs nothing at noon: a lamp is only worth raising because of the hour, not the law', () => {
    const { state, id } = lampLit()
    expect(isDark(state, 5, 4, NOON, CFG)).toBe(false)
    expect(isDark(state, 40, 40, NOON, CFG)).toBe(false)   // and so is everywhere else
    expect(state.structures[id]!.kind).toBe('lamp_post')
  })
})

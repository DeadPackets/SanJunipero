import { describe, it, expect } from 'vitest'
import { MINUTES_PER_DAY, SimConfigSchema, type SimConfig } from '@sj/shared'
import { fold } from '../fold.js'
import { RngStreams } from '../rng.js'
import { genesisState, type AgentBody, type TileId, type WorldState } from '../state.js'
import { createWorldTick, type WorldTickResult } from '../worldTick.js'
import { ambientTempAt, isExposed } from './warmth.js'
import { changesOf, ev, grid, roundTrips } from '../testutil/world.js'

// The fixture law: nothing may speak at midnight but the law under test, and no weather rolls.
// The EXCEPTION the Phase-F brief allows is used deliberately — these tests set the sky by hand.
const quiet = {
  weather: { hourlyChangeChance: 0 },
  mystery: { chancePerDay: 0 },
  mapGrowth: { enabled: false },
  fauna: { enabled: false },
  desirePaths: { enabled: false },
}
const CFG: SimConfig = SimConfigSchema.parse(quiet)
const OFF: SimConfig = SimConfigSchema.parse({ ...quiet, warmth: { enabled: false } })
const DECAY = CFG.warmth.exposureDecayPerTick
const AWAKE = CFG.needs.energyDecayAwakePerTick

const map = (): TileId[][] => grid(12)

// Minute 30 on purpose: no hour boundary, so nothing but this law runs in the tick under test.
const at = (day: number, hour: number): number => day * MINUTES_PER_DAY + hour * 60 + 30
const SPRING_DAY = at(10, 12)
const SUMMER_DAY = at(100, 12)
const AUTUMN_DUSK = at(200, 19)
const WINTER_NIGHT = at(273, 22)

function bodyAt(tick: number, config = CFG, extra: Partial<AgentBody> = {}): WorldState {
  let s = genesisState(config, map())
  s = fold(s, ev('tick_advanced', {}, tick - 1), config)
  s = fold(
    s,
    ev('agent_spawned', { id: 'a1', name: 'a1', x: 4, y: 4, ageDays: 7300 }, tick - 1),
    config,
  )
  const a1 = { ...s.agents.a1!, ...extra, needs: { ...s.agents.a1!.needs, ...(extra.needs ?? {}) } }
  return { ...s, agents: { ...s.agents, a1 } }
}

function tickOnce(s: WorldState, config = CFG): WorldTickResult {
  return createWorldTick(
    config,
    new RngStreams('wa'),
  )(fold(s, ev('tick_advanced', {}, s.tick + 1), config))
}

type NeedEv = { id: string; need: string; delta: number; reason?: string | undefined }
const changed = (r: WorldTickResult): NeedEv[] =>
  r.events.flatMap((e) => changesOf(e).map((c) => ({ id: (e.payload as { id: string }).id, ...c })))
const needs = (r: WorldTickResult, need: string): NeedEv[] =>
  changed(r).filter((c) => c.need === need)
const chills = (r: WorldTickResult): NeedEv[] => changed(r).filter((c) => c.reason === 'exposure')

const skyOf = (tick: number, kind: string): WorldState => ({
  ...genesisState(CFG, map()),
  tick,
  weather: { kind, temperatureC: 0 },
})

describe('ambientTempAt: a deterministic table, never a roll', () => {
  it('returns the ratified band for every season and phase', () => {
    const table: [number, number][] = [
      [at(10, 12), 14],
      [at(10, 6), 9],
      [at(10, 22), 5],
      [at(100, 12), 26],
      [at(100, 6), 20],
      [at(100, 22), 15],
      [at(200, 12), 10],
      [at(200, 19), 6],
      [at(200, 22), 2],
      [at(273, 12), -4],
      [at(273, 5), -8],
      [at(273, 22), -12],
    ]
    for (const [tick, expected] of table) {
      expect([tick, ambientTempAt(skyOf(tick, 'sunny'), CFG)]).toEqual([tick, expected])
    }
  })

  it('takes one more degree off in a storm and two in snow, and nothing off in the rain', () => {
    expect(ambientTempAt(skyOf(WINTER_NIGHT, 'storm'), CFG)).toBe(-13)
    expect(ambientTempAt(skyOf(WINTER_NIGHT, 'snow'), CFG)).toBe(-14)
    expect(ambientTempAt(skyOf(WINTER_NIGHT, 'rain'), CFG)).toBe(-12)
  })
})

describe('exposure: what the cold takes, and who it cannot reach', () => {
  it('an unclothed body out in a winter night loses warmth at exactly the exposure rate', () => {
    const r = tickOnce(bodyAt(WINTER_NIGHT))
    expect(needs(r, 'warmth')).toEqual([{ id: 'a1', need: 'warmth', delta: -DECAY }])
    expect(r.state.agents.a1!.needs.warmth).toBe(100 - DECAY)
  })

  it('a warm enough day takes nothing: the body drifts to the weather, as it always did', () => {
    const r = tickOnce(
      bodyAt(SUMMER_DAY, CFG, { needs: { hunger: 100, energy: 100, warmth: 50, social: 100 } }),
    )
    expect(isExposed(r.state, CFG, 'a1')).toBe(false)
    const [warmth] = needs(r, 'warmth')
    expect(warmth!.delta).toBeGreaterThan(0)
    expect(warmth!.reason).toBeUndefined()
  })

  it('four walls, a kept fire and a garment each stop it', () => {
    const inside = (): WorldState => {
      let s = bodyAt(WINTER_NIGHT)
      s = fold(
        s,
        ev(
          'structure_planned',
          {
            id: 'structure_1',
            kind: 'house',
            x: 4,
            y: 4,
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
      s = fold(s, ev('structure_completed', { id: 'structure_1' }, s.tick), CFG)
      return { ...s, agents: { ...s.agents, a1: { ...s.agents.a1!, insideId: 'structure_1' } } }
    }
    expect(isExposed(inside(), CFG, 'a1')).toBe(false)

    const beside = (fueledUntilTick: number): WorldState => {
      let s = bodyAt(WINTER_NIGHT)
      s = fold(
        s,
        ev(
          'structure_planned',
          {
            id: 'structure_1',
            kind: 'fire_pit',
            x: 6,
            y: 4,
            w: 1,
            h: 1,
            maxHp: 10,
            flammable: false,
            builderId: 'a1',
          },
          s.tick,
        ),
        CFG,
      )
      s = fold(s, ev('structure_completed', { id: 'structure_1' }, s.tick), CFG)
      return {
        ...s,
        structures: {
          ...s.structures,
          structure_1: { ...s.structures.structure_1!, fueledUntilTick },
        },
      }
    }
    // Two tiles from the pit is inside the heat; the same pit gone cold is just a ring of stones.
    expect(isExposed(beside(WINTER_NIGHT + 100), CFG, 'a1')).toBe(false)
    expect(isExposed(beside(WINTER_NIGHT - 100), CFG, 'a1')).toBe(true)
  })

  it('a garment offsets the band by its insulation, and that is what decides an autumn dusk', () => {
    const bare = bodyAt(AUTUMN_DUSK)
    // Under the band bare, over it clothed: the offset is what decides, and at an autumn dusk it
    // is decisive.
    expect(ambientTempAt(bare, CFG)).toBeLessThan(CFG.warmth.comfortBand)
    expect(ambientTempAt(bare, CFG) + CFG.warmth.insulation.garment).toBeGreaterThanOrEqual(
      CFG.warmth.comfortBand,
    )
    expect(isExposed(bare, CFG, 'a1')).toBe(true)

    let dressed = fold(
      bare,
      ev(
        'item_spawned',
        {
          id: 'item_1',
          kind: 'garment',
          qty: 1,
          loc: { t: 'agent', id: 'a1' },
        },
        bare.tick,
      ),
      CFG,
    )
    dressed = {
      ...dressed,
      agents: { ...dressed.agents, a1: { ...dressed.agents.a1!, equipped: { body: 'item_1' } } },
    }
    expect(isExposed(dressed, CFG, 'a1')).toBe(false)
    expect(chills(tickOnce(dressed))).toEqual([])
  })

  it('never decays when the world says the cold has no teeth', () => {
    const r = tickOnce(bodyAt(WINTER_NIGHT, OFF), OFF)
    expect(isExposed(r.state, OFF, 'a1')).toBe(false)
    expect(chills(r)).toEqual([])
    // With the law off, the old equalization is still the one that writes warmth.
    expect(needs(r, 'warmth')).toHaveLength(1)
  })

  it('leaves the dead and the unborn alone', () => {
    const dead = fold(
      bodyAt(WINTER_NIGHT),
      ev('agent_died', { agentId: 'a1', cause: 'hunger' }),
      CFG,
    )
    expect(needs(tickOnce(dead), 'warmth')).toEqual([])
  })
})

describe('a body with no warmth left burns twice the energy', () => {
  const frozen = (energy: number, warmth = 0): WorldState =>
    bodyAt(WINTER_NIGHT, CFG, { needs: { hunger: 100, energy, warmth, social: 100 } })

  it('doubles the awake drain at warmth zero, and only there', () => {
    expect(needs(tickOnce(frozen(80)), 'energy').map((e) => e.delta)).toEqual([-AWAKE, -AWAKE])
    expect(needs(tickOnce(frozen(80, 50)), 'energy').map((e) => e.delta)).toEqual([-AWAKE])
  })

  it('marks the second half as the cold, and the fold counts it on the body', () => {
    const r = tickOnce(frozen(80))
    expect(chills(r)).toEqual([{ id: 'a1', need: 'energy', delta: -AWAKE, reason: 'exposure' }])
    expect(r.state.agents.a1!.coldTicksSinceRecovery).toBe(1)
    expect(tickOnce(r.state).state.agents.a1!.coldTicksSinceRecovery).toBe(2)
  })

  it('a meal or a night in a bed clears the count, so the body hashes like one never chilled', () => {
    const chilled = tickOnce(frozen(80)).state
    const slept = fold(chilled, ev('agent_slept', { agentId: 'a1' }, chilled.tick), CFG)
    expect(slept.agents.a1!.coldTicksSinceRecovery).toBeUndefined()
    expect(Object.keys(slept.agents.a1!)).not.toContain('coldTicksSinceRecovery')
  })

  it('the doubling is what puts the body on the ground on the tick it falls', () => {
    // 5.1 energy: one drain leaves it standing at 5.007, two put it under the threshold.
    expect(5.1 - AWAKE).toBeGreaterThan(CFG.needs.collapseThreshold)
    expect(5.1 - 2 * AWAKE).toBeLessThan(CFG.needs.collapseThreshold)
    const cold = tickOnce(frozen(5.1, DECAY))
    expect(cold.events.some((e) => e.type === 'agent_collapsed')).toBe(true)
    const warm = tickOnce(
      bodyAt(SUMMER_DAY, CFG, { needs: { hunger: 100, energy: 5.1, warmth: 100, social: 100 } }),
    )
    expect(warm.events.some((e) => e.type === 'agent_collapsed')).toBe(false)
  })

  it('a sleeper is chilled but not drained: sleep is the recovery, not the cost', () => {
    const asleep = bodyAt(WINTER_NIGHT, CFG, {
      asleep: true,
      needs: { hunger: 100, energy: 40, warmth: 0, social: 100 },
    })
    expect(chills(tickOnce(asleep))).toEqual([])
  })
})

describe('the cold names the death it drove, and nothing else', () => {
  const failing = (tick: number, warmth: number) => {
    const s = bodyAt(tick, CFG, {
      hp: 0.1,
      needs: { hunger: 100, energy: 60, warmth, social: 100 },
    })
    return fold(
      s,
      ev('agent_afflicted', { agentId: 'a1', kind: 'fatigue', severity: 3 }, s.tick),
      CFG,
    )
  }
  const died = (r: WorldTickResult) => r.events.find((e) => e.type === 'agent_died')?.payload

  it('a ladder a winter night drove is exposure; the same ladder in a warm season is fatigue', () => {
    expect(died(tickOnce(failing(WINTER_NIGHT, 0)))).toEqual({ agentId: 'a1', cause: 'exposure' })
    expect(died(tickOnce(failing(SPRING_DAY, 100)))).toEqual({ agentId: 'a1', cause: 'fatigue' })
  })

  it('a body that is merely cold, with warmth still in it, dies of the tiredness', () => {
    expect(died(tickOnce(failing(WINTER_NIGHT, 100)))).toEqual({ agentId: 'a1', cause: 'fatigue' })
  })
})

describe('determinism', () => {
  it("folding the tick's own events reproduces the state it returned", () => {
    const start = bodyAt(WINTER_NIGHT, CFG, {
      needs: { hunger: 100, energy: 80, warmth: 0, social: 100 },
    })
    const { replayed, out } = roundTrips(start, CFG, 'wa')
    expect(replayed.agents.a1).toEqual(out.state.agents.a1)
  })
})

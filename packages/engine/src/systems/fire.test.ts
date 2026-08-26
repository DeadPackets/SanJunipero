import { describe, it, expect } from 'vitest'
import { EventEnvelope, SimConfigSchema, type SimConfig, type SimEvent } from '@sj/shared'
import { genesisState, type WorldState } from '../state.js'
import { fold } from '../fold.js'
import { submitIntent } from '../intent.js'
import { RngStreams } from '../rng.js'
import { createWorldTick, type WorldTickResult } from '../worldTick.js'
import { fireSystem } from './fire.js'

const CFG: SimConfig = SimConfigSchema.parse({ weather: { hourlyChangeChance: 0 } })

let seq = 12000
const ev = (type: string, payload: unknown, tick = 0): SimEvent => ({
  seq: seq++,
  tick,
  type,
  payload,
})

function house(id: string, x: number, y: number, flammable = true): SimEvent[] {
  return [
    ev('structure_planned', {
      id,
      kind: 'house',
      x,
      y,
      w: 2,
      h: 2,
      maxHp: 50,
      flammable,
      builderId: 'a1',
    }),
    ev('structure_completed', { id }),
  ]
}

// Row of touching houses 1-2-3, house 4 far away, non-flammable structure 5 touching house 1.
function rowWorld(config = CFG): WorldState {
  let s = genesisState(config)
  s = fold(s, ev('agent_spawned', { id: 'a1', name: 'a1', x: 1, y: 1, ageDays: 7300 }), config)
  const all = [
    ...house('structure_1', 2, 2),
    ...house('structure_2', 4, 2),
    ...house('structure_3', 6, 2),
    ...house('structure_4', 20, 2),
    ...house('structure_5', 0, 2, false),
  ]
  for (const e of all) s = fold(s, e, config)
  return s
}

function atTick(s: WorldState, tick: number): WorldState {
  return { ...s, tick }
}
function withWeather(s: WorldState, kind: string): WorldState {
  return { ...s, weather: { ...s.weather, kind } }
}
function ignite(s: WorldState, structureId: string, config = CFG): WorldState {
  return fold(s, ev('fire_ignited', { structureId, cause: 'lightning' }, s.tick), config)
}
function tickOnce(s: WorldState, config = CFG, rng = new RngStreams('t')): WorldTickResult {
  const wt = createWorldTick(config, rng)
  return wt(fold(s, ev('tick_advanced', {}, s.tick + 1), config))
}
function burningIds(s: WorldState): string[] {
  return Object.keys(s.structures)
    .sort()
    .filter((id) => s.structures[id]!.burning)
}

describe('fold: fire events', () => {
  it('fire_ignited sets burning, fire_extinguished clears it', () => {
    let s = ignite(rowWorld(), 'structure_1')
    expect(s.structures.structure_1!.burning).toBe(true)
    s = fold(s, ev('fire_extinguished', { structureId: 'structure_1', cause: 'doused' }), CFG)
    expect(s.structures.structure_1!.burning).toBe(false)
  })

  it('fire_spread sets the target burning', () => {
    const s = fold(
      ignite(rowWorld(), 'structure_1'),
      ev('fire_spread', { fromId: 'structure_1', toId: 'structure_2' }),
      CFG,
    )
    expect(s.structures.structure_2!.burning).toBe(true)
  })

  it('rejects unknown structures and bad causes', () => {
    const s = rowWorld()
    expect(() =>
      fold(s, ev('fire_ignited', { structureId: 'nope', cause: 'lightning' }), CFG),
    ).toThrow()
    expect(() =>
      fold(s, ev('fire_extinguished', { structureId: 'structure_1', cause: 'magic' }), CFG),
    ).toThrow()
  })
})

describe('fire: lightning ignition', () => {
  it('a storm hour with certain chance ignites every flammable structure', () => {
    const sure = SimConfigSchema.parse({
      weather: { hourlyChangeChance: 0, stormLightningFireChance: 1 },
    })
    const r = tickOnce(withWeather(atTick(rowWorld(sure), 59), 'storm'), sure)
    for (const id of ['structure_1', 'structure_2', 'structure_3', 'structure_4']) {
      expect(r.events).toContainEqual({
        type: 'fire_ignited',
        payload: { structureId: id, cause: 'lightning' },
      })
    }
    expect(burningIds(r.state)).toEqual([
      'structure_1',
      'structure_2',
      'structure_3',
      'structure_4',
    ])
    expect(r.state.structures.structure_5!.burning).toBe(false)
  })

  it('no ignition off the hour, outside storms, or at zero chance', () => {
    const sure = SimConfigSchema.parse({
      weather: { hourlyChangeChance: 0, stormLightningFireChance: 1 },
    })
    const offHour = tickOnce(withWeather(atTick(rowWorld(sure), 30), 'storm'), sure)
    expect(offHour.events.map((e) => e.type)).not.toContain('fire_ignited')
    const sunny = tickOnce(atTick(rowWorld(sure), 59), sure)
    expect(sunny.events.map((e) => e.type)).not.toContain('fire_ignited')
    const never = SimConfigSchema.parse({
      weather: { hourlyChangeChance: 0, stormLightningFireChance: 0 },
    })
    const zero = tickOnce(withWeather(atTick(rowWorld(never), 59), 'storm'), never)
    expect(zero.events.map((e) => e.type)).not.toContain('fire_ignited')
  })
})

describe('fire: spread', () => {
  const always = SimConfigSchema.parse({
    weather: { hourlyChangeChance: 0 },
    fire: { spreadChancePerTickAdjacent: 1 },
  })

  it('spreads only to adjacent flammable structures, one hop per tick', () => {
    const s = ignite(atTick(rowWorld(always), 1), 'structure_1', always)
    const r1 = tickOnce(s, always)
    expect(r1.events).toContainEqual({
      type: 'fire_spread',
      payload: { fromId: 'structure_1', toId: 'structure_2' },
    })
    expect(burningIds(r1.state)).toEqual(['structure_1', 'structure_2'])
    const r2 = tickOnce(r1.state, always)
    expect(r2.events).toContainEqual({
      type: 'fire_spread',
      payload: { fromId: 'structure_2', toId: 'structure_3' },
    })
    expect(burningIds(r2.state)).toEqual(['structure_1', 'structure_2', 'structure_3'])
    expect(r2.state.structures.structure_4!.burning).toBe(false)
    expect(r2.state.structures.structure_5!.burning).toBe(false)
  })

  // Seed 'f2' fire-stream draws: 0.4233, 0.4188. Exact outcomes at both multipliers — no statistics.
  it('storm multiplier slows spread during storms: exact seeded outcomes', () => {
    const spreadCfg = (stormSpreadMultiplier: number) =>
      SimConfigSchema.parse({
        weather: { hourlyChangeChance: 0 },
        fire: { spreadChancePerTickAdjacent: 0.5, stormSpreadMultiplier },
      })
    const run = (config: SimConfig) => {
      let s = ignite(withWeather(atTick(rowWorld(config), 1), 'storm'), 'structure_1', config)
      const rng = new RngStreams('f2')
      const events = []
      for (let i = 0; i < 2; i++) {
        const r = tickOnce(s, config, rng)
        s = r.state
        events.push(...r.events)
      }
      return { state: s, events }
    }
    const dry = run(spreadCfg(1)) // thresholds 0.5: both draws spread
    expect(dry.events).toContainEqual({
      type: 'fire_spread',
      payload: { fromId: 'structure_1', toId: 'structure_2' },
    })
    expect(dry.events).toContainEqual({
      type: 'fire_spread',
      payload: { fromId: 'structure_2', toId: 'structure_3' },
    })
    expect(burningIds(dry.state)).toEqual(['structure_1', 'structure_2', 'structure_3'])
    const wet = run(spreadCfg(0.2)) // thresholds 0.1: neither draw spreads
    expect(wet.events.map((e) => e.type)).not.toContain('fire_spread')
    expect(burningIds(wet.state)).toEqual(['structure_1'])
  })
})

describe('fire: burn damage and burnout', () => {
  const fast = SimConfigSchema.parse({
    weather: { hourlyChangeChance: 0 },
    fire: { burnTicksToDestroy: 4 },
  })

  function loneHouse(): WorldState {
    let s = genesisState(fast)
    s = fold(s, ev('agent_spawned', { id: 'a1', name: 'a1', x: 1, y: 1, ageDays: 7300 }), fast)
    for (const e of house('structure_1', 2, 2)) s = fold(s, e, fast)
    return atTick(s, 1)
  }

  it('destroys the structure after exactly burnTicksToDestroy ticks', () => {
    let s = ignite(loneHouse(), 'structure_1', fast)
    for (let i = 0; i < 3; i++) {
      const r = tickOnce(s, fast)
      expect(r.events).toContainEqual({
        type: 'structure_damaged',
        payload: { id: 'structure_1', amount: 12.5 },
      })
      expect(r.state.structures.structure_1).toBeDefined()
      s = r.state
    }
    expect(s.structures.structure_1!.hp).toBe(12.5)
    const last = tickOnce(s, fast)
    expect(last.events).toContainEqual({
      type: 'fire_extinguished',
      payload: { structureId: 'structure_1', cause: 'burnout' },
    })
    expect(last.events).toContainEqual({
      type: 'structure_damaged',
      payload: { id: 'structure_1', amount: 12.5 },
    })
    expect(last.state.structures.structure_1).toBeUndefined()
  })

  it('burnout destruction drops contained items onto the structure origin tile', () => {
    let s = ignite(loneHouse(), 'structure_1', fast)
    s = fold(
      s,
      ev(
        'item_spawned',
        { id: 'item_1', kind: 'wood', qty: 5, loc: { t: 'structure', id: 'structure_1' } },
        s.tick,
      ),
      fast,
    )
    s = fold(
      s,
      ev(
        'item_spawned',
        { id: 'item_2', kind: 'wheat', qty: 2, loc: { t: 'structure', id: 'structure_1' } },
        s.tick,
      ),
      fast,
    )
    for (let i = 0; i < 3; i++) s = tickOnce(s, fast).state
    const last = tickOnce(s, fast)
    expect(last.state.structures.structure_1).toBeUndefined()
    expect(last.events).toContainEqual({
      type: 'item_moved',
      payload: { id: 'item_1', loc: { t: 'tile', x: 2, y: 2 } },
    })
    expect(last.events).toContainEqual({
      type: 'item_moved',
      payload: { id: 'item_2', loc: { t: 'tile', x: 2, y: 2 } },
    })
    expect(last.state.items.item_1!.loc).toEqual({ t: 'tile', x: 2, y: 2 })
    expect(last.state.items.item_2!.loc).toEqual({ t: 'tile', x: 2, y: 2 })
  })

  it('rain douses every burning structure before it takes damage', () => {
    const s = withWeather(ignite(loneHouse(), 'structure_1', fast), 'rain')
    const r = tickOnce(s, fast)
    expect(r.events).toContainEqual({
      type: 'fire_extinguished',
      payload: { structureId: 'structure_1', cause: 'rain' },
    })
    expect(r.events.map((e) => e.type)).not.toContain('structure_damaged')
    expect(r.state.structures.structure_1!.burning).toBe(false)
  })
})

describe('verb: extinguish', () => {
  it('requires an adjacent burning structure', () => {
    const s = ignite(atTick(rowWorld(), 1), 'structure_1')
    expect(submitIntent(s, CFG, 'a1', 'extinguish', {}).ok).toBe(false)
    expect(submitIntent(s, CFG, 'a1', 'extinguish', { structureId: 'structure_2' }).ok).toBe(false) // not burning
    expect(submitIntent(s, CFG, 'a1', 'extinguish', { structureId: 'nope' }).ok).toBe(false)
    const far = ignite(s, 'structure_4')
    expect(submitIntent(far, CFG, 'a1', 'extinguish', { structureId: 'structure_4' }).ok).toBe(
      false,
    ) // out of reach
    expect(submitIntent(s, CFG, 'a1', 'extinguish', { structureId: 'structure_1' }).ok).toBe(true)
  })

  it('douses the fire and damage stops', () => {
    const s = ignite(atTick(rowWorld(), 1), 'structure_1')
    const r = submitIntent(s, CFG, 'a1', 'extinguish', { structureId: 'structure_1' })
    if (!r.ok) throw new Error(r.reason)
    let w = s
    for (const e of r.events) w = fold(w, ev(e.type, e.payload, w.tick), CFG)
    const t1 = tickOnce(w, CFG)
    expect(t1.events).toContainEqual({
      type: 'fire_extinguished',
      payload: { structureId: 'structure_1', cause: 'doused' },
    })
    expect(t1.state.structures.structure_1!.burning).toBe(false)
    const t2 = tickOnce(t1.state, CFG)
    expect(t2.events.map((e) => e.type)).not.toContain('structure_damaged')
  })
})

describe('verb: douse', () => {
  function withBucket(s: WorldState, charges: number, config = CFG): WorldState {
    return fold(
      s,
      ev(
        'item_spawned',
        {
          id: 'item_1',
          kind: 'bucket',
          qty: 1,
          loc: { t: 'agent', id: 'a1' },
          charges,
        },
        s.tick,
      ),
      config,
    )
  }
  function burning(charges: number | null): WorldState {
    const s = ignite(atTick(rowWorld(), 1), 'structure_1')
    return charges === null ? s : withBucket(s, charges)
  }

  it('a full bucket against a burning wall puts it out and comes back empty', () => {
    let s = burning(1)
    const r = submitIntent(s, CFG, 'a1', 'douse', { x: 2, y: 2 })
    if (!r.ok) throw new Error(r.reason)
    for (const e of r.events) s = fold(s, ev(e.type, e.payload, s.tick), CFG)
    const t = tickOnce(s, CFG)
    expect(t.events).toContainEqual({
      type: 'fire_extinguished',
      payload: { structureId: 'structure_1', cause: 'doused', x: 2, y: 2, agentId: 'a1' },
    })
    expect(t.events).toContainEqual({
      type: 'item_filled',
      payload: { itemId: 'item_1', charges: 0 },
    })
    expect(t.state.structures.structure_1!.burning).toBe(false)
    expect(t.state.items.item_1!.charges).toBe(0)
  })

  it('refuses an empty bucket, no bucket at all, unburnt ground, and a fire two tiles off', () => {
    const empty = submitIntent(burning(0), CFG, 'a1', 'douse', { x: 2, y: 2 })
    expect(empty.ok).toBe(false)
    if (!empty.ok) expect(empty.reason).toBe('the bucket is empty')
    expect(submitIntent(burning(null), CFG, 'a1', 'douse', { x: 2, y: 2 }).ok).toBe(false)
    expect(submitIntent(burning(1), CFG, 'a1', 'douse', { x: 4, y: 2 }).ok).toBe(false) // structure_2 is not alight
    const away = burning(1)
    const stepped = { ...away, agents: { a1: { ...away.agents.a1!, x: 0, y: 0 } } }
    expect(submitIntent(stepped, CFG, 'a1', 'douse', { x: 2, y: 2 }).ok).toBe(false)
  })

  it('a recorded C9 dousing still folds, and the widened payload survives the envelope', () => {
    const s = ignite(atTick(rowWorld(), 1), 'structure_1')
    const old = fold(
      s,
      ev('fire_extinguished', { structureId: 'structure_1', cause: 'rain' }, s.tick),
      CFG,
    )
    expect(old.structures.structure_1!.burning).toBe(false)
    const wide = { structureId: 'structure_1', cause: 'doused', x: 2, y: 2, agentId: 'a1' }
    const parsed = EventEnvelope.parse({
      seq: 1,
      tick: 1,
      type: 'fire_extinguished',
      payload: wide,
    })
    expect(parsed.payload).toEqual(wide)
    expect(fold(s, parsed as SimEvent, CFG).structures.structure_1!.burning).toBe(false)
    // The one field fold cannot do without: a dousing has to name what stopped burning.
    expect(() =>
      fold(s, ev('fire_extinguished', { cause: 'doused', x: 2, y: 2 }, s.tick), CFG),
    ).toThrow(/no structure/i)
  })
})

// ------------------------------------------------- a carried flame is a fire risk
describe('a carried flame is both the light and the hazard', () => {
  const SURE: SimConfig = SimConfigSchema.parse({
    weather: { hourlyChangeChance: 0 },
    light: { fireRiskPerTick: 1 },
  })
  const OFF: SimConfig = SimConfigSchema.parse({
    weather: { hourlyChangeChance: 0 },
    light: { fireRiskPerTick: 1, enabled: false },
  })

  // A torch on the ground at (1,2), which touches the flammable house structure_1 at (2,2) and
  // lies inside the unburnable structure_5 at (0,2).
  const torch = (config: SimConfig): WorldState => {
    const s = atTick(rowWorld(config), 1)
    return fold(
      s,
      ev(
        'item_spawned',
        {
          id: 'item_1',
          kind: 'torch',
          qty: 1,
          loc: { t: 'tile', x: 1, y: 2 },
        },
        s.tick,
      ),
      config,
    )
  }
  const alight = (config: SimConfig, until: number): WorldState => {
    const s = torch(config)
    return fold(s, ev('item_lit', { itemId: 'item_1', burnsUntilTick: until }, s.tick), config)
  }

  it('sets the house it lies against alight on a certain roll, and nothing else', () => {
    const r = tickOnce(alight(SURE, 9999), SURE)
    expect(r.events).toContainEqual({
      type: 'fire_ignited',
      payload: { structureId: 'structure_1', cause: 'a carried flame' },
    })
    expect(burningIds(r.state)).toEqual(['structure_1'])
  })

  it('never rolls for a torch nobody struck, or one whose fuel is gone', () => {
    expect(burningIds(tickOnce(torch(SURE), SURE).state)).toEqual([])
    expect(burningIds(tickOnce(alight(SURE, 0), SURE).state)).toEqual([])
  })

  it('with the light law off, a lit torch is just a light', () => {
    expect(burningIds(tickOnce(alight(OFF, 9999), OFF).state)).toEqual([])
  })
})

// `sources` is captured before the spread loop and every emit inside it folds, so a
// source can be gone by the time its turn comes. The non-null assertion made that a crash.
describe('fire_spread: a source that is gone by its turn is skipped, not crashed on', () => {
  it('survives a structure removed mid-loop, and still spreads from the ones still standing', () => {
    let state = ignite(ignite(rowWorld(), 'structure_1'), 'structure_3')
    const emitted: Array<{ type: string; payload: unknown }> = []
    const ctx = {
      config: { ...CFG, fire: { ...CFG.fire, spreadChancePerTickAdjacent: 1 } },
      rng: new RngStreams('ghost'),
      state: () => state,
      emit: (type: string, payload: unknown) => {
        emitted.push({ type, payload })
        // The hazard, made to happen: the first spread takes the second source with it.
        if (type === 'fire_spread' && state.structures.structure_3 !== undefined) {
          const { structure_3: _gone, ...rest } = state.structures
          state = { ...state, structures: rest }
          return
        }
        state = fold(state, ev(type, payload, state.tick), CFG)
      },
    }
    expect(() => fireSystem(ctx)).not.toThrow()
    // The fire that was still standing did spread; the ghost was passed over in silence.
    expect(
      emitted.some(
        (e) =>
          e.type === 'fire_spread' && (e.payload as { fromId: string }).fromId === 'structure_1',
      ),
    ).toBe(true)
    expect(
      emitted.some(
        (e) =>
          e.type === 'fire_spread' && (e.payload as { fromId: string }).fromId === 'structure_3',
      ),
    ).toBe(false)
  })
})

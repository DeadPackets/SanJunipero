import { describe, it, expect } from 'vitest'
import { DAYS_PER_YEAR, SimConfigSchema, stateHash, type SimConfig, type SimEvent } from '@sj/shared'
import { fold } from '../fold.js'
import { composePerception } from '../perception.js'
import { RngStreams } from '../rng.js'
import { genesisState, type TileId, type WorldState } from '../state.js'
import { createWorldTick } from '../worldTick.js'
import { DEATH_CAUSES, dominantDrain, type DeathCause } from './mortality.js'

const CFG: SimConfig = SimConfigSchema.parse({ weather: { hourlyChangeChance: 0 }, mystery: { chancePerDay: 0 } })
const OFF: SimConfig = SimConfigSchema.parse({
  weather: { hourlyChangeChance: 0 }, mystery: { chancePerDay: 0 }, mortality: { enabled: false },
})
const NO_GRAVE: SimConfig = SimConfigSchema.parse({
  weather: { hourlyChangeChance: 0 }, mystery: { chancePerDay: 0 }, mortality: { graveEnabled: false },
})

let seq = 80000
const ev = (type: string, payload: unknown, tick = 0): SimEvent => ({ seq: seq++, tick, type, payload })
const map = (): TileId[][] => Array.from({ length: 16 }, () => Array.from({ length: 16 }, (): TileId => 0))

function body(config = CFG): WorldState {
  return fold(genesisState(config, map()), ev('agent_spawned', { id: 'a1', name: 'a1', x: 2, y: 2, ageDays: 7300 }), config)
}
const afflict = (s: WorldState, kind: string, severity: number, tick = 0, extra: Record<string, unknown> = {}) =>
  fold(s, ev('agent_afflicted', { agentId: 'a1', kind, severity, ...extra }, tick), CFG)

function tickOnce(s: WorldState, config = CFG, rng = new RngStreams('m')) {
  const advanced = fold({ ...s, tick: s.tick }, ev('tick_advanced', {}, s.tick + 1), config)
  return createWorldTick(config, rng)(advanced)
}
const hpDeltas = (r: { events: Array<{ type: string; payload: unknown }> }) =>
  r.events.filter((e) => e.type === 'hp_changed').map((e) => (e.payload as { delta: number }).delta)

describe('fold: the afflicted body', () => {
  it('is absent until the first affliction, and absent again after the last one lifts', () => {
    const clean = body()
    expect(clean.agents.a1!.afflictions).toBeUndefined()
    const ill = afflict(clean, 'illness', 2, 40)
    expect(ill.agents.a1!.afflictions).toEqual([{ kind: 'illness', severity: 2, sinceTick: 40 }])
    const well = fold(ill, ev('affliction_recovered', { agentId: 'a1', kind: 'illness' }, 90), CFG)
    expect(well.agents.a1!.afflictions).toBeUndefined()
    expect(Object.keys(well.agents.a1!)).not.toContain('afflictions')
    expect(stateHash(well)).toBe(stateHash(clean))
  })

  it('merges a second affliction of the same kind, summing severity and keeping the earlier onset', () => {
    let s = afflict(body(), 'poison', 1, 30)
    s = afflict(s, 'poison', 2, 900)
    expect(s.agents.a1!.afflictions).toEqual([{ kind: 'poison', severity: 3, sinceTick: 30 }])
  })

  it('keeps the list in a canonical order, so two bodies with the same afflictions hash alike', () => {
    const a = afflict(afflict(body(), 'poison', 1, 10), 'illness', 1, 10)
    const b = afflict(afflict(body(), 'illness', 1, 10), 'poison', 1, 10)
    expect(a.agents.a1!.afflictions!.map((x) => x.kind)).toEqual(['illness', 'poison'])
    expect(stateHash(a)).toBe(stateHash(b))
  })

  it('worsens and recovers by kind, leaving the others alone', () => {
    let s = afflict(afflict(body(), 'illness', 2, 10), 'injury', 1, 10)
    s = fold(s, ev('affliction_worsened', { agentId: 'a1', kind: 'illness', severity: 4 }), CFG)
    expect(s.agents.a1!.afflictions).toEqual([
      { kind: 'illness', severity: 4, sinceTick: 10 }, { kind: 'injury', severity: 1, sinceTick: 10 },
    ])
    s = fold(s, ev('affliction_recovered', { agentId: 'a1', kind: 'illness' }), CFG)
    expect(s.agents.a1!.afflictions).toEqual([{ kind: 'injury', severity: 1, sinceTick: 10 }])
  })

  it('refuses to worsen or lift something the body does not have, or to name a kind that is not one', () => {
    const s = body()
    expect(() => fold(s, ev('affliction_worsened', { agentId: 'a1', kind: 'illness', severity: 2 }), CFG))
      .toThrow(/no illness/)
    expect(() => fold(s, ev('affliction_recovered', { agentId: 'a1', kind: 'poison' }), CFG)).toThrow(/no poison/)
    expect(() => fold(s, ev('agent_afflicted', { agentId: 'a1', kind: 'sadness', severity: 1 }), CFG)).toThrow()
    expect(() => fold(s, ev('agent_afflicted', { agentId: 'ghost', kind: 'illness', severity: 1 }), CFG))
      .toThrow(/unknown agent/i)
  })

  it('agent_harmed takes the hp it names and never takes a body below zero', () => {
    let s = fold(body(), ev('agent_harmed', { agentId: 'a1', amount: 30, source: 'attack', byId: 'a2' }), CFG)
    expect(s.agents.a1!.hp).toBe(70)
    s = fold(s, ev('agent_harmed', { agentId: 'a1', amount: 500, source: 'fire' }), CFG)
    expect(s.agents.a1!.hp).toBe(0)
    expect(() => fold(s, ev('agent_harmed', { agentId: 'a1', amount: 1, source: 'meteor' }), CFG)).toThrow()
  })

  // The hand that did it stays on the body — a death has to be able to name it a tick later.
  // What it was carried in does not: the itemId is the log's business, not the flesh's.
  it('keeps the hand behind the affliction and drops the vessel it came in', () => {
    const s = afflict(body(), 'poison', 1, 5, { sourceId: 'a2', itemId: 'item_9' })
    expect(s.agents.a1!.afflictions).toEqual([{ kind: 'poison', severity: 1, sinceTick: 5, sourceId: 'a2' }])
    const anon = afflict(body(), 'poison', 1, 5)
    expect(Object.keys(anon.agents.a1!.afflictions![0]!)).not.toContain('sourceId')
  })

  it('a second dose keeps the first hand, and a first hand can arrive with the second dose', () => {
    let s = afflict(body(), 'injury', 1, 5, { sourceId: 'a2' })
    s = afflict(s, 'injury', 1, 9, { sourceId: 'a3' })
    expect(s.agents.a1!.afflictions).toEqual([{ kind: 'injury', severity: 2, sinceTick: 5, sourceId: 'a2' }])
    let t = afflict(body(), 'injury', 1, 5)
    t = afflict(t, 'injury', 1, 9, { sourceId: 'a3' })
    expect(t.agents.a1!.afflictions).toEqual([{ kind: 'injury', severity: 2, sinceTick: 5, sourceId: 'a3' }])
  })
})

describe('mortalitySystem: the drain is arithmetic, never a roll', () => {
  it('drains drainPerTick x severity, to the digit', () => {
    const r = tickOnce(afflict(body(), 'illness', 2, 0))
    expect(hpDeltas(r)).toEqual([-0.16])
  })

  it('sums every affliction into one hp_changed', () => {
    const s = afflict(afflict(body(), 'illness', 2, 0), 'poison', 1, 0)
    expect(hpDeltas(tickOnce(s))).toEqual([-(0.08 * 2 + 0.12)])
  })

  it('adds the hunger drain when the belly is empty, and not before', () => {
    const fed = fold(body(), ev('need_changed', { id: 'a1', need: 'hunger', delta: -99 }), CFG)
    expect(hpDeltas(tickOnce(fed))).toEqual([])
    const starving = fold(body(), ev('need_changed', { id: 'a1', need: 'hunger', delta: -100 }), CFG)
    expect(hpDeltas(tickOnce(starving))).toEqual([-0.1])
  })

  it('says nothing about a body with nothing wrong with it', () => {
    expect(hpDeltas(tickOnce(body()))).toEqual([])
  })

  it('leaves the dead alone and obeys its flag', () => {
    let dead = afflict(body(), 'illness', 2, 0)
    dead = fold(dead, ev('agent_died', { agentId: 'a1', cause: 'health' }), CFG)
    expect(hpDeltas(tickOnce(dead))).toEqual([])
    expect(hpDeltas(tickOnce(afflict(body(OFF), 'illness', 2, 0), OFF))).toEqual([])
  })

  it('spends no randomness at all: the same tick on two seeds is the same tick', () => {
    const s = afflict(body(), 'fatigue', 3, 0)
    const rngA = new RngStreams('one'), rngB = new RngStreams('two')
    const a = createWorldTick(CFG, rngA)(fold(s, ev('tick_advanced', {}, 1), CFG))
    const b = createWorldTick(CFG, rngB)(fold(s, ev('tick_advanced', {}, 1), CFG))
    expect(hpDeltas(a)).toEqual([-0.12])
    expect(hpDeltas(a)).toEqual(hpDeltas(b))
  })

  it('folding the tick\'s own events reproduces the state it returned', () => {
    const s = afflict(afflict(body(), 'illness', 1, 0), 'injury', 2, 0)
    const advanced = fold(s, ev('tick_advanced', {}, 1), CFG)
    const out = createWorldTick(CFG, new RngStreams('m'))(advanced)
    let replayed = advanced
    for (const e of out.events) replayed = fold(replayed, ev(e.type, e.payload, 1), CFG)
    expect(stateHash(replayed)).toBe(stateHash(out.state))
  })
})

// ---------------------------------------------------------------- Task 6: cause and grave
const hurt = (s: WorldState, amount: number) =>
  fold(s, ev('agent_harmed', { agentId: 'a1', amount, source: 'accident' }), CFG)
const starve = (s: WorldState) => fold(s, ev('need_changed', { id: 'a1', need: 'hunger', delta: -100 }), CFG)
const died = (r: { events: Array<{ type: string; payload: unknown }> }) =>
  r.events.find((e) => e.type === 'agent_died')?.payload
const graveOf = (s: WorldState) => Object.values(s.structures).find((x) => x.kind === 'grave')

// Less than one tick of the SMALLEST drain any row below applies, so one tick is a death with a
// name on it. Derived, not a literal: a hardcoded 0.1 silently stopped being a sliver.
const SLIVER = 0.01
const nearlyDead = (s: WorldState) => hurt(s, CFG.health.maxHp - SLIVER)

// One tick of drain on a body with a sliver of hp left is a death with a name on it.
const SCENARIOS: Array<[DeathCause, () => WorldState]> = [
  ['injury', () => nearlyDead(afflict(body(), 'injury', 2, 0))],
  ['slain', () => nearlyDead(afflict(body(), 'injury', 2, 0, { sourceId: 'a2' }))],
  ['poison', () => nearlyDead(afflict(body(), 'poison', 1, 0))],
  ['illness', () => nearlyDead(afflict(body(), 'illness', 2, 0))],
  ['fatigue', () => nearlyDead(afflict(body(), 'fatigue', 3, 0))],
  ['hunger', () => nearlyDead(starve(body()))],
  ['thirst', () => {
    const s = nearlyDead(body())
    return { ...s, agents: { ...s.agents, a1: { ...s.agents.a1!, thirst: 0 } } }
  }],
  // The same fatigue rung, on a body the cold has been billing. Task 22: the ladder is the
  // only road the cold takes, so the drain is identical and only the name changes.
  ['exposure', () => {
    const s = nearlyDead(afflict(body(), 'fatigue', 3, 0))
    return { ...s, agents: { ...s.agents, a1: { ...s.agents.a1!, coldTicksSinceRecovery: 4 } } }
  }],
]
// Wired by a later task that owns the field the drain reads. The alarm is the assertion below.
const PENDING: Partial<Record<DeathCause, string>> = {}

describe('death has a cause', () => {
  it('an attack-sourced wound makes the death a slaying, and names the hand', () => {
    expect(died(tickOnce(nearlyDead(afflict(body(), 'injury', 2, 0, { sourceId: 'a2' })))))
      .toEqual({ agentId: 'a1', cause: 'slain', byId: 'a2' })
  })

  it('the same wound with nobody behind it is an injury, and carries no hand at all', () => {
    const p = died(tickOnce(nearlyDead(afflict(body(), 'injury', 2, 0))))
    expect(p).toEqual({ agentId: 'a1', cause: 'injury' })
    expect(Object.keys(p as object)).not.toContain('byId')
  })

  it('an empty belly kills as hunger, both by the drain and by the long-starvation clock', () => {
    expect(died(tickOnce(nearlyDead(starve(body()))))).toEqual({ agentId: 'a1', cause: 'hunger' })
    const long = { ...starve(body()), tick: 2000 }
    expect(died(tickOnce({ ...long, agents: { a1: { ...long.agents.a1!, zeroHungerSinceTick: 0 } } })))
      .toEqual({ agentId: 'a1', cause: 'hunger' })
  })

  it('a body worn to nothing with no affliction on it still names the wound', () => {
    // The C1 path: a wound drops hp with no named affliction behind it.
    let s = fold(body(), ev('agent_harmed', {
      agentId: 'a1', amount: CFG.health.injuryDamage.grave, source: 'attack',
    }), CFG)
    s = fold(s, ev('agent_injured', { agentId: 'a1', kind: 'grave' }), CFG)
    s = hurt(s, 40)
    expect(died(tickOnce(s))).toEqual({ agentId: 'a1', cause: 'injury' })
  })

  it('breaks equal drains by seniority, then by the order of the cause list', () => {
    // The pair the tiebreak needs: two kinds whose drains are the same number, to the bit.
    expect(CFG.mortality.drainPerTick.fatigue * 2).toBe(CFG.mortality.drainPerTick.illness)
    const older = (first: string, fs: number, second: string, ss: number) =>
      nearlyDead(afflict(afflict(body(), first, fs, 5), second, ss, 40))
    expect(died(tickOnce(older('fatigue', 2, 'illness', 1)))).toMatchObject({ cause: 'fatigue' })
    expect(died(tickOnce(older('illness', 1, 'fatigue', 2)))).toMatchObject({ cause: 'illness' })
    // Same drain, same onset: 'illness' precedes 'fatigue' in DEATH_CAUSES.
    const tied = nearlyDead(afflict(afflict(body(), 'fatigue', 2, 5), 'illness', 1, 5))
    expect(died(tickOnce(tied))).toMatchObject({ cause: 'illness' })
  })

  it('dominantDrain is the one attribution, and it agrees with what the tick emits', () => {
    const s = nearlyDead(afflict(afflict(body(), 'poison', 1, 5), 'illness', 1, 5))
    expect(dominantDrain(s, CFG, 'a1')).toBe('poison')
    expect(died(tickOnce(s))).toMatchObject({ cause: 'poison' })
  })

  it('produces every cause in DEATH_CAUSES, or names the task that will', () => {
    const produced = new Set<string>()
    for (const [, make] of SCENARIOS) {
      const p = died(tickOnce(make())) as { cause: string } | undefined
      if (p) produced.add(p.cause)
    }
    const elder = { ...body(), tick: 1439 }
    elder.agents.a1 = { ...elder.agents.a1!, ageDays: 60 * DAYS_PER_YEAR }
    const p = died(tickOnce(elder, CFG, new RngStreams('ag87'))) as { cause: string } | undefined
    if (p) produced.add(p.cause)
    for (const cause of DEATH_CAUSES) {
      if (PENDING[cause] !== undefined) continue
      expect([cause, produced.has(cause)]).toEqual([cause, true])
    }
    expect(Object.keys(PENDING).sort()).toEqual([])
  })

  it('names each scenario the cause the table says it does', () => {
    for (const [cause, make] of SCENARIOS) {
      expect([cause, died(tickOnce(make()))]).toMatchObject([cause, { agentId: 'a1', cause }])
    }
  })
})

describe('a grave where the life ended', () => {
  it('stands on the death tile, complete, unowned and unburnable', () => {
    const r = tickOnce(nearlyDead(afflict(body(), 'illness', 2, 0)))
    expect(r.events).toContainEqual({
      type: 'grave_placed', payload: { id: 'structure_1', agentId: 'a1', name: 'a1', x: 2, y: 2 },
    })
    const g = graveOf(r.state)!
    expect({ x: g.x, y: g.y, w: g.w, h: g.h }).toEqual({ x: 2, y: 2, w: 1, h: 1 })
    expect(g.stage).toBe('complete')
    expect(g.hp).toBe(g.maxHp)
    expect(g.maxHp).toBe(CFG.structures.recipes.grave!.maxHp)
    expect(g.flammable).toBe(false)
    expect(g.builtBy).toBeNull()
    expect(Object.keys(g)).not.toContain('owner')
  })

  it('steps to the ring-nearest free tile when the ground it fell on is taken', () => {
    let s = afflict(body(), 'illness', 2, 0)
    s = fold(s, ev('structure_planned', {
      id: 'structure_9', kind: 'shed', x: 2, y: 2, w: 1, h: 1, maxHp: 20, flammable: true, builderId: 'a1',
    }), CFG)
    const g = graveOf(tickOnce(nearlyDead(s)).state)!
    expect({ x: g.x, y: g.y }).toEqual({ x: 3, y: 3 })
  })

  it('places none when the world says graves are off, and buries the old just the same', () => {
    const off = tickOnce(nearlyDead(afflict(body(NO_GRAVE), 'illness', 2, 0)), NO_GRAVE)
    expect(off.events.map((e) => e.type)).not.toContain('grave_placed')
    expect(graveOf(off.state)).toBeUndefined()

    const elder = { ...body(), tick: 1439 }
    elder.agents.a1 = { ...elder.agents.a1!, ageDays: 60 * DAYS_PER_YEAR }
    const r = tickOnce(elder, CFG, new RngStreams('ag87'))
    expect(died(r)).toEqual({ agentId: 'a1', cause: 'old_age' })
    expect(graveOf(r.state)).toBeDefined()
  })

  it('folding the death tick reproduces the state it returned, grave and all', () => {
    const s = nearlyDead(afflict(body(), 'illness', 2, 0))
    const advanced = fold(s, ev('tick_advanced', {}, 1), CFG)
    const out = createWorldTick(CFG, new RngStreams('m'))(advanced)
    let replayed = advanced
    for (const e of out.events) replayed = fold(replayed, ev(e.type, e.payload, 1), CFG)
    expect(stateHash(replayed)).toBe(stateHash(out.state))
    expect(graveOf(out.state)).toBeDefined()
  })
})

// ------------------------------------------------- Task 9: the collapse ladder gets a floor
describe('a collapse that never recovers becomes fatigue', () => {
  // Hunger under collapseThreshold puts the body down; raising it lifts the collapse so the
  // next fall is a fresh one. Nothing here feeds the body — that is the whole point.
  const hunger = (s: WorldState, delta: number, tick: number, config = CFG) =>
    fold(s, ev('need_changed', { id: 'a1', need: 'hunger', delta }, tick), config)
  const fatigueOf = (s: WorldState) => s.agents.a1!.afflictions?.find((x) => x.kind === 'fatigue')?.severity

  // Down: hunger under collapseThreshold, and the tick puts the body on the ground.
  // Up: hunger back over it, which is a nudge, not a meal — the ladder does not reset.
  function fall(s: WorldState, tick: number, config = CFG): WorldState {
    const down = hunger({ ...s, tick }, -(s.agents.a1!.needs.hunger - 1), tick, config)
    return tickOnce({ ...down, tick }, config).state
  }
  const rise = (s: WorldState, tick: number, config = CFG) => hunger(s, 50, tick, config)

  it('escalates one step for every collapse the body never came back from', () => {
    let s = body()
    const seen: Array<number | undefined> = []
    for (let i = 0; i < 3; i++) {
      s = fall(s, 10 + i * 10)
      seen.push(fatigueOf(s))
      s = rise(s, 11 + i * 10)
    }
    expect(seen).toEqual([1, 2, 3])
    expect(s.agents.a1!.collapsesWithoutRecovery).toBe(3)
  })

  it('starts the ladder over for a body that ate between falls', () => {
    let s = rise(fall(body(), 10), 11)
    s = rise(fall(s, 20), 21)
    expect(fatigueOf(s)).toBe(2)
    s = fold(s, ev('action_completed', { agentId: 'a1', verb: 'eat' }, 22), CFG)
    expect(s.agents.a1!.collapsesWithoutRecovery).toBeUndefined()
    expect(fatigueOf(fall(s, 30))).toBe(1)
  })

  it('starts the ladder over for a body that slept between falls', () => {
    let s = rise(fall(body(), 10), 11)
    expect(fatigueOf(s)).toBe(1)
    s = fold(s, ev('agent_slept', { agentId: 'a1' }, 12), CFG)
    expect(s.agents.a1!.collapsesWithoutRecovery).toBeUndefined()
    s = fold(s, ev('agent_woke', { agentId: 'a1' }, 13), CFG)
    expect(fatigueOf(fall(s, 20))).toBe(1)
  })

  it('keeps the counter absent on a body that never went down, and while mortality is off', () => {
    expect(body().agents.a1!.collapsesWithoutRecovery).toBeUndefined()
    const off = fall(body(OFF), 10, OFF)
    expect(off.agents.a1!.collapsesWithoutRecovery).toBeUndefined()
    expect(fatigueOf(off)).toBeUndefined()
    expect(stateHash(off)).toBe(stateHash(fall(body(OFF), 10, OFF)))
  })

  it('drains hp at the fatigue rate, and the sleepless body dies naming fatigue', () => {
    const two = afflict(body(), 'fatigue', 2, 0)
    expect(hpDeltas(tickOnce(two))).toEqual([-(CFG.mortality.drainPerTick.fatigue * 2)])
    expect(died(tickOnce(nearlyDead(afflict(body(), 'fatigue', 3, 0))))).toEqual({ agentId: 'a1', cause: 'fatigue' })
  })
})

describe('perception: a body knows what ails it, not when it started', () => {
  it('carries kind and severity, and no tick', () => {
    const s = afflict(afflict(body(), 'poison', 1, 33), 'illness', 2, 33)
    const p = composePerception(s, CFG, 'a1', [])
    expect(p.self.body.afflictions).toEqual([{ kind: 'illness', severity: 2 }, { kind: 'poison', severity: 1 }])
    for (const a of p.self.body.afflictions) expect(Object.keys(a)).not.toContain('sinceTick')
  })

  it('is an empty list on a body with nothing wrong with it', () => {
    expect(composePerception(body(), CFG, 'a1', []).self.body.afflictions).toEqual([])
  })
})

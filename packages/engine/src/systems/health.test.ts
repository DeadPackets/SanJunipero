import { describe, it, expect } from 'vitest'
import { SimConfigSchema, type SimConfig } from '@sj/shared'
import { genesisState, type TileId, type WorldState } from '../state.js'
import { fold } from '../fold.js'
import { submitIntent } from '../intent.js'
import { VERBS } from '../verbs/index.js'
import { RngStreams } from '../rng.js'
import { createWorldTick, type WorldTickResult } from '../worldTick.js'
import { ev, roundTrips } from '../testutil/world.js'

const CFG: SimConfig = SimConfigSchema.parse({})
const DAWN = 360 // hour 6, minute 0

function makeWorld(
  config = CFG,
  agents: { id: string; x: number; y: number }[] = [{ id: 'a1', x: 0, y: 0 }],
): WorldState {
  let s = genesisState(
    config,
    Array.from({ length: 16 }, () => Array.from({ length: 16 }, (): TileId => 0)),
  )
  for (const a of agents)
    s = fold(
      s,
      ev('agent_spawned', { id: a.id, name: a.id, x: a.x, y: a.y, ageDays: 7300 }),
      config,
    )
  return s
}
function patchAgent(
  s: WorldState,
  id: string,
  patch: Partial<WorldState['agents'][string]>,
): WorldState {
  return { ...s, agents: { ...s.agents, [id]: { ...s.agents[id]!, ...patch } } }
}
function atTick(s: WorldState, tick: number): WorldState {
  return { ...s, tick }
}
function applyAll(
  s: WorldState,
  events: { type: string; payload: unknown }[],
  config = CFG,
  tick = s.tick,
): WorldState {
  for (const e of events) s = fold(s, ev(e.type, e.payload, tick), config)
  return s
}
function tickOnce(s: WorldState, config = CFG, rng = new RngStreams('t')): WorldTickResult {
  const wt = createWorldTick(config, rng)
  return wt(fold(s, ev('tick_advanced', {}, s.tick + 1), config))
}

// The pair `attack` emits, so a test that wants a wound gets the hp loss with it.
function wound(
  s: WorldState,
  agentId: string,
  kind: 'minor' | 'serious' | 'grave',
  tick?: number,
): WorldState {
  const at = tick ?? s.tick
  const hurtEv = ev(
    'agent_harmed',
    { agentId, amount: CFG.health.injuryDamage[kind], source: 'attack' },
    at,
  )
  return fold(fold(s, hurtEv, CFG), ev('agent_injured', { agentId, kind }, at), CFG)
}

describe('fold: health events', () => {
  // A blow is two events and one subtraction: `agent_harmed` takes the hp and is the only event
  // that can name the hand behind it; `agent_injured` puts the wound on the record.
  it('agent_injured records the injury day, and the hp comes off through agent_harmed', () => {
    let s = makeWorld()
    s = wound(s, 'a1', 'minor', 2885)
    expect(s.agents.a1!.hp).toBe(90)
    expect(s.agents.a1!.injuries).toEqual([{ kind: 'minor', day: 2 }])
    s = wound(s, 'a1', 'serious', 2885)
    expect(s.agents.a1!.hp).toBe(60)
    s = wound(s, 'a1', 'grave', 2885)
    expect(s.agents.a1!.hp).toBe(0)
    expect(s.agents.a1!.injuries).toHaveLength(3)
    // The record alone takes nothing: one subtraction, and it is the other event's.
    const recorded = fold(makeWorld(), ev('agent_injured', { agentId: 'a1', kind: 'grave' }), CFG)
    expect(recorded.agents.a1!.hp).toBe(100)
    expect(() => fold(s, ev('agent_injured', { agentId: 'ghost', kind: 'minor' }), CFG)).toThrow(
      /unknown agent/i,
    )
  })

  it('agent_infected and agent_fell_ill set ill; agent_recovered clears it', () => {
    let s = makeWorld()
    s = fold(s, ev('agent_infected', { agentId: 'a1' }), CFG)
    expect(s.agents.a1!.ill).toBe(true)
    s = fold(s, ev('agent_recovered', { agentId: 'a1' }), CFG)
    expect(s.agents.a1!.ill).toBe(false)
    s = fold(s, ev('agent_fell_ill', { agentId: 'a1' }), CFG)
    expect(s.agents.a1!.ill).toBe(true)
    expect(() => fold(s, ev('agent_infected', { agentId: 'ghost' }), CFG)).toThrow(/unknown agent/i)
  })

  it('agent_tended stamps tendedTick with the event tick', () => {
    let s = makeWorld()
    expect(s.agents.a1!.tendedTick).toBeUndefined()
    s = fold(s, ev('agent_tended', { agentId: 'a1' }, 77), CFG)
    expect(s.agents.a1!.tendedTick).toBe(77)
  })

  it('hp_changed clamps to [0, maxHp]', () => {
    let s = patchAgent(makeWorld(), 'a1', { hp: 95 })
    s = fold(s, ev('hp_changed', { agentId: 'a1', delta: 10 }), CFG)
    expect(s.agents.a1!.hp).toBe(100)
    s = fold(s, ev('hp_changed', { agentId: 'a1', delta: -250 }), CFG)
    expect(s.agents.a1!.hp).toBe(0)
    expect(() => fold(s, ev('hp_changed', { agentId: 'ghost', delta: 1 }), CFG)).toThrow(
      /unknown agent/i,
    )
  })

  it('hp_changed clears collapsedSinceTick only when hp and needs are back above thresholds', () => {
    let s = patchAgent(makeWorld(), 'a1', { hp: 10, collapsedSinceTick: 3 })
    s = fold(s, ev('hp_changed', { agentId: 'a1', delta: 2 }), CFG)
    expect(s.agents.a1!.collapsedSinceTick).toBe(3) // 12 still below collapseHp 15
    s = fold(s, ev('hp_changed', { agentId: 'a1', delta: 50 }), CFG)
    expect(s.agents.a1!.collapsedSinceTick).toBeNull()
    let low = patchAgent(makeWorld(), 'a1', {
      hp: 10,
      collapsedSinceTick: 3,
      needs: { hunger: 0, energy: 100, warmth: 100, social: 100 },
    })
    low = fold(low, ev('hp_changed', { agentId: 'a1', delta: 50 }), CFG)
    expect(low.agents.a1!.collapsedSinceTick).toBe(3) // hunger still below threshold
  })
})

describe('verb: tend', () => {
  const trio = makeWorld(CFG, [
    { id: 'a1', x: 0, y: 0 },
    { id: 'a2', x: 1, y: 1 },
    { id: 'a3', x: 5, y: 5 },
  ])

  it('is registered with the medicine skill', () => {
    expect(VERBS.tend!.kind).toBe('tend')
    expect(VERBS.tend!.skill).toEqual({ track: 'medicine', xp: 1 })
  })

  it('validates params, target, self, adjacency, and that there is something to tend', () => {
    expect(submitIntent(trio, CFG, 'a2', 'tend', {}).ok).toBe(false)
    expect(submitIntent(trio, CFG, 'a2', 'tend', { targetId: 'ghost' }).ok).toBe(false)
    expect(submitIntent(trio, CFG, 'a2', 'tend', { targetId: 'a1' }).ok).toBe(false) // a1 is healthy
    const hurt = patchAgent(trio, 'a1', { hp: 50 })
    expect(submitIntent(hurt, CFG, 'a2', 'tend', { targetId: 'a1' }).ok).toBe(true) // diagonal is adjacent
    expect(submitIntent(hurt, CFG, 'a3', 'tend', { targetId: 'a1' }).ok).toBe(false) // too far
    const selfHurt = patchAgent(trio, 'a2', { hp: 50 })
    expect(submitIntent(selfHurt, CFG, 'a2', 'tend', { targetId: 'a2' }).ok).toBe(false)
    const illFullHp = patchAgent(trio, 'a1', { ill: true })
    expect(submitIntent(illFullHp, CFG, 'a2', 'tend', { targetId: 'a1' }).ok).toBe(true)
  })
})

// `agent_infected` still folds for a recorded log; nothing emits it any more, and what a septic
// wound produces is an illness affliction — see systems/illness.test.ts.
describe("worldTick: infection is not healthSystem's any more", () => {
  it('an open wound at dawn infects nobody here, on the seed that used to', () => {
    let s = makeWorld()
    s = wound(s, 'a1', 'minor')
    const r = tickOnce(atTick(s, DAWN - 1), CFG, new RngStreams('h3'))
    expect(r.events.map((e) => e.type)).not.toContain('agent_infected')
    expect(r.state.agents.a1!.ill).toBe(false)
  })
})

// `agent_fell_ill` still folds for recorded logs, but nothing emits it: illnessSystem owns
// contagion.
describe("worldTick: contagion is not healthSystem's any more", () => {
  it('an ill body beside a healthy one infects nobody, at any dial', () => {
    let s = makeWorld(CFG, [
      { id: 'a1', x: 0, y: 0 },
      { id: 'a2', x: 1, y: 0 },
      { id: 'a3', x: 10, y: 0 },
    ])
    s = fold(s, ev('agent_fell_ill', { agentId: 'a1' }), CFG)
    for (let i = 0; i < 50; i++) s = tickOnce(s, CFG, new RngStreams(`c${i}`)).state
    expect(s.agents.a2!.ill).toBe(false)
    expect(s.agents.a3!.ill).toBe(false)
  })
})

describe('worldTick: recovery and tend', () => {
  it('tended recovery beats natural: tendedRecoveryHpPerDay vs recoveryHpPerDay at dawn', () => {
    let s = makeWorld(CFG, [
      { id: 'a1', x: 0, y: 0 },
      { id: 'a2', x: 1, y: 0 },
    ])
    s = patchAgent(s, 'a1', { hp: 50 })
    s = patchAgent(s, 'a2', { hp: 50 })
    s = atTick(s, DAWN - 6)
    const r = submitIntent(s, CFG, 'a2', 'tend', { targetId: 'a1' })
    if (!r.ok) throw new Error(r.reason)
    s = applyAll(s, r.events)
    let last: WorldTickResult | null = null
    for (let i = 0; i < 6; i++) {
      last = tickOnce(s)
      s = last.state
    }
    // The hour of care lands three ticks in, and dawn pays it at the tended rate x tendMultiplier.
    expect(s.agents.a1!.tendedTick).toBe(DAWN - 3)
    expect(last!.events).toContainEqual({
      type: 'hp_changed',
      payload: {
        agentId: 'a1',
        delta: CFG.health.tendedRecoveryHpPerDay * CFG.mortality.tendMultiplier,
      },
    })
    expect(last!.events).toContainEqual({
      type: 'hp_changed',
      payload: { agentId: 'a2', delta: 5 },
    })
    expect(s.agents.a1!.hp).toBe(80)
    expect(s.agents.a2!.hp).toBe(55)
  })

  it('rest and a full belly are the other two ways back', () => {
    const asleep = tickOnce(
      atTick(patchAgent(makeWorld(), 'a1', { hp: 50, asleep: true }), DAWN - 1),
    )
    expect(asleep.events).toContainEqual({
      type: 'hp_changed',
      payload: {
        agentId: 'a1',
        delta: CFG.health.recoveryHpPerDay * CFG.mortality.sleepRegenMultiplier,
      },
    })

    const fed = tickOnce(
      atTick(
        patchAgent(makeWorld(), 'a1', {
          hp: 50,
          needs: { hunger: CFG.mortality.fedThreshold + 1, energy: 100, warmth: 100, social: 100 },
        }),
        DAWN - 1,
      ),
    )
    expect(fed.events).toContainEqual({ type: 'hp_changed', payload: { agentId: 'a1', delta: 5 } })

    const hungry = tickOnce(
      atTick(
        patchAgent(makeWorld(), 'a1', {
          hp: 50,
          needs: { hunger: CFG.mortality.fedThreshold - 1, energy: 100, warmth: 100, social: 100 },
        }),
        DAWN - 1,
      ),
    )
    expect(hungry.events.map((e) => e.type)).not.toContain('hp_changed')
  })

  it('leaves C9 recovery exactly as it was when the world has mortality switched off', () => {
    const OFF = SimConfigSchema.parse({ mortality: { enabled: false } })
    const s = atTick(
      patchAgent(makeWorld(OFF), 'a1', {
        hp: 50,
        asleep: true,
        needs: { hunger: 1, energy: 100, warmth: 100, social: 100 },
      }),
      DAWN - 1,
    )
    expect(tickOnce(s, OFF).events).toContainEqual({
      type: 'hp_changed',
      payload: { agentId: 'a1', delta: 5 },
    })
  })

  it('ill clears with agent_recovered when hp is back at max', () => {
    const s = atTick(patchAgent(makeWorld(), 'a1', { hp: 96, ill: true }), DAWN - 1)
    const r = tickOnce(s)
    expect(r.events).toContainEqual({ type: 'hp_changed', payload: { agentId: 'a1', delta: 5 } })
    expect(r.events).toContainEqual({ type: 'agent_recovered', payload: { agentId: 'a1' } })
    expect(r.state.agents.a1!.hp).toBe(100)
    expect(r.state.agents.a1!.ill).toBe(false)
  })
})

describe('worldTick: hp floor (Task 6 integration)', () => {
  it('injuries driving hp under collapseHp collapse the agent; hp at deathHp kills', () => {
    let s = makeWorld()
    s = wound(s, 'a1', 'grave')
    s = wound(s, 'a1', 'serious')
    const t1 = tickOnce(s) // hp 10 < collapseHp 15
    expect(t1.events).toContainEqual({ type: 'agent_collapsed', payload: { agentId: 'a1' } })
    expect(t1.state.agents.a1!.collapsedSinceTick).toBe(t1.state.tick)

    const dead = wound(s, 'a1', 'minor')
    const t2 = tickOnce(dead) // hp 0 <= deathHp
    expect(t2.events).toContainEqual({
      type: 'agent_died',
      payload: { agentId: 'a1', cause: 'injury' },
    })
    expect(t2.state.agents.a1!.alive).toBe(false)
  })
})

describe('worldTick: health replay safety', () => {
  it('folding the returned events over the input reproduces the returned state', () => {
    let s = makeWorld(CFG, [
      { id: 'a1', x: 0, y: 0 },
      { id: 'a2', x: 2, y: 0 },
    ])
    s = wound(s, 'a1', 'serious')
    s = fold(s, ev('agent_fell_ill', { agentId: 'a2' }), CFG)
    const { replayed, out } = roundTrips(atTick(s, DAWN - 1), CFG, 'h3')
    expect(out.events.length).toBeGreaterThan(0)
    expect(replayed).toEqual(out.state)
  })
})

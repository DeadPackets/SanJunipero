import { describe, it, expect } from 'vitest'
import { SimConfigSchema, type SimConfig, type SimEvent } from '@sj/shared'
import { genesisState, type TileId, type WorldState } from '../state.js'
import { fold } from '../fold.js'
import { RngStreams } from '../rng.js'
import { createWorldTick, type WorldTickResult } from '../worldTick.js'

const CFG: SimConfig = SimConfigSchema.parse({ weather: { hourlyChangeChance: 0 } })

let seq = 30000
const ev = (type: string, payload: unknown, tick = 0): SimEvent => ({
  seq: seq++,
  tick,
  type,
  payload,
})

function makeWorld(
  config = CFG,
  agents: { id: string; x: number; y: number }[] = [
    { id: 'a1', x: 0, y: 0 },
    { id: 'a2', x: 1, y: 0 },
  ],
): WorldState {
  let s = genesisState(
    config,
    Array.from({ length: 32 }, () => Array.from({ length: 32 }, (): TileId => 0)),
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
function tickOnce(s: WorldState, config = CFG, rng = new RngStreams('t')): WorldTickResult {
  const wt = createWorldTick(config, rng)
  return wt(fold(s, ev('tick_advanced', {}, s.tick + 1), config))
}

// needsSystem runs at tick = s.tick + 1 (after tick_advanced).
const REGEN = CFG.needs.socialRegenConversingPerTick // 0.5
const DECAY = CFG.needs.socialDecayPerTick // 0.018

describe('fold: agent_spoke', () => {
  it('stamps lastSpokeTick on the speaking agent', () => {
    let s = makeWorld()
    s = fold(s, ev('agent_spoke', { agentId: 'a1', text: 'hi', x: 0, y: 0 }, 42), CFG)
    expect(s.agents.a1!.lastSpokeTick).toBe(42)
    expect(s.agents.a2!.lastSpokeTick).toBeUndefined()
    expect(() =>
      fold(s, ev('agent_spoke', { agentId: 'ghost', text: 'x', x: 0, y: 0 }, 1), CFG),
    ).toThrow(/unknown agent/i)
  })
})

describe('worldTick: social regen via conversation', () => {
  it('regen when two adjacent agents spoke recently', () => {
    let s = atTick(makeWorld(), 100)
    s = patchAgent(s, 'a1', { needs: { ...s.agents.a1!.needs, social: 50 }, lastSpokeTick: 95 })
    s = patchAgent(s, 'a2', { needs: { ...s.agents.a2!.needs, social: 50 }, lastSpokeTick: 95 })
    const res = tickOnce(s)
    expect(res.state.agents.a1!.needs.social).toBeCloseTo(50 + REGEN, 5)
    expect(res.state.agents.a2!.needs.social).toBeCloseTo(50 + REGEN, 5)
  })

  it('either party speaking regenerates both', () => {
    let s = atTick(makeWorld(), 100)
    s = patchAgent(s, 'a1', { needs: { ...s.agents.a1!.needs, social: 50 }, lastSpokeTick: 95 })
    s = patchAgent(s, 'a2', { needs: { ...s.agents.a2!.needs, social: 50 } })
    const res = tickOnce(s)
    expect(res.state.agents.a1!.needs.social).toBeCloseTo(50 + REGEN, 5)
    expect(res.state.agents.a2!.needs.social).toBeCloseTo(50 + REGEN, 5)
  })

  it('decays when no one spoke recently', () => {
    let s = atTick(makeWorld(), 100)
    s = patchAgent(s, 'a1', { needs: { ...s.agents.a1!.needs, social: 50 } })
    s = patchAgent(s, 'a2', { needs: { ...s.agents.a2!.needs, social: 50 } })
    const res = tickOnce(s)
    expect(res.state.agents.a1!.needs.social).toBeCloseTo(50 - DECAY, 5)
    expect(res.state.agents.a2!.needs.social).toBeCloseTo(50 - DECAY, 5)
  })

  it('decays when out of earshot even if both spoke', () => {
    let s = atTick(
      makeWorld(CFG, [
        { id: 'a1', x: 0, y: 0 },
        { id: 'a2', x: 15, y: 15 },
      ]),
      100,
    )
    s = patchAgent(s, 'a1', { needs: { ...s.agents.a1!.needs, social: 50 }, lastSpokeTick: 95 })
    s = patchAgent(s, 'a2', { needs: { ...s.agents.a2!.needs, social: 50 }, lastSpokeTick: 95 })
    const res = tickOnce(s)
    expect(res.state.agents.a1!.needs.social).toBeCloseTo(50 - DECAY, 5)
    expect(res.state.agents.a2!.needs.social).toBeCloseTo(50 - DECAY, 5)
  })

  it('recency boundary: spoke exactly window ticks ago regenerates, window+1 decays', () => {
    const window = CFG.needs.socialRegenRecencyTicks
    const tick = 100
    const checkTick = tick + 1 // needsSystem runs one tick after tick_advanced
    let inWindow = atTick(makeWorld(), tick)
    inWindow = patchAgent(inWindow, 'a1', {
      needs: { ...inWindow.agents.a1!.needs, social: 50 },
      lastSpokeTick: checkTick - window,
    })
    inWindow = patchAgent(inWindow, 'a2', { needs: { ...inWindow.agents.a2!.needs, social: 50 } })
    expect(tickOnce(inWindow).state.agents.a1!.needs.social).toBeCloseTo(50 + REGEN, 5)

    let stale = atTick(makeWorld(), tick)
    stale = patchAgent(stale, 'a1', {
      needs: { ...stale.agents.a1!.needs, social: 50 },
      lastSpokeTick: checkTick - window - 1,
    })
    stale = patchAgent(stale, 'a2', { needs: { ...stale.agents.a2!.needs, social: 50 } })
    expect(tickOnce(stale).state.agents.a1!.needs.social).toBeCloseTo(50 - DECAY, 5)
  })

  it('honors a configured recency window', () => {
    const short = SimConfigSchema.parse({
      weather: { hourlyChangeChance: 0 },
      needs: { socialRegenRecencyTicks: 10 },
    })
    const tick = 100
    const checkTick = tick + 1
    let s = atTick(makeWorld(short), tick)
    s = patchAgent(s, 'a1', {
      needs: { ...s.agents.a1!.needs, social: 50 },
      lastSpokeTick: checkTick - 10,
    })
    s = patchAgent(s, 'a2', { needs: { ...s.agents.a2!.needs, social: 50 } })
    expect(tickOnce(s, short).state.agents.a1!.needs.social).toBeCloseTo(
      50 + short.needs.socialRegenConversingPerTick,
      5,
    )

    let stale = atTick(makeWorld(short), tick)
    stale = patchAgent(stale, 'a1', {
      needs: { ...stale.agents.a1!.needs, social: 50 },
      lastSpokeTick: checkTick - 11,
    })
    stale = patchAgent(stale, 'a2', { needs: { ...stale.agents.a2!.needs, social: 50 } })
    expect(tickOnce(stale, short).state.agents.a1!.needs.social).toBeCloseTo(
      50 - short.needs.socialDecayPerTick,
      5,
    )
  })

  it('regen is clamped at 100', () => {
    let s = atTick(makeWorld(), 100)
    s = patchAgent(s, 'a1', { needs: { ...s.agents.a1!.needs, social: 99.8 }, lastSpokeTick: 95 })
    s = patchAgent(s, 'a2', { needs: { ...s.agents.a2!.needs, social: 50 }, lastSpokeTick: 95 })
    const res = tickOnce(s)
    expect(res.state.agents.a1!.needs.social).toBe(100)
  })
})

// Winter is not a backdrop: it takes more out of a body than any other season.
describe('winter scarcity: hunger', () => {
  const WINTER = 273 * 1440 // first winter day
  const hungerDeltaAt = (tick: number, config = CFG): number => {
    const s = atTick(makeWorld(config, [{ id: 'a1', x: 0, y: 0 }]), tick)
    const changed = tickOnce(s, config).events.find(
      (e) => e.type === 'need_changed' && (e.payload as { need: string }).need === 'hunger',
    )
    return (changed!.payload as { delta: number }).delta
  }

  it('decays hunger by base × 1.25 exactly through winter', () => {
    expect(CFG.seasons.winter.hungerDecayMultiplier).toBe(1.25)
    expect(hungerDeltaAt(WINTER)).toBeCloseTo(-CFG.needs.hungerDecayPerTick * 1.25, 10)
  })

  it('leaves every other season at the base rate', () => {
    for (const tick of [1440, 91 * 1440, 182 * 1440]) {
      expect(hungerDeltaAt(tick)).toBeCloseTo(-CFG.needs.hungerDecayPerTick, 10)
    }
  })

  it('follows the dial, not a constant', () => {
    const harsh = SimConfigSchema.parse({
      weather: { hourlyChangeChance: 0 },
      seasons: { winter: { hungerDecayMultiplier: 3 } },
    })
    expect(hungerDeltaAt(WINTER, harsh)).toBeCloseTo(-harsh.needs.hungerDecayPerTick * 3, 10)
  })
})

// Age is not only a number on the body: an old frame gives out sooner each waking hour.
describe('elder energy', () => {
  const YEAR = 364 // DAYS_PER_YEAR
  const BASE = CFG.needs.energyDecayAwakePerTick

  const energyDeltaAt = (ageDays: number, config = CFG): number => {
    let s = makeWorld(config, [{ id: 'a1', x: 0, y: 0 }])
    s = patchAgent(s, 'a1', { ageDays })
    const changed = tickOnce(s, config).events.find(
      (e) => e.type === 'need_changed' && (e.payload as { need: string }).need === 'energy',
    )
    return (changed!.payload as { delta: number }).delta
  }

  it('an elder tires by base × 1.2 exactly', () => {
    expect(CFG.aging.elderEnergyDecayMultiplier).toBe(1.2)
    expect(energyDeltaAt(CFG.aging.elderFromYears * YEAR)).toBeCloseTo(-BASE * 1.2, 10)
  })

  it('adults and children are untouched — the toll starts at the elder line', () => {
    expect(energyDeltaAt(CFG.aging.elderFromYears * YEAR - 1)).toBeCloseTo(-BASE, 10)
    expect(energyDeltaAt(30 * YEAR)).toBeCloseTo(-BASE, 10)
    expect(energyDeltaAt(10 * YEAR)).toBeCloseTo(-BASE, 10)
  })

  it('follows the dial, not a constant', () => {
    const frail = SimConfigSchema.parse({
      weather: { hourlyChangeChance: 0 },
      aging: { elderEnergyDecayMultiplier: 4 },
    })
    expect(energyDeltaAt(frail.aging.elderFromYears * YEAR, frail)).toBeCloseTo(-BASE * 4, 10)
  })

  it('sleep still restores at the flat rate — the toll is on waking hours only', () => {
    let s = makeWorld(CFG, [{ id: 'a1', x: 0, y: 0 }])
    s = patchAgent(s, 'a1', {
      ageDays: CFG.aging.elderFromYears * YEAR,
      asleep: true,
      needs: { ...s.agents.a1!.needs, energy: 50 },
    })
    const changed = tickOnce(s).events.find(
      (e) => e.type === 'need_changed' && (e.payload as { need: string }).need === 'energy',
    )
    expect((changed!.payload as { delta: number }).delta).toBeCloseTo(
      CFG.needs.energyRegenAsleepPerTick,
      10,
    )
  })
})

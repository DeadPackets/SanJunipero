import { describe, it, expect } from 'vitest'
import { SimConfigSchema, type SimConfig, type SimEvent } from '@sj/shared'
import { genesisState, type TileId, type WorldState } from '../state.js'
import { fold } from '../fold.js'
import { RngStreams } from '../rng.js'
import { createWorldTick, type WorldTickResult } from '../worldTick.js'

const CFG: SimConfig = SimConfigSchema.parse({ weather: { hourlyChangeChance: 0 } })

let seq = 30000
const ev = (type: string, payload: unknown, tick = 0): SimEvent => ({ seq: seq++, tick, type, payload })

function makeWorld(config = CFG, agents: Array<{ id: string; x: number; y: number }> = [{ id: 'a1', x: 0, y: 0 }, { id: 'a2', x: 1, y: 0 }]): WorldState {
  let s = genesisState(config, Array.from({ length: 32 }, () => Array.from({ length: 32 }, (): TileId => 0)))
  for (const a of agents) s = fold(s, ev('agent_spawned', { id: a.id, name: a.id, x: a.x, y: a.y, ageDays: 7300 }), config)
  return s
}
function patchAgent(s: WorldState, id: string, patch: Partial<WorldState['agents'][string]>): WorldState {
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
    expect(() => fold(s, ev('agent_spoke', { agentId: 'ghost', text: 'x', x: 0, y: 0 }, 1), CFG)).toThrow(/unknown agent/i)
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
    let s = atTick(makeWorld(CFG, [{ id: 'a1', x: 0, y: 0 }, { id: 'a2', x: 15, y: 15 }]), 100)
    s = patchAgent(s, 'a1', { needs: { ...s.agents.a1!.needs, social: 50 }, lastSpokeTick: 95 })
    s = patchAgent(s, 'a2', { needs: { ...s.agents.a2!.needs, social: 50 }, lastSpokeTick: 95 })
    const res = tickOnce(s)
    expect(res.state.agents.a1!.needs.social).toBeCloseTo(50 - DECAY, 5)
    expect(res.state.agents.a2!.needs.social).toBeCloseTo(50 - DECAY, 5)
  })

  it('60-tick boundary: spoke 60 ticks ago regenerates, 61 ticks ago decays', () => {
    let inWindow = atTick(makeWorld(), 100)
    inWindow = patchAgent(inWindow, 'a1', { needs: { ...inWindow.agents.a1!.needs, social: 50 }, lastSpokeTick: 41 }) // 101-41 = 60
    inWindow = patchAgent(inWindow, 'a2', { needs: { ...inWindow.agents.a2!.needs, social: 50 } })
    const regen = tickOnce(inWindow)
    expect(regen.state.agents.a1!.needs.social).toBeCloseTo(50 + REGEN, 5)

    let stale = atTick(makeWorld(), 100)
    stale = patchAgent(stale, 'a1', { needs: { ...stale.agents.a1!.needs, social: 50 }, lastSpokeTick: 40 }) // 101-40 = 61
    stale = patchAgent(stale, 'a2', { needs: { ...stale.agents.a2!.needs, social: 50 } })
    const decay = tickOnce(stale)
    expect(decay.state.agents.a1!.needs.social).toBeCloseTo(50 - DECAY, 5)
  })

  it('regen is clamped at 100', () => {
    let s = atTick(makeWorld(), 100)
    s = patchAgent(s, 'a1', { needs: { ...s.agents.a1!.needs, social: 99.8 }, lastSpokeTick: 95 })
    s = patchAgent(s, 'a2', { needs: { ...s.agents.a2!.needs, social: 50 }, lastSpokeTick: 95 })
    const res = tickOnce(s)
    expect(res.state.agents.a1!.needs.social).toBe(100)
  })
})

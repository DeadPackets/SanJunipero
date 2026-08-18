import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, type SimEvent } from '@sj/shared'
import { genesisState, type WorldState } from '@sj/engine/state'
import { describeEvent, isNarratable } from './chronicleFormat.js'

function fixtureState(): WorldState {
  const s = genesisState(DEFAULT_CONFIG)
  s.agents['farmer'] = {
    id: 'farmer', name: 'Wren', x: 1, y: 1, alive: true, asleep: false,
    needs: { hunger: 80, energy: 80, warmth: 80, social: 80 },
    hp: 10, injuries: [], ill: false, ageDays: 7300, skills: {},
    activity: null, collapsedSinceTick: null, zeroHungerSinceTick: null,
  }
  s.structures['s1'] = {
    id: 's1', kind: 'storehouse', x: 2, y: 2, w: 2, h: 2, hp: 20, maxHp: 20,
    flammable: true, stage: 'complete', progressTicks: 0, builtBy: 'farmer', burning: false, burnTicks: 0,
  }
  return s
}

const ev = (type: string, payload: unknown): SimEvent => ({ seq: 1, tick: 100, type, payload })

describe('describeEvent', () => {
  const state = fixtureState()

  it('renders speech, death, and completion with resolved names', () => {
    expect(describeEvent(ev('agent_spoke', { agentId: 'farmer', text: 'The wheat is in.', x: 1, y: 1 }), state))
      .toBe('Wren: "The wheat is in."')
    expect(describeEvent(ev('agent_died', { agentId: 'farmer', cause: 'hunger' }), state))
      .toBe('Wren starved.')
    expect(describeEvent(ev('structure_completed', { id: 's1' }), state))
      .toBe('The storehouse is finished.')
  })

  it('covers the remaining viewer-worthy subset', () => {
    expect(describeEvent(ev('structure_planned', { id: 's2', kind: 'hut', x: 0, y: 0, w: 2, h: 2, maxHp: 20, flammable: true, builderId: 'farmer' }), state))
      .toBe('Wren began a hut.')
    expect(describeEvent(ev('crop_planted', { id: 'c1', kind: 'wheat', x: 0, y: 0, plantedDay: 0 }), state))
      .toBe('wheat was planted.')
    expect(describeEvent(ev('fire_ignited', { structureId: 's1', cause: 'lightning' }), state))
      .toBe('Fire! The storehouse is burning.')
    expect(describeEvent(ev('weather_changed', { kind: 'rain', temperatureC: 10 }), state))
      .toBe('The weather turned rain.')
    expect(describeEvent(ev('agent_collapsed', { agentId: 'farmer' }), state)).toBe('Wren collapsed.')
    expect(describeEvent(ev('agent_tended', { agentId: 'farmer' }), state)).toBe('Someone sat with Wren.')
    expect(describeEvent(ev('action_completed', { agentId: 'farmer', verb: 'give' }), state))
      .toBe('Wren gave something away.')
  })

  it('hides plumbing and unknown future event types', () => {
    expect(describeEvent(ev('tick_advanced', {}), state)).toBeNull()
    expect(describeEvent(ev('agent_moved', { id: 'farmer', x: 1, y: 2 }), state)).toBeNull()
    expect(describeEvent(ev('action_completed', { agentId: 'farmer', verb: 'fish' }), state)).toBeNull()
    expect(describeEvent(ev('some_future_event', { anything: 1 }), state)).toBeNull()
  })
})

describe('isNarratable — the predicate the recent-event ring is filtered by (M1)', () => {
  it('keeps what the chronicle can put into words', () => {
    expect(isNarratable(ev('agent_spoke', { agentId: 'farmer', text: 'hm' }))).toBe(true)
    expect(isNarratable(ev('agent_died', { agentId: 'farmer', cause: 'hunger' }))).toBe(true)
    expect(isNarratable(ev('structure_completed', { id: 's1' }))).toBe(true)
  })

  it('drops the plumbing that filled the ring and left the panel empty', () => {
    expect(isNarratable(ev('need_changed', { agentId: 'farmer', need: 'hunger', value: 79 }))).toBe(false)
    expect(isNarratable(ev('tick_advanced', {}))).toBe(false)
    expect(isNarratable(ev('agent_moved', { id: 'farmer', x: 1, y: 2 }))).toBe(false)
  })

  it('agrees with describeEvent whatever the world state is', () => {
    const state = fixtureState()
    for (const e of [
      ev('agent_spoke', { agentId: 'farmer', text: 'hm' }),
      ev('need_changed', { agentId: 'farmer', need: 'hunger', value: 79 }),
      ev('action_completed', { agentId: 'farmer', verb: 'give' }),
      ev('action_completed', { agentId: 'farmer', verb: 'fish' }),
    ]) {
      expect(isNarratable(e)).toBe(describeEvent(e, state) !== null)
    }
  })
})

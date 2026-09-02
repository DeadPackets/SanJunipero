import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, type SimEvent } from '@sj/shared'
import { fold } from './fold.js'
import { composePerception } from './perception.js'
import { genesisState, type TileId, type WorldState } from './state.js'

// What a minted verb leaves in the world reaches the eyes the way everything else does.

const NOON = 12 * 60
let seq = 1
const ev = (type: string, payload: unknown, tick = NOON): SimEvent => ({
  seq: seq++,
  tick,
  type,
  payload,
})

function town(): WorldState {
  const rows = Array.from({ length: 40 }, () => Array.from({ length: 40 }, (): TileId => 0))
  let s = genesisState(DEFAULT_CONFIG, rows)
  s = fold(s, ev('tick_advanced', {}), DEFAULT_CONFIG)
  const at = (type: string, payload: unknown): void => {
    s = fold(s, ev(type, payload), DEFAULT_CONFIG)
  }
  at('agent_spawned', { id: 'a', name: 'Amara', x: 5, y: 5, ageDays: 9000, sex: 'f' })
  at('agent_spawned', { id: 'b', name: 'Omar', x: 7, y: 5, ageDays: 9000, sex: 'm' })
  at('agent_spawned', { id: 'far', name: 'Yusuf', x: 35, y: 35, ageDays: 9000, sex: 'm' })
  at('structure_planned', {
    id: 'structure_1',
    kind: 'well',
    x: 6,
    y: 7,
    w: 1,
    h: 1,
    maxHp: 10,
    flammable: false,
    builderId: 'a',
  })
  at('item_spawned', { id: 'item_1', kind: 'plank', qty: 2, loc: { t: 'tile', x: 5, y: 6 } })
  at('item_spawned', { id: 'item_2', kind: 'axe', qty: 1, loc: { t: 'agent', id: 'a' } })
  return s
}

describe('marks a minted verb left', () => {
  it('ride the packet on the person, the building and the thing that carry them', () => {
    let s = town()
    s = fold(s, ev('marked', { on: 'agent', id: 'b', key: 'debt', value: 'two planks' }))
    s = fold(s, ev('marked', { on: 'structure', id: 'structure_1', key: 'keeper', value: 'Omar' }))
    s = fold(s, ev('marked', { on: 'item', id: 'item_1', key: 'promised', value: 'to Omar' }))
    s = fold(s, ev('marked', { on: 'item', id: 'item_2', key: 'sworn', value: 'never sold' }))
    const packet = composePerception(s, DEFAULT_CONFIG, 'a', [])
    expect(packet.visible.agents.find((x) => x.id === 'b')?.marks).toEqual({ debt: 'two planks' })
    expect(packet.visible.structures[0]?.marks).toEqual({ keeper: 'Omar' })
    expect(packet.visible.items.find((i) => i.id === 'item_1')?.marks).toEqual({
      promised: 'to Omar',
    })
    expect(packet.self.inventory[0]?.marks).toEqual({ sworn: 'never sold' })
  })

  it('are absent from an unmarked town, so its packet reads as it always did', () => {
    const packet = composePerception(town(), DEFAULT_CONFIG, 'a', [])
    expect(JSON.stringify(packet)).not.toContain('marks')
  })
})

describe('a witnessed act', () => {
  const toast = (radius?: number): SimEvent =>
    ev('agent_expressed', {
      agentId: 'b',
      verb: 'recipe:toast',
      x: 7,
      y: 5,
      sense: 'sight',
      label: 'raises a cup to the room',
      ...(radius === undefined ? {} : { radius }),
    })

  it('is seen in the words its charter gave it', () => {
    const packet = composePerception(town(), DEFAULT_CONFIG, 'a', [toast()])
    expect(packet.seen).toEqual([
      {
        kind: 'expression',
        actorName: 'Omar',
        verb: 'recipe:toast',
        sense: 'sight',
        label: 'raises a cup to the room',
      },
    ])
  })

  it('carries exactly as far as its radius says', () => {
    expect(composePerception(town(), DEFAULT_CONFIG, 'a', [toast(1)]).seen).toEqual([])
    expect(composePerception(town(), DEFAULT_CONFIG, 'a', [toast(2)]).seen).toHaveLength(1)
    expect(composePerception(town(), DEFAULT_CONFIG, 'far', [toast(30)]).seen).toEqual([])
  })
})

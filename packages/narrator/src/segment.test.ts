import { describe, expect, it } from 'vitest'
import type { SimEvent } from '@sj/shared'
import { DEFAULT_SEGMENT_CONFIG, eventAgentIds, eventLocation, segmentScenes } from './segment.js'

const ev = (seq: number, tick: number, type: string, payload: unknown = {}): SimEvent => ({
  seq,
  tick,
  type,
  payload,
})

describe('segmentScenes', () => {
  it('splits on silence gaps longer than silenceTicks', () => {
    const events = [
      ev(1, 0, 'agent_spoke', { agentId: 'a', text: 'hi', x: 0, y: 0 }),
      ev(2, 1, 'agent_spoke', { agentId: 'b', text: 'ho', x: 0, y: 0 }),
      ev(3, 2, 'agent_spoke', { agentId: 'a', text: 'hm', x: 0, y: 0 }),
      ev(4, 33, 'agent_spoke', { agentId: 'a', text: 'later', x: 0, y: 0 }),
      ev(5, 34, 'agent_spoke', { agentId: 'b', text: 'yes', x: 0, y: 0 }),
    ]
    const scenes = segmentScenes(events)
    expect(scenes).toHaveLength(2)
    expect(scenes[0]!.eventIds).toEqual([1, 2, 3])
    expect(scenes[1]!.eventIds).toEqual([4, 5])
    expect(scenes[0]!.startTick).toBe(0)
    expect(scenes[0]!.endTick).toBe(2)
    expect(scenes[0]!.day).toBe(0)
  })

  it('drops scenes below minEvents', () => {
    const events = [
      ev(1, 0, 'agent_spoke', { agentId: 'a', text: 'alone', x: 0, y: 0 }),
      ev(2, 100, 'agent_spoke', { agentId: 'a', text: 'one', x: 0, y: 0 }),
      ev(3, 101, 'agent_spoke', { agentId: 'b', text: 'two', x: 0, y: 0 }),
    ]
    const scenes = segmentScenes(events)
    expect(scenes).toHaveLength(1)
    expect(scenes[0]!.eventIds).toEqual([2, 3])
  })

  it('day rollover always ends a scene even without silence', () => {
    const events = [
      ev(1, 1438, 'agent_spoke', { agentId: 'a', text: 'x', x: 0, y: 0 }),
      ev(2, 1439, 'agent_spoke', { agentId: 'a', text: 'x', x: 0, y: 0 }),
      ev(3, 1440, 'agent_spoke', { agentId: 'a', text: 'x', x: 0, y: 0 }),
      ev(4, 1441, 'agent_spoke', { agentId: 'a', text: 'x', x: 0, y: 0 }),
    ]
    const scenes = segmentScenes(events)
    expect(scenes).toHaveLength(2)
    expect(scenes[0]!.eventIds).toEqual([1, 2])
    expect(scenes[0]!.day).toBe(0)
    expect(scenes[1]!.eventIds).toEqual([3, 4])
    expect(scenes[1]!.day).toBe(1)
  })

  it('splits at the maxTicks cap in an unbroken run', () => {
    const events = Array.from({ length: 251 }, (_, i) =>
      ev(i + 1, i, 'agent_spoke', { agentId: 'a', text: 'x', x: 0, y: 0 }),
    )
    const scenes = segmentScenes(events)
    expect(scenes).toHaveLength(2)
    expect(scenes[0]!.startTick).toBe(0)
    expect(scenes[0]!.endTick).toBe(DEFAULT_SEGMENT_CONFIG.maxTicks)
    expect(scenes[1]!.startTick).toBe(DEFAULT_SEGMENT_CONFIG.maxTicks + 1)
    expect(scenes[0]!.eventIds.length + scenes[1]!.eventIds.length).toBe(251)
  })

  it('harvests cast per event type and takes the LAST location-bearing event', () => {
    const events = [
      ev(1, 0, 'agent_spoke', { agentId: 'omar', text: 'hi', x: 3, y: 4 }),
      ev(2, 1, 'agent_moved', { id: 'yusuf', x: 5, y: 6 }),
    ]
    const scenes = segmentScenes(events)
    expect(scenes).toHaveLength(1)
    expect(scenes[0]!.cast).toEqual(['omar', 'yusuf'])
    expect(scenes[0]!.location).toBe('5,6')
  })

  it('bare id on structure/item/crop events never enters the cast', () => {
    const events = [
      ev(1, 0, 'structure_completed', { id: 'house-1' }),
      ev(2, 1, 'crop_harvested', { cropId: 'crop-1' }),
      ev(3, 2, 'structure_planned', {
        id: 'house-2',
        kind: 'house',
        x: 1,
        y: 1,
        w: 1,
        h: 1,
        maxHp: 10,
        flammable: true,
        builderId: 'omar',
      }),
      ev(4, 3, 'needs_changed', { id: 'nadia', changes: [{ need: 'hunger', delta: -1 }] }),
    ]
    const scenes = segmentScenes(events)
    expect(scenes).toHaveLength(1)
    expect(scenes[0]!.cast).toEqual(['omar', 'nadia'])
  })
})

describe('extraction helpers', () => {
  it('eventAgentIds follows the per-type field map', () => {
    expect(eventAgentIds(ev(1, 0, 'agent_spoke', { agentId: 'a', text: 't', x: 0, y: 0 }))).toEqual(
      ['a'],
    )
    expect(
      eventAgentIds(ev(1, 0, 'agent_spawned', { id: 'a', name: 'A', x: 0, y: 0, ageDays: 1 })),
    ).toEqual(['a'])
    expect(eventAgentIds(ev(1, 0, 'structure_completed', { id: 's1' }))).toEqual([])
    expect(eventAgentIds(ev(1, 0, 'structure_planned', { id: 's1', builderId: 'b' }))).toEqual([
      'b',
    ])
    expect(
      eventAgentIds(ev(1, 0, 'item_moved', { id: 'i1', loc: { t: 'agent', id: 'a' } })),
    ).toEqual([])
  })

  it('eventLocation returns numeric x/y or null', () => {
    expect(eventLocation(ev(1, 0, 'agent_moved', { id: 'a', x: 5, y: 6 }))).toEqual({ x: 5, y: 6 })
    expect(
      eventLocation(ev(1, 0, 'tile_changed', { x: 2, y: 3, from: 0, to: 1, reason: 'tilled' })),
    ).toEqual({ x: 2, y: 3 })
    expect(eventLocation(ev(1, 0, 'structure_completed', { id: 's1' }))).toBeNull()
    expect(eventLocation(ev(1, 0, 'agent_died', { agentId: 'a', cause: 'age' }))).toBeNull()
  })
})

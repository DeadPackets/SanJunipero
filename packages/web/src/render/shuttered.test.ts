import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { SimEvent } from '@sj/shared'
import { NO_SHUTTERS, SHUTTERED_GLOW, foldShutters, isShuttered } from './shuttered.js'
import { subjectFor } from '../ui/directorCut.js'
import { rendersOnMap } from './characters.js'

const src = (f: string): string => readFileSync(new URL(f, import.meta.url), 'utf8')

let seq = 0
const ev = (tick: number, type: string, payload: Record<string, unknown>): SimEvent => ({
  seq: ++seq,
  tick,
  type,
  payload,
})
const lie = (tick: number, agentId: string, targetId: string, duration = 60): SimEvent =>
  ev(tick, 'action_started', { agentId, verb: 'lie_with', params: { targetId }, duration })

// Both bodies are under the same roof — the engine will not let the act start otherwise.
const inHouse = (id: string): string | undefined =>
  id === 'amara' || id === 'yusuf' ? 'house_1' : undefined

describe('★ a house with the door shut', () => {
  it('shuts for the length of the act and opens when it runs out', () => {
    const shut = foldShutters(NO_SHUTTERS, [lie(100, 'amara', 'yusuf')], inHouse)
    expect(isShuttered(shut, 'house_1', 100)).toBe(true)
    expect(isShuttered(shut, 'house_1', 159)).toBe(true)
    expect(isShuttered(shut, 'house_1', 160), 'the hour is up').toBe(false)
    expect(isShuttered(shut, 'house_2', 100)).toBe(false)
  })

  it('stays shut while the other body is still lying there, and opens on the last one', () => {
    const both = foldShutters(
      NO_SHUTTERS,
      [lie(100, 'amara', 'yusuf'), lie(100, 'yusuf', 'amara')],
      inHouse,
    )
    const one = foldShutters(both, [ev(130, 'action_completed', { agentId: 'amara' })], inHouse)
    expect(isShuttered(one, 'house_1', 131), 'yusuf has not got up').toBe(true)
    const none = foldShutters(one, [ev(132, 'action_completed', { agentId: 'yusuf' })], inHouse)
    expect(isShuttered(none, 'house_1', 133)).toBe(false)
  })

  it('opens early when the act is broken off', () => {
    const shut = foldShutters(NO_SHUTTERS, [lie(100, 'amara', 'yusuf')], inHouse)
    const off = foldShutters(
      shut,
      [ev(110, 'action_interrupted', { agentId: 'amara', reason: 'stopped' })],
      inHouse,
    )
    expect(isShuttered(off, 'house_1', 111)).toBe(false)
  })

  it('shutters nothing for a body under no roof, or for any other act', () => {
    expect(foldShutters(NO_SHUTTERS, [lie(100, 'omar', 'amara')], inHouse)).toBe(NO_SHUTTERS)
    expect(
      foldShutters(
        NO_SHUTTERS,
        [ev(100, 'action_started', { agentId: 'amara', verb: 'craft', params: {}, duration: 60 })],
        inHouse,
      ),
    ).toBe(NO_SHUTTERS)
  })

  it('hands back the same object when the window said nothing about a door', () => {
    const shut = foldShutters(NO_SHUTTERS, [lie(100, 'amara', 'yusuf')], inHouse)
    expect(foldShutters(shut, [ev(101, 'agent_moved', { id: 'amara', x: 1, y: 1 })], inHouse)).toBe(
      shut,
    )
  })

  it('holds one row per shut house, not one per act the town has ever had', () => {
    let shut = NO_SHUTTERS
    for (let i = 0; i < 40; i++) {
      shut = foldShutters(shut, [lie(i * 100, 'amara', 'yusuf')], inHouse)
      shut = foldShutters(
        shut,
        [ev(i * 100 + 60, 'action_completed', { agentId: 'amara' })],
        inHouse,
      )
    }
    expect(shut.houses.size).toBe(0)
    expect(shut.by.size).toBe(0)
  })

  it('dims the window rather than putting it out — somebody is home', () => {
    expect(SHUTTERED_GLOW).toBeGreaterThan(0)
    expect(SHUTTERED_GLOW).toBeLessThan(1)
    // One place multiplies it, and it is the window glow.
    expect(src('./lightPools.ts')).toMatch(
      /const shut = isShuttered\(shutters, f\.id, tick\) \? SHUTTERED_GLOW : 1/,
    )
    expect(src('./lightPools.ts')).toContain('(GLOW_BASE_ALPHA + 2 * b) * strength * shut')
  })

  // The act needs a roof of their own, so both bodies carry an `insideId` for its whole length —
  // and a body with one is already off the map and off the director's list.
  it('★ the director is already looking elsewhere: a body under a roof is not a subject', () => {
    expect(rendersOnMap({ alive: true, insideId: 'house_1' })).toBe(false)
    const hot = [
      { fromTick: 940, toTick: 999, agentId: 'amara', score: 40 },
      { fromTick: 940, toTick: 999, agentId: 'omar', score: 3 },
    ]
    const town = ['amara', 'omar', 'yusuf']
    expect(subjectFor(hot, null, 1000, town)).toBe('amara')
    expect(subjectFor(hot, null, 1000, town, new Set(['amara', 'yusuf']))).toBe('omar')
  })
})

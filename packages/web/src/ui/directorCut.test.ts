import { describe, expect, it } from 'vitest'
import { CUT_MIN_MS, STICKY_FACTOR, pickCut } from './directorCut.js'

const w = (agentId: string, fromTick: number, score: number) => ({ agentId, fromTick, toTick: fromTick + 59, score })

describe('pickCut', () => {
  it('the hottest recent window wins', () => {
    const heat = [w('farmer', 940, 6), w('builder', 940, 20), w('fisher', 880, 8)]
    expect(pickCut(heat, null, 1000)).toBe('builder')
  })

  it('sticky: keeps the current agent unless a rival beats it by 25% or more', () => {
    expect(STICKY_FACTOR).toBe(1.25)
    const keep = [w('farmer', 940, 100), w('builder', 940, 124)] // 24% better → keep
    expect(pickCut(keep, 'farmer', 1000)).toBe('farmer')
    const cut = [w('farmer', 940, 100), w('builder', 940, 126)] // 26% better → cut
    expect(pickCut(cut, 'farmer', 1000)).toBe('builder')
  })

  it('ignores windows older than 120 ticks', () => {
    const heat = [w('fisher', 700, 50), w('farmer', 940, 3)]
    expect(pickCut(heat, null, 1000)).toBe('farmer')
  })

  it('holds the camera when nothing is scored', () => {
    expect(pickCut([], 'farmer', 1000)).toBeNull()
    expect(pickCut([w('fisher', 0, 40)], null, 1000)).toBeNull()
    expect(CUT_MIN_MS).toBe(8000)
  })
})

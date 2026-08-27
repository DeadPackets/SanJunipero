import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CUT_MIN_MS,
  QUIET_TURN_TICKS,
  STICKY_FACTOR,
  pickCut,
  quietSubject,
  subjectFor,
} from './directorCut.js'

const w = (agentId: string, fromTick: number, score: number) => ({
  agentId,
  fromTick,
  toTick: fromTick + 59,
  score,
})

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

// ── ★ A BROADCAST ALWAYS HAS A SUBJECT ────────────────────────────────────────────────────

describe('the televised town always has somebody in front of the camera', () => {
  const TOWN = ['amara', 'omar', 'salma', 'yusuf']

  it('still takes the hottest agent whenever the town gives it one', () => {
    expect(subjectFor([w('farmer', 940, 6), w('builder', 940, 20)], null, 1000, TOWN)).toBe(
      'builder',
    )
  })

  it('falls back to somebody who is actually there when nothing has scored', () => {
    expect(TOWN).toContain(subjectFor([], null, 1000, TOWN))
  })

  it('turns the round over one heat window at a time, and never faster', () => {
    expect(QUIET_TURN_TICKS).toBe(60)
    const seen = Array.from({ length: 8 }, (_, i) => quietSubject(TOWN, i * QUIET_TURN_TICKS))
    expect(seen).toEqual(['amara', 'omar', 'salma', 'yusuf', 'amara', 'omar', 'salma', 'yusuf'])
    // every tick inside one window is the same person: a cut is a decision, not a flicker
    for (let t = 60; t < 120; t++) expect(quietSubject(TOWN, t), `${t}`).toBe('omar')
  })

  it('holds still on a one-person town rather than cutting to the same face', () => {
    for (const t of [0, 59, 60, 1000]) expect(quietSubject(['amara'], t)).toBe('amara')
  })

  it('answers null only when there is nobody left to look at', () => {
    expect(subjectFor([], null, 1000, [])).toBeNull()
    expect(quietSubject([], 1000)).toBeNull()
  })

  it('never indexes off the end on a tick the world has not reached', () => {
    for (const t of [-1, 0, Number.NaN]) expect(TOWN).toContain(quietSubject(TOWN, t))
  })
})

// ── ★ THE ROUND MUST KEEP TURNING WHILE /api/heat IS DOWN ────────────────────────────────
//
// The broadcast path has no operator. `endpoint()` keeps the last good answer by default, which
// for a reader whose BEAT drives a state machine would freeze the caption on one face for as
// long as the gateway was refusing — so DirectorMode names what a refused read means instead.
describe('DirectorMode reads the heat window through the one endpoint layer', () => {
  const SRC = readFileSync(new URL('./DirectorMode.tsx', import.meta.url), 'utf8')

  it('★ hand-rolls no fetch of its own', () => {
    expect(SRC).not.toContain('fetch(')
    expect(SRC).toContain('usePolled<HeatWindow[]>(')
  })

  it('★ names an empty window as the refused answer, on the measured beat', () => {
    expect(SRC).toContain('const NO_HEAT: HeatWindow[] = []')
    expect(SRC).toMatch(/usePolled<HeatWindow\[\]>\([^)]*HEAT_POLL_MS,\s*NO_HEAT,\s*\)/)
    // and an empty window is what turns the round over — the two halves of one guarantee
    expect(subjectFor([], null, 1000, ['amara', 'omar'])).toBe(
      quietSubject(['amara', 'omar'], 1000),
    )
  })
})

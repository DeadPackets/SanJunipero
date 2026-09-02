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
    expect(subjectFor([w('amara', 940, 6), w('omar', 940, 20)], null, 1000, TOWN)).toBe('omar')
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

  it('★ refuses a hot window naming somebody who is not a person in the town', () => {
    // The scripted world scores its own runner as `script`; a camera told to follow it
    // finds no body, never moves, and strands the whole first viewport at 3x.
    expect(subjectFor([w('script', 0, 66)], null, 30, TOWN)).toBe(quietSubject(TOWN, 30))
    expect(subjectFor([w('script', 0, 99), w('omar', 0, 1)], null, 30, TOWN)).toBe('omar')
  })

  it('answers null only when there is nobody left to look at', () => {
    expect(subjectFor([], null, 1000, [])).toBeNull()
    expect(quietSubject([], 1000)).toBeNull()
  })

  it('never indexes off the end on a tick the world has not reached', () => {
    for (const t of [-1, 0, Number.NaN]) expect(TOWN).toContain(quietSubject(TOWN, t))
  })
})

// ★ Two burst frames read DIRECTOR · KAMAL and held on three closed doors: Kamal was inside his
// house, and the exterior view draws no interiors.
describe('★ the director does not cut to a mind the street cannot show', () => {
  const TOWN = ['amara', 'omar', 'salma', 'yusuf']
  const hot = [w('amara', 940, 6), w('omar', 940, 20), w('salma', 940, 3)]

  it('★ takes the top OUTDOOR scorer when the hottest mind is indoors', () => {
    expect(subjectFor(hot, null, 1000, TOWN)).toBe('omar')
    expect(subjectFor(hot, null, 1000, TOWN, new Set(['omar']))).toBe('amara')
    expect(subjectFor(hot, null, 1000, TOWN, new Set(['omar', 'amara']))).toBe('salma')
  })

  it('★ answers null when every candidate is indoors, so the caller holds its shot', () => {
    expect(subjectFor(hot, null, 1000, TOWN, new Set(TOWN))).toBeNull()
    // and the quiet round has nobody to turn over either
    expect(subjectFor([], 'omar', 1000, TOWN, new Set(TOWN))).toBeNull()
  })

  it('★ does not stay stuck on a subject that has gone inside', () => {
    expect(subjectFor(hot, 'omar', 1000, TOWN, new Set(['omar']))).toBe('amara')
  })

  it('turns the quiet round over the people who are actually out', () => {
    const out = ['omar', 'yusuf']
    for (const t of [0, 30, 60, 90, 200])
      expect(out, `tick ${t}`).toContain(subjectFor([], null, t, TOWN, new Set(['amara', 'salma'])))
  })

  it('leaves a town where nobody is inside exactly as it was', () => {
    for (const t of [0, 60, 1000])
      expect(subjectFor(hot, null, t, TOWN, new Set())).toBe(subjectFor(hot, null, t, TOWN))
  })

  it('★ DirectorMode reads indoors off the layer that draws the street', () => {
    const SRC = readFileSync(new URL('./DirectorMode.tsx', import.meta.url), 'utf8')
    expect(SRC).toContain('rendersOnMap')
    expect(SRC).toMatch(/subjectFor\([\s\S]*?indoors,?\s*\)/)
  })
})

describe('DirectorMode reads the heat window through the one endpoint layer', () => {
  const SRC = readFileSync(new URL('./DirectorMode.tsx', import.meta.url), 'utf8')

  it('★ hand-rolls no fetch of its own, and beats at the measured interval', () => {
    expect(SRC).not.toContain('fetch(')
    expect(SRC).toMatch(/useEndpointFor<HeatWindow\[\]>\([\s\S]*?HEAT_POLL_MS,?\s*\)/)
    // and the round turns on the poll landing, not on the numbers moving
    expect(SRC).toContain('feed.beat')
  })

  it('★ the first viewport is the town at zoom 1, centred before the stop moves', () => {
    expect(SRC).toContain('export const OVERVIEW_ZOOM = 1 as const')
    expect(SRC).toMatch(/scene\.centerHome\(\)\s*\n\s*scene\.setZoom\(OVERVIEW_ZOOM\)/)
  })

  it('★ reads a refused window as an empty one, which is what turns the round over', () => {
    expect(SRC).toContain('heat.data ?? NO_HEAT')
    expect(subjectFor([], null, 1000, ['amara', 'omar'])).toBe(
      quietSubject(['amara', 'omar'], 1000),
    )
  })
})

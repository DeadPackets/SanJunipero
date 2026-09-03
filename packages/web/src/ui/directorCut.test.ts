import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cameraClaim } from './DirectorMode.js'
import type { SceneStage } from './stageCue.js'
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
    expect(SRC).toMatch(/subjectFor\([\s\S]*?indoorsIn\(store\.getState\(\)\),?\s*\)/)
    // and the cut and the scene claim ask the ONE question, so they cannot disagree
    expect(SRC).toContain('indoorsIn(state)')
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

// ★ WHO THE CAMERA ANSWERS TO. Three claimants now, and the ladder has to be written down: a
// scene outranks the heat director, and a viewer's own hand outranks both.
describe('★ the camera’s ladder of claims', () => {
  const SRC = readFileSync(new URL('./DirectorMode.tsx', import.meta.url), 'utf8')
  const NOBODY_INSIDE = new Set<string>()
  const open = (participants: string[]): SceneStage => ({
    scene: {
      id: 'sc_1',
      kind: 'talk',
      participants,
      topic: 'the well',
      stakes: 4,
      open: true,
    },
    phase: 'open',
  })

  it('★ an open scene outranks the auto director', () => {
    const claim = cameraClaim(null, open(['amara', 'salma']), NOBODY_INSIDE, 'yusuf')
    expect(claim).toEqual({ by: 'scene', cast: ['amara', 'salma'] })
  })

  it('★ a closed one gives the cut back', () => {
    expect(cameraClaim(null, null, NOBODY_INSIDE, 'yusuf')).toEqual({ by: 'cut', agentId: 'yusuf' })
  })

  it('★ an all-indoors scene takes nobody, and the shot HOLDS rather than cutting', () => {
    const inside = new Set(['amara', 'salma'])
    expect(cameraClaim(null, open(['amara', 'salma']), inside, 'yusuf')).toEqual({ by: 'hold' })
  })

  it('frames the ones the map does draw when only some of them are inside', () => {
    const claim = cameraClaim(null, open(['amara', 'salma']), new Set(['salma']), null)
    expect(claim).toEqual({ by: 'scene', cast: ['amara'] })
  })

  it('★ a viewer following somebody outranks every automation, scene included', () => {
    const claim = cameraClaim('omar', open(['amara', 'salma']), NOBODY_INSIDE, 'yusuf')
    expect(claim).toEqual({ by: 'pinned', agentId: 'omar' })
  })

  it('falls back to the town when nobody has a claim on it', () => {
    expect(cameraClaim(null, null, NOBODY_INSIDE, null)).toEqual({ by: 'town' })
  })

  it('★ the summary keeps the room in frame: the shot releases after it, not on the close', () => {
    const summary: SceneStage = {
      scene: { ...open(['amara', 'salma']).scene, open: false, summary: 'They agreed.' },
      phase: 'summary',
    }
    expect(cameraClaim(null, summary, NOBODY_INSIDE, 'yusuf')).toEqual({
      by: 'scene',
      cast: ['amara', 'salma'],
    })
  })

  it('★ the round stands down while a scene holds the shot, and no cut lands', () => {
    // the cut chooser returns before it reads the heat, so `lastCutRef` never moves either
    expect(SRC).toContain(
      "if (claimBy === 'scene' || claimBy === 'moment' || claimBy === 'hold') return",
    )
    expect(SRC).toMatch(/\}, \[store, autoCut, claimBy, heat, beat\]\)/)
  })

  it('★ a held shot moves the camera nowhere at all', () => {
    expect(SRC).toMatch(/if \(claimBy === 'hold'\) return/)
  })

  it('★ the scene shot is re-cut every frame, so it follows the room as it shifts', () => {
    expect(SRC).toContain('scene.setZoom(opening.stop)')
    expect(SRC).toMatch(/scene\.setFollow\(\(\) => \{\s*const shot = where\(\)/)
  })

  it('★ a hand on the camera stands the scene down with the director, for the same 20s', () => {
    expect(SRC).toContain('autoCut ? stage : null')
  })
})

// ★ /api/heat is anchored at the LIVE tick, so during a replay the past scores nothing and the
// director round-robins one face per 60 ticks — anybody but the people the moment is about.
describe('★ a replayed moment frames the people it is about', () => {
  const SRC = readFileSync(new URL('./DirectorMode.tsx', import.meta.url), 'utf8')
  const NOBODY = new Set<string>()
  const open = (participants: string[]): SceneStage => ({
    scene: { id: 'sc_1', kind: 'talk', participants, topic: 'the well', stakes: 4, open: true },
    phase: 'open',
  })

  it('★ outranks the scene and the heat round, and sits under a viewer’s own pick', () => {
    expect(cameraClaim(null, null, NOBODY, 'yusuf', ['amara', 'salma'])).toEqual({
      by: 'moment',
      cast: ['amara', 'salma'],
    })
    expect(cameraClaim(null, open(['omar']), NOBODY, null, ['amara'])).toEqual({
      by: 'moment',
      cast: ['amara'],
    })
    expect(cameraClaim('omar', null, NOBODY, null, ['amara'])).toEqual({
      by: 'pinned',
      agentId: 'omar',
    })
  })

  it('★ a moment whose cast is all indoors HOLDS rather than handing back the heat round', () => {
    expect(cameraClaim(null, null, new Set(['amara']), 'yusuf', ['amara'])).toEqual({ by: 'hold' })
  })

  it('a moment with nobody named leaves every other claim exactly as it was', () => {
    expect(cameraClaim(null, null, NOBODY, 'yusuf', [])).toEqual({ by: 'cut', agentId: 'yusuf' })
    expect(cameraClaim(null, null, NOBODY, null)).toEqual({ by: 'town' })
  })

  it('★ stops polling the heat it cannot use while a moment owns the shot', () => {
    expect(SRC).toContain("autoCut && pinned === null && moment.length === 0 ? '/api/heat' : null")
  })
})

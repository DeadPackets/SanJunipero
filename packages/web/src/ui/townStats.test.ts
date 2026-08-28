import { describe, it, expect } from 'vitest'
import { BOND_NOTES } from '@sj/shared'
import type { AgentBody, WorldState } from '@sj/engine/state'
import { EMPTY_COPY, GAMIFICATION_BAN, WEATHER_GLYPH, townStats } from './townStats.js'

const agent = (id: string, alive: boolean): AgentBody => ({
  id,
  name: id,
  x: 0,
  y: 0,
  alive,
  asleep: false,
  needs: { hunger: 1, energy: 1, warmth: 1, social: 1 },
  hp: 10,
  injuries: [],
  ill: false,
  ageDays: 20,
  skills: {},
  activity: null,
  collapsedSinceTick: null,
  zeroHungerSinceTick: null,
})

const state = (tick: number, weather: string, agents: AgentBody[]): WorldState => ({
  tick,
  terrain: [[0]],
  weather: { kind: weather, temperatureC: 12 },
  agents: Object.fromEntries(agents.map((a) => [a.id, a])),
  structures: {},
  items: {},
  crops: {},
  wildlife: { fish: 1, deer: 1 },
  counters: { nextEntityId: 1 },
})

describe('townStats', () => {
  it('counts the living against the whole cast', () => {
    const s = state(0, 'sunny', [
      agent('a', true),
      agent('b', true),
      agent('c', true),
      agent('d', false),
    ])
    expect(townStats(s, 0)).toEqual({ day: 0, time: '00:00', weather: 'sunny', alive: 3, total: 4 })
  })

  it('reads the clock off the viewed tick, not the world tick', () => {
    const s = state(2000, 'rain', [])
    expect(townStats(s, 870)).toMatchObject({ day: 0, time: '14:30' })
    expect(townStats(s, 1440)).toMatchObject({ day: 1, time: '00:00' })
  })

  it('passes the weather through and holds a dash before the town wakes', () => {
    expect(townStats(state(0, 'storm', []), 0).weather).toBe('storm')
    expect(townStats(null, 0)).toEqual({ day: 0, time: '00:00', weather: '—', alive: 0, total: 0 })
  })
})

describe('EMPTY_COPY', () => {
  it('tells the viewer what has not happened yet, in the town’s own voice', () => {
    expect(EMPTY_COPY.chronicle).toBe(
      'Day one is still unwritten. The town’s ledger fills as the townsfolk live it.',
    )
    expect(EMPTY_COPY.bonds).toContain('No bonds yet.')
    expect(EMPTY_COPY.moments).toBe(
      'Nothing worth replaying yet — the first recorded day is still ahead.',
    )
    expect(EMPTY_COPY.roster).toBe(
      'No one walks the town yet — the first footsteps are still to come.',
    )
    expect(EMPTY_COPY.rosterSub).toBe('The founders arrive at dawn.')
  })

  // Derived from `BOND_NOTES`, the list `buildBonds` actually reads, so a seventh act turns this red
  // instead of leaving the panel describing five sixths of the truth.
  it('★ names every act a bond is derived from, and there are six', () => {
    const acts = Object.keys(BOND_NOTES)
    expect(acts).toHaveLength(6)
    const words: Record<string, RegExp> = {
      spoke: /\bword\b/,
      give: /\bgift\b/,
      teach: /\blesson\b/,
      attack: /\bblow\b/,
      co_slept: /night under one roof/,
      born: /\bchild\b/,
    }
    for (const act of acts) {
      expect(
        words[act],
        `${act} is a bond-forming act with no word in the empty state`,
      ).toBeDefined()
      expect(EMPTY_COPY.bonds, act).toMatch(words[act]!)
    }
    // and it does not tell the viewer to wait for something this world may never do
    expect(EMPTY_COPY.bonds).not.toMatch(/watch|wait|will\s/i)
  })

  it('never nags and never gamifies', () => {
    for (const [key, copy] of Object.entries(EMPTY_COPY)) {
      expect(copy, key).not.toMatch(GAMIFICATION_BAN)
      expect(copy, key).not.toMatch(/\b(AI|LLM|model|prompt|token|simulation)\b/i)
    }
  })
})

describe('WEATHER_GLYPH', () => {
  it('covers every weather kind the world can roll, with a fallback', () => {
    for (const kind of ['sunny', 'cloudy', 'rain', 'storm', 'snow']) {
      expect(WEATHER_GLYPH[kind], kind).toBeDefined()
    }
    expect(WEATHER_GLYPH['—']).toBeDefined()
  })

  it('describes each glyph for screen readers without naming a picture', () => {
    for (const [kind, g] of Object.entries(WEATHER_GLYPH)) {
      expect(g.label.toLowerCase(), kind).not.toContain('icon')
      expect(g.pixels.length).toBeGreaterThan(0)
    }
  })
})

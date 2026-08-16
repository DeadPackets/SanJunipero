import { describe, it, expect } from 'vitest'
import type { SimEvent } from '@sj/shared'
import type { AgentBody, WorldState } from '@sj/engine/state'
import { LENSES } from './route.js'
import { EMPTY_COPY, GAMIFICATION_BAN, WEATHER_GLYPH, lensHints, townStats } from './townStats.js'

const agent = (id: string, alive: boolean): AgentBody => ({
  id, name: id, x: 0, y: 0, alive, asleep: false,
  needs: { hunger: 1, energy: 1, warmth: 1, social: 1 },
  hp: 10, injuries: [], ill: false, ageDays: 20, skills: {},
  activity: null, collapsedSinceTick: null, zeroHungerSinceTick: null,
})

const state = (tick: number, weather: string, agents: AgentBody[]): WorldState => ({
  tick, terrain: [[0]], weather: { kind: weather, temperatureC: 12 },
  agents: Object.fromEntries(agents.map((a) => [a.id, a])),
  structures: {}, items: {}, crops: {}, wildlife: { fish: 1, deer: 1 },
  counters: { nextEntityId: 1 },
})

const event = (type: string, tick: number): SimEvent =>
  ({ seq: tick + 1, tick, type, payload: {} }) as unknown as SimEvent

describe('townStats', () => {
  it('counts the living against the whole cast', () => {
    const s = state(0, 'sunny', [agent('a', true), agent('b', true), agent('c', true), agent('d', false)])
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

describe('lensHints', () => {
  const stats = townStats(state(0, 'sunny', [agent('a', true), agent('b', true)]), 0)
  const events = [event('agent_spoke', 1), event('agent_died', 2)]

  it('gives one hint per lens, in lens order', () => {
    expect(lensHints(stats, events).map((h) => h.lens)).toEqual([...LENSES])
  })

  it('badges the townsfolk count and the chronicle length, and leaves the map unbadged', () => {
    const by = new Map(lensHints(stats, events).map((h) => [h.lens, h]))
    expect(by.get('inspector')!.count).toBe(2)
    expect(by.get('chronicle')!.count).toBe(events.length)
    expect(by.get('map')!.count).toBeNull()
  })

  it('takes a count override for the lenses whose readers land later', () => {
    const by = new Map(lensHints(stats, events, { society: 7, director: 0 }).map((h) => [h.lens, h]))
    expect(by.get('society')!.count).toBe(7)
    expect(by.get('director')!.count).toBe(0)
    expect(lensHints(stats, events).find((h) => h.lens === 'society')!.count).toBeNull()
  })

  it('never speaks the language of a game (living-documentary law)', () => {
    for (const h of lensHints(stats, events, { society: 3, director: 4 })) {
      expect(h.hint, h.lens).not.toMatch(GAMIFICATION_BAN)
    }
    expect(GAMIFICATION_BAN.test('Your PROGRESS')).toBe(true)
    expect(GAMIFICATION_BAN.test('quest log')).toBe(true)
    expect(GAMIFICATION_BAN.test('the town')).toBe(false)
  })

  it('every hint is human-framed prose, never machinery', () => {
    for (const h of lensHints(stats, events)) {
      expect(h.hint.length).toBeGreaterThan(3)
      expect(h.hint).not.toMatch(/\b(AI|LLM|model|prompt|token|agent)\b/i)
    }
  })
})

describe('EMPTY_COPY', () => {
  it('tells the viewer what has not happened yet, in the town’s own voice', () => {
    expect(EMPTY_COPY.chronicle).toBe('Day one is still unwritten. The town’s ledger fills as the townsfolk live it.')
    expect(EMPTY_COPY.bonds).toBe('No bonds recorded yet — watch long enough and the town will braid its own ties.')
    expect(EMPTY_COPY.moments).toBe('Nothing worth replaying yet — the first recorded day is still ahead.')
    expect(EMPTY_COPY.roster).toBe('No one walks the town yet — the first footsteps are still to come.')
    expect(EMPTY_COPY.rosterSub).toBe('The founders arrive at dawn.')
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

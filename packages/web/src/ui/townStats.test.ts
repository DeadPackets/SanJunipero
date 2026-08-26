import { describe, it, expect } from 'vitest'
import { BOND_NOTES } from '@sj/shared'
import type { AgentBody, WorldState } from '@sj/engine/state'
import { LENSES, type Lens } from './route.js'
import {
  EMPTY_COPY,
  GAMIFICATION_BAN,
  WEATHER_GLYPH,
  countsFromWorld,
  lensCountsFor,
  lensHints,
  townStats,
  type LensCounts,
} from './townStats.js'

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

describe('lensHints', () => {
  const stats = townStats(state(0, 'sunny', [agent('a', true), agent('b', true)]), 0)

  it('gives one hint per lens, in lens order', () => {
    expect(lensHints(stats).map((h) => h.lens)).toEqual([...LENSES])
  })

  it('badges the townsfolk count, and never counts the live feed as the chronicle', () => {
    const by = new Map(lensHints(stats).map((h) => [h.lens, h]))
    expect(by.get('inspector')!.count).toBe(2)
    expect(by.get('chronicle')!.count, 'the badge invented a number').toBeNull()
    expect(by.get('map')!.count).toBeNull()
  })

  // `lensHints` no longer takes the socket feed, so there is nothing for a chronicle count to be
  // accidentally derived FROM.
  it('★ takes no live feed at all — the only counts are the ones a caller declares', () => {
    const declared: LensCounts = { ...countsFromWorld(stats), chronicle: 16, society: 7 }
    const by = new Map(lensHints(stats, declared).map((h) => [h.lens, h]))
    expect(by.get('chronicle')!.count).toBe(16)
    expect(by.get('society')!.count).toBe(7)
    expect(by.get('director')!.count).toBeNull()
  })

  // The MINIMAP_LENSES precedent, restated: a total record with a reason on every row, so the
  // next lens anybody adds is a type error until it says where its number comes from.
  it('★ every lens is accounted for by name, so a new one cannot arrive unbadged by silence', () => {
    expect(Object.keys(countsFromWorld(stats)).sort()).toEqual([...LENSES].sort())
    expect(countsFromWorld(stats).inspector).toBe(2)
    for (const lens of LENSES) {
      if (lens === 'inspector') continue
      expect(countsFromWorld(stats)[lens], lens).toBeNull()
    }
  })

  // A mutation proved this was the one line no test could reach: dropping both fetched counts inside
  // `LensTabs` left every UI test green while the nav showed no chronicle number at all.
  it('★ lays the two fetched counts over the world’s, and shows nothing until they answer', () => {
    expect(lensCountsFor(stats, 16, 2)).toEqual({
      ...countsFromWorld(stats),
      chronicle: 16,
      society: 2,
    })
    // Before either endpoint has answered: no badge is better than a wrong one.
    expect(lensCountsFor(stats, null, null)).toEqual(countsFromWorld(stats))
    expect(lensCountsFor(stats, 16, 2).inspector, 'the world’s own count was overwritten').toBe(2)
    // Zero is a real answer and must survive: a town with nothing written down says so.
    expect(lensCountsFor(stats, 0, 0).chronicle).toBe(0)
    expect(lensCountsFor(stats, 0, 0).society).toBe(0)
  })

  it('★★ THE BADGE AND ITS LABEL ARE ONE NUMBER, not two that can disagree', () => {
    // A hint is the tooltip AND the screen-reader label for the badge beside it, so a hint built
    // before the override was applied could name a different number on the same button.
    const declared: LensCounts = {
      ...countsFromWorld(stats),
      chronicle: 11,
      inspector: 40,
      society: 3,
      director: 4,
    }
    for (const h of lensHints(stats, declared)) {
      if (h.count === null) continue
      expect(h.hint, `${h.lens}: hint does not carry its own count`).toContain(String(h.count))
    }
    const hintOf = (over: Partial<LensCounts>, lens: Lens): string =>
      lensHints(stats, { ...countsFromWorld(stats), ...over }).find((h) => h.lens === lens)!.hint
    expect(hintOf({ chronicle: 11 }, 'chronicle')).toBe('11 in the town’s own ledger')
    // The badge itself is aria-hidden, so a visible count the label never mentions cannot be heard
    // at all.
    expect(hintOf({ society: 3 }, 'society')).toBe('3 ties the town has made')
    expect(hintOf({ director: 4 }, 'director')).toBe('4 days the town kept')
  })

  it('and a lens with no count keeps its prose, with no empty parenthesis in it', () => {
    for (const h of lensHints(stats)) {
      if (h.count !== null) continue
      expect(h.hint, h.lens).not.toMatch(/\(\s*\)|\bnull\b|undefined|NaN/)
    }
  })

  it('takes a count override for the lenses whose readers land later', () => {
    const over: LensCounts = { ...countsFromWorld(stats), society: 7, director: 0 }
    const by = new Map(lensHints(stats, over).map((h) => [h.lens, h]))
    expect(by.get('society')!.count).toBe(7)
    expect(by.get('director')!.count).toBe(0)
    expect(lensHints(stats).find((h) => h.lens === 'society')!.count).toBeNull()
  })

  it('never speaks the language of a game (living-documentary law)', () => {
    for (const h of lensHints(stats, { ...countsFromWorld(stats), society: 3, director: 4 })) {
      expect(h.hint, h.lens).not.toMatch(GAMIFICATION_BAN)
    }
    expect(GAMIFICATION_BAN.test('Your PROGRESS')).toBe(true)
    expect(GAMIFICATION_BAN.test('quest log')).toBe(true)
    expect(GAMIFICATION_BAN.test('the town')).toBe(false)
  })

  it('every hint is human-framed prose, never machinery', () => {
    for (const h of lensHints(stats)) {
      expect(h.hint.length).toBeGreaterThan(3)
      expect(h.hint).not.toMatch(/\b(AI|LLM|model|prompt|token|agent)\b/i)
    }
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

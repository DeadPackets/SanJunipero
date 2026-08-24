import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { bondId, type AssetRecord, type Bond, type BondsResponse, type SimEvent } from '@sj/shared'
import type { Structure, TileId, WorldState } from '@sj/engine/state'
import { EXPRESSIONS, moodOf, type MoodView } from '../../render/mood.js'
import { GAMIFICATION_BAN } from '../townStats.js'
import { RosterRowView, rowLabel } from './RosterRowView.js'
import {
  EARSHOT_TILES,
  MOOD_GLYPH, MOOD_GLYPH_PALETTE, MOOD_GLYPH_PX, MOOD_WORD, ROSTER_SORTS, ROSTER_SORT_WORD,
  rosterRows2, sortRoster, type RosterRow2, type RosterSort,
} from './rosterRow.js'

const EMOJI = /\p{Extended_Pictographic}/u
const MASTER_PALETTE = [
  '#FFF6E9', '#F6E8D5', '#E8D5BC', '#D4BC9E', '#B89D7E', '#F2C879', '#E0A95E', '#C68A48',
  '#A66E38', '#7E512B', '#DCE8C8', '#B9D19A', '#93B573', '#6F9455', '#4F7040', '#F2C6C2',
  '#E09E9B', '#C47876', '#9E5A5C', '#D6EAF2', '#A8CFE0', '#7FB0C9', '#5A8CAB', '#3E6786',
  '#E9E2DA', '#CFC6BC', '#ABA198', '#857D75', '#5D5751', '#43394A', '#322B38', '#241F2B',
  '#171420', '#F7A66B', '#E8785A', '#8A6FA8', '#F4E289', '#F5D3B3', '#D9A876', '#9C6B47',
]
const DAY_TICKS = 2880

const struct = (over: Partial<Structure> & { id: string; kind: string; x: number; y: number }): Structure => ({
  w: 1, h: 1, hp: 20, maxHp: 20, flammable: true, stage: 'complete',
  progressTicks: 0, builtBy: null, burning: false, burnTicks: 0, ...over,
})

type AgentSeed = {
  id: string; name?: string; x?: number; y?: number; ageDays?: number
  asleep?: boolean; alive?: boolean; skills?: Record<string, number>
  activity?: { verb: string; ticksRemaining: number } | null
  insideId?: string; ill?: boolean
}

function world(
  seeds: AgentSeed[], structures: Structure[] = [], tick = 0,
): WorldState {
  const agents: Record<string, unknown> = {}
  for (const s of seeds) {
    agents[s.id] = {
      id: s.id, name: s.name ?? s.id, x: s.x ?? 0, y: s.y ?? 0,
      alive: s.alive ?? true, asleep: s.asleep ?? false, ageDays: s.ageDays ?? 30 * 364,
      needs: { hunger: 80, energy: 80, warmth: 80, social: 80 },
      hp: 100, injuries: [], ill: s.ill ?? false, skills: s.skills ?? {},
      activity: s.activity ?? null, collapsedSinceTick: null, zeroHungerSinceTick: null,
      ...(s.insideId === undefined ? {} : { insideId: s.insideId }),
    }
  }
  const byId: Record<string, Structure> = {}
  for (const s of structures) byId[s.id] = s
  return {
    tick,
    terrain: Array.from({ length: 48 }, () => Array.from({ length: 48 }, () => 0 as TileId)),
    weather: { kind: 'sunny', temperatureC: 12 },
    agents: agents as WorldState['agents'], structures: byId, items: {}, crops: {},
    wildlife: { fish: 1, deer: 1 }, counters: { nextEntityId: 1 },
  }
}

const bond = (aId: string, bId: string, kind: Bond['kind'], n: number, tick: number): Bond => ({
  id: bondId(aId, bId), aId, bId, kind, strength: n, formedTick: tick, lastUpdatedTick: tick,
  history: Array.from({ length: n }, () => ({ tick, kind, note: 'x' })),
})
const api = (bonds: Bond[]): BondsResponse => ({ bonds, asOfTick: 0 })

// ── DAY 0: complete, dignified, and visibly a person who has not lived yet ────────────────
describe('rosterRows2 — the five required fields, on a person who has done nothing', () => {
  const state = world(
    [{ id: 'amara', name: 'Amara', x: 10, y: 10 }],
    [struct({ id: 'well', kind: 'well', x: 11, y: 10 })],
  )
  const row = rosterRows2(state, [], null, 0)[0]!

  it('★ every one of U12’s five fields is non-empty on sim-day 0', () => {
    expect(row.portrait).not.toBeUndefined()          // portrait
    expect(row.name).toBe('Amara')                    // name
    expect(row.state.length).toBeGreaterThan(2)       // current status
    expect(EXPRESSIONS as readonly string[]).toContain(row.mood)   // a mood status icon
    expect(row.place.words.length).toBeGreaterThan(4) // where they are
    expect(row.place.words).toBe('at the well')
  })

  it('starts with nothing the run has not given them', () => {
    expect(row.substance).toBe(0)
    expect(row.with).toEqual([])
    expect(row.conditions).toEqual([])
    expect(row.ageWords).toBe('grown')
  })

  it('leaves out the dead, and a null world is an empty roster', () => {
    const withGhost = world([{ id: 'a' }, { id: 'ghost', alive: false }])
    expect(rosterRows2(withGhost, [], null, 0).map((r) => r.id)).toEqual(['a'])
    expect(rosterRows2(null, [], null, 0)).toEqual([])
  })
})

// ── P22.3: THE DAY-0 / DAY-5 ARC ──────────────────────────────────────────────────────────
describe('the same person, five days apart, is not the same row', () => {
  const structures = [struct({ id: 'house', kind: 'house', x: 10, y: 12, w: 2, h: 2, owner: 'amara' })]
  const day0 = world([{ id: 'amara', name: 'Amara', x: 10, y: 10 }], structures)
  const day5 = world([
    { id: 'amara', name: 'Amara', x: 10, y: 12, skills: { farming: 9, carpentry: 4 }, activity: { verb: 'build', ticksRemaining: 20 } },
    { id: 'yusuf', name: 'Yusuf', x: 11, y: 12 },
  ], structures, 5 * DAY_TICKS)
  const bonds = api([bond('amara', 'yusuf', 'owe', 5, 5 * DAY_TICKS)])

  const a0 = rosterRows2(day0, [], null, 0)[0]!
  const a5 = rosterRows2(day5, [], bonds, 5 * DAY_TICKS).find((r) => r.id === 'amara')!

  it('substance strictly increased, and company arrived', () => {
    expect(a5.substance).toBeGreaterThan(a0.substance)
    expect(a0.with).toEqual([])
    expect(a5.with).toEqual(['Yusuf'])
  })

  // ★ "NEAR" IS THE WORLD'S OWN EARSHOT, NOT THE VIEWER'S COPY OF IT. `EARSHOT_TILES = 8` was
  // a transcription of `DEFAULT_CONFIG.movement.earshotRadius` and also the AUTHORITY, which
  // is exactly the shape `BUILD_TICKS_FULL` had when it went stale unnoticed. It is a fallback
  // now and the snapshot's own figure wins, so a world that hears further — or less far — has
  // a roster that says so.
  it('★ a world with a different earshot has a different idea of who is near', () => {
    const at = (earshot?: number): string[] =>
      rosterRows2(day5, [], bonds, 5 * DAY_TICKS, [], earshot).find((r) => r.id === 'amara')!.with
    expect(at(EARSHOT_TILES)).toEqual(['Yusuf'])
    expect(at(undefined), 'the fallback is not the landed number').toEqual(at(EARSHOT_TILES))
    // they are one tile apart, so an earshot under one puts them out of it
    expect(at(0.5), 'the roster ignored the world and used its own copy').toEqual([])
    // and a nonsense figure falls back rather than emptying the roster
    expect(at(0)).toEqual(['Yusuf'])
    expect(at(-3)).toEqual(['Yusuf'])
  })

  it('the RENDERED row differs — a row that reads the same on both is the defect', () => {
    const render = (r: RosterRow2): string =>
      renderToStaticMarkup(createElement(RosterRowView, { row: r, open: false, onToggle: () => {} }))
    expect(render(a5)).not.toBe(render(a0))
    expect(rowLabel(a5)).not.toBe(rowLabel(a0))
  })

  // P22.4: two people with identical genesis and different logged behaviour must differ
  it('two identical founders who did different things get different rows', () => {
    const pair = world([
      { id: 'a', name: 'Aa', x: 0, y: 0, skills: { farming: 20 } },
      { id: 'b', name: 'Bb', x: 30, y: 30 },
    ], [], DAY_TICKS)
    const [ra, rb] = rosterRows2(pair, [], null, DAY_TICKS)
    expect(ra!.substance).not.toBe(rb!.substance)
  })
})

describe('portrait — three honest fallbacks, never a broken image', () => {
  const state = world([{ id: 'amara', name: 'Amara' }])
  const portrait: AssetRecord = {
    id: 'p1', seq: 1, class: 'portrait', desc: 'x', kind: 'portrait:amara:neutral',
    footprint: { w: 1, h: 1 }, widthPx: 128, heightPx: 128, status: 'ready',
    score: null, attempts: 1, costUsd: 0, createdAt: 'now', meta: null,
  }
  const atlas: AssetRecord = {
    id: 'asset_amara', seq: 2, class: 'rig-part', desc: 'character sheet v4: amara',
    kind: 'character:amara', footprint: { w: 1, h: 1 }, widthPx: 2000, heightPx: 3400,
    status: 'ready', score: null, attempts: 1, costUsd: 0, createdAt: 'now',
    meta: JSON.stringify({
      version: 'v4-hires-atlas', figureH: 800,
      cells: { 'idle-se': { x: 400, y: 850, w: 340, h: 810, feetX: 170, feetY: 805 } },
    }),
  }

  it('prefers the painted face, then the sprite bust, then the initial', () => {
    expect(rosterRows2(state, [portrait, atlas], null, 0)[0]!.portrait)
      .toEqual({ url: '/assets/p1.png' })
    expect(rosterRows2(state, [atlas], null, 0)[0]!.portrait).toHaveProperty('bust')
    expect(rosterRows2(state, [], null, 0)[0]!.portrait).toEqual({ token: 'A' })
  })
})

describe('mood — one table, not two', () => {
  it('is exactly what moodOf says, called on the same body', () => {
    const state = world([{ id: 'amara', name: 'Amara', asleep: true }])
    const a = state.agents['amara']!
    const view: MoodView = {
      id: a.id, alive: a.alive, asleep: a.asleep, ill: a.ill, injuries: a.injuries,
      needs: a.needs, collapsedSinceTick: a.collapsedSinceTick,
    }
    expect(rosterRows2(state, [], null, 0)[0]!.mood).toBe(moodOf(view, [], 0))
  })

  it('an event the log recorded reaches the face', () => {
    const state = world([{ id: 'amara', name: 'Amara' }])
    const hit = [{ seq: 1, tick: 0, type: 'agent_attacked', payload: { targetId: 'amara' } } as SimEvent]
    expect(rosterRows2(state, [], null, 0, hit)[0]!.mood).toBe('angry')
    expect(rosterRows2(state, [], null, 0)[0]!.mood).toBe('neutral')
  })
})

describe('state and conditions come from the one vocabulary', () => {
  it('is exactly one state word, and conditions may be empty', () => {
    const state = world([
      { id: 'a', name: 'A', asleep: true },
      { id: 'b', name: 'B', ill: true, activity: { verb: 'build', ticksRemaining: 3 } },
    ])
    const [ra, rb] = rosterRows2(state, [], null, 0)
    expect(ra!.state).toBe('Asleep')
    expect(ra!.conditions).toEqual([])
    expect(rb!.state).toBe('Building')
    expect(rb!.conditions).toEqual(['unwell'])
  })
})

describe('sortRoster — a preference, never a ranking', () => {
  const rows = rosterRows2(world([
    { id: 'c', name: 'Cara', x: 30, y: 30, activity: { verb: 'build', ticksRemaining: 2 } },
    { id: 'a', name: 'Ana', x: 0, y: 0 },
    { id: 'b', name: 'Bo', x: 0, y: 1, asleep: true },
  ], [struct({ id: 'well', kind: 'well', x: 1, y: 0 })]), [], null, 0)

  it('is total over ROSTER_SORTS, and never changes the SET', () => {
    for (const by of ROSTER_SORTS) {
      const sorted = sortRoster(rows, by as RosterSort)
      expect(sorted.map((r) => r.id).sort(), by).toEqual(rows.map((r) => r.id).sort())
      expect(sortRoster(rows, by), by).toEqual(sorted)     // stable across two reads
      expect(ROSTER_SORT_WORD[by].length).toBeGreaterThan(4)
      expect(ROSTER_SORT_WORD[by]).not.toMatch(GAMIFICATION_BAN)
    }
  })

  it('“by who is busy” puts the busy first and is not a ranking', () => {
    const active = sortRoster(rows, 'active')
    expect(active[0]!.name).toBe('Cara')
    const html = renderToStaticMarkup(createElement(RosterRowView, {
      row: active[0]!, open: false, onToggle: () => {},
    }))
    expect(html).not.toMatch(/\b(1st|#1|rank)\b/i)
  })

  it('“by where they are” groups the place, and the third id is `active`', () => {
    expect([...ROSTER_SORTS]).toEqual(['name', 'place', 'active'])
    const byPlace = sortRoster(rows, 'place').map((r) => r.place.words)
    expect([...byPlace].sort()).toEqual(byPlace)
  })
})

// ── the glyph ──────────────────────────────────────────────────────────────────────────────
describe('MOOD_GLYPH — a drawn face, never a character from the reader’s font', () => {
  it('is total over EXPRESSIONS and paints only MASTER_PALETTE members', () => {
    for (const e of EXPRESSIONS) {
      const g = MOOD_GLYPH[e]
      expect(g.length, e).toBeGreaterThan(20)
      for (const [x, y, fill] of g) {
        expect(x, e).toBeGreaterThanOrEqual(0)
        expect(x, e).toBeLessThan(MOOD_GLYPH_PX)
        expect(y, e).toBeGreaterThanOrEqual(0)
        expect(y, e).toBeLessThan(MOOD_GLYPH_PX)
        expect(MASTER_PALETTE, `${e} ${fill}`).toContain(fill.toUpperCase())
      }
    }
    for (const fill of MOOD_GLYPH_PALETTE) expect(MASTER_PALETTE, fill).toContain(fill.toUpperCase())
  })

  it('★ no two faces are the same picture — seven faces that look alike is one face', () => {
    const seen = new Map<string, string>()
    for (const e of EXPRESSIONS) {
      const sig = JSON.stringify(MOOD_GLYPH[e])
      expect(seen.has(sig), `${e} is identical to ${seen.get(sig)}`).toBe(false)
      seen.set(sig, e)
    }
  })

  it('every mood has a word for someone who cannot see it', () => {
    for (const e of EXPRESSIONS) {
      expect(MOOD_WORD[e].length, e).toBeGreaterThan(2)
      expect(MOOD_WORD[e], e).not.toMatch(GAMIFICATION_BAN)
      expect(MOOD_WORD[e], e).not.toMatch(/\d/)
    }
  })
})

// ── the rendered row ───────────────────────────────────────────────────────────────────────
describe('the rendered row', () => {
  const state = world([
    { id: 'amara', name: 'Amara', x: 10, y: 10, skills: { farming: 3 } },
    { id: 'yusuf', name: 'Yusuf', x: 11, y: 10 },
  ], [struct({ id: 'well', kind: 'well', x: 11, y: 11 })], DAY_TICKS)
  const row = rosterRows2(state, [], null, DAY_TICKS)[0]!
  const html = renderToStaticMarkup(createElement(RosterRowView, {
    row, open: false, onToggle: () => {},
  }))

  it('is one button with a spoken label naming all five fields', () => {
    expect(html.match(/<button/g)?.length).toBe(1)
    const label = rowLabel(row)
    expect(label).toContain('Amara')
    expect(label).toContain(row.state.toLowerCase())
    expect(label).toContain(MOOD_WORD[row.mood])
    expect(label).toContain(row.place.words)
    expect(label).toContain('Yusuf')
    expect(html).toContain(`aria-label="${label.replace(/"/g, '&quot;')}"`)
  })

  // ★ PROXIMITY IS NOT A BOND, AND THE ROW MUST NOT SAY IT IS.
  //
  // `row.with` is `companyOf` — who is inside earshot right now. It printed as "with Yusuf",
  // and the nav tab beside it is labelled BONDS. Merge train 3 read the two as one claim and
  // filed `BONDS 0` as a counter that lies. The count was right — the scripted founders never
  // speak, give, teach or share a roof, so the bond ledger genuinely holds nothing — and the
  // word was borrowed from a surface that means something else.
  it('★ says who is NEAR, never who someone is "with" — that word belongs to the bonds', () => {
    expect(row.with).toEqual(['Yusuf'])          // they are one tile apart, and that is all
    expect(html).toContain('near Yusuf')
    expect(html).not.toMatch(/\bwith Yusuf\b/)
    expect(rowLabel(row)).toContain('near Yusuf')
    expect(rowLabel(row)).not.toMatch(/\bwith Yusuf\b/)
    // and a body on its own still reads as a body on its own
    const alone = rosterRows2(world([{ id: 'amara', name: 'Amara', x: 10, y: 10 }], [], DAY_TICKS), [], null, DAY_TICKS)[0]!
    expect(rowLabel(alone)).toContain('alone')
  })

  it('draws the mood, and never borrows a glyph from the reader’s font', () => {
    expect(html).toContain('<svg')
    expect(html).toContain('shape-rendering="crispEdges"')
    expect(html).not.toMatch(EMOJI)
  })

  it('★ prints NO number anywhere a viewer can read — substance drives layout only', () => {
    const text = html.replace(/<[^>]*>/g, ' ')
    expect(text).not.toMatch(/\d/)
    expect(text).not.toMatch(GAMIFICATION_BAN)
    expect(row.substance).toBeGreaterThan(0)          // it is real, and still unprintable
    expect(html).not.toMatch(/substance/i)
    // it reaches the markup only as a WORD, so no arithmetic can leak through an attribute
    expect(html).toMatch(/data-lived="(none|some|much)"/)
    expect(html).not.toMatch(/data-\w+="[\d.]+"/)
  })

  it('says whether it is open, so the list can expand without losing its place', () => {
    expect(html).toContain('aria-expanded="false"')
    const opened = renderToStaticMarkup(createElement(RosterRowView, {
      row, open: true, onToggle: () => {},
    }))
    expect(opened).toContain('aria-expanded="true"')
  })
})

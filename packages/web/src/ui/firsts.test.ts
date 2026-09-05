import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { MilestoneRead } from '@sj/shared/narratorSchema'
import { FirstsView } from '../paper/pages/Chronicle.js'
import { FIRST_GLYPH_FALLBACK, firstGlyph } from './firstPlate.js'
import { firstsByTier } from './firsts.js'
import { chronicleGlyph } from './importantFeed.js'
import { EMPTY_COPY } from './townStats.js'
import type { Read } from './useEndpoint.js'

const first = (over: Partial<MilestoneRead> = {}): MilestoneRead => ({
  kind: 'first_fire',
  label: 'the first fire',
  eventSeq: 1,
  day: 0,
  tick: 300,
  tier: 1,
  domain: 'engine',
  agentIds: [],
  nameProvenance: null,
  ...over,
})

const view = (read: Read<MilestoneRead[]>): string =>
  renderToStaticMarkup(
    createElement(FirstsView, { read, viewTick: null, edge: 9_000, onPlay: () => {} }),
  )

describe('the firsts ledger, grouped as the chronicle reads it', () => {
  it('★ puts what the town made itself at the top, and the engine’s own firsts last', () => {
    const groups = firstsByTier([
      first({ kind: 'a', tier: 1 }),
      first({ kind: 'b', tier: 3 }),
      first({ kind: 'c', tier: 2 }),
      first({ kind: 'd', tier: 2.5 }),
    ])
    expect(groups.map((g) => g.tier)).toEqual([3, 2.5, 2, 1])
  })

  it('runs the firsts inside a heading in the order they happened', () => {
    const groups = firstsByTier([
      first({ kind: 'late', tier: 3, tick: 900 }),
      first({ kind: 'early', tier: 3, tick: 100 }),
    ])
    expect(groups[0]?.rows.map((r) => r.kind)).toEqual(['early', 'late'])
  })

  it('drops nothing: a tier these words do not cover keeps a heading of its own', () => {
    const groups = firstsByTier([first({ kind: 'odd', tier: 4 }), first({ kind: 'plain' })])
    expect(groups.flatMap((g) => g.rows.map((r) => r.kind))).toEqual(['odd', 'plain'])
    expect(groups[0]?.head).not.toBe(groups[1]?.head)
  })

  // The ledger stores a tier as a number. A number is a thing of ours, not of the town's.
  it('names every heading in words, never by its tier', () => {
    const groups = firstsByTier([1, 2, 2.5, 3, 7].map((tier, i) => first({ kind: `k${i}`, tier })))
    for (const g of groups) expect(g.head, g.head).not.toMatch(/\d/)
    expect(new Set(groups.map((g) => g.head)).size).toBe(groups.length)
  })
})

describe('the Firsts tab', () => {
  it('waits with the skeleton the other pages wait with', () => {
    const html = view({ data: null, loaded: false, failed: false })
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('skeleton-row')
    expect(html).not.toContain(EMPTY_COPY.firsts)
  })

  it('says one quiet line once it has asked and there is nothing', () => {
    const html = view({ data: [], loaded: true, failed: false })
    expect(html).toContain(EMPTY_COPY.firsts)
    expect(html).not.toContain('skeleton-row')
  })

  it('★ prints each first as the chronicle would say it, over the day it happened', () => {
    const html = view({ data: [first({ tick: 1500 })], loaded: true, failed: false })
    expect(html).toContain('the first fire')
    expect(html).toContain('Day 1 01:00')
    expect(html).toContain('class="feed-head"')
  })

  // ★ Every first used to wear the SAME `spark`, so a shelf of them read as one repeated thing.
  // A plate now wears the shape of what it is about.
  it('★ gives a first the glyph of the thing it is a first OF', () => {
    expect(firstGlyph('first_fire')).toBe('flame')
    expect(firstGlyph('first_death')).toBe('cross')
    expect(firstGlyph('first_law')).toBe('quill')
    // ordered rules: `first_fire_out` is still about fire, `first_grave` is still about a death
    expect(firstGlyph('first_fire_out')).toBe('flame')
    expect(firstGlyph('first_grave')).toBe('cross')
    // and a kind nobody has written a rule for is still a first, not a blank plate
    expect(firstGlyph('first_something_minted')).toBe(FIRST_GLYPH_FALLBACK)
    const html = view({ data: [first()], loaded: true, failed: false })
    for (const [x, y] of chronicleGlyph('flame').pixels)
      expect(html, `${x},${y}`).toContain(`x="${x}" y="${y}"`)
  })

  it('★ prints NO tier number, and no count, bar, streak or badge anywhere', () => {
    const html = view({
      data: [first({ kind: 'first_fire', tier: 1 }), first({ kind: 'first_law', tier: 3 })],
      loaded: true,
      failed: false,
    })
    expect(html).not.toMatch(/tier/i)
    expect(html).not.toMatch(/\b\d+\s*(of|\/)\s*\d+\b/)
    for (const word of ['progress', 'streak', 'badge', 'points', 'leaderboard', 'unlocked'])
      expect(html.toLowerCase(), word).not.toContain(word)
    // the rarity is the material instead
    expect(html).toContain('data-material="sand"')
    expect(html).toContain('data-material="gilded"')
  })

  it('★ turns a corner down for a first reached while nobody was watching', () => {
    const rows = [
      first({ kind: 'first_fire', tick: 500 }),
      first({ kind: 'first_law', tick: 9000 }),
    ]
    const seen = renderToStaticMarkup(
      createElement(FirstsView, {
        read: { data: rows, loaded: true, failed: false },
        viewTick: null,
        edge: 9_000,
        lastVisit: 1000,
        onPlay: () => {},
      }),
    )
    expect(seen.match(/data-fresh="yes"/g)).toHaveLength(1)
    // a first visit has no watermark, so nothing is new and nothing is dog-eared
    expect(view({ data: rows, loaded: true, failed: false })).not.toContain('data-fresh')
  })

  it('★ makes every first a way back to the minute it happened in', () => {
    const html = renderToStaticMarkup(
      createElement(FirstsView, {
        read: { data: [first({ tick: 1500 })], loaded: true, failed: false },
        viewTick: 1500,
        edge: 9_000,
        onPlay: () => {},
      }),
    )
    expect(html).toMatch(/data-current="yes"/)
    expect(html).toContain('Watch this moment.')
    expect(html).toContain('class="first-watch"')
  })

  // A name the town gave itself is printed with the words it came out of, verbatim.
  it('★ quotes the naming under a first the town named, and only there', () => {
    const named = first({
      kind: 'first_name_c1',
      label: 'the day they had a word of their own for it: Emberfall',
      tier: 3,
      nameProvenance: {
        name: 'Emberfall',
        sourceKind: 'speech',
        eventSeq: 9,
        quote: 'we should call it Emberfall',
        byId: 'amara',
      },
    })
    const html = view({ data: [named, first()], loaded: true, failed: false })
    expect(html).toContain('class="first-quote"')
    expect(html).toContain('we should call it Emberfall')
    expect(html.match(/first-quote/g)).toHaveLength(1)
  })
})

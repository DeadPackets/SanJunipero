import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CHRONICLE_FALLBACK_ICON, MILESTONE_ICON } from '@sj/shared'
import type { MilestoneRead } from '@sj/shared/narratorSchema'
import { FirstsView } from '../paper/pages/Chronicle.js'
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
  constructId: null,
  nameProvenance: null,
  ...over,
})

const view = (read: Read<MilestoneRead[]>): string =>
  renderToStaticMarkup(createElement(FirstsView, { read, viewTick: null, onJump: () => {} }))

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

  // The curated feed already draws a milestone with `MILESTONE_ICON`; a second glyph for the
  // same thing would read as a second kind of thing.
  it('★ draws a first with the glyph the record already gives one', () => {
    expect(chronicleGlyph(MILESTONE_ICON).label).toBe('a first')
    expect(MILESTONE_ICON).not.toBe(CHRONICLE_FALLBACK_ICON)
    const html = view({ data: [first()], loaded: true, failed: false })
    for (const [x, y] of chronicleGlyph(MILESTONE_ICON).pixels)
      expect(html, `${x},${y}`).toContain(`x="${x}" y="${y}"`)
  })

  it('★ makes every first a way back to the minute it happened in', () => {
    const html = renderToStaticMarkup(
      createElement(FirstsView, {
        read: { data: [first({ tick: 1500 })], loaded: true, failed: false },
        viewTick: 1500,
        onJump: () => {},
      }),
    )
    expect(html).toMatch(/class="feed-jump"[^>]*aria-current="true"/)
    expect(html).toContain('Go to this moment.')
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
    expect(html).toContain('class="discovery-quote"')
    expect(html).toContain('we should call it Emberfall')
    expect(html.match(/discovery-quote/g)).toHaveLength(1)
  })
})

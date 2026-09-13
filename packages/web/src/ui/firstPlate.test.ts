import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Moment } from '@sj/shared'
import { FIRST_GLYPH_FALLBACK, firstGlyph, firstPlate, isNew, plateMaterial } from './firstPlate.js'
import { chronicleGlyph } from './importantFeed.js'
import { momentDays, moreFromDay } from './momentThumb.js'

const src = (f: string): string => readFileSync(new URL(f, import.meta.url), 'utf8')
const CSS = src('./chrome.css')
/** The rules alone: a comment saying a thing is absent must not read as the thing. */
const bare = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')

// ★ "Gamified designs that are attractive to the eye because they should be significant" — which
// here is CEREMONY, NOT COMPETITION. Nobody competes in this town, tier 2.5 is minted by the
// arbiter, and the catalogue has no denominator: "23 of 61" would be a lie.
describe('★ a first is a plate, and the plate keeps no score', () => {
  it('★ carries the tier as MATERIAL, and prints the number nowhere', () => {
    expect(plateMaterial(3)).toBe('gilded')
    expect(plateMaterial(2.5)).toBe('ember')
    expect(plateMaterial(2)).toBe('sage')
    expect(plateMaterial(1)).toBe('sand')
    // a tier nobody has named is still a plate, in the quietest of the four
    expect(plateMaterial(4)).toBe('sand')
    // ...and the number never reaches the plate at all, so nothing downstream can print it
    expect(firstPlate({ tier: 3 } as never, null)).not.toHaveProperty('tier')
  })

  it('★ the material is the slab’s own ledge, not a coloured stripe down one edge', () => {
    const block = CSS.slice(CSS.indexOf('.first-plate {'), CSS.indexOf('.first-emblem'))
    expect(block).toContain('box-shadow: var(--frame-tight), 4px 4px 0 0 var(--plate-ink)')
    expect(block).not.toMatch(/border-left:\s*\d/)
    for (const m of ['gilded', 'ember', 'sage', 'sand'])
      expect(block, m).toContain(`[data-material='${m}']`)
  })

  it('★ has no count, bar, streak, point, badge or leaderboard anywhere in the sheet’s rules', () => {
    const shelf = bare(CSS.slice(CSS.indexOf('.first-shelf {'))).toLowerCase()
    for (const word of ['progress', 'streak', 'badge', 'leaderboard', 'points', 'confetti'])
      expect(shelf, word).not.toContain(word)
  })

  it('★ a glyph per subject: the shelf no longer reads as one repeated thing', () => {
    const kinds = [
      'first_speech',
      'first_structure',
      'first_fire',
      'first_death',
      'first_law',
      'first_road',
      'first_harvest',
      'first_birth',
      'first_invention',
      'first_year',
    ]
    const shapes = new Set(kinds.map(firstGlyph))
    expect(shapes.size).toBeGreaterThanOrEqual(7)
    // and every one of them is a shape the chronicle already draws
    for (const kind of kinds)
      expect(chronicleGlyph(firstGlyph(kind)).pixels.length, kind).toBeGreaterThan(0)
  })

  it('gives a kind nobody wrote a rule for the general shape rather than a blank', () => {
    expect(firstGlyph('first_something_the_arbiter_minted')).toBe(FIRST_GLYPH_FALLBACK)
    expect(chronicleGlyph(FIRST_GLYPH_FALLBACK).pixels.length).toBeGreaterThan(0)
  })

  it('★ dog-ears only what happened since the last visit, and never on a first visit', () => {
    expect(isNew({ tick: 900 }, 500)).toBe(true)
    expect(isNew({ tick: 500 }, 500)).toBe(false)
    expect(isNew({ tick: 900 }, null)).toBe(false)
  })

  it('★ reads the watermark BEFORE the socket walks it forward', () => {
    // socket.ts writes sj:lastSeenTick on the first snapshot, so anything asking what the viewer
    // missed has to have captured it at module load
    expect(src('./storage.ts')).toContain('const VISIT_WATERMARK')
    expect(src('../net/socket.ts')).toContain("const LAST_SEEN_KEY = 'sj:lastSeenTick'")
  })

  it('builds the whole plate off one row, with the naming quoted only where there is one', () => {
    const row = {
      kind: 'first_fire',
      label: 'the first fire',
      eventSeq: 1,
      day: 0,
      tick: 300,
      tier: 3,
      domain: 'engine',
      agentIds: ['a1'],
      nameProvenance: null,
    }
    expect(firstPlate(row, 100)).toEqual({
      kind: 'first_fire',
      label: 'the first fire',
      glyph: 'flame',
      material: 'gilded',
      tick: 300,
      cast: ['a1'],
      quote: null,
      quoteDay: null,
      fresh: true,
    })
  })

  // ★ Two quotes can reach one plate: the words the town named a thing out of, and the line the
  // narrator caught the first itself in. Only the second one knows which day it was said on.
  it('★ prefers the line the first was caught in, and carries the day with it', () => {
    const row = {
      kind: 'first_promise',
      label: 'the first promise',
      eventSeq: 2,
      day: 4,
      tick: 6000,
      tier: 2.5,
      domain: 'semantic',
      agentIds: ['amara'],
      nameProvenance: { name: 'x', sourceKind: 'speech' as const, eventSeq: 2, quote: 'a name' },
      detected: { quote: 'I will come back for the boat', day: 4 },
    }
    expect(firstPlate(row, null)).toMatchObject({
      quote: 'I will come back for the boat',
      quoteDay: 4,
    })
    expect(firstPlate({ ...row, detected: null }, null)).toMatchObject({
      quote: 'a name',
      quoteDay: null,
    })
  })
})

// ★ Moments are a data problem before a design problem.
describe('★ one scene is one card, and one day leads with what was at stake', () => {
  const m = (over: Partial<Moment>): Moment => ({
    id: 1,
    day: 0,
    startTick: 0,
    endTick: 10,
    title: 'x',
    cast: [],
    location: null,
    kind: 'talk',
    stakes: 0,
    summary: null,
    ...over,
  })

  it('★ leads each day with the highest stakes, and the earlier scene breaks a tie', () => {
    const days = momentDays([
      m({ id: 1, day: 1, startTick: 1500, stakes: 3, title: 'quiet' }),
      m({ id: 2, day: 1, startTick: 1600, stakes: 9, title: 'the quarrel' }),
      m({ id: 3, day: 1, startTick: 1400, stakes: 9, title: 'the earlier quarrel' }),
      m({ id: 4, day: 0, startTick: 10, stakes: 1, title: 'the well' }),
    ])
    expect(days.map((d) => d.day)).toEqual([1, 0]) // newest day first
    expect(days[0]!.lead.title).toBe('the earlier quarrel')
    expect(days[0]!.rest.map((r) => r.title)).toEqual(['the quarrel', 'quiet'])
    expect(days[1]!.rest).toEqual([])
  })

  it('★ puts the rest of a day behind one word, and counts nothing over a total', () => {
    expect(moreFromDay([m({})])).toBe('One more from this day')
    expect(moreFromDay([m({}), m({})])).toBe('2 more from this day')
    expect(moreFromDay([m({}), m({})])).not.toMatch(/\bof\b|\/|%/)
  })

  it('holds a day with one scene to one card and offers nothing to open', () => {
    const days = momentDays([m({ id: 1, day: 4, stakes: 2 })])
    expect(days).toHaveLength(1)
    expect(days[0]!.rest).toHaveLength(0)
  })
})

import { describe, expect, it } from 'vitest'
import type { Moment } from '@sj/shared'
import { MOTIFS, THUMB_CAST_MAX, thumbLabel, thumbMotif, thumbTitle } from './momentThumb.js'
import { GLYPH_PALETTE } from './importantFeed.js'

const moment = (over: Partial<Moment> = {}): Moment => ({
  id: 1,
  day: 3,
  startTick: 4320,
  endTick: 4380,
  title: 'What the Fire Took',
  cast: ['alice', 'bob'],
  location: 'the plaza',
  ...over,
})

const people = {
  alice: { name: 'Rahel', alive: true },
  bob: { name: 'Tomas', alive: true },
  cara: { name: 'Mira', alive: true },
}

describe('thumbLabel', () => {
  it('names who was there, by their names', () => {
    expect(thumbLabel(moment(), people)).toEqual({
      day: 3,
      cast: 'Rahel, Tomas',
      location: 'the plaza',
    })
  })

  it('names at most two, and says how many more were there', () => {
    const four = thumbLabel(moment({ cast: ['alice', 'bob', 'cara', 'dan'] }), people)
    expect(four.cast).toBe('Rahel, Tomas +2')
    expect(THUMB_CAST_MAX).toBe(2)
  })

  it('says the town when the day named nobody', () => {
    expect(thumbLabel(moment({ cast: [] }), people).cast).toBe('the town')
  })

  it('says someone for a mind the snapshot has dropped, never its id', () => {
    expect(thumbLabel(moment({ cast: ['ghost'] }), people).cast).toBe('someone')
  })

  it('carries a day with no place as no place', () => {
    expect(thumbLabel(moment({ location: null }), people).location).toBeNull()
  })
})

describe('thumbTitle', () => {
  it('passes the day’s own name through', () => {
    expect(thumbTitle(moment())).toBe('What the Fire Took')
    expect(thumbTitle(moment({ title: 'Day 9' }))).toBe('Day 9')
  })
})

describe('thumbMotif', () => {
  it('reads the place and draws it', () => {
    expect(thumbMotif(moment({ location: 'the plaza' })).name).toBe('stone')
    expect(thumbMotif(moment({ location: 'the riverbank' })).name).toBe('water')
    expect(thumbMotif(moment({ location: 'the north field' })).name).toBe('field')
    expect(thumbMotif(moment({ location: "Rahel's house" })).name).toBe('hearth')
    expect(thumbMotif(moment({ location: 'the forest edge' })).name).toBe('tree')
  })

  it('does not care how the place is capitalised', () => {
    expect(thumbMotif(moment({ location: 'The Plaza' })).name).toBe('stone')
  })

  it('is deterministic for a place it has never seen, and for a day with no place at all', () => {
    const odd = moment({ location: 'somewhere nobody named' })
    expect(thumbMotif(odd)).toBe(thumbMotif(odd))
    const nowhere = moment({ location: null, day: 7 })
    expect(thumbMotif(nowhere)).toBe(thumbMotif(nowhere))
    expect(MOTIFS.map((m) => m.name)).toContain(thumbMotif(nowhere).name)
  })

  it('draws every motif in the master palette, on the 8×8 grid', () => {
    for (const motif of MOTIFS) {
      expect(motif.pixels.length, motif.name).toBeGreaterThan(0)
      for (const [x, y, fill] of motif.pixels) {
        expect(GLYPH_PALETTE, `${motif.name} ${fill}`).toContain(fill)
        expect(x, motif.name).toBeGreaterThanOrEqual(0)
        expect(x, motif.name).toBeLessThan(8)
        expect(y, motif.name).toBeGreaterThanOrEqual(0)
        expect(y, motif.name).toBeLessThan(8)
      }
    }
  })
})

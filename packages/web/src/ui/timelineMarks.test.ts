import { describe, expect, it } from 'vitest'
import {
  MARK_COALESCE_TICKS, MARK_GLYPH, MARK_GLYPH_PALETTE, MARK_GLYPH_PX, MARK_KINDS,
  MARK_MIN_WEIGHT, MARK_SLOTS, MARK_STRUCTURE_INKS, MARK_WEIGHT,
  coalesceMarks, marksFrom, type Mark, type MarkKind,
} from './timelineMarks.js'
import { GAMIFICATION_BAN } from './townStats.js'

const DAY = 1440

/** Five narrated days of a town that has actually lived — the shape /api/timeline/marks folds. */
const MATURE = {
  chapters: [
    { day: 0, title: 'The first morning' }, { day: 1, title: 'Rain on the new roof' },
    { day: 2, title: 'A quarrel at the well' }, { day: 3, title: 'The storehouse fills' },
  ],
  milestones: [
    { label: 'The first fire was lit', day: 0, tick: 380 },
    { label: 'The first harvest came in', day: 3, tick: 3 * DAY + 500 },
  ],
  moments: [
    { day: 0, startTick: 360 }, { day: 4, startTick: 4 * DAY + 360 },
  ],
  changes: [{ tick: 2 * DAY + 100 }, { tick: 4 * DAY + 900 }],
  events: [
    { tick: 1 * DAY + 620, type: 'structure_completed' },
    { tick: 2 * DAY + 900, type: 'agent_injured' },
    { tick: 3 * DAY + 30, type: 'agent_died' },
    { tick: 4 * DAY + 200, type: 'agent_born' },
    { tick: 0, type: 'agent_spawned' },
    { tick: 5 * DAY, type: 'agent_moved' },   // noise: nothing the town would remember
  ],
}

describe('U14 — the marks come from the record, not from the ring', () => {
  const marks = marksFrom(MATURE)

  it('finds something to mark on a town that has lived', () => {
    expect(marks.length).toBeGreaterThan(0)
  })

  it('reaches every kind of mark it defines, from the sources it is given', () => {
    expect(new Set(marks.map((m) => m.kind))).toEqual(new Set(MARK_KINDS))
  })

  it('answers an unlived town with nothing rather than with invention', () => {
    expect(marksFrom({ chapters: [], milestones: [], moments: [], changes: [], events: [] })).toEqual([])
  })

  it('ignores an event the town would not remember', () => {
    expect(marks.some((m) => m.tick === 5 * DAY)).toBe(false)
  })

  it('does not mark a narrated day twice because it is both a chapter and a scene', () => {
    const day0 = marks.filter((m) => m.kind === 'chapter' && m.tick < DAY)
    expect(day0).toHaveLength(1)
    expect(day0[0]!.words).toBe('The first morning')
  })

  it('marks a day the narrator kept but never titled', () => {
    const day4 = marks.find((m) => m.kind === 'chapter' && m.tick === 4 * DAY + 360)
    expect(day4?.words).toBe('Day 4')
  })

  it('comes back in tick order, whatever order the sources arrive in', () => {
    for (let i = 1; i < marks.length; i++) expect(marks[i]!.tick).toBeGreaterThanOrEqual(marks[i - 1]!.tick)
  })

  it('carries the weight its kind is worth, and never one below the floor', () => {
    for (const m of marks) {
      expect(m.weight).toBe(MARK_WEIGHT[m.kind])
      expect(m.weight).toBeGreaterThanOrEqual(MARK_MIN_WEIGHT)
    }
  })
})

describe('P22.5 — a day somebody changed outranks a thing that merely happened', () => {
  it('ranks change and firsts above everything the town merely did', () => {
    expect(MARK_WEIGHT.changed).toBeGreaterThan(MARK_WEIGHT.built)
    expect(MARK_WEIGHT.first).toBeGreaterThan(MARK_WEIGHT.built)
    expect(MARK_WEIGHT.changed).toBeGreaterThan(MARK_WEIGHT.chapter)
    expect(Math.min(...Object.values(MARK_WEIGHT))).toBe(MARK_MIN_WEIGHT)
  })

  it('keeps the change when a change and a building land on the same pixel', () => {
    const changed: Mark = { tick: 900, kind: 'changed', words: 'Someone changed', weight: MARK_WEIGHT.changed }
    const built: Mark = { tick: 900, kind: 'built', words: 'A building was finished', weight: MARK_WEIGHT.built }
    const out = coalesceMarks([built, changed], 1440)
    expect(out).toHaveLength(1)
    expect(out[0]!.kind).toBe('changed')
  })

  it('decides by weight and not by the order the marks arrived in', () => {
    const a: Mark = { tick: 10, kind: 'built', words: 'x', weight: MARK_WEIGHT.built }
    const b: Mark = { tick: 10, kind: 'death', words: 'y', weight: MARK_WEIGHT.death }
    expect(coalesceMarks([a, b], 1440)[0]!.kind).toBe('death')
    expect(coalesceMarks([b, a], 1440)[0]!.kind).toBe('death')
  })
})

describe('coalesceMarks — a busy day is a mark, not a smear', () => {
  const death = (tick: number): Mark =>
    ({ tick, kind: 'death', words: 'Someone died', weight: MARK_WEIGHT.death })

  // A day-long span is where MARK_COALESCE_TICKS is the whole rule: on a longer one the track
  // runs out of room first and the window widens, which the next case measures.
  it('collapses three deaths inside the window into one mark that says how many', () => {
    const out = coalesceMarks([death(0), death(30), death(59)], DAY)
    expect(out).toHaveLength(1)
    expect(out[0]!.words).toBe('3 people died')
    expect(out[0]!.tick).toBe(0)
  })

  it('keeps two deaths past the window as two', () => {
    const out = coalesceMarks([death(0), death(61)], DAY)
    expect(out).toHaveLength(2)
    expect(out.map((m) => m.words)).toEqual(['Someone died', 'Someone died'])
  })

  it('names the window it is coalescing over', () => {
    expect(MARK_COALESCE_TICKS).toBe(60)
  })

  it('widens the window on a long span, so a year does not draw a solid bar', () => {
    const span = 400 * DAY
    const many = Array.from({ length: 40 }, (_, i) => death(i * 200))
    expect(coalesceMarks(many, span).length).toBeLessThan(many.length)
    expect(coalesceMarks(many, 1440).length).toBe(many.length)
  })

  it('never draws more marks than the track has room for', () => {
    const span = 30 * DAY
    const crowd: Mark[] = []
    for (let t = 0; t < span; t += 7) crowd.push(death(t))
    expect(coalesceMarks(crowd, span).length).toBeLessThanOrEqual(MARK_SLOTS)
  })

  it('takes an empty record without throwing', () => {
    expect(coalesceMarks([], 1440)).toEqual([])
    expect(coalesceMarks([death(0)], 0)).toHaveLength(1)
  })
})

describe('the marks are drawn, and they are told apart by their shape', () => {
  it('has a glyph for every kind and no glyph without a kind', () => {
    expect(Object.keys(MARK_GLYPH).sort()).toEqual([...MARK_KINDS].sort())
  })

  it('draws no two kinds the same', () => {
    const seen = new Map<string, MarkKind>()
    for (const kind of MARK_KINDS) {
      const sig = JSON.stringify([...MARK_GLYPH[kind]].sort())
      expect(seen.get(sig), `${kind} is drawn exactly like ${seen.get(sig)}`).toBeUndefined()
      seen.set(sig, kind)
    }
  })

  it('paints only master-palette members, inside the glyph grid', () => {
    for (const kind of MARK_KINDS) {
      expect(MARK_GLYPH[kind].length, kind).toBeGreaterThan(3)
      for (const [x, y, fill] of MARK_GLYPH[kind]) {
        expect(MARK_GLYPH_PALETTE, `${kind} ${fill}`).toContain(fill)
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThan(MARK_GLYPH_PX)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThan(MARK_GLYPH_PX)
      }
    }
  })

  // MEASURED, not chosen: of the eight tokens the chrome paints marks with, only ink (7.63)
  // and deep (11.24) clear 3:1 on the sand track. Honey is 1.10 and sage 1.61 — a mark drawn
  // in either is a smudge. So the warm hues are interior detail and never the shape.
  const ch = (v: number): number => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  const lum = (hex: string): number => {
    const [r, g, b] = [1, 3, 5].map((i) => ch(Number.parseInt(hex.slice(i, i + 2), 16) / 255))
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
  }
  const ratio = (a: string, b: string): number => {
    const [x, y] = [lum(a), lum(b)]
    const [hi, lo] = x > y ? [x, y] : [y, x]
    return (hi + 0.05) / (lo + 0.05)
  }
  const SAND = '#E8D5BC'

  it('names as structural only the inks that really do clear 3:1 on the track', () => {
    for (const hex of MARK_STRUCTURE_INKS) expect(ratio(hex, SAND), hex).toBeGreaterThanOrEqual(3)
    for (const hex of MARK_GLYPH_PALETTE) {
      if (MARK_STRUCTURE_INKS.includes(hex)) continue
      expect(ratio(hex, SAND), `${hex} is not structural and must not claim to be`).toBeLessThan(3)
    }
  })

  it('draws every mark mostly in an ink that clears the track', () => {
    for (const kind of MARK_KINDS) {
      const px = MARK_GLYPH[kind]
      const structural = px.filter(([, , f]) => MARK_STRUCTURE_INKS.includes(f)).length
      expect(structural / px.length, kind).toBeGreaterThanOrEqual(0.6)
    }
  })

  it('is still eight different marks with the colour taken away', () => {
    const seen = new Map<string, MarkKind>()
    for (const kind of MARK_KINDS) {
      const sig = JSON.stringify(MARK_GLYPH[kind].map(([x, y]) => `${x},${y}`).sort())
      expect(seen.get(sig), `${kind} has the same silhouette as ${seen.get(sig)}`).toBeUndefined()
      seen.set(sig, kind)
    }
  })
})

describe('what a mark says out loud', () => {
  const marks = marksFrom(MATURE)

  it('never prints a machine word', () => {
    for (const m of marks) {
      expect(m.words, m.kind).not.toMatch(/_|agent_|structure_|\bnull\b|\bundefined\b/)
      expect(m.words.length).toBeGreaterThan(3)
    }
  })

  it('never reads as a game', () => {
    for (const m of marks) expect(m.words, m.kind).not.toMatch(GAMIFICATION_BAN)
  })

  it('says a milestone in the narrator own words', () => {
    expect(marks.find((m) => m.kind === 'first')?.words).toBe('The first fire was lit')
  })
})

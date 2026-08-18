import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TimelineView } from './Timeline.js'
import { RECENT_EVENTS_CAP } from '../state/worldStore.js'
import {
  MARK_GLYPH_PX, MARK_GLYPH_SCALE, MARK_HIT_PX, coalesceMarks, markLeft, marksFrom, tipSide,
  type Mark,
} from './timelineMarks.js'
import { BODY_MIN_PX, TEXT_MIN_PX } from '../textFloor.js'
import { fontSizes } from './chromeType.test.js'

const CSS = readFileSync(new URL('./chrome.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const DAY = 1440

const ruleBody = (selector: string): string => {
  const hits: string[] = []
  for (const [, sel, body] of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if ((sel ?? '').split(',').some((s) => s.trim() === selector)) hits.push(body ?? '')
  }
  if (hits.length === 0) throw new Error(`no rule for ${selector}`)
  return hits.join(';')
}
const px = (selector: string, prop: string): number => {
  const raw = new RegExp(`${prop}:\\s*([\\d.]+)(px|rem)`).exec(ruleBody(selector))
  if (raw === null) throw new Error(`${selector} sets no ${prop}`)
  return Number.parseFloat(raw[1]!) * (raw[2] === 'rem' ? 16 : 1)
}

// Six narrated days of a town that has lived — what /api/timeline/marks folds.
const MARKS: Mark[] = coalesceMarks(marksFrom({
  chapters: [
    { day: 0, title: 'The first morning' }, { day: 1, title: 'Rain on the new roof' },
    { day: 2, title: 'A quarrel at the well' }, { day: 3, title: 'The storehouse fills' },
  ],
  milestones: [
    { label: 'The first fire was lit', day: 0, tick: 380 },
    { label: 'The first harvest came in', day: 3, tick: 3 * DAY + 500 },
  ],
  moments: [{ day: 5, startTick: 5 * DAY + 360 }],
  changes: [{ tick: 2 * DAY + 100 }],
  events: [
    { tick: 1 * DAY + 620, type: 'structure_completed' },
    { tick: 3 * DAY + 30, type: 'agent_died' },
    { tick: 4 * DAY + 200, type: 'agent_born' },
  ],
}), 6 * DAY)

const view = (over: Partial<Parameters<typeof TimelineView>[0]> = {}): string =>
  renderToStaticMarkup(createElement(TimelineView, {
    edge: 6 * DAY, viewTick: 3 * DAY, live: false, marks: MARKS,
    onScrub: () => {}, onLive: () => {}, ...over,
  }))

describe('U14 — the scrubber has somewhere to aim', () => {
  it('cannot get its marks from the ring, and the ring is why there were none', () => {
    // The landed Timeline read `store.recentEvents()`. That ring holds 400 entries and only
    // what arrived since this viewer connected — a mature world records tens of thousands.
    expect(RECENT_EVENTS_CAP).toBe(400)
    expect(MARKS.length).toBeGreaterThan(0)
  })

  it('draws a mark for every day the record kept', () => {
    const html = view()
    const drawn = [...html.matchAll(/class="mark [a-z]+"/g)].length
    expect(drawn).toBe(MARKS.length)
    expect(drawn).toBeGreaterThanOrEqual(8)
  })

  it('draws them without a single event in the ring, because the ring is not the source', () => {
    expect([...view().matchAll(/class="mark /g)].length).toBeGreaterThan(0)
  })

  it('says nothing rather than inventing marks on a town with no record', () => {
    const html = view({ marks: [] })
    expect(html).not.toContain('class="mark ')
    expect(html).toContain('timeline-track')          // the scrubber still works
  })

  it('places every mark inside the track, in proportion to when it happened', () => {
    const lefts = [...view().matchAll(/class="mark [a-z]+"[^>]*left:\s*clamp\([^,]+,\s*([\d.]+)%/g)]
    expect(lefts.length).toBe(MARKS.length)
    for (const [, pct] of lefts) {
      expect(Number(pct)).toBeGreaterThanOrEqual(0)
      expect(Number(pct)).toBeLessThanOrEqual(100)
    }
  })

  // WHAT THE BROWSER CAUGHT: a mark at tick 0 was centred on the track's first pixel, so half
  // of it drew outside the slab, under the frame.
  it('keeps the first and last marks whole instead of half under the frame', () => {
    const half = MARK_HIT_PX / 2
    expect(markLeft(0, 6 * DAY)).toBe(`clamp(${half}px, 0%, calc(100% - ${half}px))`)
    expect(markLeft(6 * DAY, 6 * DAY)).toBe(`clamp(${half}px, 100%, calc(100% - ${half}px))`)
    expect(markLeft(3 * DAY, 6 * DAY)).toContain('50%')
    expect(markLeft(10, 0)).toContain('0%')      // a town one tick old divides by nothing
  })

  // WHAT THE BROWSER CAUGHT: "5 people arrived in the town", centred on the first mark, ran
  // off the left of the viewport and rendered as "arrived in the town".
  it('hangs a tip from the edge it is near, so no word is cut off', () => {
    expect(tipSide(0, 6 * DAY)).toBe('start')
    expect(tipSide(6 * DAY, 6 * DAY)).toBe('end')
    expect(tipSide(3 * DAY, 6 * DAY)).toBe('center')
    expect(view()).toContain('data-side="start"')
  })

  it('draws each mark as palette pixels, never as an emoji or a coloured dot', () => {
    const html = view()
    expect(html).toContain('shape-rendering="crispEdges"')
    expect(html).toContain(`viewBox="0 0 ${MARK_GLYPH_PX} ${MARK_GLYPH_PX}"`)
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u)
  })

  // The forge lane owns how much detail the art carries; this lane owns not wrecking it.
  it('scales the art by a whole number, so no mark is resampled', () => {
    expect(Number.isInteger(MARK_GLYPH_SCALE)).toBe(true)
    expect(MARK_GLYPH_PX * MARK_GLYPH_SCALE).toBeLessThanOrEqual(MARK_HIT_PX)
    expect(view()).toContain(`width="${MARK_GLYPH_PX * MARK_GLYPH_SCALE}"`)
  })
})

describe('every mark is reachable, by pointer and by voice', () => {
  const html = view()

  it('is a button with a spoken label that says the day and what happened', () => {
    expect(html).toMatch(/<button[^>]*class="mark chapter"[^>]*aria-label="Day 0[^"]*The first morning/)
    expect(html).toMatch(/aria-label="[^"]*Go to this moment\."/)
  })

  it('keeps its glyph out of the accessibility tree', () => {
    for (const [, tail] of html.matchAll(/<svg class="mark-glyph"([^>]*)>/g)) {
      expect(tail).toContain('aria-hidden="true"')
    }
  })

  it('gives every mark a target at or above the 24px floor', () => {
    expect(px('.mark', 'width')).toBeGreaterThanOrEqual(24)
    expect(px('.mark', 'height')).toBeGreaterThanOrEqual(24)
  })
})

describe('the scrubber the marks sit on still behaves', () => {
  const html = view()

  it('is still a slider, and still says where it is in words', () => {
    expect(html).toContain('role="slider"')
    expect(html).toContain('aria-valuemin="0"')
    expect(html).toContain(`aria-valuemax="${6 * DAY}"`)
    expect(html).toContain(`aria-valuenow="${3 * DAY}"`)
    expect(html).toContain('aria-valuetext="Day 3 00:00"')
  })

  it('offers the way back to now, and says which it is', () => {
    expect(html).toContain('Return to now')
    expect(view({ live: true })).toContain('>LIVE<')
  })

  it('still rules the days off', () => {
    expect([...html.matchAll(/class="timeline-day"/g)].length).toBe(7)   // day 0 through day 6
  })

  it('takes a town one tick old without dividing by nothing', () => {
    expect(() => view({ edge: 0, viewTick: 0, marks: [] })).not.toThrow()
  })
})

describe('U14 — and the font is not too small any more', () => {
  const DECLS = fontSizes(CSS)
  const sizeOf = (sel: string): number[] =>
    DECLS.filter((d) => d.selectors.split(',').some((s) => s.trim() === sel)).map((d) => d.px)

  it('reads the day label at prose size, not at the bare floor', () => {
    const sizes = sizeOf('.timeline-day em')
    expect(sizes.length).toBeGreaterThan(0)
    for (const s of sizes) expect(s).toBeGreaterThanOrEqual(BODY_MIN_PX)
  })

  it('holds every other word in the timeline at the floor or above', () => {
    for (const sel of ['.live-pill', '.mark-tip']) {
      const sizes = sizeOf(sel)
      expect(sizes.length, sel).toBeGreaterThan(0)
      for (const s of sizes) expect(s, sel).toBeGreaterThanOrEqual(TEXT_MIN_PX)
    }
  })

  it('gives the track a body a pointer can hit', () => {
    expect(px('.timeline-track', 'height')).toBeGreaterThanOrEqual(24)
  })
})

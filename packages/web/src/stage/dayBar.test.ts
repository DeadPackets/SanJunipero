// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { DAYS_PER_SEASON, MINUTES_PER_DAY } from '@sj/shared'
import type { WorldState } from '@sj/engine/state'
import { tickBadgeState, type LinkState } from '../ui/broadcastReady.js'
import { createWorldStore, type WorldStore } from '../state/worldStore.js'
import { BROADCAST_CAPTIONS } from '../ui/broadcast.js'
import { MARK_KINDS, markInk, marksFrom } from '../ui/timelineMarks.js'
import { stamp } from '../paper/stamp.js'
import {
  DayBar,
  dayFrac,
  dayStart,
  deadFrom,
  marksOfDay,
  pickTick,
  sleepField,
  stampWord,
  trackTick,
} from './DayBar.js'

// happy-dom's own `URL` resolves a bare path against localhost, so a file read has to be a path.
const CSS = readFileSync(join(import.meta.dirname, '../ui/chrome.css'), 'utf8')
const at = (h: number, min = 0): number => h * 60 + min
const DAY_12 = 12 * MINUTES_PER_DAY + at(9, 40)
const EDGE = 400 * MINUTES_PER_DAY

const body = (alive: boolean, asleep: boolean) => ({ alive, asleep })

const townAt = (tick: number, over: Partial<WorldState> = {}): WorldStore => ({
  ...createWorldStore(),
  getTick: () => tick,
  liveEdge: () => EDGE,
  getState: () =>
    ({
      tick,
      agents: {},
      weather: { kind: 'sunny', temperatureC: 12 },
      ...over,
    }) as unknown as WorldState,
})

/** All three at once: the town asleep, a storm running, and a viewer watching it back. */
const asleepInAStormWatchedBack = (): WorldStore => ({
  ...townAt(DAY_12, {
    weather: { kind: 'storm', temperatureC: 4 },
    agents: { a: body(true, true) },
  } as never),
  getMode: () => ({ live: false, replaying: false, tick: DAY_12 }),
})

const props = (store: WorldStore, link: LinkState, broadcast: boolean) => ({
  store,
  link,
  handle: null,
  onAt: () => undefined,
  autoCut: true,
  handbackAt: () => null,
  broadcast,
})

const bar = (store: WorldStore, link: LinkState = 'online'): string =>
  renderToStaticMarkup(createElement(DayBar, props(store, link, false)))

/** Every word the band is saying about the town, in the order a reader meets them. */
const marksOf = (html: string): string[] =>
  [...html.matchAll(/class="day-bar-state">([^<]*)</g)].map((m) => m[1]!)

const roots: { unmount: () => void }[] = []
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

async function mount(el: ReactElement): Promise<void> {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  await act(async () => {
    root.render(el)
  })
}

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount()
  })
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

// ── ★ ONE BAR, ONE CLOCK ──────────────────────────────────────────────────────────────────
// Five boxes printed the town's date or time on one frame, from four formatters. One owns it.

describe('★ the day bar the viewer actually gets', () => {
  it('★ prints the day, the season and the weekday once each', () => {
    const html = bar(townAt(DAY_12))
    const when = stamp(DAY_12)
    expect(html).toContain(`DAY ${when.day}`)
    expect(html).toContain(when.season)
    expect(html).toContain(when.weekday)
    expect(html.match(/DAY \d/g)).toHaveLength(1)
  })

  it('★ reads ONE formatter, so no two marks can disagree about the minute', () => {
    for (const tick of [0, at(23, 5), DAY_12, DAYS_PER_SEASON * MINUTES_PER_DAY]) {
      const when = stamp(tick)
      const html = bar(townAt(tick))
      expect(html, `${tick}`).toContain(when.time)
      expect(html, `${tick}`).toContain(`DAY ${when.day}`)
    }
    // padded, so the corner never jitters between 9:40 and 10:40
    expect(stamp(0).time).toBe('00:00')
  })

  it('turns the season over with the year', () => {
    expect(stamp(DAYS_PER_SEASON * MINUTES_PER_DAY).season).toBe('SUMMER')
    expect(stamp((DAYS_PER_SEASON - 1) * MINUTES_PER_DAY).season).toBe('SPRING')
  })

  // ★ THE DAY HAS A SHAPE. The act rides the weekday and never the clock, because the gateway
  // marks it between cuts too and an act is not a minute.
  it('★ reads the act off the gateway’s own frame, and says nothing before the day has one', () => {
    const store = townAt(DAY_12)
    expect(bar(store)).not.toContain('ACT')
    const withAct: WorldStore = { ...store, getDirector: () => ({ act: 'II' }) as never }
    expect(bar(withAct)).toContain('ACT II')
  })

  it('names the weather and the temperature it actually is', () => {
    expect(bar(townAt(DAY_12, { weather: { kind: 'sunny', temperatureC: 12 } }))).toContain(
      'SUNNY 12°',
    )
  })

  // ★ Two boxes saying one fact, 40px apart, is the whole defect this bar exists to end: the
  // storm is said once, by the chip that owns the sky, and never by the field beside it.
  it('★ prints a storm once, and says it is live in the same breath', () => {
    const html = bar(townAt(DAY_12, { weather: { kind: 'storm', temperatureC: 4 } }))
    expect(html.match(/STORM/g)).toHaveLength(1)
    expect(html).toContain('STORM 4°')
    expect(marksOf(html)).toEqual(['LIVE'])
  })

  // ★ THE WORLD HOLDS THE STORM IN EVERY STATE. The strip assumed the state field had taken it,
  // so a storm watched back, or watched with the socket down, was printed by neither box.
  it('★ still says the weather whatever the picture is doing', () => {
    const stormy = townAt(DAY_12, { weather: { kind: 'storm', temperatureC: 4 } })
    const back: WorldStore = {
      ...stormy,
      getMode: () => ({ live: false, replaying: false, tick: DAY_12 }),
    }
    expect(bar(back)).toContain('STORM 4°')
    expect(marksOf(bar(back))).toEqual(['REPLAY'])
    expect(bar(stormy, 'reconnecting')).toContain('STORM 4°')
    expect(marksOf(bar(stormy, 'reconnecting'))).toEqual(['OFFLINE'])
  })
})

// ── ★ THE STATE FIELD: one word, and never a number ───────────────────────────────────────
// A countdown may only stand where the world holds a deadline, and it holds none.

describe('★ what the town says it is', () => {
  it('★ every mark is one word, and no word is ever a number', () => {
    for (const store of [
      townAt(DAY_12),
      townAt(DAY_12, { weather: { kind: 'storm', temperatureC: 4 } }),
      townAt(at(2), { agents: { a: body(true, true) } } as never),
      asleepInAStormWatchedBack(),
    ]) {
      const marks = marksOf(bar(store))
      expect(marks.length).toBeGreaterThan(0)
      for (const mark of marks) {
        expect(mark.split(' '), mark).toHaveLength(1)
        expect(mark, mark).not.toMatch(/\d/)
      }
    }
  })

  // ★ THE SCREEN MAY NEVER REFUSE A FACT THE WORLD HOLDS. A replay, a storm and a town asleep
  // are three independent facts that ranking put through one slot: two of the three went unsaid.
  it('★ says all three when the world holds all three', () => {
    const html = bar(asleepInAStormWatchedBack())
    expect(html, 'the sky').toContain('STORM 4°')
    expect(marksOf(html), 'the picture, and what the town is doing').toEqual(['REPLAY', 'ASLEEP'])
  })

  // ★ A SEVERE SKY USED TO TAKE THIS SLOT, and the phone hides the chip that would have carried
  // the other fact, so under LIVE plus a storm a viewer on a phone was told neither.
  it('★ the state field says where the picture came from, never what the sky is doing', () => {
    const storm = { weather: { kind: 'storm', temperatureC: 4 } }
    expect(marksOf(bar(townAt(DAY_12, storm))), 'live under a storm').toEqual(['LIVE'])
    expect(marksOf(bar(townAt(DAY_12, storm), 'reconnecting'))).toEqual(['OFFLINE'])
    expect(marksOf(bar(townAt(DAY_12)))).toEqual(['LIVE'])
  })

  it('★ reaches the viewer as a field in the bar, never as a slab over the town', () => {
    const html = bar(townAt(at(2), { agents: { a: body(true, true) } } as never))
    expect(html).toContain('class="day-bar-state"')
    expect(html).toContain('>ASLEEP<')
    expect(CSS).not.toContain('.sleep-card')
  })

  // ★ THE HOUR WAS A BUILD-TIME CONSTANT AND COULD BE A LIE, and re-deriving it from the tick
  // was the same lie: a wake hour only picks which hours the world calls night, it wakes nobody.
  it('★ takes no clock, so it has no hour to promise', () => {
    expect(sleepField).toHaveLength(1)
    for (const h of [0, 3, 6, 12, 18, 23]) {
      const html = bar(townAt(at(h), { agents: { a: body(true, true) } } as never))
      expect(marksOf(html), `${h}:00`).toContain('ASLEEP')
    }
  })

  it('★ stands only when every living body is asleep', () => {
    expect(sleepField({ a: body(true, true), b: body(true, true) })).toBe('ASLEEP')
    expect(sleepField({ a: body(true, true), b: body(true, false) })).toBeNull()
    expect(sleepField({})).toBeNull()
    expect(sleepField({ a: body(false, false) })).toBeNull()
  })
})

describe('a clock nobody can know is stale says so instead', () => {
  it('is LIVE only when the town is awake and at its edge', () => {
    expect(stampWord(true, true, 'online')).toBe('LIVE')
  })

  it('is REPLAY while a past moment is being watched', () => {
    expect(stampWord(false, true, 'online')).toBe('REPLAY')
  })

  it('is OFFLINE with the socket down or the town not yet woken', () => {
    expect(stampWord(true, true, 'reconnecting')).toBe('OFFLINE')
    expect(stampWord(true, true, 'connecting')).toBe('OFFLINE')
    expect(stampWord(true, false, 'online')).toBe('OFFLINE')
    expect(stampWord(false, false, 'online')).toBe('OFFLINE')
  })

  it('is PAUSED only over LIVE: a stopped clock behind a scrub is the lesser fact', () => {
    expect(stampWord(true, true, 'online', true)).toBe('PAUSED')
    expect(stampWord(false, true, 'online', true)).toBe('REPLAY')
  })

  it('is R8’s own badge state, said in three words rather than four', () => {
    expect(stampWord(true, true, 'online')).toBe(
      { live: 'LIVE', past: 'REPLAY', stale: 'OFFLINE', waking: 'OFFLINE' }[
        tickBadgeState('online', true, true)
      ],
    )
  })

  // The word the viewer reads is the one the PROP carries, not the one a unit test hands the
  // pure function: the bar said LIVE over frozen figures for as long as `link` went unpassed.
  it('★ the bar renders the word the socket is actually on', () => {
    expect(bar(townAt(DAY_12), 'reconnecting')).toContain('OFFLINE')
    expect(bar(townAt(DAY_12), 'connecting')).toContain('OFFLINE')
    expect(bar(townAt(DAY_12), 'online')).toContain('LIVE')
  })
})

// ── ★ THE TRACK IS THE SCRUB BAR ──────────────────────────────────────────────────────────
// The day's own track carries the cursor, the marks and the scrub, so there is one of each.

describe('★ the day track', () => {
  it('★ puts the cursor at the minute of the day, not at the tick', () => {
    expect(dayFrac(0)).toBe(0)
    expect(dayFrac(at(12))).toBeCloseTo(0.5, 6)
    expect(dayFrac(DAY_12)).toBeCloseTo(at(9, 40) / MINUTES_PER_DAY, 6)
    // day 12 at 09:40 and day 0 at 09:40 sit at the same place on their own days
    expect(dayFrac(DAY_12)).toBeCloseTo(dayFrac(at(9, 40)), 12)
    expect(dayStart(DAY_12)).toBe(12 * MINUTES_PER_DAY)
  })

  it('★ draws the cursor where the minute is, in the markup a viewer gets', () => {
    const pct = (html: string): number =>
      Number(/day-bar-cursor[^>]*--at:([\d.]+)%/.exec(html)?.[1])
    expect(pct(bar(townAt(at(6))))).toBeCloseTo(25, 1)
    expect(pct(bar(townAt(at(12))))).toBeCloseTo(50, 1)
    expect(pct(bar(townAt(at(18))))).toBeCloseTo(75, 1)
    expect(pct(bar(townAt(DAY_12)))).toBeCloseTo((at(9, 40) / MINUTES_PER_DAY) * 100, 1)
  })

  it('★ scrubs to the minute a hand lands on, in the day the viewer is watching', () => {
    expect(trackTick(0, DAY_12, EDGE)).toBe(12 * MINUTES_PER_DAY)
    expect(trackTick(1, DAY_12, EDGE)).toBe(12 * MINUTES_PER_DAY + MINUTES_PER_DAY - 1)
    expect(trackTick(0.5, DAY_12, EDGE)).toBe(12 * MINUTES_PER_DAY + 720)
    // a hand off either end of the track asks for an end of the day, never for another one
    expect(trackTick(-3, DAY_12, EDGE)).toBe(12 * MINUTES_PER_DAY)
    expect(trackTick(4, DAY_12, EDGE)).toBe(12 * MINUTES_PER_DAY + MINUTES_PER_DAY - 1)
  })

  // ★ THE SCREEN MAY NOT STATE WHAT THE WORLD DOES NOT HOLD. The rest of today has not
  // happened, so the track may not hand a viewer a minute the town has never reached.
  it('★ never scrubs past the live edge', () => {
    const edge = 12 * MINUTES_PER_DAY + at(9, 40)
    expect(trackTick(1, DAY_12, edge)).toBe(edge)
    expect(trackTick(0.9, DAY_12, edge)).toBe(edge)
    expect(trackTick(0.1, DAY_12, edge)).toBeLessThan(edge)
  })

  it('★ is the one control: a slider over the day, with the minute as its value', () => {
    const html = bar(townAt(DAY_12))
    expect(html).toContain('role="slider"')
    expect(html).toContain(`aria-valuenow="${DAY_12}"`)
    expect(html).toContain(`aria-valuemin="${12 * MINUTES_PER_DAY}"`)
    expect(html).toContain(`aria-valuetext="${stamp(DAY_12).time}"`)
    expect(html.match(/role="slider"/g)).toHaveLength(1)
  })

  it('★ keeps only the marks of the day it is drawing', () => {
    const mark = (tick: number) => ({ tick, kind: 'built' as const, words: 'a wall', weight: 8 })
    const marks = [mark(0), mark(DAY_12), mark(13 * MINUTES_PER_DAY)]
    expect(marksOfDay(marks, DAY_12).map((m) => m.tick)).toEqual([DAY_12])
    expect(marksOfDay(marks, 0).map((m) => m.tick)).toEqual([0])
  })

  it('gives every kind a hue that is not the ink its shape is drawn in', () => {
    for (const kind of MARK_KINDS) expect(markInk(kind), kind).toMatch(/^#[0-9A-F]{6}$/)
  })

  // ★ A POSITION ON A TIME TRACK IS A STATEMENT OF TIME. A chapter the gateway dates to a DAY
  // was drawn at 00:00 with its title on it, which is a minute nobody told us.
  it('★ drops a mark its source dated only to a day, rather than stand it at midnight', () => {
    const marks = marksFrom({
      chapters: [{ day: 12, title: 'What the Fire Took' }],
      milestones: [],
      moments: [{ day: 13, startTick: 13 * MINUTES_PER_DAY + at(18, 20) }],
      changes: [],
      events: [],
      discoveries: [],
    })
    expect(marks.map((m) => m.tick)).toContain(12 * MINUTES_PER_DAY)
    expect(marksOfDay(marks, DAY_12)).toEqual([])
    expect(marksOfDay(marks, 13 * MINUTES_PER_DAY).map((m) => m.tick)).toEqual([
      13 * MINUTES_PER_DAY + at(18, 20),
    ])
  })
})

// ── ★ THE DAY THE WORLD HAS NOT FINISHED ──────────────────────────────────────────────────
// A full track for a partly lived day offers hours the town has never been through.

describe('★ the unreached part of today', () => {
  const partly = (edge: number): WorldStore => ({ ...townAt(DAY_12), liveEdge: () => edge })

  it('★ paints the span the town has not reached, and paints none of a whole day', () => {
    const html = bar(partly(DAY_12))
    expect(html).toContain('class="day-bar-dead"')
    expect(Number(/day-bar-dead[^>]*--at:([\d.]+)%/.exec(html)?.[1])).toBeCloseTo(
      (at(9, 40) / MINUTES_PER_DAY) * 100,
      1,
    )
    expect(bar(townAt(DAY_12))).not.toContain('day-bar-dead')
  })

  it('★ says where the dead span starts, and says nothing once the day is whole', () => {
    const from = 12 * MINUTES_PER_DAY
    expect(deadFrom(from, from + 360)).toBeCloseTo(0.25, 6)
    expect(deadFrom(from, from + MINUTES_PER_DAY)).toBeNull()
    expect(deadFrom(from, EDGE)).toBeNull()
    expect(deadFrom(from, from - 90)).toBe(0)
  })

  // ★ Clicking the hours the world has not lived scrubbed to the minute already on screen, and
  // a scrub is what takes a live viewer out of live.
  it('★ a hand on the unreached span leaves a live viewer live', () => {
    const edge = 12 * MINUTES_PER_DAY + at(9, 40)
    expect(pickTick(1, edge, edge)).toBeNull()
    expect(pickTick(0.9, edge, edge)).toBeNull()
    expect(pickTick(0.1, edge, edge)).toBe(12 * MINUTES_PER_DAY + 144)
    expect(pickTick(0.5, DAY_12, EDGE)).toBe(12 * MINUTES_PER_DAY + 720)
  })
})

// ── ★ THE CLOCK IS ALWAYS THERE ───────────────────────────────────────────────────────────
// It shipped at opacity 0 behind a pointer wake, so a town left on a tab said no time at all.

describe('★ the current time, at a screen nobody is touching', () => {
  it('★ stands with no pointer, no timer and no wake behind it', () => {
    const html = bar(townAt(DAY_12))
    expect(html).toContain('class="day-bar-stamp"')
    expect(html).toContain(stamp(DAY_12).time)
    expect(html).not.toContain('data-shown')
    expect(CSS).not.toContain('[data-shown')
  })

  it('★ fades nothing: a viewer glancing up finds the minute where they left it', () => {
    for (const [, sel, decls] of CSS.matchAll(/(\.day-bar[\w-]*)[^{]*\{([^}]*)\}/g)) {
      expect(decls, `${sel} may not fade`).not.toMatch(/opacity:/)
    }
  })

  // ★ Two chips printed into each other at 390px (`DAY 0 · SPRINGLOUDY 8°`), and the stream
  // frame needs the whole band, so the narrow bar is restated rather than left to shrink.
  it('★ restates its columns on a phone and drops the camera with them', () => {
    const narrow = /@media \(max-width: 900px\) \{(.*?)\n\}/s.exec(CSS)?.[1] ?? ''
    expect(narrow, 'the narrow bar must be restated').toContain('grid-template-columns:')
    expect(/\.day-bar \{([^}]*)\}/.exec(narrow)?.[1]).toMatch(/grid-template-columns:/)
    expect(narrow).toMatch(/\.day-bar \.camera-chip[^{]*\{[^}]*display: none/)
  })

  // ★ THE PHONE SAID LESS THAN THE DESKTOP. The weekday, the season and the act were hidden and
  // nothing else carried them. Measured at 390px: 96px of track on one row, 366px on two.
  it('★ gives the phone a second row, and hides nothing in the band but the camera', () => {
    const narrow = /@media \(max-width: 900px\) \{(.*?)\n\}/s.exec(CSS)?.[1] ?? ''
    const mid = /\.day-bar-mid[^{]*\{([^}]*)\}/.exec(narrow)?.[1] ?? ''
    expect(mid, 'the track must take a row of its own').toMatch(/grid-row: 2/)
    expect(mid, 'and span the whole band').toMatch(/grid-column: 1 \/ -1/)
    expect(
      [...narrow.matchAll(/([^{}]+)\{[^}]*display: none/g)].flatMap(([, sel]) =>
        (sel ?? '').split(',').map((one) => one.trim()),
      ),
    ).toEqual(['.day-bar .camera-chip'])
    const gone = [...CSS.matchAll(/([^{}]+)\{[^}]*display: none/g)].flatMap(([, sel]) =>
      (sel ?? '').split(',').map((one) => one.trim().split('\n').at(-1)!.trim()),
    )
    for (const sel of ['.day-bar-when', '.day-bar-weather'])
      expect(gone, `${sel} is hidden somewhere in the sheet`).not.toContain(sel)
  })
})

/** Every class inside the element carrying `cls`, that element's own included. */
function classesUnder(html: string, cls: string): string[] {
  const at = html.indexOf(`class="${cls}"`)
  if (at === -1) return []
  const start = html.lastIndexOf('<', at)
  const tag = /^<([a-z]+)/.exec(html.slice(start))?.[1]
  if (tag === undefined) return []
  const edge = new RegExp(`<${tag}[\\s>]|</${tag}>`, 'g')
  edge.lastIndex = start
  let depth = 0
  let end = html.length
  for (let m = edge.exec(html); m !== null; m = edge.exec(html)) {
    depth += m[0].startsWith('</') ? -1 : 1
    if (depth === 0) {
      end = edge.lastIndex
      break
    }
  }
  return [...html.slice(start, end).matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1]!.split(' '))
}

// ── ★ THE STREAM MEASURES WHAT THE STREAM DRAWS ───────────────────────────────────────────
// The hands go under `[data-broadcast='on']` and the clock stays. Every class in a grouped
// selector counts: reading only the first is how a hidden caption once measured 6.00px.

describe('★ the bar a stream viewer is left with', () => {
  // ★ A STREAM HAS NO HANDS. The track is `display: none` under `[data-broadcast='on']`, so both
  // reads drew nothing, on a frame that runs for days: 2 URLs every 30 s, for ever.
  it('★ asks the gateway for nothing it has no track to draw', async () => {
    const asked: string[] = []
    vi.stubGlobal('fetch', (url: string) => {
      asked.push(url)
      return Promise.reject(new Error('no gateway in a test'))
    })
    await mount(createElement(DayBar, props(townAt(DAY_12), 'online', true)))
    expect(asked, 'a stream frame reads neither list').toEqual([])
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount()
    })
    await mount(createElement(DayBar, props(townAt(DAY_12), 'online', false)))
    expect(asked.sort(), 'a viewer who can scrub still gets the marks').toEqual([
      '/api/milestones',
      '/api/timeline/marks',
    ])
  })

  it('★ names no caption the stream frame has taken out of the bar', () => {
    const gone = [...CSS.matchAll(/([^{}]*)\{[^}]*display: none/g)]
      .flatMap(([, list]) => [...(list ?? '').matchAll(/\[data-broadcast='on'\] \.([\w-]+)/g)])
      .flatMap((m) => classesUnder(bar(townAt(DAY_12)), m[1]!))
    expect(gone, 'the stream frame drops nothing from the bar').toContain('day-bar-track')
    for (const c of BROADCAST_CAPTIONS) {
      if (c.from !== 'sheet') continue
      expect(gone, c.what).not.toContain(c.selector.replace(/^\[data-broadcast='on'\] \./, ''))
    }
  })
})

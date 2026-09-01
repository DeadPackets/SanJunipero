import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ACT_TRACK_MAX_TICKS,
  ACT_MIN_TICKS,
  actChipShown,
  actTrackShown,
  actFraction,
  actShown,
  trackRun,
  type ActRun,
} from './acts.js'
import { AA_RATIO, bandRatios } from './legibility.js'
import { GLYPH_ZOOM } from './bubbles.js'
import { ZOOM_STOPS } from './camera.js'
import { SPEECH_FILL, SPEECH_INK } from './textFaces.js'
import type { AgentView } from '../ui/status.js'

const person = (over: Partial<AgentView> = {}): AgentView => ({
  alive: true,
  asleep: false,
  activity: { verb: 'chop' },
  needs: { hunger: 80, energy: 80, warmth: 80, social: 80 },
  hp: 100,
  ill: false,
  injuries: [],
  collapsedSinceTick: null,
  ...over,
})

const run = (over: Partial<ActRun> = {}): ActRun => ({ verb: 'chop', total: 30, left: 30, ...over })

// ★ 7M-B: the fill under the word is gone. Progress is seven blocks over the head — a count and
// a position before it is ever a hue — so the chip is one flat slab and the reader is never
// asked to read a word through a wash.
describe('the chip carries the word and nothing else', () => {
  it('draws no wash, no waterline and no mask of its own', () => {
    const src = readFileSync(new URL('./acts.ts', import.meta.url), 'utf8')
    expect(src).not.toContain('drawWash')
    expect(src).not.toContain('.mask =')
    expect(src).not.toContain('ACT_FILL')
  })

  it('keeps the paper and the ink it always had', () => {
    const r = bandRatios(SPEECH_INK, SPEECH_FILL)
    expect(r.day).toBeGreaterThanOrEqual(AA_RATIO)
    expect(r.night).toBeGreaterThanOrEqual(AA_RATIO)
  })
})

describe('how far through the work is', () => {
  it('is empty on the first tick and never quite full on the last', () => {
    expect(actFraction(run({ total: 30, left: 30 }))).toBe(0)
    expect(actFraction(run({ total: 30, left: 1 }))).toBeCloseTo(29 / 30)
    expect(actFraction(run({ total: 30, left: 1 }))).toBeLessThan(1)
  })

  it('rises with the work and never runs backwards', () => {
    let prev = -1
    for (let left = 30; left >= 1; left--) {
      const f = actFraction(run({ left }))
      expect(f, `left=${left}`).toBeGreaterThanOrEqual(prev)
      prev = f
    }
  })

  it('stays inside 0..1 whatever the clock does', () => {
    for (const r of [run({ left: 99 }), run({ left: -5 }), run({ total: 1, left: 0 })]) {
      const f = actFraction(r)
      expect(f).toBeGreaterThanOrEqual(0)
      expect(f).toBeLessThanOrEqual(1)
    }
  })
})

describe('the denominator, remembered per person', () => {
  it('takes the exact duration from action_started when it saw the act begin', () => {
    expect(trackRun(null, 'chop', 30, 30)).toEqual({ verb: 'chop', total: 30, left: 30 })
  })

  // The night-work penalty is already inside the event's duration, and the state never carries
  // what was ASKED for — so a viewer who joined halfway has to infer it.
  it('takes the largest remaining it has seen when it joined halfway through', () => {
    let r = trackRun(null, 'chop', 12)
    expect(actFraction(r)).toBe(0)
    r = trackRun(r, 'chop', 11)
    expect(r.total).toBe(12)
    expect(actFraction(r)).toBeCloseTo(1 / 12)
  })

  it('starts a fresh run when the person moves to a different job', () => {
    const first = trackRun(null, 'chop', 30, 30)
    expect(trackRun(first, 'tend', 3, 3)).toEqual({ verb: 'tend', total: 3, left: 3 })
  })

  // `build` drops its clock by the number of builders on the site, not by one.
  it('absorbs a clock that falls by more than one tick', () => {
    let r = trackRun(null, 'build', 40, 40)
    r = trackRun(r, 'build', 36)
    expect(r.total).toBe(40)
    expect(actFraction(r)).toBeCloseTo(0.1)
  })

  it('never divides by zero, whatever it is handed', () => {
    expect(trackRun(null, 'chop', 0, 0).total).toBe(1)
    expect(Number.isFinite(actFraction(trackRun(null, 'chop', 0, 0)))).toBe(true)
  })
})

describe('whose act is worth a word', () => {
  it('captions work a viewer can watch happen', () => {
    expect(actShown(person(), run({ total: 30 }))).toBe(true)
    expect(actShown(person({ activity: { verb: 'tend' } }), run({ verb: 'tend', total: 3 }))).toBe(
      true,
    )
  })

  // Walking, eating, talking and sleeping are legible from the body itself; captioning them
  // would put a word over every person in the town.
  it('says nothing about the states the body already shows', () => {
    for (const verb of ['walk', 'eat', 'speak', 'teach']) {
      expect(actShown(person({ activity: { verb } }), run({ verb, total: 30 })), verb).toBe(false)
    }
    expect(actShown(person({ asleep: true }), run())).toBe(false)
    expect(actShown(person({ alive: false }), run())).toBe(false)
    expect(actShown(person({ collapsedSinceTick: 4 }), run())).toBe(false)
  })

  it('says nothing at all when nobody is doing anything', () => {
    expect(actShown(person({ activity: null }), run())).toBe(false)
    expect(actShown(person(), null)).toBe(false)
  })

  // A one-tick act is 2.5s of flicker, not a caption.
  it('says nothing about an act that is over before it is read', () => {
    expect(actShown(person(), run({ total: ACT_MIN_TICKS - 1 }))).toBe(false)
    expect(actShown(person(), run({ total: ACT_MIN_TICKS }))).toBe(true)
  })

  // ★ THE WORD SURVIVES A LONG ACT; ONLY THE FILL DOES NOT. "Building" over a person tells a
  // viewer exactly what they are looking at, however many town-days it runs for.
  it('keeps the word for the longest act in the game', () => {
    const house = run({ verb: 'build', total: 2880 })
    expect(actShown(person({ activity: { verb: 'build' } }), house)).toBe(true)
    expect(actTrackShown(house)).toBe(false)
  })

  it('fills only while a fill can promise you will see it finish', () => {
    expect(actTrackShown(run({ total: ACT_TRACK_MAX_TICKS }))).toBe(true)
    expect(actTrackShown(run({ total: ACT_TRACK_MAX_TICKS + 1 }))).toBe(false)
    expect(actTrackShown(run({ total: 30 })), 'felling a tree').toBe(true)
    expect(actTrackShown(run({ total: 3 })), 'tending a patch').toBe(true)
  })
})

// ★ The chip used to ask `bubbleShown`, so a change to who SPEAKS silently changed who is seen
// working. It keeps the same zoom stop and asks it in its own name.
describe('★ the chip has its own reason to be on screen', () => {
  it('★ wears no word where a person is eight pixels tall', () => {
    expect(actChipShown(GLYPH_ZOOM, true)).toBe(false)
    for (const zoom of ZOOM_STOPS.filter((z) => z > GLYPH_ZOOM)) {
      expect(actChipShown(zoom, true), `${zoom}x`).toBe(true)
      expect(actChipShown(zoom, false), `${zoom}x off screen`).toBe(false)
    }
  })
})

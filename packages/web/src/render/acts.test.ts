import { describe, expect, it } from 'vitest'
import {
  ACT_FILL,
  ACT_FILL_MAX_TICKS,
  ACT_MIN_TICKS,
  actChipShown,
  actFillShown,
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

// ★ THE WASH IS PAPER A READER STILL HAS TO READ THROUGH. Measured, not asserted, in the same
// two light bands every other paper in the town is measured in.
describe('the worked part of the chip is still legible', () => {
  it('clears AA under the ink, in day and in the deep-night multiply', () => {
    const r = bandRatios(SPEECH_INK, ACT_FILL)
    const offenders = (['day', 'night'] as const)
      .filter((band) => r[band] < AA_RATIO)
      .map((band) => `${band} — ${r[band].toFixed(2)}:1`)
    expect(offenders).toEqual([])
  })

  it('is a wash and not a second colour: darker than the paper, lighter than the ink', () => {
    expect(ACT_FILL).toBeLessThan(SPEECH_FILL)
    expect(ACT_FILL).toBeGreaterThan(SPEECH_INK)
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
    expect(actFillShown(house)).toBe(false)
  })

  it('fills only while a fill can promise you will see it finish', () => {
    expect(actFillShown(run({ total: ACT_FILL_MAX_TICKS }))).toBe(true)
    expect(actFillShown(run({ total: ACT_FILL_MAX_TICKS + 1 }))).toBe(false)
    expect(actFillShown(run({ total: 30 })), 'felling a tree').toBe(true)
    expect(actFillShown(run({ total: 3 })), 'tending a patch').toBe(true)
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

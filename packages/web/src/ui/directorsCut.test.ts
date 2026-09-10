import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MINUTES_PER_DAY } from '@sj/shared'
import { createWorldStore, type WorldStore } from '../state/worldStore.js'
import { DayBar, dayStart, playPause, trackTick } from '../stage/DayBar.js'
import { wayBack } from '../App.js'
import { SCENE_IN_MS, SCENE_OUT_MS, SCENE_TOTAL_MS, SCENES } from './sceneTransition.js'
import { TITLE_CARD_MS, castNames, dipAlpha, momentDateline } from './replayRun.js'

const src = (f: string): string => readFileSync(new URL(f, import.meta.url), 'utf8')
const CSS = src('./chrome.css')
const APP = src('../App.tsx')
const SCENE = src('../stage/ReplayScene.tsx')

describe('★ the dip: the town leaves, the past arrives', () => {
  it('★ is the machine that was already there, not a second one', () => {
    expect(SCENES).toContain('replay')
    expect(SCENE_OUT_MS).toBe(120)
    expect(SCENE_IN_MS).toBe(180)
  })

  it('★ goes to black at the seam and comes all the way back', () => {
    expect(dipAlpha(0)).toBe(0)
    expect(dipAlpha(SCENE_OUT_MS)).toBe(1)
    expect(dipAlpha(SCENE_TOTAL_MS)).toBe(0)
    expect(dipAlpha(SCENE_TOTAL_MS + 500)).toBe(0)
  })

  it('rises the whole way out and falls the whole way in — no step, no plateau', () => {
    for (let t = 1; t <= SCENE_OUT_MS; t++)
      expect(dipAlpha(t), `${t}`).toBeGreaterThan(dipAlpha(t - 1))
    for (let t = SCENE_OUT_MS + 1; t <= SCENE_TOTAL_MS; t++)
      expect(dipAlpha(t), `${t}`).toBeLessThan(dipAlpha(t - 1))
  })

  it('★ under reduced motion there is no dip at all — a fade, or nothing', () => {
    for (const t of [0, 60, 120, 240, 300]) expect(dipAlpha(t, true), `${t}`).toBe(0)
  })

  it('is written to the DOM per frame, so the sheet gives it no transition to fight', () => {
    expect(SCENE).toContain('requestAnimationFrame(frame)')
    expect(CSS).toMatch(/\.replay-dip \{[^}]*opacity: 0;/)
    expect(CSS.slice(CSS.indexOf('.replay-dip'), CSS.indexOf('.replay-card'))).not.toContain(
      'transition',
    )
  })
})

describe('★ the title card names the minute and gets out of the way', () => {
  it('★ stands for two seconds at the most', () => {
    expect(TITLE_CARD_MS).toBe(2000)
    expect(SCENE).toContain('}, TITLE_CARD_MS)')
  })

  it('★ goes down on the first thing that happens, so it never covers it', () => {
    expect(SCENE).toContain('store.onEvents(')
  })

  it('★ is non-modal and takes no focus: a caption on the town, not a thing to dismiss', () => {
    expect(SCENE).toContain('aria-hidden="true"')
    expect(SCENE).not.toContain('role="dialog"')
    expect(SCENE).not.toContain('<button')
    expect(CSS).toMatch(/\.replay-card \{[^}]*pointer-events: none;/)
  })

  it('carries the day, the minute and the people, in the town’s own words', () => {
    expect(momentDateline(1500)).toBe('Day 1 · 01:00')
    const names: Record<string, string> = { a1: 'Rahel', a2: 'Tomas', a3: 'Omar' }
    expect(castNames(['a1'], (id) => names[id])).toBe('Rahel')
    expect(castNames(['a1', 'a2'], (id) => names[id])).toBe('Rahel and Tomas')
    expect(castNames(['a1', 'a2', 'a3'], (id) => names[id])).toBe('Rahel, Tomas and Omar')
    expect(castNames(['ghost'], (id) => names[id])).toBe('')
  })

  it('never stands in the cue’s slot at the same time as the cue', () => {
    // the frame gives the card and the cue a row each, bottom up, so the two can never collide
    // and neither has to know how tall the other is
    expect(CSS.slice(CSS.indexOf('.replay-card {'))).toContain('grid-area: third')
    expect(CSS.slice(CSS.indexOf('.stage-cue {'))).toContain('grid-area: cue')
  })
})

describe('★ the grade: warm, a tenth less saturated, and NEVER sepia', () => {
  const GRADE = CSS.slice(CSS.indexOf('.replay-grade {'), CSS.indexOf('.replay-dip {'))

  it('★ takes exactly a tenth of the saturation', () => {
    expect(GRADE).toContain('saturate(0.9)')
  })

  it('★ is not a sepia wash: the past has to stay worth watching', () => {
    expect(CSS).not.toContain('sepia(')
    expect(GRADE).not.toMatch(/hue-rotate|grayscale/)
  })

  it('warms toward the sheet’s own honey and vignettes toward its own deep', () => {
    expect(GRADE).toContain('rgba(242, 200, 121') // --honey
    expect(GRADE).toContain('rgba(36, 31, 43') // --deep
  })

  it('grades on the compositor, never through a filter inside the tick budget', () => {
    expect(GRADE).toContain('backdrop-filter')
    expect(src('../render/StageMount.tsx')).not.toContain('ColorMatrixFilter')
  })
})

const DAY = 12 * MINUTES_PER_DAY + 9 * 60 + 40

/** The bar a viewer watching the past is given, off the store the app hands it. */
const REPLAYING: WorldStore = {
  ...createWorldStore(),
  getTick: () => DAY,
  liveEdge: () => 400 * MINUTES_PER_DAY,
  getMode: () => ({ live: false, replaying: true, tick: DAY }),
}

const bar = (store: WorldStore): string =>
  renderToStaticMarkup(
    createElement(DayBar, {
      store,
      link: 'online' as const,
      handle: null,
      onAt: () => undefined,
      autoCut: true,
      handbackAt: () => null,
    }),
  )

describe('★ the cut is a thing in the town, and the day bar is its one control', () => {
  it('★ NO LETTERBOX: the Signpost ruling holds, and the sheet already takes 66%', () => {
    // a selector, not the word: the block's own comment says why there is none
    for (const bar of ['letterbox', 'cinema-bar', 'pillarbox'])
      expect(CSS, bar).not.toMatch(new RegExp(`\\.${bar}[\\s,{:]`))
  })

  // The strip was a second control with a second clock on it, 800px from the first. The day
  // bar's own track carries the scrub now, so pause and resume are the same two messages.
  it('★ costs the protocol nothing: pause is a scrub, resume is a replay', () => {
    const said: string[] = []
    const handle = {
      scrub: (t: number) => said.push(`scrub ${t}`),
      replay: (t: number) => said.push(`replay ${t}`),
    } as unknown as Parameters<typeof playPause>[0]
    playPause(handle, true, 1500)
    playPause(handle, false, 1500)
    expect(said).toEqual(['scrub 1500', 'replay 1500'])
    playPause(null, true, 1500)
    expect(said).toHaveLength(2)
  })

  // ★ The strip carried its own way back and the app hid its one behind it. The strip is gone,
  // so the app's exit stands for as long as the town is off its live edge.
  it('★ replaces the lone way back rather than standing a second one beside it', () => {
    expect(wayBack(false, false), 'a replay with no way out of it').toBe(true)
    expect(wayBack(true, false), 'a way back offered at the live edge').toBe(false)
    expect(wayBack(false, true), 'a stream frame has no hands').toBe(false)
    expect(wayBack(true, true)).toBe(false)
    expect(bar(REPLAYING), 'the bar grew a second way back').not.toContain('Return to now')
  })

  // ★ NO SPEED CONTROL. `bubbleLife` is 3500 ms + 55/char and the leg timing is tuned to the
  // live cadence: above 2x a replayed conversation is unreadable, and 2x is not worth a control.
  it('★ offers no speed at all: the bubbles and the legs are tuned to the live cadence', () => {
    const html = bar(REPLAYING)
    expect(html, 'the bar has no transport at all').toContain('day-bar-play')
    expect(html.match(/<button/g), 'a second control stands beside the one').toHaveLength(1)
    const said = [
      ...[...html.matchAll(/>([^<>]+)</g)].map((m) => m[1]!),
      ...[...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1]!),
    ]
    for (const words of said) expect(words, words).not.toMatch(/speed|faster|slower|\d\s*[x×]/i)
    expect(playPause, 'pause and resume carry a rate').toHaveLength(3)
  })

  // ★ THE BOUND MOVED, and this is the ruling: the strip scrubbed inside the moment it was
  // replaying, and the day bar's track replaced it, so the bound is the day the viewer is on.
  it('★ its track is bounded to the day on screen, not to the whole history', () => {
    const from = dayStart(DAY)
    const edge = 400 * MINUTES_PER_DAY
    expect(trackTick(0, DAY, edge)).toBe(from)
    expect(trackTick(1, DAY, edge)).toBe(from + MINUTES_PER_DAY - 1)
    expect(trackTick(-1, DAY, edge), 'a hand off the end asked for another day').toBe(from)
    expect(trackTick(2, DAY, edge)).toBe(from + MINUTES_PER_DAY - 1)
    // ...and never a minute the town has not lived through
    expect(trackTick(1, DAY, DAY)).toBe(DAY)
  })

  it('is never drawn into a stream frame, which has no hands', () => {
    expect(APP).toContain('{!route.broadcast && <ReplayScene')
  })
})

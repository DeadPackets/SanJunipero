import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { playhead, seekTick } from '../stage/Transport.js'
import { SCENE_IN_MS, SCENE_OUT_MS, SCENE_TOTAL_MS, SCENES } from './sceneTransition.js'
import { TITLE_CARD_MS, castNames, dipAlpha, momentDateline, pointPlay } from './replayRun.js'

const src = (f: string): string => readFileSync(new URL(f, import.meta.url), 'utf8')
const CSS = src('./chrome.css')
const APP = src('../App.tsx')
const TRANSPORT = src('../stage/Transport.tsx')
const SCENE = src('../stage/ReplayScene.tsx')

const PLAY = pointPlay(1500, 100_000, 'A grave was made for Rahel.', ['a1', 'a2'])

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
    // both sit above the strip; the card leaves on the event that is the only thing that
    // brings the cue up, so the two are exclusive by construction rather than by z-index
    expect(CSS).toContain("[data-replay='on'] .stage-cue")
    for (const rule of ['.replay-card {', "[data-replay='on'] .stage-cue {"])
      expect(CSS.slice(CSS.indexOf(rule)), rule).toContain('+ var(--transport-h)')
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

describe('★ the transport is a thing in the town', () => {
  it('★ NO LETTERBOX: the Signpost ruling holds, and the sheet already takes 66%', () => {
    // a selector, not the word: the block's own comment says why there is none
    for (const bar of ['letterbox', 'cinema-bar', 'pillarbox'])
      expect(CSS, bar).not.toMatch(new RegExp(`\\.${bar}[\\s,{:]`))
    // and every mark of the cut hangs off an edge at the one inset, like every other mark
    expect(CSS.slice(CSS.indexOf('.transport {'))).toContain('bottom: max(var(--mark-inset)')
  })

  it('★ costs the protocol nothing: pause is a scrub, resume is a replay', () => {
    expect(TRANSPORT).toContain('handle?.scrub(tick)')
    expect(TRANSPORT).toContain('handle?.replay(tick >= play.until ? play.from : tick)')
  })

  it('★ offers no speed at all: the bubbles and the legs are tuned to the live cadence', () => {
    const code = TRANSPORT.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code).not.toMatch(/speed/i)
    expect(code).not.toContain('×')
  })

  it('★ its scrubber is bounded to the moment, not to the whole history', () => {
    expect(playhead(PLAY.from, PLAY)).toBe(0)
    expect(playhead(PLAY.until, PLAY)).toBe(1)
    expect(playhead(0, PLAY)).toBe(0) // a tick before the moment pins to its start
    expect(playhead(99_999, PLAY)).toBe(1)
    expect(seekTick(0, PLAY)).toBe(PLAY.from)
    expect(seekTick(1, PLAY)).toBe(PLAY.until)
    expect(seekTick(0.5, PLAY)).toBeGreaterThanOrEqual(PLAY.from)
    expect(seekTick(2, PLAY)).toBe(PLAY.until)
    expect(seekTick(-1, PLAY)).toBe(PLAY.from)
  })

  it('carries the clock and the one way out, and every control is reachable', () => {
    expect(TRANSPORT).toContain('momentStamp(tick)')
    expect(TRANSPORT).toContain('Return to now')
    expect(TRANSPORT).toContain('role="slider"')
    expect(TRANSPORT).toContain('tabIndex={0}')
    expect(CSS).toMatch(/\.player-btn \{[^}]*min-width: 44px; min-height: 44px;/)
    expect(CSS).toContain('.player-track::after')
  })

  it('★ replaces the lone way back rather than standing a second one beside it', () => {
    expect(APP).toContain('!mode.live && !route.broadcast && play === null')
  })

  it('is never drawn into a stream frame, which has no hands', () => {
    expect(APP).toContain('{!route.broadcast && (\n        <Transport')
    expect(APP).toContain('{!route.broadcast && <ReplayScene')
  })
})

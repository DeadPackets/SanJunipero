import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  FIRST_FRAME_COPY,
  FIRST_LINES,
  FIRST_LINES_MS,
  detachFirstFrame,
  firstFrameNote,
  firstFrameStuck,
  firstLinesHead,
  peopleWords,
} from './firstFrame.js'
import { MOTION } from './motion.js'

// The card is static HTML so it can paint on the first byte, which puts three of its facts
// in a file no import reaches.
const HTML = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
const SRC = readFileSync(new URL('./firstFrame.ts', import.meta.url), 'utf8')

describe('the first frame', () => {
  it('★ paints inside `#root`, so it is what LCP measures', () => {
    expect(HTML).toMatch(/<div id="root">\s*<div class="first-frame"/)
  })

  it('★ opens on the same sentence the app would write there', () => {
    expect(HTML).toContain(`>${FIRST_FRAME_COPY.looking}</p>`)
  })

  it('★ fades over the world’s own `scene` motion, and the fallback timer outlasts it', () => {
    expect(HTML).toContain(`transition: opacity ${String(MOTION.scene.ms)}ms ${MOTION.scene.ease}`)
    // under `prefers-reduced-motion` there is no transitionend, so a timer removes the card
    expect(SRC).toContain('MOTION.scene.ms +')
  })

  it('★ names no webfont — a card that swaps faces reflows on the one screen nobody misses', () => {
    const card = (/<style>([\s\S]*?)<\/style>/.exec(HTML)?.[1] ?? '').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    )
    for (const face of ['Fraunces', 'Manrope', 'Silkscreen', 'Press Start'])
      expect(card, face).not.toContain(face)
    expect(card).toContain('Georgia')
  })

  // ★ The scene chain had no catch, so a browser that cannot draw sat on "Looking for the
  // town…" forever. The reason has to outlast every later write to the card.
  it('★ latches the reason the town will never arrive', () => {
    const note = { textContent: '' }
    vi.stubGlobal('document', {
      getElementById: () => ({ querySelector: () => note }),
      body: { append: () => undefined },
    })
    detachFirstFrame()
    firstFrameStuck(FIRST_FRAME_COPY.blind)
    expect(note.textContent).toBe(FIRST_FRAME_COPY.blind)
    firstFrameNote(FIRST_FRAME_COPY.looking)
    expect(note.textContent, 'nothing writes over it').toBe(FIRST_FRAME_COPY.blind)
    vi.unstubAllGlobals()
  })
})

// ★ THE FIRST TWO LINES. The title card says the town is being looked for; these say what it IS,
// over the town itself, and get out of the way the moment there is something better to watch.
describe('★ the two lines over the first shot', () => {
  const APP = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')

  it('★ counts the town in words, because the first thing a visitor reads is prose', () => {
    expect(firstLinesHead(12)).toBe('Twelve people. Watch them make a town.')
    expect(peopleWords(1)).toBe('One person')
    expect(peopleWords(20)).toBe('Twenty people')
    // past the words the figure is honest rather than wrong
    expect(peopleWords(24)).toBe('24 people')
  })

  it('★ stands outside `#root`, which React clears on mount, and starts hidden', () => {
    expect(HTML).toMatch(/<div class="first-lines" id="first-frame-lines" hidden>/)
    expect(HTML.indexOf('first-frame-lines')).toBeGreaterThan(HTML.indexOf('</noscript>') - 1000)
    expect(HTML).toContain(`>${FIRST_LINES.take}</p>`)
    // the count is written in by the app, so the static file cannot carry a stale number
    expect(HTML).toMatch(/<p class="first-lines-head"><\/p>/)
    // an author `display` beats the UA's `[hidden]`, so the sheet has to honour the attribute
    const CSS = readFileSync(new URL('./chrome.css', import.meta.url), 'utf8')
    expect(CSS).toContain('.first-lines[hidden] { display: none; }')
  })

  it('★ goes on the first cut, the first hand on the camera, or twenty seconds', () => {
    expect(FIRST_LINES_MS).toBe(20_000)
    expect(SRC).toContain("const HAND_ON_CAMERA = ['pointerdown', 'keydown', 'wheel'] as const")
    expect(SRC).toContain('setTimeout(fadeFirstLines, FIRST_LINES_MS)')
    // ...and the first cut is the app telling it there is something better to look at
    expect(APP).toContain('if (cut) fadeFirstLines()')
    expect(APP).toMatch(
      /onShot = useCallback\(\(cast: readonly string\[\], sceneId: string \| null, cut: boolean\)/,
    )
    expect(APP).toContain('showFirstLines(livingCount(store.getState()?.agents))')
  })

  it('★ fades on the world’s own `scene` motion, and the fallback timer outlasts it', () => {
    expect(SRC).toMatch(/function fade\(el: HTMLElement\)/)
    expect(SRC).toContain('MOTION.scene.ms +')
  })

  it('★ never comes back once it has gone, and never shows over an empty town', () => {
    expect(SRC).toContain('if (linesDone || lines !== null || count < 1) return')
  })
})

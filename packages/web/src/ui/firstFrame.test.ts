import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FIRST_FRAME_COPY } from './firstFrame.js'
import { MOTION } from './motion.js'

// The card is static HTML so it can paint on the first byte, which puts three of its facts in a
// file no import reaches. Each one below is a real drift: the wrong sentence on arrival, a
// removal timer that fires at the wrong moment, or a browser chrome that is not the town's.
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
})

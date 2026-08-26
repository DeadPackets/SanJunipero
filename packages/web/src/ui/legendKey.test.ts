import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  KEY_BORDER, KEY_CHIP_H, KEY_GAP, KEY_MARGIN, KEY_MAX_W, KEY_PAD_Y, KEY_SUMMARY_W,
  coverage, keyBox, nodesUnder,
} from './legendKey.js'
import { relationLegend } from './relationGraph.js'

const CSS = readFileSync(new URL('./chrome.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const LENS_SRC = readFileSync(new URL('./SocietyLens.tsx', import.meta.url), 'utf8')

// A 1525 x 880 lens is the stage the batch-4 review looked at.
const STAGE = { w: 1525, h: 880 }

// A chip's width depends on a pixel font's advance, which no node test can measure, so every claim
// below is swept across every width a 12px uppercase chip could plausibly take.
const CHIP_WIDTHS = [80, 100, 120, 140, 160, 170]

describe('the model is the stylesheet, not a second copy of it', () => {
  const body = (sel: string): string => {
    const hits: string[] = []
    for (const [, s, b] of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if ((s ?? '').split(',').some((x) => x.trim() === sel)) hits.push(b ?? '')
    }
    return hits.join(';')
  }

  it('takes every constant from the rule it describes', () => {
    expect(body('.legend-chip')).toMatch(/min-height:\s*40px/)
    expect(KEY_CHIP_H).toBe(40)
    expect(body('.society-key')).toMatch(/max-width:\s*min\(40rem/)
    expect(KEY_MAX_W).toBe(40 * 16)
    expect(KEY_GAP).toBeCloseTo(0.4 * 16, 5)
    expect(KEY_PAD_Y).toBeCloseTo(0.1 * 16, 5)
    expect(KEY_MARGIN).toBeCloseTo(0.8 * 16, 5)
    expect(KEY_BORDER).toBe(10)
  })
})

describe('R6 — a legend that hides the graph is a new U15', () => {
  const chips = relationLegend().length

  it('still has the thirteen chips the review counted', () => {
    expect(chips).toBe(13)
  })

  it('measures the landed always-open key at a large share of the lens', () => {
    for (const w of CHIP_WIDTHS) {
      const open = coverage(keyBox(STAGE, { open: true, chips, chipW: w }), STAGE)
      expect(open, `chip ${w}px`).toBeGreaterThan(0.06)
    }
  })

  it('closes to a single summary control, an order of magnitude smaller', () => {
    for (const w of CHIP_WIDTHS) {
      const open = coverage(keyBox(STAGE, { open: true, chips, chipW: w }), STAGE)
      const shut = coverage(keyBox(STAGE, { open: false, chips, chipW: w }), STAGE)
      expect(shut, `chip ${w}px`).toBeLessThan(0.02)
      expect(open / shut, `chip ${w}px`).toBeGreaterThan(5)
    }
  })

  it('never lets the key leave the lens, open or shut, at any stage size', () => {
    for (const stage of [STAGE, { w: 700, h: 420 }, { w: 2560, h: 1440 }]) {
      for (const open of [true, false]) {
        const b = keyBox(stage, { open, chips, chipW: 140 })
        expect(b.x).toBeGreaterThanOrEqual(0)
        expect(b.y).toBeGreaterThanOrEqual(0)
        expect(b.x + b.w, `${stage.w}x${stage.h} open=${open}`).toBeLessThanOrEqual(stage.w)
        expect(b.y + b.h, `${stage.w}x${stage.h} open=${open}`).toBeLessThanOrEqual(stage.h)
      }
    }
  })

  it('shows, on a town big enough to matter, the people the open key was standing on', () => {
    // Eleven people spread over the lens the way a force layout spreads them.
    const nodes = Array.from({ length: 11 }, (_, i) => ({
      id: `p${i}`,
      x: 220 + (i % 4) * 90,
      y: 30 + Math.floor(i / 4) * 70,
    }))
    const chipW = 140
    const open = keyBox(STAGE, { open: true, chips, chipW })
    const shut = keyBox(STAGE, { open: false, chips, chipW })
    expect(nodesUnder(nodes, open).length).toBeGreaterThan(0)
    expect(nodesUnder(nodes, shut)).toEqual([])
  })

  it('counts a node as under the key only when its centre really is', () => {
    const box = { x: 100, y: 100, w: 200, h: 50 }
    expect(nodesUnder([{ id: 'in', x: 150, y: 120 }], box)).toEqual(['in'])
    expect(nodesUnder([{ id: 'right', x: 301, y: 120 }], box)).toEqual([])
    expect(nodesUnder([{ id: 'below', x: 150, y: 151 }], box)).toEqual([])
    expect(nodesUnder([{ id: 'edge', x: 100, y: 100 }], box)).toEqual(['edge'])
  })

  it('gives an empty town an empty answer rather than throwing', () => {
    expect(nodesUnder([], { x: 0, y: 0, w: 10, h: 10 })).toEqual([])
  })
})

describe('the lens renders the key as a disclosure', () => {
  it('gives the summary an expanded state a screen reader can read', () => {
    expect(LENS_SRC).toMatch(/aria-expanded=\{keyOpen\}/)
    expect(LENS_SRC).toMatch(/className="key-summary"/)
  })

  it('opens shut, so nothing is hidden on arrival', () => {
    expect(LENS_SRC).toMatch(/useState\(false\)/)
  })

  it('renders no chip at all while the key is shut', () => {
    expect(LENS_SRC).toMatch(/keyOpen\s*&&/)
  })

  it('keeps the summary at least as wide as the model says it is', () => {
    expect(KEY_SUMMARY_W).toBeGreaterThanOrEqual(120)
  })
})

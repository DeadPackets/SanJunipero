import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BODY_MIN_PX, TEXT_MIN_PX, WORLD_TEXT_LINE_H } from '../textFloor.js'
import { PLATE_FONT_PX, PLATE_ROW_H } from './plate.js'
import { BUBBLE_FONT_PX, BUBBLE_LINE_H } from './bubbles.js'

const src = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8')

// Every glyph the product draws onto a canvas is set in one of these four modules.
const CANVAS_TEXT_FILES = [
  './characters.ts',
  './plate.ts',
  './tooltip.ts',
  './bubbles.ts',
  '../paper/pages/BondsGraph.tsx',
]

describe('the legibility floors themselves', () => {
  it('puts the smallest glyph at 12px and prose at 14px', () => {
    expect(TEXT_MIN_PX).toBe(12)
    expect(BODY_MIN_PX).toBe(14)
    expect(BODY_MIN_PX).toBeGreaterThanOrEqual(TEXT_MIN_PX)
  })

  it('leaves a world glyph room to breathe on its line', () => {
    expect(WORLD_TEXT_LINE_H).toBeGreaterThanOrEqual(TEXT_MIN_PX)
  })
})

describe('B2 — world text, readable at ZOOM_MIN where a world px is a CSS px', () => {
  it('sets every canvas glyph at or above the floor', () => {
    for (const px of [PLATE_FONT_PX, BUBBLE_FONT_PX]) {
      expect(px).toBeGreaterThanOrEqual(TEXT_MIN_PX)
    }
    for (const lh of [PLATE_ROW_H, BUBBLE_LINE_H]) {
      expect(lh).toBeGreaterThanOrEqual(TEXT_MIN_PX)
    }
  })

  // The bonds graph cannot be imported outside a browser, so its label size is read from source.
  it('leaves no bare pixel size below the floor in a canvas-text module', () => {
    for (const file of CANVAS_TEXT_FILES) {
      const text = src(file)
      for (const [, n] of text.matchAll(/fontSize:\s*(\d+(?:\.\d+)?)/g)) {
        expect(Number(n), `${file} — fontSize: ${n}`).toBeGreaterThanOrEqual(TEXT_MIN_PX)
      }
      for (const [, n] of text.matchAll(/Math\.max\((\d+(?:\.\d+)?)\s*\/\s*globalScale/g)) {
        expect(Number(n), `${file} — ${n}px screen floor`).toBeGreaterThanOrEqual(TEXT_MIN_PX)
      }
    }
  })
})

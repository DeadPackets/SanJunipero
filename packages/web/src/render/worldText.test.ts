import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BODY_MIN_PX, TEXT_MIN_PX, WORLD_TEXT_LINE_H, WORLD_TEXT_PX } from '../textFloor.js'
import { CHAR_TAG_FONT_PX, CHAR_TAG_LINE_H } from './characters.js'
import { TAG_FONT_PX, TAG_LINE_H } from './nameTags.js'
import { BUBBLE_FONT_PX, BUBBLE_LINE_H } from './bubbles.js'

const src = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8')

// Every glyph the product draws onto a canvas is set in one of these four modules.
const CANVAS_TEXT_FILES = [
  './characters.ts', './nameTags.ts', './bubbles.ts', '../ui/SocietyLens.tsx',
]

describe('the legibility floors themselves', () => {
  it('puts the smallest glyph at 12px and prose at 14px', () => {
    expect(TEXT_MIN_PX).toBe(12)
    expect(BODY_MIN_PX).toBe(14)
    expect(BODY_MIN_PX).toBeGreaterThanOrEqual(TEXT_MIN_PX)
  })

  it('leaves a world glyph room to breathe on its line', () => {
    expect(WORLD_TEXT_PX).toBeGreaterThanOrEqual(TEXT_MIN_PX)
    expect(WORLD_TEXT_LINE_H).toBeGreaterThanOrEqual(WORLD_TEXT_PX)
  })
})

describe('B2 — world text, readable at ZOOM_MIN where a world px is a CSS px', () => {
  it('sets every canvas glyph at or above the floor', () => {
    for (const px of [CHAR_TAG_FONT_PX, TAG_FONT_PX, BUBBLE_FONT_PX]) {
      expect(px).toBeGreaterThanOrEqual(TEXT_MIN_PX)
    }
    for (const lh of [CHAR_TAG_LINE_H, TAG_LINE_H, BUBBLE_LINE_H]) {
      expect(lh).toBeGreaterThanOrEqual(TEXT_MIN_PX)
    }
  })

  // SocietyLens cannot be imported outside a browser, so its label size is read from source.
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

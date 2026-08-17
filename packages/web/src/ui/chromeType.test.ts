import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BODY_MIN_PX, TEXT_MIN_PX } from '../textFloor.js'

const CSS = readFileSync(new URL('./chrome.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

// Prose surfaces: containers whose text is sentences, plus the prose-only classes inside them.
// Chips, stamps, counts, pills and pixel-face labels sit on TEXT_MIN_PX, not on this list.
const PROSE = [
  '.inspector-panel', '.chronicle-panel', '.roster-panel', '.laws-panel', '.laws-dashboard',
  '.bond-detail', '.provenance-pop', '.room-who', '.thumb-title', '.need-label',
  '.law-history', '.veil-sub', '.tab-body article h4',
]

type Decl = { selectors: string; px: number; raw: string }

/** Every size the sheet sets, from `font-size` or from the `font` shorthand, resolved to px. */
export function fontSizes(css: string): Decl[] {
  const out: Decl[] = []
  for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const raw =
      /font-size:\s*([^;}]+)/.exec(body ?? '')?.[1]?.trim()
      ?? /(?:^|;)\s*font:\s*([\d.]+(?:rem|px))/.exec(body ?? '')?.[1]?.trim()
    if (raw === undefined) continue
    const num = Number.parseFloat(raw)
    const px = raw.endsWith('rem') ? num * 16 : raw.endsWith('px') ? num : Number.NaN
    out.push({ selectors: (sel ?? '').trim(), px, raw })
  }
  return out
}

const DECLS = fontSizes(CSS)
const where = (d: Decl): string => `${d.selectors} { ${d.raw} }`

describe('B4 (partial) — the chrome type floors', () => {
  it('finds the sheet it is meant to be checking', () => {
    expect(DECLS.length).toBeGreaterThan(50)
  })

  it('states every size in a unit it can resolve — no relative font-size', () => {
    for (const d of DECLS) expect(d.px, where(d)).not.toBeNaN()
  })

  it('renders nothing below 12px', () => {
    for (const d of DECLS) expect(d.px, where(d)).toBeGreaterThanOrEqual(TEXT_MIN_PX)
  })

  it('holds every prose surface at 14px or more', () => {
    for (const want of PROSE) {
      const hit = DECLS.filter((d) => d.selectors.split(',').some((s) => s.trim() === want))
      expect(hit.length, `no font-size found for ${want}`).toBeGreaterThan(0)
      for (const d of hit) expect(d.px, where(d)).toBeGreaterThanOrEqual(BODY_MIN_PX)
    }
  })

  // The panels override `body`, so a title that stayed at 13.6px would end up smaller than the
  // prose under it. The full six-step scale is C12 Task 53; this only forbids the inversion.
  it('never sets a panel title below the prose it heads', () => {
    for (const title of ['.px-title', '.bond-title', '.veil-title']) {
      const hit = DECLS.filter((d) => d.selectors.split(',').some((s) => s.trim() === title))
      expect(hit.length, `no font-size found for ${title}`).toBeGreaterThan(0)
      for (const d of hit) expect(d.px, where(d)).toBeGreaterThanOrEqual(BODY_MIN_PX)
    }
  })
})

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const CSS = readFileSync(new URL('./chrome.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

// ── WCAG 2.x relative luminance and contrast, on the sheet's own tokens ──────────────

const channel = (v: number): number => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)

export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => channel(Number.parseInt(hex.slice(i, i + 2), 16) / 255))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

export function contrast(fg: string, bg: string): number {
  const [a, b] = [luminance(fg), luminance(bg)]
  const [hi, lo] = a! > b! ? [a!, b!] : [b!, a!]
  return (hi + 0.05) / (lo + 0.05)
}

/** Every `--name: #hex` in the `:root` block. */
export function tokens(css: string): Record<string, string> {
  const root = /:root\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? ''
  const out: Record<string, string> = {}
  for (const [, name, hex] of root.matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6})/g)) out[name!] = hex!
  return out
}

/** Every declaration the sheet applies to `selector`, in cascade order. */
export function ruleBody(css: string, selector: string): string {
  const hits: string[] = []
  for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if ((sel ?? '').split(',').some((s) => s.trim() === selector)) hits.push(body ?? '')
  }
  if (hits.length === 0) throw new Error(`no rule for ${selector}`)
  return hits.join(';')
}

const T = tokens(CSS)
const AA = 4.5

describe('the palette these fixes are measured against', () => {
  it('reads the tokens out of the sheet', () => {
    expect(T['ink']).toBe('#43394A')
    expect(T['cream']).toBe('#FFF6E9')
    expect(T['sand']).toBe('#E8D5BC')
  })

  it('agrees with the audit on the base pairs', () => {
    expect(contrast(T['ink']!, T['parchment']!)).toBeCloseTo(9.06, 1)
    expect(contrast(T['ink']!, T['cream']!)).toBeCloseTo(10.2, 1)
  })
})

describe('B3 — the timeline day labels are on the slab they sit on', () => {
  const body = ruleBody(CSS, '.timeline-day em')
  const colour = /color:\s*var\(--([\w-]+)\)/.exec(body)?.[1]

  it('paints the label in a token, not in the slab colour under it', () => {
    expect(colour).toBeDefined()
    expect(colour).not.toBe('cream')
  })

  it('clears AA on the cream slab AND on the sand track it overhangs', () => {
    const fg = T[colour!]!
    expect(contrast(fg, T['cream']!)).toBeGreaterThanOrEqual(AA)
    expect(contrast(fg, T['sand']!)).toBeGreaterThanOrEqual(AA)
  })

  it('does not thin its own colour back down with opacity', () => {
    expect(body).not.toMatch(/opacity:/)
  })
})

// ── --ink-quiet: de-emphasis as a chosen colour, not as a transparency ───────────────
// Partial C12 Task 54. Four AA failures and all six near-misses in the audit came from one
// habit: reducing contrast with `opacity`, whose ratio is unknowable at authoring time.
// These are the ink-on-paper sites. Cream text on the night surfaces (.subtitle.thought,
// .roster-empty em) keeps its opacity — a second token for that surface is C12's.
const QUIET_SITES = [
  '.tick-badge.waking', '.strip-weather', '.strip-gone', '.fps-overlay .fps-avg',
  '.cam-btn:disabled', '.block h3', '.thought-line', '.tab-body .stamp', '.veil-sub',
  '.feed-line .stamp', '.feed-empty', '.room-who', '.legend-chip.off', '.legend-stamp',
  '.bond-count', '.bond-dates dt', '.bond-history .stamp', '.thumb-day', '.thumb-cast',
  '.digest-footer', '.roster-gone', '.laws-lede', '.law-history', '.law-edit input:disabled',
]

/** Every paper the chrome paints quiet text on. */
const PAPERS = ['cream', 'parchment', 'sand'] as const

describe('--ink-quiet — the de-emphasis token', () => {
  it('exists as a colour in the palette', () => {
    expect(T['ink-quiet']).toMatch(/^#[0-9A-Fa-f]{6}$/)
  })

  it('clears AA on every paper the chrome uses', () => {
    for (const paper of PAPERS) {
      expect(contrast(T['ink-quiet']!, T[paper]!), `ink-quiet on ${paper}`).toBeGreaterThanOrEqual(AA)
    }
  })

  it('is genuinely quieter than ink, or it is not de-emphasis', () => {
    for (const paper of PAPERS) {
      expect(contrast(T['ink-quiet']!, T[paper]!)).toBeLessThan(contrast(T['ink']!, T[paper]!))
    }
  })
})

describe('the opacity habit, at every ink-on-paper site it produced', () => {
  it.each(QUIET_SITES)('%s states its colour instead of thinning it', (selector) => {
    const body = ruleBody(CSS, selector)
    expect(body, `${selector} still de-emphasises with opacity`).not.toMatch(/opacity:/)
    const colour = /color:\s*var\(--([\w-]+)\)/.exec(body)?.[1]
    expect(colour, `${selector} sets no colour token`).toBeDefined()
    for (const paper of PAPERS) {
      expect(contrast(T[colour!]!, T[paper]!), `${selector} on ${paper}`).toBeGreaterThanOrEqual(AA)
    }
  })
})

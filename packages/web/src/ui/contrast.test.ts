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

/** The declaration body of the first rule whose selector list contains `selector` exactly. */
export function ruleBody(css: string, selector: string): string {
  for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if ((sel ?? '').split(',').some((s) => s.trim() === selector)) return body ?? ''
  }
  throw new Error(`no rule for ${selector}`)
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

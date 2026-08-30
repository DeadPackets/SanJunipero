import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const CSS = readFileSync(new URL('./chrome.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
)

// ── WCAG 2.x relative luminance and contrast, on the sheet's own tokens ──────────────

const channel = (v: number): number => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)

export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => channel(Number.parseInt(hex.slice(i, i + 2), 16) / 255))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

export function contrast(fg: string, bg: string): number {
  const [a, b] = [luminance(fg), luminance(bg)]
  const [hi, lo] = a > b ? [a, b] : [b, a]
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
    expect(T.ink).toBe('#43394A')
    expect(T.cream).toBe('#FFF6E9')
    expect(T.sand).toBe('#E8D5BC')
  })

  it('agrees with the audit on the base pairs', () => {
    expect(contrast(T.ink!, T.parchment!)).toBeCloseTo(9.06, 1)
    expect(contrast(T.ink!, T.cream!)).toBeCloseTo(10.2, 1)
  })
})

describe('B3 — the day-strip labels are on the slab they sit on', () => {
  const body = ruleBody(CSS, '.day-tick em')
  const colour = /color:\s*var\(--([\w-]+)\)/.exec(body)?.[1]

  it('paints the label in a token, not in the slab colour under it', () => {
    expect(colour).toBeDefined()
    expect(colour).not.toBe('cream')
  })

  it('clears AA on the cream slab AND on the sand track it overhangs', () => {
    const fg = T[colour!]!
    expect(contrast(fg, T.cream!)).toBeGreaterThanOrEqual(AA)
    expect(contrast(fg, T.sand!)).toBeGreaterThanOrEqual(AA)
  })

  it('does not thin its own colour back down with opacity', () => {
    expect(body).not.toMatch(/opacity:/)
  })
})

// ── --ink-quiet: de-emphasis as a chosen colour, not as a transparency ───────────────
// Reducing contrast with `opacity` makes the ratio unknowable at authoring time. These are the
// ink-on-paper sites; the dark grounds are below.
const QUIET_SITES = [
  '.fps-overlay .fps-avg',
  '.block h3',
  '.thought-line',
  '.paper-sheet .stamp',
  '.feed-line .stamp',
  '.feed-empty',
  '.edition-temper',
  '.edition-caption',
  '.chapter-head .stamp',
  '.biography-head .stamp',
  '.room-who',
  '.legend-chip.off',
  '.legend-stamp',
  // `.bond-count` is gone: task 85 retired the strength bar and the count under it, because a
  // count that can only go up cannot express a relationship cooling.
  '.bond-evidence',
  '.bond-dates dt',
  '.bond-history .stamp',
  '.thumb-day',
  '.thumb-cast',
  '.roster-gone',
  '.law-history',
  '.law-edit input:disabled',
]

// A thought must read as a different INK, not a thinner one, or its ratio is unknowable at the one
// surface where the town is actually speaking.
const DARK_QUIET_SITES = ['.player-clock']

/** Every paper the chrome paints quiet text on. */
const PAPERS = ['cream', 'parchment', 'sand'] as const
/** The two dark grounds the chrome paints quiet CREAM on. */
const DARK_PAPERS = ['deep', 'night'] as const

describe('--ink-quiet — the de-emphasis token', () => {
  it('exists as a colour in the palette', () => {
    expect(T['ink-quiet']).toMatch(/^#[0-9A-Fa-f]{6}$/)
  })

  it('clears AA on every paper the chrome uses', () => {
    for (const paper of PAPERS) {
      expect(contrast(T['ink-quiet']!, T[paper]!), `ink-quiet on ${paper}`).toBeGreaterThanOrEqual(
        AA,
      )
    }
  })

  it('is genuinely quieter than ink, or it is not de-emphasis', () => {
    for (const paper of PAPERS) {
      expect(contrast(T['ink-quiet']!, T[paper]!)).toBeLessThan(contrast(T.ink!, T[paper]!))
    }
  })
})

// R6: a shut key must still say that lines are being filtered out, so the badge that says it
// is the one piece of chrome that carries ink on a saturated fill.
describe('the filtered-count badge on the shut bonds key', () => {
  it('paints its own two tokens, and they clear AA', () => {
    const body = ruleBody(CSS, '.key-filtered')
    const fg = /color:\s*var\(--([\w-]+)\)/.exec(body)?.[1]
    const bg = /background:\s*var\(--([\w-]+)\)/.exec(body)?.[1]
    expect(fg).toBe('deep')
    expect(bg).toBe('ember')
    expect(contrast(T[fg!]!, T[bg!]!)).toBeGreaterThanOrEqual(AA)
  })
})

describe('--cream-quiet — the same de-emphasis, on the dark ground the town speaks over', () => {
  it('exists as a colour, clears AA on both dark grounds, and is visibly quieter than cream', () => {
    expect(T['cream-quiet']).toMatch(/^#[0-9A-Fa-f]{6}$/)
    for (const paper of DARK_PAPERS) {
      expect(
        contrast(T['cream-quiet']!, T[paper]!),
        `cream-quiet on ${paper}`,
      ).toBeGreaterThanOrEqual(AA)
      expect(
        contrast(T['cream-quiet']!, T[paper]!),
        `cream-quiet vs cream on ${paper}`,
      ).toBeLessThan(contrast(T.cream!, T[paper]!))
    }
  })

  it.each(DARK_QUIET_SITES)('%s states its colour instead of thinning it', (selector) => {
    const body = ruleBody(CSS, selector)
    expect(body, `${selector} still de-emphasises with opacity`).not.toMatch(/opacity:/)
    const colour = /color:\s*var\(--([\w-]+)\)/.exec(body)?.[1]
    expect(colour, `${selector} sets no colour token`).toBeDefined()
    for (const paper of DARK_PAPERS) {
      expect(contrast(T[colour!]!, T[paper]!), `${selector} on ${paper}`).toBeGreaterThanOrEqual(AA)
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

// ── ★ THE BADGE THAT RAISES ITS VOICE, MEASURED ───────────────────────────────────────────

describe('a stale clock is legible, not just loud', () => {
  const ROSE_SITES = ['.badge.ill', '.rr-cond.ill']

  it.each(ROSE_SITES)('%s clears AA on the rose it wears', (selector) => {
    const body = ruleBody(CSS, selector)
    const fg = /color:\s*var\(--([\w-]+)\)/.exec(body)?.[1]
    const bg = /background:\s*var\(--([\w-]+)\)/.exec(body)?.[1]
    expect(bg, `${selector} sets no background token`).toBe('rose')
    expect(fg, `${selector} sets no colour token`).toBeDefined()
    expect(contrast(T[fg!]!, T.rose!), selector).toBeGreaterThanOrEqual(AA)
  })

  it('records the pair it rejected, so it cannot come back', () => {
    expect(contrast(T.cream!, T.rose!)).toBeCloseTo(3.12, 2)
    expect(contrast(T.deep!, T.rose!)).toBeCloseTo(4.82, 2)
  })
})

describe('a mark drawn to divide the panel can actually be seen', () => {
  // .block is laid on the paper's parchment and on the cream slabs inside it. --sand is 1.19:1
  // on the first and 1.34:1 on the second: the rule was a smudge on both.
  it('paints the section rule in a token that clears 3:1 on both grounds it is laid on', () => {
    const body = ruleBody(CSS, '.block h3::after')
    const colour = /repeating-linear-gradient\([^)]*var\(--([\w-]+)\)/.exec(body)?.[1]
    expect(colour, 'the rule paints no palette token').toBeDefined()
    for (const paper of ['parchment', 'cream'] as const) {
      expect(
        contrast(T[colour!]!, T[paper]!),
        `.block h3::after on ${paper}`,
      ).toBeGreaterThanOrEqual(3)
    }
  })

  it('records the pair it rejected, so it cannot come back', () => {
    expect(contrast(T.sand!, T.parchment!)).toBeCloseTo(1.19, 2)
    expect(contrast(T.sand!, T.cream!)).toBeCloseTo(1.34, 2)
  })
})

const GROUNDS = ['parchment', 'cream', 'sand', 'honey'] as const

describe('C1 · the focus ring is visible on every ground it sits on', () => {
  const ring = (selector: string): string =>
    /outline:\s*2px solid var\(--([\w-]+)\)/.exec(ruleBody(CSS, selector))?.[1] ?? ''

  it('paints the ring in one token across the chrome and the two clipping boxes', () => {
    expect(ring(':focus-visible')).toBe('ink')
    expect(ring('.paper-sheet :focus-visible')).toBe('ink')
    expect(ring('.bonds-graph :focus-visible')).toBe('ink')
  })

  it('clears SC 1.4.11 (3:1) on all four papers', () => {
    for (const ground of GROUNDS) {
      expect(contrast(T.ink!, T[ground]!), `the ring on ${ground}`).toBeGreaterThanOrEqual(3)
    }
  })

  it('records the ember it replaced, so it cannot come back', () => {
    expect(contrast(T.ember!, T.parchment!)).toBeCloseTo(2.4, 1)
    expect(contrast(T.ember!, T.honey!)).toBeCloseTo(1.84, 1)
  })

  // The two stage marks keep honey: they are the only rings painted on the deep ground.
  it('keeps the honey ring where honey is the legible one', () => {
    expect(ruleBody(CSS, '.stage-figure:focus-visible')).toMatch(/var\(--honey\)/)
    expect(contrast(T.honey!, T.deep!)).toBeGreaterThanOrEqual(3)
  })
})

describe('C3, C4, C5 · three marks that were painted below their own floor', () => {
  it('underlines the open tab in something a reader can see', () => {
    const colour = /border-bottom-color:\s*var\(--([\w-]+)\)/.exec(
      ruleBody(CSS, '.paper-tab.on'),
    )?.[1]
    expect(colour).toBe('ink')
    expect(contrast(T.honey!, T.parchment!), 'the honey rule it replaced').toBeLessThan(3)
  })

  it('draws the grip at the 3:1 non-text floor on the parchment it lies on', () => {
    const hex = /background:\s*(#[0-9A-Fa-f]{6})/.exec(ruleBody(CSS, '.paper-grip'))?.[1]
    expect(hex).toBeDefined()
    expect(contrast(hex!, T.parchment!)).toBeGreaterThanOrEqual(3)
    expect(contrast('#B89D7E', T.parchment!), 'the bar it replaced').toBeLessThan(3)
  })

  it('draws the day gridlines on the cream track they cross', () => {
    const colour = /background:\s*var\(--([\w-]+)\)/.exec(ruleBody(CSS, '.day-tick'))?.[1]
    expect(colour).toBe('ink-quiet')
    expect(contrast(T[colour!]!, T.cream!)).toBeGreaterThanOrEqual(3)
  })
})

describe('C9 · the signpost arm, whose ground is a drawn plank and not a token', () => {
  // Cream on the plank's own wood sampled at 2.13:1, and a halo smeared the glyphs; the label is
  // deep ink painted on the wood instead — 7.66:1 idle, 5.46:1 pressed, sampled off the render.
  it('paints the label in deep ink, with a cut edge and no ink halo', () => {
    const body = ruleBody(CSS, '.signpost-arm')
    expect(body).toMatch(/color:\s*var\(--deep\)/)
    expect(body).toMatch(/text-shadow:\s*0 1px 0 var\(--honey-l\)/)
    expect(body).not.toContain('-1px 0 0')
  })

  // brightness(1.2) on the pressed arm took the label to 1.53:1 — the arm you are on was the
  // least readable one on screen.
  it('signals the open arm with a second plank, never with a filter', () => {
    expect(CSS).not.toMatch(/\.signpost-arm[^{]*\{[^}]*filter:/)
    expect(ruleBody(CSS, ".signpost-arm[aria-expanded='true']")).toContain('signpost-arm-on.webp')
  })

  // The ring sits over whatever the town is: honey inside deep is 9.6:1 between its own two rings.
  it('gives the focus ring its own ground', () => {
    const body = ruleBody(CSS, '.signpost-arm:focus-visible')
    expect(body).toMatch(/outline:\s*2px solid var\(--honey\)/)
    expect(body).toMatch(/box-shadow:[^;]*var\(--deep\)/)
    expect(contrast(T.honey!, T.deep!)).toBeGreaterThanOrEqual(3)
  })
})

describe('C6, C11, C12 · the sheet stops thinning colours it cannot measure', () => {
  it('states the stamp at full strength', () => {
    expect(ruleBody(CSS, '.stage-stamp.shown')).toMatch(/opacity:\s*1/)
  })

  it('names the feed zebra as a computed composite rather than an alpha', () => {
    expect(T['parchment-zebra']).toMatch(/^#[0-9A-Fa-f]{6}$/)
    expect(ruleBody(CSS, '.feed-line:nth-child(odd)')).toContain('var(--parchment-zebra)')
    expect(contrast(T.ink!, T['parchment-zebra']!)).toBeGreaterThanOrEqual(AA)
  })

  it('rings the subject in a token, not in a transparency', () => {
    const body = ruleBody(CSS, '.stage-ring-arms')
    expect(body).toContain('dashed var(--cream-quiet)')
    expect(body).not.toMatch(/rgba\(/)
  })
})

describe('the week band is read on the honey it is printed on', () => {
  it('clears AA, and paints both halves of the pair rather than inheriting one', () => {
    const body = ruleBody(CSS, '.era-band')
    const fg = /color:\s*var\(--([\w-]+)\)/.exec(body)?.[1]
    const bg = /background:\s*var\(--([\w-]+)\)/.exec(body)?.[1]
    expect(fg, '.era-band paints no text token').toBeDefined()
    expect(bg, '.era-band paints no ground token').toBeDefined()
    expect(contrast(T[fg!]!, T[bg!]!)).toBeGreaterThanOrEqual(AA)
  })
})

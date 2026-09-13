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

/** The colour wheel angle of a hex, so two roles can be asked how far apart they read. */
function hue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ]
  const hi = Math.max(r, g, b)
  const lo = Math.min(r, g, b)
  if (hi === lo) return 0
  const d = hi - lo
  const a = hi === r ? (g - b) / d + (g < b ? 6 : 0) : hi === g ? (b - r) / d + 2 : (r - g) / d + 4
  return a * 60
}

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
  '.biography-head .stamp',
  '.room-who',
  // `.bond-count` is gone: task 85 retired the strength bar and the count under it, because a
  // count that can only go up cannot express a relationship cooling.
  '.bond-evidence',
  '.bond-dates dt',
  '.bond-history .stamp',
  '.thumb-when',
  '.thumb-cast',
  '.roster-gone',
  '.law-history',
  '.law-edit input:disabled',
]

// A thought must read as a different INK, not a thinner one, or its ratio is unknowable at the one
// surface where the town is actually speaking.
const DARK_QUIET_SITES = ['.day-bar-when', '.night-dreamt']

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

// ── ★ ONE COLOUR, ONE QUESTION ────────────────────────────────────────────────────────────
// --ember was read at nine sites answering six questions: is this body ill, is this the one I
// am in, which material is this first cut from, is a filter on, where is the tape, and how much
// is at stake. Nobody can learn a colour that answers six questions.

/** The sites that paint each role's colour, and the one question it answers there. */
const ROLES: Readonly<Record<string, readonly string[]>> = {
  // the one you are in, the control that is on, and where the tape stands on either track
  current: [
    ".feed-jump[aria-current='true']",
    ".moment-card[data-open='yes']",
    ".discovery-leaf[aria-current='true']",
    ".room-door[aria-pressed='true']",
    '.playhead',
    '.day-bar-cursor',
    '.story-here',
  ],
  // how hot: the top of the stakes band, and the material cut for a mind's own working out
  ember: [
    ".stage-scene-stamp[data-stakes='hot']",
    ".first-plate[data-material='ember']",
    '.story-heat-fill',
  ],
  // the step under it, so the band is one heat at two strengths
  'ember-pale': [".stage-scene-stamp[data-stakes='warm']"],
  // struck metal: the tier the town's own work is cut at
  gilt: [".first-plate[data-material='gilded']"],
  // a mark our own hand made, on a page the town never prints
  operator: ['.ops-word.stopped', '.sheet-note.operator', '.dossier-card[data-deciding]::before'],
}

/** Every selector in the sheet whose own declarations read `--name`. */
function readersOf(css: string, name: string): string[] {
  const out: string[] = []
  for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!(body ?? '').includes(`var(--${name})`)) continue
    for (const one of (sel ?? '').split(',')) out.push(one.trim().split('\n').at(-1)!.trim())
  }
  return [...new Set(out)]
}

describe('★ a colour that means two things means neither', () => {
  it.each(Object.entries(ROLES))(
    '★ --%s is read by its own role and by nothing else',
    (name, sites) => {
      expect(readersOf(CSS, name).sort()).toEqual([...sites].sort())
    },
  )

  it('★ paints the two roles in two colours a viewer can tell apart', () => {
    expect(T.current).not.toBe(T.ember)
    const apart = Math.min(
      Math.abs(hue(T.current!) - hue(T.ember!)),
      360 - Math.abs(hue(T.current!) - hue(T.ember!)),
    )
    expect(apart, `--current is ${apart.toFixed(0)}° off --ember`).toBeGreaterThanOrEqual(60)
  })

  it('★ clears AA under the deep it carries, and the 3:1 rail floor on the cream it rules', () => {
    expect(contrast(T.deep!, T.current!)).toBeGreaterThanOrEqual(AA)
    expect(contrast(T.current!, T.cream!)).toBeGreaterThanOrEqual(3)
  })

  it('records the ember it took the six questions off, so they cannot come back', () => {
    expect(contrast(T.ember!, T.cream!), 'the rail ember drew on cream').toBeCloseTo(2.7, 1)
  })
})

// ── ★ AND THE ACCENT WAS ANSWERING FOUR MORE ──────────────────────────────────────────────
// --honey was read at 52 sites. Four of them were never the accent: how hot a scene is, what a
// first is cut from, what our own hand changed, and where the tape stands on the day's track.

describe('★ the questions taken off the accent', () => {
  it('★ paints the warm step of the stakes band in a heat, never in the accent', () => {
    expect(T['ember-pale']).not.toBe(T.honey)
    const apart = Math.abs(hue(T['ember-pale']!) - hue(T.ember!))
    expect(apart, 'the band must read as one heat at two strengths').toBeLessThan(15)
    expect(contrast(T['ember-pale']!, T.deep!), 'warm on the band').toBeGreaterThanOrEqual(AA)
    expect(contrast(T['ember-pale']!, T.ember!), 'and the two steps must differ').toBeGreaterThan(
      1.3,
    )
  })

  it('★ gives the gilded plate an ink a reader can find on the paper it drops on', () => {
    for (const paper of ['parchment', 'cream'] as const) {
      expect(contrast(T.gilt!, T[paper]!), `the gilded drop on ${paper}`).toBeGreaterThanOrEqual(3)
    }
  })

  it('records the honey it replaced, so an invisible plate cannot come back', () => {
    expect(contrast(T.honey!, T.parchment!), 'the drop honey threw').toBeCloseTo(1.31, 2)
  })

  it('★ prints our own hand in a colour nothing the town prints is', () => {
    expect(contrast(T.ink!, T.operator!), 'ink on the operator slab').toBeGreaterThanOrEqual(AA)
    const apart = Math.min(
      Math.abs(hue(T.operator!) - hue(T.honey!)),
      360 - Math.abs(hue(T.operator!) - hue(T.honey!)),
    )
    expect(apart, `--operator is ${apart.toFixed(0)}° off the accent`).toBeGreaterThanOrEqual(60)
  })
})

// The rail is the second channel on "ill", and ember on rose was 1.15:1 — a channel nobody
// could see, asserting a redundancy the picture never had.
describe('★ the rail that says unwell can actually be seen', () => {
  it.each(['.badge.ill', '.rr-cond.ill'])('%s draws a rail at 3:1 on its own rose', (selector) => {
    const rail = /border-left:[^;]*var\(--([\w-]+)\)/.exec(ruleBody(CSS, selector))?.[1]
    expect(rail, `${selector} draws no rail`).toBeDefined()
    expect(contrast(T[rail!]!, T.rose!)).toBeGreaterThanOrEqual(3)
  })

  it('records the rail it replaced, so it cannot come back', () => {
    expect(contrast(T.ember!, T.rose!)).toBeCloseTo(1.15, 2)
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
    // Solid or a gradient — what the test guards is the token, not how the rule is painted.
    const colour = /background:[^;]*var\(--([\w-]+)\)/.exec(body)?.[1]
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
    const colour = /background:\s*var\(--([\w-]+)\)/.exec(ruleBody(CSS, '.paper-grip'))?.[1]
    expect(colour).toBe('ink-quiet')
    expect(contrast(T[colour!]!, T.parchment!)).toBeGreaterThanOrEqual(3)
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
  // The clock used to ship at opacity 0 and wake for three seconds on a pointer move, so a
  // viewer who put the town on a tab and watched never saw the time, the season or LIVE at all.
  it('★ states the clock at full strength, and never thins it behind a hand', () => {
    expect(ruleBody(CSS, '.day-bar-stamp')).toContain('color: var(--cream)')
    expect(ruleBody(CSS, '.day-bar-day')).toContain('color: var(--cream)')
    expect(ruleBody(CSS, '.day-bar-weather')).toContain('color: var(--cream)')
    expect(ruleBody(CSS, '.day-bar-state')).toContain('color: var(--honey)')
    expect(CSS).not.toMatch(/\.day-bar[\w-]*[^{]*\{[^}]*opacity:/)
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

// ── ★ THE FOUR BOOKS ──────────────────────────────────────────────────────────────────────
// One colour each, on the masthead rule and the active tab. On the parchment they are drawn on,
// --honey is 1.31:1, --sage 1.91 and --rose 2.77, all under the 3:1 a mark needs — so the band
// is laid hard against the masthead's own ink rule, and each book has to clear the floor on one
// of the two edges it touches.
const BOOKS: Readonly<Record<string, string>> = {
  folk: 'rose',
  chronicle: 'honey',
  found: 'sage',
  laws: 'sky',
}

describe('★ the four books, and the edge that makes each one visible', () => {
  it('gives every arm a colour of its own', () => {
    for (const [book, token] of Object.entries(BOOKS))
      expect(ruleBody(CSS, `.paper[data-book='${book}']`), book).toContain(
        `--book: var(--${token})`,
      )
    expect(new Set(Object.values(BOOKS)).size).toBe(4)
  })

  it('★ clears 3:1 against the ink rule above it or the parchment below it', () => {
    for (const [book, token] of Object.entries(BOOKS)) {
      const best = Math.max(contrast(T[token]!, T.ink!), contrast(T[token]!, T.parchment!))
      expect(best, `${book} (--${token}) can be seen on neither edge`).toBeGreaterThanOrEqual(3)
    }
  })

  it('★ keeps the four far enough apart on the wheel to be told apart', () => {
    const hues = Object.values(BOOKS).map((t) => hue(T[t]!))
    for (let i = 0; i < hues.length; i++)
      for (let j = i + 1; j < hues.length; j++) {
        const gap = Math.abs(hues[i]! - hues[j]!)
        expect(Math.min(gap, 360 - gap), `${i} against ${j}`).toBeGreaterThanOrEqual(30)
      }
  })

  it('records the hairlines it rejected, so they cannot come back', () => {
    expect(contrast(T.honey!, T.parchment!)).toBeCloseTo(1.31, 2)
    expect(contrast(T.sage!, T.parchment!)).toBeCloseTo(1.91, 2)
    expect(contrast(T.rose!, T.parchment!)).toBeCloseTo(2.77, 2)
    expect(
      contrast(T.sky!, T.ink!),
      'and --sky, which is the one that vanishes on ink',
    ).toBeCloseTo(1.81, 2)
  })
})

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CSS_DURATION_TOKEN } from './motion.js'

// U23's "extra final touches to give it that extra shine", turned into TWELVE LINES WITH A
// TEST EACH, so "polish" is not a vibe somebody claims. Every line below was a known finish
// defect in the landed surface or a known AAA affordance it lacked.

const CSS = readFileSync(new URL('./chrome.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const src = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8')

/** Every declaration block whose selector list contains `sel` exactly, joined in cascade order. */
export function rulesFor(css: string, sel: string): string {
  const hits: string[] = []
  for (const [, list, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if ((list ?? '').split(',').some((s) => s.trim() === sel)) hits.push(body ?? '')
  }
  return hits.join(';')
}

/** Whether ANY selector in the sheet mentions `needle` (for descendant/state rules). */
export function selectorsMatching(css: string, needle: RegExp): string[] {
  const out: string[] = []
  for (const [, list] of css.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    for (const s of (list ?? '').split(',')) if (needle.test(s.trim())) out.push(s.trim())
  }
  return out
}

/** The value the cascade lands on: the LAST declaration of `prop`, not the first. */
export function decl(body: string, prop: string): string | null {
  const all = [...body.matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;}]+)`, 'g'))]
  const last = all.at(-1)
  return last === undefined ? null : last[1]!.trim()
}

const missing = (list: readonly string[], ok: (sel: string) => boolean): string[] =>
  list.filter((s) => !ok(s))

// ★ ANTI-VACUITY. A line that names a selector the sheet does not have can be satisfied by
// writing DEAD CSS, and then twelve green lines mean nothing. Every selector any row below
// names must already exist as a rule — the row proves a PROPERTY of a real surface, never
// the existence of a rule invented to pass it.
const ALL_NAMED: string[] = []
const named = <T extends readonly string[]>(list: T): T => {
  ALL_NAMED.push(...list)
  return list
}

// ── 1 · optical alignment ─────────────────────────────────────────────────────────────────
// An icon beside a word is two boxes of different heights. Centring them centres the BOXES;
// what a reader sees is the two baselines disagreeing. Every inline pair states its rule.
const ICON_LABEL_PAIRS = named(['.legend-chip', '.strip-cell', '.feed-line', '.room-roll li', '.rr-doing'])

describe('1 · an icon and its word sit on one line, declared and never defaulted', () => {
  it('states align-items on every inline icon+label pair', () => {
    expect(missing(ICON_LABEL_PAIRS, (s) => {
      const v = decl(rulesFor(CSS, s), 'align-items')
      return v === 'baseline' || v === 'center'
    })).toEqual([])
  })
})

// ── 2 · tabular figures wherever a number ticks ───────────────────────────────────────────
const TICKING_NUMBERS = named([
  '.tick-badge', '.strip-num i', '.tab-count', '.player-clock', '.thumb-day',
  '.tab-body .stamp', '.feed-line .stamp', '.bond-history .stamp',
])

describe('2 · a ticking number never shifts the box it sits in', () => {
  it('sets tabular figures on every live number', () => {
    expect(missing(TICKING_NUMBERS, (s) =>
      decl(rulesFor(CSS, s), 'font-variant-numeric') === 'tabular-nums')).toEqual([])
  })
})

// ── 3 · no layout shift on state change ───────────────────────────────────────────────────
// A badge appearing must not reflow its row: the slot is there whether or not it is filled.
const RESERVED_SLOTS = named(['.ctl-btn', '.rr-state', '.rr-place', '.rr-mood'])

describe('3 · a state arriving does not move the row it arrives in', () => {
  it('reserves the slot, so an empty one is the same size as a full one', () => {
    expect(missing(RESERVED_SLOTS, (s) => {
      const body = rulesFor(CSS, s)
      return decl(body, 'min-width') !== null || decl(body, 'flex-basis') !== null
    })).toEqual([])
  })
})

// ── 4 · focus is never clipped ────────────────────────────────────────────────────────────
// An outline drawn OUTSIDE a scroll container's edge is painted into the overflow and lost.
const CLIPPING_CONTAINERS = named(['#panel-outlet', '.stage-cell', '.hud-menu', '.strip-list', '.digest-modal'])

describe('4 · a focus ring inside a clipping box is drawn inside it', () => {
  it('gives every clipping container an inset ring for its focusable children', () => {
    expect(missing(CLIPPING_CONTAINERS, (s) => {
      const rules = selectorsMatching(CSS, new RegExp(`^${s.replace(/[.#]/g, '\\$&')}\\s.*:focus-visible$`))
      return rules.some((r) => {
        const v = decl(rulesFor(CSS, r), 'outline-offset')
        return v !== null && v.startsWith('-')
      })
    })).toEqual([])
  })
})

// ── 5 · press has weight ──────────────────────────────────────────────────────────────────
const CONTROLS = named([
  '.tab', '.ctl-btn', '.feed-tab', '.live-pill', '.legend-chip', '.hud-slot', '.roster-back',
  '.interior-back',
])

describe('5 · a control answers the finger that pressed it', () => {
  it('moves and loses a shadow step on :active, for every control', () => {
    expect(missing(CONTROLS, (s) => {
      const body = rulesFor(CSS, `${s}:active`) + rulesFor(CSS, `${s}:active:not(:disabled)`)
      return decl(body, 'translate') !== null && decl(body, 'box-shadow') !== null
    })).toEqual([])
  })
})

// ── 6 · hover is 150ms in and instant out ─────────────────────────────────────────────────
// A hover that fades OUT keeps claiming the pointer is somewhere it left.
describe('6 · a hover arrives in 150ms and leaves the instant the pointer does', () => {
  it('transitions in on --t-fast and out on 0s, for every hovering control', () => {
    expect(missing(CONTROLS, (s) => {
      const base = rulesFor(CSS, s)
      const inMs = decl(base, 'transition-duration')
      const out = decl(rulesFor(CSS, `${s}:hover`), 'transition-duration')
      return inMs === `var(${CSS_DURATION_TOKEN.reveal})` && out === '0s'
    })).toEqual([])
  })
})

// ── 7 · a loading surface has a shape, not a spinner ──────────────────────────────────────
describe('7 · waiting looks like the thing that is coming', () => {
  it('defines a skeleton slab at a real row height', () => {
    expect(decl(rulesFor(CSS, '.skeleton-row'), 'height')).not.toBeNull()
    expect(decl(rulesFor(CSS, '.skeleton-row'), 'background')).not.toBeNull()
  })

  it('renders skeleton rows in the panels that wait for a fetch', () => {
    for (const f of ['./ChroniclePanel.tsx', './RosterPanel.tsx']) {
      expect(src(f), f).toContain('skeleton-row')
    }
  })
})

// ── 8 · nothing pops in ───────────────────────────────────────────────────────────────────
describe('8 · art arriving is a cross-fade, never a hard swap', () => {
  it('fades a building sprite in when the codex hands over its art', () => {
    expect(src('../render/entities.ts')).toContain('fadeArtIn(entry.sprite)')
  })

  it('takes the reveal motion from the one table, not a number of its own', () => {
    expect(src('../render/textures.ts')).toMatch(/ART_FADE: MotionName = 'reveal'/)
  })
})

// ── 9 · the cursor tells the truth ────────────────────────────────────────────────────────
describe('9 · the cursor never lies about what is under it', () => {
  it('is a pointer on every control', () => {
    expect(missing(CONTROLS, (s) => decl(rulesFor(CSS, s), 'cursor') === 'pointer')).toEqual([])
  })

  it('is not-allowed on a disabled one, and a grab hand on the town', () => {
    expect(decl(rulesFor(CSS, '.ctl-btn:disabled'), 'cursor')).toBe('not-allowed')
    // the canvas cursor is Pixi's, not the sheet's
    expect(src('../render/scene.ts')).toContain("'grab'")
    expect(src('../render/scene.ts')).toContain("'grabbing'")
  })
})

// ── 10 · the sound of silence ─────────────────────────────────────────────────────────────
describe('10 · a world with nothing happening still breathes', () => {
  it('keeps at least one moving thing in every season and every phase', () => {
    expect(src('../render/ambient.ts')).toMatch(/SHIMMER_MAX|TREES_MAX/)
    // the ambient population is a positive constant in every band, asserted as a finish line
    for (const n of ['SHIMMER_MAX', 'TREES_MAX', 'SMOKE_PUFFS']) {
      const v = new RegExp(`export const ${n} = (\\d+)`).exec(src('../render/ambient.ts'))
      expect(v, n).not.toBeNull()
      expect(Number(v![1]), n).toBeGreaterThan(0)
    }
  })
})

// ── 11 · text never widows ────────────────────────────────────────────────────────────────
const TITLES = named(['.px-title', '.bond-title', '.veil-title', '.thumb-title', '.tab-body article h4'])
const PARAGRAPHS = named(['.block p', '.feed-text', '.room-who', '.veil-sub', '.room-empty'])

describe('11 · a title never leaves one word on its own line', () => {
  it('balances every title', () => {
    expect(missing(TITLES, (s) => decl(rulesFor(CSS, s), 'text-wrap') === 'balance')).toEqual([])
  })

  it('prettifies every paragraph', () => {
    expect(missing(PARAGRAPHS, (s) => decl(rulesFor(CSS, s), 'text-wrap') === 'pretty')).toEqual([])
  })
})

// ── 12 · the scrollbars are the town's ────────────────────────────────────────────────────
const SCROLLERS = named(['#panel-outlet', '.hud-menu', '.strip-list', '.digest-modal'])

describe('12 · a scrollable region says so, in the town\'s own colours', () => {
  it('paints every scroll container\'s bar from the palette and keeps it visible', () => {
    expect(missing(SCROLLERS, (s) => {
      const body = rulesFor(CSS, s)
      return decl(body, 'scrollbar-color') !== null && decl(body, 'scrollbar-width') !== null
    })).toEqual([])
  })
})

// ── the anti-vacuity check, last so every list is registered ──────────────────────────────
describe('every line above is about a surface that exists', () => {
  it('names no selector the sheet does not already have a rule for', () => {
    const phantom = [...new Set(ALL_NAMED)].filter((s) => rulesFor(CSS, s).length === 0)
    expect(phantom, 'a finish line satisfiable by writing dead CSS is not a finish line')
      .toEqual([])
  })
})

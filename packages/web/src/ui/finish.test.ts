import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CSS_DURATION_TOKEN } from './motion.js'

const CSS = readFileSync(new URL('./chrome.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
)
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

// ANTI-VACUITY. A row naming a selector the sheet does not have can be satisfied by writing DEAD
// CSS, so every selector named below must already exist as a rule.
const ALL_NAMED: string[] = []
const named = <T extends readonly string[]>(list: T): T => {
  ALL_NAMED.push(...list)
  return list
}

// ── 1 · optical alignment ─────────────────────────────────────────────────────────────────
// An icon beside a word is two boxes of different heights: centring them centres the BOXES, and
// what a reader sees is the two baselines disagreeing.
const ICON_LABEL_PAIRS = named([
  '.legend-chip',
  '.bonds-views',
  '.feed-line',
  '.room-roll li',
  '.rr-doing',
])

describe('1 · an icon and its word sit on one line, declared and never defaulted', () => {
  it('states align-items on every inline icon+label pair', () => {
    expect(
      missing(ICON_LABEL_PAIRS, (s) => {
        const v = decl(rulesFor(CSS, s), 'align-items')
        return v === 'baseline' || v === 'center'
      }),
    ).toEqual([])
  })
})

// ── 2 · tabular figures wherever a number ticks ───────────────────────────────────────────
const TICKING_NUMBERS = named([
  '.player-clock',
  '.thumb-day',
  '.paper-sheet .stamp',
  '.feed-line .stamp',
  '.bond-history .stamp',
  '.edge-when',
  '.day-tick em',
  '.family-children .stamp',
])

describe('2 · a ticking number never shifts the box it sits in', () => {
  it('sets tabular figures on every live number', () => {
    expect(
      missing(
        TICKING_NUMBERS,
        (s) => decl(rulesFor(CSS, s), 'font-variant-numeric') === 'tabular-nums',
      ),
    ).toEqual([])
  })
})

// ── 3 · no layout shift on state change ───────────────────────────────────────────────────
// A badge appearing must not reflow its row: the slot is there whether or not it is filled.
const RESERVED_SLOTS = named(['.rr-state', '.rr-place', '.rr-mood'])

describe('3 · a state arriving does not move the row it arrives in', () => {
  it('reserves the slot, so an empty one is the same size as a full one', () => {
    expect(
      missing(RESERVED_SLOTS, (s) => {
        const body = rulesFor(CSS, s)
        return decl(body, 'min-width') !== null || decl(body, 'flex-basis') !== null
      }),
    ).toEqual([])
  })
})

// ── 4 · focus is never clipped ────────────────────────────────────────────────────────────
// An outline drawn OUTSIDE a scroll container's edge is painted into the overflow and lost.
const CLIPPING_CONTAINERS = named(['.paper-sheet', '.bonds-graph'])

describe('4 · a focus ring inside a clipping box is drawn inside it', () => {
  it('gives every clipping container an inset ring for its focusable children', () => {
    expect(
      missing(CLIPPING_CONTAINERS, (s) => {
        const rules = selectorsMatching(
          CSS,
          new RegExp(`^${s.replace(/[.#]/g, '\\$&')}\\s.*:focus-visible$`),
        )
        return rules.some((r) => {
          const v = decl(rulesFor(CSS, r), 'outline-offset')
          return v?.startsWith('-') === true
        })
      }),
    ).toEqual([])
  })
})

// ── 5 · press has weight ──────────────────────────────────────────────────────────────────
// Every control that lifts on hover, not the seven somebody happened to list: `.roster-row`,
// `.key-summary` and `.discovery-leaf` carried the duration on their base rule and so kept
// fading out for 150ms after finish line 6 was declared closed.
const CONTROLS = named([
  '.feed-tab',
  '.live-pill',
  '.legend-chip',
  '.signpost-arm',
  '.room-door',
  '.place-row',
  '.roster-sort',
  '.roster-row',
  '.key-summary',
  '.discovery-leaf',
])

describe('5 · a control answers the finger that pressed it', () => {
  it('moves and loses a shadow step on :active, for every control', () => {
    expect(
      missing(CONTROLS, (s) => {
        const body = rulesFor(CSS, `${s}:active`) + rulesFor(CSS, `${s}:active:not(:disabled)`)
        return decl(body, 'translate') !== null && decl(body, 'box-shadow') !== null
      }),
    ).toEqual([])
  })
})

// ── 6 · hover is 150ms in and instant out ─────────────────────────────────────────────────
// A hover that fades OUT keeps claiming the pointer is somewhere it left. A transition reads
// the duration of the state it goes TO, so the 150ms belongs on `:hover` and the 0s on the base
// — the sheet had them the other way round and every hover-out lied for 150ms.
describe('6 · a hover arrives in 150ms and leaves the instant the pointer does', () => {
  it('transitions in on --t-fast and out on 0s, for every hovering control', () => {
    expect(
      missing(CONTROLS, (s) => {
        const base = decl(rulesFor(CSS, s), 'transition-duration')
        const hovered = decl(rulesFor(CSS, `${s}:hover`), 'transition-duration')
        return base === '0s' && hovered === `var(${CSS_DURATION_TOKEN.reveal})`
      }),
    ).toEqual([])
  })
})

// ── 7 · a loading surface has a shape, not a spinner ──────────────────────────────────────
describe('7 · waiting looks like the thing that is coming', () => {
  it('defines a skeleton slab at a real row height', () => {
    expect(decl(rulesFor(CSS, '.skeleton-row'), 'height')).not.toBeNull()
    expect(decl(rulesFor(CSS, '.skeleton-row'), 'background')).not.toBeNull()
  })

  // One component, so the loading state's role and its announced word cannot drift between
  // the seven panels that wait.
  it('renders the one skeleton in the panels that wait for a fetch', () => {
    expect(src('../paper/pages/Skeleton.tsx')).toContain('skeleton-row')
    for (const f of ['../paper/pages/Chronicle.tsx', '../paper/pages/Folk.tsx']) {
      expect(src(f), f).toContain('<Skeleton')
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
    expect(decl(rulesFor(CSS, '.law-edit input:disabled'), 'cursor')).toBe('not-allowed')
    // the canvas cursor is Pixi's, not the sheet's
    expect(src('../render/cameraRig.ts')).toContain("'grab'")
    expect(src('../render/cameraRig.ts')).toContain("'grabbing'")
  })
})

// ── 10 · the sound of silence ─────────────────────────────────────────────────────────────
describe('10 · a world with nothing happening still breathes', () => {
  it('keeps at least one moving thing in every season and every phase', () => {
    expect(src('../render/ambient.ts')).toMatch(/SHIMMER_MAX|TREES_MAX/)
    // the ambient population is a positive constant in every band, asserted as a finish line
    for (const [n, file] of [
      ['SHIMMER_MAX', 'ambient'],
      ['TREES_MAX', 'ambient'],
      ['SMOKE_PUFFS', 'smoke'],
    ] as const) {
      const v = new RegExp(`\\bconst ${n} = (\\d+)`).exec(src(`../render/${file}.ts`))
      expect(v, n).not.toBeNull()
      expect(Number(v![1]), n).toBeGreaterThan(0)
    }
  })
})

// ── 11 · text never widows ────────────────────────────────────────────────────────────────
const TITLES = named([
  '.paper-title',
  '.bond-title',
  '.thumb-title',
  '.edition-title',
  '.paper-sheet article h4',
])
const PARAGRAPHS = named([
  '.block p',
  '.feed-text',
  '.room-who',
  '.sheet-note',
  '.edge-line',
  '.provenance-line',
])

describe('11 · a title never leaves one word on its own line', () => {
  it('balances every title', () => {
    expect(missing(TITLES, (s) => decl(rulesFor(CSS, s), 'text-wrap') === 'balance')).toEqual([])
  })

  it('prettifies every paragraph', () => {
    expect(missing(PARAGRAPHS, (s) => decl(rulesFor(CSS, s), 'text-wrap') === 'pretty')).toEqual([])
  })
})

// ── 12 · the scrollbars are the town's ────────────────────────────────────────────────────
const SCROLLERS = named(['.paper-sheet', '.bond-detail'])

describe("12 · a scrollable region says so, in the town's own colours", () => {
  it("paints every scroll container's bar from the palette and keeps it visible", () => {
    expect(
      missing(SCROLLERS, (s) => {
        const body = rulesFor(CSS, s)
        return decl(body, 'scrollbar-color') !== null && decl(body, 'scrollbar-width') !== null
      }),
    ).toEqual([])
  })
})

// ── the anti-vacuity check, last so every list is registered ──────────────────────────────
describe('every line above is about a surface that exists', () => {
  it('names no selector the sheet does not already have a rule for', () => {
    const phantom = [...new Set(ALL_NAMED)].filter((s) => rulesFor(CSS, s).length === 0)
    expect(phantom, 'a finish line satisfiable by writing dead CSS is not a finish line').toEqual(
      [],
    )
  })
})

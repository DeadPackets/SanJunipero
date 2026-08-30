import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PLATE_DROP_PX } from '../stage/Nameplate.js'
import { rulesFor } from './finish.test.js'

// A union merge that drops one side's block is invisible to tsc and to every other test in the
// suite: the remaining CSS still parses, and the surface it styled just stops being styled.

const HERE = dirname(fileURLToPath(import.meta.url))
const CSS = readFileSync(join(HERE, 'chrome.css'), 'utf8')
const LINES = CSS.split('\n')

/** A section banner opens every block in the sheet. Read off the file rather than transcribed,
 *  so the guard covers sections nobody thought to list. */
const BANNERS = LINES.filter((l) => /^\/\* [──══]/u.test(l))

/** The two blocks a merge train actually risks, named so a failure says whose block went. */
const LANE_BLOCKS: readonly (readonly [lane: string, banner: string])[] = [
  ['the Discovery Record', '/* ── the Discovery Record: a chain of museum labels'],
  ['THE SIGNPOST AND THE PAPER', '/* ══ THE SIGNPOST AND THE PAPER ═'],
]

describe('★ chrome.css survives the merge trains intact', () => {
  it('opens each section exactly once', () => {
    const seen = new Map<string, number>()
    for (const b of BANNERS) seen.set(b, (seen.get(b) ?? 0) + 1)
    expect(
      [...seen].filter(([, n]) => n > 1),
      'a section banner appears twice',
    ).toEqual([])
  })

  it('carries each lane’s own block exactly once', () => {
    for (const [lane, banner] of LANE_BLOCKS) {
      expect(CSS.split(banner).length - 1, `${lane}: block missing or duplicated`).toBe(1)
    }
  })

  // A sweep that takes a rule can take its @keyframes with it and leave the `animation:` line
  // behind: the CSS still parses and the surface simply stops moving.
  it('names no animation the sheet has no keyframes for', () => {
    const declared = new Set([...CSS.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]!))
    // `animation: none` is the reduced-motion switch-off, a keyword and not a name.
    const used = [...CSS.matchAll(/animation:\s*([\w-]+)/g)]
      .map((m) => m[1]!)
      .filter((n) => n !== 'none')
    expect(used.filter((n) => !declared.has(n))).toEqual([])
    expect(used.length, 'the sheet animates nothing at all').toBeGreaterThan(0)
  })

  it('is brace-balanced and carries no conflict marker', () => {
    expect(CSS.match(/{/g) ?? []).toHaveLength((CSS.match(/}/g) ?? []).length)
    expect(
      LINES.filter((l) => /^(<{7}|={7}|>{7}|\|{7})/.test(l)),
      'conflict marker in the sheet',
    ).toHaveLength(0)
  })
})

// These assertions are on the SHEET rather than on a model of it: no layout engine runs in vitest,
// and a model of the sheet would have agreed with the model.
describe('★ the signpost and the paper hold their own shape', () => {
  /** The sheet with its comments removed. Everything below asks what the sheet DOES, and a
   *  comment quoting the rule that was wrong must not read as that rule still being there. */
  const BARE = CSS.replace(/\/\*[\s\S]*?\*\//g, '')

  /**
   * ONE top-level rule, by its own selector line, ending at the first bare `}`.
   */
  const topRule = (selector: string): string => {
    const lines = BARE.split('\n')
    const start = lines.findIndex((l) => l === `${selector} {` || l.startsWith(`${selector} { `))
    if (start < 0) return ''
    if (lines[start]!.trimEnd().endsWith('}')) return lines[start]!
    const end = lines.indexOf('}', start)
    return end < 0 ? '' : lines.slice(start, end + 1).join('\n')
  }

  // Customs, Folk, Building and Laws hang their headings outside any `.block`, so `.block h3`
  // styled four of the sketch's pages by accident and left the rest a UA-default h3.
  it('★ styles `.feed-head` itself, not only through `.block h3`', () => {
    const head = rulesFor(BARE, '.feed-head')
    expect(head, '.feed-head has no rule of its own').not.toBe('')
    expect(head).toMatch(/font-family:\s*var\(--font-px\)/)
    expect(head).toMatch(/text-transform:\s*uppercase/)
    expect(rulesFor(BARE, '.feed-head::after')).toMatch(/content:/)
  })

  // A percentage inset is 15.6px on a landscape phone and 57.6px at 2560 — the same chrome
  // 3.7x further from the edge across the range, and under the notch on both.
  it('hangs the signpost in the corner the direction picked, at one measured inset', () => {
    const post = topRule('.signpost')
    expect(post, '.signpost is not a top-level rule in the sheet').not.toBe('')
    expect(post).toMatch(/right:\s*max\(var\(--mark-inset\), env\(safe-area-inset-right\)\)/)
    expect(post).toMatch(/bottom:\s*max\(var\(--mark-inset\), env\(safe-area-inset-bottom\)\)/)
    expect(BARE).toMatch(/--mark-inset:\s*clamp\(16px, 3vmin, 40px\)/)
  })

  // Every mark that hangs off an edge takes the same inset and the same notch guard.
  it('gives the stamp and the cue the signpost’s own inset', () => {
    for (const sel of ['.stage-stamp', '.stage-cue']) {
      expect(rulesFor(BARE, sel), sel).toMatch(/max\(var\(--mark-inset\), env\(safe-area-inset-/)
    }
  })

  // Below 1400px a centred sheet sliced the arms mid-word; below 640 it buried them entirely.
  it('★ keeps the signpost reachable with the sheet open, at every width', () => {
    expect(BARE).toMatch(
      /@media \(min-width: 641px\) and \(max-width: 1400px\) \{\s*\.paper \{[^}]*left:/,
    )
    expect(BARE).toMatch(
      /@media \(max-width: 1000px\), \(max-height: 620px\) \{[\s\S]*?\.signpost\[data-open='yes'\] \{[^}]*grid-template-columns: repeat\(2, auto\)/,
    )
    expect(BARE).toMatch(
      /@media \(min-width: 641px\) and \(max-height: 620px\) \{[^}]*grid-auto-flow: column/,
    )
  })

  // Height is what a landscape phone runs out of, and nothing in the sheet used to read it.
  it('★ answers the window’s height as well as its width', () => {
    expect(BARE).toMatch(
      /@media \(max-height: 620px\) \{\s*\.paper \{[^}]*height: calc\(100dvh - 64px\)/,
    )
    expect(BARE).toMatch(/@media \(max-height: 620px\) \{\s*\.signpost-post \{ display: none/)
  })

  it('gives every arm a 44px hit area — an arm is a touch target before it is a sign', () => {
    // 22 drawn pixels at --px: 2 is 44px; the row is measured live in shots-signpost/measurements
    expect(topRule('.signpost')).toMatch(/--px:\s*2;/)
    expect(topRule('.signpost-arm')).toMatch(/min-height:\s*calc\(22px \* var\(--px\)\)/)
  })

  it('lifts an arm 1px in the tap band, and not at all under reduced motion', () => {
    expect(BARE).toMatch(/\.signpost-arm:hover \{[^}]*translate:\s*0 -1px/)
    expect(BARE).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.signpost-arm:hover \{[^}]*translate:\s*0 0/,
    )
    expect(topRule('.signpost-arm')).toMatch(/transition-timing-function:\s*var\(--ease-tap\)/)
  })

  it('sizes the paper off the stage, capped, and never over the whole of it', () => {
    expect(BARE).toMatch(/--paper-w:\s*min\(78%, 760px\)/)
    // `dvh`, not `vh`: iOS moves the bottom edge the sheet is anchored to as the URL bar goes.
    expect(BARE).toMatch(/--paper-h:\s*min\(66%, 100dvh - 96px\)/)
    const paper = topRule('.paper')
    expect(paper).toMatch(/width:\s*var\(--paper-w\)/)
    expect(paper).toMatch(/height:\s*var\(--paper-h\)/)
  })

  it('rises from the bottom edge in the sheet’s own 300ms enter curve', () => {
    const paper = topRule('.paper')
    expect(paper, 'the sheet must start below the edge').toMatch(
      /transform:\s*translate\(-50%, 102%\)/,
    )
    expect(paper).toMatch(/transition:\s*transform var\(--t-slow\) var\(--ease-enter\)/)
    expect(BARE).toMatch(/\.paper\[data-open='yes'\] \{[^}]*transform:\s*translate\(-50%, 0\)/)
    // A separate `translate` gets folded into `transform` by the minifier and the open state
    // then throws the centring away — one property has to carry both axes.
    expect(paper, 'the sheet centres itself with `transform`, never `translate`').not.toMatch(
      /^\s*translate:/m,
    )
  })

  it('★ does not slide at all under reduced motion', () => {
    expect(BARE).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.paper \{[^}]*transition:\s*none/,
    )
  })

  it('dims the town 28% behind the sheet, from one number', () => {
    expect(BARE).toMatch(/--dim:\s*0\.28/)
    expect(BARE).toMatch(/\.town-dim\[data-open='yes'\] \{[^}]*opacity:\s*var\(--dim\)/)
  })

  it('holds every pointer target in the sheet at 44px or more', () => {
    for (const [, sel, body] of BARE.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const px = /min-height:\s*(\d+)px/.exec(body ?? '')?.[1]
      if (px === undefined || !/cursor:\s*pointer/.test(body ?? '')) continue
      expect(Number(px), `${(sel ?? '').trim()} { min-height: ${px}px }`).toBeGreaterThanOrEqual(44)
    }
  })

  // The plate's drop is written twice — once in the sheet, once in TS, because the placer that
  // keeps a bubble off the plate reasons about its box and cannot read CSS.
  it('★ keeps the plate drop in the sheet and in Nameplate.tsx the same number', () => {
    expect(CSS).toContain(`translate: -50% ${PLATE_DROP_PX}px`)
  })

  // ★ The plate and the ring are ONE mark — the pick — placed off the SAME anchor by two
  // different rules. Read apart, they collided by 13px over every figure ever picked.
  it('★ hangs the plate clear of the ring’s lowest arm', () => {
    const num = (re: RegExp): number => Number(re.exec(CSS)![1])
    const lift = num(/\.stage-ring \{[^}]*translate: -50% calc\(-50% - (\d+)px\)/)
    const side = num(/\.stage-ring-arms \{[^}]*width: (\d+)px/)
    const arm = num(/\.stage-ring-arms button \{[^}]*min-height: (\d+)px/)
    // the lowest arm is centred on the ring's bottom edge, so it reaches this far below the feet
    const armBottom = side / 2 - lift + arm / 2
    expect(armBottom, 'the ring reaches below the anchor').toBeGreaterThan(0)
    expect(PLATE_DROP_PX, `the plate must start below ${armBottom}px`).toBeGreaterThan(armBottom)
  })

  // ★ Both used to hang top-right, and the meter is opaque.
  it('★ keeps the fps meter out of the corner the quiet stamp owns', () => {
    // both selectors carry a second rule for their frame recipe; the placement one positions
    const placed = (sel: string): string =>
      [...CSS.matchAll(new RegExp(`\\${sel} \\{([^}]*)\\}`, 'g'))]
        .map((m) => m[1]!)
        .find((body) => body.includes('position:'))!
    expect(placed('.stage-stamp')).toMatch(/right:/)
    expect(placed('.fps-overlay')).toMatch(/left:/)
    expect(placed('.fps-overlay')).not.toMatch(/right:/)
  })

  it('leaves nothing of the bars the signpost replaced', () => {
    for (const gone of [
      '.control-bar',
      '.hud-dock',
      '.status-strip',
      '.lens-tabs',
      '.timeline',
      '.minimap',
      '.digest-modal',
      '.stage-veil',
      '#panel-outlet',
    ]) {
      expect(CSS, `${gone} is still styled`).not.toContain(`${gone} `)
    }
  })
})

// ── ★ STAGE 8 · THE DEVICE THE TOWN IS BEING WATCHED ON ───────────────────────────────────
// One viewport media query in 1,383 lines, and it was width-only at 640px. Height is what a
// landscape phone runs out of, and touch is what has no hover.
describe('★ the sheet answers the device, not only the window width', () => {
  const BARE = CSS.replace(/\/\*[\s\S]*?\*\//g, '')

  it('takes the browser’s own surfaces off their defaults', () => {
    expect(BARE).toMatch(/color-scheme:\s*light/)
    expect(BARE).toMatch(/accent-color:\s*var\(--honey\)/)
    expect(BARE).toMatch(/-webkit-tap-highlight-color:\s*transparent/)
    expect(BARE).toMatch(/::selection \{[^}]*background:\s*var\(--honey\)/)
  })

  it('measures the viewport in dvh, because iOS moves the bottom edge', () => {
    expect(BARE).toMatch(/html, body, #root \{[^}]*height: 100dvh/)
  })

  it('clears the notch on every mark that hangs off an edge', () => {
    for (const want of [
      'safe-area-inset-right',
      'safe-area-inset-bottom',
      'safe-area-inset-top',
      'safe-area-inset-left',
    ]) {
      expect(BARE, want).toContain(`env(${want})`)
    }
  })

  it('gives the canvas the pointer and stops the page rubber-banding behind the sheet', () => {
    expect(rulesFor(BARE, '.stage-mount')).toMatch(/touch-action:\s*none/)
    expect(rulesFor(BARE, '.app')).toMatch(/user-select:\s*none/)
    expect(rulesFor(BARE, '.paper-sheet')).toMatch(/overscroll-behavior:\s*contain/)
    expect(rulesFor(BARE, '.bond-detail')).toMatch(/overscroll-behavior:\s*contain/)
  })

  it('★ answers touch, where there is no hover to answer with', () => {
    expect(BARE).toMatch(/@media \(hover: none\) \{/)
    expect(BARE).toMatch(/@media \(hover: none\) \{[\s\S]*?\.paper-close-key \{ display: none/)
    // a tap focuses a mark but never `:focus-visible`, so the day-strip dots were unlabelled
    expect(BARE).toMatch(/\.mark:focus \.mark-tip/)
  })

  it('★ brings the pixel slab back where forced colours drop box-shadow', () => {
    const forced = /@media \(forced-colors: active\) \{([\s\S]*?)\n\}/.exec(BARE)?.[1] ?? ''
    expect(forced, 'no forced-colors block').not.toBe('')
    expect(forced).toContain('border: 2px solid CanvasText')
    expect(forced).toContain('outline-color: Highlight')
  })

  it('★ sizes the sheet’s own lists off the sheet, not off the window', () => {
    expect(rulesFor(BARE, '.paper-sheet')).toMatch(/container-type:\s*inline-size/)
    expect(BARE).toMatch(/@container \(min-width: 26rem\) \{[\s\S]*?\.rr-place \{ min-width/)
    expect(BARE).toMatch(/@container \(min-width: 46rem\) \{\s*\.roster-list \{/)
  })

  it('scales the whole sign rather than four postage stamps, on a very wide screen', () => {
    expect(BARE).toMatch(/@media \(min-width: 1920px\) \{\s*\.signpost \{[^}]*--px: 3/)
    expect(BARE).toMatch(
      /@media \(min-width: 1920px\) \{\s*\.paper \{[^}]*--paper-w: min\(78%, 1040px\)/,
    )
  })

  it('makes the tab strip a scroller before it wraps onto a third row', () => {
    expect(BARE).toMatch(
      /@media \(max-width: 480px\) \{[\s\S]*?\.paper-tabs \{[^}]*overflow-x: auto/,
    )
  })
})

// ── ★ one motion vocabulary, and reduced motion honoured in all of it ─────────────────────
describe('★ nothing moves for a viewer who asked for stillness', () => {
  const BARE = CSS.replace(/\/\*[\s\S]*?\*\//g, '')

  /** Everything the sheet says outside a `prefers-reduced-motion` block. */
  const UNGUARDED = BARE.replace(/@media \(prefers-reduced-motion[^{]*\{[\s\S]*?\n\}/g, '')
  /** A motion of these is a fade, which DESIGN.md keeps under reduced motion. */
  const FADE_ONLY = /^(?:[\s;]|opacity|color|background-color|border-color|fill|[\s,])+$/

  // Five rules kept a 2px lift the other thirteen had already given up.
  it('★ moves nothing outside a no-preference guard that is not a fade', () => {
    const loud: string[] = []
    for (const [, sel, body] of UNGUARDED.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const props =
        /transition-property:\s*([^;}]+)/.exec(body ?? '')?.[1] ??
        /transition:\s*([a-z-]+)\s/.exec(body ?? '')?.[1]
      const ms = /(?:transition-duration|transition):[^;}]*var\(--t-/.test(body ?? '')
      if (props === undefined || !ms) continue
      if (!FADE_ONLY.test(props)) loud.push(`${(sel ?? '').trim()} — ${props}`)
    }
    // `.paper` and `.discovery-leaf` move, and both switch themselves off under `reduce`
    for (const sel of ['.paper', '.discovery-leaf']) {
      expect(BARE, sel).toMatch(
        new RegExp(
          `@media \\(prefers-reduced-motion: reduce\\)[\\s\\S]{0,200}?\\${sel} \\{[^}]*transition: none`,
        ),
      )
    }
    expect(
      loud.filter((l) => !l.startsWith('.paper ') && !l.startsWith('.discovery-leaf')),
    ).toEqual([])
  })

  it('staggers one way, at the table’s own 30ms, capped rather than truncated', () => {
    expect(BARE).toMatch(/animation-delay: calc\(var\(--stagger-i, 6\) \* 30ms\)/)
    expect(BARE).not.toMatch(/animation-delay: \d+ms/)
  })

  it('lands the scrim and the sheet together, on one duration', () => {
    expect(rulesFor(BARE, '.town-dim')).toMatch(/transition: opacity var\(--t-slow\)/)
    expect(rulesFor(BARE, '.paper')).toMatch(/transition: transform var\(--t-slow\)/)
  })
})

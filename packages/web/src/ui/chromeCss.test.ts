import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PLATE_DROP_PX } from '../stage/Nameplate.js'
import { rulesFor, selectorsMatching } from './finish.test.js'

// A union merge that drops one side's block is invisible to tsc and to every other test in the
// suite: the remaining CSS still parses, and the surface it styled just stops being styled.

const HERE = dirname(fileURLToPath(import.meta.url))
const CSS = readFileSync(join(HERE, 'chrome.css'), 'utf8')
const LINES = CSS.split('\n')

/** A section banner opens every block in the sheet. Read off the file rather than transcribed,
 *  so the guard covers sections nobody thought to list. */
const BANNERS = LINES.filter((l) => /^\/\* [──══]/u.test(l))

/** The two blocks a merge train actually risks, named so a failure says whose block went. */
const LANE_BLOCKS: readonly (readonly [lane: string, mark: string])[] = [
  ['the Discovery Record', '/* ── the Discovery Record: a chain of museum labels'],
  ['THE SIGNPOST AND THE PAPER', '\n.signpost {\n'],
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
    for (const [lane, mark] of LANE_BLOCKS) {
      expect(CSS.split(mark).length - 1, `${lane}: block missing or duplicated`).toBe(1)
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
  // 3.7x further from the edge across the range, and under the notch on both. The mark that
  // used to carry that sum now names a corner and the FRAME carries the inset, once.
  it('hangs the signpost in the corner the direction picked, at one measured inset', () => {
    const post = topRule('.signpost')
    expect(post, '.signpost is not a top-level rule in the sheet').not.toBe('')
    expect(post).toMatch(/grid-area:\s*foot-right/)
    expect(post).toMatch(/justify-self:\s*end/)
    expect(post).toMatch(/align-self:\s*end/)
    expect(BARE).toMatch(/--mark-inset:\s*clamp\(16px, 3vmin, 40px\)/)
  })

  /** The two marks that carry a device edge themselves, and what the frame's outer tracks
   *  cannot do for them. Anything else naming one is placing itself twice. */
  const OWN_EDGE: Readonly<Record<string, string>> = {
    '.day-bar': 'takes the frame’s top row, so the notch is the band’s own padding',
    '.paper-sheet': 'is bottom anchored, so its last line sits under the home indicator',
  }

  // ★ Every mark that hangs off an edge took the same inset and the same notch guard, which
  // meant twenty copies of one sum. The frame's own outer tracks ARE that inset now, so a mark
  // that writes it again is a mark placing itself twice.
  it('★ writes the edge inset in the frame and nowhere else', () => {
    const frame = topRule('.app')
    expect(frame, '.app is not a top-level rule in the sheet').not.toBe('')
    expect(frame).toMatch(/max\(var\(--mark-inset\), env\(safe-area-inset-top\)\)/)
    expect(frame).toMatch(/max\(var\(--mark-inset\), env\(safe-area-inset-bottom\)\)/)
    expect(frame).toMatch(/max\(var\(--mark-inset\), env\(safe-area-inset-left\)\)/)
    expect(frame).toMatch(/max\(var\(--mark-inset\), env\(safe-area-inset-right\)\)/)
    // Whole blocks, and any property: the first declaration in a block and a `padding` both
    // reached a device edge while a scan anchored on `top|bottom|left|right|inset` was green.
    const carrying = [...BARE.replace(frame, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, , body]) => (body ?? '').includes('env(safe-area-inset'))
      .flatMap(([, list]) => (list ?? '').split(','))
      .map((sel) => sel.trim().split(/\s+/).at(-1) ?? '')
    expect(
      carrying.filter((sel) => !(sel in OWN_EDGE)),
      'a mark re-derives an edge the frame already holds',
    ).toEqual([])
    expect(
      Object.keys(OWN_EDGE).filter((sel) => !carrying.includes(sel)),
      'a mark is excused an edge it no longer carries',
    ).toEqual([])
  })

  // Below 1400px a centred sheet sliced the arms mid-word; below 640 it buried them entirely.
  // The arms answered that by re-anchoring on the click that pressed them, which took the control
  // out from under the hand: the position may not depend on `data-open` at any size any more.
  it('★ keeps the signpost reachable with the sheet open, without moving it to do so', () => {
    expect(BARE).toMatch(
      /@media \(min-width: 641px\) and \(max-width: 1400px\) \{\s*\.paper \{[^}]*grid-column: edge-start \/ foot-right-start/,
    )
    expect(BARE).toMatch(
      /@media \(max-width: 1000px\), \(max-height: 620px\) \{\s*\.signpost \{[^}]*grid-template-columns: repeat\(2, auto\)/,
    )
    expect(BARE).toMatch(
      /@media \(min-width: 641px\) and \(max-height: 620px\) \{[^}]*grid-auto-flow: column/,
    )
    expect(
      selectorsMatching(BARE, /^\.signpost\[data-open/),
      'an arm still moves on the click that pressed it',
    ).toEqual([])
  })

  // ★ The arms hold the top edge below 1001px, so every mark that shared that band started
  // under them. `--sign-band` asserted that depth as 0px, 88px or 44px at three breakpoints and
  // fourteen sums downstream changed meaning with it. A row measures the arms instead: the arms
  // take `head`, `head` is as tall as they are, and no other rule is told anything.
  it('★ steps the top marks below the arms by giving the arms a row of their own', () => {
    expect(BARE, 'a rule still asserts the arms’ depth by hand').not.toContain('--sign-band')
    expect(topRule('.app')).toMatch(/grid-template-areas:[\s\S]*?'\.\s+head\s+head\s+head\s+\.'/)
    expect(BARE).toMatch(
      /@media \(max-width: 1000px\), \(max-height: 620px\) \{[\s\S]*?\.signpost \{[^}]*grid-area: head/,
    )
    expect(selectorsMatching(BARE, /data-paper='on'\] :is\(\.day-bar/)).toEqual([])
  })

  // Height is what a landscape phone runs out of.
  it('★ answers the window’s height as well as its width', () => {
    expect(BARE).toMatch(/@media \(max-height: 620px\) \{\s*\.paper \{[^}]*height: 100%/)
    expect(BARE).toMatch(/@media \(max-height: 620px\) \{\s*\.signpost-post \{ display: none/)
    // 390px wide: the arms go two by two. They stand on the top edge in both states now, so the
    // 88px the cue and the lower third used to leave them at the bottom is the picture's again.
    expect(BARE).toMatch(
      /@media \(max-width: 1000px\), \(max-height: 620px\) \{\s*\.signpost \{[^}]*grid-area: head/,
    )
    expect(rulesFor(BARE, '.stage-cue')).not.toContain('88px')
    expect(rulesFor(BARE, '.lower-third')).not.toContain('88px')
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

  // ★ The sheet is 66% of the screen and it worked out where the arms end four times over, at
  // 96px, 200px, 64px and 106px. Its row starts under the band and the arms, so the percentage
  // is of what is left and the four sums are gone.
  it('★ sizes the paper off its own row, and never over the whole of it', () => {
    expect(BARE).toMatch(/--paper-w:\s*min\(78%, 760px\)/)
    expect(BARE).toMatch(/--paper-h:\s*66%/)
    const paper = topRule('.paper')
    expect(paper).toMatch(/grid-row:\s*head-end \/ -1/)
    expect(paper).toMatch(/width:\s*var\(--paper-w\)/)
    expect(paper).toMatch(/height:\s*var\(--paper-h\)/)
    expect(BARE, 'the sheet still sums a band').not.toMatch(/\.paper \{[^}]*100dvh/)
  })

  it('rises from the bottom edge in the sheet’s own 300ms enter curve', () => {
    const paper = topRule('.paper')
    expect(paper, 'the sheet must start below the edge').toMatch(/transform:\s*translateY\(102%\)/)
    expect(paper).toMatch(/transition:\s*transform var\(--t-slow\) var\(--ease-enter\)/)
    expect(BARE).toMatch(/\.paper\[data-open='yes'\] \{[^}]*transform:\s*translateY\(0\)/)
    // The frame centres it, so the slide carries one axis. A separate `translate` would still
    // be folded into `transform` by the minifier and the open state would throw the slide away.
    expect(paper, 'the sheet slides with `transform`, never `translate`').not.toMatch(
      /^\s*translate:/m,
    )
  })

  it('★ does not slide at all under reduced motion', () => {
    expect(BARE).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.paper \{[^}]*transition:\s*none/,
    )
  })

  it('dims the town 40% behind the sheet, from one number', () => {
    expect(BARE).toMatch(/--dim:\s*0\.4/)
    expect(BARE).toMatch(/\.town-dim\[data-open='yes'\] \{[^}]*opacity:\s*var\(--dim\)/)
  })

  it('holds every pointer target in the sheet at 44px or more', () => {
    for (const [, sel, body] of BARE.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const px = /min-height:\s*(\d+)px/.exec(body ?? '')?.[1]
      if (px === undefined || !/cursor:\s*pointer/.test(body ?? '')) continue
      expect(Number(px), `${(sel ?? '').trim()} { min-height: ${px}px }`).toBeGreaterThanOrEqual(44)
    }
  })

  // A broadcast frame is the town with nobody operating it, and the sheet takes the picture.
  // Every other mark in the corner is taken off both; the newest one was taken off neither.
  it('★ takes the camera chip out of a broadcast frame and out from under the sheet', () => {
    for (const mark of ['.camera-chip', '.sound-cues'])
      expect(rulesFor(BARE, `[data-broadcast='on'] ${mark}`), mark).toMatch(/display:\s*none/)
    expect(rulesFor(BARE, "[data-paper='on'] .sound-cues")).toMatch(/display:\s*none/)
    // ★ `display: none` took a sibling out of a flex row ranged right, and the weather and the
    // state slid 54px on every arm the sheet was opened from. The column has to stand.
    expect(rulesFor(BARE, "[data-paper='on'] .camera-chip")).toMatch(/visibility:\s*hidden/)
  })

  // ★ The chip hung 47px below a button drawn only inside a room, because the step-down was a
  // rule the chip carried on every frame. It stands in the day bar's right flank now, beside
  // the sky and the state: whose hand is on the lens is a fact about the picture, and every
  // fact about the picture is in one band. It places itself against nothing at all.
  it('★ stands the camera chip in the bar, placed against no neighbour', () => {
    expect(rulesFor(BARE, '.stage-exit')).toContain('grid-area: left-1')
    expect(rulesFor(BARE, '.camera-chip')).not.toMatch(/grid-area|position|top:|left:/)
    expect(
      selectorsMatching(BARE, /^body:has\(\.stage-exit\)/),
      'the chip still steps down by a rule instead of by a row',
    ).toEqual([])
    expect(rulesFor(BARE, '.stage-live'), '.stage-live is in the right-hand corner').toContain(
      'grid-area: right-1',
    )
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

  // ★ The band took every click over the top 56px of the picture: `.stage-figures` carries the
  // same z-index and stands earlier in the DOM, so the bar won the hit test over open town.
  it('★ takes no click the band is not a control for', () => {
    const bar = rulesFor(BARE, '.day-bar')
    expect(bar).toMatch(/pointer-events:\s*none/)
    for (const control of ['.day-bar-track', '.day-bar-play'])
      expect(rulesFor(BARE, control), control).toMatch(/pointer-events:\s*auto/)
    // and the track's 44px of reach stood past the band, scrubbing a viewer who clicked the town
    expect(bar).toMatch(/overflow:\s*hidden/)
  })

  // ★ Asked for and then paid for: the clock hid until a pointer moved, so a viewer who left the
  // town up on a tab saw no time at all, and a phone saw none either way. It never fades now.
  it('★ never fades the clock out of the band that says when', () => {
    expect(rulesFor(BARE, '.day-bar-stamp')).not.toMatch(/opacity/)
    expect(
      selectorsMatching(BARE, /^\.day-bar-stamp\[/),
      'the stamp still has a state it hides in',
    ).toEqual([])
  })

  // The rest of a day nobody has reached, so a partly lived day reads as one. A step of the ink
  // the band is drawn in, never a second bar filling up and never a colour of its own.
  it('paints the track past the cursor in the band’s own ink', () => {
    const dead = rulesFor(BARE, '.day-bar-dead')
    expect(dead, '.day-bar-dead has no rule').not.toBe('')
    expect(dead).toMatch(/left:\s*clamp\(0px, var\(--at\), 100%\)/)
    expect(dead).toMatch(/right:\s*0/)
    expect(dead).toMatch(/background:\s*var\(--ink\)/)
  })

  // The stamp that used to own the right-hand corner is folded into the bar, and the bar takes
  // the whole top band edge to edge. The meter has the left corner under it to itself.
  it('★ keeps the fps meter out of the band the town clock owns', () => {
    expect(rulesFor(BARE, '.day-bar')).toMatch(/grid-column:\s*edge/)
    // The meter took the top-left corner by hand and painted over the day and the season. It
    // stands in the row under the band now, at the end the arms never take.
    expect(rulesFor(BARE, '.fps-overlay')).toMatch(/grid-area:\s*head/)
    expect(rulesFor(BARE, '.fps-overlay')).toMatch(/justify-self:\s*end/)
  })

  // ── the frame ────────────────────────────────────────────────────────────────────────────
  // Forty-eight media queries and no layout owner: fourteen rules summed `--sign-band` plus
  // `--sky-h` plus a magic 44 or 88 to find the top of the picture, and four breakpoints
  // redefined `--sign-band` under them. These ask for the RULE, never the arithmetic.

  /** Every area the frame declares, read off its own template rather than transcribed. */
  const AREAS = new Set(
    [...topRule('.app').matchAll(/'([^']*)'/g)]
      .flatMap((m) => m[1]!.trim().split(/\s+/))
      .filter((n) => n !== '.'),
  )

  /** Every line the frame names: an area, an area's own two edges, and the column pairs the
   *  template writes out by hand. Read off the template, so a renamed cell breaks here first. */
  const PLACES = new Set<string>()
  for (const line of [...topRule('.app').matchAll(/\[([\w-]+)\]/g)].map((m) => m[1]!))
    PLACES.add(line)
  for (const name of [
    ...AREAS,
    ...[...PLACES].filter((l) => l.endsWith('-start')).map((l) => l.slice(0, -6)),
  ]) {
    PLACES.add(name)
    PLACES.add(`${name}-start`)
    PLACES.add(`${name}-end`)
  }

  /** Every rule that puts a class in the app's own stack, read off the SHEET. A hand-typed list
   *  cannot fail for the panel a phase just moved, and one of twelve names had gone stale. */
  const OVER_TOWN = [
    ...new Set(
      [...BARE.matchAll(/\n([^\s{}][^{}]*)\{([^{}]*)\}/g)]
        .filter(([, , body]) => /(?:^|;)\s*z-index:/.test(body ?? ''))
        .flatMap(([, list]) => (list ?? '').split(','))
        .map((sel) => /(\.[\w-]+)\s*$/.exec(sel.trim())?.[1] ?? '')
        .filter((n) => n !== ''),
    ),
  ]

  /** The marks the frame does NOT place, each for a reason written down. Every one of these is
   *  the whole picture or a thing inside another mark, and none of them is a panel. */
  const NOT_PLACED: Readonly<Record<string, string>> = {
    '.mark-tip': 'the word for a mark on the day strip, inside the sheet',
    '.signpost-post': 'the pole the arms are nailed to, inside the signpost',
    '.skip': 'the first tab stop, held off the top edge until it is focused',
    '.stage-figures': 'the layer the bodies are drawn on, the canvas edge to edge',
    '.town-dim': 'the scrim behind the sheet, the whole picture',
    '.replay-grade': 'the wash over an old day, the whole picture',
    '.replay-dip': 'the curtain over a cut, the whole picture',
    '.key-map': 'a modal sheet over the app, and the one mark centred over the picture',
  }

  /** Every mark that stands over the town: in the app's stack, and not one of the eight above. */
  const MARKS = OVER_TOWN.filter((m) => !(m in NOT_PLACED))

  // ★ The policy was enforced over twelve names typed by hand, and the cold open was not one of
  // them: put back to `position: fixed; inset: 0; place-content: center`, the exact thing this
  // phase exists to kill, it stayed green through 1305 tests.
  it('★ reads the marks over the town off the sheet, never off a list', () => {
    for (const moved of ['.day-bar', '.cold-open', '.paper', '.fps-overlay', '.stage-ticker'])
      expect(MARKS, `${moved} is a mark the frame places`).toContain(moved)
    expect(MARKS.length, 'the derivation found nothing').toBeGreaterThan(12)
    expect(
      Object.keys(NOT_PLACED).filter((n) => !OVER_TOWN.includes(n)),
      'a mark is excused a frame it is no longer in',
    ).toEqual([])
  })

  /** Everything the sheet says about a mark ITSELF, wherever it says it: its own rule, a state
   *  rule, a breakpoint. A rule for something inside the mark is not the mark being placed. */
  const saidOf = (mark: string, css: string): string => {
    const own = new RegExp(`^\\${mark}(?![\\w-])`)
    return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, list]) =>
        (list ?? '').split(',').some((sel) => own.test(sel.trim().split(/\s+/).at(-1) ?? '')),
      )
      .map(([, , body]) => body ?? '')
      .join(';')
  }

  /** Every line a rule outside the frame actually places something on. A WORD is not a
   *  placement: `\bfoot\b` matched `foot-left`, and `foot` was a dead cell reading as live. */
  const placedOn = (css: string): string[] =>
    [...css.matchAll(/grid-(?:area|row|column):\s*([^;}]+)/g)]
      .flatMap((m) => m[1]!.split('/'))
      .map((v) => v.trim())

  it('★ places every mark over the town in an area the frame declares', () => {
    expect(AREAS.size, 'the frame declares no areas at all').toBeGreaterThan(0)
    for (const mark of MARKS) {
      const said = saidOf(mark, BARE)
      expect(said, `${mark} has no rule in the sheet`).not.toBe('')
      const on = placedOn(said)
      expect(on.length, `${mark} names no cell of the frame`).toBeGreaterThan(0)
      for (const line of on)
        expect(
          PLACES.has(line) || /^-?\d+$/.test(line),
          `${mark} stands on "${line}", which the frame has no cell for`,
        ).toBe(true)
    }
    const named = new Set(
      placedOn(BARE.replace(topRule('.app'), '')).flatMap((v) => [
        v,
        v.replace(/-(?:start|end)$/, ''),
      ]),
    )
    expect(
      [...AREAS].filter((n) => !named.has(n)),
      'the frame declares an area no mark ever names',
    ).toEqual([])
  })

  it('★ lets no mark over the town work out where the picture starts', () => {
    const byHand = MARKS.flatMap((mark) =>
      [
        ...saidOf(mark, BARE).matchAll(
          /(?:^|;)\s*(?:position|top|bottom|left|right|inset):[^;}]*/g,
        ),
      ].map((m) => `${mark} {${m[0].replace(/^;/, '')} }`),
    )
    expect(byHand, 'a mark places itself instead of naming an area').toEqual([])
  })

  it('★ moves a mark at a breakpoint by naming another area, never by a new sum', () => {
    const queries = [...BARE.matchAll(/@media[^{]*\{[\s\S]*?\n\}/g)].map((m) => m[0])
    const moved = queries.flatMap((q) => MARKS.flatMap((mark) => placedOn(saidOf(mark, q))))
    expect(moved.length, 'no breakpoint moves any mark between areas').toBeGreaterThan(0)
    expect(
      moved.filter((n) => !PLACES.has(n) && !/^-?\d+$/.test(n)),
      'a breakpoint names an area the frame has no cell for',
    ).toEqual([])
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
      '.sleep-card',
    ]) {
      expect(CSS, `${gone} is still styled`).not.toContain(`${gone} `)
    }
  })
})

// Measured in a headless Chromium against this sheet at 1440×844: at the old two-line floor the
// caption stood at 581 for one cue line and at 561.5 for three. It holds every case now.
describe('★ the two rows over the picture that may not move each other', () => {
  const BARE = CSS.replace(/\/\*[\s\S]*?\*\//g, '')
  const root = Object.fromEntries(
    [...(/:root\s*\{([\s\S]*?)\n\}/.exec(BARE)?.[1] ?? '').matchAll(/--([\w-]+):\s*(\d+)px/g)].map(
      ([, name, px]) => [name!, Number(px)],
    ),
  )

  /** A `calc()` of numbers and `:root` px tokens, summed. */
  const px = (expr: string): number =>
    expr.split('+').reduce(
      (sum, term) =>
        sum +
        term.split('*').reduce((a, f) => {
          const t = /var\(--([\w-]+)\)/.exec(f)?.[1]
          return a * (t === undefined ? Number.parseFloat(f) : root[t]!)
        }, 1),
      0,
    )

  const LINE_HEIGHT = Number(/^body \{[^}]*line-height:\s*([\d.]+)/m.exec(BARE)?.[1])

  /** Every floor the sheet sets for the cue row, in line boxes of the cue's own size. */
  const floors = [...BARE.matchAll(/--cue-floor:\s*calc\((.*?)\);/g)].map(
    ([, expr]) => px(expr!) / (LINE_HEIGHT * root['f-2']!),
  )

  it('★ floors the cue row at four of its own line boxes, so a third line moves nothing', () => {
    const rows = /grid-template-rows:([\s\S]*?);/.exec(rulesFor(BARE, '.app'))?.[1] ?? ''
    expect(rows, 'the cue row is floored by hand again').toContain('minmax(var(--cue-floor), auto)')
    expect(LINE_HEIGHT).toBeGreaterThan(1)
    expect(Math.max(...floors)).toBeGreaterThanOrEqual(4)
  })

  it('★ gives the floor back on a window too short to spare it, and never below two lines', () => {
    expect(BARE).toMatch(/@media \(max-height: 620px\) \{\s*\.app \{ --cue-floor:/)
    expect(floors).toHaveLength(2)
    expect(Math.min(...floors)).toBeGreaterThanOrEqual(2)
  })

  it('★ takes the scene card down while the town’s first sentence stands over it', () => {
    expect(rulesFor(BARE, 'body:has(.cold-open) .scene-card')).toMatch(/display:\s*none/)
  })
})

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

  // `overflow: hidden` is still a scroll container. A `.focus()` or a `scrollIntoView` inside the
  // sheet walked up to `.app` and carried the canvas, the arms and every stage mark with it.
  it('★ clips the town rather than making it something the browser can scroll', () => {
    expect(rulesFor(BARE, '.app')).toMatch(/overflow:\s*clip/)
    expect(rulesFor(BARE, '.app')).not.toMatch(/overflow:\s*hidden/)
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

  // The complement of the 1920px rule that widens the sheet, not 1000: with the weekday in the
  // dateline one row of section line needs ~723px of head, and only a 1040px sheet has it.
  it('makes the tab strip a scroller before it wraps onto a third row', () => {
    expect(BARE).toMatch(
      /@media \(max-width: 1919\.98px\) \{[\s\S]*?\.paper-tabs \{[^}]*overflow-x: auto/,
    )
  })

  // 294px of track for 410px of tabs, and Moments and Days sat off the edge with nothing saying
  // they were there. The scroll drives the stops, so the end with no pages past it is not faded.
  it('★ says the tab strip runs past its own edge', () => {
    expect(BARE).toMatch(/@supports \(animation-timeline: scroll\(self inline\)\)/)
    expect(BARE).toMatch(/animation-timeline: scroll\(self inline\)/)
    expect(BARE).toMatch(/@keyframes tab-edge \{[\s\S]*?--tab-fade-out: 24px/)
    expect(BARE).toMatch(/mask-composite: intersect/)
  })
})

describe('★ nothing moves for a viewer who asked for stillness', () => {
  const BARE = CSS.replace(/\/\*[\s\S]*?\*\//g, '')

  const UNGUARDED = BARE.replace(/@media \(prefers-reduced-motion[^{]*\{[\s\S]*?\n\}/g, '')
  /** A motion of these is a fade, which DESIGN.md keeps under reduced motion. */
  const FADE_ONLY = /^(?:[\s;]|opacity|color|background-color|border-color|fill|[\s,])+$/

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
    // The step is a token now, so the literal lives in `:root` beside every other duration
    // and `MOTION.enter.stagger` is the one number it may be.
    expect(BARE).toMatch(/--stagger:\s*30ms/)
    expect(BARE).toMatch(/animation-delay: calc\(var\(--stagger-i, 6\) \* var\(--stagger\)\)/)
    expect(BARE).not.toMatch(/animation-delay: \d+ms/)
  })

  it('lands the scrim and the sheet together, on one duration', () => {
    expect(rulesFor(BARE, '.town-dim')).toMatch(/transition: opacity var\(--t-slow\)/)
    expect(rulesFor(BARE, '.paper')).toMatch(/transition: transform var\(--t-slow\)/)
  })
})

// ── four faces and five colours ───────────────────────────────────────────────────────────
// Measured on the shipped webfonts with fontTools: Silkscreen's digits carry TWO advances
// (625 and 750 per 1000em) and the face has no `tnum` feature, so a live number set in it
// shifts its own box. Manrope has `tnum`; `--font-data` is monospace.

const SHEET = CSS.replace(/\/\*[\s\S]*?\*\//g, '')
const ROOT = /:root\s*\{[\s\S]*?\n\}/.exec(SHEET)?.[0] ?? ''

/** Every `--font-*` the sheet declares, in `:root`. */
const FACES = [...ROOT.matchAll(/--font-([a-z]+):/g)].map((m) => m[1]!)

/** Every colour token in `:root`, by name, as an uppercase hex. */
const COLOURS: Readonly<Record<string, string>> = Object.fromEntries(
  [...ROOT.matchAll(/--([a-z-]+):\s*(#[0-9A-Fa-f]{6});/g)].map(([, n, h]) => [
    n!,
    h!.toUpperCase(),
  ]),
)

/** The five, and what each one means. A colour that means two things means neither. */
const FIVE: Readonly<Record<string, string>> = {
  cream: 'the lit ground, and a mark on a dark one',
  parchment: 'the sheet the town prints itself on',
  ink: 'a mark on a light ground',
  deep: 'the night under everything, and every shadow it casts',
  honey: 'the accent: this one, here',
}

/** A step is the SAME colour at another strength. The base it steps from, by token name. */
const STEP_OF: Readonly<Record<string, string>> = {
  sand: 'parchment',
  'parchment-zebra': 'parchment',
  night: 'deep',
  'ink-quiet': 'ink',
  'cream-quiet': 'cream',
  'honey-l': 'honey',
  'honey-deep': 'honey',
  'ember-ink': 'ember',
  'sage-pale': 'sage',
  'rose-pale': 'rose',
}

/** Outside the five, because each is a valence the world holds rather than a voice of ours. */
const SEMANTIC = ['ember', 'sage', 'rose', 'sky']

/** Outside the five the other way: what WE are doing, which no valence may be borrowed for. */
const STATE = ['current']

/** The only colour literals the sheet may carry outside `:root`: a gradient stop and a shadow
 *  take no `var()` for their alpha. Each names the token it is a transparency of. */
const ALPHAS: Readonly<Record<string, string>> = {
  'rgba(255, 246, 233, 0.25)': 'cream, the stripe drawn along a need bar',
  'rgba(36, 31, 43, 0.35)': 'deep, the drop the sheet throws on the town',
  'rgba(242, 200, 121, 0.07)': 'honey, the warm half of the replay wash',
  'rgba(242, 200, 121, 0)': 'honey, the same wash where it runs out',
  'rgba(36, 31, 43, 0)': 'deep, the vignette at the middle of the picture',
  'rgba(36, 31, 43, 0.34)': 'deep, the vignette at its corners',
}

const hue = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ]
  const hi = Math.max(r, g, b)
  const lo = Math.min(r, g, b)
  if (hi === lo) return 0
  const d = hi - lo
  const h = hi === r ? (g - b) / d + (g < b ? 6 : 0) : hi === g ? (b - r) / d + 2 : (r - g) / d + 4
  return h * 60
}
const hueApart = (a: string, b: string): number => {
  const d = Math.abs(hue(a) - hue(b))
  return Math.min(d, 360 - d)
}

describe('★ four faces, ruled by role, and five colours', () => {
  it('★ declares four faces and sets every word from one of them', () => {
    expect([...FACES].sort()).toEqual(['body', 'data', 'px', 'title'])
    const named = [...SHEET.matchAll(/font-family:\s*([^;}]+)/g)].map((m) => m[1]!.trim())
    expect(named.filter((v) => !/^var\(--font-(px|body|data|title)\)$/.test(v))).toEqual([])
    for (const f of FACES) expect(SHEET, f).toContain(`var(--font-${f})`)
  })

  it('★ gives a site that asks for tabular figures a face that has them', () => {
    const bad: string[] = []
    for (const [, sel, body] of SHEET.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!(body ?? '').includes('tabular-nums')) continue
      if ((body ?? '').includes('var(--font-px)')) bad.push((sel ?? '').trim().split('\n').at(-1)!)
    }
    expect(bad, 'Silkscreen has two digit advances and no tnum, so the number moves').toEqual([])
  })

  it('★ decides every colour in one place', () => {
    // A mask reads the alpha channel alone, so its stops are a ramp and not a palette value.
    const rest = SHEET.replace(ROOT, '').replace(/mask-image:[^;]+;/g, '')
    // Hex only, and six rgba literals decided colours outside `:root` while this was green.
    const literals = [
      ...rest.matchAll(/#[0-9A-Fa-f]{3,8}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\)/g),
    ].map((m) => m[0])
    expect(literals.filter((l) => !(l in ALPHAS))).toEqual([])
    expect(
      Object.keys(ALPHAS).filter((l) => !literals.includes(l)),
      'an alpha is named here and gone from the sheet',
    ).toEqual([])
  })

  it('★ is one of the five, a step of one, or a valence — never a sixth colour', () => {
    for (const name of Object.keys(COLOURS)) {
      const classed =
        name in FIVE || name in STEP_OF || SEMANTIC.includes(name) || STATE.includes(name)
      expect(classed, `${name} belongs to no class`).toBe(true)
    }
    expect(Object.keys(FIVE).length).toBe(5)
    for (const named of [...Object.keys(FIVE), ...Object.keys(STEP_OF), ...SEMANTIC, ...STATE]) {
      expect(COLOURS, `${named} is classed here and declared nowhere`).toHaveProperty(named)
    }
  })

  it('★ keeps a step the colour it steps from, so no sixth colour enters as one', () => {
    for (const [step, base] of Object.entries(STEP_OF)) {
      const [a, b] = [COLOURS[step], COLOURS[base]]
      expect(a, `${step} is undeclared`).toBeDefined()
      expect(b, `${base} is undeclared`).toBeDefined()
      const apart = hueApart(a!, b!)
      expect(apart, `${step} is ${apart.toFixed(0)}° off ${base}`).toBeLessThan(15)
    }
  })

  it('names no colour it never uses, and uses none it never named', () => {
    for (const name of Object.keys(COLOURS)) {
      expect(SHEET.includes(`var(--${name})`), `--${name} is declared and never used`).toBe(true)
    }
    const used = new Set([...SHEET.matchAll(/var\(--([a-z-]+)\)/g)].map((m) => m[1]!))
    const undeclared = [...used].filter(
      (n) =>
        /^(cream|parchment|sand|ink|deep|night|honey|ember|sage|rose|sky|current)/.test(n) &&
        !(n in COLOURS),
    )
    expect(undeclared).toEqual([])
  })
})

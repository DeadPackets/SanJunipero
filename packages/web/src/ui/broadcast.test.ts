import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  BROADCAST_CAPTIONS, BROADCAST_PARAM, BROADCAST_REMOVED, broadcastFromSearch,
  type BroadcastCaption,
} from './broadcast.js'
import { captionAtScale, captionFloorPx, captionMinPx, captionShortfall } from './broadcastReady.js'
import { BROADCAST_TEXT_SCALE, FACE_INSTALL_PX } from '../render/textFaces.js'
import { landmarkAlpha } from '../render/landmarks.js'
import { DIRECTOR_ZOOM } from './DirectorMode.js'
import { navToLens, parseRoute, routeToPath } from './route.js'
import { fontSizes } from './chromeType.test.js'

const CSS = readFileSync(new URL('./chrome.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const src = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8')

/** Every declaration block whose selector list contains `sel` exactly, in cascade order. */
function rulesFor(sel: string): string {
  const hits: string[] = []
  for (const [, list, body] of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if ((list ?? '').split(',').some((s) => s.trim() === sel)) hits.push(body ?? '')
  }
  return hits.join(';')
}

/** The size the sheet lands on for one exact selector, in px. */
function sheetPx(selector: string): number {
  const hits = fontSizes(CSS).filter((d) => d.selectors.split(',').some((s) => s.trim() === selector))
  if (hits.length === 0) throw new Error(`the sheet has no font-size for ${selector}`)
  return hits.at(-1)!.px
}

/** Every caption the broadcast frame renders, resolved to a source size in px. */
function measured(captions: readonly BroadcastCaption[]): Array<{ what: string; px: number }> {
  return captions.map((c) => ({ what: c.what, px: c.from === 'canvas' ? c.px : sheetPx(c.selector) }))
}

// ── the trigger ───────────────────────────────────────────────────────────────────────────

describe('what turns the broadcast layout on', () => {
  it('is the URL, and it is off for everybody who did not ask', () => {
    expect(broadcastFromSearch('?broadcast=1')).toBe(true)
    expect(broadcastFromSearch('?lens=map&broadcast=1')).toBe(true)
    expect(broadcastFromSearch('')).toBe(false)
    expect(broadcastFromSearch('?lens=director')).toBe(false)
    expect(broadcastFromSearch('?broadcast=0')).toBe(false)
    expect(broadcastFromSearch('?broadcast=yes')).toBe(false)
  })

  it('★ is never a viewport width — no media query decides it', () => {
    const guarded = CSS.matchAll(/@media[^{]*\{([\s\S]*?)\n\}/g)
    for (const [, body] of guarded) expect(body).not.toContain('data-broadcast')
    for (const f of ['./broadcast.ts', './route.ts', '../App.tsx']) {
      expect(src(f), f).not.toMatch(/innerWidth|matchMedia|clientWidth/)
    }
  })

  it('makes the route the televised town, because that is what the layout IS', () => {
    const r = parseRoute('/', '?broadcast=1')
    expect(r.broadcast).toBe(true)
    expect(r.lens).toBe('director')
    expect(r.momentId).toBeNull()
    expect(parseRoute('/', '').broadcast).toBe(false)
  })

  it('keeps the flag through every rewrite of the address bar', () => {
    // a scrub calls history.replaceState(routeToPath(next)) once a minute; without this the
    // first tick of the sim takes the stream frame away
    const r = parseRoute('/', '?broadcast=1')
    expect(routeToPath({ ...r, moment: { day: 4, time: '19:31' } }))
      .toBe(`/moment/4/19:31?lens=director&${BROADCAST_PARAM}=1`)
    expect(routeToPath(parseRoute('/', ''))).toBe('/')
  })

  it('does not let a stray arrow key walk a broadcast into the roster', () => {
    const r = parseRoute('/', '?broadcast=1')
    expect(navToLens(r, 'inspector')).toBe(r)
    const ordinary = parseRoute('/', '')
    expect(navToLens(ordinary, 'inspector').lens).toBe('inspector')
  })
})

// ── what is in the frame ──────────────────────────────────────────────────────────────────

describe('what a stream viewer is left with', () => {
  it('removes every operator surface it names, and names a reason for each', () => {
    const notHidden = BROADCAST_REMOVED.filter(({ selector }) => {
      const rule = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, list, body]) =>
        (list ?? '').split(',').some((s) => s.trim() === `[data-broadcast='on'] ${selector}`)
        && /display:\s*none/.test(body ?? ''))
      return rule === undefined
    }).map((r) => r.selector)
    expect(notHidden).toEqual([])
    for (const r of BROADCAST_REMOVED) expect(r.why.length, r.selector).toBeGreaterThan(10)
  })

  // ANTI-VACUITY, the shape batch 6 caught six of: a hidden selector the sheet never had is a
  // row that hides nothing. Every removed surface must be a surface that exists.
  it('★ hides only surfaces the product actually has', () => {
    const phantom = BROADCAST_REMOVED.filter(({ selector }) =>
      ![...CSS.matchAll(/([^{}]+)\{[^{}]*\}/g)]
        .some(([, list]) => (list ?? '').split(',').some((s) => s.trim() === selector)))
      .map((r) => r.selector)
    expect(phantom).toEqual([])
  })

  it('takes the overlaid bands away with the filmstrip that was one of them', () => {
    expect(CSS).toContain("[data-broadcast='on'] .moments-lens[data-letterboxed='true'] { --letterbox-h: 0px; }")
  })

  // The stage ENDS above the band, from one variable, so `placeBubbles` clamping to `viewRect()`
  // cannot put anything in the world across the caption.
  it('★ ends the picture where the caption starts, from one number', () => {
    const h = /\[data-broadcast='on'\]\s*\{[^}]*--bc-caption-h:\s*([^;}]+)/.exec(CSS)?.[1]?.trim()
    expect(h).toBe('11rem')
    expect(rulesFor("[data-broadcast='on'] .stage-mount")).toContain('bottom: var(--bc-caption-h)')
    expect(rulesFor("[data-broadcast='on'] .subtitle")).toContain('height: var(--bc-caption-h)')
  })
})

// ── ★ R2, MEASURED AT THE TRUE 0.25 ───────────────────────────────────────────────────────

describe('R2 · every caption in the broadcast frame survives the downscale', () => {
  it('is measuring the sizes the sheet actually ships', () => {
    expect(sheetPx("[data-broadcast='on'] .tick-badge")).toBe(28)
    expect(sheetPx("[data-broadcast='on'] .subtitle-name")).toBe(28)
    expect(sheetPx("[data-broadcast='on'] .subtitle")).toBe(32)
    expect(FACE_INSTALL_PX * BROADCAST_TEXT_SCALE).toBe(32)
  })

  it('★ has NO shortfall — the line R2 was open by is closed', () => {
    expect(captionShortfall(measured(BROADCAST_CAPTIONS))).toEqual([])
  })

  it('states what each one is worth to a viewer on a 480px phone', () => {
    expect(measured(BROADCAST_CAPTIONS).map((c) => `${c.what} — ${captionAtScale(c.px).toFixed(2)}px`))
      .toEqual([
        'the clock — 7.00px',
        'the speaker — 7.00px',
        'what they said — 8.00px',
        'a speech bubble — 8.00px',
      ])
    expect(captionMinPx()).toBeCloseTo(5.4, 3)
  })

  it('clears the floor with room, rather than landing on it', () => {
    for (const c of measured(BROADCAST_CAPTIONS)) {
      expect(c.px, c.what).toBeGreaterThanOrEqual(captionFloorPx())
    }
  })

  // The two world captions that are NOT in the set, because they are not in the frame — a
  // measurement, not an assumption. Either would be 4.00px if it were.
  it('accounts for the world labels it did not enlarge', () => {
    expect(landmarkAlpha(DIRECTOR_ZOOM)).toBe(0)          // place names are gone by 1x
    expect(src('../render/characters.ts')).toMatch(/pointerover.*nameTag\.visible = true/s)
    expect(captionAtScale(FACE_INSTALL_PX)).toBe(4)
  })

  it('doubles the town\'s own speech by a WHOLE number, so the atlas stays exact', () => {
    expect(BROADCAST_TEXT_SCALE).toBe(2)
    expect(Number.isInteger(BROADCAST_TEXT_SCALE)).toBe(true)
    expect(src('../render/bubbles.ts')).toContain('scene.textScale')
  })

  it('is wired to the canvas from the route and nowhere else', () => {
    const app = src('../App.tsx')
    expect(app).toContain("data-broadcast={route.broadcast ? 'on' : undefined}")
    expect(app).toMatch(/scene\.textScale = route\.broadcast \? BROADCAST_TEXT_SCALE : 1/)
  })
})

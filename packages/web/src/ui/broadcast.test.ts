import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  BROADCAST_CAPTIONS,
  BROADCAST_PARAM,
  BROADCAST_REMOVED,
  CAPTION_HOLD_MS,
  CAPTION_MAX_CHARS,
  TICKER_MAX,
  TICKER_SEP,
  broadcastFromSearch,
  captionClip,
  lowerThirdLine,
  tickerText,
  type BroadcastCaption,
} from './broadcast.js'
import { captionAtScale, captionFloorPx, captionMinPx, captionShortfall } from './broadcastReady.js'
import { BROADCAST_TEXT_SCALE, FACE_INSTALL_PX } from '../render/textFaces.js'
import { landmarkAlpha } from '../render/landmarks.js'
import { DIRECTOR_ZOOM } from './DirectorMode.js'
import { parseRoute, routeToPath } from './route.js'
import { fontSizes } from './chromeType.test.js'

const CSS = readFileSync(new URL('./chrome.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
)
const src = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8')

/** The size the sheet lands on for one exact selector, in px. */
function sheetPx(selector: string): number {
  const hits = fontSizes(CSS).filter((d) =>
    d.selectors.split(',').some((s) => s.trim() === selector),
  )
  if (hits.length === 0) throw new Error(`the sheet has no font-size for ${selector}`)
  return hits.at(-1)!.px
}

/** Every caption the broadcast frame renders, resolved to a source size in px. */
function measured(captions: readonly BroadcastCaption[]): { what: string; px: number }[] {
  return captions.map((c) => ({
    what: c.what,
    px: c.from === 'canvas' ? c.px : sheetPx(c.selector),
  }))
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
    expect(r.agentId).toBeNull()
    expect(parseRoute('/', '').broadcast).toBe(false)
  })

  it('keeps the flag through every rewrite of the address bar', () => {
    // a scrub calls history.replaceState(routeToPath(next)) once a minute; without this the
    // first tick of the sim takes the stream frame away
    const r = parseRoute('/', '?broadcast=1')
    expect(routeToPath({ ...r, moment: { day: 4, time: '19:31' } })).toBe(
      `/moment/4/19:31?${BROADCAST_PARAM}=1`,
    )
    expect(routeToPath(parseRoute('/', ''))).toBe('/')
  })

  it('never carries a picked person, whatever the address says', () => {
    expect(parseRoute('/', '?broadcast=1&agent=amara').agentId).toBeNull()
    expect(parseRoute('/', '?agent=amara').agentId).toBe('amara')
  })
})

// ── what is in the frame ──────────────────────────────────────────────────────────────────

describe('what a stream viewer is left with', () => {
  it('removes every operator surface it names, and names a reason for each', () => {
    const notHidden = BROADCAST_REMOVED.filter(({ selector }) => {
      const rule = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(
        ([, list, body]) =>
          (list ?? '').split(',').some((s) => s.trim() === `[data-broadcast='on'] ${selector}`) &&
          /display:\s*none/.test(body ?? ''),
      )
      return rule === undefined
    }).map((r) => r.selector)
    expect(notHidden).toEqual([])
    for (const r of BROADCAST_REMOVED) expect(r.why.length, r.selector).toBeGreaterThan(10)
  })

  // ANTI-VACUITY, the shape batch 6 caught six of: a hidden selector the sheet never had is a
  // row that hides nothing. Every removed surface must be a surface that exists.
  it('★ hides only surfaces the product actually has', () => {
    const phantom = BROADCAST_REMOVED.filter(
      ({ selector }) =>
        ![...CSS.matchAll(/([^{}]+)\{[^{}]*\}/g)].some(([, list]) =>
          (list ?? '').split(',').some((s) => s.trim() === selector),
        ),
    ).map((r) => r.selector)
    expect(phantom).toEqual([])
  })
})

// ── ★ R2, MEASURED AT THE TRUE 0.25 ───────────────────────────────────────────────────────

describe('R2 · every caption in the broadcast frame survives the downscale', () => {
  it('is measuring the size the frame actually ships', () => {
    expect(FACE_INSTALL_PX * BROADCAST_TEXT_SCALE).toBe(32)
  })

  it('★ has NO shortfall — the line R2 was open by is closed', () => {
    expect(captionShortfall(measured(BROADCAST_CAPTIONS))).toEqual([])
  })

  it('states what each one is worth to a viewer on a 480px phone', () => {
    expect(
      measured(BROADCAST_CAPTIONS).map((c) => `${c.what} — ${captionAtScale(c.px).toFixed(2)}px`),
    ).toEqual([
      'a speech bubble — 8.00px',
      'the speaker’s name — 6.00px',
      'the caption — 8.00px',
      'the chronicle ticker — 6.00px',
      'the quiet stamp — 6.00px',
      'the director’s cue — 6.00px',
    ])
    expect(captionMinPx()).toBeCloseTo(5.4, 3)
  })

  it('★ measures every caption the frame draws, not only the one it added', () => {
    const promised = ['the quiet stamp', 'the director’s cue', 'the chronicle ticker']
    for (const what of promised) {
      expect(BROADCAST_CAPTIONS.map((c) => c.what)).toContain(what)
    }
  })

  it('clears the floor with room, rather than landing on it', () => {
    for (const c of measured(BROADCAST_CAPTIONS)) {
      expect(c.px, c.what).toBeGreaterThanOrEqual(captionFloorPx())
    }
  })

  // The two world captions that are NOT in the set, because they are not in the frame — a
  // measurement, not an assumption. Either would be 4.00px if it were.
  it('accounts for the world labels it did not enlarge', () => {
    expect(landmarkAlpha(DIRECTOR_ZOOM)).toBe(0) // place names are gone by 1x
    expect(src('../render/characters.ts')).toMatch(/pointerover.*nameTag\.visible = true/s)
    expect(captionAtScale(FACE_INSTALL_PX)).toBe(4)
  })

  it("doubles the town's own speech by a WHOLE number, so the atlas stays exact", () => {
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

describe('what the lower third carries', () => {
  const spoken = { agentId: 'omar', name: 'Omar', words: 'The well is dry.' }
  const paper = { title: 'What the Fire Took', body: 'It burned all night.' }

  it('gives the line to whoever said it, and asks for their face', () => {
    expect(lowerThirdLine(spoken, paper)).toEqual({
      kind: 'speech',
      agentId: 'omar',
      name: 'Omar',
      words: 'The well is dry.',
    })
  })

  it('lets the town’s own paper back in once the spoken line’s hold has run out', () => {
    expect(lowerThirdLine(null, paper)).toEqual({
      kind: 'dispatch',
      name: 'What the Fire Took',
      words: 'It burned all night.',
    })
  })

  it('carries nothing at all when there is neither', () => {
    expect(lowerThirdLine(null, null)).toBeNull()
  })

  it('holds a spoken line long enough to read at broadcast size', () => {
    expect(CAPTION_HOLD_MS).toBeGreaterThanOrEqual(3000)
    expect(src('../stage/Broadcast.tsx')).toContain('CAPTION_HOLD_MS')
  })

  it('is a caption, not a paragraph', () => {
    const long = 'a '.repeat(200)
    expect(captionClip(long).length).toBe(CAPTION_MAX_CHARS)
    expect(captionClip(long).endsWith('…')).toBe(true)
    expect(captionClip('  two   words  ')).toBe('two words')
  })
})

describe('the chronicle crawling along the bottom edge', () => {
  const entry = (seq: number, label: string) => ({ seq, label })

  it('reads forward — oldest first, whatever order the record arrived in', () => {
    expect(tickerText([entry(3, 'c'), entry(1, 'a'), entry(2, 'b')])).toBe(
      ['a', 'b', 'c'].join(TICKER_SEP),
    )
  })

  it('carries the NEWEST entries when the record is longer than the crawl', () => {
    const many = Array.from({ length: TICKER_MAX + 5 }, (_, i) => entry(i, `e${i}`))
    const text = tickerText(many)
    expect(text.split(TICKER_SEP)).toHaveLength(TICKER_MAX)
    expect(text.startsWith('e5')).toBe(true)
    expect(text.endsWith(`e${TICKER_MAX + 4}`)).toBe(true)
  })

  it('has nothing to crawl in a town with no record yet', () => {
    expect(tickerText([])).toBe('')
  })
})

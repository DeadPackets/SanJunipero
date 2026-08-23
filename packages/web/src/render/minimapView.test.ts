import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createWorldStore } from '../state/worldStore.js'
import { HIT_MIN_PX } from './hitShapes.js'
import { MOTION, MOTION_CEILING_MS, untokenisedDurations } from '../ui/motion.js'
import { MINIMAP_H, MINIMAP_W, minimapFit, minimapShown, viewHoldsTown } from './minimap.js'
import { MINIMAP_LABEL, Minimap } from './MinimapView.js'

const SRC = new URL('./MinimapView.tsx', import.meta.url)
const CSS = readFileSync(new URL('../ui/chrome.css', import.meta.url), 'utf8')
const APP = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
const view = readFileSync(SRC, 'utf8')

const EMOJI = /\p{Extended_Pictographic}/u

/** Every declaration the sheet applies to `selector`, in cascade order. */
function ruleBody(css: string, selector: string): string {
  const hits: string[] = []
  for (const [, sel, body] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if ((sel ?? '').split(',').some((s) => s.trim() === selector)) hits.push(body ?? '')
  }
  if (hits.length === 0) throw new Error(`no rule for ${selector}`)
  return hits.join(';')
}

const html = renderToStaticMarkup(
  createElement(Minimap, { scene: null, store: createWorldStore(), focusAgentId: null }),
)

describe('the map a viewer can find, press and speak to', () => {
  it('is one focusable target, and it is the map itself', () => {
    expect(html).toContain('tabindex="0"')
    expect((html.match(/tabindex=/g) ?? []).length).toBe(1)
    expect(html).toContain(`aria-label="${MINIMAP_LABEL.replace(/'/g, '&#x27;')}"`)
  })

  it('★ names the keyboard in its own label, because the keyboard does more than the pointer', () => {
    expect(MINIMAP_LABEL.toLowerCase()).toContain('arrow')
    expect(MINIMAP_LABEL.toLowerCase()).toContain('home')
    expect(MINIMAP_LABEL.toLowerCase()).toContain('press')
    expect(MINIMAP_LABEL.length).toBeGreaterThan(40)
  })

  it('keeps its Left and Right from the lens walk, by wearing the role the stage wears', () => {
    expect(html).toContain('role="application"')
    // App yields the arrows to anything inside [role="application"] — that is the mechanism
    expect(APP).toContain('[role="application"]')
  })

  it('does not read its own picture out twice: the canvas is decoration', () => {
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain(`width="${MINIMAP_W}"`)
    expect(html).toContain(`height="${MINIMAP_H}"`)
  })

  it('renders without a scene rather than throwing at one', () => {
    expect(html).toContain('class="minimap"')
  })

  it('is drawn and observational — no emoji anywhere in it', () => {
    expect(html).not.toMatch(EMOJI)
    expect(MINIMAP_LABEL).not.toMatch(EMOJI)
  })

  it('★ is far larger than the pointer floor in both axes, at every zoom stop', () => {
    // the widget never changes size, so "at every stop" is one measurement
    expect(MINIMAP_W).toBeGreaterThanOrEqual(HIT_MIN_PX)
    expect(MINIMAP_H).toBeGreaterThanOrEqual(HIT_MIN_PX)
  })
})

// ── ★ THE CLAIM THIS LANE IS MOST ACCOUNTABLE FOR ─────────────────────────────────────────
//
// "Nothing per frame." A ticker callback would be the easy way to keep the rectangle in step
// and it would put the minimap's whole cost on every frame of a town already fighting for
// them. The claim is only worth anything if it is enforced, so it is scanned.

describe('the map costs a resting camera nothing', () => {
  it('★ adds no ticker callback, no frame loop and no poll of its own', () => {
    for (const poll of [/\.ticker\b/, /requestAnimationFrame/, /setInterval/, /setTimeout/]) {
      expect(view, String(poll)).not.toMatch(poll)
    }
  })

  it('repaints from the events that already exist, and unhooks all of them', () => {
    for (const wire of ['scene.onCamera(paint)', 'store.subscribe(onWorld)', 'store.onEvents(']) {
      expect(view, wire).toContain(wire)
    }
    for (const off of ['offEvents()', 'offStore()', 'offCamera()']) {
      expect(view, off).toContain(off)
    }
  })

  it('★ rebuilds the ground only when the ground or the built extent moved', () => {
    expect(view).toMatch(/if \(!force && s\.terrain === lastTerrain && sig === lastSig\) return/)
  })

  it('★ builds people on a tick and the rectangle on a frame — never both on a frame', () => {
    const paint = /const paint = \(\): void => \{[\s\S]*?\n {4}\}/.exec(view)?.[0] ?? ''
    expect(paint).toContain('viewOps(')
    expect(paint, 'a frame is rebuilding every person who has not moved').not.toContain('peopleDots(')
    expect(paint).toContain('dotsRef.current')
  })

  it('never draws from the ground bake, and never makes a second full-extent texture', () => {
    expect(view).not.toMatch(/rebakeGround|RenderTexture|groundSprite|GroundBaker/)
    // the raster is the widget's size and the widget's size is a constant
    expect(view).toContain('minimapPixels(s.terrain, structures, f)')
    expect(view).toContain('new ImageData(px, f.w, f.h)')
  })
})

describe('a press on the map takes the guarded road, and opens no other', () => {
  it('★ every move goes through scene.travelTo or scene.fitToTown, and nothing else', () => {
    const moves = view.match(/\bs\.[a-zA-Z]+\(/g) ?? []
    expect(new Set(moves)).toEqual(new Set(['s.travelTo(', 's.fitToTown(', 's.viewRect(']))
    expect(view).not.toMatch(/world\.position|centerOnScreen|panBy\(|setZoom/)
  })

  it('reads the press in the canvas own pixels, so a scaled display cannot skew it', () => {
    expect(view).toContain('getBoundingClientRect()')
    expect(view).toContain('MINIMAP_W')
    expect(view).toContain('MINIMAP_H')
  })

  it('a sweep is one gesture: the pointer is captured and released by the browser', () => {
    expect(view).toContain('setPointerCapture')
    expect(view).toContain('hasPointerCapture')
  })
})

describe('where the map sits, and what it promises not to cover', () => {
  const body = ruleBody(CSS, '.minimap')

  it('★ takes the one corner of the stage nothing else claims', () => {
    expect(body).toMatch(/position:\s*absolute/)
    expect(body).toMatch(/left:/)
    expect(body).toMatch(/bottom:/)
    // the frame counter is top right, the dock handle bottom right, the banner top centre
    expect(ruleBody(CSS, '.fps-overlay')).toMatch(/top:[^;]*;\s*right:/)
    expect(ruleBody(CSS, '.hud-dock')).toMatch(/right:\s*0;\s*bottom:\s*0/)
    expect(ruleBody(CSS, '.scrub-banner')).toMatch(/left:\s*50%/)
  })

  it('sits under the frame counter and over the things it must not be hidden by', () => {
    const z = (sel: string): number => Number(/z-index:\s*(\d+)/.exec(ruleBody(CSS, sel))?.[1] ?? '0')
    expect(z('.minimap')).toBeGreaterThan(z('.scrub-banner'))
    expect(z('.minimap')).toBeLessThan(z('.fps-overlay'))
    expect(z('.minimap')).toBeLessThan(z('.hud-dock'))
  })

  it('★ leaves the frame a stream viewer gets, like every other control', () => {
    expect(CSS).toMatch(/\[data-broadcast='on'\] \.minimap \{ display: none; \}/)
  })

  it('★ states no size of its own — the one number lives in minimap.ts', () => {
    expect(body).not.toMatch(/width:|height:/)
    expect(String(MINIMAP_W)).not.toBe('')
    expect(CSS).not.toContain(`${MINIMAP_W}px`)
  })

  it('does not de-emphasise anything with opacity, on a surface or on the canvas', () => {
    expect(body).not.toMatch(/opacity:/)
    expect(view).not.toMatch(/globalAlpha|opacity/)
  })

  it('★ a press is a cut: the canvas half animates nothing at all', () => {
    expect(view).not.toMatch(/transition|animation|easeOut|progress\(/)
  })

  it('★ its one motion is a reveal, named from the table and guarded', () => {
    const idle = ruleBody(CSS, '.minimap[data-idle=\'true\']')
    expect(idle).toMatch(/opacity:\s*0/)
    expect(idle).toMatch(/visibility:\s*hidden/)
    // opacity and visibility only — nothing that moves a box, nothing untokenised
    expect(body).toMatch(/transition-property:\s*opacity,\s*visibility/)
    expect(body).toMatch(/transition-duration:\s*var\(--t-fast\)/)
    expect(MOTION.reveal.ms).toBeLessThanOrEqual(MOTION_CEILING_MS)
    expect(untokenisedDurations(CSS).filter((d) => d.includes('minimap'))).toEqual([])
    // and it is inside the reduced-motion guard, so an opted-out viewer gets the cut
    const guarded = /@media \(prefers-reduced-motion: no-preference\) \{\s*\.minimap \{/.test(
      CSS.replace(/\/\*[\s\S]*?\*\//g, ''),
    )
    expect(guarded, 'the reveal is not inside a no-preference guard').toBe(true)
  })
})

// ── ★ THE MAP LEAVES WHEN IT HAS NOTHING TO ADD ───────────────────────────────────────────

describe('a map of a town you can already see all of', () => {
  const fit = minimapFit({ minX: 0, maxX: 4000, minY: 0, maxY: 2000 })

  it('★ steps aside when the view holds the whole town, and comes back when it does not', () => {
    expect(viewHoldsTown({ x: -500, y: -500, w: 5000, h: 3000 }, fit)).toBe(true)
    // ★ the fit stop counts: "The whole town" fills the stage and the map has nothing to add
    expect(viewHoldsTown({ x: 0, y: 0, w: 4000, h: 2000 }, fit)).toBe(true)
    expect(viewHoldsTown({ x: 100, y: 100, w: 800, h: 400 }, fit)).toBe(false)
    // one stop in from the fit and the town no longer fits, so the map comes back
    expect(viewHoldsTown({ x: 0, y: 0, w: 4000, h: 1000 }, fit)).toBe(false)
    expect(viewHoldsTown({ x: 400, y: 0, w: 3000, h: 2000 }, fit)).toBe(false)
  })

  it('is the view that decides it, on a frame, with React never told', () => {
    expect(view).toContain('viewHoldsTown(scene.viewRect(), f)')
    expect(view).toContain("setAttribute('data-idle'")
    expect(view, 'a re-render per frame is what this whole file avoids').not.toMatch(/useState/)
  })

  it('costs nothing at all while it is away — not even the paint', () => {
    expect(view).toMatch(/if \(idle\) return/)
  })
})

describe('App shows the map exactly where the predicate says', () => {
  it('asks one question and asks it with the viewer’s own three facts', () => {
    expect(APP).toContain('minimapShown(shownLens, insideId, hud.minimap === \'hidden\')')
    expect(APP).toMatch(/<Minimap scene=\{scene\} store=\{store\} focusAgentId=\{route\.agentId\} \/>/)
  })

  it('the predicate and the dock agree that putting it away means putting it away', () => {
    expect(minimapShown('map', null, true)).toBe(false)
    expect(minimapShown('map', null, false)).toBe(true)
  })
})

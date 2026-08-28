import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

const installs: Record<string, unknown>[] = []
vi.mock('pixi.js', () => ({
  BitmapFont: {
    install: (o: Record<string, unknown>) => {
      installs.push(o)
    },
  },
}))
import {
  BUBBLE_PAD,
  BUBBLE_RADIUS,
  BUBBLE_STROKE,
  FACE_ADVANCE_EM,
  FACE_BODY,
  FACE_DESIGN_PX,
  FACE_INSTALL_PX,
  FACE_PX,
  FACE_ROLES,
  FACE_SIZES,
  FACE_SOURCE,
  LOWERCASE_FACES,
  SPEECH_FILL,
  SPEECH_INK,
  TAIL_STEPS,
  TAIL_STEP_PX,
  THOUGHT_FILL,
  THOUGHT_INK,
  faceFor,
  installFaces,
  rimDots,
  stairTail,
  worldTextScale,
  wrapCharsFor,
} from './textFaces.js'
import { ZOOM_STOPS } from './camera.js'
import { bandRatios } from './legibility.js'
import { TEXT_MIN_PX, WORLD_TEXT_PX } from '../textFloor.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const src = (rel: string): string => readFileSync(join(HERE, rel), 'utf8')

const ch = (v: number): number => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const lum = (hex: number): number => {
  const [r, g, b] = [16, 8, 0].map((s) => ch(((hex >> s) & 0xff) / 255))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
const contrast = (a: number, b: number): number => {
  const [x, y] = [lum(a), lum(b)]
  const [hi, lo] = x > y ? [x, y] : [y, x]
  return (hi + 0.05) / (lo + 0.05)
}

describe('U18 — the town speaks in its own typeface', () => {
  // A font cannot be installed in node, so the call sites are checked at the source. Today
  // bubbles.ts, characters.ts, tooltip.ts and landmarks.ts all ask for `monospace`.
  const CALL_SITES = ['./bubbles.ts', './characters.ts', './tooltip.ts', './landmarks.ts']

  // The call sites route through WORLD_FONT_FAMILY, so scanning only them measures nothing —
  // worldLabel.ts is where the word would actually be.
  it('leaves no world label asking the browser for its default mono', () => {
    for (const f of [...CALL_SITES, './worldLabel.ts']) {
      expect(src(f), `${f} still asks for monospace`).not.toMatch(
        /=\s*'monospace'|fontFamily:\s*'monospace'/,
      )
    }
  })

  it('routes every world label through faceFor, so no site picks its own type', () => {
    for (const f of CALL_SITES) expect(src(f), f).toMatch(/faceFor\(/)
  })

  it('installs under the family worldLabel already looks for, so no call site changed', () => {
    expect(src('./worldLabel.ts')).toContain('FACE_PX')
  })
})

// Silkscreen has NO lowercase, so the pixel face labels and the display face speaks — the
// opposite of what the two names suggest.
describe('the two faces, and which one is allowed to say a sentence', () => {
  it('sets labels in the face with no lowercase and sentences in the face that has it', () => {
    expect(FACE_SOURCE[FACE_PX]).toBe('Silkscreen')
    expect(FACE_SOURCE[FACE_BODY]).toBe('Press Start 2P')
    expect(LOWERCASE_FACES).toContain(FACE_BODY)
    expect(LOWERCASE_FACES).not.toContain(FACE_PX)
  })

  it('never lets a face without lowercase carry a spoken sentence', () => {
    for (const role of ['speech', 'thought'] as const) {
      expect(LOWERCASE_FACES, role).toContain(faceFor(role).family)
    }
  })

  it('is total over its four roles', () => {
    expect([...FACE_ROLES].sort()).toEqual(['label', 'name', 'speech', 'thought'])
    for (const role of FACE_ROLES) {
      const f = faceFor(role)
      expect([FACE_PX, FACE_BODY], role).toContain(f.family)
      expect(FACE_SIZES, role).toContain(f.size)
    }
  })

  it('never drops below the floors the ui-blockers round set', () => {
    for (const role of FACE_ROLES) {
      expect(faceFor(role).size, role).toBeGreaterThanOrEqual(TEXT_MIN_PX)
      expect(faceFor(role).size, role).toBeGreaterThanOrEqual(WORLD_TEXT_PX)
    }
  })

  // The forge lane owns how much detail the art carries; this lane owns not wrecking it.
  it('sets a pixel face only at whole multiples of the grid it was drawn on', () => {
    expect(FACE_DESIGN_PX).toBe(8)
    for (const size of FACE_SIZES) expect(size % FACE_DESIGN_PX, `${size}px`).toBe(0)
    expect(FACE_INSTALL_PX % FACE_DESIGN_PX).toBe(0)
    for (const role of FACE_ROLES) expect(faceFor(role).size % FACE_DESIGN_PX, role).toBe(0)
  })
})

describe('wrapping, derived from the face rather than from a guess', () => {
  it('wraps the wide face sooner than the narrow one at the same width', () => {
    const wide = wrapCharsFor(FACE_BODY, 16, 240)
    const narrow = wrapCharsFor(FACE_PX, 16, 240)
    expect(narrow).toBeGreaterThan(wide)
    expect(FACE_ADVANCE_EM[FACE_BODY]).toBeGreaterThan(FACE_ADVANCE_EM[FACE_PX]!)
  })

  it('halves the count when the face doubles in size', () => {
    expect(wrapCharsFor(FACE_BODY, 8, 240)).toBe(2 * wrapCharsFor(FACE_BODY, 16, 240))
  })

  it('never returns a wrap so short that a word cannot fit on a line', () => {
    for (const family of [FACE_PX, FACE_BODY]) {
      for (const size of FACE_SIZES) {
        expect(wrapCharsFor(family, size, 240), `${family} ${size}`).toBeGreaterThanOrEqual(8)
      }
    }
  })

  it('states an advance no narrower than the face really sets', () => {
    // Both are monospace pixel faces on an 8px em. The numbers are deliberate upper bounds:
    // wrapping early can only make a bubble narrower, never wider than its box.
    expect(FACE_ADVANCE_EM[FACE_BODY]).toBe(1)
    expect(FACE_ADVANCE_EM[FACE_PX]).toBeLessThan(1)
    expect(FACE_ADVANCE_EM[FACE_PX]).toBeGreaterThan(0.5)
  })
})

describe('a bubble is drawn, not nine-sliced — the frame art is gone', () => {
  it('asks for no frame PNG', () => {
    expect(src('./bubbles.ts')).not.toMatch(/frame-\w+\.png/)
  })

  it('states the box in world pixels: a 2px ink ring on a 4px radius', () => {
    expect(BUBBLE_STROKE).toBe(2)
    expect(BUBBLE_RADIUS).toBe(4)
    expect(BUBBLE_PAD).toBeGreaterThanOrEqual(BUBBLE_STROKE * 2)
  })
})

describe('a thought wears a dotted rim instead of a drawn edge', () => {
  it('walks the whole perimeter and never leaves the box', () => {
    const [w, h] = [60, 30]
    const dots = rimDots(w, h)
    expect(dots.length).toBeGreaterThan(8)
    for (const d of dots) {
      expect(d.cx, 'cx').toBeGreaterThanOrEqual(0)
      expect(d.cx, 'cx').toBeLessThanOrEqual(w)
      expect(d.cy, 'cy').toBeGreaterThanOrEqual(0)
      expect(d.cy, 'cy').toBeLessThanOrEqual(h)
    }
    // one run of dots down each of the four edges
    expect(dots.some((d) => d.cy === 0)).toBe(true)
    expect(dots.some((d) => d.cy === h)).toBe(true)
    expect(dots.some((d) => d.cx === 0)).toBe(true)
    expect(dots.some((d) => d.cx === w)).toBe(true)
  })

  it('spaces them by the step, whatever the box grows to', () => {
    expect(rimDots(200, 30).length).toBeGreaterThan(rimDots(60, 30).length)
  })
})

describe('the tail points at the speaker, in three steps', () => {
  it('hangs downward from a bubble placed above, and upward from one placed below', () => {
    const above = stairTail('above', 60, 30)
    const below = stairTail('below', 60, 30)
    expect(Math.max(...above.filter((_, i) => i % 2 === 1))).toBeGreaterThan(30)
    expect(Math.min(...below.filter((_, i) => i % 2 === 1))).toBeLessThan(0)
  })

  it('points right from a bubble placed left, and left from one placed right', () => {
    const left = stairTail('left', 60, 30)
    const right = stairTail('right', 60, 30)
    expect(Math.max(...left.filter((_, i) => i % 2 === 0))).toBeGreaterThan(60)
    expect(Math.min(...right.filter((_, i) => i % 2 === 0))).toBeLessThan(0)
  })

  it('is a staircase of TAIL_STEPS, on every side', () => {
    for (const side of ['above', 'below', 'left', 'right'] as const) {
      const poly = stairTail(side, 60, 30)
      // two base points, then two per step
      expect(poly, side).toHaveLength(2 * (2 + 2 * TAIL_STEPS))
      for (const n of poly) expect(Number.isFinite(n), side).toBe(true)
    }
    expect(TAIL_STEPS).toBe(3)
    expect(TAIL_STEP_PX).toBeGreaterThan(1)
  })

  it('reaches TAIL_STEPS steps out of the box and no further', () => {
    const out = stairTail('above', 60, 30).filter((_, i) => i % 2 === 1)
    expect(Math.max(...out) - 30).toBe(TAIL_STEPS * TAIL_STEP_PX)
  })
})

describe('a thought is a different material, never a thinner one', () => {
  it('leaves no alpha on a bubble node', () => {
    // comments stripped: the source SAYS `alpha: 0.55` where it explains what it stopped doing
    const text = src('./bubbles.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
    expect(text).not.toMatch(/\.alpha\s*=/)
    expect(text).not.toMatch(/THOUGHT_ALPHA/)
    expect(text).not.toMatch(/alpha:\s*0\.\d/)
  })

  // Paper, not ink: under the night multiply the ceiling is 6.37:1 and only three palette pairs
  // clear AA in both bands, so requiring a second ink would fail one bubble at night.
  it('paints a thought on its own paper', () => {
    expect(THOUGHT_FILL).not.toBe(SPEECH_FILL)
  })

  it('clears AA both ways AND IN BOTH LIGHT BANDS, computed rather than asserted as a hex', () => {
    expect(contrast(THOUGHT_INK, THOUGHT_FILL)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(SPEECH_INK, SPEECH_FILL)).toBeGreaterThanOrEqual(4.5)
    expect(bandRatios(THOUGHT_INK, THOUGHT_FILL).night).toBeGreaterThanOrEqual(4.5)
    expect(bandRatios(SPEECH_INK, SPEECH_FILL).night).toBeGreaterThanOrEqual(4.5)
  })

  it('is still quieter than speech — by the paper now, never by transparency', () => {
    expect(contrast(THOUGHT_INK, THOUGHT_FILL)).toBeLessThan(contrast(SPEECH_INK, SPEECH_FILL))
  })
})

// World text is drawn in world space, so without a counter-scale the camera multiplies its
// apparent size — 8 px at the 0.5x stop, 750 CSS px across at 3x.
describe('a world label is the same size to the viewer at every zoom stop', () => {
  it('cancels the camera exactly, so the face is FACE_INSTALL_PX on screen wherever it is read', () => {
    for (const zoom of ZOOM_STOPS) {
      const apparent = FACE_INSTALL_PX * worldTextScale(zoom) * zoom
      expect(apparent, `${zoom}x`).toBeCloseTo(FACE_INSTALL_PX, 10)
      expect(apparent, `${zoom}x`).toBeGreaterThanOrEqual(TEXT_MIN_PX)
    }
  })

  // The counter-scale is also what makes the atlas crisp: one texel per screen pixel, at every
  // stop, instead of the 0.5x and 3x resampling the world scale was imposing on it.
  it('draws the atlas at one texel per screen pixel, never resampled', () => {
    for (const zoom of ZOOM_STOPS)
      expect(worldTextScale(zoom) * zoom, `${zoom}x`).toBeCloseTo(1, 10)
  })

  it('never returns a scale of zero or a negative, whatever the camera reports', () => {
    for (const bad of [0, -1, Number.NaN]) expect(worldTextScale(bad), `${bad}`).toBe(1)
  })

  it('is applied by every layer that puts a label in the world, not just by landmarks', () => {
    for (const f of ['./bubbles.ts', './characters.ts', './tooltip.ts', './landmarks.ts']) {
      expect(src(f), `${f} draws world text at the camera's scale`).toMatch(/worldTextScale\(/)
    }
  })
})

// Press Start 2P carries `fi`/`fl` ligatures, so the browser measures "fi" as ONE 16px em and
// Pixi derives a −16 kern, drawing the `i` on top of the `f`.
describe('the letter after an f survives — no derived kerning on a ligature face', () => {
  it('installs both faces with kerning skipped', async () => {
    installs.length = 0
    await installFaces({
      fonts: { load: async () => [], ready: Promise.resolve() } as unknown as FontFaceSet,
    })
    expect(installs.length).toBe(2)
    for (const o of installs) expect(o.skipKerning, String(o.name)).toBe(true)
  })

  it('keeps the atlas one texel per screen pixel and tintable, so one atlas serves every ink', () => {
    for (const o of installs) {
      expect(o.resolution, String(o.name)).toBe(1)
      expect(o.dynamicFill, String(o.name)).toBe(true)
      expect((o.textureStyle as { scaleMode: string }).scaleMode).toBe('nearest')
    }
  })
})

describe('the structural guard batch 2 left, still green', () => {
  const sources = (dir: string): string[] => {
    const out: string[] = []
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) {
        out.push(...sources(p))
        continue
      }
      if (!/\.(ts|tsx)$/.test(name) || /\.test\.(ts|tsx)$/.test(name)) continue
      out.push(p)
    }
    return out
  }

  it('still lets only worldLabel.ts build a glyph, now that a font exists to build one from', () => {
    const offenders = sources(join(HERE, '..'))
      .filter((f) => !f.endsWith('worldLabel.ts'))
      .filter((f) => /new\s+(BitmapText|Text)\s*\(/.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})

import { BitmapFont } from 'pixi.js'

/** Silkscreen — capitals only. Names, chips, the words on a slab. */
export const FACE_PX = 'sj-px'
/** Press Start 2P — has lowercase. Sentences people actually say. */
export const FACE_BODY = 'sj-body'

export const FACE_SOURCE: Readonly<Record<string, string>> = {
  [FACE_PX]: 'Silkscreen',
  [FACE_BODY]: 'Press Start 2P',
}

/** The faces that can set a sentence without shouting it. */
export const LOWERCASE_FACES: readonly string[] = [FACE_BODY]

/** Both faces are drawn on an eight-pixel em. Set at anything else they are resampled, which
 *  is the same fault the forge lane is fixing in the art: a size the source was not drawn at. */
export const FACE_DESIGN_PX = 8
export const FACE_SIZES = [8, 16, 24] as const
/** The atlas is baked at this size, so the sizes below draw one art pixel per two screen
 *  pixels and nothing is resampled. 8 would be crisper still and is under the 12px floor. */
export const FACE_INSTALL_PX = 16

/** Two, not 1.5: the faces are nearest-sampled off an atlas baked at the install size, so only
 *  a WHOLE multiple keeps one texel on one pixel. Applied through `Scene.textScale`. */
export const BROADCAST_TEXT_SCALE = 2

export const FACE_ROLES = ['name', 'speech', 'thought', 'label'] as const
export type FaceRole = (typeof FACE_ROLES)[number]

const ROLE_FACE: Readonly<Record<FaceRole, { family: string; size: number }>> = {
  name: { family: FACE_PX, size: FACE_INSTALL_PX },
  label: { family: FACE_PX, size: FACE_INSTALL_PX },
  speech: { family: FACE_BODY, size: FACE_INSTALL_PX },
  thought: { family: FACE_BODY, size: FACE_INSTALL_PX },
}

export function faceFor(role: FaceRole): { family: string; size: number } {
  return ROLE_FACE[role]
}

/** Multiply a world label's node by this and the face stays FACE_INSTALL_PX to the reader at
 *  every zoom stop, which also lands the atlas at one texel per screen pixel. */
export function worldTextScale(zoom: number): number {
  return Number.isFinite(zoom) && zoom > 0 ? 1 / zoom : 1
}

/** Both faces are monospace on an eight-pixel em. Deliberate UPPER bounds: wrapping early
 *  makes a bubble narrower, and a bubble narrower than its box never overflows it. */
export const FACE_ADVANCE_EM: Readonly<Record<string, number>> = {
  [FACE_BODY]: 1,
  [FACE_PX]: 0.65,
}
const WRAP_MIN_CHARS = 8

export function wrapCharsFor(family: string, size: number, maxPx: number): number {
  const advance = (FACE_ADVANCE_EM[family] ?? 1) * size
  return Math.max(WRAP_MIN_CHARS, Math.floor(maxPx / advance))
}

// ── installing the faces ──────────────────────────────────────────────────────────────────

/** ASCII plus the punctuation the narrator and the agents actually use. */
const CHARS: (string | string[])[] = [
  ['a', 'z'],
  ['A', 'Z'],
  ['0', '9'],
  ' .,:;!?\'"()[]-–—…&%/*+=',
]

let installed = false

/** Awaited before the scene is built. Resolves even when the webfonts do not, so a font that
 *  fails to load leaves canvas glyphs rather than blanking the dialogue. */
export async function installFaces(doc: { fonts: FontFaceSet }): Promise<void> {
  if (installed) return
  try {
    await Promise.all(
      Object.values(FACE_SOURCE).map((f) => doc.fonts.load(`${FACE_INSTALL_PX}px "${f}"`)),
    )
    await doc.fonts.ready
    for (const [name, source] of Object.entries(FACE_SOURCE)) {
      BitmapFont.install({
        name,
        // white + no stroke, so ONE atlas serves every ink the world writes in (dynamicFill)
        style: { fontFamily: source, fontSize: FACE_INSTALL_PX, fill: 0xffffff },
        chars: CHARS,
        // Press Start 2P has `fi`/`fl` ligatures, so Pixi derives a −16 kern and stacks the `i`
        // on the `f`. Both faces are monospace, so skipping kerning loses nothing.
        skipKerning: true,
        resolution: 1,
        padding: 2,
        dynamicFill: true,
        textureStyle: { scaleMode: 'nearest' },
      })
    }
    installed = true
  } catch {
    /* no bitmap font, so worldLabel keeps drawing canvas glyphs — a label may cost itself */
  }
}

// ── the bubble box ────────────────────────────────────────────────────────────────────────

/** World pixels. The box is drawn with Graphics, not nine-sliced art: 2px of ink on a 4px
 *  radius, so one shape tints to whoever is speaking. */
export const BUBBLE_PAD = 6
export const BUBBLE_RADIUS = 4
export const BUBBLE_STROKE = 2

/** The rim a thought wears instead of a drawn edge — a different SHAPE, never a thinner ink.
 *  Dots walk the box perimeter clockwise from the top-left corner. */
export const RIM_DOT_R = 1
const RIM_STEP_PX = 5

export function rimDots(w: number, h: number, step = RIM_STEP_PX): { cx: number; cy: number }[] {
  const out: { cx: number; cy: number }[] = []
  const along = (x0: number, y0: number, x1: number, y1: number): void => {
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step))
    for (let i = 0; i < n; i++) {
      out.push({ cx: x0 + ((x1 - x0) * i) / n, cy: y0 + ((y1 - y0) * i) / n })
    }
  }
  const r = BUBBLE_RADIUS
  along(r, 0, w - r, 0)
  along(w, r, w, h - r)
  along(w - r, h, r, h)
  along(0, h - r, 0, r)
  return out
}

// ── the tail ──────────────────────────────────────────────────────────────────────────────

export type BubbleSide = 'above' | 'below' | 'left' | 'right'
export const TAIL_STEPS = 3
export const TAIL_STEP_PX = 3

/** A stair-stepped tail in the same pixel grammar as the art, never a smooth triangle. It
 *  leaves the edge FACING the speaker (`Placed['side']`), so a de-conflicted bubble still
 *  points at its own mouth. Box local space is (0, 0) to (w, h). */
export function stairTail(side: BubbleSide, w: number, h: number): number[] {
  const s = TAIL_STEP_PX
  const span = TAIL_STEPS * s
  // (u, v): u runs along the edge, v away from the box. One staircase, mapped four ways.
  const uv: [number, number][] = [
    [0, 0],
    [span, 0],
  ]
  for (let i = 1; i <= TAIL_STEPS; i++) {
    uv.push([span - (i - 1) * s, i * s], [span - i * s, i * s])
  }
  const u0 = Math.round(w / 2) - span / 2
  const v0 = Math.round(h / 2) - span / 2
  const out: number[] = []
  for (const [u, v] of uv) {
    switch (side) {
      case 'above':
        out.push(u0 + u, h + v)
        break
      case 'below':
        out.push(u0 + u, -v)
        break
      case 'left':
        out.push(w + v, v0 + u)
        break
      case 'right':
        out.push(-v, v0 + u)
        break
    }
  }
  return out
}

// ── the two materials ─────────────────────────────────────────────────────────────────────

// Only three palette pairs clear AA under the deep-night multiply, so BOTH bubbles take
// `--deep` and carry their difference in the paper and the edge shape, never in the ink.
export const SPEECH_FILL = 0xfff6e9 // --cream:     15.02:1 day / 5.19:1 night
export const SPEECH_INK = 0x241f2b // --deep
export const THOUGHT_FILL = 0xf6e8d5 // --parchment: 13.34:1 day / 4.67:1 night
export const THOUGHT_INK = 0x241f2b // --deep, on visibly different paper
export const BUBBLE_EDGE = 0x241f2b // --deep, the stepped ledge under every slab

/** What a bubble collapses to when it is not one of the nearest, or the town is a map: a
 *  three-dot pill on the speaker's own paper, so a thought stays a thought at every stop. */
export const GLYPH_W = 15
export const GLYPH_H = 9
export const GLYPH_DOT_R = 1
export const GLYPH_DOTS = 3

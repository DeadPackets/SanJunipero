import { BitmapFont } from 'pixi.js'

/**
 * U18 — THE TOWN SPEAKS IN ITS OWN TYPEFACE, OUT OF A FRAME THAT BELONGS TO IT.
 *
 * Three defects, all measurable:
 *  1. Every world label asked for `fontFamily: 'monospace'`. The pixel faces were loaded, but
 *     no Pixi BitmapFont was ever installed, so the world spoke in the browser's default mono.
 *  2. A bubble was `roundRect(…, 4)` with a one-pixel stroke, while the chrome around it wore
 *     a whole nine-slice pixel-frame language.
 *  3. A thought was `alpha: 0.55` — de-emphasis by transparency, whose ratio is unknowable at
 *     the call site, on the one surface where legibility matters most.
 *
 * ★ WHICH FACE SAYS WHAT, and it is the opposite of what the names suggest. Silkscreen has NO
 * lowercase: "Hey Nadia" sets as HEY NADIA, so a town set in it would shout every sentence.
 * Press Start 2P has real lowercase. The pixel face therefore LABELS and the display face
 * SPEAKS.
 */

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

/**
 * ★ THE CAMERA DOES NOT GET A VOTE ON HOW BIG A WORD IS.
 *
 * World labels live in world space, so the camera multiplied them: the same thought bubble was
 * 8 px of type at the 0.5x stop and 750 CSS px across at 3x. The landmark layer had quietly
 * solved this for itself years of tasks ago with a private `1 / world.scale`; nothing else had
 * a rule. Multiply a world label's node by this and the face is FACE_INSTALL_PX to the reader
 * at every stop — which also lands the atlas at one texel per screen pixel, so it is the crisp
 * answer as well as the legible one.
 */
export function worldTextScale(zoom: number): number {
  return Number.isFinite(zoom) && zoom > 0 ? 1 / zoom : 1
}

/** Both faces are monospace on an eight-pixel em. Deliberate UPPER bounds: wrapping early
 *  makes a bubble narrower, and a bubble narrower than its box never overflows it. */
export const FACE_ADVANCE_EM: Readonly<Record<string, number>> = {
  [FACE_BODY]: 1,
  [FACE_PX]: 0.65,
}
export const WRAP_MIN_CHARS = 8

export function wrapCharsFor(family: string, size: number, maxPx: number): number {
  const advance = (FACE_ADVANCE_EM[family] ?? 1) * size
  return Math.max(WRAP_MIN_CHARS, Math.floor(maxPx / advance))
}

// ── installing the faces ──────────────────────────────────────────────────────────────────

/** ASCII plus the punctuation the narrator and the agents actually use. */
const CHARS: Array<string | string[]> = [['a', 'z'], ['A', 'Z'], ['0', '9'], " .,:;!?'\"()[]-–—…&%/*+="]

let installed = false
export function facesInstalled(): boolean {
  return installed
}

/**
 * Two-line adapter with no logic (P6). Awaited before the scene is built; if the webfonts
 * never resolve the landed canvas glyphs remain and the world is still readable — a font that
 * fails to load must never blank the dialogue.
 */
export async function installFaces(doc: { fonts: FontFaceSet }): Promise<void> {
  if (installed) return
  try {
    await Promise.all(Object.values(FACE_SOURCE).map((f) => doc.fonts.load(`${FACE_INSTALL_PX}px "${f}"`)))
    await doc.fonts.ready
    for (const [name, source] of Object.entries(FACE_SOURCE)) {
      BitmapFont.install({
        name,
        // white + no stroke, so ONE atlas serves every ink the world writes in (dynamicFill)
        style: { fontFamily: source, fontSize: FACE_INSTALL_PX, fill: 0xffffff },
        chars: CHARS,
        // ★ Press Start 2P has `fi` and `fl` LIGATURES: the browser measures "fi" as one 16px
        // em, so Pixi derives measure(fi) − measure(f) − measure(i) = −16 and stacks the `i`
        // on the `f`. Uncorrected, the town said "the fsh are biting". Both faces are
        // monospace, so there is no kerning worth deriving and this loses nothing.
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

// ── the bubble frame ──────────────────────────────────────────────────────────────────────

/** `ui/px/frame-cream.png` and its siblings are 30 x 30 with a 10px border. */
export const BUBBLE_SLICE = 10
export const BUBBLE_FRAME_PX = 30

export type SliceRect = {
  sx: number; sy: number; sw: number; sh: number
  dx: number; dy: number; dw: number; dh: number
}

/** Nine rects from one frame texture, so a slab stretches without smearing at any length.
 *  The four corners are never scaled; the edges stretch on one axis and the middle on both. */
export function nineSlice(w: number, h: number, slice: number): SliceRect[] {
  const dw = Math.max(2 * slice, Math.round(w))
  const dh = Math.max(2 * slice, Math.round(h))
  const midW = dw - 2 * slice
  const midH = dh - 2 * slice
  const cols = [
    { s: 0, sw: slice, d: 0, dw: slice },
    { s: slice, sw: slice, d: slice, dw: midW },
    { s: 2 * slice, sw: slice, d: slice + midW, dw: slice },
  ]
  const rows = [
    { s: 0, sh: slice, d: 0, dh: slice },
    { s: slice, sh: slice, d: slice, dh: midH },
    { s: 2 * slice, sh: slice, d: slice + midH, dh: slice },
  ]
  const out: SliceRect[] = []
  for (const r of rows) {
    for (const c of cols) {
      out.push({ sx: c.s, sy: r.s, sw: c.sw, sh: r.sh, dx: c.d, dy: r.d, dw: c.dw, dh: r.dh })
    }
  }
  return out
}

// ── the tail ──────────────────────────────────────────────────────────────────────────────

export type BubbleSide = 'above' | 'below' | 'left' | 'right'
export const TAIL_PX = 5

/** The tail points AT the speaker, from whichever side the bubble was placed on (Task 74's
 *  `Placed['side']`). Local coordinates: the box is (0, 0) to (w, h). */
export function tailPoly(side: BubbleSide, w: number, h: number): number[] {
  const t = TAIL_PX
  const cx = Math.round(w / 2)
  const cy = Math.round(h / 2)
  switch (side) {
    case 'above': return [cx - t, h, cx + t, h, cx, h + t]
    case 'below': return [cx - t, 0, cx + t, 0, cx, -t]
    case 'left': return [w, cy - t, w, cy + t, w + t, cy]
    case 'right': return [0, cy - t, 0, cy + t, -t, cy]
  }
}

// ── the two materials ─────────────────────────────────────────────────────────────────────

export const SPEECH_FILL = 0xfff6e9        // --cream
export const SPEECH_INK = 0x43394a         // --ink: 10.2:1 on cream
export const THOUGHT_FILL = 0xf6e8d5       // --parchment, so it is visibly a different paper
export const THOUGHT_INK = 0x5f5568        // --ink-quiet: 5.83:1 on parchment
export const BUBBLE_EDGE = 0x241f2b        // --deep, the stepped ledge under every slab
/** The cloud edge on a thought: a different SHAPE, which is the channel alpha was misusing. */
export const THOUGHT_SCALLOP_R = 3

import { Assets, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js'
import { WORLD_TEXT_LINE_H } from '../textFloor.js'
import { createWorldLabel } from './worldLabel.js'
import {
  BUBBLE_EDGE, BUBBLE_FRAME_PX, BUBBLE_SLICE, SPEECH_FILL, SPEECH_INK, THOUGHT_FILL,
  THOUGHT_INK, faceFor, nineSlice, scallopTrail, tailPoly, worldTextScale, wrapCharsFor,
  type BubbleSide,
} from './textFaces.js'
import { placeTag, type Rect } from './tooltip.js'
import { tileToScreen } from './iso.js'
import { CHAR_TARGET_PX } from './charAnim.js'
import type { WorldStore } from '../state/worldStore.js'
import type { Scene } from './scene.js'

export const SPEECH_MS_BASE = 2500
export const SPEECH_MS_PER_CHAR = 40
export const SPEECH_MAX_CHARS = 140
export const THOUGHT_DRIFT_PX = 2

/** How wide a bubble may grow in world pixels before it wraps. */
export const BUBBLE_MAX_PX = 210
export const BUBBLE_FONT_PX = faceFor('speech').size
export const BUBBLE_LINE_H = Math.max(WORLD_TEXT_LINE_H, BUBBLE_FONT_PX + 4)
/** DERIVED, not the hardcoded 24 it was: the wide face wraps sooner than the narrow one. */
export const WRAP_CHARS = wrapCharsFor(faceFor('speech').family, BUBBLE_FONT_PX, BUBBLE_MAX_PX)

export const BUBBLE_FILL = SPEECH_FILL
export const BUBBLE_INK = SPEECH_INK

/** The same nine-slice art every floating slab in the chrome wears. */
export const SPEECH_FRAME_URL = new URL('../ui/px/frame-cream.png', import.meta.url).href
export const THOUGHT_FRAME_URL = new URL('../ui/px/frame-parchment.png', import.meta.url).href

export function bubbleLife(text: string): number {
  return SPEECH_MS_BASE + SPEECH_MS_PER_CHAR * Math.min(text.length, SPEECH_MAX_CHARS)
}

export function wrapBubble(text: string, maxChars = WRAP_CHARS): string[] {
  const lines: string[] = []
  let line = ''
  for (const rawWord of text.split(/\s+/).filter((w) => w.length > 0)) {
    let word = rawWord
    while (word.length > maxChars) {
      if (line.length > 0) {
        lines.push(line)
        line = ''
      }
      lines.push(word.slice(0, maxChars))
      word = word.slice(maxChars)
    }
    if (word.length === 0) continue
    if (line.length === 0) line = word
    else if (line.length + 1 + word.length <= maxChars) line += ` ${word}`
    else {
      lines.push(line)
      line = word
    }
  }
  if (line.length > 0) lines.push(line)
  return lines
}

/**
 * ★ TWO SPEAKERS STANDING TOGETHER USED TO COMPOSITE INTO ONE PILE (audit M8, carried in from
 * batch 5). Bubbles published their boxes to `scene.tags.setOccupied`, so a TOOLTIP knew to
 * avoid them and no bubble knew to avoid another bubble. `placeTag` is the product's one
 * placement rule and it already solves this; the only thing missing was calling it.
 *
 * Order is the layer's own arrival order, so the answer is deterministic and a bubble does not
 * jump about while the one beside it is dying.
 */
export function placeBubbles(
  want: ReadonlyArray<{ id: string; sx: number; sy: number; size: { w: number; h: number } }>,
  view: Rect,
): Array<{ id: string; sx: number; sy: number; side: BubbleSide; rect: Rect }> {
  const taken: Rect[] = []
  const out: Array<{ id: string; sx: number; sy: number; side: BubbleSide; rect: Rect }> = []
  for (const b of want) {
    const at = placeTag({ sx: b.sx, sy: b.sy, halfW: b.size.w / 2, topY: b.sy }, b.size, view, taken)
    const rect = { x: at.sx - b.size.w / 2, y: at.sy, w: b.size.w, h: b.size.h }
    taken.push(rect)
    out.push({ id: b.id, sx: at.sx, sy: at.sy, side: at.side, rect })
  }
  return out
}

export type BubbleLayer = {
  spawnSpeech(agentId: string, text: string): void
  spawnThought(agentId: string, text: string): void
  setSuppressed(v: boolean): void
  tick(nowMs: number): void
  destroy(): void
}

type Bubble = {
  agentId: string; node: Container; bornMs: number; dieMs: number; isThought: boolean
  /** the box, in the node's local space, and the tail that has to point out of it */
  box: Container; tail: Graphics; w: number; h: number; side: BubbleSide
}

/** Nine sub-textures cut once from one frame, so a bubble of any length costs no new art. */
const sliceCache = new Map<string, Texture[] | null>()
function frameSlices(url: string): Texture[] | null {
  return sliceCache.get(url) ?? null
}
function loadFrame(url: string): void {
  if (sliceCache.has(url)) return
  sliceCache.set(url, null)
  void Assets.load<Texture>(url)
    .then((tex) => {
      const s = BUBBLE_SLICE
      sliceCache.set(url, nineSlice(BUBBLE_FRAME_PX, BUBBLE_FRAME_PX, s).map((r) =>
        new Texture({ source: tex.source, frame: new Rectangle(r.sx, r.sy, r.sw, r.sh) })))
    })
    .catch(() => { /* no frame art: the flat slab below is still a readable bubble */ })
}

export function createBubbleLayer(scene: Scene, store: WorldStore): BubbleLayer {
  const bubbles: Bubble[] = []
  let suppressed = false
  loadFrame(SPEECH_FRAME_URL)
  loadFrame(THOUGHT_FRAME_URL)

  /** The frame, drawn as nine pieces: corners never scaled, edges stretched on one axis. */
  const frame = (into: Container, url: string, w: number, h: number, fill: number): void => {
    const g = new Graphics()
    g.rect(BUBBLE_SLICE - 2, BUBBLE_SLICE - 2, w - 2 * BUBBLE_SLICE + 4, h - 2 * BUBBLE_SLICE + 4)
    g.fill(fill)
    into.addChild(g)
    const slices = frameSlices(url)
    if (slices === null) {
      // the frame art has not arrived (or never will) — a plain ink-ringed slab still reads
      const flat = new Graphics()
      flat.rect(0, 0, w, h)
      flat.fill(fill)
      flat.stroke({ width: 2, color: BUBBLE_INK })
      into.addChildAt(flat, 0)
      return
    }
    nineSlice(w, h, BUBBLE_SLICE).forEach((r, i) => {
      const piece = new Sprite(slices[i]!)
      piece.position.set(r.dx, r.dy)
      piece.width = r.dw
      piece.height = r.dh
      into.addChild(piece)
    })
  }

  /** The tail is redrawn when the box changes side, so it always points at its own speaker
   *  even after de-confliction has moved the bubble somewhere else. */
  const drawTail = (tail: Graphics, isThought: boolean, side: BubbleSide, w: number, h: number): void => {
    tail.clear()
    if (isThought) {
      for (const d of scallopTrail(side, w, h)) tail.circle(d.cx, d.cy, d.r)
      tail.fill(THOUGHT_FILL)
    } else {
      tail.poly(tailPoly(side, w, h))
      tail.fill(SPEECH_FILL)
    }
    tail.stroke({ width: 1, color: BUBBLE_EDGE })
  }

  const build = (text: string, isThought: boolean): {
    node: Container; box: Container; tail: Graphics; w: number; h: number
  } => {
    const node = new Container()
    node.eventMode = 'none' // bubbles float over heads — never block a character click
    const role = isThought ? 'thought' : 'speech'
    const face = faceFor(role)
    const lines = wrapBubble(text.slice(0, SPEECH_MAX_CHARS), wrapCharsFor(face.family, face.size, BUBBLE_MAX_PX))
    const label = createWorldLabel(lines.join('\n'), {
      fontFamily: face.family, fontSize: face.size, fill: isThought ? THOUGHT_INK : SPEECH_INK,
      lineHeight: BUBBLE_LINE_H, align: 'left',
    })
    const pad = BUBBLE_SLICE - 2
    const w = Math.ceil(label.width) + 2 * pad
    const h = Math.ceil(label.height) + 2 * pad

    // A THOUGHT IS A DIFFERENT MATERIAL, NEVER A THINNER ONE. Different paper, a different
    // frame and a scalloped trail instead of a tail — shape and paper, not `alpha: 0.55`.
    const box = new Container()
    box.position.set(-Math.round(w / 2), -h)
    frame(box, isThought ? THOUGHT_FRAME_URL : SPEECH_FRAME_URL, w, h, isThought ? THOUGHT_FILL : SPEECH_FILL)

    const tail = new Graphics()
    drawTail(tail, isThought, 'above', w, h)
    box.addChild(tail)

    label.position.set(pad, pad)
    box.addChild(label)
    node.addChild(box)
    return { node, box, tail, w, h }
  }

  const spawn = (agentId: string, text: string, isThought: boolean): void => {
    if (isThought && suppressed) return // thought wisps stop under grave tone; speech is world fact
    const state = store.getState()
    if (state === null || state.agents[agentId] === undefined) return // visible agents only
    const now = performance.now()
    const built = build(text, isThought)
    scene.layers.bubbles.addChild(built.node)
    bubbles.push({
      agentId, ...built, bornMs: now, dieMs: now + bubbleLife(text), isThought, side: 'above',
    })
  }

  return {
    spawnSpeech: (agentId, text) => spawn(agentId, text, false),
    spawnThought: (agentId, text) => spawn(agentId, text, true),
    setSuppressed: (v) => {
      suppressed = v
      if (v) {
        for (let i = bubbles.length - 1; i >= 0; i--) {
          if (bubbles[i]!.isThought) {
            bubbles[i]!.node.destroy({ children: true })
            bubbles.splice(i, 1)
          }
        }
      }
    },
    tick: (nowMs) => {
      const state = store.getState()
      const inv = worldTextScale(scene.getZoom())
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i]!
        if (nowMs >= b.dieMs || state?.agents[b.agentId] === undefined) {
          b.node.destroy({ children: true })
          bubbles.splice(i, 1)
        }
      }
      // Where each one WANTS to be, then one placement pass over the whole live set: a bubble
      // that does not know about the bubble beside it is the pile the user saw.
      const want = bubbles.map((b, i) => {
        const a = state!.agents[b.agentId]!
        const { sx, sy } = tileToScreen(a.x, a.y)
        const drift = b.isThought ? (THOUGHT_DRIFT_PX * (nowMs - b.bornMs)) / (b.dieMs - b.bornMs) : 0
        return {
          id: String(i), sx, sy: sy - CHAR_TARGET_PX - 18 - drift,
          size: { w: b.w * inv, h: b.h * inv },
        }
      })
      const boxes: Rect[] = []
      for (const at of placeBubbles(want, scene.viewRect())) {
        const b = bubbles[Number(at.id)]!
        b.node.scale.set(inv)     // the bubble is the reader's size, not the camera's
        // the box is drawn from (-w/2, -h), so the node sits at the box's bottom centre
        b.node.position.set(Math.round(at.sx), Math.round(at.rect.y + at.rect.h))
        if (b.side !== at.side) {
          b.side = at.side
          drawTail(b.tail, b.isThought, at.side, b.w, b.h)
        }
        boxes.push(at.rect)
      }
      // audit M8: a tag and a bubble used to composite into an unreadable pile
      scene.tags.setOccupied(boxes)
    },
    destroy: () => {
      for (const b of bubbles) b.node.destroy({ children: true })
      bubbles.length = 0
    },
  }
}

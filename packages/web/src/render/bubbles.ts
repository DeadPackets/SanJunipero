import { Assets, Container, Graphics, Texture } from 'pixi.js'
import { WORLD_TEXT_LINE_H } from '../textFloor.js'
import { createWorldLabel } from './worldLabel.js'
import {
  BUBBLE_EDGE,
  BUBBLE_PAD,
  BUBBLE_RADIUS,
  BUBBLE_STROKE,
  RIM_DOT_R,
  SPEECH_FILL,
  SPEECH_INK,
  THOUGHT_FILL,
  THOUGHT_INK,
  faceFor,
  rimDots,
  stairTail,
  worldTextScale,
  wrapCharsFor,
  type BubbleSide,
} from './textFaces.js'
import { placeTag, type Rect } from './tooltip.js'
import { FACINGS, tileToScreen } from './iso.js'
import { ZOOM_STOPS } from './camera.js'
import { CHAR_TARGET_PX, SHEET_ROWS } from './charAnim.js'
import { characterArt } from './textures.js'
import { characterCell } from './characters.js'
import type { WorldStore } from '../state/worldStore.js'
import type { Scene } from './scene.js'

export const SPEECH_MS_BASE = 2500
export const SPEECH_MS_PER_CHAR = 40
export const SPEECH_MAX_CHARS = 140
const THOUGHT_DRIFT_PX = 2

/** How wide a bubble may grow in world pixels before it wraps. */
export const BUBBLE_MAX_PX = 210
export const BUBBLE_FONT_PX = faceFor('speech').size
export const BUBBLE_LINE_H = Math.max(WORLD_TEXT_LINE_H, BUBBLE_FONT_PX + 4)
/** DERIVED, not the hardcoded 24 it was: the wide face wraps sooner than the narrow one. */
export const WRAP_CHARS = wrapCharsFor(faceFor('speech').family, BUBBLE_FONT_PX, BUBBLE_MAX_PX)

/** Two lines is what a reader takes in over a moving town; the rest is a paper's job. */
export const BUBBLE_MAX_LINES = 2
export const ELLIPSIS = '…'

/** Only the three nearest the camera's centre are worth reading. The camera centre IS the
 *  followed subject while the director is cutting, so one rule covers both. */
export const BUBBLE_NEAREST = 3
/** At the widest stop a person is eight pixels tall and a bubble is the whole street. */
export const GLYPH_ZOOM: number = ZOOM_STOPS[0]
/** How far the cream leans toward the speaker's own colour. */
export const SPEAKER_TINT = 0.15

const GLYPH_W = 15
const GLYPH_H = 9
const GLYPH_DOT_R = 1

const BUBBLE_INK = SPEECH_INK

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
  if (lines.length <= BUBBLE_MAX_LINES) return lines
  const last = lines[BUBBLE_MAX_LINES - 1]!.slice(0, Math.max(1, maxChars - 1)).trimEnd()
  lines.length = BUBBLE_MAX_LINES
  lines[BUBBLE_MAX_LINES - 1] = last + ELLIPSIS
  return lines
}

/** Mixes `base` toward `toward` by `amount`, per channel, in 0xRRGGBB. */
export function tintToward(base: number, toward: number, amount: number): number {
  const k = Math.min(1, Math.max(0, amount))
  const mix = (shift: number): number => {
    const a = (base >> shift) & 0xff
    const b = (toward >> shift) & 0xff
    return Math.round(a + (b - a) * k) & 0xff
  }
  return (mix(16) << 16) | (mix(8) << 8) | mix(0)
}

const TINT_BUCKET_BITS = 3
const TINT_MIN_ALPHA = 200
/** The outline ink is on every sheet and is nobody's colour. */
const TINT_MIN_LEVEL = 40

/** The colour a sprite is mostly made of, from RGBA bytes. Transparent and near-black pixels
 *  are skipped, so it lands on the cloth rather than on the outline. */
export function dominantColor(rgba: ArrayLike<number>): number | null {
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>()
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const r = rgba[i]!
    const g = rgba[i + 1]!
    const b = rgba[i + 2]!
    if (rgba[i + 3]! < TINT_MIN_ALPHA) continue
    if (Math.max(r, g, b) < TINT_MIN_LEVEL) continue
    const key =
      ((r >> TINT_BUCKET_BITS) << 10) | ((g >> TINT_BUCKET_BITS) << 5) | (b >> TINT_BUCKET_BITS)
    const at = buckets.get(key)
    if (at === undefined) buckets.set(key, { r, g, b, n: 1 })
    else {
      at.r += r
      at.g += g
      at.b += b
      at.n++
    }
  }
  let top: { r: number; g: number; b: number; n: number } | null = null
  for (const v of buckets.values()) if (top === null || v.n > top.n) top = v
  if (top === null) return null
  const best = top
  const avg = (sum: number): number => Math.round(sum / best.n) & 0xff
  return (avg(best.r) << 16) | (avg(best.g) << 8) | avg(best.b)
}

/** The three nearest the centre keep their bubble; input order breaks a tie, and `sort` is
 *  stable, so the same frame always chooses the same three. */
export function nearestSpeakers(
  want: readonly { id: string; sx: number; sy: number }[],
  centre: { x: number; y: number },
  limit = BUBBLE_NEAREST,
): Set<string> {
  return new Set(
    want
      .map((b) => ({ id: b.id, d: (b.sx - centre.x) ** 2 + (b.sy - centre.y) ** 2 }))
      .sort((a, b) => a.d - b.d)
      .slice(0, limit)
      .map((b) => b.id),
  )
}

/** A bubble is only spelled out when it is one of the nearest and the town is not a map. */
export function bubbleShown(zoom: number, isNearest: boolean): boolean {
  return isNearest && zoom > GLYPH_ZOOM
}

/** De-conflicts the whole live set through `placeTag` in the layer's own arrival order, so a bubble does not jump about while the one beside it is dying. */
export function placeBubbles(
  want: readonly { id: string; sx: number; sy: number; size: { w: number; h: number } }[],
  view: Rect,
): { id: string; sx: number; sy: number; side: BubbleSide; rect: Rect }[] {
  const taken: Rect[] = []
  const out: { id: string; sx: number; sy: number; side: BubbleSide; rect: Rect }[] = []
  for (const b of want) {
    const at = placeTag(
      { sx: b.sx, sy: b.sy, halfW: b.size.w / 2, topY: b.sy },
      b.size,
      view,
      taken,
    )
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
  agentId: string
  node: Container
  bornMs: number
  dieMs: number
  isThought: boolean
  /** the box, in the node's local space, and the tail that has to point out of it */
  box: Container
  glyph: Container
  tail: Graphics
  w: number
  h: number
  side: BubbleSide
}

export function createBubbleLayer(scene: Scene, store: WorldStore): BubbleLayer {
  const bubbles: Bubble[] = []
  let suppressed = false

  // One readback per person, from the idle cell the character layer already loaded. Until it
  // lands the bubble is plain cream, which is the material it leans away from anyway.
  const tints = new Map<string, number | null>()
  const speakerFill = (agentId: string): number => {
    const known = tints.get(agentId)
    if (known !== undefined) return known ?? SPEECH_FILL
    tints.set(agentId, null)
    const art = characterArt(store.assetRecords(), agentId)
    void Assets.load<Texture>(art.url)
      .then((sheet) => {
        const cell = characterCell(sheet, art, SHEET_ROWS[0], FACINGS[0])
        if (cell === null) return
        const px = scene.app.renderer.extract.pixels(cell.texture)
        const dominant = dominantColor(px.pixels)
        if (dominant !== null) tints.set(agentId, tintToward(SPEECH_FILL, dominant, SPEAKER_TINT))
      })
      .catch(() => {
        /* no sheet, or no GPU readback here: cream is a bubble too */
      })
    return SPEECH_FILL
  }

  /** The tail is redrawn when the box changes side, so it always points at its own speaker
   *  even after de-confliction has moved the bubble somewhere else. */
  const drawTail = (tail: Graphics, side: BubbleSide, w: number, h: number, fill: number): void => {
    tail.clear()
    tail.poly(stairTail(side, w, h))
    tail.fill(fill)
    tail.stroke({ width: 1, color: BUBBLE_EDGE })
  }

  const glyphNode = (): Container => {
    const g = new Graphics()
    g.roundRect(0, 0, GLYPH_W, GLYPH_H, GLYPH_H / 2)
    g.fill(BUBBLE_INK)
    for (let i = 0; i < 3; i++) g.circle(4 + i * 4, GLYPH_H / 2, GLYPH_DOT_R)
    g.fill(SPEECH_FILL)
    g.position.set(-Math.round(GLYPH_W / 2), -GLYPH_H)
    const node = new Container()
    node.addChild(g)
    return node
  }

  const build = (
    agentId: string,
    text: string,
    isThought: boolean,
  ): {
    node: Container
    box: Container
    glyph: Container
    tail: Graphics
    w: number
    h: number
  } => {
    const node = new Container()
    node.eventMode = 'none' // bubbles float over heads — never block a character click
    const role = isThought ? 'thought' : 'speech'
    const face = faceFor(role)
    const lines = wrapBubble(
      text.slice(0, SPEECH_MAX_CHARS),
      wrapCharsFor(face.family, face.size, BUBBLE_MAX_PX),
    )
    const label = createWorldLabel(lines.join('\n'), {
      fontFamily: face.family,
      fontSize: face.size,
      fill: isThought ? THOUGHT_INK : SPEECH_INK,
      lineHeight: BUBBLE_LINE_H,
      align: 'left',
    })
    const w = Math.ceil(label.width) + 2 * BUBBLE_PAD
    const h = Math.ceil(label.height) + 2 * BUBBLE_PAD

    // A THOUGHT IS A DIFFERENT MATERIAL, NEVER A THINNER ONE. Different paper, a dotted rim
    // and no tail at all — shape and paper, not `alpha: 0.55`.
    const fill = isThought ? THOUGHT_FILL : speakerFill(agentId)
    const box = new Container()
    box.position.set(-Math.round(w / 2), -h)
    const paper = new Graphics()
    paper.roundRect(0, 0, w, h, BUBBLE_RADIUS)
    paper.fill(fill)
    if (isThought) {
      for (const d of rimDots(w, h)) paper.circle(d.cx, d.cy, RIM_DOT_R)
      paper.fill(BUBBLE_INK)
    } else {
      paper.stroke({ width: BUBBLE_STROKE, color: BUBBLE_INK, alignment: 1 })
    }
    box.addChild(paper)

    const tail = new Graphics()
    if (!isThought) drawTail(tail, 'above', w, h, fill)
    box.addChildAt(tail, 0)

    label.position.set(BUBBLE_PAD, BUBBLE_PAD)
    box.addChild(label)
    const glyph = glyphNode()
    glyph.visible = false
    node.addChild(box, glyph)
    return { node, box, glyph, tail, w, h }
  }

  const spawn = (agentId: string, text: string, isThought: boolean): void => {
    if (isThought && suppressed) return // thought wisps stop under grave tone; speech is world fact
    const state = store.getState()
    if (state?.agents[agentId] === undefined) return // visible agents only
    const now = performance.now()
    const built = build(agentId, text, isThought)
    scene.layers.bubbles.addChild(built.node)
    bubbles.push({
      agentId,
      ...built,
      bornMs: now,
      dieMs: now + bubbleLife(text),
      isThought,
      side: 'above',
    })
  }

  return {
    spawnSpeech: (agentId, text) => {
      spawn(agentId, text, false)
    },
    spawnThought: (agentId, text) => {
      spawn(agentId, text, true)
    },
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
      // The reader's size, times whatever the frame asks for: 1 at a desk, 2 in a broadcast,
      // where 16px of speech is 4.00px on a 480-wide player and nobody can read it.
      const inv = worldTextScale(scene.getZoom()) * scene.textScale
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i]!
        if (nowMs >= b.dieMs || state?.agents[b.agentId] === undefined) {
          b.node.destroy({ children: true })
          bubbles.splice(i, 1)
        }
      }
      // Where each one WANTS to be, then one placement pass over the whole live set: a bubble
      // that does not know about the bubble beside it is the pile the user saw.
      const at = bubbles.map((b, i) => {
        const a = state!.agents[b.agentId]!
        // Over the BODY, not the record's tile: `anchorOf` carries the interpolated step and the
        // crowd rank. The character layer ticks before this one, so the anchor is this frame's.
        const anchor = scene.anchorOf?.(b.agentId) ?? null
        const { sx, sy } = anchor === null ? tileToScreen(a.x, a.y) : { sx: anchor.x, sy: anchor.y }
        const drift = b.isThought
          ? (THOUGHT_DRIFT_PX * (nowMs - b.bornMs)) / (b.dieMs - b.bornMs)
          : 0
        return { id: String(i), sx, sy: sy - CHAR_TARGET_PX - 18 - drift }
      })
      const view = scene.viewRect()
      const near = nearestSpeakers(at, { x: view.x + view.w / 2, y: view.y + view.h / 2 })
      const zoom = scene.getZoom()
      const want = at.map((p) => {
        const b = bubbles[Number(p.id)]!
        const shown = bubbleShown(zoom, near.has(p.id))
        b.box.visible = shown
        b.glyph.visible = !shown
        const size = shown ? { w: b.w, h: b.h } : { w: GLYPH_W, h: GLYPH_H }
        return { ...p, size: { w: size.w * inv, h: size.h * inv } }
      })
      const boxes: Rect[] = []
      for (const placed of placeBubbles(want, view)) {
        const b = bubbles[Number(placed.id)]!
        b.node.scale.set(inv) // the bubble is the reader's size, not the camera's
        // the box is drawn from (-w/2, -h), so the node sits at the box's bottom centre
        b.node.position.set(Math.round(placed.sx), Math.round(placed.rect.y + placed.rect.h))
        if (b.side !== placed.side) {
          b.side = placed.side
          if (!b.isThought) drawTail(b.tail, placed.side, b.w, b.h, speakerFill(b.agentId))
        }
        boxes.push(placed.rect)
      }
      scene.tags.setOccupied(boxes)
    },
    destroy: () => {
      for (const b of bubbles) b.node.destroy({ children: true })
      bubbles.length = 0
    },
  }
}

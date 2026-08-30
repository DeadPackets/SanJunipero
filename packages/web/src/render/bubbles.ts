import { Assets, Container, Graphics, Texture } from 'pixi.js'
import { WORLD_TEXT_LINE_H } from '../textFloor.js'
import { createWorldLabel } from './worldLabel.js'
import {
  BUBBLE_EDGE,
  BUBBLE_PAD,
  BUBBLE_RADIUS,
  BUBBLE_STROKE,
  GLYPH_DOTS,
  GLYPH_DOT_R,
  GLYPH_H,
  GLYPH_W,
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
import { over } from './legibility.js'
import { overlaps, placeTag, type Rect } from './tooltip.js'
import { FACINGS, tileToScreen } from './iso.js'
import { ZOOM_STOPS } from './camera.js'
import { CHAR_TARGET_PX, SHEET_ROWS } from './charAnim.js'
import { characterArt, fadeArtIn } from './textures.js'
import { MOTION, progress } from '../ui/motion.js'
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
/** A bubble leaves on the reveal motion, the same one its art arrives on. */
export const BUBBLE_FADE_MS = MOTION.reveal.ms
/** How far that colour is washed out before it is leaned into. Measured, not chosen: cream
 *  clears night AA at only 5.19:1, and a raw hue at 0.15 drops pure red to 4.12:1. */
const SPEAKER_WASH = 0.5

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
  return [...lines.slice(0, BUBBLE_MAX_LINES - 1), last + ELLIPSIS]
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

/** The speaker's colour as a pale wash. A bubble leans toward WHO is speaking, never toward
 *  how dark their coat is — sprite ink mixed straight into the cream takes the paper under
 *  the night AA floor, and a person in black would be the one nobody can read. */
export function speakerWash(rgb: number): number {
  const r = (rgb >> 16) & 0xff
  const g = (rgb >> 8) & 0xff
  const b = rgb & 0xff
  const top = Math.max(r, g, b)
  if (top === 0) return 0xffffff
  const lift = (c: number): number => Math.round((c * 0xff) / top)
  return over(0xffffff, (lift(r) << 16) | (lift(g) << 8) | lift(b), SPEAKER_WASH)
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

/** `placeTag` clamps a bubble into the view, so a speaker who has walked off screen would leave
 *  a "…" pinned to the viewport corner with nobody under it. A bubble that no longer touches
 *  its own speaker's box — the speaker's size around the anchor — is not shown. */
export function onLeash(
  rect: Rect,
  sx: number,
  sy: number,
  size: { w: number; h: number },
): boolean {
  return overlaps(rect, { x: sx - size.w, y: sy - size.h, w: size.w * 2, h: size.h * 2 })
}

/** The opacity a bubble has `msLeft` before it dies: the reveal motion run backwards, so it
 *  leaves on the curve it arrived on. */
export function bubbleAlpha(msLeft: number): number {
  return 1 - progress('reveal', 0, BUBBLE_FADE_MS - msLeft)
}

/** De-conflicts the whole live set through `placeTag` in the layer's own arrival order, so a bubble does not jump about while the one beside it is dying. */
export function placeBubbles(
  want: readonly { id: string; sx: number; sy: number; size: { w: number; h: number } }[],
  view: Rect,
  keepOff: readonly Rect[] = [],
): { id: string; sx: number; sy: number; side: BubbleSide; rect: Rect }[] {
  const taken: Rect[] = [...keepOff]
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
  glyph: Graphics
  tail: Graphics
  /** the paper this one was drawn on, so a tail redrawn later matches its own box */
  fill: number
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
        if (dominant !== null)
          tints.set(agentId, over(speakerWash(dominant), SPEECH_FILL, SPEAKER_TINT))
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

  /** The "…" a bubble collapses to: an ink pill with the speaker's own paper for dots. */
  const glyphNode = (isThought: boolean): Graphics => {
    const g = new Graphics()
    g.roundRect(0, 0, GLYPH_W, GLYPH_H, GLYPH_H / 2)
    g.fill(BUBBLE_EDGE)
    const pitch = GLYPH_W / (GLYPH_DOTS + 1)
    for (let i = 1; i <= GLYPH_DOTS; i++) g.circle(i * pitch, GLYPH_H / 2, GLYPH_DOT_R)
    g.fill(isThought ? THOUGHT_FILL : SPEECH_FILL)
    g.position.set(-Math.round(GLYPH_W / 2), -GLYPH_H)
    return g
  }

  const build = (
    agentId: string,
    text: string,
    isThought: boolean,
  ): {
    node: Container
    box: Container
    glyph: Graphics
    tail: Graphics
    fill: number
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
      paper.fill(BUBBLE_EDGE)
    } else {
      paper.stroke({ width: BUBBLE_STROKE, color: BUBBLE_EDGE, alignment: 1 })
    }
    box.addChild(paper)

    const tail = new Graphics()
    if (!isThought) drawTail(tail, 'above', w, h, fill)
    box.addChildAt(tail, 0)

    label.position.set(BUBBLE_PAD, BUBBLE_PAD)
    box.addChild(label)
    const glyph = glyphNode(isThought)
    glyph.visible = false
    node.addChild(box, glyph)
    return { node, box, glyph, tail, fill, w, h }
  }

  const spawn = (agentId: string, text: string, isThought: boolean): void => {
    if (isThought && suppressed) return // thought wisps stop under grave tone; speech is world fact
    const state = store.getState()
    if (state?.agents[agentId] === undefined) return // visible agents only
    const now = performance.now()
    const built = build(agentId, text, isThought)
    scene.layers.bubbles.addChild(built.node)
    fadeArtIn(built.node) // NOTHING POPS IN — speech included
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
      const zoom = scene.getZoom()
      // The reader's size, times whatever the frame asks for: 1 at a desk, 2 in a broadcast,
      // where 16px of speech is 4.00px on a 480-wide player and nobody can read it.
      const inv = worldTextScale(zoom) * scene.textScale
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
      const want = at.map((p, i) => {
        const b = bubbles[i]!
        const shown = bubbleShown(zoom, near.has(p.id))
        b.box.visible = shown
        b.glyph.visible = !shown
        return {
          ...p,
          size: shown ? { w: b.w * inv, h: b.h * inv } : { w: GLYPH_W * inv, h: GLYPH_H * inv },
        }
      })
      const boxes: Rect[] = []
      for (const placed of placeBubbles(want, view, scene.tags.occupied('bubbles'))) {
        const i = Number(placed.id)
        const b = bubbles[i]!
        b.node.scale.set(inv) // the bubble is the reader's size, not the camera's
        const p = want[i]!
        b.node.visible = onLeash(placed.rect, p.sx, p.sy, p.size)
        if (!b.node.visible) continue
        // the last frames fade; the fade-in is a rAF on the node and is left alone once done
        const leaving = bubbleAlpha(b.dieMs - nowMs)
        if (leaving < 1) b.node.alpha = leaving
        // the box is drawn from (-w/2, -h), so the node sits at the box's bottom centre
        b.node.position.set(Math.round(placed.sx), Math.round(placed.rect.y + placed.rect.h))
        if (b.side !== placed.side) {
          b.side = placed.side
          if (!b.isThought) drawTail(b.tail, placed.side, b.w, b.h, b.fill)
        }
        boxes.push(placed.rect)
      }
      scene.tags.setOccupied('bubbles', boxes)
    },
    destroy: () => {
      for (const b of bubbles) b.node.destroy({ children: true })
      bubbles.length = 0
    },
  }
}

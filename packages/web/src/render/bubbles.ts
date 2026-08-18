import { Assets, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js'
import { WORLD_TEXT_LINE_H } from '../textFloor.js'
import { createWorldLabel } from './worldLabel.js'
import {
  BUBBLE_EDGE, BUBBLE_FRAME_PX, BUBBLE_SLICE, SPEECH_FILL, SPEECH_INK, THOUGHT_FILL,
  THOUGHT_INK, THOUGHT_SCALLOP_R, faceFor, nineSlice, tailPoly, worldTextScale, wrapCharsFor,
  type BubbleSide,
} from './textFaces.js'
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

export type BubbleLayer = {
  spawnSpeech(agentId: string, text: string): void
  spawnThought(agentId: string, text: string): void
  setSuppressed(v: boolean): void
  tick(nowMs: number): void
  destroy(): void
}

type Bubble = { agentId: string; node: Container; bornMs: number; dieMs: number; isThought: boolean }

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

  const build = (text: string, isThought: boolean): Container => {
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

    // A THOUGHT IS A DIFFERENT MATERIAL, NEVER A THINNER ONE. Parchment under quiet ink, and a
    // scalloped edge instead of a tail — shape and ink, not `alpha: 0.55`.
    const box = new Container()
    box.position.set(-Math.round(w / 2), -h)
    frame(box, isThought ? THOUGHT_FRAME_URL : SPEECH_FRAME_URL, w, h, isThought ? THOUGHT_FILL : SPEECH_FILL)

    const tail = new Graphics()
    if (isThought) {
      // three shrinking dots trailing down to the thinker — the cloud edge, read downward
      for (let i = 0; i < 3; i++) {
        const r = THOUGHT_SCALLOP_R - i
        tail.circle(Math.round(w / 2) - i * 2, h + 3 + i * (THOUGHT_SCALLOP_R + 2), Math.max(1, r))
      }
      tail.fill(THOUGHT_FILL)
      tail.stroke({ width: 1, color: BUBBLE_EDGE })
    } else {
      tail.poly(tailPoly('above' satisfies BubbleSide, w, h))
      tail.fill(SPEECH_FILL)
      tail.stroke({ width: 1, color: BUBBLE_EDGE })
    }
    box.addChild(tail)

    label.position.set(pad, pad)
    box.addChild(label)
    node.addChild(box)
    return node
  }

  const spawn = (agentId: string, text: string, isThought: boolean): void => {
    if (isThought && suppressed) return // thought wisps stop under grave tone; speech is world fact
    const state = store.getState()
    if (state === null || state.agents[agentId] === undefined) return // visible agents only
    const now = performance.now()
    const node = build(text, isThought)
    scene.layers.bubbles.addChild(node)
    bubbles.push({ agentId, node, bornMs: now, dieMs: now + bubbleLife(text), isThought })
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
      const boxes: Array<{ x: number; y: number; w: number; h: number }> = []
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i]!
        const a = state?.agents[b.agentId]
        if (nowMs >= b.dieMs || a === undefined) {
          b.node.destroy({ children: true })
          bubbles.splice(i, 1)
          continue
        }
        const { sx, sy } = tileToScreen(a.x, a.y)
        const drift = b.isThought ? (THOUGHT_DRIFT_PX * (nowMs - b.bornMs)) / (b.dieMs - b.bornMs) : 0
        b.node.scale.set(inv) // the bubble is the reader's size, not the camera's
        b.node.position.set(sx, sy - CHAR_TARGET_PX - 18 - drift)
        // audit M8: a tag and a bubble used to composite into an unreadable pile
        const w = b.node.width, h = b.node.height
        boxes.push({ x: b.node.position.x - w / 2, y: b.node.position.y - h, w, h })
      }
      scene.tags.setOccupied(boxes)
    },
    destroy: () => {
      for (const b of bubbles) b.node.destroy({ children: true })
      bubbles.length = 0
    },
  }
}

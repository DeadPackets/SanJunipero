import { Container, Graphics } from 'pixi.js'
import { WORLD_TEXT_LINE_H } from '../textFloor.js'
import type { LayerSet } from './layers.js'
import { createWorldLabel } from './worldLabel.js'
// the tag's material is the SPEECH material, taken from its owner rather than through
// bubbles.ts — bubbles.ts now needs `placeTag` from here, and an alias is not worth a cycle
import {
  SPEECH_FILL as BUBBLE_FILL,
  SPEECH_INK as BUBBLE_INK,
  faceFor,
  worldTextScale,
} from './textFaces.js'

export const TAG_FONT_PX = faceFor('label').size
export const TAG_LINE_H = Math.max(WORLD_TEXT_LINE_H, TAG_FONT_PX + 2)
export const TAG_PAD_X = 5
export const TAG_PAD_Y = 3
export const TAG_MAX_CHARS = 48

/** Gap between the thing and its label; keep-out from the viewport edge; and how far a label
 *  moves to get clear of something already occupying its place. */
export const TAG_GAP_PX = 6,
  EDGE_PAD_PX = 8,
  STACK_STEP_PX = 4
export const MAX_STACK_STEPS = 3

/** Where a label points. `sy` is the anchor's BASE and `topY` the top of what is DRAWN. */
export type Anchor = { sx: number; sy: number; halfW: number; topY: number }
export type Rect = { x: number; y: number; w: number; h: number }
export type Placed = { sx: number; sy: number; side: 'above' | 'below' | 'left' | 'right' }

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

const clamp = (v: number, lo: number, hi: number): number =>
  lo > hi ? lo : Math.min(Math.max(v, lo), hi)

/** The one placement rule: above-centre, else below, else to a side, clamped into the view and
 *  stepped clear of anything already there. */
export function placeTag(
  a: Anchor,
  size: { w: number; h: number },
  view: Rect,
  occupied: readonly Rect[] = [],
): Placed {
  const fits = (r: Rect): boolean =>
    r.x >= view.x + EDGE_PAD_PX &&
    r.x + r.w <= view.x + view.w - EDGE_PAD_PX &&
    r.y >= view.y + EDGE_PAD_PX &&
    r.y + r.h <= view.y + view.h - EDGE_PAD_PX

  const candidates: { side: Placed['side']; rect: Rect }[] = [
    {
      side: 'above',
      rect: { x: a.sx - size.w / 2, y: a.topY - TAG_GAP_PX - size.h, w: size.w, h: size.h },
    },
    { side: 'below', rect: { x: a.sx - size.w / 2, y: a.sy + TAG_GAP_PX, w: size.w, h: size.h } },
    {
      side: 'right',
      rect: { x: a.sx + a.halfW + TAG_GAP_PX, y: a.sy - size.h / 2, w: size.w, h: size.h },
    },
    {
      side: 'left',
      rect: { x: a.sx - a.halfW - TAG_GAP_PX - size.w, y: a.sy - size.h / 2, w: size.w, h: size.h },
    },
  ]
  const chosen = candidates.find((c) => fits(c.rect)) ?? candidates[0]!
  const rect = { ...chosen.rect }

  // stay inside the view whatever the anchor is doing
  rect.x = clamp(rect.x, view.x + EDGE_PAD_PX, view.x + view.w - EDGE_PAD_PX - size.w)
  rect.y = clamp(rect.y, view.y + EDGE_PAD_PX, view.y + view.h - EDGE_PAD_PX - size.h)

  // and clear of anything already there. Each step moves past the deepest overlap plus one
  // separation, so one step clears one box — a rule that always terminates.
  const away = chosen.side === 'below' ? 1 : -1
  for (let step = 0; step < MAX_STACK_STEPS; step++) {
    const hit = occupied.filter((o) => overlaps(rect, o))
    if (hit.length === 0) break
    const depth = Math.max(
      ...hit.map((o) => (away > 0 ? o.y + o.h - rect.y : rect.y + rect.h - o.y)),
    )
    rect.y += away * (depth + STACK_STEP_PX)
    rect.y = clamp(rect.y, view.y + EDGE_PAD_PX, view.y + view.h - EDGE_PAD_PX - size.h)
  }
  return { sx: rect.x + size.w / 2, sy: rect.y, side: chosen.side }
}

/** The anchor for a sprite, from its DRAWN bounds — a sprite's `y` is already its base, so
 *  subtracting the full height gives the top rather than the middle. */
export function anchorForSprite(
  sprite: { x: number; y: number },
  bounds: { width: number; height: number },
): Anchor {
  return { sx: sprite.x, sy: sprite.y, halfW: bounds.width / 2, topY: sprite.y - bounds.height }
}

// ── the one owner ────────────────────────────────────────────────────────────────────────

/** Three things may want a label. Only one of each, and never a stale one. */
export type TagOwner = 'hover' | 'door' | 'selection'

export type TooltipLayer = {
  show(owner: TagOwner, text: string, a: Anchor): void
  hide(owner: TagOwner): void
  hideAll(): void
  /** boxes a label must not composite onto — speech bubbles register theirs here */
  setOccupied(boxes: readonly Rect[]): void
  /** the live label boxes, in draw order. The layer's own bookkeeping, exposed because the
   *  next label placed has to avoid them. */
  boxes(): { owner: TagOwner; rect: Rect }[]
  destroy(): void
}

type Tag = {
  node: Container
  slab: Graphics
  label: ReturnType<typeof createWorldLabel>
  box: Rect | null
}

function makeTag(parent: Container): Tag {
  const node = new Container()
  node.visible = false
  node.eventMode = 'none' // a label must never eat the click on the thing it names
  const slab = new Graphics()
  const label = createWorldLabel('', {
    fontFamily: faceFor('label').family,
    fontSize: TAG_FONT_PX,
    fill: BUBBLE_INK,
    lineHeight: TAG_LINE_H,
  })
  label.anchor.set(0.5, 0)
  node.addChild(slab, label)
  parent.addChild(node)
  return { node, slab, label, box: null }
}

export function createTooltipLayer(
  layers: LayerSet,
  view: () => Rect,
  zoom: () => number = () => 1,
): TooltipLayer {
  const tags = new Map<TagOwner, Tag>()
  let occupied: readonly Rect[] = []

  const tagFor = (owner: TagOwner): Tag => {
    let t = tags.get(owner)
    if (t === undefined) {
      t = makeTag(layers.worldText)
      tags.set(owner, t)
    }
    return t
  }

  return {
    show(owner, text, a) {
      const t = tagFor(owner)
      if (text.length === 0) {
        t.node.visible = false
        t.box = null
        return
      }
      const next = text.length > TAG_MAX_CHARS ? `${text.slice(0, TAG_MAX_CHARS - 1)}…` : text
      if (t.label.text !== next) {
        t.label.text = next
        t.slab.clear()
        t.slab.roundRect(
          -t.label.width / 2 - TAG_PAD_X,
          -TAG_PAD_Y,
          t.label.width + TAG_PAD_X * 2,
          t.label.height + TAG_PAD_Y * 2,
          2,
        )
        t.slab.fill(BUBBLE_FILL)
        t.slab.stroke({ width: 1, color: BUBBLE_INK })
      }
      // A tag is the reader's size at every stop; the camera only changes its world footprint,
      // which is the number the de-confliction below has to reason about.
      const inv = worldTextScale(zoom())
      t.node.scale.set(inv)
      const size = {
        w: (t.label.width + TAG_PAD_X * 2) * inv,
        h: (t.label.height + TAG_PAD_Y * 2) * inv,
      }
      // every OTHER live tag is something this one must not land on
      const taken = [
        ...occupied,
        ...[...tags]
          .filter(([o]) => o !== owner)
          .map(([, x]) => x.box)
          .filter((b): b is Rect => b !== null),
      ]
      const at = placeTag(a, size, view(), taken)
      t.node.position.set(Math.round(at.sx), Math.round(at.sy + TAG_PAD_Y * inv))
      t.node.visible = true
      t.box = { x: at.sx - size.w / 2, y: at.sy, w: size.w, h: size.h }
    },
    hide(owner) {
      const t = tags.get(owner)
      if (t === undefined) return
      t.node.visible = false
      t.box = null
    },
    hideAll() {
      for (const t of tags.values()) {
        t.node.visible = false
        t.box = null
      }
    },
    setOccupied(boxes) {
      occupied = boxes
    },
    boxes: () =>
      [...tags].filter(([, t]) => t.box !== null).map(([owner, t]) => ({ owner, rect: t.box! })),
    destroy() {
      for (const t of tags.values()) t.node.destroy({ children: true })
      tags.clear()
    },
  }
}

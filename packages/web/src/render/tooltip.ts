import type { LayerSet } from './layers.js'
import { createPlate, type Plate } from './plate.js'
import type { PlateRow } from '../ui/plateModel.js'
import { worldTextScale } from './textFaces.js'

/** Gap between the thing and its label; keep-out from the viewport edge; and how far a label
 *  moves to get clear of something already occupying its place. */
export const TAG_GAP_PX = 6,
  EDGE_PAD_PX = 8,
  STACK_STEP_PX = 4
/** Six, not three: a bubble grown to the whole sentence is 420 world px wide, so far more of
 *  them collide than when a box stopped at 210. A plate pushed past the sixth is off its own
 *  speaker anyway and `onLeash` hides it, which beats compositing two of them. */
export const MAX_STACK_STEPS = 6

/** Where a label points. `sy` is the anchor's BASE and `topY` the top of what is DRAWN.
 *  `prefer` is which side is tried FIRST: a footprint plate is welded to the ground point, so
 *  it asks for `below` and only leaves the footprint when the view has no room for it. */
export type Anchor = {
  sx: number
  sy: number
  halfW: number
  topY: number
  prefer?: 'above' | 'below'
}
export type Rect = { x: number; y: number; w: number; h: number }
export type Placed = { sx: number; sy: number; side: 'above' | 'below' | 'left' | 'right' }

export const overlaps = (a: Rect, b: Rect): boolean =>
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
  // The preferred side goes first; the rest keep their order, so the fallback ladder is one rule.
  if (a.prefer === 'below') candidates.unshift(candidates.splice(1, 1)[0]!)
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
type TagOwner = 'hover' | 'door' | 'selection'

/** Who else is holding screen space a label must keep off. `plate` is DOM over the canvas,
 *  so nothing on the canvas can see it without being told. */
type LabelOwner = 'bubbles' | 'plate' | 'toponyms' | 'acts'

export type TooltipLayer = {
  show(owner: TagOwner, rows: readonly PlateRow[], a: Anchor): void
  hide(owner: TagOwner): void
  hideAll(): void
  /** ONE occupancy, keyed by who owns the boxes. Everybody writes theirs; everybody reads
   *  everybody else's, so no two labels can composite. Boxes are in view coordinates. */
  setOccupied(owner: LabelOwner, boxes: readonly Rect[]): void
  occupied(except?: LabelOwner): Rect[]
  /** the live label boxes, in draw order. The layer's own bookkeeping, exposed because the
   *  next label placed has to avoid them. */
  boxes(): { owner: TagOwner; rect: Rect }[]
  destroy(): void
}

type Tag = { plate: Plate; box: Rect | null }

export function createTooltipLayer(
  layers: LayerSet,
  view: () => Rect,
  zoom: () => number = () => 1,
): TooltipLayer {
  const tags = new Map<TagOwner, Tag>()
  const occupied = new Map<LabelOwner, readonly Rect[]>()
  const occupiedBoxes = (except?: LabelOwner): Rect[] =>
    [...occupied].filter(([o]) => o !== except).flatMap(([, boxes]) => boxes)

  const tagFor = (owner: TagOwner): Tag => {
    let t = tags.get(owner)
    if (t === undefined) {
      t = { plate: createPlate(layers.worldText), box: null }
      tags.set(owner, t)
    }
    return t
  }

  return {
    show(owner, rows, a) {
      const t = tagFor(owner)
      if (rows.length === 0) {
        t.plate.node.visible = false
        t.box = null
        return
      }
      t.plate.setRows(rows)
      // A plate is the reader's size at every stop; the camera only changes its world footprint,
      // which is the number the de-confliction below has to reason about.
      const inv = worldTextScale(zoom())
      t.plate.node.scale.set(inv)
      const size = { w: t.plate.w * inv, h: t.plate.h * inv }
      // every OTHER live tag is something this one must not land on
      const taken = [
        ...occupiedBoxes(),
        ...[...tags]
          .filter(([o]) => o !== owner)
          .map(([, x]) => x.box)
          .filter((b): b is Rect => b !== null),
      ]
      const at = placeTag({ ...a, prefer: 'below' }, size, view(), taken)
      t.plate.node.position.set(Math.round(at.sx - size.w / 2), Math.round(at.sy))
      t.plate.node.visible = true
      t.box = { x: at.sx - size.w / 2, y: at.sy, w: size.w, h: size.h }
    },
    hide(owner) {
      const t = tags.get(owner)
      if (t === undefined) return
      t.plate.node.visible = false
      t.box = null
    },
    hideAll() {
      for (const t of tags.values()) {
        t.plate.node.visible = false
        t.box = null
      }
    },
    setOccupied(owner, boxes) {
      occupied.set(owner, boxes)
    },
    occupied: occupiedBoxes,
    boxes: () =>
      [...tags].filter(([, t]) => t.box !== null).map(([owner, t]) => ({ owner, rect: t.box! })),
    destroy() {
      for (const t of tags.values()) t.plate.destroy()
      tags.clear()
    },
  }
}

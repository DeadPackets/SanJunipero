import type { TerrainTileKind } from '@sj/shared'
// type-only: the lens set is the route's, and there must not be a second copy of it here
import type { Lens } from '../ui/route.js'
import type { CameraBounds } from './camera.js'
import type { ViewRect } from './cull.js'
import { TILE_H, TILE_W, screenToTile, tileToScreen } from './iso.js'
import { GROUND_FALLBACK_COLOR, TILE_COLORS } from './ground.js'
import { tileKind } from './tileset.js'

// Three laws: no fixed map size anywhere — the WIDGET is fixed and a bigger town changes only
// `scale`; not one pixel of the ground bake — the map samples the TERRAIN ARRAY into its own
// raster, so it cannot make the single-texture wall worse; and nothing per frame — no ticker.

/** The widget, in CSS px. FIXED: the chrome must not move when the town grows. */
export const MINIMAP_W = 208
export const MINIMAP_H = 112

/** How world-screen space is laid on the widget. `scale` is the one field the town moves: its
 *  box is aspect-fitted and CENTRED, so `ox`/`oy` are the letterbox. */
export type MinimapFit = {
  /** the canvas, always `MINIMAP_W x MINIMAP_H` */
  w: number
  h: number
  /** map px per world-screen px */
  scale: number
  /** the world-screen point drawn at map (`ox`, `oy`) */
  x0: number
  y0: number
  ox: number
  oy: number
  /** the town's own box inside the canvas */
  mw: number
  mh: number
}

export function minimapFit(b: CameraBounds, w = MINIMAP_W, h = MINIMAP_H): MinimapFit {
  const bw = Math.max(1, b.maxX - b.minX)
  const bh = Math.max(1, b.maxY - b.minY)
  const scale = Math.min(w / bw, h / bh)
  const mw = bw * scale,
    mh = bh * scale
  return { w, h, scale, x0: b.minX, y0: b.minY, ox: (w - mw) / 2, oy: (h - mh) / 2, mw, mh }
}

/** EXACT, both ways. A map that rounds on the way in cannot be clicked on the way out. */
export function worldToMap(sx: number, sy: number, f: MinimapFit): { mx: number; my: number } {
  return { mx: (sx - f.x0) * f.scale + f.ox, my: (sy - f.y0) * f.scale + f.oy }
}

export function mapToWorld(mx: number, my: number, f: MinimapFit): { sx: number; sy: number } {
  return { sx: (mx - f.ox) / f.scale + f.x0, sy: (my - f.oy) / f.scale + f.y0 }
}

// ── the picture ───────────────────────────────────────────────────────────────────────────

/**
 * One map pixel can cover several tiles, and the two features that make a settlement readable
 * from above — the street lattice and the channel — are ONE TILE WIDE, so a shared pixel is
 * resolved by PRIORITY and not by area. Water outranks road because redundancy loses: a lattice
 * that loses a crossing is still a lattice, a channel that loses one is two channels.
 */
export const MAP_KIND_PRIORITY: readonly TerrainTileKind[] = [
  'water',
  'road',
  'farmland',
  'forest',
  'rock',
  'sand',
  'earth',
  'grass',
]

const RANK = new Map<TerrainTileKind, number>(MAP_KIND_PRIORITY.map((k, i) => [k, i]))
const WEAKEST = MAP_KIND_PRIORITY.length

/** A building is a MARK, not a material: the town's own line colour over the ground it stands
 *  on, so the built extent reads as one shape at any scale. `--ink`. */
export const MINIMAP_BUILT = 0x43394a

function put(px: Uint8ClampedArray, rank: Uint8Array, i: number, color: number, r: number): void {
  if (rank[i]! <= r) return
  rank[i] = r
  px[i * 4] = (color >> 16) & 0xff
  px[i * 4 + 1] = (color >> 8) & 0xff
  px[i * 4 + 2] = color & 0xff
  px[i * 4 + 3] = 255
}

/**
 * The whole map, as RGBA, transparent where the world is not. TWO PASSES: forward over the
 * tiles, so no feature is ever thinner than the sample that looks for it, then backward over
 * the pixels the forward pass did not reach — which is every pixel when the map is finer than
 * the town. Then the buildings, which outrank every ground.
 */
export function minimapPixels(
  terrain: readonly (readonly number[])[],
  structures: readonly { x: number; y: number; w: number; h: number }[],
  f: MinimapFit,
): Uint8ClampedArray<ArrayBuffer> {
  const px = new Uint8ClampedArray(f.w * f.h * 4)
  const rank = new Uint8Array(f.w * f.h).fill(WEAKEST + 1)

  for (let y = 0; y < terrain.length; y++) {
    const row = terrain[y]!
    for (let x = 0; x < row.length; x++) {
      const id = row[x]!
      const s = tileToScreen(x, y)
      const p = worldToMap(s.sx, s.sy + TILE_H / 2, f)
      const mx = Math.floor(p.mx),
        my = Math.floor(p.my)
      if (mx < 0 || my < 0 || mx >= f.w || my >= f.h) continue
      put(
        px,
        rank,
        my * f.w + mx,
        TILE_COLORS[id as 0] ?? GROUND_FALLBACK_COLOR,
        RANK.get(tileKind(id)) ?? WEAKEST,
      )
    }
  }

  for (let my = 0; my < f.h; my++) {
    for (let mx = 0; mx < f.w; mx++) {
      const i = my * f.w + mx
      if (rank[i]! <= WEAKEST) continue
      const p = mapToWorld(mx + 0.5, my + 0.5, f)
      const t = screenToTile(p.sx, p.sy)
      const id = terrain[t.y]?.[t.x]
      if (id === undefined) continue
      put(
        px,
        rank,
        i,
        TILE_COLORS[id as 0] ?? GROUND_FALLBACK_COLOR,
        RANK.get(tileKind(id)) ?? WEAKEST,
      )
    }
  }

  for (const s of structures) {
    const cx = s.x + s.w / 2 - 0.5,
      cy = s.y + s.h / 2 - 0.5
    const c = worldToMap((cx - cy) * (TILE_W / 2), (cx + cy) * (TILE_H / 2), f)
    const rw = Math.max(1, Math.round((s.w + s.h) * (TILE_W / 2) * f.scale))
    const rh = Math.max(1, Math.round((s.w + s.h) * (TILE_H / 2) * f.scale))
    for (let dy = 0; dy < rh; dy++) {
      const my = Math.floor(c.my - rh / 2) + dy
      if (my < 0 || my >= f.h) continue
      for (let dx = 0; dx < rw; dx++) {
        const mx = Math.floor(c.mx - rw / 2) + dx
        if (mx < 0 || mx >= f.w) continue
        put(px, rank, my * f.w + mx, MINIMAP_BUILT, 0)
      }
    }
  }
  return px
}

// ── where the camera is ───────────────────────────────────────────────────────────────────

/** Below this a rectangle is a dot that says nothing. At 4x on a ten-ring town the true view is
 *  5.5 px across, so this floor is load-bearing rather than defensive. */
export const VIEW_MIN_PX = 10

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** The camera's rectangle on the map: grown to a size a viewer can see, shifted back inside the
 *  widget, then cut to the canvas — in that order, so it keeps the view's own CENTRE. */
export function minimapViewBox(
  view: ViewRect,
  f: MinimapFit,
): { x: number; y: number; w: number; h: number } {
  const a = worldToMap(view.x, view.y, f)
  let w = Math.min(f.w, Math.max(VIEW_MIN_PX, view.w * f.scale))
  let h = Math.min(f.h, Math.max(VIEW_MIN_PX, view.h * f.scale))
  const cx = a.mx + (view.w * f.scale) / 2,
    cy = a.my + (view.h * f.scale) / 2
  const x = clamp(cx - w / 2, 0, Math.max(0, f.w - w))
  const y = clamp(cy - h / 2, 0, Math.max(0, f.h - h))
  if (x + w > f.w) w = f.w - x
  if (y + h > f.h) h = f.h - y
  return { x, y, w, h }
}

/** A minimap is for a town you cannot see all of; when the view holds the whole of it, the map
 *  leaves. The question is asked of the TOWN'S box, never the canvas, which carries a
 *  letterbox. */
export const IDLE_SLOP_PX = 1

export function viewHoldsTown(view: ViewRect, f: MinimapFit): boolean {
  const b = minimapViewBox(view, f),
    s = IDLE_SLOP_PX
  return (
    b.x <= f.ox + s &&
    b.y <= f.oy + s &&
    b.x + b.w >= f.ox + f.mw - s &&
    b.y + b.h >= f.oy + f.mh - s
  )
}

// ── going there ───────────────────────────────────────────────────────────────────────────

/** The world-screen point a press at (`mx`, `my`) means. A press in the letterbox is pulled onto
 *  the town rather than followed off the world. */
export function travelTargetAt(mx: number, my: number, f: MinimapFit): { sx: number; sy: number } {
  return mapToWorld(clamp(mx, f.ox, f.ox + f.mw), clamp(my, f.oy, f.oy + f.mh), f)
}

/** An arrow here moves the camera by a screenful less a tenth; the tenth keeps a landmark on
 *  both sides of the jump, so a viewer reads it as having MOVED rather than teleported. */
export const MINIMAP_PAGE = 0.9

export function pageTarget(view: ViewRect, dx: number, dy: number): { sx: number; sy: number } {
  return {
    sx: view.x + view.w / 2 + dx * view.w * MINIMAP_PAGE,
    sy: view.y + view.h / 2 + dy * view.h * MINIMAP_PAGE,
  }
}

export type MinimapAction = { kind: 'page'; dx: -1 | 0 | 1; dy: -1 | 0 | 1 } | { kind: 'whole' }

export function minimapActionFor(key: string): MinimapAction | null {
  switch (key) {
    case 'ArrowLeft':
      return { kind: 'page', dx: -1, dy: 0 }
    case 'ArrowRight':
      return { kind: 'page', dx: 1, dy: 0 }
    case 'ArrowUp':
      return { kind: 'page', dx: 0, dy: -1 }
    case 'ArrowDown':
      return { kind: 'page', dx: 0, dy: 1 }
    case 'Home':
      return { kind: 'whole' }
    default:
      return null
  }
}

// ── people ────────────────────────────────────────────────────────────────────────────────

export type PersonDot = { mx: number; my: number; focus: boolean }

/** What the map is handed about a person. `alive` and `insideId` are the two facts that decide
 *  whether the town is drawing them, and therefore whether the map should be. */
export type MapPerson = { id: string; x: number; y: number; alive?: boolean; insideId?: string }

/**
 * A dead agent is not removed from `state.agents`, only marked `alive: false`, so the map has
 * to ask. `characters.rendersOnMap` is the town's own answer to the same question and this must
 * not become a second one. The one deliberate departure: the person being WATCHED keeps her dot
 * indoors, because "where is she" must never be answered "nowhere".
 */
export function onMinimap(p: MapPerson, focusId: string | null): boolean {
  if (p.alive === false) return false
  return p.insideId === undefined || p.id === focusId
}

/** One dot per person, deduplicated to the map's own pixel grid, so the cost is bounded by the
 *  MAP and not by the population. The watched person is exempt from the dedup and drawn LAST. */
export function peopleDots(
  people: readonly MapPerson[],
  f: MinimapFit,
  focusId: string | null,
): PersonDot[] {
  const seen = new Set<number>()
  const out: PersonDot[] = []
  let her: PersonDot | null = null
  for (const p of people) {
    if (!onMinimap(p, focusId)) continue
    const s = tileToScreen(p.x, p.y)
    const m = worldToMap(s.sx, s.sy, f)
    const mx = Math.round(m.mx),
      my = Math.round(m.my)
    if (p.id === focusId) {
      her = { mx, my, focus: true }
      continue
    }
    if (mx < 0 || my < 0 || mx >= f.w || my >= f.h) continue
    const key = my * f.w + mx
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ mx, my, focus: false })
  }
  if (her !== null) out.push(her)
  return out
}

// ── the display list ──────────────────────────────────────────────────────────────────────

/** No single colour clears 3:1 over every ground the raster can draw, so every mark is TWO
 *  TONE: a `--deep` halo carrying a light core. Opacity is not a contrast strategy. */
export const MARK_HALO = 0x241f2b // --deep
export const MARK_VIEW = 0xf2c879 // --honey: where the camera is
export const MARK_PERSON = 0xfff6e9 // --cream: somebody
export const MARK_WATCHED = 0xe8785a // --ember: the one you are following

/** Two tones are not always enough: on `forest` both `--ember` (1.95) and `--deep` (2.85) fall
 *  under 3:1, so the watched marker is THREE tones — deep halo, cream ring, ember core. */
export const MARK_GROUNDS: readonly number[] = [
  ...new Set([...Object.values(TILE_COLORS), GROUND_FALLBACK_COLOR, MINIMAP_BUILT]),
]
export const MARK_MIN_CONTRAST = 3

export const PERSON_PX = 2
export const WATCHED_PX = 5
export const WATCHED_RING_PX = 7

export type MapOp = { x: number; y: number; w: number; h: number; color: number }

function ring(
  out: MapOp[],
  x: number,
  y: number,
  w: number,
  h: number,
  t: number,
  color: number,
  f: MinimapFit,
): void {
  for (const r of [
    { x, y, w, h: t },
    { x, y: y + h - t, w, h: t },
    { x, y: y + t, w: t, h: h - 2 * t },
    { x: x + w - t, y: y + t, w: t, h: h - 2 * t },
  ]) {
    const x0 = clamp(r.x, 0, f.w),
      y0 = clamp(r.y, 0, f.h)
    const x1 = clamp(r.x + r.w, 0, f.w),
      y1 = clamp(r.y + r.h, 0, f.h)
    if (x1 - x0 <= 0 || y1 - y0 <= 0) continue
    out.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, color })
  }
}

function blob(
  out: MapOp[],
  mx: number,
  my: number,
  size: number,
  color: number,
  f: MinimapFit,
): void {
  const x0 = clamp(mx - size / 2, 0, f.w),
    y0 = clamp(my - size / 2, 0, f.h)
  const x1 = clamp(mx + size / 2, 0, f.w),
    y1 = clamp(my + size / 2, 0, f.h)
  if (x1 - x0 <= 0 || y1 - y0 <= 0) return
  out.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, color })
}

/** The rectangle follows the camera and changes on a FRAME; people walk on a TICK. One list for
 *  both would make the per-frame cost O(people) just to redraw eight rectangles. */
export function viewOps(view: ViewRect, f: MinimapFit): MapOp[] {
  const out: MapOp[] = []
  const b = minimapViewBox(view, f)
  ring(out, b.x - 1, b.y - 1, b.w + 2, b.h + 2, 1, MARK_HALO, f)
  ring(out, b.x, b.y, b.w, b.h, 1, MARK_VIEW, f)
  return out
}

export function dotOps(dots: readonly PersonDot[], f: MinimapFit): MapOp[] {
  const out: MapOp[] = []
  for (const d of dots) {
    if (d.focus) {
      blob(out, d.mx, d.my, WATCHED_RING_PX + 2, MARK_HALO, f)
      blob(out, d.mx, d.my, WATCHED_RING_PX, MARK_PERSON, f)
      blob(out, d.mx, d.my, WATCHED_PX, MARK_WATCHED, f)
      continue
    }
    blob(out, d.mx, d.my, PERSON_PX + 2, MARK_HALO, f)
    blob(out, d.mx, d.my, PERSON_PX, MARK_PERSON, f)
  }
  return out
}

/** Both halves, for the tests that count the whole frame. */
export function overlayOps(view: ViewRect, dots: readonly PersonDot[], f: MinimapFit): MapOp[] {
  return [...viewOps(view, f), ...dotOps(dots, f)]
}

// ── getting out of the way ────────────────────────────────────────────────────────────────

/** The map is not there whenever another surface already owns the stage: the society graph
 *  replaces the canvas, and the film strip, the moment player and the timeline take the bottom
 *  band the map lives in. */
export const MINIMAP_ON_LENS: Readonly<Record<Lens, boolean>> = {
  map: true, // the map's own lens
  inspector: true, // a right-hand slide-over; the bottom-left corner stays free
  discoveries: true, // the same slide-over, the same free corner — measured, not assumed
  laws: true, // the same again
  society: false, // the graph REPLACES the canvas: a map of a town nobody is drawing
  director: false, // the film strip and the moment player take the bottom band
  chronicle: false, // the timeline takes it too
}

/** The lenses that get a map, for a reader rather than a compiler. Derived, never transcribed:
 *  a list beside the table is a second place for a lens to go missing. */
export const MINIMAP_LENSES: readonly Lens[] = (Object.keys(MINIMAP_ON_LENS) as Lens[]).filter(
  (l) => MINIMAP_ON_LENS[l],
)

export function minimapShown(lens: Lens, insideId: string | null, hidden: boolean): boolean {
  return !hidden && insideId === null && MINIMAP_ON_LENS[lens]
}

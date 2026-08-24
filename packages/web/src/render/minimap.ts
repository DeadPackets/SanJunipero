import type { TerrainTileKind } from '@sj/shared'
// type-only: the lens set is the route's, and there must not be a second copy of it here
import type { Lens } from '../ui/route.js'
import type { CameraBounds } from './camera.js'
import type { ViewRect } from './cull.js'
import { TILE_H, TILE_W, screenToTile, tileToScreen } from './iso.js'
import { GROUND_FALLBACK_COLOR, TILE_COLORS } from './ground.js'
import { tileKind } from './tileset.js'

// ★ THE MINIMAP — THE ONE INSTRUMENT A STREAMED TOWN CANNOT DO WITHOUT.
//
// At 4x a viewer sees 5 % of a three-ring town, and the ring grammar keeps platting outward as
// agents claim plots. Camera controls without a map are a steering wheel with the windscreen
// painted over: a viewer can go anywhere and can never know where they are or what they are
// missing. This module is the whole of the map's thinking; `MinimapView.tsx` executes a display
// list and owns no decision (P6).
//
// ── THE THREE LAWS THIS FILE IS WRITTEN TO ────────────────────────────────────────────────
//
// 1. NO FIXED MAP SIZE, ANYWHERE. The town has no size anybody wrote down. What is fixed is the
//    WIDGET — `MINIMAP_W x MINIMAP_H` of chrome — and the only thing a bigger town changes is
//    `scale`. A ten-ring town and a one-ring town cost the same raster and occupy the same box.
//
// 2. NOT ONE PIXEL OF THE GROUND BAKE. The bake is whole-map and already past single-texture
//    limits at ten rings (`scene.ts:30`, the C11 §9 supersession point). The map is sampled from
//    the TERRAIN ARRAY into its own fixed raster, so nothing here can make that wall worse.
//
// 3. NOTHING PER FRAME. There is no ticker callback. The raster is rebuilt when the ground or
//    the built extent changes; the display list is rebuilt when the camera moves. A camera at
//    rest costs the minimap exactly nothing.

/** The widget, in CSS px. FIXED: the chrome must not move when the town grows. */
export const MINIMAP_W = 208
export const MINIMAP_H = 112

/**
 * How world-screen space is laid on the widget.
 *
 * `scale` is the one field the town moves. The town's box is aspect-fitted and CENTRED, so
 * `ox`/`oy` are the letterbox — a canvas of constant size with the settlement drawn true.
 */
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
  const mw = bw * scale, mh = bh * scale
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
 * ★ WHICH KIND WINS A PIXEL THAT HOLDS SEVERAL.
 *
 * At ten rings one map pixel covers about four tiles each way, and the two features that make a
 * settlement readable from above — the street lattice and the channel — are ONE TILE WIDE. A
 * raster that samples the middle of each pixel therefore draws them as dashes, or not at all:
 * a road survives 1 sample in 19. So the raster resolves a shared pixel by PRIORITY, not by
 * area, and the thin things are at the top of the list. A street reads a little thicker than it
 * is; that is the correct lie for a map, and losing the grid is not.
 *
 * ★ AND WATER OUTRANKS ROAD, which took a measurement to settle. Twenty-one streets cross the
 * channel in a ten-ring town, and whichever loses those pixels is cut there. A LATTICE that
 * loses a crossing is still a lattice — every street reaches every other street another way. A
 * CHANNEL that loses a crossing is two channels. So the rule is not "thinner wins", it is
 * REDUNDANCY LOSES: the feature with no second path through it takes the shared pixel.
 */
export const MAP_KIND_PRIORITY: readonly TerrainTileKind[] = [
  'water', 'road', 'farmland', 'forest', 'rock', 'sand', 'earth', 'grass',
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
 * The whole map, as RGBA. Transparent where the world is not — the widget's own ground shows
 * through, and the settlement reads as a shape rather than as a rectangle.
 *
 * TWO PASSES, and each covers what the other cannot:
 *  · FORWARD over the tiles, so no feature is ever thinner than the sample that looks for it.
 *    This is the pass that keeps the street grid.
 *  · BACKWARD over the pixels the forward pass did not reach, which is every pixel when the map
 *    is finer than the town — a one-ring settlement is 3249 tiles over 23 296 pixels.
 * Then the buildings, which outrank every ground.
 *
 * Cost is `O(tiles + pixels)`, and the pixel half never moves. Both are paid on a ground change,
 * never on a frame, and the ground bake on the same trigger tessellates every one of those tiles
 * into a render texture — so this is strictly the cheaper half of what already happens.
 */
export function minimapPixels(
  terrain: readonly (readonly number[])[],
  structures: ReadonlyArray<{ x: number; y: number; w: number; h: number }>,
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
      const mx = Math.floor(p.mx), my = Math.floor(p.my)
      if (mx < 0 || my < 0 || mx >= f.w || my >= f.h) continue
      put(px, rank, my * f.w + mx, TILE_COLORS[id as 0] ?? GROUND_FALLBACK_COLOR,
        RANK.get(tileKind(id)) ?? WEAKEST)
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
      put(px, rank, i, TILE_COLORS[id as 0] ?? GROUND_FALLBACK_COLOR, RANK.get(tileKind(id)) ?? WEAKEST)
    }
  }

  for (const s of structures) {
    const cx = s.x + s.w / 2 - 0.5, cy = s.y + s.h / 2 - 0.5
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

/**
 * The camera's rectangle, on the map. Grown to a size a viewer can see, shifted back inside the
 * widget if that pushed it out, and finally cut to the canvas — in that order, so the rectangle
 * keeps the view's own CENTRE wherever it possibly can. A rectangle that lies about where the
 * camera is would be worse than no rectangle.
 */
export function minimapViewBox(
  view: ViewRect, f: MinimapFit,
): { x: number; y: number; w: number; h: number } {
  const a = worldToMap(view.x, view.y, f)
  let w = Math.min(f.w, Math.max(VIEW_MIN_PX, view.w * f.scale))
  let h = Math.min(f.h, Math.max(VIEW_MIN_PX, view.h * f.scale))
  const cx = a.mx + (view.w * f.scale) / 2, cy = a.my + (view.h * f.scale) / 2
  let x = clamp(cx - w / 2, 0, Math.max(0, f.w - w))
  let y = clamp(cy - h / 2, 0, Math.max(0, f.h - h))
  if (x + w > f.w) w = f.w - x
  if (y + h > f.h) h = f.h - y
  return { x, y, w, h }
}

/**
 * ★ THE VIEW ALREADY HOLDS THE WHOLE TOWN, SO THE MAP HAS NOTHING TO SAY.
 *
 * WHAT THE FOREGROUNDED BROWSER CAUGHT, and no test here could have. At the 0.25 stop on the
 * showcase town the settlement is 370 x 190 px in the middle of the stage — and the minimap sat
 * in the corner showing THE SAME PICTURE, smaller and with less in it, under a rectangle that
 * covered the whole map because the camera really was seeing everything. A second, worse copy of
 * the image behind it. Every per-element law passed; the composition was the defect. That is the
 * same shape as the camera lane's legend covering the map it explained.
 *
 * A minimap is for a town you cannot see all of. When you can, it leaves — the same judgement
 * `landmarkAlpha` makes about a place name at a scale where the place is a shape.
 *
 * The question is asked of the TOWN'S box, not of the canvas: the canvas carries a letterbox,
 * and a view that covers the settlement exactly is a view that holds the settlement — which is
 * precisely what "The whole town" gives you. There is no boundary a resting camera can flicker
 * across, because the zoom stops either side of it are a factor of two apart.
 */
export const IDLE_SLOP_PX = 1

export function viewHoldsTown(view: ViewRect, f: MinimapFit): boolean {
  const b = minimapViewBox(view, f), s = IDLE_SLOP_PX
  return b.x <= f.ox + s && b.y <= f.oy + s
    && b.x + b.w >= f.ox + f.mw - s && b.y + b.h >= f.oy + f.mh - s
}

// ── going there ───────────────────────────────────────────────────────────────────────────

/** The world-screen point a press at (`mx`, `my`) means. A press in the letterbox is pulled onto
 *  the town rather than followed off the world. */
export function travelTargetAt(mx: number, my: number, f: MinimapFit): { sx: number; sy: number } {
  return mapToWorld(clamp(mx, f.ox, f.ox + f.mw), clamp(my, f.oy, f.oy + f.mh), f)
}

/**
 * A KEYBOARD PRESS IS A PAGE, NOT A NUDGE. The stage's own arrows already pan by
 * `PAN_STEP_PX = 48`; a second control that did the same thing would not be travel. An arrow
 * here moves the camera by a screenful less a tenth — the tenth is what keeps a landmark on
 * both sides of the jump, so a viewer reads it as having MOVED rather than having been
 * teleported.
 */
export const MINIMAP_PAGE = 0.9

export function pageTarget(view: ViewRect, dx: number, dy: number): { sx: number; sy: number } {
  return {
    sx: view.x + view.w / 2 + dx * view.w * MINIMAP_PAGE,
    sy: view.y + view.h / 2 + dy * view.h * MINIMAP_PAGE,
  }
}

export type MinimapAction =
  | { kind: 'page'; dx: -1 | 0 | 1; dy: -1 | 0 | 1 }
  | { kind: 'whole' }

export function minimapActionFor(key: string): MinimapAction | null {
  switch (key) {
    case 'ArrowLeft': return { kind: 'page', dx: -1, dy: 0 }
    case 'ArrowRight': return { kind: 'page', dx: 1, dy: 0 }
    case 'ArrowUp': return { kind: 'page', dx: 0, dy: -1 }
    case 'ArrowDown': return { kind: 'page', dx: 0, dy: 1 }
    case 'Home': return { kind: 'whole' }
    default: return null
  }
}

// ── people ────────────────────────────────────────────────────────────────────────────────

export type PersonDot = { mx: number; my: number; focus: boolean }

/** What the map is handed about a person. `alive` and `insideId` are the two facts that decide
 *  whether the town is drawing them, and therefore whether the map should be. */
export type MapPerson = { id: string; x: number; y: number; alive?: boolean; insideId?: string }

/**
 * ★ WHO IS ON THE MAP — AND THE ONE THE BROWSER CAUGHT.
 *
 * A dead agent is not removed from `state.agents`; it is marked `alive: false` and the roster
 * counts it under "remembered". The first version of this map drew the dead as living dots, and
 * NO TEST COULD HAVE SEEN IT: every fixture here is `{ id, x, y }`, so the field that decides it
 * was not in the shape being tested. It took a dev world running to day 3 with all five founders
 * gone and five white dots still standing in the square.
 *
 * `characters.rendersOnMap` is the town's own answer to the same question, and this must not
 * become a second one — `minimap.test.ts` reads that file and asserts the two rules are the same
 * expression, because the map contradicting the town about who is standing in it would be worse
 * than either being wrong alone.
 *
 * THE ONE DEPARTURE, DELIBERATE: the person being WATCHED keeps her dot when she steps indoors.
 * The town stops drawing her because she is behind a wall; the map is being asked "where is
 * she", and "nowhere" is the one answer it must never give to that question.
 */
export function onMinimap(p: MapPerson, focusId: string | null): boolean {
  if (p.alive === false) return false
  return p.insideId === undefined || p.id === focusId
}

/**
 * ★ ONE DOT PER PERSON, DEDUPLICATED TO THE MAP'S OWN PIXEL GRID — and the answer to whether
 * that is noise.
 *
 * It is not, because the dedup changes what crowding MEANS. Two hundred people in the square
 * are not two hundred marks fighting over nine pixels; they are nine pixels of dot, which is a
 * viewer reading "the town is gathered at the well" — the single most useful thing a stream
 * watcher can learn from a glance. The cost is bounded by the MAP, not by the population.
 *
 * The person being watched is exempt from the dedup and drawn LAST, because "I am following her
 * and I want to find her" is the one question a dot per founder cannot answer if her dot is the
 * one that lost the pixel.
 */
export function peopleDots(
  people: ReadonlyArray<MapPerson>, f: MinimapFit, focusId: string | null,
): PersonDot[] {
  const seen = new Set<number>()
  const out: PersonDot[] = []
  let her: PersonDot | null = null
  for (const p of people) {
    if (!onMinimap(p, focusId)) continue
    const s = tileToScreen(p.x, p.y)
    const m = worldToMap(s.sx, s.sy, f)
    const mx = Math.round(m.mx), my = Math.round(m.my)
    if (p.id === focusId) { her = { mx, my, focus: true }; continue }
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

/**
 * ★ NO SINGLE COLOUR IS LEGIBLE ON THIS MAP, AND THAT IS MEASURED, NOT ASSUMED.
 *
 * The grounds a mark can land on run from `forest` #4F7040 to `sand` #E8D5BC and include the
 * ink of the buildings. `--ink` fails 3:1 on forest (1.84); `--cream` fails on sand (1.27);
 * `--ember` fails on farmland (1.32). The dual-band set is empty here for exactly the reason
 * the chrome's is — so every mark is TWO TONE: a `--deep` halo carrying a light core. Whatever
 * the ground, one of the two is against it. Opacity is not a contrast strategy.
 */
export const MARK_HALO = 0x241f2b     // --deep
export const MARK_VIEW = 0xf2c879     // --honey: where the camera is
export const MARK_PERSON = 0xfff6e9   // --cream: somebody
export const MARK_WATCHED = 0xe8785a  // --ember: the one you are following

/**
 * ★ AND TWO TONES ARE NOT ALWAYS ENOUGH — WHICH TOOK MEASURING, NOT ASSUMING.
 *
 * The halo/core pair works because whatever the ground is, one of the two is against it. That
 * holds for the rectangle (worst ground `forest`, 3.57 via the honey) and for an ordinary person
 * (worst ground `farmland`, 3.99 via the cream). It does NOT hold for the watched marker:
 * `--ember` on `forest` is 1.95 and `--deep` on `forest` is 2.85, so on a wooded tile BOTH tones
 * of the one mark a viewer is hunting for fall under 3:1. Nothing in the design predicted that;
 * the table did. So the watched marker is THREE tones — a `--deep` halo, a `--cream` ring, and
 * the ember core that carries its identity — and `minimap.test.ts` now asserts the whole rule
 * over every ground the raster can draw, so the next mark cannot be added without clearing it.
 */
export const MARK_GROUNDS: readonly number[] = [
  ...new Set([...Object.values(TILE_COLORS), GROUND_FALLBACK_COLOR, MINIMAP_BUILT]),
]
export const MARK_MIN_CONTRAST = 3

export const PERSON_PX = 2
export const WATCHED_PX = 5
export const WATCHED_RING_PX = 7

export type MapOp = { x: number; y: number; w: number; h: number; color: number }

function ring(out: MapOp[], x: number, y: number, w: number, h: number, t: number, color: number, f: MinimapFit): void {
  for (const r of [
    { x, y, w, h: t }, { x, y: y + h - t, w, h: t },
    { x, y: y + t, w: t, h: h - 2 * t }, { x: x + w - t, y: y + t, w: t, h: h - 2 * t },
  ]) {
    const x0 = clamp(r.x, 0, f.w), y0 = clamp(r.y, 0, f.h)
    const x1 = clamp(r.x + r.w, 0, f.w), y1 = clamp(r.y + r.h, 0, f.h)
    if (x1 - x0 <= 0 || y1 - y0 <= 0) continue
    out.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, color })
  }
}

function blob(out: MapOp[], mx: number, my: number, size: number, color: number, f: MinimapFit): void {
  const x0 = clamp(mx - size / 2, 0, f.w), y0 = clamp(my - size / 2, 0, f.h)
  const x1 = clamp(mx + size / 2, 0, f.w), y1 = clamp(my + size / 2, 0, f.h)
  if (x1 - x0 <= 0 || y1 - y0 <= 0) return
  out.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, color })
}

/**
 * THE TWO HALVES OF THE OVERLAY MOVE AT DIFFERENT RATES, SO THEY ARE BUILT SEPARATELY.
 *
 * The rectangle follows the camera and changes on a FRAME. People walk on a TICK, two and a
 * half seconds apart. Building one list for both would make the per-frame cost `O(people)` for
 * no reason — a town of two hundred would rebuild two hundred dots sixty times a second to
 * redraw eight rectangles. So a frame builds `viewOps` (always eight) and repaints the dot list
 * it already had.
 *
 * They are rectangles rather than canvas calls because the view must decide nothing (P6), and
 * because a list is a thing a test can count. That is how "what does a frame cost" is a
 * measurement here instead of a claim.
 */
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

/**
 * WHERE THE MAP BELONGS, AND WHERE IT DOES NOT.
 *
 * The camera lane's browser session caught the 0.25 stop making the place-name legend cover the
 * settlement it explains: every per-element law passed and the composition was ruined. A second
 * persistent overlay on the same screen answers that by NOT BEING THERE whenever another surface
 * already owns the stage — the society graph replaces the canvas, the film strip and the moment
 * player take the bottom band, the chronicle's timeline takes it too. And a map of the town is
 * not a thing a viewer standing inside a room needs.
 *
 * ★ AND IT IS A DECISION PER LENS, NOT A WHITELIST. This was `['map', 'inspector', 'laws']`, a
 * list written before the Discovery Record existed. `discoveries` arrived afterwards, was never
 * mentioned in this module or either of its test files, and therefore fell to "no map" — not
 * because anyone weighed it but because a whitelist's default is silence. It is the SAME
 * right-hand slide-over as `inspector`, which is on the list: the canvas keeps 1072 px, the
 * bottom band is free and the map lives bottom-LEFT, so the two coexist with no conflict at all.
 * Measured in a browser with both open, at every stop.
 *
 * A `Record<Lens, …>` cannot be written without an answer for every lens, so the next surface
 * somebody adds is a TYPE ERROR until it decides, and `everyLensDecides` below is the same
 * claim at runtime for anyone reading the list rather than compiling it.
 */
export const MINIMAP_ON_LENS: Readonly<Record<Lens, boolean>> = {
  map: true,           // the map's own lens
  inspector: true,     // a right-hand slide-over; the bottom-left corner stays free
  discoveries: true,   // the same slide-over, the same free corner — measured, not assumed
  laws: true,          // the same again
  society: false,      // the graph REPLACES the canvas: a map of a town nobody is drawing
  director: false,     // the film strip and the moment player take the bottom band
  chronicle: false,    // the timeline takes it too
}

/** The lenses that get a map, for a reader rather than a compiler. Derived, never transcribed:
 *  a list beside the table is a second place for a lens to go missing. */
export const MINIMAP_LENSES: readonly Lens[] =
  (Object.keys(MINIMAP_ON_LENS) as Lens[]).filter((l) => MINIMAP_ON_LENS[l])

export function minimapShown(lens: Lens, insideId: string | null, hidden: boolean): boolean {
  return !hidden && insideId === null && MINIMAP_ON_LENS[lens]
}

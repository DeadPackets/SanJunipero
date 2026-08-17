import { TILE_H, TILE_W, tileToScreen } from './iso.js'

// THE ROOM SHELL — WALLS, A BACK PLANE, A THRESHOLD (U4, plan task 66).
//
// THE COMPLAINT: interiors are "way too low quality, way too under detailed". The room was a
// flat cream diamond with a 2 px rim, one shaded far row and up to five sprites standing on
// it. There were NO WALLS — `interiors.ts` even carries a `placement: 'wall'` meta whose only
// effect was a 0 px offset, because there was nothing to hang anything on.
//
// A room is three planes, not one: the floor a body stands on and the two back walls a
// dimetric camera can see. This module is the geometry of all three, plus the two things that
// stop a plane reading as a coloured card — the courses that give a wall its grain and the
// pools of light that say where the light comes from. Pure functions and palette tokens only:
// no Pixi, no pixels, so every number here is measurable offline.

/** Every room is a 3×3 grid of slots (C13 CITY_INTERIOR_SLOTS). */
export const ROOM_SLOTS = 3
/** One slot is a 2×2 tile diamond. */
export const SLOT_TILES = 2

/** A room's walls rise three tile-heights behind the floor. One tile of HEIGHT is TILE_W px,
 *  the same convention the built form uses, so a wall and a building share one scale. */
export const WALL_H_TILES = 3
export const WALL_KINDS = ['back-left', 'back-right'] as const
export type WallKind = (typeof WALL_KINDS)[number]

/** Eye height: where a wall piece hangs, in tiles up the wall. */
export const WALL_MOUNT_H_TILES = 1.5

/** A course of the wall's own material, every half tile of height — the grain that stops a
 *  wall reading as a flat trapezoid at 3× zoom. */
export const WALL_COURSE_TILES = 0.5
/** The board at the foot of a wall, where it meets the floor. */
export const SKIRTING_TILES = 0.28
/** Floor boards run one tile apart, along the room's +x axis. */
export const FLOOR_BOARD_TILES = 1

export const DOORWAY_POOL_ALPHA = 0.18
export const HEARTH_POOL_ALPHA = 0.26
export const DOORWAY_POOL_R_TILES = 2.2
export const HEARTH_POOL_R_TILES = 1.8

/** The threshold plate, in tiles across. Matched to the exterior door sill so entering and
 *  leaving are visibly the same place. */
export const THRESHOLD_TILES = 1.6

/** How deep the walls' shade falls across the row of floor nearest them. */
export const FAR_ROW_SHADE_ALPHA = 0.22

/** Every colour the shell paints. All MASTER_PALETTE members, asserted as a set by the test.
 *  The two walls are a light and a shade of one material so the corner reads as a corner;
 *  the floor is a third step, so no two adjacent planes share a tone. */
export const ROOM_SHELL_PAINT = {
  floor: 0xf6e8d5,        // warm paper — the landed INTERIOR_FLOOR, kept
  floorSeam: 0xd4bc9e,    // board seams
  wallLit: 0xe8d5bc,      // back-right catches the light from the doorway
  wallShade: 0xb89d7e,    // back-left falls away
  wallCourse: 0x9c6b47,   // the grain of both walls
  skirting: 0x7e512b,     // the board where a wall meets the floor
  threshold: 0xf2c879,    // honey — the same tone the exterior door sill is drawn in
  hearthPool: 0xf2c879,   // firelight
  doorwayPool: 0xd6eaf2,  // daylight, coming in cold against the fire
} as const

/** --ink. Every silhouette rim in the room. */
export const ROOM_SHELL_INK = 0x43394a

export type Line4 = [number, number, number, number]

/** The floor diamond: the whole slot grid, as a closed polygon in room space. Origin is the
 *  far vertex, exactly where the room container is positioned. */
export function floorPolyOf(slots: number, slotTiles: number): number[] {
  const w = slots * slotTiles
  const c = [tileToScreen(0, 0), tileToScreen(w, 0), tileToScreen(w, w), tileToScreen(0, w)]
  return c.flatMap((p) => [p.sx, p.sy])
}

/** The centre of a slot, in room space. */
export function slotCentreScreen(x: number, y: number, slotTiles: number = SLOT_TILES): { sx: number; sy: number } {
  return tileToScreen((x + 0.5) * slotTiles, (y + 0.5) * slotTiles)
}

/** The base edge of a wall, from the far vertex outward. `back-right` runs along +x, which is
 *  the edge that goes down and to the RIGHT on screen; `back-left` runs along +y. */
function wallBase(kind: WallKind, slots: number, slotTiles: number): { sx: number; sy: number } {
  const w = slots * slotTiles
  return kind === 'back-right' ? tileToScreen(w, 0) : tileToScreen(0, w)
}

/**
 * The two back walls, as closed quads in room space: the base edge, then the same edge raised
 * by `wallH` tiles of height. The pair shares exactly one edge — the far vertical column at
 * the room's origin — which is what makes the corner a corner.
 */
export function wallPolys(slots: number, slotTiles: number, wallH: number): Record<WallKind, number[]> {
  const rise = wallH * TILE_W
  const out = {} as Record<WallKind, number[]>
  for (const kind of WALL_KINDS) {
    const e = wallBase(kind, slots, slotTiles)
    out[kind] = [0, 0, e.sx, e.sy, e.sx, e.sy - rise, 0, -rise]
  }
  return out
}

/** Horizontal courses up each wall, parallel to its own base edge. */
export function wallCourses(slots: number, slotTiles: number, wallH: number): Record<WallKind, Line4[]> {
  const rise = wallH * TILE_W
  const step = WALL_COURSE_TILES * TILE_W
  const out = {} as Record<WallKind, Line4[]>
  for (const kind of WALL_KINDS) {
    const e = wallBase(kind, slots, slotTiles)
    const lines: Line4[] = []
    for (let up = step; up < rise; up += step) lines.push([0, -up, e.sx, e.sy - up])
    out[kind] = lines
  }
  return out
}

/** The board at the foot of each wall: the base edge, raised by SKIRTING_TILES. */
export function skirtingPolys(slots: number, slotTiles: number): Record<WallKind, number[]> {
  const rise = SKIRTING_TILES * TILE_W
  const out = {} as Record<WallKind, number[]>
  for (const kind of WALL_KINDS) {
    const e = wallBase(kind, slots, slotTiles)
    out[kind] = [0, 0, e.sx, e.sy, e.sx, e.sy - rise, 0, -rise]
  }
  return out
}

/** Board seams across the floor, running along the room's +x axis. */
export function floorBoards(slots: number, slotTiles: number): Line4[] {
  const w = slots * slotTiles
  const lines: Line4[] = []
  for (let y = FLOOR_BOARD_TILES; y < w; y += FLOOR_BOARD_TILES) {
    const a = tileToScreen(0, y), b = tileToScreen(w, y)
    lines.push([a.sx, a.sy, b.sx, b.sy])
  }
  return lines
}

/**
 * Where a `placement: 'wall'` furnishing hangs: on the wall plane behind its slot, at eye
 * height. A slot nearer the +x edge hangs on the right-hand wall, nearer +y on the left;
 * the far corner slot (0,0) belongs to the left, which is one arbitrary but fixed call.
 */
export function wallMount(
  slot: { x: number; y: number }, slots: number, slotTiles: number = SLOT_TILES,
): { sx: number; sy: number; wall: WallKind } {
  const wall: WallKind = slot.x > slot.y ? 'back-right' : 'back-left'
  const base = wall === 'back-right'
    ? tileToScreen((slot.x + 0.5) * slotTiles, 0)
    : tileToScreen(0, (slot.y + 0.5) * slotTiles)
  return { sx: base.sx, sy: base.sy - WALL_MOUNT_H_TILES * TILE_W, wall }
}

/**
 * The doorway: a plate straddling the room's NEAR vertex, on the same face the exterior door
 * sits on, so entering and leaving are the same place. Half of it lies inside the room and
 * half outside — which is what a threshold is.
 */
export function thresholdPoly(slots: number, slotTiles: number): number[] {
  const w = slots * slotTiles
  const c = tileToScreen(w, w)
  const hx = (THRESHOLD_TILES * TILE_W) / 2
  const hy = (THRESHOLD_TILES * TILE_H) / 2
  return [c.sx, c.sy - hy, c.sx + hx, c.sy, c.sx, c.sy + hy, c.sx - hx, c.sy]
}

export type FloorPool = { sx: number; sy: number; radius: number; alpha: number }

/**
 * Light falls from the doorway and from any furnishing that provides it. The doorway pool
 * always exists — a room with no fire is lit by the way in, never by nothing — and it is
 * returned first, so the painter lays the ambient light down before any fire.
 */
export function floorPools(
  items: ReadonlyArray<{ slot: { x: number; y: number }; light: boolean }>,
  slots: number,
  slotTiles: number = SLOT_TILES,
): FloorPool[] {
  const w = slots * slotTiles
  const door = tileToScreen(w, w)
  const pools: FloorPool[] = [{
    sx: door.sx, sy: door.sy,
    radius: DOORWAY_POOL_R_TILES * TILE_W, alpha: DOORWAY_POOL_ALPHA,
  }]
  for (const item of items) {
    if (!item.light) continue
    const c = slotCentreScreen(item.slot.x, item.slot.y, slotTiles)
    pools.push({ sx: c.sx, sy: c.sy, radius: HEARTH_POOL_R_TILES * TILE_W, alpha: HEARTH_POOL_ALPHA })
  }
  return pools
}

/**
 * The room's whole drawn box in room space: the top of the walls down to the floor's near
 * vertex. The camera centres THIS, never the floor alone — walls made the box twice as tall
 * as the thing the landed code was centring, so the top of the room went off the stage.
 */
export function roomBox(
  slots: number, slotTiles: number, wallH: number,
): { top: number; bottom: number; height: number } {
  const top = -wallH * TILE_W
  const bottom = slots * slotTiles * TILE_H
  return { top, bottom, height: bottom - top }
}

/** Where the room container's origin goes so the whole box is centred in a stage `screenH`
 *  tall, lifted clear of the chrome at the bottom by `offsetY`. */
export function roomOriginY(
  screenH: number, offsetY: number, zoom: number, slots: number, slotTiles: number, wallH: number,
): number {
  const box = roomBox(slots, slotTiles, wallH)
  return screenH / 2 - offsetY - ((box.top + box.bottom) / 2) * zoom
}

/** Just enough of a Pixi `Graphics` to paint the shell. Structural, so this module stays pure
 *  and its tests need no renderer — the same seam `builtForm.ts` uses. */
export type ShellPainter = {
  clear: () => unknown
  poly: (points: number[]) => unknown
  moveTo: (x: number, y: number) => unknown
  lineTo: (x: number, y: number) => unknown
  ellipse: (x: number, y: number, rx: number, ry: number) => unknown
  fill: (style: number | { color: number; alpha?: number }) => unknown
  stroke: (style: { width: number; color: number; alpha?: number; alignment: number }) => unknown
}

const strokeLines = (g: ShellPainter, lines: Line4[], color: number, alpha: number): void => {
  if (lines.length === 0) return
  for (const [x0, y0, x1, y1] of lines) {
    g.moveTo(x0, y0)
    g.lineTo(x1, y1)
  }
  g.stroke({ width: 1, color, alpha, alignment: 0.5 })
}

/** The back plane: two walls, their grain, their skirting and the corner they meet in. */
export function drawWalls(g: ShellPainter, slots: number, slotTiles: number, wallH: number): void {
  g.clear()
  const walls = wallPolys(slots, slotTiles, wallH)
  const courses = wallCourses(slots, slotTiles, wallH)
  const skirt = skirtingPolys(slots, slotTiles)
  for (const kind of WALL_KINDS) {
    g.poly(walls[kind])
    g.fill(kind === 'back-right' ? ROOM_SHELL_PAINT.wallLit : ROOM_SHELL_PAINT.wallShade)
    strokeLines(g, courses[kind], ROOM_SHELL_PAINT.wallCourse, 0.32)
    g.poly(skirt[kind])
    g.fill(ROOM_SHELL_PAINT.skirting)
    g.poly(walls[kind])
    g.stroke({ width: 1, color: ROOM_SHELL_INK, alignment: 0.5 })
  }
}

/**
 * The floor's surface and its grain.
 *
 * `surface` is `null` when the caller has already laid a continuous MATERIAL down under this
 * pass — the interior's half of the landed hot-swap law. The detail is identical either way,
 * so a floor with art and a floor without differ in one fill and nothing else.
 */
export function drawFloorBase(
  g: ShellPainter, slots: number, slotTiles: number, surface: number | null = ROOM_SHELL_PAINT.floor,
): void {
  if (surface !== null) {
    g.poly(floorPolyOf(slots, slotTiles))
    g.fill(surface)
  }
  // the far row sits in the walls' shade, so the plane reads as receding rather than face-on
  g.poly(farRowShade(slots, slotTiles, 0))
  g.fill({ color: ROOM_SHELL_PAINT.wallShade, alpha: FAR_ROW_SHADE_ALPHA })
  strokeLines(g, floorBoards(slots, slotTiles), ROOM_SHELL_PAINT.floorSeam, 0.4)
}

/**
 * The light on the floor, and the threshold it falls through. A pool on a dimetric floor is
 * an ellipse — half as tall as it is wide, like every tile.
 *
 * THE CALLER MUST MASK THIS TO `floorPolyOf`. Both the doorway pool and the threshold are
 * centred ON the near vertex, so half of each lies outside the room BY CONSTRUCTION.
 * Unclipped, the pool painted a pale smear across the town and the threshold hung in the air
 * below the floor like a tab — which is what the browser showed.
 */
export function drawFloorLight(
  g: ShellPainter, pools: readonly FloorPool[], slots: number, slotTiles: number,
): void {
  for (const [i, p] of pools.entries()) {
    g.ellipse(p.sx, p.sy, p.radius, p.radius / 2)
    g.fill({
      color: i === 0 ? ROOM_SHELL_PAINT.doorwayPool : ROOM_SHELL_PAINT.hearthPool,
      alpha: p.alpha,
    })
  }
  g.poly(thresholdPoly(slots, slotTiles))
  g.fill({ color: ROOM_SHELL_PAINT.threshold, alpha: 0.5 })
}

/** The rim that closes the plane, over everything that lies on it. */
export function drawFloorTop(g: ShellPainter, slots: number, slotTiles: number): void {
  g.poly(floorPolyOf(slots, slotTiles))
  g.stroke({ width: 2, color: ROOM_SHELL_INK, alignment: 1 })
}

/** A far-row shade, kept from the landed room: the floor darkens toward the back wall so the
 *  plane reads as receding rather than as a card seen face-on. */
export function farRowShade(slots: number, slotTiles: number, row: number): number[] {
  const n = slotTiles
  const Y = row * n
  const corners = [
    tileToScreen(0, Y), tileToScreen(slots * n, Y),
    tileToScreen(slots * n, Y + n), tileToScreen(0, Y + n),
  ]
  return corners.flatMap((p) => [p.sx, p.sy])
}

import {
  INTERIOR_TILE, ROOM_TILES, WALL_H_PX, WALL_KINDS, alongWall, interiorToScreen, wallOfTile,
  type Tile, type WallKind,
} from './interiorMap.js'

// Geometry for a room's floor and its two visible walls, in interior pixels on the 128×64
// interior tile `interiorMap.ts` owns. Pure functions, so every number here measures offline.

export { ROOM_TILES, WALL_H_PX, WALL_KINDS, type WallKind } from './interiorMap.js'

/** The room's size, in interior tiles. */
export type RoomSize = { w: number; h: number }

/** 1, because the interior tile is authored at the size it reaches the glass: any other
 *  factor resamples pixel art, and a stage too short for the box crops instead. */
export const ROOM_ZOOM = 1
/** Stage left above the wall top and below the near floor vertex. A room flush to the edge of
 *  the screen reads as a room that has been cut off. */
export const ROOM_MARGIN_Y = 8

/** A course of the wall's own material, every 32 interior px of height — the grain that stops
 *  a wall reading as a flat trapezoid. */
export const WALL_COURSE_PX = 32
/** The board at the foot of a wall, where it meets the floor. */
export const SKIRTING_PX = 18
/** Where a wall piece hangs when the codex has no wall ELEVATION art for it: up the wall,
 *  clear of the skirting. The art path never uses this — an elevation piece IS the wall. */
export const WALL_MOUNT_H_PX = 96
/** Floor boards run one interior tile apart, along the room's +x axis. */
export const FLOOR_BOARD_TILES = 1

export const DOORWAY_POOL_ALPHA = 0.18
export const HEARTH_POOL_ALPHA = 0.26
export const DOORWAY_POOL_R_TILES = 2.2
export const HEARTH_POOL_R_TILES = 1.8

/** The threshold plate, in interior tiles across. Matched to the exterior door sill so
 *  entering and leaving are visibly the same place. */
export const THRESHOLD_TILES = 1.6

/** How deep the walls' shade falls across the row of floor nearest them. */
export const FAR_ROW_SHADE_ALPHA = 0.22

/** Every colour the shell paints, all MASTER_PALETTE members. This is the art-independent
 *  room: with an interior tileset the walls and floor come from it and only the light is code. */
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

/** The shade a wall face is drawn in, as a multiplier on its art. Light falls from the north
 *  west, so the left-hand face sits in its own shade — the mock's `NW_TINT`. */
export const WALL_TINT: Record<WallKind, number> = { 'back-right': 1, 'back-left': 0.86 }

export type Line4 = [number, number, number, number]

/** The floor diamond: the whole tile grid, as a closed polygon in room space. Origin is the
 *  far vertex, exactly where the room container is positioned. */
export function floorPolyOf(room: RoomSize = ROOM_TILES): number[] {
  const c = [
    interiorToScreen(0, 0), interiorToScreen(room.w, 0),
    interiorToScreen(room.w, room.h), interiorToScreen(0, room.h),
  ]
  return c.flatMap((p) => [p.sx, p.sy])
}

/** A rectangle of the tile map as a closed diamond in room space — a patch of one floor
 *  material laid over another, like the flagstone under a hearth. */
export function floorRegionPoly(r: { x0: number; y0: number; x1: number; y1: number }): number[] {
  const c = [
    interiorToScreen(r.x0, r.y0), interiorToScreen(r.x1, r.y0),
    interiorToScreen(r.x1, r.y1), interiorToScreen(r.x0, r.y1),
  ]
  return c.flatMap((p) => [p.sx, p.sy])
}

/** The centre of the ground a piece stands on: a two-tile-deep piece foots two tiles out. */
export function tileSpanCentre(
  tile: Tile, size: { w: number; h: number },
): { sx: number; sy: number } {
  return interiorToScreen(tile.x + size.w / 2, tile.y + size.h / 2)
}

/** The centre of a single interior tile, in room space. */
export function tileCentreScreen(x: number, y: number): { sx: number; sy: number } {
  return tileSpanCentre({ x, y }, { w: 1, h: 1 })
}

/** The base edge of a wall, from the far vertex outward. `back-right` runs along +x, which is
 *  the edge that goes down and to the RIGHT on screen; `back-left` runs along +y. */
function wallBase(kind: WallKind, room: RoomSize): { sx: number; sy: number } {
  return kind === 'back-right' ? interiorToScreen(room.w, 0) : interiorToScreen(0, room.h)
}

/** The two back walls as closed quads: each base edge, raised by `wallH` interior pixels. */
export function wallPolys(
  room: RoomSize = ROOM_TILES, wallH: number = WALL_H_PX,
): Record<WallKind, number[]> {
  const out = {} as Record<WallKind, number[]>
  for (const kind of WALL_KINDS) {
    const e = wallBase(kind, room)
    out[kind] = [0, 0, e.sx, e.sy, e.sx, e.sy - wallH, 0, -wallH]
  }
  return out
}

/** Horizontal courses up each wall, parallel to its own base edge. */
export function wallCourses(
  room: RoomSize = ROOM_TILES, wallH: number = WALL_H_PX,
): Record<WallKind, Line4[]> {
  const out = {} as Record<WallKind, Line4[]>
  for (const kind of WALL_KINDS) {
    const e = wallBase(kind, room)
    const lines: Line4[] = []
    for (let up = WALL_COURSE_PX; up < wallH; up += WALL_COURSE_PX) {
      lines.push([0, -up, e.sx, e.sy - up])
    }
    out[kind] = lines
  }
  return out
}

/** The board at the foot of each wall: the base edge, raised by SKIRTING_PX. */
export function skirtingPolys(room: RoomSize = ROOM_TILES): Record<WallKind, number[]> {
  const out = {} as Record<WallKind, number[]>
  for (const kind of WALL_KINDS) {
    const e = wallBase(kind, room)
    out[kind] = [0, 0, e.sx, e.sy, e.sx, e.sy - SKIRTING_PX, 0, -SKIRTING_PX]
  }
  return out
}

/** Board seams across the floor, running along the room's +x axis. */
export function floorBoards(room: RoomSize = ROOM_TILES): Line4[] {
  const lines: Line4[] = []
  for (let y = FLOOR_BOARD_TILES; y < room.h; y += FLOOR_BOARD_TILES) {
    const a = interiorToScreen(0, y), b = interiorToScreen(room.w, y)
    lines.push([a.sx, a.sy, b.sx, b.sy])
  }
  return lines
}

/** Where a wall piece hangs and which way it faces; `null` for a tile against no wall, so a
 *  misplaced piece reads as a placement error rather than hanging in mid-air. */
export function wallMount(tile: Tile): { sx: number; sy: number; wall: WallKind } | null {
  const wall = wallOfTile(tile)
  if (wall === null) return null
  const along = alongWall(wall, tile) + 0.5
  const base = wall === 'back-right' ? interiorToScreen(along, 0) : interiorToScreen(0, along)
  return { sx: base.sx, sy: base.sy - WALL_MOUNT_H_PX, wall }
}

/** The doorway plate, straddling the room's near vertex: half inside the room, half out. */
export function thresholdPoly(room: RoomSize = ROOM_TILES): number[] {
  const c = interiorToScreen(room.w, room.h)
  const hx = (THRESHOLD_TILES * INTERIOR_TILE.w) / 2
  const hy = (THRESHOLD_TILES * INTERIOR_TILE.h) / 2
  return [c.sx, c.sy - hy, c.sx + hx, c.sy, c.sx, c.sy + hy, c.sx - hx, c.sy]
}

// ── ★ THE CEILING, SEEN THE ONLY WAY A DIMETRIC CAMERA CAN SEE IT ────────────────────────
//
// Joist spacing is the wall bay, so a joist lands over the joint between two wall strips.
// `WALL_STRIP_TILES` lives in `interiorTileset.ts`, so it is passed in.

/** How far a joist reaches either side of its own centre line, in interior tiles. */
export const BEAM_HALF_TILES = 0.22
/** The shadow a joist lays on the floor. Ink, barely — a beam is a darkening, not a stripe. */
export const BEAM_ALPHA = 0.13

/** One quad per ceiling joist, in room space, running the full depth of the floor. */
export function ceilingBeams(bayTiles: number, room: RoomSize = ROOM_TILES): number[][] {
  const out: number[][] = []
  for (let i = 0; (i + 0.5) * bayTiles < room.w; i++) {
    const cx = (i + 0.5) * bayTiles
    const c = [
      interiorToScreen(cx - BEAM_HALF_TILES, 0), interiorToScreen(cx + BEAM_HALF_TILES, 0),
      interiorToScreen(cx + BEAM_HALF_TILES, room.h), interiorToScreen(cx - BEAM_HALF_TILES, room.h),
    ]
    out.push(c.flatMap((p) => [p.sx, p.sy]))
  }
  return out
}

export type FloorPool = { sx: number; sy: number; radius: number; alpha: number }

/** Light from the doorway and from any furnishing that provides it. The doorway pool always
 *  exists and comes first, so the painter lays the ambient light down before any fire. */
export function floorPools(
  items: ReadonlyArray<{ tile: Tile; light: boolean }>, room: RoomSize = ROOM_TILES,
): FloorPool[] {
  const door = interiorToScreen(room.w, room.h)
  const pools: FloorPool[] = [{
    sx: door.sx, sy: door.sy,
    radius: DOORWAY_POOL_R_TILES * INTERIOR_TILE.w, alpha: DOORWAY_POOL_ALPHA,
  }]
  for (const item of items) {
    if (!item.light) continue
    const c = tileCentreScreen(item.tile.x, item.tile.y)
    pools.push({
      sx: c.sx, sy: c.sy,
      radius: HEARTH_POOL_R_TILES * INTERIOR_TILE.w, alpha: HEARTH_POOL_ALPHA,
    })
  }
  return pools
}

/** The union outline of the two walls and the floor — the room as one closed shape. Masking
 *  the room container with it keeps every prop's glow inside the room. */
export function roomMaskPoly(room: RoomSize = ROOM_TILES, wallH: number = WALL_H_PX): number[] {
  const e = wallBase('back-right', room)
  const w = wallBase('back-left', room)
  const near = interiorToScreen(room.w, room.h)
  return [
    w.sx, w.sy - wallH, 0, -wallH, e.sx, e.sy - wallH,
    e.sx, e.sy, near.sx, near.sy, w.sx, w.sy,
  ]
}

/** The whole drawn box: wall top down to the floor's near vertex. The camera centres this,
 *  never the floor alone, or the walls push the top of the room off the stage. */
export function roomBox(
  room: RoomSize = ROOM_TILES, wallH: number = WALL_H_PX,
): { top: number; bottom: number; height: number } {
  const top = -wallH
  const bottom = (room.w + room.h) * (INTERIOR_TILE.h / 2)
  return { top, bottom, height: bottom - top }
}

/** Always `ROOM_ZOOM`; still a function of the stage so the scene asks rather than inlines it. */
export function roomZoomFor(_screenH: number): number {
  return ROOM_ZOOM
}

/** How much of the room's box a stage this tall cannot show; 0 when it all fits. `ROOM_MARGIN_Y`
 *  is deliberately NOT counted here — it is paid out of slack by `roomOriginY`. */
export function roomCropPx(screenH: number, room: RoomSize = ROOM_TILES, wallH: number = WALL_H_PX): number {
  return Math.max(0, roomBox(room, wallH).height * ROOM_ZOOM - screenH)
}

/** The room's drawn width: a diamond spreads `room.h` tiles west of its origin and `room.w`
 *  east, so a wide room overflows a stage horizontally as well as vertically. */
export function roomWidthPx(room: RoomSize = ROOM_TILES): number {
  return wallBase('back-right', room).sx - wallBase('back-left', room).sx
}

/** How much of the room's box a stage this size cannot show, in each axis. 0 where it fits. */
export function roomCrop(
  screenW: number, screenH: number, room: RoomSize = ROOM_TILES, wallH: number = WALL_H_PX,
): { x: number; y: number } {
  return {
    x: Math.max(0, roomWidthPx(room) * ROOM_ZOOM - screenW),
    y: roomCropPx(screenH, room, wallH),
  }
}

/** The camera's allowed travel, which is exactly the crop: split either way in x, because
 *  `roomOriginX` centres, and downward only in y, because `roomOriginY` pins the wall top. */
export function roomPanRange(
  screenW: number, screenH: number, room: RoomSize = ROOM_TILES, wallH: number = WALL_H_PX,
): { minX: number; maxX: number; minY: number; maxY: number } {
  const crop = roomCrop(screenW, screenH, room, wallH)
  // `0 - x` and not `-x`: a room that fits must give a range of [+0, +0], or the clamp hands
  // back -0 and "this room has no camera" stops being an equality anyone can assert.
  return { minX: 0 - crop.x / 2, maxX: crop.x / 2, minY: 0 - crop.y, maxY: 0 }
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

/** The offset that brings a room-space `focus` as near the stage's middle as the room allows,
 *  added to the `roomOrigin*` placement; a `null` focus offsets by 0 in both axes. */
export function roomPanTo(
  focus: { sx: number; sy: number } | null,
  screenW: number, screenH: number, zoom: number,
  room: RoomSize = ROOM_TILES, wallH: number = WALL_H_PX,
): { dx: number; dy: number } {
  const range = roomPanRange(screenW, screenH, room, wallH)
  if (focus === null) return { dx: clamp(0, range.minX, range.maxX), dy: clamp(0, range.minY, range.maxY) }
  const originX = roomOriginX(screenW, zoom, room)
  const originY = roomOriginY(screenH, 0, zoom, room, wallH)
  return {
    dx: clamp(screenW / 2 - (originX + focus.sx * zoom), range.minX, range.maxX),
    dy: clamp(screenH / 2 - (originY + focus.sy * zoom), range.minY, range.maxY),
  }
}

/** What the camera watches, in order: the followed body if it is in this room, else the
 *  centroid of everybody in it, else `resting`, else `null`. */
export function roomFocusOf(
  bodies: ReadonlyArray<{ id: string; sx: number; sy: number }>,
  followedId: string | null,
  resting: { sx: number; sy: number } | null = null,
): { sx: number; sy: number } | null {
  const followed = bodies.find((b) => b.id === followedId)
  if (followed !== undefined) return { sx: followed.sx, sy: followed.sy }
  if (bodies.length === 0) return resting
  const sx = bodies.reduce((a, b) => a + b.sx, 0) / bodies.length
  const sy = bodies.reduce((a, b) => a + b.sy, 0) / bodies.length
  return { sx, sy }
}

/** How far the camera closes on its target each frame. A room camera that snaps is a cut, and
 *  a cut inside one room reads as a different room. Frame-rate independent. */
export const ROOM_PAN_HALF_LIFE_MS = 260

/** One frame of easing toward `to`. Exponential, so it is the same motion at 30 fps and 120. */
export function easePan(from: number, to: number, dtMs: number): number {
  if (dtMs <= 0) return from
  return to + (from - to) * Math.pow(0.5, dtMs / ROOM_PAN_HALF_LIFE_MS)
}

/** Where the room's origin goes across the stage. The origin is the FAR corner, which is only
 *  centred in a square room, so a non-square room is centred on its west/east vertices. */
export function roomOriginX(screenW: number, zoom: number, room: RoomSize = ROOM_TILES): number {
  const west = interiorToScreen(0, room.h).sx
  const east = interiorToScreen(room.w, 0).sx
  return screenW / 2 - ((west + east) / 2) * zoom
}

/** Where the room container's origin goes so the box is centred in a stage `screenH` tall,
 *  lifted clear of the bottom chrome by `offsetY` — clamped to the headroom that exists. */
export function roomOriginY(
  screenH: number, offsetY: number, zoom: number, room: RoomSize = ROOM_TILES,
  wallH: number = WALL_H_PX,
): number {
  const box = roomBox(room, wallH)
  const centred = screenH / 2 - ((box.top + box.bottom) / 2) * zoom
  const headroom = centred + box.top * zoom     // stage above the wall top, centred
  // A short stage loses the near corner, not the wall top — the walls carry the room's detail.
  if (headroom < ROOM_MARGIN_Y) return Math.max(0, headroom) - box.top * zoom
  return centred - Math.max(0, Math.min(offsetY, headroom - ROOM_MARGIN_Y))
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
export function drawWalls(
  g: ShellPainter, room: RoomSize = ROOM_TILES, wallH: number = WALL_H_PX,
): void {
  g.clear()
  const walls = wallPolys(room, wallH)
  const courses = wallCourses(room, wallH)
  const skirt = skirtingPolys(room)
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

/** The floor's surface and its grain. `surface` is `null` when the caller has already laid a
 *  continuous material down under this pass. */
export function drawFloorBase(
  g: ShellPainter, room: RoomSize = ROOM_TILES,
  surface: number | null = ROOM_SHELL_PAINT.floor,
): void {
  if (surface !== null) {
    g.poly(floorPolyOf(room))
    g.fill(surface)
  }
  // the far row sits in the walls' shade, so the plane reads as receding rather than face-on
  g.poly(farRowShade(room, 0))
  g.fill({ color: ROOM_SHELL_PAINT.wallShade, alpha: FAR_ROW_SHADE_ALPHA })
  strokeLines(g, floorBoards(room), ROOM_SHELL_PAINT.floorSeam, 0.4)
}

/** The light on the floor and the threshold it falls through. The caller MUST mask this to
 *  `floorPolyOf`: the doorway pool and the threshold straddle the near vertex by construction. */
export function drawFloorLight(
  g: ShellPainter, pools: readonly FloorPool[], room: RoomSize = ROOM_TILES,
  beams: readonly number[][] = [],
): void {
  for (const beam of beams) {
    g.poly(beam)
    g.fill({ color: ROOM_SHELL_INK, alpha: BEAM_ALPHA })
  }
  for (const [i, p] of pools.entries()) {
    g.ellipse(p.sx, p.sy, p.radius, p.radius / 2)
    g.fill({
      color: i === 0 ? ROOM_SHELL_PAINT.doorwayPool : ROOM_SHELL_PAINT.hearthPool,
      alpha: p.alpha,
    })
  }
  g.poly(thresholdPoly(room))
  g.fill({ color: ROOM_SHELL_PAINT.threshold, alpha: 0.5 })
}

/** The rim that closes the plane, over everything that lies on it. */
export function drawFloorTop(g: ShellPainter, room: RoomSize = ROOM_TILES): void {
  g.poly(floorPolyOf(room))
  g.stroke({ width: 2, color: ROOM_SHELL_INK, alignment: 1 })
}

/** A far-row shade, kept from the landed room: the floor darkens toward the back wall so the
 *  plane reads as receding rather than as a card seen face-on. */
export function farRowShade(room: RoomSize = ROOM_TILES, row: number): number[] {
  const corners = [
    interiorToScreen(0, row), interiorToScreen(room.w, row),
    interiorToScreen(room.w, row + 1), interiorToScreen(0, row + 1),
  ]
  return corners.flatMap((p) => [p.sx, p.sy])
}

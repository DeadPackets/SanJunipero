import {
  INTERIOR_TILE, ROOM_TILES, WALL_H_PX, WALL_KINDS, alongWall, interiorToScreen, wallOfTile,
  type Tile, type WallKind,
} from './interiorMap.js'

// THE ROOM SHELL — WALLS, A BACK PLANE, A THRESHOLD (U4, plan task 66; Option C, task 84).
//
// THE COMPLAINT: interiors are "way too low quality, way too under detailed". The room was a
// flat cream diamond with a 2 px rim, one shaded far row and up to five sprites standing on
// it. There were NO WALLS — `interiors.ts` even carried a `placement: 'wall'` meta whose only
// effect was a 0 px offset, because there was nothing to hang anything on.
//
// A room is three planes, not one: the floor a body stands on and the two back walls a
// dimetric camera can see. This module is the geometry of all three, plus the two things that
// stop a plane reading as a coloured card — the courses that give a wall its grain and the
// pools of light that say where the light comes from. Pure functions and palette tokens only:
// no Pixi, no pixels, so every number here is measurable offline.
//
// ★ THE UNIT IS NOW THE INTERIOR TILE, AND THAT IS THE WHOLE OF OPTION C. Every length below
// was a count of 32×16 TOWN tiles, drawn at a scene zoom of 3 or 4. It is now interior pixels
// on the 128×64 interior tile at a scene zoom of ONE — the same pixel density on the glass, a
// room twice as wide, and art that lands 1:1 instead of being doubled by the camera.
// `interiorMap.ts` owns the lattice; this module owns what is painted on it.

export { ROOM_TILES, WALL_H_PX, WALL_KINDS, type WallKind } from './interiorMap.js'

/** The room's size, in interior tiles. */
export type RoomSize = { w: number; h: number }

/**
 * ★ THE SCENE ZOOM IS ONE, AND THAT IS NOT A DEMOTION.
 *
 * It was 4, over a 6×6 room of 32×16 town tiles: one tile reached the glass 128 px across and
 * a 128 px library sprite was drawn at 256 — a clean doubling, but a DOUBLING, so half the
 * pixels on the screen were invented by the sampler. Option C keeps the tile exactly 128 px
 * wide on the glass and makes the TILE the authored unit instead of the camera. The room is
 * 12×6 of those, the furniture lands at its own native size, and nothing is upscaled.
 *
 * There is no smaller integer, so a stage too short for the box crops it rather than
 * resampling it — `roomOriginY` spends what headroom there is on the wall top first.
 */
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

/** Every colour the shell paints. All MASTER_PALETTE members, asserted as a set by the test.
 *  The two walls are a light and a shade of one material so the corner reads as a corner;
 *  the floor is a third step, so no two adjacent planes share a tone.
 *
 *  This is the ART-INDEPENDENT shell: what the room is when the codex holds no interior
 *  tileset. With one, the walls and the floor are drawn from it and only the light is code. */
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

/**
 * The centre of the ground a piece stands on, in room space — the point its sprite's feet
 * belong at. A furnishing two tiles deep has its foot TWO tiles from its origin, not one.
 */
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

/**
 * The two back walls, as closed quads in room space: the base edge, then the same edge raised
 * by `wallH` interior pixels. The pair shares exactly one edge — the far vertical column at
 * the room's origin — which is what makes the corner a corner.
 */
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

/**
 * ★ WHERE A WALL PIECE HANGS — AND WHICH WAY IT THEN FACES.
 *
 * This used to pick the wall with `slot.x > slot.y` and say nothing at all about facing, which
 * is how a fireplace authored SW came to be mounted on the SE-facing wall. The wall is now the
 * one the piece's TILE is actually against (`interiorMap.wallOfTile`), and the facing is that
 * wall's own — there is no third answer, because `TownFacing` has no third member.
 *
 * `null` for a tile against no wall: a wall piece in the middle of the floor is a placement
 * error and reads as one instead of hanging in mid-air.
 */
export function wallMount(tile: Tile): { sx: number; sy: number; wall: WallKind } | null {
  const wall = wallOfTile(tile)
  if (wall === null) return null
  const along = alongWall(wall, tile) + 0.5
  const base = wall === 'back-right' ? interiorToScreen(along, 0) : interiorToScreen(0, along)
  return { sx: base.sx, sy: base.sy - WALL_MOUNT_H_PX, wall }
}

/**
 * The doorway: a plate straddling the room's NEAR vertex, on the same face the exterior door
 * sits on, so entering and leaving are the same place. Half of it lies inside the room and
 * half outside — which is what a threshold is.
 */
export function thresholdPoly(room: RoomSize = ROOM_TILES): number[] {
  const c = interiorToScreen(room.w, room.h)
  const hx = (THRESHOLD_TILES * INTERIOR_TILE.w) / 2
  const hy = (THRESHOLD_TILES * INTERIOR_TILE.h) / 2
  return [c.sx, c.sy - hy, c.sx + hx, c.sy, c.sx, c.sy + hy, c.sx - hx, c.sy]
}

// ── ★ THE CEILING, SEEN THE ONLY WAY A DIMETRIC CAMERA CAN SEE IT ────────────────────────
//
// A room drawn from above has no ceiling on the screen, and the mock the user approved solves
// that the way a painter does: three joists, drawn as the shadows they cast down the floor.
// It is the cheapest thing in the picture and it is most of what stops a big floor reading as
// an empty one. The lane before this one ran out of room before them and said so.
//
// The spacing is the WALL BAY, not a number: a joist lands over the joint between two wall
// strips, which is where a joist actually goes, so the ceiling and the walls are the same
// building. `WALL_STRIP_TILES` lives in `interiorTileset.ts`, so it is passed in.

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

/**
 * Light falls from the doorway and from any furnishing that provides it. The doorway pool
 * always exists — a room with no fire is lit by the way in, never by nothing — and it is
 * returned first, so the painter lays the ambient light down before any fire.
 */
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

/**
 * The union outline of the two walls and the floor — the room as ONE closed shape.
 *
 * WHAT THE BROWSER CAUGHT: a hearth's glow is a child of its sprite, so it grew with the
 * furniture scale and painted a pale disc across the town outside the room. A room is a box;
 * nothing drawn inside it belongs outside it. One mask on the room container settles that for
 * every prop, present and future, instead of one clamp per light.
 */
export function roomMaskPoly(room: RoomSize = ROOM_TILES, wallH: number = WALL_H_PX): number[] {
  const e = wallBase('back-right', room)
  const w = wallBase('back-left', room)
  const near = interiorToScreen(room.w, room.h)
  return [
    w.sx, w.sy - wallH, 0, -wallH, e.sx, e.sy - wallH,
    e.sx, e.sy, near.sx, near.sy, w.sx, w.sy,
  ]
}

/**
 * The room's whole drawn box in room space: the top of the walls down to the floor's near
 * vertex. The camera centres THIS, never the floor alone — walls made the box twice as tall
 * as the thing the landed code was centring, so the top of the room went off the stage.
 */
export function roomBox(
  room: RoomSize = ROOM_TILES, wallH: number = WALL_H_PX,
): { top: number; bottom: number; height: number } {
  const top = -wallH
  const bottom = (room.w + room.h) * (INTERIOR_TILE.h / 2)
  return { top, bottom, height: bottom - top }
}

/**
 * ★ HOW CLOSE THIS STAGE HOLDS THE ROOM — and why the answer no longer depends on the stage.
 *
 * It used to choose between 4 and 3 by whether the box fitted. Option C has ONE integer scene
 * zoom and it is 1: the interior tile is authored at the size it reaches the glass, so any
 * other factor resamples pixel art, and there is no integer below 1 to fall back to. A stage
 * that cannot hold the box CROPS it — `roomCropPx` says by how much — because a cropped room
 * of real pixels beats a whole room of invented ones.
 *
 * It stays a function of the stage so the scene keeps asking rather than writing a constant.
 */
export function roomZoomFor(_screenH: number): number {
  return ROOM_ZOOM
}

/**
 * How much of the room's box a stage this tall cannot show. 0 when it all fits — the number the
 * crop costs, so "it does not fit" is measured rather than asserted.
 *
 * ★ THE MARGIN IS NOT PART OF THE BOX. It was counted here, so a stage that could hold the room
 * exactly was told it was 16 px short and threw away the near corner — the threshold, which is
 * the way out — to buy two strips of nothing. A courtesy is paid out of slack or it is not paid:
 * `roomOriginY` clamps it to the headroom that exists, and this counts only the picture.
 */
export function roomCropPx(screenH: number, room: RoomSize = ROOM_TILES, wallH: number = WALL_H_PX): number {
  return Math.max(0, roomBox(room, wallH).height * ROOM_ZOOM - screenH)
}

/**
 * ★ THE ROOM'S DRAWN WIDTH — and it is the half of the crop nobody was measuring.
 *
 * `roomCropPx` takes a HEIGHT and returns one number, so the only overflow anybody could see
 * was the vertical one. A room is a diamond: it spreads `room.h` tiles to the WEST of its
 * origin and `room.w` tiles to the EAST, so a 24 × 6 farmhouse is **1 920 px across** and no
 * laptop is that wide. The hearth stands on the back-left wall, which is the west vertex —
 * the first thing a centred horizontal crop eats.
 */
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

/**
 * ★ WHERE THE CAMERA MAY GO INSIDE A ROOM IT CANNOT SHOW WHOLE — and the range IS the crop.
 *
 * `roomOriginX`/`roomOriginY` place a room that fits. When it does not fit there is nothing
 * left to choose but WHICH part is on the glass, and that choice is a camera. The travel it is
 * allowed is exactly `roomCrop`, because a pixel of travel past the crop is a pixel of stage
 * showing nothing:
 *
 * - **x**: `roomOriginX` CENTRES the box, so the overflow is split — the camera may go half the
 *   crop either way.
 * - **y**: `roomOriginY` pins the wall top when the box overflows, so the whole overflow is
 *   below. The camera may only travel DOWN into the room, never up into blank stage above a
 *   wall that is already flush with the top.
 *
 * A room that fits gets a range of zero in that axis and therefore cannot move at all: a house,
 * a cabin, a shed and a storehouse are pinned exactly where they are today, on every stage that
 * holds them. **Nothing that fits acquires a camera.**
 */
export function roomPanRange(
  screenW: number, screenH: number, room: RoomSize = ROOM_TILES, wallH: number = WALL_H_PX,
): { minX: number; maxX: number; minY: number; maxY: number } {
  const crop = roomCrop(screenW, screenH, room, wallH)
  // `0 - x` and not `-x`: a room that fits must give a range of [+0, +0], or the clamp hands
  // back -0 and "this room has no camera" stops being an equality anyone can assert.
  return { minX: 0 - crop.x / 2, maxX: crop.x / 2, minY: 0 - crop.y, maxY: 0 }
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

/**
 * The camera offset that brings `focus` — a point in ROOM space — as near the middle of the
 * stage as the room allows, added to the origin the two `roomOrigin*` functions already give.
 *
 * `null` focus is the room's own life being nowhere: the offset is 0 in both axes, which is the
 * landed placement to the pixel. An empty room does not drift.
 */
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

/** How far the camera closes on its target each frame. A room camera that snaps is a cut, and
 *  a cut inside one room reads as a different room. Frame-rate independent. */
export const ROOM_PAN_HALF_LIFE_MS = 260

/** One frame of easing toward `to`. Exponential, so it is the same motion at 30 fps and 120. */
export function easePan(from: number, to: number, dtMs: number): number {
  if (dtMs <= 0) return from
  return to + (from - to) * Math.pow(0.5, dtMs / ROOM_PAN_HALF_LIFE_MS)
}

/**
 * ★ WHERE THE ROOM'S ORIGIN GOES ACROSS THE STAGE — and it is NOT the middle of it.
 *
 * The origin is the room's FAR corner, and the room only spreads evenly around it while it is
 * square. Option C's room is 12 × 6, so its west vertex is 384 px to the left of the origin
 * and its east vertex 768 px to the right: dropping the origin on the middle of the stage
 * hangs the room 192 px off to the right, which is what the browser showed.
 */
export function roomOriginX(screenW: number, zoom: number, room: RoomSize = ROOM_TILES): number {
  const west = interiorToScreen(0, room.h).sx
  const east = interiorToScreen(room.w, 0).sx
  return screenW / 2 - ((west + east) / 2) * zoom
}

/**
 * Where the room container's origin goes so the whole box is centred in a stage `screenH`
 * tall, lifted clear of the chrome at the bottom by `offsetY`.
 *
 * ★ THE LIFT IS A COURTESY, NOT A LICENCE. It was subtracted unconditionally, which pushes a
 * wall off the top the moment the box is not half the stage. It is clamped to the headroom the
 * stage actually has, less the margin, so the invariant the landed test states — every wall
 * point on the stage — holds at every height that can hold the box at all.
 */
export function roomOriginY(
  screenH: number, offsetY: number, zoom: number, room: RoomSize = ROOM_TILES,
  wallH: number = WALL_H_PX,
): number {
  const box = roomBox(room, wallH)
  const centred = screenH / 2 - ((box.top + box.bottom) / 2) * zoom
  const headroom = centred + box.top * zoom     // stage above the wall top, centred
  // ★ A SHORT STAGE LOSES THE NEAR CORNER, NOT THE WALL TOP. Centring split the overflow
  // evenly, which spends half of it on the windows, the chimney breast and the beams and the
  // other half on a corner of bare boards. The walls are where the room's detail is.
  //
  // ★ AND IT LOSES AS LITTLE OF IT AS IT CAN. This pinned the wall top a full `ROOM_MARGIN_Y`
  // down whatever the stage had, so a room that overflowed by 2 px lost 10 — the margin taken
  // out of the picture instead of out of the slack. Clamped to the headroom that exists, which
  // is the same rule the lift above it already answers to.
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

/**
 * The floor's surface and its grain.
 *
 * `surface` is `null` when the caller has already laid a continuous MATERIAL down under this
 * pass — the interior's half of the landed hot-swap law. The detail is identical either way,
 * so a floor with art and a floor without differ in one fill and nothing else.
 */
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

/**
 * The light on the floor, and the threshold it falls through. A pool on a dimetric floor is
 * an ellipse — half as tall as it is wide, like every tile.
 *
 * THE CALLER MUST MASK THIS TO `floorPolyOf`. Both the doorway pool and the threshold are
 * centred ON the near vertex, so half of each lies outside the room BY CONSTRUCTION.
 */
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

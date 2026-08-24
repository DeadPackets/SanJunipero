import { interiorPieceKind, materialKind, type AssetRecord } from '@sj/shared'
import { INTERIOR_TILE, ROOM_TILES, WALL_H_PX, WALL_KINDS, type WallKind } from './interiorMap.js'

// ★ THE INTERIOR TILESET, ON THE RENDERER'S SIDE — Option C's walls and floors as ART.
//
// The room's shell was a code-painted polygon: two cream trapezoids, a cream diamond and a few
// stroked lines. `g12c.test.ts` said so in as many words — "it is a POLYGON, not a tileset, and
// that is why U4 stays open". This module is the other half: which authored strip goes where on
// which wall, and which patch of floor is boards and which is flagstone.
//
// ART INDEPENDENCE, unchanged: every function here answers `null` when the codex holds no
// piece, and the code-painted shell stands. A missing texture is never a hole.

/** How many interior tiles of wall one authored strip spans. The art is `4 × 128 / 2` = 256 px
 *  across, which is the whole reason the strip is 256 and not some other number. */
export const WALL_STRIP_TILES = 4
export const WALL_STRIP_W = (WALL_STRIP_TILES * INTERIOR_TILE.w) / 2

/** ★ THE SHEAR THAT PUTS A FLAT ELEVATION ON A DIMETRIC WALL.
 *
 *  A wall strip is authored square-on: `x` runs along the wall and `y` up it. On the wall plane
 *  one step along the wall moves one pixel across the screen and HALF a pixel down it — the
 *  town's own 2:1 ratio, which is why the interior can borrow the town's projection wholesale.
 *
 *  As a Pixi transform with `rotation = 0` and `skew.x = 0`, the matrix is
 *  `[cos(skewY)·scaleX, sin(skewY)·scaleX; 0, scaleY]`, so `tan(skewY) = 1/2` puts the rise at
 *  half the run and `scaleX = 1 / cos(skewY)` keeps the run itself at 1:1. The art is therefore
 *  never stretched ALONG the wall: `WALL_SHEAR_X * Math.cos(WALL_SKEW_Y)` is exactly 1. */
export const WALL_SKEW_Y = Math.atan(INTERIOR_TILE.h / INTERIOR_TILE.w)
export const WALL_SHEAR_X = 1 / Math.cos(WALL_SKEW_Y)

/** The transform for one wall's face. `back-left` runs the other way along the screen, so its
 *  scale is negated — which also mirrors the strip, and the light keeps coming from one side. */
export function wallTransform(wall: WallKind): { skewY: number; scaleX: number } {
  return wall === 'back-right'
    ? { skewY: WALL_SKEW_Y, scaleX: WALL_SHEAR_X }
    : { skewY: -WALL_SKEW_Y, scaleX: -WALL_SHEAR_X }
}

/** Where a strip starting `atTiles` along `wall` puts its top-left corner, in room space. */
export function wallStripAt(wall: WallKind, atTiles: number): { sx: number; sy: number } {
  const along = atTiles * (INTERIOR_TILE.w / 2)
  const dir = wall === 'back-right' ? 1 : -1
  return { sx: dir * along, sy: along * (INTERIOR_TILE.h / INTERIOR_TILE.w) - WALL_H_PX }
}

/** How wide a strip may be drawn before it runs off the end of its wall, in px. */
export function wallStripWidth(wall: WallKind, atTiles: number, room = ROOM_TILES): number {
  const limit = (wall === 'back-right' ? room.w : room.h) * (INTERIOR_TILE.w / 2)
  return Math.max(0, Math.min(WALL_STRIP_W, limit - atTiles * (INTERIOR_TILE.w / 2)))
}

export type WallCourse = { wall: WallKind; piece: string; atTiles: number }

/**
 * ★ THE WALL A ROOM ACTUALLY HAS, laid out from what the room actually contains.
 *
 * Every wall is plain from end to end first, so there is never a gap; then each FEATURE is
 * drawn over it at its own place. A feature is either a wall furnishing the room carries — a
 * hearth becomes the chimney breast, which is the whole of Task 2's fix: the hearth is drawn
 * ONCE, as the wall it is built into, and never again as an object standing in front of it —
 * or one of the room's own fixtures, the door and the window it must have to be a room.
 */
export const FURNISHING_WALL_PIECE: Readonly<Record<string, string>> = {
  hearth: 'wall-chimney',
  shelf: 'wall-dresser',
}

const wallSpan = (wall: WallKind, room: { w: number; h: number }): number =>
  wall === 'back-right' ? room.w : room.h

export function wallCourses(
  features: ReadonlyArray<{ kind: string; wall: WallKind; atTiles: number }>,
  room = ROOM_TILES,
): WallCourse[] {
  const out: WallCourse[] = []
  for (const wall of WALL_KINDS) {
    const tiles = wall === 'back-right' ? room.w : room.h
    for (let at = 0; at < tiles; at += WALL_STRIP_TILES) out.push({ wall, piece: 'wall-plain', atTiles: at })
  }
  // The door is on the near end of the long wall, where the exterior door is.
  //
  // ★ AND EVERY OTHER BAY OF THAT WALL IS GLAZED. It used to be one window, at the far end, and
  // a 12-tile wall is THREE bays: the middle one was 256 px of blank wainscot in the visual
  // centre of the room, which is a large part of why the room read as emptier than the mock.
  // A window per bay is a rule and not a coordinate — it holds when the room is longer, and it
  // is the same class of thing the door already is: a hole in a wall, not a piece of furniture
  // the world does not know the room owns.
  const doorAt = Math.max(0, room.w - WALL_STRIP_TILES)
  const fixtures: WallCourse[] = [{ wall: 'back-right', piece: 'wall-door', atTiles: doorAt }]
  for (let at = 0; at < room.w; at += WALL_STRIP_TILES) {
    if (at !== doorAt) fixtures.unshift({ wall: 'back-right', piece: 'wall-window', atTiles: at })
  }
  for (const f of features) {
    const piece = FURNISHING_WALL_PIECE[f.kind]
    if (piece === undefined) continue
    const span = wallSpan(f.wall, room)
    const at = Math.min(Math.max(0, f.atTiles - 1), Math.max(0, span - WALL_STRIP_TILES))
    fixtures.push({ wall: f.wall, piece, atTiles: at })
  }
  return [...out, ...fixtures]
}

/** The url of an interior wall piece in the codex, or `null` — the shell stands without it. */
export function resolveInteriorPiece(records: readonly AssetRecord[], id: string): string | null {
  return newestReady(records, interiorPieceKind(id))
}

/** The url of an interior floor material in the codex, or `null`. */
export function resolveInteriorMaterial(records: readonly AssetRecord[], id: string): string | null {
  return newestReady(records, materialKind(id))
}

function newestReady(records: readonly AssetRecord[], kind: string): string | null {
  let best: AssetRecord | null = null
  for (const r of records) {
    if (r.status !== 'ready' || r.class !== 'terrain' || r.kind !== kind) continue
    if (best === null || r.seq > best.seq) best = r
  }
  return best === null ? null : `/assets/${best.id}.png`
}

/** True once the codex holds enough of the tileset to draw a room from art rather than paint.
 *  The plain wall is the floor of that: without it the elevation has gaps. */
export function hasInteriorTileset(records: readonly AssetRecord[]): boolean {
  return resolveInteriorPiece(records, 'wall-plain') !== null
}

/**
 * The flagstone patches: a hearth stands on stone, and so does the ground just inside a door.
 * Rectangles in interior tiles, in the room's own coordinates.
 */
export type FloorRegion = { x0: number; y0: number; x1: number; y1: number }

export function flagstoneRegions(
  hearths: ReadonlyArray<{ x: number; y: number }>, room = ROOM_TILES,
): FloorRegion[] {
  const out: FloorRegion[] = [
    // the threshold, inside the near corner
    { x0: room.w - 3, y0: room.h - 2, x1: room.w, y1: room.h },
  ]
  for (const h of hearths) {
    out.push({
      x0: Math.max(0, h.x - 1), y0: Math.max(0, h.y - 1),
      x1: Math.min(room.w, h.x + 2), y1: Math.min(room.h, h.y + 2),
    })
  }
  return out
}

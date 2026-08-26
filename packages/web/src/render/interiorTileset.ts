import { interiorPieceKind, materialKind, type AssetRecord } from '@sj/shared'
import { INTERIOR_TILE, ROOM_TILES, WALL_H_PX, WALL_KINDS, type WallKind } from './interiorMap.js'

// Which authored strip goes where on which wall, and which patch of floor is which material.
// Every function answers `null` when the codex holds no piece: the code-painted shell stands,
// and a missing texture is never a hole.

/** How many interior tiles of wall one authored strip spans. The art is `4 × 128 / 2` = 256 px
 *  across, which is the whole reason the strip is 256 and not some other number. */
export const WALL_STRIP_TILES = 4
export const WALL_STRIP_W = (WALL_STRIP_TILES * INTERIOR_TILE.w) / 2

/** The shear that puts a flat elevation on a dimetric wall: `tan(skewY) = 1/2` puts the rise at
 *  half the run, and `scaleX = 1 / cos(skewY)` keeps the run itself at 1:1, so the art is never
 *  stretched ALONG the wall. */
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
 * Every wall is plain from end to end first, so there is never a gap; a FEATURE is drawn over
 * it. A hearth becomes the chimney breast — drawn ONCE as the wall it is built into, and never
 * again as an object standing in front of it.
 */
export const FURNISHING_WALL_PIECE: Readonly<Record<string, string>> = {
  hearth: 'wall-chimney',
  shelf: 'wall-dresser',
}

const wallSpan = (wall: WallKind, room: { w: number; h: number }): number =>
  wall === 'back-right' ? room.w : room.h

export function wallCourses(
  features: readonly { kind: string; wall: WallKind; atTiles: number }[],
  room = ROOM_TILES,
): WallCourse[] {
  const out: WallCourse[] = []
  for (const wall of WALL_KINDS) {
    const tiles = wall === 'back-right' ? room.w : room.h
    for (let at = 0; at < tiles; at += WALL_STRIP_TILES)
      out.push({ wall, piece: 'wall-plain', atTiles: at })
  }
  // The door is on the near end of the long wall, where the exterior door is; every other bay
  // of that wall is glazed, which is a rule and not a coordinate — it holds for a longer room.
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
export function resolveInteriorMaterial(
  records: readonly AssetRecord[],
  id: string,
): string | null {
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

/** A flagstone patch — a hearth stands on stone, and so does the ground just inside a door.
 *  Rectangles in interior tiles, in the room's own coordinates. */
export type FloorRegion = { x0: number; y0: number; x1: number; y1: number }

export function flagstoneRegions(
  hearths: readonly { x: number; y: number }[],
  room = ROOM_TILES,
): FloorRegion[] {
  const out: FloorRegion[] = [
    // the threshold, inside the near corner
    { x0: room.w - 3, y0: room.h - 2, x1: room.w, y1: room.h },
  ]
  for (const h of hearths) {
    out.push({
      x0: Math.max(0, h.x - 1),
      y0: Math.max(0, h.y - 1),
      x1: Math.min(room.w, h.x + 2),
      y1: Math.min(room.h, h.y + 2),
    })
  }
  return out
}

import { z } from 'zod'

// Corners are named by the two arms PRESENT; T tiles by the one arm MISSING;
// caps open TOWARD the named arm.
export const ROAD_AUTOTILE_KEYS = [
  'straight-ns',
  'straight-ew',
  'corner-ne',
  'corner-es',
  'corner-sw',
  'corner-wn',
  't-no-n',
  't-no-e',
  't-no-s',
  't-no-w',
  'cross',
  'cap-n',
  'cap-e',
  'cap-s',
  'cap-w',
] as const

export type RoadAutotileKey = (typeof ROAD_AUTOTILE_KEYS)[number]
export const RoadAutotileKeySchema = z.enum(ROAD_AUTOTILE_KEYS)

// Tile-space N/E/S/W = (x,y-1) (x+1,y) (x,y+1) (x-1,y) — the NE/SE/SW/NW screen
// edges under the dimetric projection.
export type RoadNeighbors = { n: boolean; e: boolean; s: boolean; w: boolean }

// Indexed by n | e<<1 | s<<2 | w<<3. An isolated tile draws as `cap-s`, the
// stub that faces the camera (deviation 3).
const BY_MASK: readonly RoadAutotileKey[] = [
  'cap-s',
  'cap-n',
  'cap-e',
  'corner-ne',
  'cap-s',
  'straight-ns',
  'corner-es',
  't-no-w',
  'cap-w',
  'corner-wn',
  'straight-ew',
  't-no-s',
  'corner-sw',
  't-no-e',
  't-no-n',
  'cross',
]

export function roadAutotile(nb: RoadNeighbors): RoadAutotileKey {
  return BY_MASK[(nb.n ? 1 : 0) | (nb.e ? 2 : 0) | (nb.s ? 4 : 0) | (nb.w ? 8 : 0)]!
}

// Beside the keys because the forge writes it and the renderer reads it — two spellings of one
// string would silently drop every road back to a flat variant.
export const ROAD_AUTOTILE_CODEX_PREFIX = 'road:'

export function roadAutotileKind(key: RoadAutotileKey): string {
  return `${ROAD_AUTOTILE_CODEX_PREFIX}${key}`
}

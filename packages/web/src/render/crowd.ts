import { TILE_H, TILE_W } from './iso.js'

// Occupants of a tile spread along the pure-screen-x axis (32 px per tile against 16 px in
// depth) with an alternating half-step of depth, so `depthSeed` orders overlapping silhouettes
// strictly. The offset is a WORLD offset, so the depth box, cull, shadow, tag and bubble all
// follow it.

/** Screen-x between adjacent bodies in a rank, in world pixels at zoom 1. Under half a
 *  drawn figure's width, so shoulders overlap the way a real group's do. */
export const CROWD_PITCH_PX = 14

/** The widest a whole rank may be, screen-x, end to end. Past five bodies the pitch shrinks
 *  to hold this, so a large crowd packs instead of marching off across the town. */
export const CROWD_SPAN_PX = 72

/** Screen-y between two ADJACENT bodies — half a tile's height: enough that the nearer figure's feet read as nearer, small enough that the rank stays one group. */
export const CROWD_DEPTH_PX = 8

/** `MOTION.move`'s 180 ms, named rather than imported so this module stays free of the chrome; `crowd.test.ts` asserts the two agree. */
export const CROWD_SETTLE_MS = 180

export type CrowdOffset = { dx: number; dy: number }

export const NO_OFFSET: CrowdOffset = { dx: 0, dy: 0 }

/** The world offset for occupant `i` of `n` sharing a tile. `i` indexes the occupant list SORTED BY AGENT ID, never by arrival: two browsers on one tick must lay the crowd out alike. */
export function crowdOffset(i: number, n: number): CrowdOffset {
  if (n <= 1 || i < 0 || i >= n) return NO_OFFSET
  const pitch = Math.min(CROWD_PITCH_PX, CROWD_SPAN_PX / (n - 1))
  const sx = (i - (n - 1) / 2) * pitch
  // Alternating, and centred on zero, so the rank's own middle stays on the tile it belongs to.
  const sy = (i % 2 === 0 ? -1 : 1) * (CROWD_DEPTH_PX / 2)
  return screenToWorldOffset(sx, sy)
}

/** The inverse of `tileToScreen`'s linear part, where `sx = (dx − dy)·TILE_W/2` and `sy = (dx + dy)·TILE_H/2`. */
export function screenToWorldOffset(sx: number, sy: number): CrowdOffset {
  const a = (2 * sx) / TILE_W
  const b = (2 * sy) / TILE_H
  return { dx: (a + b) / 2, dy: (b - a) / 2 }
}

/** Slot offsets keyed by id. Only SETTLED bodies take a slot, so a group does not shuffle aside for somebody walking through it; a body absent from the map is drawn where the record puts it. */
export function crowdOffsets(
  bodies: readonly { id: string; x: number; y: number; settled: boolean }[],
): Map<string, CrowdOffset> {
  const byTile = new Map<string, string[]>()
  for (const b of bodies) {
    if (!b.settled) continue
    const key = `${Math.round(b.x)},${Math.round(b.y)}`
    const at = byTile.get(key)
    if (at === undefined) byTile.set(key, [b.id])
    else at.push(b.id)
  }
  const out = new Map<string, CrowdOffset>()
  for (const ids of byTile.values()) {
    if (ids.length <= 1) continue
    ids.sort()
    for (let i = 0; i < ids.length; i++) out.set(ids[i]!, crowdOffset(i, ids.length))
  }
  return out
}

import { TILE_H, TILE_W } from './iso.js'

// ★ FOUR PEOPLE ON ONE TILE USED TO DRAW AS ONE SPRITE.
//
// The engine's tile is a COORDINATE, not a parking space: `agent_moved` carries an integer x
// and y and nothing in the fold says two bodies may not share them. The renderer took that
// literally — `tileToScreen(a.x, a.y)` for every body — so four masons raising one house drew
// one figure, and the most legible cooperation this simulation can show was legible on the
// roster, in the bubbles and in the chronicle, and invisible in the picture.
//
// ★ THE SHAPE, AND WHY THIS ONE.
//
// A SHOULDER RANK: the occupants of a tile spread along the axis that projects to pure
// screen-x, with an alternating half-step of depth.
//
//  1. SCREEN-X IS WHERE THE ROOM IS. In this dimetric projection one world tile of travel
//     along (+1, −1) is `TILE_W` = 32 px of screen-x and ZERO screen-y; along (+1, +1) it is
//     zero screen-x and `TILE_H` = 16 px of screen-y. The horizontal axis buys twice the
//     separation for the same displacement, and a body separated only in depth is simply
//     standing behind another body — which is the defect, at a smaller scale.
//
//  2. THE ALTERNATING DEPTH STEP IS WHAT MAKES OVERLAPPING SILHOUETTES READABLE. A figure is
//     ~26 px wide and the rank's pitch is 14, so neighbours overlap. Giving adjacent slots
//     different (x + y) makes `depthSeed` order them strictly, so the nearer one paints its
//     WHOLE outline over the further one and the seam between two bodies is a hard edge
//     instead of a merge. At equal depth they would tie and be settled by id, i.e. by nothing.
//
//  3. THE OFFSET IS A WORLD OFFSET, AND THAT IS THE ENTIRE CORRECTNESS ARGUMENT. Everything
//     the renderer knows about a body — its `DepthBox`, the cull that reads that box, the
//     contact shadow, the name tag, the emote, the speech bubble — derives from ONE position.
//     Move the position and all of them follow, and the sort cannot disagree with the picture
//     because it is sorting the drawn place. A screen-space nudge applied to the sprite alone
//     would have been three lines and would have put the depth order and the cull a tile away
//     from the pixels they describe.
//
//  4. IT IS THE SAME SHAPE AT TWO AND AT TEN. A ring or a two-row huddle has to choose an
//     arrangement per count and jumps between them as one person joins. A rank with a capped
//     span degrades continuously: the step shrinks, the crowd packs tighter, and a crowd still
//     looks like a crowd.
//
// ★ AND THE RANK SPILLS PAST THE TILE, DELIBERATELY. Five people do not fit in a 32 × 16 px
// diamond at any pitch that separates them — the arithmetic is not close. They occupy the
// ground five people would actually need, which is what a viewer reads as five people
// standing together. `CROWD_SPAN_PX` is the bound on how far that may go.

/** Screen-x between adjacent bodies in a rank, in world pixels at zoom 1. Under half a
 *  drawn figure's width, so shoulders overlap the way a real group's do. */
export const CROWD_PITCH_PX = 14

/** The widest a whole rank may be, screen-x, end to end. Past five bodies the pitch shrinks
 *  to hold this, so a large crowd packs instead of marching off across the town. */
export const CROWD_SPAN_PX = 72

/** Screen-y between two ADJACENT bodies — the alternating half-step of (2). Half a tile's
 *  height: enough that the nearer figure's feet are clearly nearer, small enough that the
 *  rank still reads as one group standing on one spot. */
export const CROWD_DEPTH_PX = 8

/** How long a body takes to slide to its slot when the group re-forms. `MOTION.move`'s 180 ms
 *  is the number; it is named here rather than imported so `crowd.ts` stays free of the chrome,
 *  and `crowd.test.ts` asserts the two agree. */
export const CROWD_SETTLE_MS = 180

export type CrowdOffset = { dx: number; dy: number }

export const NO_OFFSET: CrowdOffset = { dx: 0, dy: 0 }

/**
 * The world-space offset for occupant `i` of `n` sharing one tile.
 *
 * `i` is the body's index in the tile's occupant list SORTED BY AGENT ID, never by arrival:
 * two browsers watching the same tick must lay the same crowd out, which is the rule
 * `interiorOf` already follows for a room's occupants.
 */
export function crowdOffset(i: number, n: number): CrowdOffset {
  if (n <= 1 || i < 0 || i >= n) return NO_OFFSET
  const pitch = Math.min(CROWD_PITCH_PX, CROWD_SPAN_PX / (n - 1))
  const sx = (i - (n - 1) / 2) * pitch
  // Alternating, and centred on zero, so the rank's own middle stays on the tile it belongs to.
  const sy = (i % 2 === 0 ? -1 : 1) * (CROWD_DEPTH_PX / 2)
  return screenToWorldOffset(sx, sy)
}

/**
 * The inverse of `tileToScreen`'s linear part: the world offset that draws at (`sx`, `sy`).
 * `sx = (dx − dy)·TILE_W/2` and `sy = (dx + dy)·TILE_H/2`, so `dx = (a + b)/2` and
 * `dy = (b − a)/2` with `a = 2·sx/TILE_W` and `b = 2·sy/TILE_H`.
 */
export function screenToWorldOffset(sx: number, sy: number): CrowdOffset {
  const a = (2 * sx) / TILE_W
  const b = (2 * sy) / TILE_H
  return { dx: (a + b) / 2, dy: (b - a) / 2 }
}

/**
 * Who is standing where, as slot indices. Only SETTLED bodies take a slot: a body walking
 * through a group walks through it, and the group does not shuffle aside for somebody who is
 * not stopping. It joins when it stops, which is when it has actually joined.
 *
 * Returns the offset for every settled body, keyed by id. A body absent from the map is drawn
 * exactly where the record puts it.
 */
export function crowdOffsets(
  bodies: ReadonlyArray<{ id: string; x: number; y: number; settled: boolean }>,
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

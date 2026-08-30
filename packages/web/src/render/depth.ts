import { CELL, CHAR_TARGET_PX, FEET_Y } from './charAnim.js'
import { feetOf } from './iso.js'
import { BUILDING_PX_PER_TILE } from './textures.js'

// The sort is GEOMETRIC: a drawable declares its ground in tile-EDGE coordinates — tile (x, y)
// spans [x − 0.5, x + 0.5] × [y − 0.5, y + 0.5] — and a body's box follows its interpolated
// position unrounded. Where geometry has nothing to say, a scalar seed decides.

/** Who wins when two drawables stand on the SAME ground. A body in a doorway is in FRONT of
 *  the building it is standing in, never inside it; an item on the floor is under both. */
export const OVERLAP_RANK = { ground: 0, structure: 1, body: 2 } as const
type OverlapRank = (typeof OVERLAP_RANK)[keyof typeof OVERLAP_RANK]

export type DepthBox = {
  id: string
  /** OVERLAP_RANK — consulted only when two boxes share ground */
  rank: OverlapRank
  /** the ground it stands on, in tile-EDGE coordinates — floats, never rounded */
  x0: number
  y0: number
  x1: number
  y1: number
  /** screen AABB of the DRAWN sprite, which may overhang the footprint by ~1.85×.
   *  Broad phase only: it decides whether two things CAN overlap, never who wins. */
  sx0: number
  sy0: number
  sx1: number
  sy1: number
}

/** `a` is strictly nearer the viewer than `b`. Both +x and +y run toward the camera in dimetric, so "nearer" is "past the far edge on either world axis", and touching edges count. */
export function inFrontOf(a: DepthBox, b: DepthBox): boolean {
  return a.x0 >= b.x1 || a.y0 >= b.y1
}

export function screenOverlap(a: DepthBox, b: DepthBox): boolean {
  return a.sx0 < b.sx1 && b.sx0 < a.sx1 && a.sy0 < b.sy1 && b.sy0 < a.sy1
}

/** The two are standing on some of the same ground — a body mid-way through a doorway. */
function groundOverlap(a: DepthBox, b: DepthBox): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
}

/** The stable seed: the nearest corner, exactly the scalar C10 shipped. Kept as the tiebreak
 *  so the new order degrades to the old one wherever the old one was already right. */
export function depthSeed(b: DepthBox): number {
  return (b.x1 + b.y1) * 1000 + b.x1
}

/** Above this many drawables the topological pass is skipped and the seed order stands. Timed on the ring-grammar fixture: 256 boxes is 0.27 ms a frame, 512 is 0.96 ms, 640 is 1.53 ms. */
export const DEPTH_BUDGET = 512

// Sprites overhang their footprint, so three of them CAN overlap in a pinwheel whose constraints
// form a cycle. The survivors are then appended in seed order, and every occurrence is counted.
let fallbackFrames = 0
let fallbackNodes = 0

export type DepthFallbacks = { frames: number; nodes: number }
export function depthFallbacks(): DepthFallbacks {
  return { frames: fallbackFrames, nodes: fallbackNodes }
}
export function resetDepthFallbacks(): void {
  fallbackFrames = 0
  fallbackNodes = 0
}

/** Which of an overlapping pair is drawn LAST, or `null` when geometry has nothing to say. Injectable so the cycle fallback can be exercised: no AABB arrangement produces a cycle. */
export type EdgeRule = (a: DepthBox, b: DepthBox) => DepthBox | null

export const geometricEdge: EdgeRule = (a, b) => {
  if (!screenOverlap(a, b)) return null // cannot occlude ⇒ no constraint
  // Standing ON it beats standing NEAR it: neither box is past the other's far edge when a
  // body is in a doorway, and the seed would then bury the body inside the wall.
  if (groundOverlap(a, b) && a.rank !== b.rank) return a.rank > b.rank ? a : b
  const aFront = inFrontOf(a, b),
    bFront = inFrontOf(b, a)
  if (aFront === bFront) return null // level, or mutually diagonal ⇒ seed decides
  return aFront ? a : b
}

/** Painter's order, back to front, as ids. Deterministic: two calls on the same input agree,
 *  and the order the input arrives in does not matter. */
export function depthOrder(boxes: readonly DepthBox[], edge: EdgeRule = geometricEdge): string[] {
  const seeded = [...boxes].sort((a, b) => depthSeed(a) - depthSeed(b) || (a.id < b.id ? -1 : 1))
  const n = seeded.length
  if (n > DEPTH_BUDGET) {
    fallbackFrames++
    fallbackNodes += n
    return seeded.map((b) => b.id)
  }

  const after: number[][] = seeded.map(() => []) // i must be drawn BEFORE each j in after[i]
  const indeg = new Array<number>(n).fill(0)
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = seeded[i]!,
        b = seeded[j]!
      const front = edge(a, b)
      if (front === null) continue
      if (front === b) {
        after[i]!.push(j)
        indeg[j]!++
      } else {
        after[j]!.push(i)
        indeg[i]!++
      }
    }
  }

  // Ready nodes are taken in SEED order, so with no constraints the output IS the seed order.
  const out: string[] = []
  const ready: number[] = []
  for (let i = 0; i < n; i++) if (indeg[i] === 0) ready.push(i)
  while (ready.length > 0) {
    // The smallest seed index, taken by a scan and a swap-with-last: a comparator sort plus a
    // shift per iteration was the same choice at n comparator calls and an n-element memmove.
    let k = 0
    for (let m = 1; m < ready.length; m++) if (ready[m]! < ready[k]!) k = m
    const i = ready[k]!
    ready[k] = ready[ready.length - 1]!
    ready.pop()
    out.push(seeded[i]!.id)
    for (const j of after[i]!) {
      const left = indeg[j]! - 1
      indeg[j] = left
      if (left === 0) ready.push(j)
    }
  }
  if (out.length < n) {
    fallbackFrames++
    fallbackNodes += n - out.length
    for (let i = 0; i < n; i++) if (indeg[i]! > 0) out.push(seeded[i]!.id)
  }
  return out
}

// ── the two box shapes the world actually contains ───────────────────────────────────────

const BODY_SCALE = CHAR_TARGET_PX / 64
/** The drawn figure's own extent, derived from the sheet geometry rather than guessed. */
export const BODY_SPRITE_W = CELL * BODY_SCALE
const BODY_ABOVE_FEET_PX = FEET_Y * BODY_SCALE
const BODY_BELOW_FEET_PX = (CELL - FEET_Y) * BODY_SCALE

/** A body stands on ONE tile, at its interpolated position — no rounding anywhere (F-3c). */
export function bodyDepthBox(id: string, px: number, py: number): DepthBox {
  const { sx, sy } = feetOf(px, py)
  return {
    id,
    rank: OVERLAP_RANK.body,
    x0: px - 0.5,
    y0: py - 0.5,
    x1: px + 0.5,
    y1: py + 0.5,
    sx0: sx - BODY_SPRITE_W / 2,
    sy0: sy - BODY_ABOVE_FEET_PX,
    sx1: sx + BODY_SPRITE_W / 2,
    sy1: sy + BODY_BELOW_FEET_PX,
  }
}

/** A building stands on a RANGE of tiles (F-3a), and its sprite overhangs that ground by up
 *  to 1.85× — which is why the screen box and the ground box are two different things. */
export function structureDepthBox(
  id: string,
  s: { x: number; y: number; w: number; h: number },
): DepthBox {
  const ground = feetOf(s.x, s.y, s.w, s.h)
  const side = (s.w + s.h) * BUILDING_PX_PER_TILE
  return {
    id,
    rank: OVERLAP_RANK.structure,
    x0: s.x - 0.5,
    y0: s.y - 0.5,
    x1: s.x + s.w - 0.5,
    y1: s.y + s.h - 0.5,
    sx0: ground.sx - side / 2,
    sy0: ground.sy - side,
    sx1: ground.sx + side / 2,
    sy1: ground.sy,
  }
}

/** An item or a crop: one tile of ground, a small sprite. */
export function tileDepthBox(id: string, x: number, y: number, spritePx = 24): DepthBox {
  const { sx, sy } = feetOf(x, y)
  return {
    id,
    rank: OVERLAP_RANK.ground,
    x0: x - 0.5,
    y0: y - 0.5,
    x1: x + 0.5,
    y1: y + 0.5,
    sx0: sx - spritePx / 2,
    sy0: sy - spritePx,
    sx1: sx + spritePx / 2,
    sy1: sy,
  }
}

import { CELL, CHAR_TARGET_PX, FEET_Y } from './charAnim.js'
import { TILE_H, tileToScreen } from './iso.js'
import { BUILDING_PX_PER_TILE } from './textures.js'

// THE DEPTH SORT, REWRITTEN (U8, plan task 70).
//
// U8 asked for a review of the layering, not a patch, and the review found THREE independent
// faults in one scalar:
//   (a) a footprint was treated as a SCALAR — a 2×2 hut sorted from its far corner only, so
//       the four tiles it actually occupies had no say;
//   (b) the `+x` tiebreak produced EXACT TIES — a body at tile (20,22) and a 2×2 hut at
//       (20,20) both computed 42021, and a tie in a sortableChildren container is resolved by
//       insertion order, i.e. by nothing;
//   (c) a body's depth was ROUNDED (`depthKey(Math.round(px), Math.round(py))`) while its
//       position was not, so a walking body's order POPPED half a tile away from where its
//       feet were.
//
// The replacement sorts GEOMETRY. Every drawable declares the ground it stands on in
// tile-EDGE coordinates — tile (x, y) spans [x − 0.5, x + 0.5] × [y − 0.5, y + 0.5] — and a
// body's box follows its interpolated position with no rounding, which is what removes the
// pop. Pairs that can visually overlap become edges in a graph, and a topological pass over
// that graph produces the paint order. Where geometry has nothing to say, the old scalar is
// the seed, so the new order degrades to the old one exactly where the old one was right.

export type DepthBox = {
  id: string
  /** the ground it stands on, in tile-EDGE coordinates — floats, never rounded */
  x0: number; y0: number; x1: number; y1: number
  /** screen AABB of the DRAWN sprite, which may overhang the footprint by ~1.85×.
   *  Broad phase only: it decides whether two things CAN overlap, never who wins. */
  sx0: number; sy0: number; sx1: number; sy1: number
}

/** `a` is strictly nearer the viewer than `b`. In dimetric both +x and +y run toward the
 *  camera, so "nearer" is "past the far edge on either world axis". Touching edges count:
 *  a body on the tile immediately south of a hut IS in front of it. */
export function inFrontOf(a: DepthBox, b: DepthBox): boolean {
  return a.x0 >= b.x1 || a.y0 >= b.y1
}

export function screenOverlap(a: DepthBox, b: DepthBox): boolean {
  return a.sx0 < b.sx1 && b.sx0 < a.sx1 && a.sy0 < b.sy1 && b.sy0 < a.sy1
}

/** The stable seed: the nearest corner, exactly the scalar C10 shipped. Kept as the tiebreak
 *  so the new order degrades to the old one wherever the old one was already right. */
export function depthSeed(b: DepthBox): number {
  return (b.x1 + b.y1) * 1000 + b.x1
}

/** Above this many drawables in one frame the topological pass is skipped and the seed order
 *  stands. Culling keeps the live count far below it; the cap exists so a pathological frame
 *  degrades instead of stalling. */
export const DEPTH_BUDGET = 256

// THE COUNTED FALLBACK (ratified substitute for "cycles are impossible"). With sprites that
// overhang their footprint by 1.85×, three of them CAN overlap in a pinwheel whose
// constraints form a cycle. That is not a crash and it is not a guess: the survivors are
// appended in seed order — the behaviour this replaces — and every occurrence is counted,
// because a number nobody reads is not a safeguard. G12c cites this count.
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

/** Which of an overlapping pair must be drawn LAST, or `null` when geometry has nothing to
 *  say and the seed decides. Injectable so the cycle fallback can be exercised: no AABB
 *  arrangement produces a cycle (see depth.test.ts), and an untested branch is not a
 *  safeguard. */
export type EdgeRule = (a: DepthBox, b: DepthBox) => DepthBox | null

export const geometricEdge: EdgeRule = (a, b) => {
  if (!screenOverlap(a, b)) return null            // cannot occlude ⇒ no constraint
  const aFront = inFrontOf(a, b), bFront = inFrontOf(b, a)
  if (aFront === bFront) return null               // level, or mutually diagonal ⇒ seed decides
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

  const after: number[][] = seeded.map(() => [])   // i must be drawn BEFORE each j in after[i]
  const indeg = new Array<number>(n).fill(0)
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = seeded[i]!, b = seeded[j]!
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
    ready.sort((p, q) => p - q)
    const i = ready.shift()!
    out.push(seeded[i]!.id)
    for (const j of after[i]!) if (--indeg[j]! === 0) ready.push(j)
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
export const BODY_ABOVE_FEET_PX = FEET_Y * BODY_SCALE
export const BODY_BELOW_FEET_PX = (CELL - FEET_Y) * BODY_SCALE

/** A body stands on ONE tile, at its interpolated position — no rounding anywhere (F-3c). */
export function bodyDepthBox(id: string, px: number, py: number): DepthBox {
  const { sx, sy } = tileToScreen(px, py)
  return {
    id,
    x0: px - 0.5, y0: py - 0.5, x1: px + 0.5, y1: py + 0.5,
    sx0: sx - BODY_SPRITE_W / 2, sy0: sy - BODY_ABOVE_FEET_PX,
    sx1: sx + BODY_SPRITE_W / 2, sy1: sy + BODY_BELOW_FEET_PX,
  }
}

/** A building stands on a RANGE of tiles (F-3a), and its sprite overhangs that ground by up
 *  to 1.85× — which is why the screen box and the ground box are two different things. */
export function structureDepthBox(
  id: string, s: { x: number; y: number; w: number; h: number },
): DepthBox {
  const ground = tileToScreen(s.x + s.w / 2 - 0.5, s.y + s.h / 2 - 0.5)
  const side = (s.w + s.h) * BUILDING_PX_PER_TILE
  return {
    id,
    x0: s.x - 0.5, y0: s.y - 0.5, x1: s.x + s.w - 0.5, y1: s.y + s.h - 0.5,
    sx0: ground.sx - side / 2, sy0: ground.sy - side,
    sx1: ground.sx + side / 2, sy1: ground.sy + ((s.w + s.h) * TILE_H) / 2,
  }
}

/** An item or a crop: one tile of ground, a small sprite. */
export function tileDepthBox(id: string, x: number, y: number, spritePx = 24): DepthBox {
  const { sx, sy } = tileToScreen(x, y)
  return {
    id,
    x0: x - 0.5, y0: y - 0.5, x1: x + 0.5, y1: y + 0.5,
    sx0: sx - spritePx / 2, sy0: sy - spritePx, sx1: sx + spritePx / 2, sy1: sy + TILE_H / 2,
  }
}

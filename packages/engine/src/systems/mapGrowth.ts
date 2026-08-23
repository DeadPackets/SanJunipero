import {
  edgesOwed, simTimeFromTick, TOWN_RINGS_GENESIS, WORLD_MARGIN, worldSizeForRings,
} from '@sj/shared'
import { genesisTerrainAt } from '../genesis/world.js'
import { authoredOrigin, type WorldState } from '../state.js'
import { townGroundBox } from '../town.js'
import type { TickCtx } from '../worldTick.js'

// ★ THE WORLD IS AS BIG AS WHAT STANDS IN IT, PLUS A BLOCK PITCH OF WILD.
//
// The map grows because the town does — the landed ruling, and it holds. What changed is the
// rule underneath it. Growth used to be a COUNTER against a CEILING: sixteen more tiles every
// twelve buildings, on an n-e-s-w cycle, stopping dead at 192. Both halves were wrong. The
// cycle widened edges the town was nowhere near while the edge it was crowding waited three
// nights for its turn, and the ceiling was a round number in a grammar that plats rings
// forever — the same bug with a later fuse.
//
// What decides it now is a CLEARANCE, read off the built set: the world owes every side of
// everything standing one block pitch of ground, and it widens whichever side it is short on.
// There is no maximum, because a clearance has none. It is also the same measurement the
// camera's bounds, the minimap's scale and the cull already derive, so nothing in this file
// knows a map size either.

export const GROWTH_EDGES = ['n', 'e', 's', 'w'] as const
export type GrowthEdge = (typeof GROWTH_EDGES)[number]

export const growsHeight = (edge: GrowthEdge): boolean => edge === 'n' || edge === 's'

// ★ A WORLD TOO SMALL TO HOLD A TOWN AT ALL IS A FIXTURE, NOT A WORLD. Every landed test map is
// a few dozen tiles on a side with a roof in the middle, and a clearance read literally would
// widen every one of them, forever, because they can never pay a block pitch on four sides.
// This is the same trap `growthsSoFar` below documents — the plan's size-derived counter went
// negative on fixtures and grew maps nobody asked to grow — so the floor is DERIVED and not
// guessed: the smallest world a town of one ring needs is the smallest world this rule has
// anything to say about.
export const GROWABLE_FLOOR = worldSizeForRings(TOWN_RINGS_GENESIS)

// The one reader of the growth count (G4). The plan derived it from the map's size against
// `world.size`; that is only meaningful for a world that started at genesis size, and every
// landed fixture is a small map on the default config — the derivation went negative there and
// grew maps nobody asked to grow. A counter, absent until the first growth, is well defined
// for any starting size and leaves the hash of a world that never widens exactly where it was.
export function growthsSoFar(state: WorldState): number {
  return state.growths ?? 0
}

export { authoredOrigin }

/** The tile box of everything built, in array coordinates. `null` when nothing stands: an
 *  empty world owes nobody ground. Structures only — agents walk, and a world that widened
 *  because somebody wandered to the edge would widen forever. */
export function builtBox(state: WorldState): { dx0: number; dy0: number; dx1: number; dy1: number } | null {
  const all = Object.values(state.structures)
  if (all.length === 0) return null
  let dx0 = Infinity, dy0 = Infinity, dx1 = -Infinity, dy1 = -Infinity
  for (const s of all) {
    dx0 = Math.min(dx0, s.x); dy0 = Math.min(dy0, s.y)
    dx1 = Math.max(dx1, s.x + s.w - 1); dy1 = Math.max(dy1, s.y + s.h - 1)
  }
  return { dx0, dy0, dx1, dy1 }
}

/** ★ THE STRIP IS THE WORLD CONTINUED, NOT NOISE BESIDE IT. `genesisTerrainAt` is a pure
 *  function of an authored coordinate with no bounds in it at all — the world was always
 *  infinite and the array was only ever how much of it had been written down. So the river
 *  runs on past the old edge, the forest keeps its ragged line, and nothing already standing
 *  is regenerated: the ford, the lake fork and the forage nodes are never recomputed, only
 *  carried by the same shift that carries every other coordinate. */
export function grownStrip(
  state: WorldState, edge: GrowthEdge, depth: number,
): number[][] {
  const h = state.terrain.length
  const w = state.terrain[0]!.length
  const before = authoredOrigin(state)
  // The array's origin moves before the strip is laid, so the strip is addressed in the frame
  // the world will be in once it has grown.
  const ox = before.x - (edge === 'w' ? depth : 0)
  const oy = before.y - (edge === 'n' ? depth : 0)
  const rows = growsHeight(edge) ? depth : h
  const cols = growsHeight(edge) ? w : depth
  // Where the strip's own (0, 0) sits in the grown array.
  const atX = edge === 'e' ? w : 0
  const atY = edge === 's' ? h : 0
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => genesisTerrainAt(atX + c + ox, atY + r + oy) as number))
}

/**
 * ★ WHAT THE WORLD OWES CLEARANCE TO: everything standing, AND the ground the town has laid.
 *
 * This lane measured it from the built set alone and it under-measured by exactly `STREET`.
 * The outermost roof stands three tiles inside its own kerb, so a world that owes one pitch
 * past the last roof owes three tiles less than one pitch past the last street — and the next
 * ring's far street band lands in precisely those three tiles. Measured, ring 1 → ring 2: the
 * last roof is at y 112 and ring 2's far band ends at 134, which is PITCH + STREET beyond it.
 * The town could plat a ring it could then never lay.
 *
 * That is this file's own C-5, and it is paid here rather than by rounding `WORLD_MARGIN` up:
 * the margin is still exactly one block pitch, the thing it is measured FROM is now the whole
 * town rather than its roofs. A world with no town in it is unchanged, which is why every
 * fixture and G2 hash exactly where they did.
 */
export function owedBox(state: WorldState): { dx0: number; dy0: number; dx1: number; dy1: number } | null {
  const built = builtBox(state)
  const town = townGroundBox(state)
  if (built === null) return town
  if (town === null) return built
  return {
    dx0: Math.min(built.dx0, town.dx0), dy0: Math.min(built.dy0, town.dy0),
    dx1: Math.max(built.dx1, town.dx1), dy1: Math.max(built.dy1, town.dy1),
  }
}

export function mapGrowthSystem(ctx: TickCtx): void {
  if (!ctx.config.mapGrowth.enabled) return
  const state = ctx.state()
  const time = simTimeFromTick(state.tick)
  if (time.hour !== 0 || time.minute !== 0 || state.tick === 0) return

  const box = owedBox(state)
  if (box === null) return
  const w = state.terrain[0]!.length, h = state.terrain.length
  if (w < GROWABLE_FLOOR || h < GROWABLE_FLOOR) return
  const owed = edgesOwed(box, { w, h }, WORLD_MARGIN)
  // One edge a night. The margin is a whole block pitch, so the world is never short of the
  // ground the next ring needs while it works through more than one of them.
  const first = owed[0]
  if (first === undefined) return
  ctx.emit('world_grown', {
    edge: first.edge, depth: first.owed, tiles: grownStrip(state, first.edge, first.owed),
  })
}

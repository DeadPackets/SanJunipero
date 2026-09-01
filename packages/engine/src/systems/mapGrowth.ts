import {
  edgesOwed,
  simTimeFromTick,
  TOWN_RINGS_GENESIS,
  WORLD_MARGIN,
  worldSizeForRings,
} from '@sj/shared'
import { genesisTerrainAt } from '../geography.js'
import { authoredOrigin, type WorldState } from '../state.js'
import { townGroundBox } from '../town.js'
import type { TickCtx } from '../tickCtx.js'

// Growth is a clearance, not a counter against a ceiling: the world owes every side of
// everything standing one block pitch, and widens whichever side it is short on. No maximum.

export const GROWTH_EDGES = ['n', 'e', 's', 'w'] as const
export type GrowthEdge = (typeof GROWTH_EDGES)[number]

export const growsHeight = (edge: GrowthEdge): boolean => edge === 'n' || edge === 's'

// Every landed fixture is a few dozen tiles with a roof in the middle and can never pay a block
// pitch on four sides, so the floor is DERIVED: the smallest world a town of one ring needs.
export const GROWABLE_FLOOR = worldSizeForRings(TOWN_RINGS_GENESIS)

// A counter, absent until the first growth. Deriving it from the map's size went negative on
// fixtures and grew maps nobody asked to grow; this leaves a never-widened world's hash alone.
export function growthsSoFar(state: WorldState): number {
  return state.growths ?? 0
}

export { authoredOrigin }

/** The tile box of everything built, in array coordinates; null when nothing stands. Structures
 *  only — a world that widened because somebody wandered to the edge would widen forever. */
export function builtBox(
  state: WorldState,
): { dx0: number; dy0: number; dx1: number; dy1: number } | null {
  const all = Object.values(state.structures)
  if (all.length === 0) return null
  let dx0 = Infinity,
    dy0 = Infinity,
    dx1 = -Infinity,
    dy1 = -Infinity
  for (const s of all) {
    dx0 = Math.min(dx0, s.x)
    dy0 = Math.min(dy0, s.y)
    dx1 = Math.max(dx1, s.x + s.w - 1)
    dy1 = Math.max(dy1, s.y + s.h - 1)
  }
  return { dx0, dy0, dx1, dy1 }
}

/** genesisTerrainAt is a pure function of an authored coordinate with no bounds in it, so the
 *  strip is the world continued. Nothing already standing is regenerated, only shifted. */
export function grownStrip(state: WorldState, edge: GrowthEdge, depth: number): number[][] {
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
    Array.from({ length: cols }, (_, c) => genesisTerrainAt(atX + c + ox, atY + r + oy) as number),
  )
}

/** Measured from the whole town, streets included, not from the built set: the outermost roof
 *  stands STREET inside its own kerb, so the next ring's far band lands in exactly those tiles. */
export function owedBox(
  state: WorldState,
): { dx0: number; dy0: number; dx1: number; dy1: number } | null {
  const built = builtBox(state)
  const town = townGroundBox(state)
  if (built === null) return town
  if (town === null) return built
  return {
    dx0: Math.min(built.dx0, town.dx0),
    dy0: Math.min(built.dy0, town.dy0),
    dx1: Math.max(built.dx1, town.dx1),
    dy1: Math.max(built.dy1, town.dy1),
  }
}

export function mapGrowthSystem(ctx: TickCtx): void {
  if (!ctx.config.mapGrowth.enabled) return
  const state = ctx.state()
  const time = simTimeFromTick(state.tick)
  if (time.hour !== 0 || time.minute !== 0 || state.tick === 0) return

  const box = owedBox(state)
  if (box === null) return
  const w = state.terrain[0]!.length,
    h = state.terrain.length
  if (w < GROWABLE_FLOOR || h < GROWABLE_FLOOR) return
  const owed = edgesOwed(box, { w, h }, WORLD_MARGIN)
  // One edge a night. The margin is a whole block pitch, so the world is never short of the
  // ground the next ring needs while it works through more than one of them.
  const first = owed[0]
  if (first === undefined) return
  ctx.emit('world_grown', {
    edge: first.edge,
    depth: first.owed,
    tiles: grownStrip(state, first.edge, first.owed),
  })
}

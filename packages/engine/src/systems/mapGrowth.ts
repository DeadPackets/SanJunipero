import { simTimeFromTick } from '@sj/shared'
import type { WorldState } from '../state.js'
import type { TickCtx } from '../worldTick.js'

// The map grows because the town does. Growth is triggered by completed buildings, not by
// population: births make population a lagging, noisier signal (addendum deviation 7).

export const GROWTH_EDGES = ['n', 'e', 's', 'w'] as const
export type GrowthEdge = (typeof GROWTH_EDGES)[number]

export const growsHeight = (edge: GrowthEdge): boolean => edge === 'n' || edge === 's'

// The one reader of the growth count (G4). The plan derived it from the map's size against
// `world.size`; that is only meaningful for a world that started at genesis size, and every
// landed fixture is a small map on the default config — the derivation went negative there and
// grew maps nobody asked to grow. A counter, absent until the first growth, is well defined
// for any starting size and leaves the hash of a world that never widens exactly where it was.
export function growthsSoFar(state: WorldState): number {
  return state.growths ?? 0
}

// Wilderness beyond the edge: mostly open ground, some trees, the odd outcrop. Rolled at
// emission from the `worldgen` stream and carried in the payload, so replay never re-rolls.
function rollTile(roll: number): number {
  if (roll < 70) return 0
  if (roll < 90) return 3
  if (roll < 97) return 4
  return 1
}

export function mapGrowthSystem(ctx: TickCtx): void {
  const cfg = ctx.config.mapGrowth
  if (!cfg.enabled) return
  const state = ctx.state()
  const time = simTimeFromTick(state.tick)
  if (time.hour !== 0 || time.minute !== 0 || state.tick === 0) return

  const done = Object.values(state.structures).filter((s) => s.stage === 'complete').length
  const index = growthsSoFar(state)
  if (done < cfg.structuresPerStep * (index + 1)) return

  const h = state.terrain.length
  const w = state.terrain[0]!.length
  // The cycle is n -> e -> s -> w by growth index; a capped axis is skipped, not waited on,
  // so a world that has hit maxSize on one axis can still grow on the other.
  let edge: GrowthEdge | null = null
  for (let i = 0; i < GROWTH_EDGES.length; i++) {
    const candidate = GROWTH_EDGES[(index + i) % GROWTH_EDGES.length]!
    if ((growsHeight(candidate) ? h : w) + cfg.step <= cfg.maxSize) { edge = candidate; break }
  }
  if (edge === null) return

  const rng = ctx.rng.get('worldgen')
  const rows = growsHeight(edge) ? cfg.step : h
  const cols = growsHeight(edge) ? w : cfg.step
  const tiles = Array.from({ length: rows }, () => Array.from({ length: cols }, () => rollTile(rng.int(100))))
  ctx.emit('world_grown', { edge, depth: cfg.step, tiles })
}

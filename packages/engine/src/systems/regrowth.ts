import { MINUTES_PER_DAY, simTimeFromTick, T_FOREST, T_GRASS, T_SAPLING } from '@sj/shared'
import { fromTileKey, type TileId, type WorldState } from '../state.js'
import type { TickCtx } from '../worldTick.js'

// Scarcity is a cycle, not a one-way death. The seeding is a roll from the `regrowth` stream at
// emission; the maturing is arithmetic on the day the seed was stamped, so the fold stays pure.

const ORTHOGONAL: readonly (readonly [number, number])[] = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
]

// Seed fall is a thing that happens between touching tiles, not across a corner.
function beside(state: WorldState, x: number, y: number, tile: TileId): boolean {
  return ORTHOGONAL.some(([dx, dy]) => state.terrain[y + dy]?.[x + dx] === tile)
}

export function regrowthSystem(ctx: TickCtx): void {
  const cfg = ctx.config.regrowth
  if (!cfg.enabled) return
  const time = simTimeFromTick(ctx.state().tick)
  if (time.hour !== 0 || time.minute !== 0) return
  const day = Math.floor(ctx.state().tick / MINUTES_PER_DAY)

  // What was planted long enough ago is a wood now. Grown first, so what matured tonight is
  // already forest when the seeds fall from it.
  for (const key of Object.keys(ctx.state().saplings ?? {}).sort()) {
    if (day - ctx.state().saplings![key]! < cfg.saplingDays) continue
    const { x, y } = fromTileKey(key)
    if (ctx.state().terrain[y]?.[x] !== T_SAPLING) continue
    ctx.emit('tile_changed', { x, y, from: T_SAPLING, to: T_FOREST, reason: 'grown' })
  }

  const rng = ctx.rng.get('regrowth')
  for (let y = 0; y < ctx.state().terrain.length; y++) {
    for (let x = 0; x < ctx.state().terrain[y]!.length; x++) {
      if (ctx.state().terrain[y]![x] !== T_GRASS || !beside(ctx.state(), x, y, T_FOREST)) continue
      if (rng.next() >= cfg.saplingChancePerDay) continue
      ctx.emit('tile_changed', { x, y, from: T_GRASS, to: T_SAPLING, reason: 'seeded' })
    }
  }
}

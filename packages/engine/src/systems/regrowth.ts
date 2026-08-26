import { MINUTES_PER_DAY, simTimeFromTick } from '@sj/shared'
import type { TileId, WorldState } from '../state.js'
import type { TickCtx } from '../worldTick.js'

// Scarcity is a cycle, not a one-way death. The seeding is a roll from the `regrowth` stream at
// emission; the maturing is arithmetic on the day the seed was stamped, so the fold stays pure.

const GRASS: TileId = 0
const FOREST: TileId = 3
const SAPLING: TileId = 9

// The one spelling of a tile's name in the sparse sapling map — the same shape the
// traffic map uses, for the same reason: a 128x128 array of nothing is a hash of nothing.
export function saplingKey(x: number, y: number): string {
  return `${x},${y}`
}

export function fromSaplingKey(key: string): { x: number; y: number } {
  const comma = key.indexOf(',')
  return { x: Number(key.slice(0, comma)), y: Number(key.slice(comma + 1)) }
}

const ORTHOGONAL: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
]

// Seed fall is a thing that happens between touching tiles, not across a corner.
export function beside(state: WorldState, x: number, y: number, tile: TileId): boolean {
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
    const { x, y } = fromSaplingKey(key)
    if (ctx.state().terrain[y]?.[x] !== SAPLING) continue
    ctx.emit('tile_changed', { x, y, from: SAPLING, to: FOREST, reason: 'grown' })
  }

  const rng = ctx.rng.get('regrowth')
  for (let y = 0; y < ctx.state().terrain.length; y++) {
    for (let x = 0; x < ctx.state().terrain[y]!.length; x++) {
      if (ctx.state().terrain[y]![x] !== GRASS || !beside(ctx.state(), x, y, FOREST)) continue
      if (rng.next() >= cfg.saplingChancePerDay) continue
      ctx.emit('tile_changed', { x, y, from: GRASS, to: SAPLING, reason: 'seeded' })
    }
  }
}

import type { SimConfig } from './config.js'

// Standing water and a dug channel are the same thing to a root, a mouth and a bucket:
// one definition site for the whole world (G4).
export const WATER_TILES: ReadonlySet<number> = new Set([2, 10])

// Fertility is a distance function, never a stored gradient — the harvest and C12's overlay
// call this same function, so the ground the farmer feels and the ground the viewer draws
// can never disagree. Pure, hash-free: nothing about it is written into the world.
export function fertilityAt(terrain: number[][], x: number, y: number, config: SimConfig): number {
  const f = config.fertility
  if (!f.enabled) return 1
  const reach = Math.floor(f.radius)
  let nearest = Infinity
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const tile = terrain[y + dy]?.[x + dx]
      if (tile === undefined || !WATER_TILES.has(tile)) continue
      nearest = Math.min(nearest, Math.max(Math.abs(dx), Math.abs(dy)))
    }
  }
  if (nearest === Infinity) return 1
  return Math.min(f.maxMultiplier, 1 + f.waterBonus * (1 - nearest / (f.radius + 1)))
}

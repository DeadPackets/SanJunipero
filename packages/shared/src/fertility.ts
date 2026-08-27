import type { SimConfig } from './config.js'
import { isWet } from './tiles.js'

// A distance function, never a stored gradient: the harvest and the overlay call this same
// function, so the ground the farmer feels and the ground the viewer draws cannot disagree.
export function fertilityAt(terrain: number[][], x: number, y: number, config: SimConfig): number {
  const f = config.fertility
  if (!f.enabled) return 1
  const reach = Math.floor(f.radius)
  let nearest = Infinity
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const tile = terrain[y + dy]?.[x + dx]
      if (tile === undefined || !isWet(tile)) continue
      nearest = Math.min(nearest, Math.max(Math.abs(dx), Math.abs(dy)))
    }
  }
  if (nearest === Infinity) return 1
  return Math.min(f.maxMultiplier, 1 + f.waterBonus * (1 - nearest / (f.radius + 1)))
}

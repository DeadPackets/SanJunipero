import { simTimeFromTick } from '@sj/shared'
import type { TickCtx } from '../worldTick.js'

// Standing things with a stock, which the town can strip and the ground slowly puts back — never
// in winter, which is the whole of why a winter larder has to be filled in autumn.

// Not a dial (SimConfigSchema is closed after Task 2): how often a stripped patch puts back
// one handful of what was taken.
export const FORAGE_REGROW_CHANCE = 0.2

// What this node climbs back toward. A node from a log written before the ceiling existed
// keeps the old behaviour and stops at one.
export function fullStockOf(node: { fullStock?: number }): number {
  return node.fullStock ?? 1
}

export function forageSystem(ctx: TickCtx): void {
  const time = simTimeFromTick(ctx.state().tick)
  if (time.hour !== 6 || time.minute !== 0) return
  if (time.season === 'winter') return
  const rng = ctx.rng.get('forage')
  for (const id of Object.keys(ctx.state().forageables ?? {}).sort()) {
    const node = ctx.state().forageables![id]!
    if (node.stock >= fullStockOf(node)) continue
    if (rng.next() >= FORAGE_REGROW_CHANCE) continue
    ctx.emit('forageable_regrown', { id, stock: node.stock + 1 })
  }
}

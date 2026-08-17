import { simTimeFromTick } from '@sj/shared'
import type { TickCtx } from '../worldTick.js'

// The berries, the mushrooms, the clay and the loose stone: standing things with a stock, which
// the town can strip and the ground slowly puts back — never in winter, which is the whole of
// why a winter larder has to be filled in autumn.

// Not a dial (SimConfigSchema is closed after Task 2): how often a bare patch comes back.
export const FORAGE_REGROW_CHANCE = 0.2

export function forageSystem(ctx: TickCtx): void {
  const time = simTimeFromTick(ctx.state().tick)
  if (time.hour !== 6 || time.minute !== 0) return
  if (time.season === 'winter') return
  const rng = ctx.rng.get('forage')
  for (const id of Object.keys(ctx.state().forageables ?? {}).sort()) {
    if (ctx.state().forageables![id]!.stock > 0) continue
    if (rng.next() >= FORAGE_REGROW_CHANCE) continue
    ctx.emit('forageable_regrown', { id, stock: 1 })
  }
}

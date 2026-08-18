import type { TickCtx } from '../worldTick.js'

// Fuel is the whole of the mechanic: a torch is light for as long as somebody paid for it, and
// the tick after that it is ash. Zero RNG — the fuel clock is arithmetic on the tick it was lit.

export function lightingSystem(ctx: TickCtx): void {
  if (!ctx.config.light.enabled) return
  const tick = ctx.state().tick
  for (const id of Object.keys(ctx.state().items).sort()) {
    const until = ctx.state().items[id]!.litUntilTick
    if (until === undefined || until >= tick) continue
    ctx.emit('item_burned_out', { itemId: id })
  }
}

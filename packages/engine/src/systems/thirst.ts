import { thirstDecayPerTick } from '@sj/shared'
import { thirstOf } from '../state.js'
import type { TickCtx } from '../tickCtx.js'

// The slower clock. Thirst is deliberately not one of the four needs: widening that enum
// would change what every recorded log means, so it gets its own event and its own decay.
export function thirstSystem(ctx: TickCtx): void {
  if (!ctx.config.thirst.enabled) return
  const decay = thirstDecayPerTick(ctx.config)
  for (const id of Object.keys(ctx.state().agents).sort()) {
    const a = ctx.state().agents[id]!
    if (!a.alive || thirstOf(a) <= 0) continue
    ctx.emit('thirst_changed', { id, delta: -decay })
  }
}

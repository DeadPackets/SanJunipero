import { thirstDecayPerTick } from '@sj/shared'
import { thirstOf } from '../state.js'
import type { TickCtx } from '../tickCtx.js'
import { queueNeed } from './needsBatch.js'

// Thirst is deliberately not one of the four needs: its own field, its own decay. It rides the
// same batch, so a tick is still one event per body.
export function thirstSystem(ctx: TickCtx): void {
  if (!ctx.config.thirst.enabled) return
  const decay = thirstDecayPerTick(ctx.config)
  for (const id of Object.keys(ctx.state().agents).sort()) {
    const a = ctx.state().agents[id]!
    if (!a.alive || thirstOf(a) <= 0) continue
    queueNeed(ctx, id, 'thirst', -decay)
  }
}

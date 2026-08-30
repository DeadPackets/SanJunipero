import { thirstDecayPerTick } from '@sj/shared'
import { thirstOf } from '../state.js'
import type { TickCtx } from '../tickCtx.js'
import { queueNeed } from './needsBatch.js'

// The slower clock. Thirst is deliberately not one of the four needs — it keeps its own field
// on the body and its own decay — but it rides the same batch, so a tick is one event per body.
export function thirstSystem(ctx: TickCtx): void {
  if (!ctx.config.thirst.enabled) return
  const decay = thirstDecayPerTick(ctx.config)
  for (const id of Object.keys(ctx.state().agents).sort()) {
    const a = ctx.state().agents[id]!
    if (!a.alive || thirstOf(a) <= 0) continue
    queueNeed(ctx, id, 'thirst', -decay)
  }
}

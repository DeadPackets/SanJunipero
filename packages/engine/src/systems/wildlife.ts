import { simTimeFromTick } from '@sj/shared'
import type { TickCtx } from '../tickCtx.js'

export function wildlifeSystem(ctx: TickCtx): void {
  const time = simTimeFromTick(ctx.state().tick)
  if (time.hour !== 6 || time.minute !== 0) return
  const cfg = ctx.config.wildlife
  const w = ctx.state().wildlife
  const fish = Math.min(cfg.fishMax, w.fish + cfg.fishRegenPerDay)
  const deer = Math.min(cfg.deerMax, w.deer + cfg.deerRegenPerDay)
  if (fish === w.fish && deer === w.deer) return
  ctx.emit('wildlife_changed', {
    ...(fish !== w.fish ? { fish } : {}),
    ...(deer !== w.deer ? { deer } : {}),
  })
}

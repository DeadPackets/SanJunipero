import { MINUTES_PER_DAY, simTimeFromTick } from '@sj/shared'
import type { TickCtx } from '../worldTick.js'

export function cropsSystem(ctx: TickCtx): void {
  const tick = ctx.state().tick
  const time = simTimeFromTick(tick)
  if (time.hour !== 6 || time.minute !== 0) return
  const day = Math.floor(tick / MINUTES_PER_DAY)
  for (const id of Object.keys(ctx.state().crops).sort()) {
    const crop = ctx.state().crops[id]!
    if (crop.withered) continue
    const def = ctx.config.crops[crop.kind]
    if (!def) continue
    if (!def.seasons.includes(time.season) || time.season === 'winter') {
      ctx.emit('crop_withered', { cropId: id })
      continue
    }
    const daysGrown = day - crop.plantedDay
    const stage = Math.min(
      def.stages - 1,
      Math.floor((daysGrown * (def.stages - 1)) / def.growthDays),
    )
    if (stage !== crop.stage) ctx.emit('crop_grew', { cropId: id, stage })
  }
}

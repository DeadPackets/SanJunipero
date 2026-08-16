import { simTimeFromTick } from '@sj/shared'
import { MYSTERIES } from '../data/mysteries.js'
import type { TickCtx } from '../worldTick.js'

// Midday, not midnight: a global mystery is felt only by the awake, and at midnight
// there is nobody awake to feel it. One roll per day, from its own named stream.
export const MYSTERY_HOUR = 12

export function mysterySystem(ctx: TickCtx): void {
  const time = simTimeFromTick(ctx.state().tick)
  if (time.hour !== MYSTERY_HOUR || time.minute !== 0) return
  const rng = ctx.rng.get('mystery')
  if (rng.next() >= ctx.config.mystery.chancePerDay) return
  const entry = MYSTERIES[rng.int(MYSTERIES.length)]!
  if (entry.scope === 'global') {
    ctx.emit('mystery_event', { kind: entry.kind })
    return
  }
  // The point is drawn only for a located entry, so the stream never moves for a global one.
  const height = ctx.state().terrain.length
  const width = ctx.state().terrain[0]?.length ?? 0
  ctx.emit('mystery_event', { kind: entry.kind, x: rng.int(width), y: rng.int(height) })
}

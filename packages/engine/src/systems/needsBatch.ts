import type { NeedChange } from '../events.def.js'
import { clampNeed, thirstOf, type AgentBody } from '../state.js'
import type { TickCtx } from '../tickCtx.js'

export type NeedName = NeedChange['need']

// The smallest step the world takes on purpose is socialDecayPerTick, 0.018. Warmth equalizes
// asymptotically, so with no floor a settled body logged a 5e-13 delta on every tick for ever.
const NEED_EPSILON = 1e-6

export function queueNeed(
  ctx: TickCtx,
  id: string,
  need: NeedName,
  delta: number,
  reason?: 'exposure',
): void {
  if (Math.abs(delta) < NEED_EPSILON) return
  const change: NeedChange = reason === undefined ? { need, delta } : { need, delta, reason }
  const queued = ctx.needs.get(id)
  if (queued === undefined) ctx.needs.set(id, [change])
  else queued.push(change)
}

// The queue has not folded yet, so a law reading what an earlier law in the same pass wrote
// has to ask here rather than off the body.
export function needAfterQueued(ctx: TickCtx, a: AgentBody, need: NeedName): number {
  let v = need === 'thirst' ? thirstOf(a) : a.needs[need]
  for (const c of ctx.needs.get(a.id) ?? []) {
    if (c.need === need) v = clampNeed(v + c.delta)
  }
  return v
}

export function flushNeedsSystem(ctx: TickCtx): void {
  for (const [id, changes] of ctx.needs) ctx.emit('needs_changed', { id, changes })
  ctx.needs.clear()
}

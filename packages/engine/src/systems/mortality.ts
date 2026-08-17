import type { WorldState } from '../state.js'
import type { TickCtx } from '../worldTick.js'
import type { SimConfig } from '@sj/shared'

// Death gets a cause because dying is arithmetic here, not a roll: every affliction on a body
// takes its own toll every tick, and the tick the total reaches the floor is the tick it dies.
// ZERO RNG in this file. What put the affliction there may have been chance; what it does is not.

export function drainPerTick(state: WorldState, config: SimConfig, agentId: string): number {
  const a = state.agents[agentId]
  if (a === undefined || !a.alive) return 0
  const { mortality } = config
  if (!mortality.enabled) return 0
  let drain = 0
  for (const x of a.afflictions ?? []) drain += mortality.drainPerTick[x.kind] * x.severity
  if (a.needs.hunger <= 0) drain += mortality.hungerHpDrainPerTick
  // Task 11 adds the thirst term here, once the body has a thirst to be at zero.
  return drain
}

export function mortalitySystem(ctx: TickCtx): void {
  if (!ctx.config.mortality.enabled) return
  for (const id of Object.keys(ctx.state().agents).sort()) {
    const drain = drainPerTick(ctx.state(), ctx.config, id)
    if (drain > 0) ctx.emit('hp_changed', { agentId: id, delta: -drain })
  }
}

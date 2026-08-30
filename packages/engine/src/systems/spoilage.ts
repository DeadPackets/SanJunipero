import { MINUTES_PER_DAY, simTimeFromTick, type SimConfig } from '@sj/shared'
import type { Item, WorldState } from '../state.js'
import type { TickCtx } from '../tickCtx.js'

export type Spoilage = { spawnDay: number; days: number }

const dayOf = (tick: number): number => Math.floor(tick / MINUTES_PER_DAY)

// A shelf life rides the item from the moment it is made or found. Kinds the
// table does not name never spoil, so wood and notes carry no key at all.
export function spoilageFor(
  state: WorldState,
  kind: string,
  config: SimConfig,
): { spoilage?: Spoilage } {
  if (!config.spoilage.enabled) return {}
  const days = config.spoilage.days[kind]
  return days === undefined ? {} : { spoilage: { spawnDay: dayOf(state.tick), days } }
}

// Read from where the thing sits *now*: shelving a loaf on its fifth day buys the
// full multiplier, and taking it back out again spends it.
export function spoilDeadline(state: WorldState, item: Item, config: SimConfig): number | null {
  if (!item.spoilage) return null
  const kind = item.loc.t === 'structure' ? state.structures[item.loc.id]?.kind : undefined
  const preserved = kind !== undefined && config.spoilage.preservingKinds.includes(kind)
  return (
    item.spoilage.spawnDay +
    item.spoilage.days * (preserved ? config.spoilage.storehouseMultiplier : 1)
  )
}

// The last day you can still eat it — deep-world's poison window reads this.
export function isSpoiling(state: WorldState, item: Item, config: SimConfig): boolean {
  if (!config.spoilage.enabled) return false
  const deadline = spoilDeadline(state, item, config)
  return deadline !== null && dayOf(state.tick) >= deadline - 1
}

export function spoilageSystem(ctx: TickCtx): void {
  if (!ctx.config.spoilage.enabled) return
  const time = simTimeFromTick(ctx.state().tick)
  if (time.hour !== 0 || time.minute !== 0) return
  const day = dayOf(ctx.state().tick)
  for (const id of Object.keys(ctx.state().items).sort()) {
    const item = ctx.state().items[id]!
    const deadline = spoilDeadline(ctx.state(), item, ctx.config)
    if (deadline !== null && day >= deadline) ctx.emit('item_spoiled', { id })
  }
}

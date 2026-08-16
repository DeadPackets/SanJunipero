import { MINUTES_PER_DAY, simTimeFromTick, type SimConfig } from '@sj/shared'
import type { AgentBody, WorldState } from '../state.js'
import type { TickCtx } from '../worldTick.js'

export type Sex = 'f' | 'm'

// Absent on the body means 'f' — the hash-stable form of a defaulted field.
export function sexOf(agent: AgentBody): Sex {
  return agent.sex ?? 'f'
}

export type PairRow = {
  nights: number
  lastNightDay: number
  formedTick: number | null
  dissolvedTick: number | null
}

export function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|')
}

// The read path C11's breakup detector uses, so nothing reaches into pairNights.
export function partnershipOf(state: WorldState, a: string, b: string): PairRow | undefined {
  return state.pairNights?.[pairKey(a, b)]
}

export function isPartnered(state: WorldState, a: string, b: string, config: SimConfig): boolean {
  const row = partnershipOf(state, a, b)
  return row !== undefined && row.nights >= config.reproduction.coSleepNightsToPartner
}

export function reproductionSystem(ctx: TickCtx): void {
  if (!ctx.config.reproduction.enabled) return
  const time = simTimeFromTick(ctx.state().tick)
  if (time.hour !== 0 || time.minute !== 0) return
  const day = Math.floor(ctx.state().tick / MINUTES_PER_DAY)
  for (const structureId of Object.keys(ctx.state().structures).sort()) {
    const s = ctx.state().structures[structureId]!
    if (s.stage !== 'complete' || !ctx.config.structures.privateKinds.includes(s.kind)) continue
    const sleepers = Object.keys(ctx.state().agents).sort()
      .filter((id) => {
        const a = ctx.state().agents[id]!
        return a.alive && a.asleep && a.insideId === structureId
      })
    for (let i = 0; i < sleepers.length; i++) {
      for (let j = i + 1; j < sleepers.length; j++) {
        ctx.emit('co_slept', { aId: sleepers[i]!, bId: sleepers[j]!, day })
      }
    }
  }
}

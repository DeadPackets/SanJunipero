import { DAYS_PER_YEAR, MINUTES_PER_DAY, simTimeFromTick, type SimConfig } from '@sj/shared'
import { BIRTH_NAMES } from '../data/names.js'
import { mintId, type AgentBody, type WorldState } from '../state.js'
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

// The read path the breakup detector uses, so nothing reaches into pairNights.
export function partnershipOf(state: WorldState, a: string, b: string): PairRow | undefined {
  return state.pairNights?.[pairKey(a, b)]
}

export function isPartnered(state: WorldState, a: string, b: string, config: SimConfig): boolean {
  const row = partnershipOf(state, a, b)
  return row !== undefined && row.nights >= config.reproduction.coSleepNightsToPartner
}

const yearsOf = (a: AgentBody): number => Math.floor(a.ageDays / DAYS_PER_YEAR)

// One f, one m, and the woman of childbearing age with no child already on the way.
function motherAndFather(
  state: WorldState,
  config: SimConfig,
  aId: string,
  bId: string,
): { motherId: string; fatherId: string } | null {
  const a = state.agents[aId]
  const b = state.agents[bId]
  if (!a || !b || sexOf(a) === sexOf(b)) return null
  const mother = sexOf(a) === 'f' ? a : b
  const father = mother === a ? b : a
  if (mother.pregnant !== undefined) return null
  const years = yearsOf(mother)
  const { from, to } = config.reproduction.fertileYears
  if (years < from || years > to) return null
  return { motherId: mother.id, fatherId: father.id }
}

export function reproductionSystem(ctx: TickCtx): void {
  if (!ctx.config.reproduction.enabled) return
  const time = simTimeFromTick(ctx.state().tick)
  if (time.hour !== 0 || time.minute !== 0) return
  const day = Math.floor(ctx.state().tick / MINUTES_PER_DAY)

  const tonight: Array<[string, string]> = []
  for (const structureId of Object.keys(ctx.state().structures).sort()) {
    const s = ctx.state().structures[structureId]!
    if (s.stage !== 'complete' || !ctx.config.structures.privateKinds.includes(s.kind)) continue
    const sleepers = Object.keys(ctx.state().agents)
      .sort()
      .filter((id) => {
        const a = ctx.state().agents[id]!
        return a.alive && a.asleep && a.insideId === structureId
      })
    for (let i = 0; i < sleepers.length; i++) {
      for (let j = i + 1; j < sleepers.length; j++) {
        ctx.emit('co_slept', { aId: sleepers[i]!, bId: sleepers[j]!, day })
        tonight.push([sleepers[i]!, sleepers[j]!])
      }
    }
  }

  // Conception is read off the night that just folded, so the third night can be the first
  // fertile one. The roll is drawn only for a pair that has passed every other gate.
  for (const [aId, bId] of tonight) {
    if (!isPartnered(ctx.state(), aId, bId, ctx.config)) continue
    const pair = motherAndFather(ctx.state(), ctx.config, aId, bId)
    if (!pair) continue
    if (ctx.rng.get('reproduction').next() >= ctx.config.reproduction.conceptionChancePerNight)
      continue
    ctx.emit('agent_conceived', { ...pair, day })
  }

  for (const id of Object.keys(ctx.state().agents).sort()) {
    const mother = ctx.state().agents[id]!
    if (!mother.alive || mother.pregnant === undefined) continue
    if (day - mother.pregnant.sinceDay < ctx.config.reproduction.gestationDays) continue
    const rng = ctx.rng.get('reproduction')
    const sex: Sex = rng.next() < 0.5 ? 'f' : 'm'
    const names = BIRTH_NAMES[sex]
    ctx.emit('agent_born', {
      id: mintId(ctx.state(), 'agent'),
      name: names[rng.int(names.length)]!,
      sex,
      motherId: id,
      fatherId: mother.pregnant.byId,
      x: mother.x,
      y: mother.y,
    })
  }
}

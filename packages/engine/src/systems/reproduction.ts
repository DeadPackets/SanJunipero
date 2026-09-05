import { DAYS_PER_YEAR, MINUTES_PER_DAY, simTimeFromTick, type SimConfig } from '@sj/shared'
import { BIRTH_NAMES } from '../data/names.js'
import { mintId, type AgentBody, type WorldState } from '../state.js'
import { headcount } from '../town.js'
import type { TickCtx } from '../tickCtx.js'

export type Sex = 'f' | 'm'

// Absent on the body means 'f' — the hash-stable form of a defaulted field.
export function sexOf(agent: AgentBody): Sex {
  return agent.sex ?? 'f'
}

/** One act in five makes a child. Not a dial: the cap on minds and the gestation clock are what
 *  bound the population, and a tuned chance is a town whose births an operator wrote. */
export const CONCEPTION_CHANCE_PER_ACT = 0.2

const yearsOf = (a: AgentBody): number => Math.floor(a.ageDays / DAYS_PER_YEAR)

// One f, one m, and the woman of childbearing age with no child already on the way — in a town
// whose law allows children at all, and which has room for one more person.
export function motherAndFather(
  state: WorldState,
  config: SimConfig,
  aId: string,
  bId: string,
): { motherId: string; fatherId: string } | null {
  if (!config.reproduction.enabled) return null
  if (headcount(state) >= config.population.maxMinds) return null
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
      }
    }
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

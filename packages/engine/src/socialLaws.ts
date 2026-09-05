import {
  DAYS_PER_SEASON,
  MINUTES_PER_DAY,
  T_FARMLAND,
  dayPhaseFromTick,
  isWeekendTick,
  visionRadiusAt,
  weekdayFromTick,
  type SimConfig,
} from '@sj/shared'
import { insideOf } from './interiors.js'
import { type Law, type LawPredicate } from './lawShapes.js'
import type { WorldState } from './state.js'
import { SQUARE_RADIUS, townSquareOf } from './town.js'
import { heldQty } from './verbs/common.js'

// The judge half of a social law: what the town's own rules make of an act, and who saw it.
export {
  LAWS_SHOWN,
  LAW_TEXT_MAX,
  LawPredicateSchema,
  type Law,
  type LawPredicate,
} from './lawShapes.js'

/** Which stretch of the calendar this tick falls in. A year is four weeks here, so a week and
 *  a season are the same seven days. */
export function periodIndex(tick: number, every: 'day' | 'week'): number {
  return Math.floor(tick / (MINUTES_PER_DAY * (every === 'week' ? DAYS_PER_SEASON : 1)))
}

/** Every rule still standing, oldest first — the order the town agreed them in, which is the
 *  order a refusal is looked for in. */
export function standingLaws(state: WorldState): Law[] {
  return Object.values(state.socialLaws ?? {})
    .filter((l) => l.repealedTick === null)
    .sort((a, b) => a.ordinal - b.ordinal)
}

export type LawJudgement = { refusal: string } | { broken: string[] } | null

/** Whoever could see this body where it stands: alive, somebody else, on the same side of a
 *  wall, and inside the light. The same lens a taking is witnessed by. */
export function witnessesOf(state: WorldState, config: SimConfig, agentId: string): string[] {
  const a = state.agents[agentId]
  if (!a) return []
  const room = insideOf(state, agentId)
  return Object.keys(state.agents)
    .sort()
    .filter((id) => {
      const b = state.agents[id]!
      if (id === agentId || !b.alive) return false
      if (insideOf(state, id) !== room) return false
      return (
        Math.hypot(a.x - b.x, a.y - b.y) <= visionRadiusAt(state, b, a.x, a.y, state.tick, config)
      )
    })
}

const agreed = (law: Law): string => `the town agreed: ${law.text}`

const doneToday = (state: WorldState, agentId: string, verb: string, tick: number): boolean => {
  const at = state.agents[agentId]?.lawMarks?.[verb]
  return at !== undefined && Math.floor(at / MINUTES_PER_DAY) === Math.floor(tick / MINUTES_PER_DAY)
}

/** The named thing is a thing of that kind, sitting on that shelf — what `common` and `tithe`
 *  both ask about a `take`. */
function onTheShelf(
  state: WorldState,
  params: Record<string, unknown>,
  itemKind: string,
  structureId: string,
): boolean {
  const item = typeof params.itemId === 'string' ? state.items[params.itemId] : undefined
  return item?.kind === itemKind && item.loc.t === 'structure' && item.loc.id === structureId
}

function standingWhere(
  state: WorldState,
  config: SimConfig,
  agentId: string,
  where: 'square' | 'house' | 'field',
  params: Record<string, unknown>,
): boolean {
  const a = state.agents[agentId]
  if (!a) return false
  if (where === 'square') {
    const square = townSquareOf(state)
    return (
      square !== null &&
      Math.max(Math.abs(a.x - square.x), Math.abs(a.y - square.y)) <= SQUARE_RADIUS
    )
  }
  if (where === 'house') {
    const roof = insideOf(state, agentId)
    const s = roof === null ? undefined : state.structures[roof]
    return s !== undefined && config.structures.privateKinds.includes(s.kind)
  }
  return state.terrain[a.y]?.[a.x] === T_FARMLAND || typeof params.cropId === 'string'
}

function anothersThing(
  state: WorldState,
  agentId: string,
  params: Record<string, unknown>,
): boolean {
  const owner =
    (typeof params.itemId === 'string' ? state.items[params.itemId]?.owner : undefined) ??
    (typeof params.structureId === 'string'
      ? state.structures[params.structureId]?.owner
      : undefined)
  return owner !== undefined && owner !== agentId
}

function whenBites(
  when: NonNullable<Extract<LawPredicate, { kind: 'forbid' }>['when']>,
  tick: number,
): boolean {
  if (when === 'night' || when === 'day')
    return (dayPhaseFromTick(tick) === 'night') === (when === 'night')
  if (when === 'weekend') return isWeekendTick(tick)
  return weekdayFromTick(tick) === when
}

function forbidBites(
  state: WorldState,
  config: SimConfig,
  agentId: string,
  p: Extract<LawPredicate, { kind: 'forbid' }>,
  params: Record<string, unknown>,
  tick: number,
): boolean {
  if (p.when !== undefined && !whenBites(p.when, tick)) return false
  if (p.where !== undefined && !standingWhere(state, config, agentId, p.where, params)) return false
  if (p.whose === 'other' && !anothersThing(state, agentId, params)) return false
  return true
}

/** What the town's own rules make of an act the world has already agreed to. A `forbid` never
 *  stops anybody: it hands back the laws this act breaks, and the act goes through witnessed. */
export function judgeLaws(
  state: WorldState,
  config: SimConfig,
  agentId: string,
  verb: string,
  params: Record<string, unknown>,
  tick: number,
): LawJudgement {
  if (state.socialLaws === undefined) return null
  const broken: string[] = []
  for (const law of standingLaws(state)) {
    const p = law.predicate
    if (p.kind === 'forbid') {
      if (p.verb === verb && forbidBites(state, config, agentId, p, params, tick))
        broken.push(law.id)
    } else if (p.kind === 'require_before') {
      if (p.verb === verb && !doneToday(state, agentId, p.before, tick))
        return { refusal: agreed(law) }
    } else if (p.kind === 'common') {
      if (
        verb === 'take' &&
        onTheShelf(state, params, p.itemKind, p.structureId) &&
        heldQty(state, agentId, p.itemKind) >= 1
      )
        return { refusal: agreed(law) }
    } else if (p.kind === 'tithe') {
      if (
        verb === 'take' &&
        onTheShelf(state, params, p.itemKind, p.to) &&
        state.agents[agentId]?.lawMarks?.[law.id] !== periodIndex(tick, p.every)
      )
        return { refusal: agreed(law) }
    }
  }
  return broken.length === 0 ? null : { broken }
}

/** The one writer of `lawMarks`: a completion only leaves a mark when a standing law asks about
 *  that verb, so a town that has agreed nothing never grows the field at all. */
export function markLaw(
  state: WorldState,
  agentId: string,
  verb: string,
  params: Record<string, unknown>,
  tick: number,
): Record<string, number> | undefined {
  if (state.socialLaws === undefined) return undefined
  let marks: Record<string, number> | undefined
  const onto = (): Record<string, number> => marks ?? { ...state.agents[agentId]?.lawMarks }
  for (const law of standingLaws(state)) {
    const p = law.predicate
    if (p.kind === 'require_before' && p.before === verb) marks = { ...onto(), [verb]: tick }
    if (
      p.kind === 'tithe' &&
      verb === 'stow' &&
      typeof params.itemId === 'string' &&
      state.items[params.itemId]?.kind === p.itemKind &&
      params.structureId === p.to
    )
      marks = { ...onto(), [law.id]: periodIndex(tick, p.every) }
  }
  return marks
}

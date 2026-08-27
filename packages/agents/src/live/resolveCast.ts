import { AgentBorn } from '@sj/engine'
import type { EventStore } from '@sj/engine/store'
import { DAYS_PER_YEAR, MINUTES_PER_DAY, SPAWN_AGE_YEARS } from '@sj/shared'
import { derivePersona, personaOf, type ParentPersona } from '../family/derivePersona.js'
import type { AgentBornPayload } from '../family/watchBirths.js'
import type { MindSpec } from './liveMinds.js'

/** The person a birth makes. Deterministic, so a resume rebuilds the same child. */
export function childSpec(
  born: AgentBornPayload,
  mother: ParentPersona,
  father: ParentPersona,
  bornDay: number,
): MindSpec {
  const { identity, personality } = derivePersona(born, [mother, father])
  return {
    id: born.id,
    identity,
    personality,
    ageDays: SPAWN_AGE_YEARS * DAYS_PER_YEAR,
    sex: born.sex,
    bornDay,
  }
}

/** The town's people at boot: the founders, plus every `agent_born` the log holds, replayed in
 *  order so a child of a child derives from a cast that already has its parents. */
export function resolveCast(
  founders: readonly MindSpec[],
  store: EventStore,
  maxMinds: number,
): MindSpec[] {
  const cast = new Map(founders.map((m) => [m.id, m]))
  for (const ev of store.readTypeFrom(0, 'agent_born')) {
    if (cast.size >= maxMinds) break
    const born = AgentBorn.parse(ev.payload)
    const mother = cast.get(born.motherId)
    const father = cast.get(born.fatherId)
    if (mother === undefined || father === undefined) continue
    cast.set(
      born.id,
      childSpec(born, personaOf(mother), personaOf(father), Math.floor(ev.tick / MINUTES_PER_DAY)),
    )
  }
  return [...cast.values()]
}

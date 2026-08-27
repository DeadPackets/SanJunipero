import { AgentBorn } from '@sj/engine'
import type { EventStore } from '@sj/engine/store'
import { DAYS_PER_YEAR, SPAWN_AGE_YEARS } from '@sj/shared'
import { derivePersona, type ParentPersona } from '../family/derivePersona.js'
import type { AgentBornPayload } from '../family/watchBirths.js'
import type { MindSpec } from './liveMinds.js'

export const personaOf = (spec: MindSpec): ParentPersona => ({
  agentId: spec.id,
  identity: spec.identity,
  personality: spec.personality,
})

/** The person a birth makes, derived from parents the town already holds; null when it knows
 *  neither of them. Deterministic, so a resume rebuilds the same child. */
export function childSpec(
  born: AgentBornPayload,
  cast: ReadonlyMap<string, MindSpec>,
): MindSpec | null {
  const mother = cast.get(born.motherId)
  const father = cast.get(born.fatherId)
  if (mother === undefined || father === undefined) return null
  const { identity, personality } = derivePersona(born, [personaOf(mother), personaOf(father)])
  return {
    id: born.id,
    identity,
    personality,
    ageDays: SPAWN_AGE_YEARS * DAYS_PER_YEAR,
    sex: born.sex,
  }
}

/**
 * The town's people at boot: the founders, plus every `agent_born` the world log holds, replayed
 * in log order so a child of a child derives from a cast that already has its parents. A live
 * birth is the same derivation one event later, which is what makes a restart lose nobody.
 */
export function resolveCast(
  founders: readonly MindSpec[],
  store: EventStore,
  maxMinds: number,
): MindSpec[] {
  const cast = new Map(founders.map((m) => [m.id, m]))
  for (const ev of store.readTypeFrom(0, 'agent_born')) {
    if (cast.size >= maxMinds) break
    const spec = childSpec(AgentBorn.parse(ev.payload), cast)
    if (spec !== null) cast.set(spec.id, spec)
  }
  return [...cast.values()]
}

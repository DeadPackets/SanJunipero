import type { SimConfig } from '@sj/shared'
import type { WorldState } from '../state.js'
import { VERBS } from './index.js'

type CandidateSource = (state: WorldState, agentId: string) => string[]

function heldItemIds(state: WorldState, agentId: string): string[] {
  return Object.keys(state.items).filter((id) => {
    const loc = state.items[id]!.loc
    return loc.t === 'agent' && loc.id === agentId
  })
}

// A mind that names the verb and leaves its object blank has still chosen the act (K20). Where
// the world offers exactly one thing that verb would accept, reading it in beats refusing it.
const OBJECT_PARAM: Record<string, { key: string; candidates: CandidateSource }> = {
  eat: { key: 'itemId', candidates: heldItemIds },
  drink: { key: 'itemId', candidates: heldItemIds },
  enter: { key: 'structureId', candidates: (state) => Object.keys(state.structures) },
}

function isBlank(raw: unknown): boolean {
  return raw === null || raw === undefined || (typeof raw === 'string' && raw.trim().length === 0)
}

// Words that name a mark. Prose and numbers are never re-read as one: a sentence moved into an
// id would name nothing, and would cost the act its blank-object reading below as well.
const MARK_KEYS = ['itemId', 'structureId', 'targetId', 'cropId', 'nodeId', 'faunaId']

/** The one mark this act named, moved to the word the verb actually reads (K20). The verb's own
 *  validate is the judge, so no table here has to know what each act asks for; a mark that fits
 *  nowhere is left where it was. */
export function markUnderAnotherKey(
  state: WorldState,
  config: SimConfig,
  agentId: string,
  verb: string,
  params: Record<string, unknown>,
): Record<string, unknown> | null {
  const def = VERBS[verb]
  if (def === undefined) return null
  const named = MARK_KEYS.filter((k) => !isBlank(params[k]))
  const from = named[0]
  if (from === undefined || named.length !== 1) return null
  const { [from]: mark, ...rest } = params
  const fits = MARK_KEYS.filter((k) => k !== from)
    .map((k) => ({ ...rest, [k]: mark }))
    .filter((p) => def.validate(state, config, agentId, p) === null)
  return fits.length === 1 ? fits[0]! : null
}

/** The params this act would have carried had it named its object, or null when the world does
 *  not answer with exactly one thing. Only ever asked of an act the world has already refused,
 *  which is what keeps `drink` at a riverbank from reaching for the skin instead. */
export function loneCandidateFor(
  state: WorldState,
  config: SimConfig,
  agentId: string,
  verb: string,
  params: Record<string, unknown>,
): Record<string, unknown> | null {
  const spec = OBJECT_PARAM[verb]
  const def = VERBS[verb]
  if (spec === undefined || def === undefined) return null
  if (state.agents[agentId] === undefined) return null
  if (!isBlank(params[spec.key])) return null
  const fits = spec
    .candidates(state, agentId)
    .filter((id) => def.validate(state, config, agentId, { ...params, [spec.key]: id }) === null)
  if (fits.length !== 1) return null
  return { ...params, [spec.key]: fits[0] }
}

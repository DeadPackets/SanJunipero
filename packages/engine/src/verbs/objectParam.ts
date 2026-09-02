import type { ClosedKey } from '@sj/shared'
import type { WorldState } from '../state.js'

type CandidateSource = (state: WorldState, agentId: string) => string[]
type ObjectBinding = { key: string; candidates: CandidateSource }

function heldItemIds(state: WorldState, agentId: string): string[] {
  return Object.keys(state.items).filter((id) => {
    const loc = state.items[id]!.loc
    return loc.t === 'agent' && loc.id === agentId
  })
}

const everyStructure: CandidateSource = (state) => Object.keys(state.structures)

// A mind that names the verb and leaves its object blank has still chosen the act (K20). Where
// the world offers exactly one thing that verb would accept, reading it in beats refusing it.
const BUILT_IN: Record<string, ObjectBinding> = {
  eat: { key: 'itemId', candidates: heldItemIds },
  drink: { key: 'itemId', candidates: heldItemIds },
  drop: { key: 'itemId', candidates: heldItemIds },
  wear: { key: 'itemId', candidates: heldItemIds },
  kindle: { key: 'itemId', candidates: heldItemIds },
  snuff: { key: 'itemId', candidates: heldItemIds },
  fill: { key: 'itemId', candidates: heldItemIds },
  read: { key: 'itemId', candidates: heldItemIds },
  stow: { key: 'itemId', candidates: heldItemIds },
  take: { key: 'itemId', candidates: (state) => Object.keys(state.items).sort() },
  enter: { key: 'structureId', candidates: everyStructure },
  // 98 of the phase 1 gate's 402 refusals were this act with its fire left null, the largest
  // bucket by far. `stoke.validate` already asks stokeable, complete, in reach and fuel in hand.
  stoke: { key: 'structureId', candidates: everyStructure },
}

// Where a minted verb's object comes from, by the key its charter reads. A person and a spoken
// line are missing on purpose: guessing which person a mind meant reads as a bug in the story,
// and inventing words it did not say is worse.
const MINTED_CANDIDATES: Partial<Record<ClosedKey, CandidateSource>> = {
  itemId: heldItemIds,
  structureId: everyStructure,
}

const minted = new Map<string, ObjectBinding>()

/** The row a minted verb brings with it, off the keys its charter reads — otherwise every word
 *  the arbiter ever coins is born in the state `stoke` was in, refused on first blank use.
 *  Two marks is two questions and no row: which thing and which person is not one reading, so
 *  such a verb refuses honestly, the way `give` does. */
export function bindObjectParam(verb: string, reads: readonly ClosedKey[]): void {
  const key = reads.length === 1 ? reads[0] : undefined
  const candidates = key === undefined ? undefined : MINTED_CANDIDATES[key]
  if (key === undefined || candidates === undefined) return
  minted.set(verb, { key, candidates })
}

/** Verbs retire after fourteen unused days, and a row that outlived its verb would answer for
 *  a word the town no longer has. */
export function unbindObjectParam(verb: string): void {
  minted.delete(verb)
}

/** Derived state, never folded: rebuilt from the rulebook at every boot, so nothing here
 *  reaches the world's hash or its log. */
export function objectBindingFor(verb: string): ObjectBinding | undefined {
  return BUILT_IN[verb] ?? minted.get(verb)
}

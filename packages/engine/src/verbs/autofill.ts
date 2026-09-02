import type { SimConfig } from '@sj/shared'
import type { Item, WorldState } from '../state.js'
import { words } from './build.js'
import { bodyAt, nearestWater, VERBS } from './index.js'

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
  drop: { key: 'itemId', candidates: heldItemIds },
  wear: { key: 'itemId', candidates: heldItemIds },
  kindle: { key: 'itemId', candidates: heldItemIds },
  snuff: { key: 'itemId', candidates: heldItemIds },
  fill: { key: 'itemId', candidates: heldItemIds },
  read: { key: 'itemId', candidates: heldItemIds },
  stow: { key: 'itemId', candidates: heldItemIds },
  take: { key: 'itemId', candidates: (state) => Object.keys(state.items).sort() },
  enter: { key: 'structureId', candidates: (state) => Object.keys(state.structures) },
  // 98 of the phase 1 gate's 402 refusals were this act with its fire left null, the largest
  // bucket by far. `stoke.validate` already asks stokeable, complete, in reach and fuel in hand.
  stoke: { key: 'structureId', candidates: (state) => Object.keys(state.structures) },
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
  const fits = readingsOf(state, config, agentId, verb, params)
  if (spec === undefined || fits.length !== 1) return null
  return { ...params, [spec.key]: fits[0] }
}

/** Everything the act could equally have meant, in id order. */
function readingsOf(
  state: WorldState,
  config: SimConfig,
  agentId: string,
  verb: string,
  params: Record<string, unknown>,
): string[] {
  const spec = OBJECT_PARAM[verb]
  const def = VERBS[verb]
  if (spec === undefined || def === undefined) return []
  if (state.agents[agentId] === undefined || !isBlank(params[spec.key])) return []
  return spec
    .candidates(state, agentId)
    .sort()
    .filter((id) => def.validate(state, config, agentId, { ...params, [spec.key]: id }) === null)
}

// A name the world does not hold. Whatever a verb answers to it is that verb's words for "that
// is not the sort of thing I take", and a real mark answered the same way is no reading either.
const NO_SUCH_MARK = 'no_such_mark'

/** What is actually in the way, when the act left its object blank and nothing fit. "Name the
 *  thing" is true and useless — 83 of 139 refusal episodes were a mind sent looking for a word
 *  when the obstacle was no water, or no wood. Every candidate the table offers is put to the
 *  verb, and where the ones that could be meant agree on why they were turned away, that is the
 *  sentence to send back instead. Several answers means several obstacles, and the mind is told
 *  to name one after all. */
export function soleObstacle(
  state: WorldState,
  config: SimConfig,
  agentId: string,
  verb: string,
  params: Record<string, unknown>,
): string | null {
  const spec = OBJECT_PARAM[verb]
  const def = VERBS[verb]
  if (spec === undefined || def === undefined) return null
  if (state.agents[agentId] === undefined || !isBlank(params[spec.key])) return null
  const unnamed = def.validate(state, config, agentId, params)
  const unknown = def.validate(state, config, agentId, { ...params, [spec.key]: NO_SUCH_MARK })
  // Naming anything at all left the same answer: this refusal was never about the missing name.
  if (unnamed === null || unnamed === unknown) return null
  const standing = new Set<string>()
  for (const id of spec.candidates(state, agentId)) {
    const why = def.validate(state, config, agentId, { ...params, [spec.key]: id })
    // Something fits: this act has a reading, and the readings above answer it, not this.
    if (why === null) return null
    if (why !== unnamed && why !== unknown) standing.add(why)
  }
  return standing.size === 1 ? [...standing][0]! : null
}

const nameOf = (state: WorldState, id: string): string => {
  const kind = state.items[id]?.kind ?? state.structures[id]?.kind
  return kind === undefined ? id : `the ${words(kind)} (${id})`
}

// A mark left blank, and two things it fits equally: the world names them and asks, because
// picking for the mind would be putting a want in its mouth.
function ambiguity(
  state: WorldState,
  config: SimConfig,
  agentId: string,
  verb: string,
  params: Record<string, unknown>,
): string | null {
  const fits = readingsOf(state, config, agentId, verb, params)
  if (fits.length < 2) return null
  return `which one — ${nameOf(state, fits[0]!)} or ${nameOf(state, fits[1]!)}?`
}

// In this body's hands first, then nearest, then by id: a kind names one thing every time.
function instancesOfKind(state: WorldState, agentId: string, kind: string): Item[] {
  const a = state.agents[agentId]!
  const away = (i: Item): number => {
    if (i.loc.t === 'agent') return 0
    if (i.loc.t === 'tile') return Math.abs(i.loc.x - a.x) + Math.abs(i.loc.y - a.y)
    const s = state.structures[i.loc.id]
    return s === undefined ? Number.MAX_SAFE_INTEGER : Math.abs(s.x - a.x) + Math.abs(s.y - a.y)
  }
  const held = (i: Item): number => (i.loc.t === 'agent' ? 0 : 1)
  return Object.values(state.items)
    .filter((i) => i.kind === kind && (i.loc.t !== 'agent' || i.loc.id === agentId))
    .sort((p, q) => held(p) - held(q) || away(p) - away(q) || (p.id < q.id ? -1 : 1))
}

/** A mark written as a kind — `wood`, `bread` — read as the thing it names: the one in these
 *  hands, else the nearest one. Another body's is never a candidate: it was never on offer. */
function kindNamedAsMark(
  state: WorldState,
  config: SimConfig,
  agentId: string,
  verb: string,
  params: Record<string, unknown>,
): Record<string, unknown> | null {
  const named = params.itemId
  const def = VERBS[verb]
  if (typeof named !== 'string' || def === undefined) return null
  if (state.items[named] !== undefined || state.agents[agentId] === undefined) return null
  const tries = instancesOfKind(state, agentId, named).map((i) => ({ ...params, itemId: i.id }))
  // What this body could do now outranks what merely ranks first.
  return tries.find((t) => def.validate(state, config, agentId, t) === null) ?? tries[0] ?? null
}

/** Water guessed wrong, or never named: the nearest open water this act would take, judged from
 *  a body standing at it — the distance is the walk's to close, not this reading's. */
function waterNamedWrong(
  state: WorldState,
  config: SimConfig,
  agentId: string,
  verb: string,
  params: Record<string, unknown>,
): Record<string, unknown> | null {
  const def = VERBS[verb]
  if (def === undefined || state.agents[agentId] === undefined) return null
  const wet = nearestWater(state, agentId, undefined, false)
  if (wet === null) return null
  const tried = { ...params, x: wet.x, y: wet.y }
  const beside = bodyAt(state, agentId, wet)
  return def.validate(beside, config, agentId, tried) === null ? tried : null
}

// A mark written as an empty word is no mark at all, and reads better as one.
function withoutBlanks(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(params)) if (!isBlank(params[key])) out[key] = params[key]
  return out
}

/** The act as a person would have read it, or the question a person would have asked back.
 *  Only ever asked of an act the world has already refused. */
export function readAsPerson(
  state: WorldState,
  config: SimConfig,
  agentId: string,
  verb: string,
  params: Record<string, unknown>,
): { params: Record<string, unknown> } | { refusal: string } | null {
  const p = withoutBlanks(params)
  // What the mind named outranks what the world would have guessed: the id it gave is right
  // 152 times in 154, and only a mark that fits nowhere falls through to the readings below.
  const read =
    markUnderAnotherKey(state, config, agentId, verb, p) ??
    kindNamedAsMark(state, config, agentId, verb, p) ??
    waterNamedWrong(state, config, agentId, verb, p) ??
    loneCandidateFor(state, config, agentId, verb, p)
  if (read !== null) return { params: read }
  const asked = ambiguity(state, config, agentId, verb, p)
  if (asked !== null) return { refusal: asked }
  return Object.keys(p).length === Object.keys(params).length ? null : { params: p }
}

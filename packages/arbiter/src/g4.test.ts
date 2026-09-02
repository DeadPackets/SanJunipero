// An intent adjudicates once, codifies, and the byte-identical intent then resolves Tier-1
// with zero further arbiter calls. Fully deterministic: no live API.
import { describe, expect, it } from 'vitest'
import {
  ADULT_AGE_DAYS,
  DEFAULT_CONFIG,
  NO_PARAMS,
  stateHash,
  type SimConfig,
  type SimEvent,
} from '@sj/shared'
import {
  RngStream,
  RngStreams,
  VERBS,
  createWorldTick,
  fold,
  genesisState,
  submitIntent,
  type WorldState,
} from '@sj/engine'
import { RulebookStore } from './rulebook.js'
import { makeArbiterRig, ScriptedLlm, TAMAR_CTX } from './testutil/scriptedLlm.js'
import type { Recipe, Verdict } from './verdict.js'

// A credit for a test that is not about the credit; the two-argument codify is required so
// an uncredited discovery cannot be minted in silence.
const CODIFY_CREDIT = { agentId: 'a1', intent: 'a mind asked for this' }

const CFG: SimConfig = DEFAULT_CONFIG
const INTENT = 'I try to extract salt by boiling river water'

// The Task 8 fixture, verbatim: boil river water until only salt remains.
const boilSaltRecipe: Recipe = {
  id: 'recipe:boil_salt',
  name: 'Boil River Water for Salt',
  skillCheck: { track: 'cooking', difficulty: 2 },
  durationTicks: 5,
  costs: [],
  requires: [{ type: 'adjacent_fire' }],
  outcomeTable: [
    {
      weight: 1,
      success: true,
      label: 'A crust of salt forms as the water boils away.',
      effects: [{ op: 'spawn_item', kind: 'salt', qty: 1, to: 'agent' }],
    },
    {
      weight: 1,
      success: false,
      label: 'The water boils to nothing; the pot is bare.',
      effects: [{ op: 'none' }],
    },
  ],
  rngStream: 'recipe:boil_salt',
  canon: ['fire', 'pottery'],
}

const boilSaltVerdict: Verdict = {
  kind: 'attempt',
  recipe: boilSaltRecipe,
  summary: 'Boil river water until only salt remains.',
}

// Payload guards: the tick pipeline's events are typed `unknown`; narrow to the
// one field each assertion needs instead of fabricating an unchecked shape.
function isVerbPayload(p: unknown): p is { verb: string } {
  return typeof p === 'object' && p !== null && 'verb' in p && typeof p.verb === 'string'
}

function isSpawnPayload(p: unknown): p is { kind: string } {
  return typeof p === 'object' && p !== null && 'kind' in p && typeof p.kind === 'string'
}

let seq = 90000
const ev = (type: string, payload: unknown, tick = 0): SimEvent => ({
  seq: seq++,
  tick,
  type,
  payload,
})

// Minimal world: one agent adjacent to a burning flammable structure at (2,1).
function makeWorld(): WorldState {
  let s = fold(
    genesisState(CFG),
    ev('agent_spawned', { id: 'a1', name: 'a1', x: 2, y: 2, ageDays: ADULT_AGE_DAYS }),
    CFG,
  )
  s = fold(
    s,
    ev('structure_planned', {
      id: 's1',
      kind: 'campfire',
      x: 2,
      y: 1,
      w: 1,
      h: 1,
      maxHp: 10,
      flammable: true,
      builderId: 'a1',
    }),
    CFG,
  )
  s = fold(s, ev('fire_ignited', { structureId: 's1', cause: 'scripted' }), CFG)
  return s
}

// Seeded stream bag that pins the recipe's named rngStream to a forced roll.
// RngStream.from([0,0,0,0]).next() === 0 → the outcome table's success row wins.
class ForcedRngStreams extends RngStreams {
  constructor(
    seed: string,
    private readonly forced: Record<string, RngStream>,
  ) {
    super(seed)
  }

  get(name: string): RngStream {
    return this.forced[name] ?? super.get(name)
  }
}

// Tier-1 execution: submit the codified verb and drive the tick pipeline the full
// 5 duration ticks, collecting every event the pipeline emits.
function runTier1(state: WorldState): {
  state: WorldState
  events: { type: string; payload: unknown }[]
} {
  const events: { type: string; payload: unknown }[] = []
  const rng = new ForcedRngStreams('g4-scripted', {
    'recipe:boil_salt': RngStream.from([0, 0, 0, 0]),
  })

  const res = submitIntent(state, CFG, 'a1', 'recipe:boil_salt', {})
  if (!res.ok) throw new Error(res.reason)
  for (const e of res.events) {
    state = fold(state, ev(e.type, e.payload), CFG)
    events.push(e)
  }

  for (let i = 0; i < boilSaltRecipe.durationTicks; i++) {
    const tick = state.tick + 1
    state = fold(state, ev('tick_advanced', {}, tick), CFG)
    const wt = createWorldTick(CFG, rng)(state)
    state = wt.state
    events.push(...wt.events)
  }
  return { state, events }
}

describe('GATE G4: "boil river water for salt" adjudicates once, then runs Tier-1', () => {
  it('novel intent → attempt (1 LLM call) → codify → byte-identical intent → map (still 1 call) → Tier-1 completes deterministically', async () => {
    const llm = new ScriptedLlm(() => boilSaltVerdict)
    const { db, arbiter } = await makeArbiterRig({ llm })

    // 3. First adjudication reaches the LLM exactly once and returns the attempt.
    const r1 = await arbiter.adjudicate(INTENT, TAMAR_CTX)
    expect(r1).toEqual(boilSaltVerdict)
    if (r1.kind !== 'attempt') throw new Error('expected attempt verdict')
    expect(r1.recipe.id).toBe('recipe:boil_salt')
    expect(llm.objectCalls).toBe(1)

    // 4. Codify lands the recipe in the rulebook and hot-registers the verb.
    expect(VERBS['recipe:boil_salt']).toBeUndefined()
    const { verb } = arbiter.codify(r1.recipe, CODIFY_CREDIT)
    expect(verb).toBe('recipe:boil_salt')
    expect(new RulebookStore(db).byId('recipe:boil_salt')).not.toBeNull()
    expect(VERBS['recipe:boil_salt']).toBeDefined()

    // 5. Byte-identical intent resolves Tier-1 map with zero further LLM calls.
    const r2 = await arbiter.adjudicate(INTENT, TAMAR_CTX)
    expect(r2).toEqual({ kind: 'map', verb: 'recipe:boil_salt', params: NO_PARAMS })
    expect(llm.objectCalls).toBe(1)

    // 6. Tier-1 execution: submitIntent accepts, the 5-tick pipeline completes the
    //    action and spawns the salt item.
    expect(submitIntent(makeWorld(), CFG, 'a1', 'recipe:boil_salt', {})).toMatchObject({ ok: true })

    const run = runTier1(makeWorld())
    const completed = run.events.find(
      (e): e is { type: string; payload: { verb: string } } =>
        e.type === 'action_completed' && isVerbPayload(e.payload),
    )
    expect(completed).toBeDefined()
    if (!completed) throw new Error('missing action_completed event')
    expect(completed.payload.verb).toBe('recipe:boil_salt')
    const spawned = run.events.find(
      (e): e is { type: string; payload: { kind: string } } =>
        e.type === 'item_spawned' && isSpawnPayload(e.payload),
    )
    expect(spawned).toBeDefined()
    if (!spawned) throw new Error('missing item_spawned event')
    expect(spawned.payload.kind).toBe('salt')

    // 7. Determinism: the whole scripted run replays to the same stateHash twice —
    //    onComplete draws only from its named rngStream, no Math.random anywhere.
    const a = runTier1(makeWorld())
    const b = runTier1(makeWorld())
    expect(stateHash(a.state)).toBe(stateHash(b.state))
  })
})

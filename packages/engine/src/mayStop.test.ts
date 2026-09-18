import { describe, expect, it } from 'vitest'
import {
  ADULT_AGE_DAYS,
  DURATION_TICKS,
  SimConfigSchema,
  stateHash,
  type SimConfig,
} from '@sj/shared'
import { fold } from './fold.js'
import { submitIntent } from './intent.js'
import { genesisState, type TileId, type WorldState } from './state.js'
import { ACT_SET_DOWN, VERBS } from './verbs/index.js'
import { createWorldTick } from './worldTick.js'
import { RngStreams } from './rng.js'
import { ev, grid } from './testutil/world.js'

// A quiet sky and no fauna: every event a row below names is one the body itself caused.
const CFG: SimConfig = SimConfigSchema.parse({
  weather: { hourlyChangeChance: 0 },
  mystery: { chancePerDay: 0 },
  fauna: { enabled: false },
})

const WATER = { x: 3, y: 4 }
const HOUSE = { kind: 'house', x: 5, y: 4 }
const SEED = 'may-stop'

/** Dry ground with one wet tile the body can reach, and an armful of wood in its hands. */
function world(): WorldState {
  const rows: TileId[][] = grid(16)
  rows[WATER.y]![WATER.x] = 2
  let s = genesisState(CFG, rows)
  s = fold(s, ev('agent_spawned', { id: 'a1', name: 'a1', x: 4, y: 4, ageDays: ADULT_AGE_DAYS }))
  return fold(
    s,
    ev('item_spawned', {
      id: 'item_1',
      kind: 'wood',
      qty: CFG.structures.recipes.house!.inputs.wood! + 10,
      loc: { t: 'agent', id: 'a1' },
    }),
    CFG,
  )
}

function apply(s: WorldState, events: { type: string; payload: unknown }[]): WorldState {
  for (const e of events) s = fold(s, ev(e.type, e.payload, s.tick), CFG)
  return s
}

function begin(s: WorldState, verb: string, params: Record<string, unknown>): WorldState {
  const r = submitIntent(s, CFG, 'a1', verb, params)
  if (!r.ok) throw new Error(r.reason)
  return apply(s, r.events)
}

/** `n` ticks of the world, and the log those ticks wrote. */
function run(
  s: WorldState,
  n: number,
  rng = new RngStreams(SEED),
): { state: WorldState; log: { tick: number; type: string; payload: unknown }[] } {
  const worldTick = createWorldTick(CFG, rng)
  const log: { tick: number; type: string; payload: unknown }[] = []
  for (let i = 0; i < n; i++) {
    const tick = s.tick + 1
    log.push({ tick, type: 'tick_advanced', payload: {} })
    const out = worldTick(fold(s, ev('tick_advanced', {}, tick), CFG))
    s = out.state
    for (const e of out.events) log.push({ tick, ...e })
  }
  return { state: s, log }
}

describe('a body may stop what it is doing', () => {
  it('the verb takes no hands, so it reaches an act already running', () => {
    const busy = begin(world(), 'fish', WATER)
    expect(busy.agents.a1!.activity!.verb).toBe('fish')
    const r = submitIntent(busy, CFG, 'a1', 'stop', {})
    expect(r.ok).toBe(true)
    expect(r.ok && r.events).toEqual([
      { type: 'action_interrupted', payload: { agentId: 'a1', reason: ACT_SET_DOWN } },
    ])
    expect(apply(busy, r.ok ? r.events : []).agents.a1!.activity).toBeNull()
  })

  it('★ and it ends the act and nothing else: no completion, no yield, no craft learned', () => {
    let s = begin(world(), 'fish', WATER)
    s = run(s, DURATION_TICKS.hour - 1).state
    const before = { items: Object.keys(s.items).length, skills: { ...s.agents.a1!.skills } }
    s = apply(s, [{ type: 'action_interrupted', payload: { agentId: 'a1', reason: ACT_SET_DOWN } }])
    // One tick past where the cast would have landed: nothing arrives late either.
    const after = run(s, 4).state
    expect(after.agents.a1!.activity).toBeNull()
    expect(Object.keys(after.items)).toHaveLength(before.items)
    expect(after.agents.a1!.skills).toEqual(before.skills)
    expect(after.agents.a1!.x).toBe(4)
  })

  // The one thing a stopped body keeps is what it had already put INTO the world. Nothing else
  // does: `onComplete` is where a cast becomes a fish, and half a cast is no fish at all.
  it('★ THE YIELD RULE: an abandoned act keeps only the work the world already holds', () => {
    let s = begin(world(), 'build', HOUSE)
    const siteId = Object.keys(s.structures)[0]!
    s = run(s, 40).state
    const raised = s.structures[siteId]!.progressTicks
    expect(raised).toBe(40)
    s = apply(s, [{ type: 'action_interrupted', payload: { agentId: 'a1', reason: ACT_SET_DOWN } }])
    expect(s.agents.a1!.activity).toBeNull()
    // The walls stand where the hands left them, and the next build's clock covers only what is
    // left of them. This is the WHOLE mechanism: work survives being set down when the world
    // holds a record of it, and `build` is the one act that writes one every tick.
    expect(s.structures[siteId]!.progressTicks).toBe(raised)
    expect(s.structures[siteId]!.stage).toBe('construction')
    expect(VERBS.build!.duration(s, CFG, 'a1', HOUSE)).toBe(CFG.construction.houseTicks - raised)
    const resumed = begin(s, 'build', HOUSE)
    expect(Object.keys(resumed.structures)).toHaveLength(1)
    // And the timber is not paid for twice: the materials went in at the first `onStart`.
    expect(Object.values(resumed.items).find((i) => i.kind === 'wood')!.qty).toBe(10)
  })

  it('★ and a log with a stop in it replays to the state the live run left', () => {
    const genesis = world()
    let live = genesis
    const log: { tick: number; type: string; payload: unknown }[] = []
    const record = (events: { type: string; payload: unknown }[]) => {
      for (const e of events) {
        log.push({ tick: live.tick, ...e })
        live = fold(live, ev(e.type, e.payload, live.tick), CFG)
      }
    }
    const cast = submitIntent(live, CFG, 'a1', 'fish', WATER)
    if (!cast.ok) throw new Error(cast.reason)
    record(cast.events)
    const first = run(live, 20)
    live = first.state
    log.push(...first.log)
    const stop = submitIntent(live, CFG, 'a1', 'stop', {})
    if (!stop.ok) throw new Error(stop.reason)
    record(stop.events)
    expect(log.some((e) => e.type === 'action_interrupted')).toBe(true)
    const rest = run(live, 20)
    live = rest.state
    log.push(...rest.log)
    const replayed = log.reduce((s, e) => fold(s, ev(e.type, e.payload, e.tick), CFG), genesis)
    expect(stateHash(replayed)).toBe(stateHash(live))
  })

  it('a body with idle hands is asked to stop and simply goes on standing there', () => {
    const s = world()
    const r = submitIntent(s, CFG, 'a1', 'stop', {})
    expect(r).toEqual({ ok: true, events: [] })
  })
})

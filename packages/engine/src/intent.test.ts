import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { ADULT_AGE_DAYS, DEFAULT_CONFIG, TICK_REAL_MS, type SimEvent } from '@sj/shared'
import { genesisState, type TileId, type WorldState } from './state.js'
import { fold } from './fold.js'
import { submitIntent } from './intent.js'
import { ACT_SET_DOWN, stepWalk, VERBS, WALK_NO_ROAD } from './verbs/index.js'

const CHAR_TILE: Record<string, TileId> = { '.': 0, '~': 2 }
const ev = (seq: number, type: string, payload: unknown): SimEvent => ({
  seq,
  tick: 0,
  type,
  payload,
})

let seq = 100
function makeWorld(rows: string[] = ['........', '........', '........', '........']): WorldState {
  const s = genesisState(
    DEFAULT_CONFIG,
    rows.map((row) => Array.from(row).map((c) => CHAR_TILE[c]!)),
  )
  return fold(
    s,
    ev(1, 'agent_spawned', { id: 'a1', name: 'a1', x: 0, y: 0, ageDays: ADULT_AGE_DAYS }),
  )
}
function patchAgent(
  s: WorldState,
  id: string,
  patch: Partial<WorldState['agents'][string]>,
): WorldState {
  return { ...s, agents: { ...s.agents, [id]: { ...s.agents[id]!, ...patch } } }
}
function applyAll(s: WorldState, events: { type: string; payload: unknown }[]): WorldState {
  for (const e of events) s = fold(s, ev(seq++, e.type, e.payload))
  return s
}

describe('submitIntent', () => {
  it('accepts a valid walk: action_started with duration = ceil(pathLen ÷ tilesPerTick)', () => {
    const s = makeWorld()
    const r = submitIntent(s, DEFAULT_CONFIG, 'a1', 'walk', { x: 3, y: 0 })
    expect(r).toEqual({
      ok: true,
      events: [
        {
          type: 'action_started',
          payload: { agentId: 'a1', verb: 'walk', params: { x: 3, y: 0 }, duration: 1 },
        },
      ],
    })
  })

  // One tick of a 12-mind rehearsal died here: the seam spread the mind's whole answer into
  // strict WalkParams, and `duration` threw before anything was recorded.
  it('takes only the keys the legs read, however many the mind filled in', () => {
    const s = makeWorld()
    const r = submitIntent(s, DEFAULT_CONFIG, 'a1', 'walk', {
      x: 3,
      y: 0,
      kind: 'north',
      description: 'off to the mill',
      recipe: 'bread',
    })
    expect(r.ok).toBe(true)
    expect(r.ok && r.events[0]?.payload).toEqual({
      agentId: 'a1',
      verb: 'walk',
      params: { x: 3, y: 0 },
      duration: 1,
    })
  })

  it('debuffed duration is longer when hunger is 20', () => {
    let s = makeWorld()
    s = fold(s, ev(2, 'needs_changed', { id: 'a1', changes: [{ need: 'hunger', delta: -80 }] }))
    const r = submitIntent(s, DEFAULT_CONFIG, 'a1', 'walk', { x: 3, y: 0 })
    expect(r.ok).toBe(true)
    if (r.ok) expect((r.events[0]!.payload as { duration: number }).duration).toBe(2)
  })

  it('rejects unknown, dead, collapsed, and busy agents', () => {
    let s = makeWorld()
    expect(submitIntent(s, DEFAULT_CONFIG, 'ghost', 'walk', { x: 1, y: 0 }).ok).toBe(false)
    expect(
      submitIntent(patchAgent(s, 'a1', { alive: false }), DEFAULT_CONFIG, 'a1', 'walk', {
        x: 1,
        y: 0,
      }).ok,
    ).toBe(false)
    // A body on the ground may drag itself to a tile it could touch, and no further.
    const down = patchAgent(s, 'a1', { collapsedSinceTick: 5 })
    expect(submitIntent(down, DEFAULT_CONFIG, 'a1', 'walk', { x: 3, y: 3 }).ok).toBe(false)
    expect(submitIntent(down, DEFAULT_CONFIG, 'a1', 'walk', { x: 1, y: 0 }).ok).toBe(true)
    expect(submitIntent(down, DEFAULT_CONFIG, 'a1', 'build', {}).ok).toBe(false)
    s = patchAgent(s, 'a1', { activity: { verb: 'walk', ticksRemaining: 2, params: {} } })
    expect(submitIntent(s, DEFAULT_CONFIG, 'a1', 'walk', { x: 1, y: 0 }).ok).toBe(false)
  })

  it('rejects unknown verbs and unreachable destinations with in-world reasons', () => {
    const s = makeWorld(['..~.', '..~.', '..~.'])
    const noVerb = submitIntent(s, DEFAULT_CONFIG, 'a1', 'dance', {})
    expect(noVerb.ok).toBe(false)
    if (!noVerb.ok) expect(noVerb.reason).toMatch(/verb/i)
    // Ground on the far side of the river: the legs start, and stop on the near bank at (1, 0).
    const far = submitIntent(s, DEFAULT_CONFIG, 'a1', 'walk', { x: 3, y: 0 })
    expect(far.ok).toBe(true)
    if (far.ok) expect(far.events[0]!.payload).toMatchObject({ params: { x: 1, y: 0 } })
    // Asked again from the bank, where the water is the whole answer, it is refused.
    const onBank = patchAgent(s, 'a1', { x: 1, y: 0 })
    const noPath = submitIntent(onBank, DEFAULT_CONFIG, 'a1', 'walk', { x: 3, y: 0 })
    expect(noPath.ok).toBe(false)
    if (!noPath.ok) expect(noPath.reason).toBe(WALK_NO_ROAD)
    // Standing where you were sent is not a thing to be refused for.
    const there = submitIntent(s, DEFAULT_CONFIG, 'a1', 'walk', { x: 0, y: 0 })
    expect(there.ok).toBe(true)
  })

  it('prepends agent_woke when the agent is asleep', () => {
    const s = patchAgent(makeWorld(), 'a1', { asleep: true })
    const r = submitIntent(s, DEFAULT_CONFIG, 'a1', 'walk', { x: 2, y: 0 })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.events.map((e) => e.type)).toEqual(['agent_woke', 'action_started'])
      expect(r.events[0]!.payload).toEqual({ agentId: 'a1' })
    }
  })
})

describe('fold: action + skill + wake events', () => {
  it('action_started stores the activity (with path for walk)', () => {
    let s = makeWorld()
    s = fold(
      s,
      ev(2, 'action_started', { agentId: 'a1', verb: 'walk', params: { x: 2, y: 0 }, duration: 2 }),
    )
    expect(s.agents.a1!.activity).toEqual({
      verb: 'walk',
      ticksRemaining: 2,
      params: { x: 2, y: 0 },
      path: [
        [1, 0],
        [2, 0],
      ],
    })
  })

  it('action_progressed decrements; completed/interrupted clear the activity', () => {
    let s = makeWorld()
    s = fold(
      s,
      ev(2, 'action_started', { agentId: 'a1', verb: 'walk', params: { x: 2, y: 0 }, duration: 2 }),
    )
    s = fold(s, ev(3, 'action_progressed', { agentId: 'a1', ticks: 1 }))
    expect(s.agents.a1!.activity!.ticksRemaining).toBe(1)
    const done = fold(s, ev(4, 'action_completed', { agentId: 'a1', verb: 'walk' }))
    expect(done.agents.a1!.activity).toBeNull()
    const cut = fold(s, ev(4, 'action_interrupted', { agentId: 'a1', reason: 'blocked' }))
    expect(cut.agents.a1!.activity).toBeNull()
  })

  it('skill_gained accumulates xp; agent_woke clears asleep', () => {
    let s = patchAgent(makeWorld(), 'a1', { asleep: true })
    s = fold(s, ev(2, 'skill_gained', { agentId: 'a1', track: 'farming', xp: 5 }))
    s = fold(s, ev(3, 'skill_gained', { agentId: 'a1', track: 'farming', xp: 3 }))
    expect(s.agents.a1!.skills.farming).toBe(8)
    s = fold(s, ev(4, 'agent_woke', { agentId: 'a1' }))
    expect(s.agents.a1!.asleep).toBe(false)
  })

  it('strict payloads reject extra keys; unknown agents throw', () => {
    const s = makeWorld()
    expect(() =>
      fold(
        s,
        ev(2, 'action_started', {
          agentId: 'a1',
          verb: 'walk',
          params: { x: 1, y: 0 },
          duration: 1,
          extra: 1,
        }),
      ),
    ).toThrow()
    expect(() => fold(s, ev(2, 'action_progressed', { agentId: 'ghost', ticks: 1 }))).toThrow(
      /unknown agent/i,
    )
    expect(() =>
      fold(s, ev(2, 'skill_gained', { agentId: 'ghost', track: 'farming', xp: 1 })),
    ).toThrow(/unknown agent/i)
    expect(() => fold(s, ev(2, 'agent_woke', { agentId: 'ghost' }))).toThrow(/unknown agent/i)
  })
})

describe('walk progression (stepWalk)', () => {
  const planWall = (s: WorldState, x: number, y: number): WorldState =>
    fold(
      s,
      ev(seq++, 'structure_planned', {
        id: 'structure_1',
        kind: 'house',
        x,
        y,
        w: 1,
        h: 1,
        maxHp: 50,
        flammable: true,
        builderId: 'a1',
      }),
    )

  function walkUntilDone(s: WorldState, maxTicks = 100): { s: WorldState; ticks: number } {
    let ticks = 0
    while (s.agents.a1!.activity) {
      s = applyAll(s, stepWalk(s, 'a1'))
      ticks++
      if (s.agents.a1!.activity.ticksRemaining === 0) {
        s = applyAll(s, [{ type: 'action_completed', payload: { agentId: 'a1', verb: 'walk' } }])
      }
      if (ticks > maxTicks) throw new Error('walk never finished')
    }
    return { s, ticks }
  }

  it('completes in exactly ceil(pathLen ÷ 3) ticks at full health', () => {
    let s = makeWorld()
    const r = submitIntent(s, DEFAULT_CONFIG, 'a1', 'walk', { x: 5, y: 2 })
    if (!r.ok) throw new Error(r.reason)
    s = applyAll(s, r.events)
    const done = walkUntilDone(s)
    expect(done.ticks).toBe(3) // pathLen = 5 + 2, three tiles a tick
    expect([done.s.agents.a1!.x, done.s.agents.a1!.y]).toEqual([5, 2])
  })

  it('★ thirty tiles of straight road is ten ticks — twenty seconds at the world’s own rate', () => {
    let s = makeWorld(Array.from({ length: 4 }, () => '.'.repeat(31)))
    const r = submitIntent(s, DEFAULT_CONFIG, 'a1', 'walk', { x: 30, y: 0 })
    if (!r.ok) throw new Error(r.reason)
    s = applyAll(s, r.events)
    const done = walkUntilDone(s)
    expect(done.ticks).toBe(10)
    expect(done.ticks * TICK_REAL_MS).toBe(20_000)
    expect([done.s.agents.a1!.x, done.s.agents.a1!.y]).toEqual([30, 0])
  })

  it('takes the debuffed body longer, still arriving', () => {
    let s = makeWorld()
    s = fold(s, ev(2, 'needs_changed', { id: 'a1', changes: [{ need: 'hunger', delta: -80 }] }))
    const r = submitIntent(s, DEFAULT_CONFIG, 'a1', 'walk', { x: 5, y: 2 })
    if (!r.ok) throw new Error(r.reason)
    s = applyAll(s, r.events)
    const done = walkUntilDone(s)
    expect(done.ticks).toBe(4) // pathLen 7 at two tiles a tick, against three
    expect([done.s.agents.a1!.x, done.s.agents.a1!.y]).toEqual([5, 2])
  })

  it('emits agent_moved once per tile crossed, in order, along the stored path', () => {
    let s = makeWorld()
    const r = submitIntent(s, DEFAULT_CONFIG, 'a1', 'walk', { x: 3, y: 0 })
    if (!r.ok) throw new Error(r.reason)
    s = applyAll(s, r.events)
    const first = stepWalk(s, 'a1')
    expect(first.map((e) => e.type)).toEqual([
      'action_progressed',
      'agent_moved',
      'agent_moved',
      'agent_moved',
    ])
    expect(first.slice(1).map((e) => e.payload)).toEqual([
      { id: 'a1', x: 1, y: 0 },
      { id: 'a1', x: 2, y: 0 },
      { id: 'a1', x: 3, y: 0 },
    ])
  })

  it('interrupts with reason blocked when the next tile becomes impassable', () => {
    let s = makeWorld()
    const r = submitIntent(s, DEFAULT_CONFIG, 'a1', 'walk', { x: 4, y: 0 })
    if (!r.ok) throw new Error(r.reason)
    s = applyAll(s, r.events)
    s = applyAll(s, stepWalk(s, 'a1')) // a1 now at (2,0): two tiles this tick
    s = planWall(s, 3, 0)
    const blocked = stepWalk(s, 'a1')
    expect(blocked).toEqual([
      { type: 'action_interrupted', payload: { agentId: 'a1', reason: 'blocked' } },
    ])
    s = applyAll(s, blocked)
    expect(s.agents.a1!.activity).toBeNull()
    expect([s.agents.a1!.x, s.agents.a1!.y]).toEqual([2, 0])
  })

  it('★ stops AT a wall that appears mid-stride — three tiles a tick never clips through one', () => {
    let s = makeWorld()
    const r = submitIntent(s, DEFAULT_CONFIG, 'a1', 'walk', { x: 6, y: 0 })
    if (!r.ok) throw new Error(r.reason)
    s = applyAll(s, r.events)
    // The wall lands on the SECOND tile of a three-tile stride, after the path was already stored.
    s = planWall(s, 2, 0)
    const step = stepWalk(s, 'a1')
    expect(step.map((e) => e.type)).toEqual(['action_progressed', 'agent_moved'])
    s = applyAll(s, step)
    expect([s.agents.a1!.x, s.agents.a1!.y]).toEqual([1, 0]) // beside the wall, not past it
    expect(stepWalk(s, 'a1')).toEqual([
      { type: 'action_interrupted', payload: { agentId: 'a1', reason: 'blocked' } },
    ])
  })
})

describe('verb registry', () => {
  it('walk is registered and has no skill track', () => {
    expect(VERBS.walk).toBeDefined()
    expect(VERBS.walk!.kind).toBe('walk')
    expect(VERBS.walk!.skill).toBeUndefined()
  })
})

// One policy over the whole registry: no act elbows another out of a pair of busy hands. What
// changed in task 30 is that a body may take its OWN hands off the work, by the one verb for it.
describe('★ ONE INTERRUPT POLICY, AND IT IS NOT THE VERB’S TO DECLARE', () => {
  const CFG = DEFAULT_CONFIG
  const busyWith = (verb: string): WorldState =>
    applyAll(makeWorld(), [
      { type: 'action_started', payload: { agentId: 'a1', verb, params: {}, duration: 100 } },
    ])

  // The policy is about the HANDS. `speak` declares `atOnce`, because a body with an axe in its
  // hands can still answer when it is spoken to; `stop` is what puts the axe down. Widening this
  // set is a visible edit.
  it('★ the mouth and the setting-down are the only things that do not wait for the hands', () => {
    const exempt = Object.keys(VERBS)
      .filter((k) => VERBS[k]!.atOnce !== undefined)
      .sort()
    expect(exempt).toEqual(['speak', 'stop'])
    const r = submitIntent(busyWith('build'), CFG, 'a1', 'speak', { text: 'over here' })
    expect(r.ok).toBe(true)
    expect(r.ok && r.events.some((e) => e.type === 'action_started'), 'a word took the slot').toBe(
      false,
    )
  })

  it('★ refuses a second intent while ANY verb in the registry is running — all of them', () => {
    // `walk` is excluded because `fold` re-plans its path from the params and this fixture
    // gives it none; its refusal is asserted by name in the busy-agent test above.
    const kinds = Object.keys(VERBS).filter((k) => k !== 'walk')
    expect(kinds.length, 'the registry emptied out').toBeGreaterThan(30)
    const answers = new Set<string>()
    for (const kind of kinds) {
      const r = submitIntent(busyWith(kind), CFG, 'a1', 'sleep', {})
      answers.add(r.ok ? `ACCEPTED while ${kind}` : r.reason.replace(` ${kind}`, ' <verb>'))
    }
    expect([...answers], 'a verb got a different answer from the rest').toEqual([
      'already busy with <verb>',
    ])
  })

  it('★ and an act ends early only through the event the fold reads, never a mutation beside it', () => {
    const s = busyWith('sleep')
    expect(s.agents.a1!.activity).not.toBeNull()
    // Still true of every act but the one: eat does not get to shove sleep aside.
    expect(submitIntent(s, CFG, 'a1', 'eat', {}).ok).toBe(false)
    // `intent.ts` names no interruption of its own: the verb emits it, and every one of them —
    // the world's four reasons and the mind's — is a payload the fold applies.
    const src = readFileSync(new URL('./intent.ts', import.meta.url), 'utf8')
    expect(src, 'submitIntent learned to interrupt behind the registry').not.toContain(
      'action_interrupted',
    )
    for (const reason of ['blocked', 'gone', 'collapsed', 'rest', ACT_SET_DOWN]) {
      const cleared = applyAll(s, [
        { type: 'action_interrupted', payload: { agentId: 'a1', reason } },
      ])
      expect(cleared.agents.a1!.activity, reason).toBeNull()
    }
  })
})

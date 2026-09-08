import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import {
  ADULT_AGE_DAYS,
  DEFAULT_CONFIG,
  MINUTES_PER_DAY,
  TICK_REAL_MS,
  type SimEvent,
} from '@sj/shared'
import { genesisState, type TileId, type WorldState } from './state.js'
import { fold } from './fold.js'
import { submitIntent } from './intent.js'
import type { LawPredicate } from './socialLaws.js'
import { runAct } from './testutil/world.js'
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

  it('a body on the ground may still drink at the water and step out of a room', () => {
    const river = patchAgent(makeWorld(['~.......']), 'a1', { collapsedSinceTick: 5, x: 1, y: 0 })
    expect(submitIntent(river, DEFAULT_CONFIG, 'a1', 'drink', {}).ok).toBe(true)
    const indoors = patchAgent(makeWorld(), 'a1', {
      collapsedSinceTick: 5,
      insideId: 'structure_1',
    })
    expect(submitIntent(indoors, DEFAULT_CONFIG, 'a1', 'exit', {}).ok).toBe(true)
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
    expect(done.ticks * TICK_REAL_MS).toBe(30_000)
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
  // hands can still answer when it is spoken to; `stop` is what puts the axe down; an ask and a
  // parting are words too. Widening this set is a visible edit.
  it('★ the mouth, the setting-down and the asking are the only things that do not wait for the hands', () => {
    const exempt = Object.keys(VERBS)
      .filter((k) => VERBS[k]!.atOnce !== undefined)
      .sort()
    expect(exempt).toEqual(['court', 'leave_partner', 'lie_with', 'propose', 'speak', 'stop'])
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

// ── the town's own rules, judged where the world's are ─────────────────────────────────────
const NIGHT = 22 * 60
const NOON = 12 * 60

const ratified = (lawId: string, text: string, predicate: LawPredicate): unknown => ({
  lawId,
  agentId: 'a1',
  text,
  why: 'they said so',
  predicate,
  votes: { for: ['a1'], against: [] },
})

const at = (s: WorldState, tick: number): WorldState => ({ ...s, tick })

const lawEv = (type: string, payload: unknown, tick = 0): SimEvent => ({
  seq: seq++,
  tick,
  type,
  payload,
})

/** A storehouse at (4,4) with a1 on its doorstep, and room around it for a crowd. */
function lawWorld(): WorldState {
  let s = genesisState(
    DEFAULT_CONFIG,
    Array.from({ length: 24 }, () => Array.from({ length: 24 }, (): TileId => 0)),
  )
  s = fold(
    s,
    lawEv('structure_planned', {
      id: 'structure_1',
      kind: 'storehouse',
      x: 4,
      y: 4,
      w: 2,
      h: 2,
      maxHp: 20,
      flammable: true,
      builderId: 'a1',
    }),
  )
  s = fold(s, lawEv('structure_completed', { id: 'structure_1' }))
  return fold(
    s,
    lawEv('agent_spawned', { id: 'a1', name: 'a1', x: 4, y: 6, ageDays: ADULT_AGE_DAYS }),
  )
}

const spawn = (s: WorldState, id: string, x: number, y: number): WorldState =>
  fold(s, lawEv('agent_spawned', { id, name: id, x, y, ageDays: ADULT_AGE_DAYS }))

const shelve = (s: WorldState, id: string, kind: string, where: unknown): WorldState =>
  fold(s, lawEv('item_spawned', { id, kind, qty: 1, loc: where }))

const finished = (s: WorldState, verb: string, params: object, tick: number): WorldState =>
  fold(
    fold(s, lawEv('action_started', { agentId: 'a1', verb, params, duration: 1 }, tick)),
    lawEv('action_completed', { agentId: 'a1', verb }, tick),
  )

const forbidAtNight: LawPredicate = { kind: 'forbid', verb: 'take', when: 'night' }

describe('a law the town wrote', () => {
  it('forbid is witnessed and never blocked: the act goes through, the neighbours see it', () => {
    let s = lawWorld()
    s = spawn(s, 'near', 6, 6)
    s = spawn(s, 'also', 4, 9)
    s = spawn(s, 'faraway', 4, 18)
    s = spawn(s, 'indoors', 5, 4)
    s = fold(s, lawEv('agent_entered', { agentId: 'indoors', structureId: 'structure_1' }))
    s = shelve(s, 'item_1', 'bread', { t: 'tile', x: 4, y: 6 })
    s = fold(
      s,
      lawEv('law_ratified', ratified('law_1', 'No taking after dark.', forbidAtNight), 10),
    )

    const r = submitIntent(at(s, NIGHT), DEFAULT_CONFIG, 'a1', 'take', { itemId: 'item_1' })
    expect(r.ok).toBe(true)
    expect(r.ok && r.events.map((e) => e.type)).toEqual(['action_started', 'law_broken'])
    expect(r.ok && r.events[1]?.payload).toEqual({
      lawId: 'law_1',
      agentId: 'a1',
      verb: 'take',
      witnesses: ['also', 'near'],
    })
  })

  it('the same law at noon is no law at all, and a law let go of is none either', () => {
    let s = lawWorld()
    s = spawn(s, 'near', 6, 6)
    s = shelve(s, 'item_1', 'bread', { t: 'tile', x: 4, y: 6 })
    s = fold(
      s,
      lawEv('law_ratified', ratified('law_1', 'No taking after dark.', forbidAtNight), 10),
    )

    const day = submitIntent(at(s, NOON), DEFAULT_CONFIG, 'a1', 'take', { itemId: 'item_1' })
    expect(day.ok && day.events.map((e) => e.type)).toEqual(['action_started'])

    const gone = fold(s, lawEv('law_repealed', { lawId: 'law_1', agentId: 'a1', text: 'x' }, 20))
    const after = submitIntent(at(gone, NIGHT), DEFAULT_CONFIG, 'a1', 'take', { itemId: 'item_1' })
    expect(after.ok && after.events.map((e) => e.type)).toEqual(['action_started'])
  })

  it('a law for the weekend bites on Saturday and Sunday and on no other day', () => {
    let s = lawWorld()
    s = spawn(s, 'near', 6, 6)
    s = shelve(s, 'item_1', 'bread', { t: 'tile', x: 4, y: 6 })
    s = fold(
      s,
      lawEv(
        'law_ratified',
        ratified('law_1', 'No taking on the weekend.', {
          kind: 'forbid',
          verb: 'take',
          when: 'weekend',
        }),
        10,
      ),
    )
    const types = (day: number) => {
      const r = submitIntent(at(s, day * MINUTES_PER_DAY + NOON), DEFAULT_CONFIG, 'a1', 'take', {
        itemId: 'item_1',
      })
      return r.ok && r.events.map((e) => e.type)
    }
    expect(types(4)).toEqual(['action_started'])
    expect(types(5)).toEqual(['action_started', 'law_broken'])
    expect(types(6)).toEqual(['action_started', 'law_broken'])
    expect(types(7)).toEqual(['action_started'])
  })

  it('a rule the world holds nobody to never fires', () => {
    let s = lawWorld()
    s = shelve(s, 'item_1', 'bread', { t: 'tile', x: 4, y: 6 })
    s = fold(s, lawEv('law_ratified', ratified('law_1', 'Be kind.', { kind: 'none' }), 10))
    const r = submitIntent(at(s, NIGHT), DEFAULT_CONFIG, 'a1', 'take', { itemId: 'item_1' })
    expect(r.ok && r.events.map((e) => e.type)).toEqual(['action_started'])
  })

  it('require_before refuses in the town’s own words until the thing asked for is done today', () => {
    let s = lawWorld()
    s = shelve(s, 'item_1', 'bread', { t: 'tile', x: 4, y: 6 })
    const text = 'Sleep before you lift a thing.'
    s = fold(
      s,
      lawEv(
        'law_ratified',
        ratified('law_1', text, {
          kind: 'require_before',
          verb: 'take',
          before: 'sleep',
        }),
        10,
      ),
    )

    expect(submitIntent(at(s, NOON), DEFAULT_CONFIG, 'a1', 'take', { itemId: 'item_1' })).toEqual({
      ok: false,
      reason: `the town agreed: ${text}`,
    })

    const slept = finished(at(s, NOON), 'sleep', {}, NOON)
    expect(slept.agents.a1!.lawMarks).toEqual({ sleep: NOON })
    expect(
      submitIntent(at(slept, NOON + 60), DEFAULT_CONFIG, 'a1', 'take', { itemId: 'item_1' }).ok,
    ).toBe(true)
    // A night's sleep does not carry: the rule asks again the next morning.
    expect(
      submitIntent(at(slept, NOON + MINUTES_PER_DAY), DEFAULT_CONFIG, 'a1', 'take', {
        itemId: 'item_1',
      }).ok,
    ).toBe(false)
  })

  it('common lets you take your first from the store and refuses the second', () => {
    let s = lawWorld()
    s = shelve(s, 'item_1', 'bread', { t: 'structure', id: 'structure_1' })
    const text = 'One loaf each from the store.'
    s = fold(
      s,
      lawEv(
        'law_ratified',
        ratified('law_1', text, {
          kind: 'common',
          itemKind: 'bread',
          structureId: 'structure_1',
        }),
        10,
      ),
    )

    expect(submitIntent(at(s, NOON), DEFAULT_CONFIG, 'a1', 'take', { itemId: 'item_1' }).ok).toBe(
      true,
    )

    const holding = shelve(s, 'item_2', 'bread', { t: 'agent', id: 'a1' })
    expect(
      submitIntent(at(holding, NOON), DEFAULT_CONFIG, 'a1', 'take', { itemId: 'item_1' }),
    ).toEqual({ ok: false, reason: `the town agreed: ${text}` })
  })

  it('tithe refuses the take until the shelving is paid for, and asks again next period', () => {
    let s = lawWorld()
    s = shelve(s, 'item_1', 'wood', { t: 'structure', id: 'structure_1' })
    s = shelve(s, 'item_2', 'wood', { t: 'agent', id: 'a1' })
    const text = 'A log in before a log out.'
    s = fold(
      s,
      lawEv(
        'law_ratified',
        ratified('law_1', text, {
          kind: 'tithe',
          itemKind: 'wood',
          qty: 1,
          to: 'structure_1',
          every: 'day',
        }),
        10,
      ),
    )

    expect(submitIntent(at(s, NOON), DEFAULT_CONFIG, 'a1', 'take', { itemId: 'item_1' })).toEqual({
      ok: false,
      reason: `the town agreed: ${text}`,
    })

    const paid = finished(
      at(s, NOON),
      'stow',
      { itemId: 'item_2', structureId: 'structure_1' },
      NOON,
    )
    expect(paid.agents.a1!.lawMarks).toEqual({ law_1: 0 })
    expect(
      submitIntent(at(paid, NOON), DEFAULT_CONFIG, 'a1', 'take', { itemId: 'item_1' }).ok,
    ).toBe(true)
    expect(
      submitIntent(at(paid, NOON + MINUTES_PER_DAY), DEFAULT_CONFIG, 'a1', 'take', {
        itemId: 'item_1',
      }).ok,
    ).toBe(false)
  })

  it('a walk composed to reach the thing breaks nothing; the act at the end of it does, once', () => {
    let s = lawWorld()
    s = spawn(s, 'near', 4, 12)
    s = shelve(s, 'item_1', 'bread', { t: 'tile', x: 4, y: 11 })
    s = fold(
      s,
      lawEv('law_ratified', ratified('law_1', 'No taking after dark.', forbidAtNight), 10),
    )

    const night = at(s, NIGHT)
    const composed = submitIntent(night, DEFAULT_CONFIG, 'a1', 'take', { itemId: 'item_1' })
    expect(composed.ok && composed.events.map((e) => e.type)).toEqual(['action_started'])
    expect(composed.ok && (composed.events[0]!.payload as { verb: string }).verb).toBe('walk')

    const started = composed.ok
      ? composed.events.reduce(
          (w, e) => fold(w, lawEv(e.type, e.payload, NIGHT), DEFAULT_CONFIG),
          night,
        )
      : night
    const broken = runAct(started, DEFAULT_CONFIG).events.filter((e) => e.type === 'law_broken')
    expect(broken).toHaveLength(1)
    expect(broken[0]!.payload).toMatchObject({ lawId: 'law_1', agentId: 'a1', verb: 'take' })
  })
})

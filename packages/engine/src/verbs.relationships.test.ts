import { describe, it, expect } from 'vitest'
import {
  ADULT_AGE_DAYS,
  DAYS_PER_YEAR,
  INVITATION_STANDS_TICKS,
  MINUTES_PER_DAY,
  SimConfigSchema,
  stateHash,
  type SimConfig,
} from '@sj/shared'
import { fold } from './fold.js'
import { submitIntent, type IntentResult } from './intent.js'
import { RngStream, RngStreams } from './rng.js'
import { genesisState, type WorldState } from './state.js'
import { createWorldTick } from './worldTick.js'
import type { PendingEvent } from './verbs/index.js'
import { ev, grid } from './testutil/world.js'

// A relationship is two intents in the log. Every row here is about which two, and when.

const CFG: SimConfig = SimConfigSchema.parse({
  weather: { hourlyChangeChance: 0 },
  mystery: { chancePerDay: 0 },
})

type Box = { id: string; kind: string; x: number; y: number; w: number; h: number }
const HOUSE: Box = { id: 'structure_1', kind: 'house', x: 4, y: 4, w: 3, h: 3 }
const STORE: Box = { id: 'structure_2', kind: 'storehouse', x: 7, y: 4, w: 3, h: 3 }
const HUT: Box = { id: 'structure_3', kind: 'house', x: 10, y: 10, w: 3, h: 3 }

function raise(s: WorldState, box: Box, owner?: string): WorldState {
  const planned = fold(
    s,
    ev('structure_planned', {
      ...box,
      maxHp: 50,
      flammable: true,
      builderId: 'script',
      ...(owner === undefined ? {} : { owner }),
    }),
    CFG,
  )
  return fold(planned, ev('structure_completed', { id: box.id }), CFG)
}

type Body = { id: string; x: number; y: number; sex?: 'f' | 'm'; ageDays?: number; inside?: Box }

function spawn(s: WorldState, b: Body): WorldState {
  let out = fold(
    s,
    ev('agent_spawned', {
      id: b.id,
      name: b.id,
      x: b.x,
      y: b.y,
      ageDays: b.ageDays ?? ADULT_AGE_DAYS,
      ...(b.sex === undefined ? {} : { sex: b.sex }),
    }),
    CFG,
  )
  if (b.inside)
    out = fold(out, ev('agent_entered', { agentId: b.id, structureId: b.inside.id }), CFG)
  return out
}

/** Two adults side by side on the grass, and a third at their elbow to witness. */
function town(bodies: Body[]): WorldState {
  let s = raise(genesisState(CFG, grid(16)), HOUSE)
  s = raise(s, STORE)
  s = raise(s, HUT, 'a3')
  for (const b of bodies) s = spawn(s, b)
  return s
}

const outside = (): WorldState =>
  town([
    { id: 'a1', x: 1, y: 1, sex: 'f' },
    { id: 'a2', x: 2, y: 1, sex: 'm' },
  ])

// Both under one roof, standing on the same tile — the shape lie_with is the only verb to need.
const indoors = (box = HOUSE): WorldState =>
  town([
    { id: 'a1', x: box.x, y: box.y, sex: 'f', inside: box },
    { id: 'a2', x: box.x, y: box.y, sex: 'm', inside: box },
  ])

const at = (s: WorldState, tick: number): WorldState => ({ ...s, tick })

const apply = (s: WorldState, events: PendingEvent[], tick = s.tick): WorldState =>
  events.reduce((acc, e) => fold(acc, ev(e.type, e.payload, tick), CFG), s)

const ask = (s: WorldState, id: string, verb: string, targetId = id === 'a1' ? 'a2' : 'a1') =>
  submitIntent(s, CFG, id, verb, { targetId })

const refusal = (r: IntentResult): string => (r.ok ? 'not refused' : r.reason)

/** The ask landed and folded — the state a second consent is judged against. */
function asked(s: WorldState, id = 'a1', verb = 'court', targetId?: string): WorldState {
  const r = targetId === undefined ? ask(s, id, verb) : ask(s, id, verb, targetId)
  expect(r.ok && r.events.map((e) => e.type)).toEqual(['invited'])
  return apply(s, r.ok ? r.events : [])
}

describe('the ask', () => {
  it('writes one invited event and nothing else', () => {
    const s = outside()
    const r = ask(s, 'a1', 'court')
    expect(r.ok && r.events).toEqual([
      { type: 'invited', payload: { agentId: 'a2', byId: 'a1', verb: 'court' } },
    ])
  })

  it('folds onto the invitee, and moves the hash it is state on', () => {
    const s = at(outside(), 90)
    const after = asked(s)
    expect(after.agents.a2!.asked).toEqual({ byId: 'a1', verb: 'court', tick: 90 })
    expect(after.agents.a1).not.toHaveProperty('asked')
    expect(stateHash(after)).not.toBe(stateHash(s))
  })

  it('leaves a town that has asked nothing hashing exactly as it did', () => {
    const s = outside()
    const slept = fold(s, ev('agent_slept', { agentId: 'a1' }), CFG)
    expect(slept.agents.a1).not.toHaveProperty('asked')
    expect(slept.agents.a1).not.toHaveProperty('partnerId')
    expect(stateHash(slept)).toBe(stateHash(fold(s, ev('agent_slept', { agentId: 'a1' }), CFG)))
  })

  it('across the square is a walk with the ask hung on the end of it, not a refusal', () => {
    const s = town([
      { id: 'a1', x: 1, y: 1 },
      { id: 'a2', x: 9, y: 9 },
    ])
    const r = ask(s, 'a1', 'court')
    expect(r.ok).toBe(true)
    const started = r.ok ? r.events.find((e) => e.type === 'action_started') : undefined
    expect(started?.payload).toMatchObject({
      verb: 'walk',
      then: { verb: 'court', params: { targetId: 'a2' } },
    })
  })

  it('last ask wins: a second suitor overwrites the first', () => {
    let s = town([
      { id: 'a1', x: 1, y: 1 },
      { id: 'a2', x: 2, y: 1 },
      { id: 'a3', x: 3, y: 1 },
    ])
    s = at(s, 10)
    s = asked(s)
    s = asked(at(s, 20), 'a3', 'court', 'a2')
    expect(s.agents.a2!.asked).toEqual({ byId: 'a3', verb: 'court', tick: 20 })
  })
})

describe('what the town will not let you ask', () => {
  it('refuses yourself, the dead and the sleeping in words', () => {
    const s = outside()
    expect(refusal(ask(s, 'a1', 'court', 'a1'))).toBe('you cannot ask yourself')
    expect(refusal(ask(s, 'a1', 'court', 'nobody'))).toBe('no one there to ask')
    const dozing = fold(s, ev('agent_slept', { agentId: 'a2' }), CFG)
    expect(refusal(ask(dozing, 'a1', 'court'))).toBe('they are asleep')
  })

  it('refuses a child on either side of it', () => {
    const young = town([
      { id: 'a1', x: 1, y: 1 },
      { id: 'a2', x: 2, y: 1, ageDays: 10 * DAYS_PER_YEAR },
    ])
    expect(refusal(ask(young, 'a1', 'court'))).toBe('that is not for a child')
    expect(refusal(ask(young, 'a2', 'court'))).toBe('that is not for a child')
  })

  it('refuses blood: a parent, a child, and a sister', () => {
    const s = outside()
    const kin = (parents: Record<string, [string, string]>): WorldState => ({
      ...s,
      agents: Object.fromEntries(
        Object.entries(s.agents).map(([id, a]) => [
          id,
          parents[id] ? { ...a, parents: parents[id] } : a,
        ]),
      ),
    })
    expect(refusal(ask(kin({ a2: ['a1', 'x'] }), 'a1', 'court'))).toBe('they are your own blood')
    expect(refusal(ask(kin({ a1: ['a2', 'x'] }), 'a1', 'court'))).toBe('they are your own blood')
    expect(refusal(ask(kin({ a1: ['m', 'f'], a2: ['m', 'f'] }), 'a1', 'court'))).toBe(
      'they are your own blood',
    )
  })

  it('refuses a proposal from or to somebody already partnered', () => {
    let s = town([
      { id: 'a1', x: 1, y: 1 },
      { id: 'a2', x: 2, y: 1 },
      { id: 'a3', x: 3, y: 1 },
    ])
    s = fold(s, ev('partnership_formed', { aId: 'a2', bId: 'a3' }), CFG)
    expect(refusal(ask(s, 'a1', 'propose', 'a2'))).toBe('they already have a partner')
    expect(refusal(ask(s, 'a2', 'propose', 'a1'))).toBe('you already have a partner')
    // Courting the same person is not refused: only the partnership is exclusive.
    expect(ask(s, 'a1', 'court', 'a2').ok).toBe(true)
  })

  it('refuses lying together anywhere but a roof of your own', () => {
    expect(refusal(ask(outside(), 'a1', 'lie_with'))).toBe('not under a roof of your own')
    expect(refusal(ask(indoors(STORE), 'a1', 'lie_with'))).toBe('not under a roof of your own')
    expect(refusal(ask(indoors(HUT), 'a1', 'lie_with'))).toBe('not under a roof of your own')
    const apart = town([
      { id: 'a1', x: 6, y: 4, inside: HOUSE },
      { id: 'a2', x: 7, y: 4, inside: STORE },
    ])
    expect(refusal(ask(apart, 'a1', 'lie_with'))).toBe('not under a roof of your own')
    expect(ask(indoors(), 'a1', 'lie_with').ok).toBe(true)
  })

  it('says which act has no one named', () => {
    const s = outside()
    expect(refusal(submitIntent(s, CFG, 'a1', 'court', {}))).toBe('court needs someone to ask')
    expect(refusal(submitIntent(s, CFG, 'a1', 'lie_with', {}))).toBe(
      'lie with needs someone to ask',
    )
    expect(refusal(submitIntent(s, CFG, 'a1', 'leave_partner', {}))).toBe(
      'leaving needs the partner named',
    )
  })
})

describe('the answer', () => {
  it('the same verb aimed back is the acceptance, and a partnership is formed by it', () => {
    let s = at(outside(), 100)
    s = asked(s, 'a1', 'propose')
    const back = ask(s, 'a2', 'propose')
    expect(back.ok && back.events).toEqual([
      { type: 'invitation_accepted', payload: { agentId: 'a2', byId: 'a1', verb: 'propose' } },
      { type: 'partnership_formed', payload: { aId: 'a1', bId: 'a2' } },
    ])
    s = apply(s, back.ok ? back.events : [])
    expect(s.agents.a1!.partnerId).toBe('a2')
    expect(s.agents.a2!.partnerId).toBe('a1')
    expect(s.agents.a2).not.toHaveProperty('asked')
  })

  it('sorts the pair, whoever asked first', () => {
    let s = at(outside(), 100)
    s = asked(s, 'a2', 'propose')
    const back = ask(s, 'a1', 'propose')
    expect(back.ok && back.events[1]).toEqual({
      type: 'partnership_formed',
      payload: { aId: 'a1', bId: 'a2' },
    })
  })

  it('a courtship consummates in the acceptance alone', () => {
    let s = at(outside(), 100)
    s = asked(s, 'a1', 'court')
    const back = ask(s, 'a2', 'court')
    expect(back.ok && back.events).toEqual([
      { type: 'invitation_accepted', payload: { agentId: 'a2', byId: 'a1', verb: 'court' } },
    ])
  })

  // Rehearsal 12: 113 asks to court in under three sim-days, the same pair nine times in a day.
  it('★ a pair walks out together once a day, whoever asks the second time', () => {
    let s = at(outside(), 100)
    s = asked(s, 'a1', 'court')
    const back = ask(s, 'a2', 'court')
    s = apply(s, back.ok ? back.events : [])
    expect(s.agents.a1!.courted).toEqual({ withId: 'a2', day: 0 })
    expect(s.agents.a2!.courted).toEqual({ withId: 'a1', day: 0 })
    expect(refusal(ask(at(s, 900), 'a1', 'court'))).toBe('you walked out together already today')
    expect(refusal(ask(at(s, 900), 'a2', 'court'))).toBe('you walked out together already today')
    // the next morning it is an ask again, and a proposal was never held back by it
    expect(ask(at(s, 1500), 'a1', 'court').ok).toBe(true)
    expect(ask(at(s, 900), 'a1', 'propose').ok).toBe(true)
  })

  it('a stale ask is a fresh ask, not an answer', () => {
    let s = at(outside(), 100)
    s = asked(s, 'a1', 'propose')
    const inTime = ask(at(s, 100 + INVITATION_STANDS_TICKS), 'a2', 'propose')
    expect(inTime.ok && inTime.events[0]!.type).toBe('invitation_accepted')
    const late = ask(at(s, 101 + INVITATION_STANDS_TICKS), 'a2', 'propose')
    expect(late.ok && late.events).toEqual([
      { type: 'invited', payload: { agentId: 'a1', byId: 'a2', verb: 'propose' } },
    ])
  })

  it('another verb aimed back is a new ask, not an answer', () => {
    const s = asked(at(outside(), 100), 'a1', 'court')
    const other = ask(s, 'a2', 'propose')
    expect(other.ok && other.events).toEqual([
      { type: 'invited', payload: { agentId: 'a1', byId: 'a2', verb: 'propose' } },
    ])
  })

  it('a refusal clears only the ask it answers', () => {
    const s = asked(at(outside(), 100), 'a1', 'court')
    const cleared = fold(
      s,
      ev('invitation_refused', { agentId: 'a2', byId: 'a1', verb: 'court', witnesses: [] }, 110),
      CFG,
    )
    expect(cleared.agents.a2).not.toHaveProperty('asked')
    for (const wrong of [
      { agentId: 'a2', byId: 'a2', verb: 'court', witnesses: [] },
      { agentId: 'a2', byId: 'a1', verb: 'propose', witnesses: [] },
    ]) {
      expect(fold(s, ev('invitation_refused', wrong, 110), CFG)).toBe(s)
    }
  })
})

describe('lying together', () => {
  const accepted = (tick = 480): WorldState => {
    let s = at(indoors(), tick)
    s = asked(s, 'a1', 'lie_with')
    const back = ask(s, 'a2', 'lie_with')
    expect(back.ok).toBe(true)
    return apply(s, back.ok ? back.events : [])
  }

  it('sets both bodies going for the hour, each aimed at the other', () => {
    let s = at(indoors(), 480)
    s = asked(s, 'a1', 'lie_with')
    const back = ask(s, 'a2', 'lie_with')
    expect(back.ok && back.events).toEqual([
      { type: 'invitation_accepted', payload: { agentId: 'a2', byId: 'a1', verb: 'lie_with' } },
      {
        type: 'action_started',
        payload: {
          agentId: 'a2',
          verb: 'lie_with',
          params: { targetId: 'a1' },
          duration: 60,
        },
      },
      {
        type: 'action_started',
        payload: {
          agentId: 'a1',
          verb: 'lie_with',
          params: { targetId: 'a2' },
          duration: 60,
        },
      },
    ])
    const busy = apply(s, back.ok ? back.events : [])
    expect(busy.agents.a1!.activity).toMatchObject({ verb: 'lie_with', ticksRemaining: 60 })
    expect(busy.agents.a2!.activity).toMatchObject({ verb: 'lie_with', ticksRemaining: 60 })
  })

  it('leaves the mouth free and the hands full', () => {
    const s = accepted()
    expect(submitIntent(s, CFG, 'a1', 'speak', { text: 'stay' }).ok).toBe(true)
    expect(refusal(submitIntent(s, CFG, 'a1', 'craft', { recipe: 'plank' }))).toBe(
      'already busy with lie_with',
    )
  })

  it('will not be accepted by hands that are already full', () => {
    let s = at(indoors(), 480)
    s = asked(s, 'a1', 'lie_with')
    const busy = apply(s, [
      {
        type: 'action_started',
        payload: { agentId: 'a2', verb: 'sleep', params: {}, duration: 30 },
      },
    ])
    expect(refusal(ask(busy, 'a2', 'lie_with'))).toBe('your hands are full')
  })
})

describe('the one roll', () => {
  // Sixty ticks of the real pipeline on ONE stream set, the way a running town holds it.
  function hour(s: WorldState, seed: string): { state: WorldState; events: PendingEvent[] } {
    const rng = new RngStreams(seed)
    const tick = createWorldTick(CFG, rng)
    let state = s
    const events: PendingEvent[] = []
    for (let i = 0; i < 60; i++) {
      const advanced = fold(state, ev('tick_advanced', {}, state.tick + 1), CFG)
      const out = tick(advanced)
      state = out.state
      events.push(...out.events)
    }
    return { state, events }
  }

  const drawn = (seed: string): number => RngStream.seed(seed, 'reproduction').next()
  const untouched = (seed: string) => RngStream.seed(seed, 'reproduction').state()

  function lying(bodies: Body[], tick = 480): WorldState {
    let s = at(town(bodies), tick)
    s = asked(s, 'a1', 'lie_with')
    const back = ask(s, 'a2', 'lie_with')
    expect(back.ok).toBe(true)
    return apply(s, back.ok ? back.events : [])
  }

  const FERTILE: Body[] = [
    { id: 'a1', x: HOUSE.x, y: HOUSE.y, sex: 'f', inside: HOUSE },
    { id: 'a2', x: HOUSE.x, y: HOUSE.y, sex: 'm', inside: HOUSE },
  ]

  const conceptions = (events: PendingEvent[]) => events.filter((e) => e.type === 'agent_conceived')

  it('draws once from the reproduction stream when the hour is out, and only then', () => {
    const seed = 'r3'
    expect(drawn(seed)).toBeLessThan(0.2)
    const { state, events } = hour(lying(FERTILE), seed)
    expect(conceptions(events).map((e) => e.payload)).toEqual([
      { motherId: 'a1', fatherId: 'a2', day: 0 },
    ])
    expect(state.agents.a1!.pregnant).toEqual({ sinceDay: 0, byId: 'a2' })
  })

  it('lets the hour pass with nothing conceived when the same stream lands high', () => {
    const seed = 'r0'
    expect(drawn(seed)).toBeGreaterThanOrEqual(0.2)
    expect(conceptions(hour(lying(FERTILE), seed).events)).toEqual([])
  })

  it('replays byte for byte on the same seed', () => {
    const first = hour(lying(FERTILE), 'r3').events
    const second = hour(lying(FERTILE), 'r3').events
    expect(second).toEqual(first)
  })

  it('never reaches the stream at all for a pair that could not conceive', () => {
    const sameSex: Body[] = [
      { id: 'a1', x: HOUSE.x, y: HOUSE.y, sex: 'f', inside: HOUSE },
      { id: 'a2', x: HOUSE.x, y: HOUSE.y, sex: 'f', inside: HOUSE },
    ]
    const old: Body[] = [
      { id: 'a1', x: HOUSE.x, y: HOUSE.y, sex: 'f', ageDays: 60 * DAYS_PER_YEAR, inside: HOUSE },
      { id: 'a2', x: HOUSE.x, y: HOUSE.y, sex: 'm', inside: HOUSE },
    ]
    for (const bodies of [sameSex, old]) {
      const rng = new RngStreams('r3')
      const tick = createWorldTick(CFG, rng)
      let state = lying(bodies)
      for (let i = 0; i < 60; i++) {
        state = tick(fold(state, ev('tick_advanced', {}, state.tick + 1), CFG)).state
      }
      expect(state.agents.a1).not.toHaveProperty('pregnant')
      expect(rng.get('reproduction').state()).toEqual(untouched('r3'))
    }
  })

  it('a partner who broke off is a roll nobody draws', () => {
    const rng = new RngStreams('r3')
    const tick = createWorldTick(CFG, rng)
    let state = lying(FERTILE)
    for (let i = 0; i < 60; i++) {
      if (i === 30) {
        const stop = submitIntent(state, CFG, 'a2', 'stop', {})
        expect(stop.ok).toBe(true)
        state = apply(state, stop.ok ? stop.events : [], state.tick)
      }
      state = tick(fold(state, ev('tick_advanced', {}, state.tick + 1), CFG)).state
    }
    expect(state.agents.a1!.activity).toBeNull()
    expect(state.agents.a1).not.toHaveProperty('pregnant')
    expect(rng.get('reproduction').state()).toEqual(untouched('r3'))
  })
})

describe('leaving', () => {
  const partnered = (): WorldState =>
    fold(
      town([
        { id: 'a1', x: 1, y: 1 },
        { id: 'a2', x: 2, y: 1 },
        { id: 'a3', x: 1, y: 2 },
      ]),
      ev('partnership_formed', { aId: 'a1', bId: 'a2' }),
      CFG,
    )

  it('needs no answer and no one at your elbow', () => {
    const s = partnered()
    const far = { ...s, agents: { ...s.agents, a2: { ...s.agents.a2!, x: 12, y: 12 } } }
    const r = submitIntent(far, CFG, 'a1', 'leave_partner', { targetId: 'a2' })
    expect(r.ok && r.events).toEqual([
      { type: 'partnership_dissolved', payload: { aId: 'a1', bId: 'a2', byId: 'a1' } },
    ])
    const after = apply(far, r.ok ? r.events : [])
    expect(after.agents.a1).not.toHaveProperty('partnerId')
    expect(after.agents.a2).not.toHaveProperty('partnerId')
  })

  it('refuses a partner you do not have', () => {
    expect(refusal(submitIntent(partnered(), CFG, 'a1', 'leave_partner', { targetId: 'a3' }))).toBe(
      'you have no such partner',
    )
  })

  it('opens the way to remarry', () => {
    let s = partnered()
    s = apply(s, [{ type: 'partnership_dissolved', payload: { aId: 'a1', bId: 'a2', byId: 'a1' } }])
    s = at(s, 50)
    s = asked(s, 'a1', 'propose', 'a3')
    const back = ask(s, 'a3', 'propose', 'a1')
    expect(back.ok && back.events[1]).toEqual({
      type: 'partnership_formed',
      payload: { aId: 'a1', bId: 'a3' },
    })
  })
})

describe('the partnership fold', () => {
  const three = (): WorldState =>
    town([
      { id: 'a1', x: 1, y: 1 },
      { id: 'a2', x: 2, y: 1 },
      { id: 'a3', x: 3, y: 1 },
    ])

  it('is idempotent for a pair already partnered to each other', () => {
    const s = fold(three(), ev('partnership_formed', { aId: 'a1', bId: 'a2' }), CFG)
    expect(fold(s, ev('partnership_formed', { aId: 'a1', bId: 'a2' }), CFG)).toBe(s)
  })

  it('throws rather than quietly stealing somebody already partnered', () => {
    const s = fold(three(), ev('partnership_formed', { aId: 'a1', bId: 'a2' }), CFG)
    expect(() => fold(s, ev('partnership_formed', { aId: 'a1', bId: 'a3' }), CFG)).toThrow(
      /already has a partner/,
    )
    expect(() => fold(three(), ev('partnership_formed', { aId: 'a1', bId: 'gone' }), CFG)).toThrow(
      /unknown agent/,
    )
  })

  it('undoes only a partnership that points both ways', () => {
    const s = fold(three(), ev('partnership_formed', { aId: 'a1', bId: 'a2' }), CFG)
    expect(fold(s, ev('partnership_dissolved', { aId: 'a1', bId: 'a3', byId: 'a1' }), CFG)).toBe(s)
  })
})

describe('a day of it, replayed', () => {
  it('lands the live run and its replay on the same state', () => {
    let s = at(indoors(), MINUTES_PER_DAY / 2)
    const script: [string, string, string][] = [
      ['a1', 'court', 'a2'],
      ['a2', 'court', 'a1'],
      ['a1', 'propose', 'a2'],
      ['a2', 'propose', 'a1'],
      ['a1', 'leave_partner', 'a2'],
    ]
    const log: { type: string; payload: unknown; tick: number }[] = []
    for (const [id, verb, targetId] of script) {
      const r = submitIntent(s, CFG, id, verb, { targetId })
      expect(r.ok, `${id} ${verb}`).toBe(true)
      if (!r.ok) continue
      for (const e of r.events) log.push({ ...e, tick: s.tick })
      s = apply(s, r.events)
      s = at(s, s.tick + 1)
    }
    const replayed = log.reduce(
      (acc, e) => fold(acc, ev(e.type, e.payload, e.tick), CFG),
      at(indoors(), MINUTES_PER_DAY / 2),
    )
    expect(stateHash(replayed)).toBe(stateHash(at(s, MINUTES_PER_DAY / 2)))
  })
})

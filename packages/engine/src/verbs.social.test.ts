import { describe, it, expect } from 'vitest'
import { SimConfigSchema, type SimConfig } from '@sj/shared'
import { genesisState, type TileId, type WorldState } from './state.js'
import { fold } from './fold.js'
import { submitIntent } from './intent.js'
import { VERBS } from './verbs/index.js'
import { RngStreams } from './rng.js'
import { createWorldTick, type WorldTickResult } from './worldTick.js'
import { ev } from './testutil/world.js'

const CFG: SimConfig = SimConfigSchema.parse({ weather: { hourlyChangeChance: 0 } })

function makeWorld(
  config = CFG,
  agents: { id: string; x: number; y: number }[] = [
    { id: 'a1', x: 0, y: 0 },
    { id: 'a2', x: 1, y: 0 },
  ],
): WorldState {
  let s = genesisState(
    config,
    Array.from({ length: 16 }, () => Array.from({ length: 16 }, (): TileId => 0)),
  )
  for (const a of agents)
    s = fold(
      s,
      ev('agent_spawned', { id: a.id, name: a.id, x: a.x, y: a.y, ageDays: 7300 }),
      config,
    )
  return s
}
function patchAgent(
  s: WorldState,
  id: string,
  patch: Partial<WorldState['agents'][string]>,
): WorldState {
  return { ...s, agents: { ...s.agents, [id]: { ...s.agents[id]!, ...patch } } }
}
function applyAll(
  s: WorldState,
  events: { type: string; payload: unknown }[],
  config = CFG,
  tick = s.tick,
): WorldState {
  for (const e of events) s = fold(s, ev(e.type, e.payload, tick), config)
  return s
}
function tickOnce(s: WorldState, config = CFG, rng = new RngStreams('t')): WorldTickResult {
  const wt = createWorldTick(config, rng)
  return wt(fold(s, ev('tick_advanced', {}, s.tick + 1), config))
}

describe('verb: speak', () => {
  // ★ THE MOUTH IS NOT THE HANDS. A word lands the moment it is said: no `action_started`, no
  // activity slot, no tick. It used to take one of each, which is why a working body was mute.
  it('emits agent_spoke at once, with position, and stamps lastSpokeTick', () => {
    let s = makeWorld()
    const r = submitIntent(s, CFG, 'a1', 'speak', { text: 'hello' })
    if (!r.ok) throw new Error(r.reason)
    expect(r.events.map((e) => e.type)).toEqual(['agent_spoke'])
    expect(r.events).toContainEqual({
      type: 'agent_spoke',
      payload: { agentId: 'a1', text: 'hello', x: 0, y: 0 },
    })
    s = applyAll(s, r.events)
    expect(s.agents.a1!.activity, 'a word took the hands').toBeNull()
    // Stamped where the word landed — this tick, not the next one.
    expect(s.agents.a1!.lastSpokeTick).toBe(s.tick)
  })

  // The runtime submits speech directly while submitIntent refused every act during an activity,
  // so a body raising a 2 880-tick house was mute for two sim-days — 39% of the run's refusals.
  it('★ a body with its hands full can still answer when it is spoken to', () => {
    let s = makeWorld()
    const busy = submitIntent(s, CFG, 'a1', 'build', { kind: 'house', x: 2, y: 2 })
    // Whatever this fixture makes of the build, put the body into SOME activity and check.
    s = applyAll(
      s,
      busy.ok
        ? busy.events
        : [
            {
              type: 'action_started',
              payload: { agentId: 'a1', verb: 'build', params: {}, duration: 500 },
            },
          ],
    )
    expect(s.agents.a1!.activity, 'the fixture did not make the body busy').not.toBeNull()
    const before = s.agents.a1!.activity!.ticksRemaining
    const r = submitIntent(s, CFG, 'a1', 'speak', { text: 'over here' })
    expect(r.ok, r.ok ? '' : r.reason).toBe(true)
    expect(r.ok && r.events).toContainEqual({
      type: 'agent_spoke',
      payload: { agentId: 'a1', text: 'over here', x: 0, y: 0 },
    })
    // And the word did not cost the work: the hands are on the same job, at the same point.
    const after = applyAll(s, r.ok ? r.events : [])
    expect(after.agents.a1!.activity!.verb).toBe('build')
    expect(after.agents.a1!.activity!.ticksRemaining).toBe(before)
  })

  // The exemption is the mouth and nothing else — everything with hands in it still waits.
  it('and every other verb is still refused while the hands are full', () => {
    let s = makeWorld()
    s = applyAll(s, [
      {
        type: 'action_started',
        payload: { agentId: 'a1', verb: 'build', params: {}, duration: 500 },
      },
    ])
    for (const [verb, params] of [
      ['sleep', {}],
      ['eat', { itemId: 'x' }],
      ['walk', { x: 3, y: 3 }],
      ['enter', { structureId: 'y' }],
      ['give', { itemId: 'x', targetId: 'a2' }],
    ] as const) {
      expect(submitIntent(s, CFG, 'a1', verb, params), verb).toEqual({
        ok: false,
        reason: 'already busy with build',
      })
    }
  })

  it('rejects empty text', () => {
    expect(submitIntent(makeWorld(), CFG, 'a1', 'speak', { text: '' })).toEqual({
      ok: false,
      reason: 'speak needs a {text}',
    })
    expect(submitIntent(makeWorld(), CFG, 'a1', 'speak', {})).toEqual({
      ok: false,
      reason: 'speak needs a {text}',
    })
  })
})

describe('verb: give', () => {
  it('moves item ownership to an adjacent target', () => {
    let s = makeWorld()
    s = fold(
      s,
      ev('item_spawned', { id: 'item_1', kind: 'wood', qty: 1, loc: { t: 'agent', id: 'a1' } }),
      CFG,
    )
    const r = submitIntent(s, CFG, 'a1', 'give', { itemId: 'item_1', targetId: 'a2' })
    if (!r.ok) throw new Error(r.reason)
    s = applyAll(s, r.events)
    const res = tickOnce(s)
    expect(res.state.items.item_1!.loc).toEqual({ t: 'agent', id: 'a2' })
  })

  it('rejects non-adjacent target, self, missing target, and unheld items', () => {
    const far = makeWorld(CFG, [
      { id: 'a1', x: 0, y: 0 },
      { id: 'a2', x: 5, y: 5 },
    ])
    const s = fold(
      far,
      ev('item_spawned', { id: 'item_1', kind: 'wood', qty: 1, loc: { t: 'agent', id: 'a1' } }),
      CFG,
    )
    expect(submitIntent(s, CFG, 'a1', 'give', { itemId: 'item_1', targetId: 'a2' })).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/^not adjacent to give — they are at \(/) as string,
    })
    expect(
      submitIntent(makeWorld(), CFG, 'a1', 'give', { itemId: 'item_1', targetId: 'a1' }),
    ).toEqual({ ok: false, reason: 'cannot give to yourself' })
    expect(
      submitIntent(makeWorld(), CFG, 'a1', 'give', { itemId: 'item_1', targetId: 'ghost' }),
    ).toEqual({ ok: false, reason: 'no one there to receive' })
    expect(
      submitIntent(makeWorld(), CFG, 'a1', 'give', { itemId: 'nope', targetId: 'a2' }),
    ).toEqual({ ok: false, reason: 'not holding that' })
  })
})

describe('verb: take', () => {
  it('takes an item from an adjacent tile', () => {
    let s = makeWorld()
    s = fold(
      s,
      ev('item_spawned', { id: 'item_1', kind: 'wood', qty: 1, loc: { t: 'tile', x: 1, y: 0 } }),
      CFG,
    )
    const r = submitIntent(s, CFG, 'a1', 'take', { itemId: 'item_1' })
    if (!r.ok) throw new Error(r.reason)
    s = applyAll(s, r.events)
    const res = tickOnce(s)
    expect(res.state.items.item_1!.loc).toEqual({ t: 'agent', id: 'a1' })
  })

  it('takes an item from an adjacent structure', () => {
    let s = makeWorld()
    s = fold(
      s,
      ev('structure_planned', {
        id: 'structure_1',
        kind: 'house',
        x: 1,
        y: 0,
        w: 2,
        h: 2,
        maxHp: 50,
        flammable: true,
        builderId: 'a1',
      }),
      CFG,
    )
    s = fold(
      s,
      ev('item_spawned', {
        id: 'item_1',
        kind: 'wood',
        qty: 1,
        loc: { t: 'structure', id: 'structure_1' },
      }),
      CFG,
    )
    const r = submitIntent(s, CFG, 'a1', 'take', { itemId: 'item_1' })
    if (!r.ok) throw new Error(r.reason)
    s = applyAll(s, r.events)
    const res = tickOnce(s)
    expect(res.state.items.item_1!.loc).toEqual({ t: 'agent', id: 'a1' })
  })

  it('rejects distant tiles and items held by agents', () => {
    let s = makeWorld()
    s = fold(
      s,
      ev('item_spawned', { id: 'item_1', kind: 'wood', qty: 1, loc: { t: 'tile', x: 9, y: 9 } }),
      CFG,
    )
    expect(submitIntent(s, CFG, 'a1', 'take', { itemId: 'item_1' })).toEqual({
      ok: false,
      reason: 'not close enough to take',
    })
    let held = makeWorld()
    held = fold(
      held,
      ev('item_spawned', { id: 'item_2', kind: 'wood', qty: 1, loc: { t: 'agent', id: 'a2' } }),
      CFG,
    )
    expect(submitIntent(held, CFG, 'a1', 'take', { itemId: 'item_2' })).toEqual({
      ok: false,
      reason: 'someone is holding that',
    })
    expect(submitIntent(makeWorld(), CFG, 'a1', 'take', { itemId: 'ghost' })).toEqual({
      ok: false,
      reason: 'no such item',
    })
  })
})

describe('verbs: write + read', () => {
  it('write creates a note, read surfaces its text via action_completed results', () => {
    let s = makeWorld()
    const rw = submitIntent(s, CFG, 'a1', 'write', { text: 'the password is swordfish' })
    if (!rw.ok) throw new Error(rw.reason)
    s = applyAll(s, rw.events)
    const res = tickOnce(s)
    const note = Object.values(res.state.items).find((i) => i.kind === 'note')!
    expect(note.text).toBe('the password is swordfish')
    expect(note.loc).toEqual({ t: 'agent', id: 'a1' })

    const rr = submitIntent(res.state, CFG, 'a1', 'read', { itemId: note.id })
    if (!rr.ok) throw new Error(rr.reason)
    const s2 = applyAll(res.state, rr.events)
    const res2 = tickOnce(s2)
    const completed = res2.events.find((e) => e.type === 'action_completed')
    expect((completed?.payload as { results?: unknown } | undefined)?.results).toEqual({
      text: 'the password is swordfish',
    })
  })

  it('write updates an existing note in place', () => {
    let s = makeWorld()
    s = fold(
      s,
      ev('item_spawned', {
        id: 'item_1',
        kind: 'note',
        qty: 1,
        loc: { t: 'agent', id: 'a1' },
        text: 'old',
      }),
      CFG,
    )
    const r = submitIntent(s, CFG, 'a1', 'write', { itemId: 'item_1', text: 'new text' })
    if (!r.ok) throw new Error(r.reason)
    s = applyAll(s, r.events)
    const res = tickOnce(s)
    expect(res.state.items.item_1!.text).toBe('new text')
    expect(Object.values(res.state.items)).toHaveLength(1)
  })

  it('write rejects a non-note target; read rejects notes not held or non-notes', () => {
    let s = makeWorld()
    s = fold(
      s,
      ev('item_spawned', { id: 'item_1', kind: 'wood', qty: 1, loc: { t: 'agent', id: 'a1' } }),
      CFG,
    )
    expect(submitIntent(s, CFG, 'a1', 'write', { itemId: 'item_1', text: 'x' })).toEqual({
      ok: false,
      reason: 'not a note',
    })
    expect(submitIntent(s, CFG, 'a1', 'read', { itemId: 'item_1' })).toEqual({
      ok: false,
      reason: 'there is nothing to read',
    })
    expect(submitIntent(s, CFG, 'a1', 'read', { itemId: 'ghost' })).toEqual({
      ok: false,
      reason: 'no such item',
    })
    let onFloor = makeWorld()
    onFloor = fold(
      onFloor,
      ev('item_spawned', {
        id: 'item_2',
        kind: 'note',
        qty: 1,
        loc: { t: 'tile', x: 3, y: 3 },
        text: 'hi',
      }),
      CFG,
    )
    expect(submitIntent(onFloor, CFG, 'a1', 'read', { itemId: 'item_2' })).toEqual({
      ok: false,
      reason: 'not holding that',
    })
  })
})

describe('verb: teach', () => {
  it('grants min(teacherXp×0.1, 50) to the target and scholarship xp to the teacher', () => {
    let s = makeWorld()
    s = patchAgent(s, 'a1', { skills: { farming: 300 } })
    const r = submitIntent(s, CFG, 'a1', 'teach', { targetId: 'a2', track: 'farming' })
    if (!r.ok) throw new Error(r.reason)
    s = applyAll(s, r.events)
    const res = tickOnce(s)
    expect(res.state.agents.a2!.skills.farming).toBe(30)
    expect(res.state.agents.a1!.skills.scholarship).toBe(1)
  })

  it('teach xp math is exact: fractional kept, cap at 50', () => {
    const s = makeWorld()
    const low = patchAgent(s, 'a1', { skills: { farming: 75 } })
    expect(
      VERBS.teach!.onComplete(
        low,
        CFG,
        'a1',
        { targetId: 'a2', track: 'farming' },
        new RngStreams('t').get('actions'),
      ),
    ).toEqual([{ type: 'skill_gained', payload: { agentId: 'a2', track: 'farming', xp: 7.5 } }])
    const high = patchAgent(s, 'a1', { skills: { farming: 1000 } })
    expect(
      VERBS.teach!.onComplete(
        high,
        CFG,
        'a1',
        { targetId: 'a2', track: 'farming' },
        new RngStreams('t').get('actions'),
      ),
    ).toEqual([{ type: 'skill_gained', payload: { agentId: 'a2', track: 'farming', xp: 50 } }])
  })

  it('rejects self, non-adjacent, and busy targets', () => {
    const s = patchAgent(makeWorld(), 'a1', { skills: { farming: 100 } })
    expect(submitIntent(s, CFG, 'a1', 'teach', { targetId: 'a1', track: 'farming' })).toEqual({
      ok: false,
      reason: 'cannot teach yourself',
    })
    const far = patchAgent(
      makeWorld(CFG, [
        { id: 'a1', x: 0, y: 0 },
        { id: 'a2', x: 5, y: 5 },
      ]),
      'a1',
      { skills: { farming: 100 } },
    )
    expect(
      submitIntent(far, CFG, 'a1', 'teach', { targetId: 'a2', track: 'farming' }),
    ).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/^not adjacent to teach — they are at \(/) as string,
    })
    const busy = applyAll(s, [
      {
        type: 'action_started',
        payload: { agentId: 'a2', verb: 'walk', params: { x: 2, y: 0 }, duration: 3 },
      },
    ])
    expect(submitIntent(busy, CFG, 'a1', 'teach', { targetId: 'a2', track: 'farming' })).toEqual({
      ok: false,
      reason: 'they are busy',
    })
  })

  it('rejects tracks that are not configured skills', () => {
    const s = patchAgent(makeWorld(), 'a1', { skills: { farming: 100 } })
    expect(submitIntent(s, CFG, 'a1', 'teach', { targetId: 'a2', track: 'alchemy' })).toEqual({
      ok: false,
      reason: 'no such skill: alchemy',
    })
    expect(s.agents.a2!.skills.alchemy).toBeUndefined()
  })

  it('rejects a teacher with zero xp in the track', () => {
    const s = makeWorld()
    expect(submitIntent(s, CFG, 'a1', 'teach', { targetId: 'a2', track: 'farming' })).toEqual({
      ok: false,
      reason: 'nothing to teach',
    })
  })
})

describe('verb onComplete re-checks (stale target)', () => {
  it('attack completes as a no-op when the target died before completion', () => {
    let s = makeWorld()
    s = fold(s, ev('agent_died', { agentId: 'a2', cause: 'starvation' }), CFG)
    expect(
      VERBS.attack!.onComplete(
        s,
        CFG,
        'a1',
        { targetId: 'a2' },
        new RngStreams('c1').get('combat'),
      ),
    ).toEqual([])
  })

  it('attack completes as a no-op when the target moved out of reach', () => {
    let s = makeWorld()
    s = patchAgent(s, 'a2', { x: 5, y: 5 })
    expect(
      VERBS.attack!.onComplete(
        s,
        CFG,
        'a1',
        { targetId: 'a2' },
        new RngStreams('c1').get('combat'),
      ),
    ).toEqual([])
  })

  it('give completes as a no-op when the target died: the item stays with the giver', () => {
    let s = makeWorld()
    s = fold(
      s,
      ev('item_spawned', { id: 'item_1', kind: 'fish', qty: 1, loc: { t: 'agent', id: 'a1' } }),
      CFG,
    )
    s = fold(s, ev('agent_died', { agentId: 'a2', cause: 'starvation' }), CFG)
    expect(
      VERBS.give!.onComplete(
        s,
        CFG,
        'a1',
        { itemId: 'item_1', targetId: 'a2' },
        new RngStreams('t').get('actions'),
      ),
    ).toEqual([])
    expect(s.items.item_1!.loc).toEqual({ t: 'agent', id: 'a1' })
  })

  it('tend completes as a no-op when the target is dead or out of reach', () => {
    let dead = makeWorld()
    dead = fold(dead, ev('agent_died', { agentId: 'a2', cause: 'starvation' }), CFG)
    expect(
      VERBS.tend!.onComplete(
        dead,
        CFG,
        'a1',
        { targetId: 'a2' },
        new RngStreams('t').get('actions'),
      ),
    ).toEqual([])
    const far = patchAgent(makeWorld(), 'a2', { x: 5, y: 5 })
    expect(
      VERBS.tend!.onComplete(
        far,
        CFG,
        'a1',
        { targetId: 'a2' },
        new RngStreams('t').get('actions'),
      ),
    ).toEqual([])
  })

  it('teach completes as a no-op when the target is missing or dead', () => {
    let s = patchAgent(makeWorld(), 'a1', { skills: { farming: 300 } })
    s = fold(s, ev('agent_died', { agentId: 'a2', cause: 'starvation' }), CFG)
    expect(
      VERBS.teach!.onComplete(
        s,
        CFG,
        'a1',
        { targetId: 'a2', track: 'farming' },
        new RngStreams('t').get('actions'),
      ),
    ).toEqual([])
    expect(
      VERBS.teach!.onComplete(
        s,
        CFG,
        'a1',
        { targetId: 'ghost', track: 'farming' },
        new RngStreams('t').get('actions'),
      ),
    ).toEqual([])
  })
})

describe('verb: attack', () => {
  it('rejects self, non-adjacent, and dead targets', () => {
    const s = makeWorld()
    expect(submitIntent(s, CFG, 'a1', 'attack', { targetId: 'a1' })).toEqual({
      ok: false,
      reason: 'cannot attack yourself',
    })
    expect(submitIntent(s, CFG, 'a1', 'attack', { targetId: 'ghost' })).toEqual({
      ok: false,
      reason: 'no one there to attack',
    })
    const far = makeWorld(CFG, [
      { id: 'a1', x: 0, y: 0 },
      { id: 'a2', x: 5, y: 5 },
    ])
    expect(submitIntent(far, CFG, 'a1', 'attack', { targetId: 'a2' })).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/^not adjacent to attack — they are at \(/) as string,
    })
  })

  // A blow is three events and one subtraction: agent_harmed takes the hp and names the hand,
  // agent_injured puts the wound on the record, and the affliction starts the clock.
  it('seeded outcome runs both directions: attacker wins (c1) and loses (c6)', () => {
    const s = makeWorld()
    expect(
      VERBS.attack!.onComplete(
        s,
        CFG,
        'a1',
        { targetId: 'a2' },
        new RngStreams('c1').get('combat'),
      ),
    ).toEqual([
      {
        type: 'agent_harmed',
        payload: {
          agentId: 'a2',
          amount: CFG.health.injuryDamage.grave,
          source: 'attack',
          byId: 'a1',
        },
      },
      { type: 'agent_injured', payload: { agentId: 'a2', kind: 'grave' } },
      {
        type: 'agent_afflicted',
        payload: { agentId: 'a2', kind: 'injury', severity: 3, sourceId: 'a1' },
      },
    ])
    expect(
      VERBS.attack!.onComplete(
        s,
        CFG,
        'a1',
        { targetId: 'a2' },
        new RngStreams('c6').get('combat'),
      ),
    ).toEqual([
      {
        type: 'agent_harmed',
        payload: {
          agentId: 'a1',
          amount: CFG.health.injuryDamage.grave,
          source: 'attack',
          byId: 'a2',
        },
      },
      { type: 'agent_injured', payload: { agentId: 'a1', kind: 'grave' } },
      {
        type: 'agent_afflicted',
        payload: { agentId: 'a1', kind: 'injury', severity: 3, sourceId: 'a2' },
      },
    ])
  })

  it('injury tier by margin: minor (c2) vs serious (c3) vs grave (c1)', () => {
    const s = makeWorld()
    expect(
      VERBS.attack!.onComplete(
        s,
        CFG,
        'a1',
        { targetId: 'a2' },
        new RngStreams('c2').get('combat'),
      ),
    ).toEqual([
      {
        type: 'agent_harmed',
        payload: {
          agentId: 'a2',
          amount: CFG.health.injuryDamage.minor,
          source: 'attack',
          byId: 'a1',
        },
      },
      { type: 'agent_injured', payload: { agentId: 'a2', kind: 'minor' } },
      {
        type: 'agent_afflicted',
        payload: { agentId: 'a2', kind: 'injury', severity: 1, sourceId: 'a1' },
      },
    ])
    expect(
      VERBS.attack!.onComplete(
        s,
        CFG,
        'a1',
        { targetId: 'a2' },
        new RngStreams('c3').get('combat'),
      ),
    ).toEqual([
      {
        type: 'agent_harmed',
        payload: {
          agentId: 'a2',
          amount: CFG.health.injuryDamage.serious,
          source: 'attack',
          byId: 'a1',
        },
      },
      { type: 'agent_injured', payload: { agentId: 'a2', kind: 'serious' } },
      {
        type: 'agent_afflicted',
        payload: { agentId: 'a2', kind: 'injury', severity: 2, sourceId: 'a1' },
      },
    ])
  })

  it('weighs by health+energy: a weakened attacker loses despite the higher raw roll', () => {
    let s = makeWorld()
    s = patchAgent(s, 'a1', { hp: 10, needs: { ...s.agents.a1!.needs, energy: 10 } })
    // seed w3: raw rollA 0.9315 > raw rollB 0.1737, but weight 0.1 drops scoreA below scoreB
    expect(
      VERBS.attack!.onComplete(
        s,
        CFG,
        'a1',
        { targetId: 'a2' },
        new RngStreams('w3').get('combat'),
      ),
    ).toEqual([
      {
        type: 'agent_harmed',
        payload: {
          agentId: 'a1',
          amount: CFG.health.injuryDamage.minor,
          source: 'attack',
          byId: 'a2',
        },
      },
      { type: 'agent_injured', payload: { agentId: 'a1', kind: 'minor' } },
      {
        type: 'agent_afflicted',
        payload: { agentId: 'a1', kind: 'injury', severity: 1, sourceId: 'a2' },
      },
    ])
  })

  it('never instant death: a grave hit damages but does not kill a full-health target', () => {
    const s = makeWorld()
    const events = VERBS.attack!.onComplete(
      s,
      CFG,
      'a1',
      { targetId: 'a2' },
      new RngStreams('c1').get('combat'),
    )
    expect(events.some((e) => e.type === 'agent_died')).toBe(false)
    const after = applyAll(s, events)
    expect(after.agents.a2!.hp).toBe(CFG.health.maxHp - CFG.health.injuryDamage.grave)
    expect(after.agents.a2!.alive).toBe(true)
  })
})

describe('verb: experiment (stub)', () => {
  it('always returns the stub rejection, and it leaves a door open (T18)', () => {
    const expected =
      'You lack the knowledge to attempt this. Perhaps someone in the town knows how.'
    expect(
      submitIntent(makeWorld(), CFG, 'a1', 'experiment', {
        description: 'boil river water for salt',
      }),
    ).toEqual({ ok: false, reason: expected })
    expect(submitIntent(makeWorld(), CFG, 'a1', 'experiment', {})).toEqual({
      ok: false,
      reason: expected,
    })
  })
})

describe('eat rulings (Task 12)', () => {
  it('accepts config-crop kinds in addition to FOOD_KINDS', () => {
    let s = makeWorld()
    s = fold(
      s,
      ev('item_spawned', { id: 'item_1', kind: 'wheat', qty: 1, loc: { t: 'agent', id: 'a1' } }),
      CFG,
    )
    expect(submitIntent(s, CFG, 'a1', 'eat', { itemId: 'item_1' }).ok).toBe(true)
  })

  it('a collapsed agent can still eat (rescue flow) but cannot act otherwise', () => {
    let s = makeWorld()
    s = fold(
      s,
      ev('item_spawned', { id: 'item_1', kind: 'berries', qty: 1, loc: { t: 'agent', id: 'a1' } }),
      CFG,
    )
    s = patchAgent(s, 'a1', { collapsedSinceTick: 5 })
    expect(submitIntent(s, CFG, 'a1', 'eat', { itemId: 'item_1' }).ok).toBe(true)
    expect(submitIntent(s, CFG, 'a1', 'walk', { x: 2, y: 0 }).ok).toBe(false)
    expect(submitIntent(s, CFG, 'a1', 'speak', { text: 'help' }).ok).toBe(false)
  })

  it('eat onComplete re-validates the item is still held (no event if given away)', () => {
    let s = makeWorld()
    s = fold(
      s,
      ev('item_spawned', { id: 'item_1', kind: 'berries', qty: 1, loc: { t: 'agent', id: 'a1' } }),
      CFG,
    )
    // item leaves the agent before completion
    const gone = fold(s, ev('item_moved', { id: 'item_1', loc: { t: 'agent', id: 'a2' } }), CFG)
    const events = VERBS.eat!.onComplete(
      gone,
      CFG,
      'a1',
      { itemId: 'item_1' },
      new RngStreams('t').get('actions'),
    )
    expect(events).toEqual([])
  })
})

describe('verb registry (Task 12)', () => {
  it('registers the new verbs', () => {
    for (const k of [
      'speak',
      'give',
      'take',
      'write',
      'read',
      'teach',
      'attack',
      'experiment',
    ] as const) {
      expect(VERBS[k]!.kind).toBe(k)
    }
  })
})

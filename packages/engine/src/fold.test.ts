import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG, MINUTES_PER_DAY, stateHash, type SimEvent } from '@sj/shared'
import { genesisState, type WorldState } from './state.js'
import { fold } from './fold.js'

const ev = (seq: number, type: string, payload: unknown, tick = 0): SimEvent => ({
  seq,
  tick,
  type,
  payload,
})
const spawn = (id: string, x = 0, y = 0) =>
  ev(1, 'agent_spawned', { id, name: id, x, y, ageDays: 7300 })

describe('fold', () => {
  it('spawns, moves, and changes needs', () => {
    let s = genesisState(DEFAULT_CONFIG)
    s = fold(s, ev(1, 'agent_spawned', { id: 'a1', name: 'a1', x: 2, y: 3, ageDays: 7300 }))
    s = fold(s, ev(2, 'agent_moved', { id: 'a1', x: 4, y: 3 }))
    s = fold(s, ev(3, 'needs_changed', { id: 'a1', changes: [{ need: 'hunger', delta: -30 }] }))
    expect(s.agents.a1).toMatchObject({ x: 4, y: 3, needs: { hunger: 70 } })
  })
  it('clamps needs to [0,100]', () => {
    let s = fold(genesisState(DEFAULT_CONFIG), spawn('a1'))
    s = fold(s, ev(2, 'needs_changed', { id: 'a1', changes: [{ need: 'energy', delta: -500 }] }))
    expect(s.agents.a1!.needs.energy).toBe(0)
  })
  it('accepts the two new need kinds: warmth and social', () => {
    let s = fold(genesisState(DEFAULT_CONFIG), spawn('a1'))
    s = fold(s, ev(2, 'needs_changed', { id: 'a1', changes: [{ need: 'warmth', delta: -10 }] }))
    s = fold(s, ev(3, 'needs_changed', { id: 'a1', changes: [{ need: 'social', delta: -20 }] }))
    expect(s.agents.a1!.needs).toEqual({ hunger: 100, energy: 100, warmth: 90, social: 80 })
  })
  it('tick_advanced sets tick from the event', () => {
    const s = fold(genesisState(DEFAULT_CONFIG), ev(1, 'tick_advanced', {}, 42))
    expect(s.tick).toBe(42)
  })
  it('does not mutate its input', () => {
    const s0 = genesisState(DEFAULT_CONFIG)
    fold(s0, spawn('a1'))
    expect(s0.agents).toEqual({})
  })
  it('throws on unknown event type', () => {
    expect(() => fold(genesisState(DEFAULT_CONFIG), ev(1, 'nope', {}))).toThrow(/unknown event/i)
  })

  it('spawn applies the full v2 default body', () => {
    const s = fold(
      genesisState(DEFAULT_CONFIG),
      ev(1, 'agent_spawned', { id: 'a1', name: 'Ada', x: 2, y: 3, ageDays: 9125 }),
    )
    expect(s.agents.a1).toEqual({
      id: 'a1',
      name: 'Ada',
      x: 2,
      y: 3,
      alive: true,
      asleep: false,
      needs: { hunger: 100, energy: 100, warmth: 100, social: 100 },
      hp: DEFAULT_CONFIG.health.maxHp,
      injuries: [],
      ill: false,
      ageDays: 9125,
      skills: {},
      activity: null,
      collapsedSinceTick: null,
      zeroHungerSinceTick: null,
    })
  })

  it('never mutates input state on any branch (deep, via stateHash)', () => {
    let s = genesisState(DEFAULT_CONFIG)
    const branches: SimEvent[] = [
      ev(1, 'tick_advanced', {}, 5),
      ev(2, 'agent_spawned', { id: 'a1', name: 'a1', x: 1, y: 1, ageDays: 7300 }),
      ev(3, 'agent_moved', { id: 'a1', x: 2, y: 2 }),
      ev(4, 'needs_changed', { id: 'a1', changes: [{ need: 'social', delta: -3 }] }),
    ]
    for (const e of branches) {
      const before = stateHash(s)
      const next = fold(s, e)
      expect(stateHash(s)).toBe(before)
      s = next
    }
  })

  it('strict payloads reject an extra key on agent_spawned', () => {
    expect(() =>
      fold(
        genesisState(DEFAULT_CONFIG),
        ev(1, 'agent_spawned', { id: 'a1', name: 'a1', x: 0, y: 0, ageDays: 1, sneaky: true }),
      ),
    ).toThrow()
  })
  it('strict payloads reject extra keys on the migrated C1 events', () => {
    const s = fold(genesisState(DEFAULT_CONFIG), spawn('a1'))
    expect(() => fold(s, ev(2, 'tick_advanced', { extra: 1 }, 1))).toThrow()
    expect(() => fold(s, ev(2, 'agent_moved', { id: 'a1', x: 1, y: 1, extra: 1 }))).toThrow()
    expect(() =>
      fold(
        s,
        ev(2, 'needs_changed', { id: 'a1', changes: [{ need: 'hunger', delta: -1, extra: 1 }] }),
      ),
    ).toThrow()
    void s
  })

  it('tile_changed rewrites one cell and carries where it came from', () => {
    let s = genesisState(DEFAULT_CONFIG)
    s = fold(s, ev(1, 'tile_changed', { x: 2, y: 3, from: 0, to: 8, reason: 'worn' }))
    expect(s.terrain[3]![2]).toBe(8)
    expect(s.terrain[3]![1]).toBe(0)
    expect(s.terrain[2]![2]).toBe(0)
  })
  it('tile_changed refuses a from that does not match the ground', () => {
    const s = genesisState(DEFAULT_CONFIG)
    expect(() =>
      fold(s, ev(1, 'tile_changed', { x: 2, y: 3, from: 7, to: 8, reason: 'worn' })),
    ).toThrow(/from-mismatch at \(2, 3\)/)
  })
  it('tile_changed out of bounds throws, and an unknown reason is rejected', () => {
    const s = genesisState(DEFAULT_CONFIG)
    expect(() =>
      fold(s, ev(1, 'tile_changed', { x: 99, y: 0, from: 0, to: 8, reason: 'worn' })),
    ).toThrow(/out of bounds/i)
    expect(() =>
      fold(s, ev(1, 'tile_changed', { x: 0, y: 0, from: 0, to: 8, reason: 'vibes' })),
    ).toThrow()
    expect(() =>
      fold(s, ev(1, 'tile_changed', { x: 0, y: 0, from: 0, to: 11, reason: 'worn' })),
    ).toThrow()
  })
  it('tile_changed records who did it when a body did it', () => {
    let s = fold(genesisState(DEFAULT_CONFIG), spawn('a1'))
    s = fold(s, ev(2, 'tile_changed', { x: 0, y: 0, from: 0, to: 7, reason: 'paved', byId: 'a1' }))
    expect(s.terrain[0]![0]).toBe(7)
  })

  it('the day turning drops wounds that have healed and keeps the open ones', () => {
    const DAY = MINUTES_PER_DAY
    let s = fold(genesisState(DEFAULT_CONFIG), spawn('a1'))
    s = fold(s, ev(2, 'agent_injured', { agentId: 'a1', kind: 'minor' }, 0))
    s = fold(s, ev(3, 'agent_injured', { agentId: 'a1', kind: 'serious' }, 2 * DAY))
    expect(s.agents.a1!.injuries).toHaveLength(2)
    // Day 3: the day-0 wound is outside the three-day window, the day-2 one is still in it.
    s = fold(s, ev(4, 'agent_aged', { agentId: 'a1' }, 3 * DAY))
    expect(s.agents.a1!.injuries).toEqual([{ kind: 'serious', day: 2 }])
    s = fold(s, ev(5, 'agent_aged', { agentId: 'a1' }, 5 * DAY))
    expect(s.agents.a1!.injuries).toEqual([])
  })

  it('bumps counters.nextEntityId on spawn and never lowers it', () => {
    let s = fold(genesisState(DEFAULT_CONFIG), spawn('agent_7'))
    expect(s.counters.nextEntityId).toBe(8)
    s = fold(s, spawn('agent_3'))
    expect(s.counters.nextEntityId).toBe(8)
  })
})

describe('discovery_made — the record, and nothing in the state', () => {
  const base = genesisState(DEFAULT_CONFIG)
  const payload = {
    recipeId: 'recipe:waterskin',
    name: 'stitch a waterskin',
    kind: 'craft',
    byId: 'a1',
    intent: 'carry water in a stitched hide',
    makes: ['waterskin'],
  }
  const evt: SimEvent = { seq: 1, tick: 7, type: 'discovery_made', payload }

  it('folds to a state IDENTICAL to the one it started from', () => {
    const after = fold(base, evt, DEFAULT_CONFIG)
    expect(stateHash(after)).toBe(stateHash(base))
    expect(after).toBe(base)
  })

  it('refuses a discovery with no inventor', () => {
    const { byId: _byId, ...noCredit } = payload
    expect(() => fold(base, { ...evt, payload: noCredit }, DEFAULT_CONFIG)).toThrow()
  })

  it('refuses a kind the archive has no words for', () => {
    expect(() =>
      fold(base, { ...evt, payload: { ...payload, kind: 'vibe' } }, DEFAULT_CONFIG),
    ).toThrow()
  })
})

// The five grounding effects a minted verb may have, each folded to one pinned hash: a charter
// that changes the world changes it the same way on every replay.
describe('what a minted verb can do to the world folds to a golden', () => {
  function town(): WorldState {
    let s = genesisState(DEFAULT_CONFIG)
    s = fold(s, spawn('a1', 3, 3), DEFAULT_CONFIG)
    s = fold(s, ev(2, 'agent_spawned', { id: 'a2', name: 'a2', x: 4, y: 3, ageDays: 7300 }))
    s = fold(
      s,
      ev(3, 'structure_planned', {
        id: 'structure_1',
        kind: 'well',
        x: 5,
        y: 3,
        w: 1,
        h: 1,
        maxHp: 10,
        flammable: false,
        builderId: 'a1',
      }),
    )
    s = fold(
      s,
      ev(4, 'item_spawned', { id: 'item_1', kind: 'plank', qty: 2, loc: { t: 'agent', id: 'a1' } }),
    )
    return s
  }
  const golden = (event: SimEvent, hash: string): void => {
    const once = fold(town(), event, DEFAULT_CONFIG)
    expect(stateHash(once)).toBe(stateHash(fold(town(), event, DEFAULT_CONFIG)))
    expect(stateHash(once)).toBe(hash)
  }

  it('mark: a tag on a person, a building or a thing', () => {
    const s = fold(
      town(),
      ev(5, 'marked', { on: 'agent', id: 'a2', key: 'debt', value: 'two planks' }),
      DEFAULT_CONFIG,
    )
    expect(s.agents.a2!.marks).toEqual({ debt: 'two planks' })
    expect(
      fold(s, ev(6, 'marked', { on: 'agent', id: 'a2', key: 'debt', value: 'paid' })).agents.a2!
        .marks,
    ).toEqual({ debt: 'paid' })
    expect(
      fold(s, ev(6, 'marked', { on: 'structure', id: 'structure_1', key: 'keeper', value: 'a1' }))
        .structures.structure_1!.marks,
    ).toEqual({ keeper: 'a1' })
    expect(
      fold(s, ev(6, 'marked', { on: 'item', id: 'item_1', key: 'promised', value: 'to a2' })).items
        .item_1!.marks,
    ).toEqual({ promised: 'to a2' })
    expect(() =>
      fold(s, ev(7, 'marked', { on: 'item', id: 'nope', key: 'k', value: 'v' })),
    ).toThrow(/unknown item/)
    golden(
      ev(5, 'marked', { on: 'agent', id: 'a2', key: 'debt', value: 'two planks' }),
      '13efc4bd7b60c16182170b4ccffc5c6944e34507b7edfcb9157ca9f29b921f89',
    )
  })

  it('witness: a labelled expression folds to nothing', () => {
    const event = ev(5, 'agent_expressed', {
      agentId: 'a1',
      verb: 'act:toast',
      x: 3,
      y: 3,
      sense: 'sight',
      label: 'raises a cup to the room',
      radius: 6,
    })
    const before = town()
    expect(fold(before, event, DEFAULT_CONFIG)).toBe(before)
    golden(event, '7863941783f39a6fbb448271dbaada58ede23d471bd0ae6e39237ca87a94f2ee')
  })

  it('name_place: the building takes the name', () => {
    const event = ev(5, 'place_named', {
      structureId: 'structure_1',
      name: "the Widow's Well",
      byId: 'a1',
    })
    expect(fold(town(), event, DEFAULT_CONFIG).structures.structure_1!.name).toBe(
      "the Widow's Well",
    )
    golden(event, 'ec1b8d35aec12c287984fee71b3426de97ff4f3a6fbf01a64815e8eccb5a948c')
  })

  it('transfer: title passes to the target, the thing stays where it is', () => {
    const event = ev(5, 'item_owner_changed', { id: 'item_1', owner: 'a2' })
    const after = fold(town(), event, DEFAULT_CONFIG)
    expect(after.items.item_1).toMatchObject({ owner: 'a2', loc: { t: 'agent', id: 'a1' } })
    golden(event, '8ea6fffc5c9d476356f8e023b7bf84ee3e75eac9917261ee1789b1cf27f1a1f1')
  })

  it('need_delta: one need moves by the charter’s number', () => {
    const event = ev(5, 'needs_changed', { id: 'a1', changes: [{ need: 'social', delta: -10 }] })
    expect(
      fold(
        fold(
          town(),
          ev(4, 'needs_changed', { id: 'a1', changes: [{ need: 'social', delta: -30 }] }),
        ),
        event,
      ).agents.a1!.needs.social,
    ).toBe(60)
    golden(event, '0ca7050daf491c60ed545e2aac1542641587818c85b373aaa2e01c44acdaa5a0')
  })
})

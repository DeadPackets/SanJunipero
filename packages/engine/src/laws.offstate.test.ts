import { describe, it, expect } from 'vitest'
import {
  ADULT_AGE_DAYS,
  DAYS_PER_YEAR,
  MINUTES_PER_DAY,
  SimConfigSchema,
  type SimConfig,
} from '@sj/shared'
import { fold } from './fold.js'
import { submitIntent } from './intent.js'
import { effectiveConfig } from './laws.js'
import { composePerception } from './perception.js'
import { RngStream, RngStreams } from './rng.js'
import { genesisState, type TileId, type WorldState } from './state.js'
import { VERBS } from './verbs/index.js'
import { createWorldTick } from './worldTick.js'
import { ev, grid } from './testutil/world.js'

// Each row is asserted twice: once with the flag off in the base config, once with it turned off
// by a world law. Both must behave identically, which is what the effective config buys.

const BASE = { weather: { hourlyChangeChance: 0 }, mystery: { chancePerDay: 0 } }
const cfg = (over: Record<string, unknown> = {}): SimConfig =>
  SimConfigSchema.parse({ ...BASE, ...over })
const ON = cfg()
const ACTIONS = RngStream.seed('offstate', 'actions')

const MAP = (): TileId[][] => grid(24)

// Fold the law straight in: the same shape the tick-boundary drain produces.
const legislate = (s: WorldState, path: string, value: unknown, config = ON): WorldState =>
  fold(s, ev('config_changed', { path, value }), config)

function tickAt(state: WorldState, tick: number, config: SimConfig, seed = 'off') {
  const advanced = fold({ ...state, tick: tick - 1 }, ev('tick_advanced', {}, tick), config)
  return createWorldTick(config, new RngStreams(seed))(advanced)
}

describe('§19 off-state: reproduction.enabled', () => {
  // Two sleepers in one complete house: co_slept fires at every midnight when the flag is on.
  function couple(config: SimConfig): WorldState {
    let s = genesisState(config, MAP())
    for (const [id, sex] of [
      ['a1', 'f'],
      ['a2', 'm'],
    ] as const) {
      s = fold(
        s,
        ev('agent_spawned', { id, name: id, x: 4, y: 6, ageDays: 30 * DAYS_PER_YEAR, sex }),
        config,
      )
      s = fold(s, ev('agent_slept', { agentId: id }), config)
    }
    s = fold(
      s,
      ev('structure_planned', {
        id: 'structure_1',
        kind: 'house',
        x: 4,
        y: 4,
        w: 2,
        h: 2,
        maxHp: 20,
        flammable: true,
        builderId: 'a1',
      }),
      config,
    )
    s = fold(s, ev('structure_completed', { id: 'structure_1' }), config)
    for (const id of ['a1', 'a2'])
      s = fold(s, ev('agent_entered', { agentId: id, structureId: 'structure_1' }), config)
    return s
  }

  const noRepro = (state: WorldState, config: SimConfig): void => {
    const res = tickAt(state, MINUTES_PER_DAY, config)
    const kinds = new Set(res.events.map((e) => e.type))
    for (const t of ['co_slept', 'agent_conceived', 'agent_born']) expect(kinds.has(t)).toBe(false)
    expect(res.state.agents.a1!.asleep).toBe(true) // the co-sleepers sleep on regardless
    expect(res.state.pairNights).toBeUndefined()
  }

  it('on, the night is recorded', () => {
    expect(tickAt(couple(ON), MINUTES_PER_DAY, ON).events.map((e) => e.type)).toContain('co_slept')
  })

  it('off in the base config, nothing is recorded about it', () => {
    const config = cfg({ reproduction: { enabled: false } })
    noRepro(couple(config), config)
  })

  it('off by law, the same', () => {
    noRepro(legislate(couple(ON), 'reproduction.enabled', false), ON)
  })
})

describe('§19 off-state: aging.deathOfOldAgeEnabled', () => {
  // Certain death: an ancient body under a per-day chance of 1 dies at the next midnight.
  const CERTAIN = cfg({ aging: { naturalDeathBaseChancePerDay: 1 } })
  const ancient = (config: SimConfig): WorldState =>
    fold(
      genesisState(config, MAP()),
      ev('agent_spawned', { id: 'a1', name: 'a1', x: 2, y: 2, ageDays: 90 * DAYS_PER_YEAR }),
      config,
    )

  const agesButLives = (state: WorldState, config: SimConfig): void => {
    const res = tickAt(state, MINUTES_PER_DAY, config)
    expect(res.events.map((e) => e.type)).toContain('agent_aged')
    expect(res.events.some((e) => e.type === 'agent_died')).toBe(false)
    expect(res.state.agents.a1!.ageDays).toBe(90 * DAYS_PER_YEAR + 1)
  }

  it('on, the old die', () => {
    expect(tickAt(ancient(CERTAIN), MINUTES_PER_DAY, CERTAIN).events.map((e) => e.type)).toContain(
      'agent_died',
    )
  })

  it('off in the base config, bodies still age and nobody dies of it', () => {
    const config = cfg({ aging: { naturalDeathBaseChancePerDay: 1, deathOfOldAgeEnabled: false } })
    agesButLives(ancient(config), config)
  })

  it('off by law, the same', () => {
    agesButLives(legislate(ancient(CERTAIN), 'aging.deathOfOldAgeEnabled', false, CERTAIN), CERTAIN)
  })
})

describe('§19 off-state: spoilage.enabled', () => {
  // A fish stamped on day 0 with a 2-day life is overdue from day 2 onward.
  const withFish = (config: SimConfig): WorldState =>
    fold(
      genesisState(config, MAP()),
      ev('item_spawned', {
        id: 'item_1',
        kind: 'fish',
        qty: 1,
        loc: { t: 'tile', x: 2, y: 2 },
        spoilage: { spawnDay: 0, days: 2 },
      }),
      config,
    )

  const liveThrough = (s: WorldState, days: number, config: SimConfig): WorldState => {
    let acc = s
    for (let day = 1; day <= days; day++) acc = tickAt(acc, day * MINUTES_PER_DAY, config).state
    return acc
  }

  it('on, the overdue fish is gone', () => {
    expect(liveThrough(withFish(ON), 3, ON).items.item_1).toBeUndefined()
  })

  it('off in the base config, it survives every midnight', () => {
    const config = cfg({ spoilage: { enabled: false } })
    expect(liveThrough(withFish(config), 4, config).items.item_1).toBeDefined()
  })

  it('off by law, it survives; re-enabling spoils it at the next midnight — accepted and asserted', () => {
    const off = legislate(withFish(ON), 'spoilage.enabled', false)
    const survived = liveThrough(off, 4, ON)
    expect(survived.items.item_1).toBeDefined()

    const back = tickAt(legislate(survived, 'spoilage.enabled', true), 5 * MINUTES_PER_DAY, ON)
    expect(back.events.some((e) => e.type === 'item_spoiled')).toBe(true)
    expect(back.state.items.item_1).toBeUndefined()
  })
})

describe('§19 off-state: mystery.enabled', () => {
  const NOON = MINUTES_PER_DAY + 12 * 60
  const CERTAIN = cfg({ mystery: { chancePerDay: 1 } })
  const fired = (state: WorldState, config: SimConfig): boolean =>
    tickAt(state, NOON, config).events.some((e) => e.type === 'mystery_event')

  it('on, a certain day produces one', () => {
    expect(fired(genesisState(CERTAIN, MAP()), CERTAIN)).toBe(true)
  })

  it('off in the base config, there is no roll at all — even at a chance of one', () => {
    const config = cfg({ mystery: { enabled: false, chancePerDay: 1 } })
    expect(fired(genesisState(config, MAP()), config)).toBe(false)
  })

  it('off by law, the same', () => {
    expect(
      fired(legislate(genesisState(CERTAIN, MAP()), 'mystery.enabled', false, CERTAIN), CERTAIN),
    ).toBe(false)
  })
})

describe('§19 off-state: occlusion.enabled', () => {
  // a1 inside a complete house; a2 four tiles south in the open, well inside earshot 8.
  function acrossAWall(config: SimConfig): WorldState {
    let s = genesisState(config, MAP())
    s = fold(
      s,
      ev('agent_spawned', { id: 'a1', name: 'a1', x: 4, y: 4, ageDays: ADULT_AGE_DAYS }),
      config,
    )
    s = fold(
      s,
      ev('agent_spawned', { id: 'a2', name: 'a2', x: 4, y: 8, ageDays: ADULT_AGE_DAYS }),
      config,
    )
    s = fold(
      s,
      ev('structure_planned', {
        id: 'structure_1',
        kind: 'house',
        x: 4,
        y: 4,
        w: 2,
        h: 2,
        maxHp: 20,
        flammable: true,
        builderId: 'a1',
      }),
      config,
    )
    s = fold(s, ev('structure_completed', { id: 'structure_1' }), config)
    return fold(s, ev('agent_entered', { agentId: 'a1', structureId: 'structure_1' }), config)
  }
  const spoke = ev('agent_spoke', {
    agentId: 'a1',
    text: 'inside words',
    x: 4,
    y: 4,
    insideId: 'structure_1',
  })

  const hearsThroughTheWall = (s: WorldState, config: SimConfig): void => {
    expect(composePerception(s, config, 'a2', [spoke]).heard.map((h) => h.text)).toEqual([
      'inside words',
    ])
    // The flag drops the wall, not the distance: out of earshot is still out of earshot.
    const far = { ...s, agents: { ...s.agents, a2: { ...s.agents.a2!, x: 4, y: 20 } } }
    expect(composePerception(far, config, 'a2', [spoke]).heard).toEqual([])
  }

  it('on, the wall stops the sound', () => {
    expect(composePerception(acrossAWall(ON), ON, 'a2', [spoke]).heard).toEqual([])
  })

  it('off in the base config, hearing is plain radius-8 straight through the wall', () => {
    const config = cfg({ occlusion: { enabled: false } })
    hearsThroughTheWall(acrossAWall(config), config)
  })

  it('off by law, the same', () => {
    hearsThroughTheWall(legislate(acrossAWall(ON), 'occlusion.enabled', false), ON)
  })

  it('off, interiors and interior sight are untouched — the flag governs sound alone', () => {
    const s = legislate(acrossAWall(ON), 'occlusion.enabled', false)
    expect(s.agents.a1!.insideId).toBe('structure_1')
    expect(composePerception(s, ON, 'a1', []).visible.agents).toEqual([])
    expect(composePerception(s, ON, 'a1', []).visible.structures.map((x) => x.id)).toEqual([
      'structure_1',
    ])
    expect(composePerception(s, ON, 'a2', []).visible.agents).toEqual([])
  })
})

describe('§19 off-state: ownership.enabled', () => {
  function twoAndSomeBread(config: SimConfig): WorldState {
    let s = genesisState(config, MAP())
    s = fold(
      s,
      ev('agent_spawned', { id: 'a1', name: 'Rahel', x: 2, y: 2, ageDays: ADULT_AGE_DAYS }),
      config,
    )
    s = fold(
      s,
      ev('agent_spawned', { id: 'a2', name: 'Omar', x: 3, y: 2, ageDays: ADULT_AGE_DAYS }),
      config,
    )
    return fold(
      s,
      ev('item_spawned', {
        id: 'item_1',
        kind: 'bread',
        qty: 1,
        loc: { t: 'tile', x: 2, y: 2 },
        owner: 'a1',
      }),
      config,
    )
  }
  // The one caller of onComplete is actionsSystem, which passes ctx.config — the effective one.
  const taking = (s: WorldState, config: SimConfig): string[] =>
    VERBS.take!.onComplete(
      s,
      effectiveConfig(config, s.laws),
      'a2',
      { itemId: 'item_1' },
      ACTIONS,
    ).map((e) => e.type)

  const inert = (s: WorldState, config: SimConfig): void => {
    expect(taking(s, config)).toEqual(['item_moved'])
    expect(s.items.item_1!.owner).toBe('a1') // an owner already in state persists, inertly
    expect(composePerception(s, config, 'a2', []).visible.items[0]!.ownerName).toBeUndefined()
  }

  it('on, taking another’s bread is a public event with a named owner', () => {
    const s = twoAndSomeBread(ON)
    expect(taking(s, ON)).toEqual(['item_moved', 'item_taken'])
    expect(composePerception(s, ON, 'a2', []).visible.items[0]!.ownerName).toBe('Rahel')
  })

  it('off in the base config, no title event, no witness record, no owner prose', () => {
    const config = cfg({ ownership: { enabled: false } })
    inert(twoAndSomeBread(config), config)
  })

  it('off by law, the same', () => {
    inert(legislate(twoAndSomeBread(ON), 'ownership.enabled', false), ON)
  })
})

describe('§19 off-state: inscription.enabled', () => {
  function stone(config: SimConfig): WorldState {
    let s = genesisState(config, MAP())
    s = fold(
      s,
      ev('agent_spawned', { id: 'a1', name: 'a1', x: 6, y: 2, ageDays: ADULT_AGE_DAYS }),
      config,
    )
    s = fold(
      s,
      ev('structure_planned', {
        id: 'structure_1',
        kind: 'standing_stone',
        x: 4,
        y: 1,
        w: 2,
        h: 2,
        maxHp: 20,
        flammable: false,
        builderId: 'a1',
      }),
      config,
    )
    return fold(s, ev('structure_completed', { id: 'structure_1' }), config)
  }
  const params = { structureId: 'structure_1', text: 'we came from the river' }
  const refused = { ok: false, reason: 'your hands find no way to mark this' }

  it('on, the stone takes the mark', () => {
    expect(submitIntent(stone(ON), ON, 'a1', 'inscribe', params).ok).toBe(true)
  })

  it('off in the base config, the refusal is diegetic and exact', () => {
    const config = cfg({ inscription: { enabled: false } })
    expect(submitIntent(stone(config), config, 'a1', 'inscribe', params)).toMatchObject(refused)
  })

  it('off by law, the same', () => {
    expect(
      submitIntent(
        legislate(stone(ON), 'inscription.enabled', false),
        ON,
        'a1',
        'inscribe',
        params,
      ),
    ).toMatchObject(refused)
  })

  it('off, write and read on notes are untouched — those are C2 physics, not this flag', () => {
    const s = legislate(stone(ON), 'inscription.enabled', false)
    expect(submitIntent(s, ON, 'a1', 'write', { text: 'a list' }).ok).toBe(true)
  })
})

describe('§19: the effective config reaches the verb and perception seams', () => {
  it('a law flip changes what submitIntent and composePerception do, with the base config unchanged', () => {
    let s = genesisState(ON, MAP())
    s = fold(
      s,
      ev('agent_spawned', { id: 'a1', name: 'Rahel', x: 2, y: 2, ageDays: ADULT_AGE_DAYS }),
      ON,
    )
    s = fold(
      s,
      ev('item_spawned', {
        id: 'item_1',
        kind: 'bread',
        qty: 1,
        loc: { t: 'tile', x: 2, y: 2 },
        owner: 'a1',
      }),
      ON,
    )
    expect(composePerception(s, ON, 'a1', []).visible.items[0]!.ownerName).toBe('Rahel')
    const after = legislate(s, 'ownership.enabled', false)
    expect(composePerception(after, ON, 'a1', []).visible.items[0]!.ownerName).toBeUndefined()
    expect(ON.ownership.enabled).toBe(true)
  })
})

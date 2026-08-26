import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG, SimConfigSchema, type SimEvent } from '@sj/shared'
import { genesisState, type TileId, type WorldState } from './state.js'
import { fold } from './fold.js'
import { RngStream } from './rng.js'
import { VERBS } from './verbs.js'

// Ownership is a social fact the engine merely records. Nothing here blocks a hand.

const RNG = RngStream.seed('ownership-test', 'actions')
const OFF = SimConfigSchema.parse({ ownership: { enabled: false } })

const CHAR_TILE: Record<string, TileId> = { '.': 0, '~': 2, '#': 3 }
let seq = 1
const ev = (type: string, payload: unknown): SimEvent => ({ seq: seq++, tick: 0, type, payload })

const ROWS = ['..###...', '........', '........', '..~~....', '........', '........']

function world(...agents: { id: string; x: number; y: number }[]): WorldState {
  let s = genesisState(
    DEFAULT_CONFIG,
    ROWS.map((row) => Array.from(row).map((c) => CHAR_TILE[c]!)),
  )
  for (const a of agents)
    s = fold(s, ev('agent_spawned', { id: a.id, name: a.id, x: a.x, y: a.y, ageDays: 7300 }))
  return s
}

function apply(
  s: WorldState,
  events: { type: string; payload: unknown }[],
  config = DEFAULT_CONFIG,
): WorldState {
  return events.reduce((acc, e) => fold(acc, ev(e.type, e.payload), config), s)
}

// A loose item on the ground next to a1, optionally already spoken for.
function withLooseItem(s: WorldState, owner?: string): WorldState {
  return fold(
    s,
    ev('item_spawned', {
      id: 'item_1',
      kind: 'bread',
      qty: 1,
      loc: { t: 'tile', x: 1, y: 1 },
      ...(owner === undefined ? {} : { owner }),
    }),
  )
}

describe('acquisition marks the acquirer', () => {
  it('forage spawns the find already owned', () => {
    const s = world({ id: 'a1', x: 2, y: 1 }) // forest at (2,0)
    const events = VERBS.forage!.onComplete(s, DEFAULT_CONFIG, 'a1', {}, RNG)
    expect(events.find((e) => e.type === 'item_spawned')!.payload).toMatchObject({ owner: 'a1' })
    expect(apply(s, events).items.item_1!.owner).toBe('a1')
  })

  it('craft spawns the output already owned', () => {
    let s = world({ id: 'a1', x: 1, y: 1 })
    s = fold(
      s,
      ev('item_spawned', { id: 'item_1', kind: 'wood', qty: 10, loc: { t: 'agent', id: 'a1' } }),
    )
    const recipe = Object.keys(DEFAULT_CONFIG.crafting.recipes)[0]!
    const events = VERBS.craft!.onComplete(s, DEFAULT_CONFIG, 'a1', { recipe }, RNG)
    const spawned = events.find((e) => e.type === 'item_spawned')
    expect(spawned).toBeDefined()
    expect(spawned!.payload).toMatchObject({ owner: 'a1' })
  })

  it('write spawns the note already owned — authorship is making', () => {
    const s = world({ id: 'a1', x: 1, y: 1 })
    const events = VERBS.write!.onComplete(s, DEFAULT_CONFIG, 'a1', { text: 'hello' }, RNG)
    expect(events.find((e) => e.type === 'item_spawned')!.payload).toMatchObject({ owner: 'a1' })
    expect(apply(s, events).items.item_1!.owner).toBe('a1')
  })

  it('the flag turns a written note unowned too', () => {
    const s = world({ id: 'a1', x: 1, y: 1 })
    const events = VERBS.write!.onComplete(s, OFF, 'a1', { text: 'hello' }, RNG)
    expect((events[0]!.payload as Record<string, unknown>).owner).toBeUndefined()
  })

  it('the flag turns acquisition ownership off entirely', () => {
    const s = world({ id: 'a1', x: 2, y: 1 })
    const events = VERBS.forage!.onComplete(s, OFF, 'a1', {}, RNG)
    const payload = events.find((e) => e.type === 'item_spawned')!.payload as Record<
      string,
      unknown
    >
    expect(payload.owner).toBeUndefined()
    expect(apply(s, events, OFF).items.item_1!).not.toHaveProperty('owner')
  })
})

describe('taking', () => {
  it('claims an unowned thing outright', () => {
    const s = withLooseItem(world({ id: 'a1', x: 1, y: 1 }))
    const events = VERBS.take!.onComplete(s, DEFAULT_CONFIG, 'a1', { itemId: 'item_1' }, RNG)
    expect(events).toEqual([
      { type: 'item_moved', payload: { id: 'item_1', loc: { t: 'agent', id: 'a1' } } },
      { type: 'item_owner_changed', payload: { id: 'item_1', owner: 'a1' } },
    ])
    expect(apply(s, events).items.item_1!.owner).toBe('a1')
  })

  it('moves another agent’s thing without moving its ownership, and says so out loud', () => {
    const s = withLooseItem(world({ id: 'a1', x: 1, y: 1 }, { id: 'a2', x: 4, y: 4 }), 'a2')
    const events = VERBS.take!.onComplete(s, DEFAULT_CONFIG, 'a1', { itemId: 'item_1' }, RNG)
    expect(events).toEqual([
      { type: 'item_moved', payload: { id: 'item_1', loc: { t: 'agent', id: 'a1' } } },
      {
        type: 'item_taken',
        payload: { itemId: 'item_1', kind: 'bread', takerId: 'a1', ownerId: 'a2', x: 1, y: 1 },
      },
    ])
    const after = apply(s, events)
    expect(after.items.item_1!.owner).toBe('a2')
    expect(after.items.item_1!.loc).toEqual({ t: 'agent', id: 'a1' })
  })

  it('picking up your own thing again is not a theft and not a claim', () => {
    const s = withLooseItem(world({ id: 'a1', x: 1, y: 1 }), 'a1')
    expect(VERBS.take!.onComplete(s, DEFAULT_CONFIG, 'a1', { itemId: 'item_1' }, RNG)).toEqual([
      { type: 'item_moved', payload: { id: 'item_1', loc: { t: 'agent', id: 'a1' } } },
    ])
  })

  it('is never refused for ownership — theft is possible, that is the point', () => {
    const s = withLooseItem(world({ id: 'a1', x: 1, y: 1 }, { id: 'a2', x: 4, y: 4 }), 'a2')
    expect(VERBS.take!.validate(s, DEFAULT_CONFIG, 'a1', { itemId: 'item_1' })).toBeNull()
  })

  it('with the flag off, taking is a bare move', () => {
    const s = withLooseItem(world({ id: 'a1', x: 1, y: 1 }, { id: 'a2', x: 4, y: 4 }), 'a2')
    expect(VERBS.take!.onComplete(s, OFF, 'a1', { itemId: 'item_1' }, RNG)).toEqual([
      { type: 'item_moved', payload: { id: 'item_1', loc: { t: 'agent', id: 'a1' } } },
    ])
  })

  it('reports the shelf position when the thing was taken from a structure', () => {
    let s = world({ id: 'a1', x: 4, y: 2 }, { id: 'a2', x: 0, y: 5 })
    s = fold(
      s,
      ev('structure_planned', {
        id: 'structure_1',
        kind: 'storehouse',
        x: 2,
        y: 2,
        w: 2,
        h: 1,
        maxHp: 20,
        flammable: true,
        builderId: 'a2',
      }),
    )
    s = fold(
      s,
      ev('item_spawned', {
        id: 'item_1',
        kind: 'bread',
        qty: 1,
        loc: { t: 'structure', id: 'structure_1' },
        owner: 'a2',
      }),
    )
    expect(
      VERBS.take!.onComplete(s, DEFAULT_CONFIG, 'a1', { itemId: 'item_1' }, RNG).at(-1),
    ).toEqual({
      type: 'item_taken',
      payload: { itemId: 'item_1', kind: 'bread', takerId: 'a1', ownerId: 'a2', x: 2, y: 2 },
    })
  })
})

describe('giving', () => {
  it('hands over the thing and the title with it', () => {
    const s = fold(
      world({ id: 'a1', x: 1, y: 1 }, { id: 'a2', x: 2, y: 1 }),
      ev('item_spawned', {
        id: 'item_1',
        kind: 'bread',
        qty: 1,
        loc: { t: 'agent', id: 'a1' },
        owner: 'a1',
      }),
    )
    const events = VERBS.give!.onComplete(
      s,
      DEFAULT_CONFIG,
      'a1',
      { itemId: 'item_1', targetId: 'a2' },
      RNG,
    )
    expect(events).toEqual([
      { type: 'item_moved', payload: { id: 'item_1', loc: { t: 'agent', id: 'a2' } } },
      { type: 'item_owner_changed', payload: { id: 'item_1', owner: 'a2' } },
    ])
    expect(apply(s, events).items.item_1!.owner).toBe('a2')
  })

  it('with the flag off, giving is a bare move', () => {
    const s = fold(
      world({ id: 'a1', x: 1, y: 1 }, { id: 'a2', x: 2, y: 1 }),
      ev('item_spawned', {
        id: 'item_1',
        kind: 'bread',
        qty: 1,
        loc: { t: 'agent', id: 'a1' },
        owner: 'a1',
      }),
    )
    expect(VERBS.give!.onComplete(s, OFF, 'a1', { itemId: 'item_1', targetId: 'a2' }, RNG)).toEqual(
      [{ type: 'item_moved', payload: { id: 'item_1', loc: { t: 'agent', id: 'a2' } } }],
    )
  })
})

describe('ownership outlives the owner and the transfer', () => {
  it('a dead owner’s dropped thing is still theirs', () => {
    let s = fold(
      world({ id: 'a1', x: 3, y: 4 }),
      ev('item_spawned', {
        id: 'item_1',
        kind: 'bread',
        qty: 1,
        loc: { t: 'agent', id: 'a1' },
        owner: 'a1',
      }),
    )
    s = fold(s, ev('item_moved', { id: 'item_1', loc: { t: 'tile', x: 3, y: 4 } }))
    s = fold(s, ev('agent_died', { agentId: 'a1', cause: 'starvation' }))
    expect(s.agents.a1!.alive).toBe(false)
    expect(s.items.item_1!.owner).toBe('a1')
  })

  it('a maker’s mark survives every hand the thing passes through', () => {
    let s = fold(
      world({ id: 'a1', x: 1, y: 1 }, { id: 'a2', x: 2, y: 1 }),
      ev('item_spawned', {
        id: 'item_1',
        kind: 'chair',
        qty: 1,
        loc: { t: 'agent', id: 'a1' },
        owner: 'a1',
        crafterMark: 'a1',
      }),
    )
    s = apply(
      s,
      VERBS.give!.onComplete(s, DEFAULT_CONFIG, 'a1', { itemId: 'item_1', targetId: 'a2' }, RNG),
    )
    expect(s.items.item_1!).toMatchObject({ owner: 'a2', crafterMark: 'a1' })
    s = fold(s, ev('item_moved', { id: 'item_1', loc: { t: 'structure', id: 'structure_1' } }))
    expect(s.items.item_1!.crafterMark).toBe('a1')
  })

  it('an unmarked, unowned thing carries neither key — old logs hash as before', () => {
    const s = withLooseItem(world({ id: 'a1', x: 1, y: 1 }))
    expect(s.items.item_1!).not.toHaveProperty('owner')
    expect(s.items.item_1!).not.toHaveProperty('crafterMark')
  })
})

describe('maker’s mark on expert crafts', () => {
  const EXPERT_XP = DEFAULT_CONFIG.crafting.expertLevel * DEFAULT_CONFIG.skills.xpLevelDivisor

  function carpenter(xp: number): WorldState {
    let s = world({ id: 'a1', x: 1, y: 1 })
    s = fold(
      s,
      ev('item_spawned', { id: 'item_1', kind: 'wood', qty: 10, loc: { t: 'agent', id: 'a1' } }),
    )
    return xp === 0 ? s : fold(s, ev('skill_gained', { agentId: 'a1', track: 'carpentry', xp }))
  }

  const craftedPayload = (s: WorldState, config = DEFAULT_CONFIG): Record<string, unknown> =>
    VERBS.craft!.onComplete(s, config, 'a1', { recipe: 'plank' }, RNG).find(
      (e) => e.type === 'item_spawned',
    )!.payload as Record<string, unknown>

  it('an expert leaves their mark on the work', () => {
    expect(craftedPayload(carpenter(EXPERT_XP))).toMatchObject({ owner: 'a1', crafterMark: 'a1' })
  })

  it('an apprentice does not', () => {
    const payload = craftedPayload(carpenter(DEFAULT_CONFIG.skills.xpLevelDivisor))
    expect(payload.owner).toBe('a1')
    expect(payload.crafterMark).toBeUndefined()
  })

  it('goes quiet with the ownership flag off — a mark is a claim like any other', () => {
    expect(craftedPayload(carpenter(EXPERT_XP), OFF).crafterMark).toBeUndefined()
  })
})

describe('item_taken is a witness record, not a mechanic', () => {
  it('folds to a state byte-identical to the one before it', () => {
    const s = withLooseItem(world({ id: 'a1', x: 1, y: 1 }, { id: 'a2', x: 4, y: 4 }), 'a2')
    const after = fold(
      s,
      ev('item_taken', {
        itemId: 'item_1',
        kind: 'bread',
        takerId: 'a1',
        ownerId: 'a2',
        x: 1,
        y: 1,
      }),
    )
    expect(after).toEqual(s)
  })

  it('item_owner_changed rejects an item that is not there', () => {
    const s = world({ id: 'a1', x: 1, y: 1 })
    expect(() => fold(s, ev('item_owner_changed', { id: 'ghost', owner: 'a1' }))).toThrow(
      /unknown item/,
    )
  })
})

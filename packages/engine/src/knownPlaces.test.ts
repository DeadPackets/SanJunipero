import { describe, expect, it } from 'vitest'
import {
  ADULT_AGE_DAYS,
  DEFAULT_CONFIG,
  SimConfigSchema,
  T_WATER,
  type SimConfig,
} from '@sj/shared'
import { openDb } from './db.js'
import { GENESIS_BUILDER_ID } from './genesis/world.js'
import { doorTile } from './interiors.js'
import { isAdjacentToRect } from './verbs/common.js'
import { EventStore } from './eventStore.js'
import { fold } from './fold.js'
import { submitIntent } from './intent.js'
import { replayLatest } from './replay.js'
import { RngStreams } from './rng.js'
import { genesisState, type WorldState } from './state.js'
import { ev, grid, roundTrips } from './testutil/world.js'
import { TickLoop } from './tickLoop.js'
import { createWorldTick } from './worldTick.js'

// Still: nothing but the bodies and the walls may speak while a mind is learning the town.
const CFG: SimConfig = SimConfigSchema.parse({
  weather: { hourlyChangeChance: 0 },
  mystery: { chancePerDay: 0 },
  mapGrowth: { enabled: false },
  fauna: { enabled: false },
})

function plant(
  s: WorldState,
  id: string,
  at: { x: number; y: number; w?: number; h?: number; name?: string; by?: string },
  config = CFG,
): WorldState {
  const planned = fold(
    s,
    ev('structure_planned', {
      id,
      kind: 'house',
      x: at.x,
      y: at.y,
      w: at.w ?? 2,
      h: at.h ?? 2,
      maxHp: 50,
      flammable: true,
      builderId: at.by ?? 'b',
      ...(at.name === undefined ? {} : { name: at.name }),
    }),
    config,
  )
  return fold(planned, ev('structure_completed', { id }), config)
}

function spawn(s: WorldState, id: string, x: number, y: number, config = CFG): WorldState {
  return fold(s, ev('agent_spawned', { id, name: id, x, y, ageDays: ADULT_AGE_DAYS }), config)
}

const knownOf = (s: WorldState, id: string): string[] => s.agents[id]?.knownPlaces ?? []

describe('★ a mind knows the places it has seen', () => {
  it('a wall in sight becomes a place known, and stays known after it drops out of sight', () => {
    let s = genesisState(CFG, grid(24))
    s = plant(s, 'structure_1', { x: 4, y: 4 })
    s = spawn(s, 'a1', 3, 3)
    expect(knownOf(s, 'a1')).toEqual([])

    const near = roundTrips(s, CFG, 'sight').replayed
    expect(knownOf(near, 'a1')).toEqual(['structure_1'])

    // Walked to the far corner: the walls are well out of sight and the knowing does not lapse.
    const far = roundTrips(
      fold(near, ev('agent_moved', { id: 'a1', x: 23, y: 23 }), CFG),
      CFG,
      'sight',
    ).replayed
    expect(knownOf(far, 'a1')).toEqual(['structure_1'])
  })

  it('the set only grows, and stays sorted however the places arrive', () => {
    let s = genesisState(CFG, grid(16))
    s = spawn(s, 'a1', 6, 6)
    s = fold(s, ev('places_seen', { agentId: 'a1', structureIds: ['structure_9'] }), CFG)
    s = fold(
      s,
      ev('places_seen', { agentId: 'a1', structureIds: ['structure_2', 'structure_9'] }),
      CFG,
    )
    expect(knownOf(s, 'a1')).toEqual(['structure_2', 'structure_9'])
  })

  // The set is folded state like any other, so a run resumed from a snapshot is the same mind.
  it('survives a snapshot: a town replayed from one knows what the live run knew', () => {
    const store = new EventStore(openDb(':memory:'))
    const rng = new RngStreams('places')
    const tick = createWorldTick(CFG, rng)
    let seeded = genesisState(CFG, grid(24))
    seeded = plant(seeded, 'structure_1', { x: 4, y: 4 })
    seeded = spawn(seeded, 'a1', 3, 3)

    const loop = new TickLoop({
      store,
      state: seeded,
      rng,
      config: CFG,
      snapshotEveryTicks: 2,
      onTick: ({ emit }) => {
        for (const e of tick(loop.state).events) emit(e.type, e.payload)
      },
    })
    for (let i = 0; i < 5; i++) loop.step()

    expect(knownOf(loop.state, 'a1')).toEqual(['structure_1'])
    const { state } = replayLatest(store, CFG)
    expect(knownOf(state, 'a1')).toEqual(['structure_1'])
  })

  it('the dead learn nothing', () => {
    let s = genesisState(CFG, grid(24))
    s = plant(s, 'structure_1', { x: 4, y: 4 })
    s = spawn(s, 'a1', 3, 3)
    s = fold(s, ev('agent_died', { agentId: 'a1', cause: 'hunger' }), CFG)
    expect(knownOf(roundTrips(s, CFG, 'sight').replayed, 'a1')).toEqual([])
  })
})

describe('★ walk takes the mark of a place, and the world finds the way', () => {
  const walkTo = (s: WorldState, params: Record<string, unknown>) =>
    submitIntent(s, CFG, 'a1', 'walk', params)

  function town(rows = grid(24)): WorldState {
    let s = genesisState(CFG, rows)
    s = plant(s, 'structure_1', { x: 10, y: 10 })
    s = spawn(s, 'a1', 2, 2)
    return fold(s, ev('places_seen', { agentId: 'a1', structureIds: ['structure_1'] }), CFG)
  }

  it('a known place walks to open ground beside it, and the log carries the tile', () => {
    const out = walkTo(town(), { structureId: 'structure_1' })
    expect(out.ok).toBe(true)
    const started = out.ok ? out.events.find((e) => e.type === 'action_started') : undefined
    const p = started?.payload as { params: Record<string, unknown> }
    // Beside the footprint, never on it, and beside the DOOR, which is what `enter` measures
    // from; nearest the body only breaks the tie.
    expect(p.params).toEqual({ structureId: 'structure_1', x: 9, y: 11 })
  })

  it('lands within reach of the door however far around the walls the body starts', () => {
    // The door of this house faces south; the body is away to the north-west, so the corner
    // nearest her is three tiles from the door and `enter` would be refused from it.
    const s = town()
    const out = walkTo(s, { structureId: 'structure_1' })
    expect(out.ok).toBe(true)
    const started = out.ok ? out.events.find((e) => e.type === 'action_started') : undefined
    const to = (started?.payload as { params: { x: number; y: number } }).params
    const door = doorTile(s, s.structures.structure_1!)!
    expect(isAdjacentToRect(to.x, to.y, { ...door, w: 1, h: 1 })).toBe(true)
    // And the step it was sent for actually goes through from where the walk ends.
    const arrived = fold(s, ev('agent_moved', { id: 'a1', x: to.x, y: to.y }), CFG)
    expect(submitIntent(arrived, CFG, 'a1', 'enter', { structureId: 'structure_1' }).ok).toBe(true)
  })

  it('falls back to the tile nearest the body when no foot can reach the door', () => {
    const rows = grid(24)
    // The south face and its ring are sealed into a pocket of water: the door still stands and
    // is still passable, and nothing outside can walk to it or to anything beside it.
    for (let x = 8; x <= 13; x++) rows[13]![x] = T_WATER
    for (const [x, y] of [
      [8, 12],
      [13, 12],
      [8, 11],
      [9, 11],
      [12, 11],
      [13, 11],
    ] as const)
      rows[y]![x] = T_WATER
    const s = town(rows)
    const door = doorTile(s, s.structures.structure_1!)!
    expect(door).toEqual({ x: 10, y: 12 })
    const out = walkTo(s, { structureId: 'structure_1' })
    expect(out.ok).toBe(true)
    const started = out.ok ? out.events.find((e) => e.type === 'action_started') : undefined
    expect((started?.payload as { params: unknown }).params).toEqual({
      structureId: 'structure_1',
      x: 9,
      y: 9,
    })
  })

  it('the two numbers still work exactly as they did', () => {
    const out = walkTo(town(), { x: 5, y: 5 })
    expect(out.ok).toBe(true)
    const started = out.ok ? out.events.find((e) => e.type === 'action_started') : undefined
    expect((started?.payload as { params: unknown }).params).toEqual({ x: 5, y: 5 })
  })

  it('a mark this mind was never shown is refused as a place it does not know', () => {
    let s = genesisState(CFG, grid(24))
    s = plant(s, 'structure_1', { x: 10, y: 10 })
    s = spawn(s, 'a1', 2, 2)
    expect(walkTo(s, { structureId: 'structure_1' })).toEqual({
      ok: false,
      reason: 'you know no such place',
    })
    // And so is a mark that stands for nothing at all.
    expect(walkTo(s, { structureId: 'structure_404' })).toEqual({
      ok: false,
      reason: 'you know no such place',
    })
  })

  it('a known place with no dry ground to it keeps the refusal the tiles always gave', () => {
    const rows = grid(24)
    // An island: the ring around the walls is water, so no foot reaches it.
    for (let y = 9; y <= 13; y++) for (let x = 9; x <= 13; x++) rows[y]![x] = T_WATER
    let s = genesisState(CFG, rows)
    s = plant(s, 'structure_1', { x: 10, y: 10, w: 3, h: 3 })
    s = spawn(s, 'a1', 2, 2)
    s = fold(s, ev('places_seen', { agentId: 'a1', structureIds: ['structure_1'] }), CFG)
    expect(walkTo(s, { structureId: 'structure_1' })).toEqual({
      ok: false,
      reason: 'no path to that spot',
    })
  })

  it('a walk that names neither a tile nor a place is still a walk with nowhere to go', () => {
    expect(walkTo(town(), {})).toEqual({ ok: false, reason: 'a walk needs a place to end' })
  })
})

describe('★ a place is called what is written on it', () => {
  it('an authored name rides the plan into the world', () => {
    const s = plant(genesisState(CFG, grid(16)), 'structure_1', {
      x: 4,
      y: 4,
      name: 'the old farmhouse',
    })
    expect(s.structures.structure_1!.name).toBe('the old farmhouse')
  })

  /** One carving, and what the wall and the name look like afterwards. */
  function carve(
    at: { by?: string; name?: string },
    text: string,
    hand = 'a1',
  ): { name: string | undefined; inscription: { text: string; by: string } | undefined } {
    const s = fold(
      plant(genesisState(CFG, grid(16)), 'structure_1', { x: 4, y: 4, ...at }),
      ev('structure_inscribed', { structureId: 'structure_1', text, agentId: hand }),
      CFG,
    )
    const built = s.structures.structure_1!
    return { name: built.name, inscription: built.inscription }
  }

  it('the hand that raised a building names it, when the words read as a name', () => {
    expect(carve({ by: 'a1' }, 'House of Brilliant Things!')).toEqual({
      name: 'House of Brilliant Things!',
      inscription: { text: 'House of Brilliant Things!', by: 'a1' },
    })
  })

  it("another's walls take the writing and keep their own name", () => {
    // The wall still says it. It is simply not what anybody calls the place.
    expect(carve({ by: 'someone_else' }, 'the Old Mill')).toEqual({
      inscription: { text: 'the Old Mill', by: 'a1' },
    })
  })

  it('★ "I miss the sea" is a carving on anything, including your own wall', () => {
    expect(carve({ by: 'a1' }, 'I miss the sea')).toEqual({
      inscription: { text: 'I miss the sea', by: 'a1' },
    })
    // The apostrophe hides nothing: the first person is read off the letters.
    expect(carve({ by: 'a1' }, "I'm cold").name).toBeUndefined()
    expect(carve({ by: 'a1' }, 'this roof kept us dry all winter').name).toBeUndefined()
  })

  it('a name is short enough to say: past five words it is a sentence', () => {
    expect(carve({ by: 'a1' }, 'One Two Three Four Five').name).toBe('One Two Three Four Five')
    expect(carve({ by: 'a1' }, 'One Two Three Four Five Six').name).toBeUndefined()
  })

  it('★ the founding eleven keep their names whatever anybody carves on them', () => {
    // Not a second rule: no mind's id is the genesis builder's, so no mind can rename one.
    expect(carve({ by: GENESIS_BUILDER_ID, name: 'the old farmhouse' }, 'Amara Was Here')).toEqual({
      name: 'the old farmhouse',
      inscription: { text: 'Amara Was Here', by: 'a1' },
    })
  })

  it('and the builder may name the same wall again', () => {
    let s = plant(genesisState(CFG, grid(16)), 'structure_1', { x: 4, y: 4, by: 'a1' })
    for (const text of ['First Name', 'Second Name']) {
      s = fold(
        s,
        ev('structure_inscribed', { structureId: 'structure_1', text, agentId: 'a1' }),
        CFG,
      )
    }
    expect(s.structures.structure_1!.name).toBe('Second Name')
  })

  it("and the town's own thirteen all arrive named, no two alike", async () => {
    const { makeCityTemplate } = await import('@sj/shared')
    const named = makeCityTemplate({ x: 40, y: 40 }).structures.map((s) => s.name)
    expect(named).toHaveLength(13)
    expect(named.every((n) => typeof n === 'string' && n.length > 0)).toBe(true)
    expect(new Set(named).size).toBe(13)
  })
})

describe('★ a place named aloud travels to whoever hears it', () => {
  function pair(name = 'the Old Mill'): WorldState {
    let s = genesisState(CFG, grid(24))
    s = plant(s, 'structure_1', { x: 10, y: 10, name })
    s = spawn(s, 'speaker', 2, 2)
    s = spawn(s, 'hearer', 3, 2)
    return fold(s, ev('places_seen', { agentId: 'speaker', structureIds: ['structure_1'] }), CFG)
  }

  /** What that mouth put into other heads, and nothing else. */
  function told(s: WorldState, text: string): unknown[] {
    const out = submitIntent(s, CFG, 'speaker', 'speak', { text })
    expect(out.ok).toBe(true)
    return out.ok ? out.events.filter((e) => e.type === 'places_seen').map((e) => e.payload) : []
  }

  it('a mouth that names a place it knows puts that place in the head beside it', () => {
    expect(told(pair(), 'I am going up to the Old Mill before dark.')).toEqual([
      { agentId: 'hearer', structureIds: ['structure_1'] },
    ])
  })

  it('a name the speaker has never heard carries nothing', () => {
    let s = genesisState(CFG, grid(24))
    s = plant(s, 'structure_1', { x: 10, y: 10, name: 'the Old Mill' })
    s = spawn(s, 'speaker', 2, 2)
    s = spawn(s, 'hearer', 3, 2)
    expect(told(s, 'They say there is an Old Mill somewhere out east.')).toEqual([])
  })

  it('half a name is not the name: the wellspring is not the well', () => {
    let s = genesisState(CFG, grid(24))
    s = plant(s, 'structure_1', { x: 10, y: 10, name: 'the well' })
    s = spawn(s, 'speaker', 2, 2)
    s = spawn(s, 'hearer', 3, 2)
    s = fold(s, ev('places_seen', { agentId: 'speaker', structureIds: ['structure_1'] }), CFG)
    expect(told(s, 'The wellspring runs dry in summer.')).toEqual([])
    // Cased however the mouth cases it, and still the same place.
    expect(told(s, 'Meet me at The Well.')).toHaveLength(1)
  })

  it('a wall stops it: nobody out of earshot learns anything', () => {
    let s = pair()
    s = fold(s, ev('agent_moved', { id: 'hearer', x: 23, y: 23 }), CFG)
    expect(told(s, 'I am going up to the Old Mill.')).toEqual([])
  })

  // A name has to be a name before it can be passed on: "the" carved on a shed would otherwise
  // teach that shed to everyone in earshot of every sentence anybody ever says.
  it('★ a name too short or too plain to be one never travels, though it still stands', () => {
    for (const name of ['hut', 'the', 'a', 'have']) {
      let s = genesisState(CFG, grid(24))
      s = plant(s, 'structure_1', { x: 10, y: 10, name })
      s = spawn(s, 'speaker', 2, 2)
      s = spawn(s, 'hearer', 3, 2)
      s = fold(s, ev('places_seen', { agentId: 'speaker', structureIds: ['structure_1'] }), CFG)
      // Said plainly, and still nobody learns a place from it.
      expect(told(s, `Meet me at the ${name}.`), name).toEqual([])
      // And the wall has not stopped saying it: the floor is on the air, not on the stone.
      expect(s.structures.structure_1!.name, name).toBe(name)
    }
  })

  it('and a real name of four letters or more travels exactly as it did', () => {
    let s = genesisState(CFG, grid(24))
    s = plant(s, 'structure_1', { x: 10, y: 10, name: 'Mill' })
    s = spawn(s, 'speaker', 2, 2)
    s = spawn(s, 'hearer', 3, 2)
    s = fold(s, ev('places_seen', { agentId: 'speaker', structureIds: ['structure_1'] }), CFG)
    expect(told(s, 'I am going up to the Mill.')).toEqual([
      { agentId: 'hearer', structureIds: ['structure_1'] },
    ])
  })

  // A carved name is stored exactly as the chisel cut it, and every mind is shown it flattened.
  // Matched raw, a name with a line break in it was one no mouth could ever say.
  it.each([
    ['a line break', 'the Old\n  Mill', 'I am going up to the Old Mill before dark.'],
    ['a curled quote', '\u201cthe Old Mill\u201d', "I am going up to 'the Old Mill' before dark."],
  ])('a name carved with %s travels in the shape every mind is shown it', (_what, name, said) => {
    expect(told(pair(name), said)).toEqual([{ agentId: 'hearer', structureIds: ['structure_1'] }])
  })

  it('and telling somebody what they already know says nothing twice', () => {
    let s = pair()
    s = fold(s, ev('places_seen', { agentId: 'hearer', structureIds: ['structure_1'] }), CFG)
    expect(told(s, 'I am going up to the Old Mill.')).toEqual([])
  })
})

// The default config is what the town actually runs under; a law flipped off in a fixture
// would let all of the above pass over a world nobody ships.
describe('the shipped world carves', () => {
  it('leaves inscription enabled, so a mind can name a place at all', () => {
    expect(DEFAULT_CONFIG.inscription.enabled).toBe(true)
  })
})

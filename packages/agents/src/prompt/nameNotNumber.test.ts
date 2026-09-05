import { describe, expect, it } from 'vitest'
import { EventStore, openDb } from '@sj/engine/store'
import {
  doorTile,
  fold,
  genesisState,
  makeables,
  makeGenesisWorld,
  walkDestination,
  type WorldState,
} from '@sj/engine'
import { DEFAULT_CONFIG, FOUNDER_IDS, FOUNDER_SEATS, type SimEvent } from '@sj/shared'
import { makeablesLine, perceptionToProse, roadLine, type PerceptionPacket } from './prose.js'
import { quietMeadowPacket, FLAT_WORLD, wireTown } from '../testutil/fixtures.js'

// Walking was 30% of everything the minds did and two walks in three were followed by a third.
// The walks arrived; they simply arrived a tile off what the verb wanted. This file holds the
// cause down: the prose handed a mind the tile of everything it could see, right beside the mark.

const CFG = DEFAULT_CONFIG
const PAIR = /\(\d+, ?-?\d+\)/

const seeing = (over: Partial<PerceptionPacket['visible']>): string =>
  perceptionToProse(
    { ...quietMeadowPacket, visible: { ...quietMeadowPacket.visible, ...over } },
    undefined,
    FLAT_WORLD,
  )

/** The one sentence about the thing this mark names, so a tile elsewhere in the block cannot
 *  pass for this line's own. */
const sentenceWith = (prose: string, mark: string): string =>
  prose.split('. ').find((s) => s.includes(mark)) ?? ''

describe('★ a thing with a name is not given a tile as well', () => {
  it('a place in sight is called by its mark and its bearing, and never by two numbers', () => {
    const said = seeing({
      structures: [
        {
          id: 'structure_10',
          kind: 'well',
          name: 'the well',
          x: 14,
          y: 9,
          w: 1,
          h: 1,
          burning: false,
          stage: 'complete',
        },
      ],
    })
    expect(said).toContain('The well (structure_10) stands close to the east')
    expect(sentenceWith(said, 'structure_10')).not.toMatch(PAIR)
  })

  it('a person in sight is called by their mark and their bearing', () => {
    const said = seeing({
      agents: [
        {
          id: 'nadia',
          name: 'Nadia',
          x: 12,
          y: 14,
          activityVerb: null,
          collapsed: false,
          asleep: false,
        },
      ],
    })
    expect(said).toContain('Nadia (nadia) stands close to the south.')
    expect(sentenceWith(said, '(nadia)')).not.toMatch(PAIR)
  })

  it('a thing on the ground is called by its mark and its bearing', () => {
    const said = seeing({
      items: [{ id: 'item_3', kind: 'basket', qty: 1, loc: { t: 'tile', x: 9, y: 9 } }],
    })
    expect(said).toContain('You can see 1 basket (item_3) close to the west.')
    expect(sentenceWith(said, 'item_3')).not.toMatch(PAIR)
  })

  // Two bodies on one tile have no direction between them, and 'north' would be a lie.
  it('says where you stand when the thing is on your own tile', () => {
    const said = seeing({
      items: [{ id: 'item_3', kind: 'basket', qty: 1, loc: { t: 'tile', x: 12, y: 9 } }],
    })
    expect(said).toContain('You can see 1 basket (item_3) where you stand.')
  })
})

describe('★ the ground a verb takes a tile for keeps its numbers', () => {
  it('names the water to fish at, and the ground under your own feet to till', () => {
    const dry = {
      ...quietMeadowPacket,
      self: {
        ...quietMeadowPacket.self,
        body: { ...quietMeadowPacket.self.body, thirst: 20 },
      },
    }
    const said = perceptionToProse(dry, undefined, {
      ...FLAT_WORLD,
      waterAtHand: () => false,
      nearestWater: () => ({ x: 20, y: 4 }),
    })
    // `fish`, `drink` and `fill` are all refused off the same test, and none takes a mark.
    expect(said).toContain('The nearest water you know of is at (20, 4), close to the north-east')
    // `till`, `plant`, `pave`, `dig_channel` and `chop` are all judged from where the body is.
    expect(said).toContain('You stand at (12, 9).')
  })

  it('names the ground for a new roof, which is a tile a body has to be standing on', () => {
    expect(makeablesLine(makeables(CFG), { x: 30, y: 40 })).toContain(
      'The town keeps ground for a new building at (30, 40). You have to be standing there to start one.',
    )
  })

  it('names the tree, the crop, the animal and the patch, none of which a walk can name', () => {
    const said = seeing({
      crops: [{ id: 'crop_1', kind: 'wheat', x: 12, y: 8, stage: 2, withered: false }],
      fauna: [{ id: 'fauna_1', kind: 'rabbit', x: 15, y: 9 }],
      forageables: [{ id: 'node_1', kind: 'berry_bush', x: 8, y: 12, prose: 'berry bushes' }],
    })
    expect(said).toContain('You can see wheat (crop_1) at (12, 8).')
    expect(said).toContain('A rabbit (fauna_1) is at (15, 9).')
    expect(said).toContain('You see berry bushes (node_1) at (8, 12).')
    // And the tree the road sends a mind to, which `chop` takes as a tile and no walk can name.
    expect(
      roadLine(makeables(CFG), quietMeadowPacket, {
        ...FLAT_WORLD,
        nearestSource: () => ({ x: 31, y: 44, from: 'tree' }),
      }),
    ).toContain('the nearest standing tree is at (31, 44)')
  })
})

// ★ THE DOORWAY RULING. `enter` measures one tile from the door, not the door itself, and a walk
// that names the place is scored onto exactly that ring — so outside, the pair bought nothing the
// mark does not, and it was the easiest number in the block to copy. It stays in one place only:
// indoors, where `walk` is refused outright and `exit` takes no mark, so no walk can be aimed at
// it. There it is not a destination, it is where the body will be standing when it steps out.
describe('★ where a doorway keeps its tile, and where it loses it', () => {
  const cabin = (over: Record<string, unknown>): PerceptionPacket['visible']['structures'][0] => ({
    id: 'structure_1',
    kind: 'cabin',
    x: 12,
    y: 11,
    w: 2,
    h: 2,
    burning: false,
    stage: 'complete',
    door: { x: 12, y: 10 },
    ...over,
  })

  it('outside, the doorway is a fact and not a tile', () => {
    const said = seeing({ structures: [cabin({})] })
    expect(said).toContain('you are at its door; enter it and you are in.')
    expect(sentenceWith(said, 'structure_1')).not.toMatch(PAIR)
  })

  it('a full room is still told apart from a wall, and still without the tile', () => {
    const full = seeing({ structures: [cabin({ full: true })] })
    expect(full).toContain('it has a doorway, and there is no room left inside.')
    expect(sentenceWith(full, 'structure_1')).not.toMatch(PAIR)
    expect(seeing({ structures: [cabin({ door: undefined })] })).not.toContain('doorway')
  })

  it('inside, the way back out keeps its tile: no walk can be aimed at it', () => {
    const said = perceptionToProse(
      {
        ...quietMeadowPacket,
        self: { ...quietMeadowPacket.self, inside: { id: 'structure_1', kind: 'cabin' } },
        visible: { ...quietMeadowPacket.visible, structures: [cabin({})] },
      },
      undefined,
      FLAT_WORLD,
    )
    expect(said).toContain('you cannot walk anywhere or enter anything')
    expect(said).toContain('the doorway at (12, 10) is the way back out')
    // And the roof line, which used to say the same pair a second time, now only says which roof.
    expect(said).toContain('this is the building you are in.')
    expect(sentenceWith(said, 'structure_1) stands')).not.toMatch(PAIR)
  })
})

// ★ THE SEAM. A mark a mind is shown and a mark the legs refuse is worse than no mark: it is the
// prose promising a road the world does not have. These two are read off one another.
describe('★ every mark the prose shows is a mark `walkDestination` knows', () => {
  let seq = 0
  const ev = (type: string, payload: unknown): SimEvent => ({ seq: ++seq, tick: 0, type, payload })

  function genesisTown(): WorldState {
    const g = makeGenesisWorld(CFG)
    let s = genesisState(CFG, g.terrain)
    for (const e of g.events) s = fold(s, ev(e.type, e.payload), CFG)
    for (const id of FOUNDER_IDS) {
      const roof = Object.values(s.structures).find((st) => st.name === FOUNDER_SEATS[id])
      const door = roof === undefined ? null : doorTile(s, roof)
      if (door === null) throw new Error(`no doorway for ${id}`)
      s = fold(s, ev('agent_spawned', { id, name: id, x: door.x, y: door.y, ageDays: 10000 }), CFG)
    }
    return { ...s, tick: 420 }
  }

  // The five answers that mean "I have never heard of that mark". Anything else is the world
  // saying something true about the road, which is not the prose and the engine disagreeing.
  const UNKNOWN = [
    'you know no such place',
    'there is no one by that name to walk to',
    'there is no such thing to walk to',
    'you cannot see it from here',
    'you cannot see them from here',
  ]

  const marksIn = (prose: string, re: RegExp): string[] => [...prose.matchAll(re)].map((m) => m[1]!)

  it('the places, the people and the things in one founder’s prose all answer to a walk', () => {
    const store = new EventStore(openDb(':memory:'))
    const { bridge, loop } = wireTown({
      state: genesisTown(),
      store,
      seed: 'name-not-number',
      startTick: 420,
    })
    // A place is known once the eyes have reached it, and sight lands at the end of a tick.
    loop.step()
    const s = loop.state
    const prose = perceptionToProse(bridge.perception('omar'), undefined, {
      isWalkable: (x, y) => bridge.isWalkable(x, y),
    })

    const places = marksIn(prose, /\((structure_\d+)\) stands/g)
    const people = marksIn(prose, /\(([a-z]+)\) (?:stands|sleeps|lies collapsed)/g)
    const things = marksIn(prose, /You can see [^.]*?\((item_\d+)\)/g)
    expect(places.length).toBeGreaterThan(0)
    expect(people.length).toBeGreaterThan(0)
    expect(things.length).toBeGreaterThan(0)

    for (const [key, marks] of [
      ['structureId', places],
      ['targetId', people],
      ['itemId', things],
    ] as const) {
      for (const mark of marks) {
        const to = walkDestination(s, CFG, 'omar', { [key]: mark })
        expect('refusal' in to ? to.refusal : '', `${key} ${mark}`).not.toBeOneOf(UNKNOWN)
      }
    }

    // And the roofs and the body, which have a road as well as a name, resolve to real ground.
    for (const mark of places)
      expect(walkDestination(s, CFG, 'omar', { structureId: mark })).not.toHaveProperty('refusal')
    for (const mark of people)
      expect(walkDestination(s, CFG, 'omar', { targetId: mark })).not.toHaveProperty('refusal')
  })
})

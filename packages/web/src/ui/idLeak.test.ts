import { describe, expect, it } from 'vitest'
import {
  DAYS_PER_YEAR,
  CHRONICLE_TYPES,
  type SimEvent,
  chronicleLine,
  structureTitle,
} from '@sj/shared'
import type { Structure, WorldState } from '@sj/engine/state'
import { describeEvent } from './chronicleFormat.js'
import { chronicleLabel } from './importantFeed.js'
import { hoverPlate, itemCropDetail } from './interaction.js'
import { placeOf, structureWords } from './place.js'
import { thumbLabel } from './momentThumb.js'

// The machine's own words, exactly as the live town writes them: `item_78`,
// `item_structure_house_44_51_wood`, `structure_farmhouse_63_32`, `fauna_64`, `recipe:drink_rain`.
// No allow-list — a surface that genuinely needs an id is not a surface a viewer reads.
const MACHINE_ID = /\b(?:item|structure|fauna|crop|recipe|express)[_:]\w+/
// A place is words. A pair of numbers is a tile, and a tile is ours, not theirs.
const COORD_PAIR = /\(?\b\d+\s*,\s*\d+\b\)?/

const clean = (s: string | null, where: string): void => {
  if (s === null) return
  expect(s, where).not.toMatch(MACHINE_ID)
  expect(s, where).not.toMatch(COORD_PAIR)
  expect(s, where).not.toMatch(/_/)
}

const N = 8
const struct = (over: Partial<Structure> & { id: string; kind: string }): Structure => ({
  x: 2,
  y: 2,
  w: 1,
  h: 1,
  hp: 20,
  maxHp: 20,
  flammable: true,
  stage: 'complete',
  progressTicks: 0,
  builtBy: null,
  burning: false,
  burnTicks: 0,
  ...over,
})

const HOUSE = struct({ id: 'structure_house_44_51', kind: 'fire_pit', x: 2, y: 2 })

const WORLD: WorldState = {
  tick: 10,
  terrain: Array.from({ length: N }, () => Array.from({ length: N }, () => 0)),
  weather: { kind: 'sunny', temperatureC: 12 },
  agents: {
    yusuf: {
      id: 'yusuf',
      name: 'Yusuf',
      x: 2,
      y: 3,
      alive: true,
      asleep: false,
      needs: { hunger: 80, energy: 80, warmth: 80, social: 80 },
      hp: 100,
      injuries: [],
      ill: false,
      ageDays: 30 * DAYS_PER_YEAR,
      skills: {},
      activity: null,
      collapsedSinceTick: null,
      zeroHungerSinceTick: null,
    },
  },
  structures: { [HOUSE.id]: HOUSE },
  // The genesis runner owns these, and the runner is nobody the town ever met.
  items: {
    item_78: { id: 'item_78', kind: 'herb_bundle', qty: 9, owner: 'script' },
    item_structure_house_44_51_wood: {
      id: 'item_structure_house_44_51_wood',
      kind: 'wood',
      qty: 13,
      owner: 'amara',
    },
  } as unknown as WorldState['items'],
  crops: {},
  wildlife: { fish: 1, deer: 1 },
  counters: { nextEntityId: 1 },
}

// Every id here resolves to nothing — the case the `?? id` fallbacks used to print raw.
const EMPTY: WorldState = { ...WORLD, agents: {}, structures: {} }

const payloadFor = (type: string): Record<string, unknown> => ({
  type,
  agentId: 'amara',
  tenderId: 'yusuf',
  byId: 'script',
  builderId: 'script',
  aId: 'amara',
  bId: 'yusuf',
  targetId: 'amara',
  id: 'structure_house_44_51',
  structureId: 'structure_house_44_51',
  toId: 'structure_house_44_51',
  cause: 'doused',
  kind: 'herb_bundle',
  reason: 'paved',
  verb: 'recipe:drink_rain',
  name: 'Drag self',
  sense: 'sound',
})

const eventsOfEveryType = (): SimEvent[] =>
  [...CHRONICLE_TYPES, 'item_moved', 'item_spawned', 'structure_damaged', 'fauna_moved'].map(
    (type, i) => ({ seq: i + 1, tick: 10, type, payload: payloadFor(type) }),
  )

describe('no viewer-facing string prints a machine id', () => {
  it('the shared chronicle line never says an id, named world or empty', () => {
    for (const world of [WORLD, EMPTY]) {
      const look = {
        agentName: (id: string) => world.agents[id]?.name ?? 'someone',
        structureKind: (id: string) =>
          (world.structures[id]?.kind ?? 'building').replace(/_/g, ' '),
        mysteryProse: () => null,
      }
      for (const ev of eventsOfEveryType())
        clean(chronicleLine(ev, look), `chronicleLine ${ev.type}`)
    }
  })

  it('the live log describes an event without one', () => {
    for (const world of [WORLD, EMPTY, null]) {
      for (const ev of eventsOfEveryType()) {
        clean(describeEvent(ev, world), `describeEvent ${ev.type}`)
        clean(chronicleLabel(ev, world), `chronicleLabel ${ev.type}`)
      }
    }
  })

  it('a hover plate, a thing and a building read as words', () => {
    for (const world of [WORLD, EMPTY]) {
      for (const [kind, id] of [
        ['structure', 'structure_house_44_51'],
        ['item', 'item_78'],
        ['item', 'item_structure_house_44_51_wood'],
      ] as const) {
        for (const row of hoverPlate(world, kind, id)) clean(row.text, `hoverPlate ${id}`)
        if (kind === 'item') clean(itemCropDetail(world, { kind, id }), `itemCropDetail ${id}`)
      }
    }
    clean(structureTitle(HOUSE), 'structureTitle')
    clean(structureWords(WORLD, HOUSE), 'structureWords')
    clean(structureWords(EMPTY, { ...HOUSE, owner: 'script' }), 'structureWords unowned')
  })

  it('a place is words or nothing, never a tile', () => {
    clean(placeOf(WORLD, 'yusuf').words, 'placeOf')
    clean(placeOf(EMPTY, 'yusuf').words, 'placeOf missing')
  })

  it('a moment card names its cast and never a coordinate', () => {
    const label = thumbLabel(
      { id: 1, day: 3, startTick: 0, endTick: 9, title: 'Day 3', cast: ['ghost'], location: null },
      {},
    )
    clean(label.cast, 'thumbLabel cast')
    clean(label.location, 'thumbLabel location')
  })
})

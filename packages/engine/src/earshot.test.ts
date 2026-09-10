import { describe, it, expect } from 'vitest'
import { DAYS_PER_YEAR, DEFAULT_CONFIG, SimConfigSchema, type SimConfig } from '@sj/shared'
import { hears, spokenTo } from './earshot.js'
import { fold } from './fold.js'
import { genesisState, type TileId, type WorldState } from './state.js'
import { ev } from './testutil/world.js'

const NOON = 720
const EARSHOT = DEFAULT_CONFIG.movement.earshotRadius
const NEAR = DEFAULT_CONFIG.movement.conversationRadius

function makeWorld(agents: { id: string; x: number; y: number }[]): WorldState {
  let s = genesisState(
    DEFAULT_CONFIG,
    Array.from({ length: 64 }, () => Array.from({ length: 64 }, (): TileId => 0)),
  )
  for (const a of agents)
    s = fold(
      s,
      ev('agent_spawned', { id: a.id, name: a.id, x: a.x, y: a.y, ageDays: 30 * DAYS_PER_YEAR }),
      DEFAULT_CONFIG,
    )
  return { ...s, tick: NOON }
}

const HOUSE = { id: 'structure_1', kind: 'house', x: 10, y: 10, w: 2, h: 2 }
const OTHER = { id: 'structure_2', kind: 'house', x: 20, y: 10, w: 2, h: 2 }
const DOOR = { x: 10, y: 12 }

function withHouse(s: WorldState, house: typeof HOUSE): WorldState {
  const planned = fold(
    s,
    ev('structure_planned', {
      id: house.id,
      kind: house.kind,
      x: house.x,
      y: house.y,
      w: house.w,
      h: house.h,
      maxHp: 50,
      flammable: true,
      builderId: 'script',
    }),
    DEFAULT_CONFIG,
  )
  return fold(planned, ev('structure_completed', { id: house.id }), DEFAULT_CONFIG)
}

function goInside(s: WorldState, id: string, house: typeof HOUSE): WorldState {
  const moved = fold(s, ev('agent_moved', { id, x: house.x, y: house.y + house.h }), DEFAULT_CONFIG)
  return fold(moved, ev('agent_entered', { agentId: id, structureId: house.id }), DEFAULT_CONFIG)
}

const mouth = (x: number, y: number, insideId?: string): Record<string, unknown> =>
  insideId === undefined ? { x, y } : { x, y, insideId }

describe('earshot: two reaches, one wall rule', () => {
  it('the far reach hears the whole square and the near reach only the shoulder next to it', () => {
    const s = makeWorld([{ id: 'a', x: 0, y: 0 }])
    expect(NEAR).toBeLessThan(EARSHOT)
    for (const d of [0, NEAR, EARSHOT]) {
      expect(hears(s, DEFAULT_CONFIG, mouth(d, 0), 'a')).toBe(true)
    }
    expect(hears(s, DEFAULT_CONFIG, mouth(EARSHOT + 1, 0), 'a')).toBe(false)
    expect(spokenTo(s, DEFAULT_CONFIG, mouth(NEAR, 0), 'a')).toBe(true)
    expect(spokenTo(s, DEFAULT_CONFIG, mouth(NEAR + 1, 0), 'a')).toBe(false)
  })

  it('the near reach is a circle like the far one, so a diagonal costs what it costs', () => {
    const s = makeWorld([{ id: 'a', x: 6, y: 6 }])
    // hypot(2, 2) is 2.83, past a two-tile reach even though each leg is inside it.
    expect(spokenTo(s, DEFAULT_CONFIG, mouth(8, 8), 'a')).toBe(false)
    expect(spokenTo(s, DEFAULT_CONFIG, mouth(8, 6), 'a')).toBe(true)
    expect(hears(s, DEFAULT_CONFIG, mouth(8, 8), 'a')).toBe(true)
  })

  it('two people under one roof are both heard and addressed, whatever the tiles say', () => {
    let s = withHouse(makeWorld([{ id: 'a', x: 9, y: 12 }]), HOUSE)
    s = goInside(s, 'a', HOUSE)
    const far = mouth(40, 40, HOUSE.id)
    expect(hears(s, DEFAULT_CONFIG, far, 'a')).toBe(true)
    expect(spokenTo(s, DEFAULT_CONFIG, far, 'a')).toBe(true)
  })

  it('two people under different roofs are neither, even standing wall to wall', () => {
    let s = withHouse(withHouse(makeWorld([{ id: 'a', x: 9, y: 12 }]), HOUSE), OTHER)
    s = goInside(s, 'a', HOUSE)
    const next = mouth(DOOR.x, DOOR.y, OTHER.id)
    expect(hears(s, DEFAULT_CONFIG, next, 'a')).toBe(false)
    expect(spokenTo(s, DEFAULT_CONFIG, next, 'a')).toBe(false)
  })

  it('a doorway carries both reaches, and a tile past it carries neither', () => {
    let s = withHouse(
      makeWorld([
        { id: 'inside', x: 9, y: 12 },
        { id: 'atDoor', x: 11, y: 13 },
        { id: 'past', x: 10, y: 14 },
      ]),
      HOUSE,
    )
    s = goInside(s, 'inside', HOUSE)
    const said = mouth(DOOR.x, DOOR.y, HOUSE.id)
    expect(hears(s, DEFAULT_CONFIG, said, 'atDoor')).toBe(true)
    expect(spokenTo(s, DEFAULT_CONFIG, said, 'atDoor')).toBe(true)
    expect(hears(s, DEFAULT_CONFIG, said, 'past')).toBe(false)
    expect(spokenTo(s, DEFAULT_CONFIG, said, 'past')).toBe(false)
  })

  it('occlusion off drops the wall from both reaches and keeps each its own distance', () => {
    const open: SimConfig = SimConfigSchema.parse({ occlusion: { enabled: false } })
    let s = withHouse(makeWorld([{ id: 'a', x: 9, y: 12 }]), HOUSE)
    s = goInside(s, 'a', HOUSE)
    const twoOff = mouth(DOOR.x + NEAR, DOOR.y, OTHER.id)
    const wayOff = mouth(DOOR.x + EARSHOT + 1, DOOR.y, OTHER.id)
    expect(hears(s, open, twoOff, 'a')).toBe(true)
    expect(spokenTo(s, open, twoOff, 'a')).toBe(true)
    expect(hears(s, open, wayOff, 'a')).toBe(false)
  })

  it('the conversational reach is a dial, and turning it moves only the near question', () => {
    const wide: SimConfig = SimConfigSchema.parse({ movement: { conversationRadius: 6 } })
    const s = makeWorld([{ id: 'a', x: 0, y: 0 }])
    expect(spokenTo(s, DEFAULT_CONFIG, mouth(6, 0), 'a')).toBe(false)
    expect(spokenTo(s, wide, mouth(6, 0), 'a')).toBe(true)
    expect(hears(s, wide, mouth(EARSHOT + 1, 0), 'a')).toBe(false)
  })

  it('no ear and no mouth is silence on both reaches', () => {
    const s = makeWorld([{ id: 'a', x: 0, y: 0 }])
    expect(hears(s, DEFAULT_CONFIG, mouth(0, 0), 'ghost')).toBe(false)
    expect(spokenTo(s, DEFAULT_CONFIG, mouth(0, 0), 'ghost')).toBe(false)
    expect(hears(s, DEFAULT_CONFIG, null, 'a')).toBe(false)
    expect(spokenTo(s, DEFAULT_CONFIG, { x: 'here', y: 0 }, 'a')).toBe(false)
  })
})

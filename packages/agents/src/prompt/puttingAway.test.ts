import { describe, expect, it } from 'vitest'
import { EventStore, openDb } from '@sj/engine/store'
import { fold, genesisState, type TileId, type WorldState } from '@sj/engine'
import { ADULT_AGE_DAYS, DEFAULT_CONFIG } from '@sj/shared'
import { doorstepLine, perceptionToProse } from './prose.js'
import { wireTown } from '../testutil/fixtures.js'
import type { EngineBridge } from '../runtime/bridge.js'

// Owner, 2026-09-02: "agents just end up leaving things in front of their houses (they don't
// even take them inside)". What a mind is told about its shelves, and about its own doorstep.

const AGENT = 'tamar'
const HOUSE = 'structure_house'
const STORE = 'structure_store'
const OTHER = 'structure_other'

// `into` names the shelf a thing stands on; without one it is in the hands.
type Placed = {
  id: string
  kind: string
  qty: number
  into?: string
  at?: { x: number; y: number }
  owner?: string
}

function town(placed: Placed[] = []): EngineBridge {
  const config = DEFAULT_CONFIG
  const terrain: TileId[][] = Array.from({ length: 32 }, () =>
    Array.from({ length: 32 }, (): TileId => 0),
  )
  const store = new EventStore(openDb(':memory:'))
  let state: WorldState = genesisState(config, terrain)
  const put = (type: string, payload: unknown): void => {
    state = fold(state, store.append(state.tick, type, payload), config)
  }
  const raise = (id: string, kind: string, x: number, owner: string): void => {
    put('structure_planned', {
      id,
      kind,
      x,
      y: 2,
      w: 2,
      h: 2,
      maxHp: 50,
      flammable: true,
      builderId: AGENT,
      ...(owner === '' ? {} : { owner }),
    })
    put('structure_completed', { id })
  }
  put('agent_spawned', { id: AGENT, name: 'Tamar', x: 16, y: 16, ageDays: ADULT_AGE_DAYS })
  put('agent_spawned', { id: 'omar', name: 'Omar', x: 26, y: 16, ageDays: ADULT_AGE_DAYS })
  raise(HOUSE, 'house', 2, AGENT)
  raise(STORE, 'storehouse', 12, '')
  raise(OTHER, 'house', 22, 'omar')
  for (const p of placed) {
    put('item_spawned', {
      id: p.id,
      kind: p.kind,
      qty: p.qty,
      loc:
        p.into !== undefined
          ? { t: 'structure', id: p.into }
          : p.at !== undefined
            ? { t: 'tile', x: p.at.x, y: p.at.y }
            : { t: 'agent', id: AGENT },
      owner: p.owner ?? AGENT,
    })
  }
  const { bridge } = wireTown({ state, store, seed: 'put-away', startTick: 720 })
  return bridge
}

const proseFor = (bridge: EngineBridge): string =>
  perceptionToProse(bridge.perception(AGENT), undefined, {
    isWalkable: (x, y) => bridge.isWalkable(x, y),
    isEdible: (kind) => bridge.isEdible(kind),
  })

describe('the heap on your own doorstep', () => {
  // The house stands at (2, 2), two tiles by two, and the body is over at (16, 16): what is
  // piled against your own wall is a thing you know, not a thing you are looking at.
  const byTheDoor = (n: number): Placed[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `item_${i}`,
      kind: 'plank',
      qty: 1,
      at: { x: 4, y: 4 },
    }))

  it('is said at three things and not at two', () => {
    expect(doorstepLine(town(byTheDoor(2)).perception(AGENT), null)).toBe('')
    expect(doorstepLine(town(byTheDoor(3)).perception(AGENT), null)).toBe(
      'On the ground by your door: plank ×3.',
    )
  })

  it('is said once an hour, however long the heap stands there', () => {
    const packet = town(byTheDoor(3)).perception(AGENT)
    const said = packet.time.tick
    expect(doorstepLine(packet, said)).toBe('')
    expect(doorstepLine(packet, said - 59)).toBe('')
    expect(doorstepLine(packet, said - 60)).toContain('On the ground by your door')
  })
})

describe('the satchel is read out once, grouped by kind', () => {
  const notes = (n: number): Placed[] =>
    Array.from({ length: n }, (_, i) => ({ id: `item_${131 + i}`, kind: 'note', qty: 1 }))

  it('twelve notes are one tally and one mark, not twelve sentences', () => {
    const said = proseFor(town(notes(12)))
    expect(said).toContain('Your hands hold note ×12 (item_131…)')
    expect(said).not.toContain('You are carrying')
    expect(said).not.toContain('item_132')
  })

  it('a single thing keeps its own mark, with nothing trailing it', () => {
    const said = proseFor(town([{ id: 'item_9', kind: 'bucket', qty: 1 }]))
    expect(said).toContain('Your hands hold bucket ×1 (item_9);')
  })

  it("another's thing is a tally of its own, and still says whose it is", () => {
    const said = proseFor(
      town([
        { id: 'item_1', kind: 'bread', qty: 1 },
        { id: 'item_2', kind: 'bread', qty: 1, owner: 'omar' },
      ]),
    )
    expect(said).toContain("Your hands hold bread ×1 (item_1), bread ×1 (item_2; Omar's)")
  })
})

describe('the shelves a mind knows it has', () => {
  it('says its own roof first, the town store after, and never a neighbour’s house', () => {
    const said = proseFor(
      town([
        { id: 'item_1', kind: 'plank', qty: 3, into: HOUSE },
        { id: 'item_2', kind: 'bread', qty: 2, into: HOUSE },
        { id: 'item_3', kind: 'wood', qty: 60, into: STORE },
        { id: 'item_4', kind: 'fish', qty: 1, into: OTHER },
      ]),
    )
    expect(said).toContain('Your house holds plank ×3, bread ×2.')
    expect(said).toContain('The storehouse holds wood ×60.')
    expect(said).not.toContain('fish')
  })

  it('says nothing about a shelf standing empty', () => {
    expect(proseFor(town())).not.toContain('holds')
  })

  it('folds the tail of a long shelf into a count of kinds', () => {
    const kinds = [
      'wood',
      'plank',
      'stone',
      'clay',
      'reed',
      'bread',
      'fish',
      'berries',
      'herb',
      'wheat',
      'hide',
      'cloth',
      'rope',
      'bucket',
      'torch',
    ]
    const said = proseFor(
      town(kinds.map((k, i) => ({ id: `item_${i}`, kind: k, qty: 15 - i, into: STORE }))),
    )
    const line = said.split(/(?<=\.)\s+/).find((s) => s.startsWith('The storehouse holds'))!
    expect(line).toContain('wood ×15')
    expect(line).toMatch(/and \d other kinds\.$/)
    expect(line.length / 3.3).toBeLessThanOrEqual(40)
  })
})

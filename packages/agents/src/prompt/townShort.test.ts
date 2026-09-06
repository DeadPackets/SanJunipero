import { describe, expect, it } from 'vitest'
import { scanForDirective } from '@sj/shared'
import { quietMeadowPacket } from '../testutil/fixtures.js'
import { stockLine, usefulLine, type PerceptionPacket, type TownStock } from './prose.js'

type Agent = PerceptionPacket['visible']['agents'][number]

const STOCKED: TownStock = { wood: 12, food: 30, hearths: 5, mouths: 12 }

const stock = (over: Partial<TownStock> = {}): TownStock => ({ ...STOCKED, ...over })

const person = (over: Partial<Agent> = {}): Agent => ({
  id: 'agent_9',
  name: 'Bashir',
  x: 12,
  y: 40,
  activityVerb: null,
  collapsed: false,
  asleep: false,
  ...over,
})

const seeing = (agents: Agent[]): PerceptionPacket => ({
  ...quietMeadowPacket,
  visible: { ...quietMeadowPacket.visible, agents },
})

const world = {
  nearestSource: () => ({ x: 4, y: 5, from: 'tree' as const }),
  nearestFood: () => ({ x: 6, y: 7, kind: 'berries' }),
}

describe('★ what the town is running out of, said to everybody', () => {
  it('says nothing while the shelves hold', () => {
    expect(stockLine(STOCKED)).toBe('')
    // Exactly two logs a hearth and one meal a mouth is stocked, not short.
    expect(stockLine(stock({ wood: 10, food: 24 }))).toBe('')
  })

  it('names the wood alone when only the wood is thin', () => {
    expect(stockLine(stock({ wood: 3 }))).toBe('The town has 3 logs for 5 hearths.')
  })

  it('names the food alone when only the food is thin', () => {
    expect(stockLine(stock({ food: 7 }))).toBe('The town has 7 meals for 12 mouths.')
  })

  it('names both sides in one sentence when both are thin', () => {
    expect(stockLine(stock({ wood: 3, food: 7 }))).toBe(
      'The town has 3 logs for 5 hearths and 7 meals for 12 mouths.',
    )
  })

  it('counts one of a thing as one', () => {
    expect(stockLine({ wood: 1, food: 1, hearths: 1, mouths: 2 })).toBe(
      'The town has 1 log for 1 hearth and 1 meal for 2 mouths.',
    )
  })

  it('★ asks for nothing and orders nothing', () => {
    expect(scanForDirective(stockLine(stock({ wood: 3, food: 7 })))).toEqual([])
  })
})

describe('★ the road a high esteem is given', () => {
  it('says nothing at all to a mind that wants something else', () => {
    expect(usefulLine('belonging', stock({ wood: 3 }), seeing([]), world)).toBe('')
    expect(usefulLine(null, stock({ wood: 3 }), seeing([]), world)).toBe('')
  })

  it('turns the want back on the town when nothing is short', () => {
    expect(usefulLine('esteem', STOCKED, seeing([]), world)).toBe(
      'Today the thing you want most is to be counted on. Nobody is short of anything; who have you not helped lately?',
    )
  })

  it('names the wood, and whoever is already at it', () => {
    expect(
      usefulLine('esteem', stock({ wood: 3 }), seeing([person({ activityVerb: 'chop' })]), world),
    ).toBe(
      'Today the thing you want most is to be counted on. The town has 3 logs for 5 hearths. Bashir is chopping at (12, 40).',
    )
  })

  it('names the food, and whoever is already at it', () => {
    expect(
      usefulLine(
        'esteem',
        stock({ food: 7 }),
        seeing([person({ name: 'Nadia', activityVerb: 'forage', x: 8, y: 9 })]),
        world,
      ),
    ).toBe(
      'Today the thing you want most is to be counted on. The town has 7 meals for 12 mouths. Nadia is foraging at (8, 9).',
    )
  })

  it('falls back to where the stuff stands when nobody is at that work', () => {
    // A body at some other work is not a body at this one.
    const idle = seeing([person({ activityVerb: 'fish' })])
    expect(usefulLine('esteem', stock({ wood: 3 }), idle, world)).toContain(
      'The nearest standing tree is at (4, 5).',
    )
    expect(usefulLine('esteem', stock({ food: 7 }), seeing([]), world)).toContain(
      'The nearest food you know of is berries at (6, 7).',
    )
  })

  it('★ names the river and the woods when the town holds no food at all', () => {
    const bare = {
      ...world,
      nearestFood: () => null,
      foodSources: () => ({ bank: { x: 14, y: 27 }, woods: null }),
    }
    expect(usefulLine('esteem', stock({ food: 0 }), seeing([]), bare)).toContain(
      'The town has 0 meals for 12 mouths. Fish are in the river; the nearest bank to stand on is at (14, 27),',
    )
  })

  it('stops at the numbers when there is no road to give', () => {
    expect(usefulLine('esteem', stock({ wood: 3 }), seeing([]), {})).toBe(
      'Today the thing you want most is to be counted on. The town has 3 logs for 5 hearths.',
    )
  })

  it('names the thinner of the two sides, by ratio and not by count', () => {
    // Wood is at 3 of 10 and food at 9 of 24: thinner wood.
    expect(usefulLine('esteem', stock({ wood: 3, food: 9 }), seeing([]), world)).toContain(
      '3 logs for 5 hearths',
    )
    // Wood at 9 of 10 and food at 2 of 24 turns it round.
    expect(usefulLine('esteem', stock({ wood: 9, food: 2 }), seeing([]), world)).toContain(
      '2 meals for 12 mouths',
    )
  })

  it('takes the nearest worker, then the earlier name', () => {
    const two = seeing([
      person({ id: 'agent_1', name: 'Yusuf', activityVerb: 'chop', x: 12, y: 20 }),
      person({ id: 'agent_2', name: 'Amara', activityVerb: 'chop', x: 12, y: 11 }),
    ])
    expect(usefulLine('esteem', stock({ wood: 3 }), two, world)).toContain('Amara is chopping')
    const tied = seeing([
      person({ id: 'agent_1', name: 'Yusuf', activityVerb: 'chop', x: 12, y: 11 }),
      person({ id: 'agent_2', name: 'Amara', activityVerb: 'chop', x: 12, y: 7 }),
    ])
    expect(usefulLine('esteem', stock({ wood: 3 }), tied, world)).toContain('Amara is chopping')
  })

  it('★ hands over no quota and no order', () => {
    const said = usefulLine(
      'esteem',
      stock({ wood: 3 }),
      seeing([person({ activityVerb: 'chop' })]),
      world,
    )
    expect(scanForDirective(said)).toEqual([])
    expect(said).not.toContain('should')
    expect(said).not.toContain('must')
  })
})

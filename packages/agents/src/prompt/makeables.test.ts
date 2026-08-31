import { describe, expect, it } from 'vitest'
import { craftRoutes, makeables } from '@sj/engine'
import { DEFAULT_CONFIG, FORBIDDEN_FRAMING } from '@sj/shared'
import {
  makeablesLine,
  roadLine,
  type PerceptionPacket,
  type ProseWorld,
  type SourceKind,
} from './prose.js'
import { quietMeadowPacket } from '../testutil/fixtures.js'

// `build` and `craft` are useless without the nouns they take. The vocabulary is derived from
// the two tables the verbs validate against, and it lives in the volatile block.

const C = DEFAULT_CONFIG

describe('the makeable vocabulary comes off the tables the verbs already read', () => {
  it('names every kind a pair of hands can raise, and nothing the world places itself', () => {
    const m = makeables(C)
    expect(m.builds.map((b) => b.kind)).toEqual([
      'bridge',
      'cottage',
      'farmhouse',
      'house',
      'lamp_post',
      'well',
    ])
    // A grave has no inputs: the world digs it, and `build` refuses it. It is not vocabulary.
    expect(m.builds.some((b) => b.kind === 'grave')).toBe(false)
    // Neither is a cabin or a storehouse: both are 2x2, exactly a house's mass, so a buildable
    // one would be a second name for the same building.
    expect(m.builds.some((b) => b.kind === 'cabin')).toBe(false)
    expect(m.builds.some((b) => b.kind === 'storehouse')).toBe(false)
    expect(m.builds.find((b) => b.kind === 'house')!.inputs).toEqual({ wood: 10 })
    // ★ THE THREE ROOFS PRICE AT ONE RATE: 2.5 wood a tile of floor, off the house's own row.
    for (const [kind, tiles] of [
      ['house', 4],
      ['cottage', 6],
      ['farmhouse', 8],
    ] as const) {
      expect(m.builds.find((b) => b.kind === kind)!.inputs, kind).toEqual({ wood: tiles * 2.5 })
    }
  })

  it('names one word per product, so the word reaches every road to it', () => {
    const m = makeables(C)
    expect(m.crafts.map((c) => c.name)).toEqual(['cloth', 'garment', 'plank', 'stew', 'torch'])
    // Six rows, five words: the loom and the hide both answer to "garment", which is exactly
    // what `craftRoutes` resolves — and `hide_garment` would have reached only one of them.
    expect(m.crafts.flatMap((c) => c.roads)).toHaveLength(6)
    expect(m.crafts.find((c) => c.name === 'garment')!.roads.map((r) => r.inputs)).toEqual([
      { cloth: 2 },
      { hide: 2 },
    ])
  })

  it('every word it speaks is a word `craft` can actually resolve', () => {
    for (const c of makeables(C).crafts) expect(craftRoutes(C, c.name).length).toBeGreaterThan(0)
  })

  it('carries the two conditions a config row cannot say', () => {
    const stew = makeables(C).crafts.find((c) => c.name === 'stew')!
    expect(stew.roads[0]!.atFire).toBe(true)
    expect(stew.roads[0]!.water).toBe(1)
  })
})

describe('the sentence a mind reads', () => {
  const line = makeablesLine(makeables(C))

  it('says the thing and what it costs, for raising and for shaping alike', () => {
    expect(line).toContain('a house (10 wood)')
    expect(line).toContain('a well (8 stone)')
    expect(line).toContain('cloth (2 fiber)')
    expect(line).toContain('garment (2 cloth, or 2 hide)')
    // Inputs read in kind order, so two towns holding the same larder read the same sentence.
    expect(line).toContain('torch (1 fiber and 1 wood)')
  })

  it('says the pot needs a fire and water, because a hungry town will try the pot', () => {
    expect(line).toContain(
      'stew (1 meat and 1 vegetable, at a fire someone is feeding, ' +
        'with water in something you carry)',
    )
  })

  it('is world text: no machinery word survives the human-framing law', () => {
    expect(FORBIDDEN_FRAMING.test(line)).toBe(false)
  })

  it('is deterministic — the same config says the same sentence', () => {
    expect(makeablesLine(makeables(C))).toBe(line)
  })
})

// A cost with no place to go is a want with no road, which the want experiment measured as worse
// than no want at all. This is the road under the list — roofs and pots ranked together.
describe('the road under the makeables list', () => {
  const at = (from: SourceKind, x: number, y: number) => () => ({ x, y, from })
  const trees: ProseWorld = {
    nearestSource: (kind) => (kind === 'wood' ? { x: 31, y: 44, from: 'tree' } : null),
  }
  const holding = (...carried: { kind: string; qty: number }[]): PerceptionPacket => ({
    ...quietMeadowPacket,
    self: {
      ...quietMeadowPacket.self,
      inventory: carried.map((c, n) => ({
        id: `i${n}`,
        ...c,
        loc: { t: 'agent' as const, id: 'a' },
      })),
    },
  })
  const road = (packet: PerceptionPacket, world: ProseWorld): string =>
    roadLine(makeables(C), packet, world)

  // Everything cheaper than a pot of stew, so stew is the only thing left wanting.
  const larderFull = [
    { kind: 'wood', qty: 20 },
    { kind: 'fiber', qty: 2 },
    { kind: 'cloth', qty: 2 },
    { kind: 'stone', qty: 8 },
  ]
  const wet: ProseWorld = { nearestSource: () => null, nearestWater: () => ({ x: 34, y: 35 }) }

  it('★ ranks roofs and pots in one list: the cheapest thing overall is a plank, not a post', () => {
    expect(road(quietMeadowPacket, trees)).toBe(
      'Plank wants 1 wood; the nearest standing tree is at (31, 44).',
    )
  })

  it('★ a roof outranks a pot when the two are equally short, and the order never wobbles', () => {
    // One wood covers the plank. A lamp post and a torch are both one thing short; builds run
    // first and the comparison is strict, so the post wins and wins again every turn.
    const line = road(holding({ kind: 'wood', qty: 1 }), trees)
    expect(line).toBe('A lamp post wants 2 wood; the nearest standing tree is at (31, 44).')
    expect(road(holding({ kind: 'wood', qty: 1 }), trees)).toBe(line)
  })

  it('climbs to the next want as the hands fill, and says nothing about a place it cannot see', () => {
    // Six wood covers every wooden thing this cheap; the torch is one fiber short, and this
    // world only knows where wood is.
    expect(road(holding({ kind: 'wood', qty: 6 }), trees)).toBe('Torch wants 1 fiber.')
  })

  it('★ takes the route with fewest things missing, not the first one listed', () => {
    // A garment is two cloth or two hide. One hide in hand makes the hide road the shorter one.
    const line = road(
      holding({ kind: 'wood', qty: 20 }, { kind: 'fiber', qty: 2 }, { kind: 'hide', qty: 1 }),
      {
        nearestSource: at('stack', 9, 9),
      },
    )
    expect(line).toBe(
      'Garment wants 2 hide; the nearest hide lying where it was left is at (9, 9).',
    )
  })

  it('★ counts a class input as one thing, and any member of it answers', () => {
    // Nothing meaty in hand: the pot asks for meat by its class name, not for a fish by name.
    expect(road(holding(...larderFull, { kind: 'berries', qty: 1 }), wet)).toBe(
      'Stew wants 1 meat.',
    )
    // A fish IS meat, so that want closes and the fire is the next thing short.
    expect(
      road(holding(...larderFull, { kind: 'berries', qty: 1 }, { kind: 'fish', qty: 1 }), wet),
    ).toBe('Stew wants a fire someone is feeding.')
  })

  it('★ a condition names where it can be met, so it is a road and not just a lack', () => {
    const packet = holding(...larderFull, { kind: 'berries', qty: 1 }, { kind: 'fish', qty: 1 })
    const byTheFire: PerceptionPacket = {
      ...packet,
      visible: {
        ...packet.visible,
        structures: [
          {
            id: 'structure_house_5_4',
            kind: 'house',
            x: 5,
            y: 4,
            w: 2,
            h: 2,
            burning: false,
            stage: 'complete',
            hearth: 'lit',
          },
        ],
      },
    }
    expect(road(byTheFire, wet)).toBe(
      'Stew wants water in something you carry; the nearest water lies at (34, 35).',
    )
  })

  it('a stack somebody already put down is named for what it is, not for a source', () => {
    expect(road(quietMeadowPacket, { nearestSource: at('stack', 5, 6) })).toBe(
      'Plank wants 1 wood; the nearest wood lying where it was left is at (5, 6).',
    )
  })

  it('still names the want when nothing in sight answers it — a road, never a refusal', () => {
    expect(road(quietMeadowPacket, { nearestSource: () => null })).toBe('Plank wants 1 wood.')
  })

  it('stays silent with no world to ask, so a packet from before it reads as it always did', () => {
    expect(roadLine(makeables(C), quietMeadowPacket)).toBe('')
  })

  it('is world text: no machinery word survives the human-framing law', () => {
    expect(FORBIDDEN_FRAMING.test(road(quietMeadowPacket, trees))).toBe(false)
  })
})

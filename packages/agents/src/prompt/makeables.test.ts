import { describe, expect, it } from 'vitest'
import { craftRoutes, makeables } from '@sj/engine'
import { DEFAULT_CONFIG, FORBIDDEN_FRAMING } from '@sj/shared'
import { buildRoadLine, makeablesLine } from './prose.js'
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
// than no want at all. This is the road under the list.
describe('the road under the makeables list', () => {
  const trees = {
    nearestSource: (kind: string) =>
      kind === 'wood' ? { x: 31, y: 44, from: 'tree' as const } : null,
  }
  const holding = (kind: string, qty: number) => ({
    ...quietMeadowPacket,
    self: {
      ...quietMeadowPacket.self,
      inventory: [{ id: 'i1', kind, qty, loc: { t: 'agent' as const, id: 'a' } }],
    },
  })

  it('names the nearest thing to standing that the hands cannot yet raise, and where its stuff is', () => {
    expect(buildRoadLine(makeables(C).builds, quietMeadowPacket, trees)).toBe(
      'A lamp post wants 2 wood; the nearest standing tree is at (31, 44).',
    )
  })

  it('climbs to the next want as the hands fill — the road shortens, it does not repeat', () => {
    // Six wood covers the lamp post and the bridge outright; the house is four short and so is
    // now the nearest roof to standing.
    expect(buildRoadLine(makeables(C).builds, holding('wood', 6), trees)).toBe(
      'A house wants 10 wood; the nearest standing tree is at (31, 44).',
    )
  })

  it('crosses to another material once every wooden thing is covered', () => {
    const stone = { nearestSource: () => ({ x: 22, y: 100, from: 'stone_outcrop' as const }) }
    expect(buildRoadLine(makeables(C).builds, holding('wood', 20), stone)).toBe(
      'A well wants 8 stone; the nearest stone outcrop is at (22, 100).',
    )
  })

  it('a stack somebody already put down is named for what it is, not for a source', () => {
    const lying = { nearestSource: () => ({ x: 5, y: 6, from: 'stack' as const }) }
    expect(buildRoadLine(makeables(C).builds, quietMeadowPacket, lying)).toBe(
      'A lamp post wants 2 wood; the nearest wood lying where it was left is at (5, 6).',
    )
  })

  it('stays silent when the stuff is nowhere within reach of the eyes — a road, never a refusal', () => {
    expect(
      buildRoadLine(makeables(C).builds, quietMeadowPacket, { nearestSource: () => null }),
    ).toBe('')
  })

  it('stays silent with no world to ask, so a packet from before it reads as it always did', () => {
    expect(buildRoadLine(makeables(C).builds, quietMeadowPacket)).toBe('')
  })

  it('is world text: no machinery word survives the human-framing law', () => {
    expect(
      FORBIDDEN_FRAMING.test(buildRoadLine(makeables(C).builds, quietMeadowPacket, trees)),
    ).toBe(false)
  })
})

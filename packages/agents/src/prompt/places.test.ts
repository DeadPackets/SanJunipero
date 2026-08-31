import { describe, expect, it } from 'vitest'
import { FORBIDDEN_FRAMING } from '@sj/shared'
import { placesKnownLine, type KnownPlace, type PerceptionPacket } from './prose.js'
import { CAPABILITIES } from './rulesOfBeing.js'
import { quietMeadowPacket } from '../testutil/fixtures.js'

// The mind stands at (12, 9) in the meadow; every bearing below is read from there.
const AT = quietMeadowPacket.self
const place = (over: Partial<KnownPlace> & { id: string }): KnownPlace => ({
  kind: 'house',
  x: AT.x,
  y: AT.y,
  ...over,
})

const linesOf = (places: KnownPlace[], packet: PerceptionPacket = quietMeadowPacket): string[] => {
  const block = placesKnownLine(places, packet)
  return block === '' ? [] : block.split('\n')
}

describe('★ the places a mind knows but cannot see', () => {
  it('names each one, where it lies and how far, and never a tile', () => {
    const lines = linesOf([
      place({ id: 'structure_68', kind: 'house', x: 60, y: -40 }),
      place({ id: 'structure_12', kind: 'farmhouse', x: 30, y: 30, name: 'the old farmhouse' }),
    ])
    expect(lines[0]).toBe('Places you know:')
    // A named place is called by its name; a nameless one is only ever pointed at.
    expect(lines).toContain('the old farmhouse (structure_12), far to the south-east')
    expect(lines).toContain('a house (structure_68), far to the north-east')
    // The tile is what this whole block exists to stop a mind guessing at.
    expect(lines.join(' ')).not.toMatch(/\(\d+, ?-?\d+\)/)
  })

  it("says how far in a body's words, on the three bands", () => {
    const at = (dx: number): string =>
      linesOf([place({ id: 'structure_1', x: AT.x + dx })])[1]!
    expect(at(6)).toBe('a house (structure_1), close to the east')
    expect(at(20)).toBe('a house (structure_1), a way to the east')
    expect(at(60)).toBe('a house (structure_1), far to the east')
  })

  it('reads the compass round: the smaller y is the further north', () => {
    const toward = (dx: number, dy: number): string =>
      linesOf([place({ id: 'structure_1', x: AT.x + dx, y: AT.y + dy })])[1]!.split('the ').at(-1)!
    expect(toward(0, -40)).toBe('north')
    expect(toward(40, 0)).toBe('east')
    expect(toward(0, 40)).toBe('south')
    expect(toward(-40, 0)).toBe('west')
    expect(toward(-40, -40)).toBe('north-west')
    expect(toward(40, 40)).toBe('south-east')
  })

  it('drops the walls already in front of it: the packet is telling the mind about those', () => {
    const seen = {
      ...quietMeadowPacket,
      visible: {
        ...quietMeadowPacket.visible,
        structures: [
          {
            id: 'structure_1',
            kind: 'house',
            x: 13,
            y: 9,
            w: 1,
            h: 1,
            burning: false,
            stage: 'complete' as const,
          },
        ],
      },
    }
    const both = [place({ id: 'structure_1', x: 13 }), place({ id: 'structure_2', x: 60 })]
    expect(linesOf(both, seen)).toEqual(['Places you know:', 'a house (structure_2), far to the east'])
  })

  it('says nothing at all when every place a mind knows is standing in front of it', () => {
    expect(placesKnownLine([], quietMeadowPacket)).toBe('')
  })

  it('is nearest first, and never longer than a person holds in their head', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      place({ id: `structure_${String(i).padStart(2, '0')}`, x: AT.x + 60 - i }),
    )
    const lines = linesOf(many)
    expect(lines).toHaveLength(13) // the heading and twelve places
    expect(lines[1]).toContain('structure_29')
    expect(lines.at(-1)).toContain('structure_18')
  })

  it('is a fact and nothing more: no machinery, no counsel', () => {
    const block = placesKnownLine(
      [place({ id: 'structure_1', x: 60, name: 'the old farmhouse' })],
      quietMeadowPacket,
    )
    expect(block).not.toMatch(FORBIDDEN_FRAMING)
    expect(block).not.toMatch(/\b(should|must|go to|remember to|why not)\b/i)
  })
})

describe('★ block 1 tells the truth about walking to a place', () => {
  const walkLine = CAPABILITIES.split('\n').find((l) => l.startsWith('walk: '))!

  it('offers both ways of naming where a walk ends', () => {
    expect(walkLine).toContain('give x and y as two numbers')
    expect(walkLine).toMatch(/structureId, the mark of a place you know/)
  })

  it('says a place stays known once seen or heard of, which the marks paragraph used to deny', () => {
    expect(CAPABILITIES).toContain('heard someone say its name')
    expect(CAPABILITIES).toContain('you know it for good and can go back to it from anywhere')
  })

  // Physics, never outcomes: the block says what a name DOES, and never asks for one.
  it('never tells a mind to name a place or to spread one', () => {
    expect(CAPABILITIES).not.toMatch(/\b(name your|should inscribe|tell others|spread the)\b/i)
    expect(walkLine).not.toMatch(FORBIDDEN_FRAMING)
  })
})

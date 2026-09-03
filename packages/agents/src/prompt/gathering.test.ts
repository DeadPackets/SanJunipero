import { describe, expect, it } from 'vitest'
import { MINUTES_PER_DAY } from '@sj/shared'
import { quietMeadowPacket } from '../testutil/fixtures.js'
import { gatheringLine, type PerceptionPacket } from './prose.js'

const DUSK = 19 * 60
const NOON = 12 * 60

type Agent = PerceptionPacket['visible']['agents'][number]
type Structure = PerceptionPacket['visible']['structures'][number]

const person = (name: string, x: number, y: number, asleep = false): Agent => ({
  id: name.toLowerCase(),
  name,
  x,
  y,
  activityVerb: null,
  collapsed: false,
  asleep,
})

const pit = (over: Partial<Structure> = {}): Structure => ({
  id: 'fire_1',
  kind: 'fire_pit',
  x: 20,
  y: 20,
  w: 1,
  h: 1,
  burning: false,
  stage: 'complete',
  hearth: 'lit',
  ...over,
})

const seeing = (structures: Structure[], agents: Agent[] = []): PerceptionPacket => ({
  ...quietMeadowPacket,
  visible: { ...quietMeadowPacket.visible, structures, agents },
})

describe('★ the dusk gathering: the cue line at the town fire', () => {
  it('says nothing at noon, however well fed the fire is', () => {
    expect(gatheringLine(seeing([pit()], [person('Nadia', 20, 21)]), NOON)).toBe('')
  })

  it('says nothing about a fire nobody is feeding', () => {
    expect(gatheringLine(seeing([pit({ hearth: 'cold' })], [person('Nadia', 20, 21)]), DUSK)).toBe(
      '',
    )
  })

  it('says nothing when no fire is in sight at all', () => {
    expect(gatheringLine(seeing([], [person('Nadia', 20, 21)]), DUSK)).toBe('')
  })

  it('names the people actually standing at it, and nobody else', () => {
    const packet = seeing(
      [pit()],
      [
        person('Nadia', 20, 21),
        person('Omar', 40, 40), // across the town, and in sight
        person('Tamar', 18, 22),
      ],
    )
    expect(gatheringLine(packet, DUSK)).toBe(
      'A fire pit (fire_1) is lit against the dusk; Nadia and Tamar are standing at it.',
    )
  })

  it('says a lit fire with nobody at it, because being the first there is the answer', () => {
    expect(gatheringLine(seeing([pit()], [person('Omar', 40, 40)]), DUSK)).toBe(
      'A fire pit (fire_1) is lit against the dusk, and nobody is standing at it.',
    )
  })

  // A body down at the fire is not company: the cue is about who could answer a word.
  it('does not count a sleeper at the fire as somebody who is there', () => {
    expect(gatheringLine(seeing([pit()], [person('Nadia', 20, 21, true)]), DUSK)).toBe(
      'A fire pit (fire_1) is lit against the dusk, and nobody is standing at it.',
    )
  })

  it('calls the fire by the name the town gave it, and lists three plainly', () => {
    const packet = seeing(
      [pit({ name: 'the old fire' })],
      [person('Nadia', 20, 21), person('Omar', 21, 20), person('Tamar', 19, 19)],
    )
    expect(gatheringLine(packet, DUSK)).toBe(
      'The old fire (fire_1) is lit against the dusk; Nadia, Omar and Tamar are standing at it.',
    )
  })

  it('reads the same at every dusk, on any day', () => {
    const packet = seeing([pit()], [person('Nadia', 20, 21)])
    expect(gatheringLine(packet, DUSK + 9 * MINUTES_PER_DAY)).toBe(gatheringLine(packet, DUSK))
  })
})

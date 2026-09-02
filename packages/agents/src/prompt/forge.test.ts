import { describe, expect, it } from 'vitest'
import { FORBIDDEN_FRAMING, type RosterEntry } from '@sj/shared'
import { assemblePrompt } from './assemble.js'
import { perceptionToProse, type PerceptionPacket } from './prose.js'
import { renderRoster, ROSTER_HEAD, SPEECH_RULES } from './rulesOfBeing.js'
import { fixtureBlocks, quietMeadowPacket } from '../testutil/fixtures.js'

// What the forge puts into the world, as a mind is told it.

const smokeFish: RosterEntry = {
  id: 'recipe:smoke_fish',
  name: 'Smoke Fish Over Green Wood',
  gloss: 'Hang the catch in green-wood smoke so it keeps',
  reads: [],
}
const wager: RosterEntry = {
  id: 'recipe:wager',
  name: 'Wager a Thing',
  gloss: 'Stake a thing you hold on a claim, to one person',
  reads: ['itemId', 'targetId'],
}

describe('what the town has learned to do', () => {
  it('is empty text when nothing is minted, and one line a verb when something is', () => {
    expect(renderRoster([])).toBe('')
    expect(renderRoster([smokeFish, wager])).toBe(
      [
        ROSTER_HEAD,
        'Smoke Fish Over Green Wood: Hang the catch in green-wood smoke so it keeps. Name it recipe:smoke_fish',
        'Wager a Thing: Stake a thing you hold on a claim, to one person. Name it recipe:wager, give itemId, targetId',
      ].join('\n'),
    )
    expect(renderRoster([smokeFish, wager])).not.toMatch(FORBIDDEN_FRAMING)
  })

  it('spends at most forty tokens a verb, at the gloss cap', () => {
    const widest: RosterEntry = {
      id: 'recipe:a_long_name_for_it_indeed',
      name: 'A Long Name For It Indeed And Then Some More',
      gloss: 'x'.repeat(50),
      reads: ['itemId', 'structureId', 'targetId'],
    }
    const [, line] = renderRoster([widest]).split('\n')
    expect(Math.ceil(line!.length / 4)).toBeLessThanOrEqual(40)
  })

  it('sits in the system prefix after the static rules and before anything one mind owns', () => {
    const a = assemblePrompt(fixtureBlocks({ roster: [smokeFish] }))
    const block = renderRoster([smokeFish])
    expect(a.system).toContain(`${SPEECH_RULES}\n\n---\n\n${block}\n\n---\n\nName: Tamar`)
  })

  it('costs a town that has minted nothing not one byte', () => {
    const none = assemblePrompt(fixtureBlocks()).system
    expect(assemblePrompt(fixtureBlocks({ roster: [] })).system).toBe(none)
    expect(none).not.toContain(ROSTER_HEAD)
  })
})

const meadow = (visible: Partial<PerceptionPacket['visible']>): PerceptionPacket => ({
  ...quietMeadowPacket,
  visible: { ...quietMeadowPacket.visible, ...visible },
})

describe('marks a minted verb left', () => {
  it('are read off a person, a building and a thing as "marked: key value"', () => {
    const prose = perceptionToProse(
      meadow({
        agents: [
          {
            id: 'omar',
            name: 'Omar',
            x: 13,
            y: 9,
            activityVerb: null,
            collapsed: false,
            asleep: false,
            marks: { debt: 'two planks', oath: 'sworn' },
          },
        ],
        structures: [
          {
            id: 'structure_1',
            kind: 'well',
            x: 14,
            y: 9,
            w: 1,
            h: 1,
            burning: false,
            stage: 'complete',
            marks: { keeper: 'Omar' },
          },
        ],
        items: [
          {
            id: 'item_1',
            kind: 'plank',
            qty: 2,
            loc: { t: 'tile', x: 12, y: 10 },
            marks: { promised: 'to Omar' },
          },
        ],
      }),
    )
    expect(prose).toContain(
      'Omar (omar) stands at (13, 9); marked: debt two planks; marked: oath sworn.',
    )
    expect(prose).toMatch(/well.*marked: keeper Omar/)
    expect(prose).toContain('You can see 2 plank (item_1) at (12, 10); marked: promised to Omar.')
    expect(prose).not.toMatch(FORBIDDEN_FRAMING)
  })
})

describe('a discovery a neighbour made', () => {
  it('is told with the name and the why, and without the why when there was none', () => {
    const told = (saying?: string): string =>
      perceptionToProse({
        ...quietMeadowPacket,
        seen: [
          {
            kind: 'discovery',
            inventorName: 'Omar',
            pronoun: 'he',
            name: 'smoking fish over green wood',
            ...(saying === undefined ? {} : { saying }),
          },
        ],
      })
    expect(told('the catch would not keep past the week')).toContain(
      'Omar has worked out smoking fish over green wood: he said the catch would not keep past the week.',
    )
    expect(told()).toContain('Omar has worked out smoking fish over green wood.')
  })
})

describe('a witnessed act', () => {
  it('is told in the words its charter gave it, seen or heard', () => {
    const seen = (sense: 'sight' | 'sound'): string =>
      perceptionToProse({
        ...quietMeadowPacket,
        seen: [
          {
            kind: 'expression',
            actorName: 'Omar',
            verb: 'recipe:toast',
            sense,
            label: 'raises a cup to the room',
          },
        ],
      })
    expect(seen('sight')).toContain('You watch Omar raises a cup to the room.')
    expect(seen('sound')).toContain('You hear Omar raises a cup to the room.')
  })
})

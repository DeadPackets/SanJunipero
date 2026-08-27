// A leak in a backstory or a goal otherwise throws at the first turn of a live run; these rows
// pay that offline. A cast is also where a fixture instructs a mind, which the goal rows hold.
import { describe, expect, it } from 'vitest'
import { assemblePrompt } from '../prompt/assemble.js'
import { RULES_OF_BEING } from '../prompt/rulesOfBeing.js'
import { scanForLayoutLeak, scanPromptForGlassLeak } from '@sj/shared'
import { FOUNDER_MINDS } from './founderMinds.js'

const promptFor = (mind: (typeof FOUNDER_MINDS)[number]): string => {
  const p = assemblePrompt({
    rulesOfBeing: RULES_OF_BEING,
    identity: mind.identity,
    personality: { doc: mind.personality, autobiography: [] },
    scene: { ledgers: [], memories: [] },
    dayLog: ['The morning is bright and the valley is awake.'],
    now: { prose: 'You are standing on the road outside your own door.' },
  })
  return [p.system, ...p.messages.map((m) => m.content)].join('\n')
}

describe('★ the streamed cast and the one-way glass', () => {
  // The full roster, not the mid-run shapes: a cast is an authored surface, so every ordinary
  // word counts too.
  it('every founder assembles a prompt with no construct word in it', () => {
    for (const mind of FOUNDER_MINDS) {
      expect(scanPromptForGlassLeak(promptFor(mind)), `${mind.id} leaks`).toEqual([])
    }
  })

  it('and no layout word either — the second glass', () => {
    for (const mind of FOUNDER_MINDS) {
      const authored = [
        mind.identity.backstory,
        mind.identity.temperament,
        ...mind.identity.voiceCard.exampleLines,
        ...mind.personality.values,
        ...mind.personality.beliefs,
        ...mind.personality.current.goals,
        ...mind.personality.current.worries,
      ].join(' ')
      expect(scanForLayoutLeak(authored), `${mind.id} leaks layout`).toEqual([])
    }
  })

  it('and the scanner it is being held to is the real one — a planted word is caught', () => {
    const planted = {
      ...FOUNDER_MINDS[0]!,
      personality: {
        ...FOUNDER_MINDS[0]!.personality,
        current: { ...FOUNDER_MINDS[0]!.personality.current, goals: ['keep the festival'] },
      },
    }
    expect(scanPromptForGlassLeak(promptFor(planted))).toContain('festival')
    expect(scanForLayoutLeak('a plot on the third ring')).toEqual(['plot', 'ring'])
  })

  it('no goal points a mind at a thing to make — the fixture does not get to instruct', () => {
    // A want with no road measures worse than no want, and a town shipped with one would be
    // measuring its own prompt.
    const POINTING = ['build', 'raise a', 'cut timber', 'deck', 'bridge', 'you should', 'you must']
    for (const mind of FOUNDER_MINDS) {
      const said = [...mind.personality.current.goals, ...mind.personality.current.worries]
        .join(' ')
        .toLowerCase()
      for (const hint of POINTING) {
        expect(said, `${mind.id} is being told what to do: ${hint}`).not.toContain(hint)
      }
    }
  })

  // A literal tic string in a card is the mechanism, and `derivePersona` samples tics without
  // their surroundings, so the bound has to go on the card.
  it('no card demonstrates its own tic in opening position', () => {
    for (const mind of FOUNDER_MINDS) {
      for (const tic of mind.identity.voiceCard.tics) {
        for (const quoted of tic.match(/"([^"]+)"/g) ?? []) {
          const words = quoted.slice(1, -1).toLowerCase()
          for (const line of mind.identity.voiceCard.exampleLines) {
            expect(
              line.toLowerCase().replace(/[^a-z' ]/g, ''),
              `${mind.id}'s card demonstrates ${quoted} as an opener`,
            ).not.toMatch(new RegExp(`^${words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`))
          }
        }
      }
    }
  })

  it('and no card opens two example lines the same way', () => {
    for (const mind of FOUNDER_MINDS) {
      const openers = mind.identity.voiceCard.exampleLines.map((l) =>
        l
          .toLowerCase()
          .replace(/[^a-z' ]/g, '')
          .split(' ')
          .slice(0, 2)
          .join(' '),
      )
      expect(new Set(openers).size, `${mind.id} repeats an opener on its own card`).toBe(
        openers.length,
      )
    }
  })

  it('the cast is the five bodies the town spawns, by id', () => {
    // A mind whose id is not a body in the world gets no perception and never takes a turn;
    // a body with no mind stands still for ever. The two lists are one list or they are broken.
    expect(FOUNDER_MINDS.map((m) => m.id).sort()).toEqual([
      'amara',
      'nadia',
      'omar',
      'salma',
      'yusuf',
    ])
  })
})

// A leak in a backstory or a goal otherwise throws at the first turn of a live run; these rows
// pay that offline. A cast is also where a fixture instructs a mind, which the goal rows hold.
import { describe, expect, it } from 'vitest'
import { assemblePrompt } from '../prompt/assemble.js'
import { RULES_OF_BEING } from '../prompt/rulesOfBeing.js'
import { FOUNDER_IDS, TRAVELLER_IDS, scanForLayoutLeak, scanPromptForGlassLeak } from '@sj/shared'
import { FOUNDER_MINDS } from './founderMinds.js'
import { TRAVELLER_MINDS } from './travellerMinds.js'

// Travellers are held to every rule a founder is: they take turns in the same town.
const CAST = [...FOUNDER_MINDS, ...TRAVELLER_MINDS]

const promptFor = (mind: (typeof FOUNDER_MINDS)[number]): string => {
  const p = assemblePrompt({
    rulesOfBeing: RULES_OF_BEING,
    identity: mind.identity,
    personality: { doc: mind.personality, autobiography: [] },
    journal: [],
    recalled: null,
    scene: { ledgers: [], memories: [] },
    dayLog: ['The morning is bright and the valley is awake.'],
    now: { prose: 'You are standing on the road outside your own door.' },
    underway: null,
  })
  return [p.system, ...p.messages.map((m) => m.content)].join('\n')
}

describe('★ the streamed cast and the one-way glass', () => {
  // The full roster, not the mid-run shapes: a cast is an authored surface, so every ordinary
  // word counts too.
  it('every founder assembles a prompt with no construct word in it', () => {
    for (const mind of CAST) {
      expect(scanPromptForGlassLeak(promptFor(mind)), `${mind.id} leaks`).toEqual([])
    }
  })

  it('and no layout word either — the second glass', () => {
    for (const mind of CAST) {
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
    for (const mind of CAST) {
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
    for (const mind of CAST) {
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
    for (const mind of CAST) {
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

  it('the cast is the twelve bodies the town spawns, by id', () => {
    // A mind whose id is not a body in the world gets no perception and never takes a turn;
    // a body with no mind stands still for ever. The two lists are one list or they are broken.
    expect(FOUNDER_MINDS.map((m) => m.id).sort()).toEqual([...FOUNDER_IDS].sort())
    expect(FOUNDER_MINDS).toHaveLength(12)
  })

  it('no two founders share a first initial, so a viewer can tell them apart by name alone', () => {
    const initials = FOUNDER_MINDS.map((m) => m.identity.name[0]!)
    expect(new Set(initials).size).toBe(initials.length)
  })

  it('every kin tie names a founder and is declared from both sides', () => {
    const byId = new Map(FOUNDER_MINDS.map((m) => [m.id, m]))
    const inverse = { partner: 'partner', parent: 'child', child: 'parent' } as const
    for (const m of FOUNDER_MINDS) {
      for (const k of m.kin ?? []) {
        const other = byId.get(k.id)
        expect(other, `${m.id} names ${k.id}, who is not a founder`).toBeDefined()
        expect(
          other!.kin?.some((x) => x.id === m.id && x.relation === inverse[k.relation]),
          `${k.id} does not name ${m.id} back as ${inverse[k.relation]}`,
        ).toBe(true)
      }
    }
    // The four households the founding is seated by, not a cast of strangers.
    expect(FOUNDER_MINDS.filter((m) => (m.kin ?? []).length > 0)).toHaveLength(7)
  })

  it('every traveller is in the same format, with a reason for coming up the valley road', () => {
    expect(TRAVELLER_MINDS.map((m) => m.id).sort()).toEqual([...TRAVELLER_IDS].sort())
    const initials = [...FOUNDER_MINDS, ...TRAVELLER_MINDS].map((m) => m.identity.name[0]!)
    expect(new Set(initials).size).toBe(initials.length)
    for (const t of TRAVELLER_MINDS) {
      expect(t.arrival.length, `${t.id} has no arrival note`).toBeGreaterThan(20)
      expect(scanPromptForGlassLeak(promptFor(t)), `${t.id} leaks`).toEqual([])
      expect(t.kin ?? []).toEqual([])
    }
  })
})

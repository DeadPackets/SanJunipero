// ★ THE ONE-WAY GLASS, OVER THE CAST THAT IS ABOUT TO BE STREAMED TO STRANGERS.
//
// `assemblePrompt` calls `assertNoGlassLeak` on every prompt it builds, so a leak in a
// backstory or a goal throws at the first turn of a live run — twenty minutes and a few dollars
// after boot, in front of whoever is watching. These rows pay that cost now, offline, for $0.
//
// The second half matters more than the first: a cast is also where a FIXTURE INSTRUCTS A MIND.
// g11's own goals say "cut timber for a deck" and "walk north and look at the narrows"; a run
// on that cast measures the fixture, which is the exact reading error the wants lane found in
// arm B. This cast's goals were neutralised for that reason and the row below is what keeps
// them neutral.
import { describe, expect, it } from 'vitest'
import { assemblePrompt } from '../prompt/assemble.js'
import { RULES_OF_BEING } from '../prompt/rulesOfBeing.js'
import { scanForLayoutLeak, scanPromptForGlassLeak } from '../prompt/glassScan.js'
import { FOUNDER_MINDS } from './founderMinds.js'

const promptFor = (mind: typeof FOUNDER_MINDS[number]): string => {
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
  // ★ THE FULL ROSTER, NOT THE MID-RUN ONE. `assemblePrompt`'s own `assertNoGlassLeak` refuses
  // only ops-key SHAPES mid-run, deliberately: crashing a live town over a word one of its
  // people said is the label harming the world. A cast is an AUTHORED surface — we wrote every
  // byte of it — so it is held to `scanPromptForGlassLeak`, which is every ordinary word too.
  it('every founder assembles a prompt with no construct word in it', () => {
    for (const mind of FOUNDER_MINDS) {
      expect(scanPromptForGlassLeak(promptFor(mind)), `${mind.id} leaks`).toEqual([])
    }
  })

  it('and no layout word either — the second glass', () => {
    for (const mind of FOUNDER_MINDS) {
      const authored = [
        mind.identity.backstory, mind.identity.temperament,
        ...mind.identity.voiceCard.exampleLines,
        ...mind.personality.values, ...mind.personality.beliefs,
        ...mind.personality.current.goals, ...mind.personality.current.worries,
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
    // Not a style rule. The wants lane measured a want with no road as WORSE than no want, and
    // g11's cast carries goals like "cut timber for a deck". A streamed town that shipped those
    // would be measuring its own prompt.
    const POINTING = ['build', 'raise a', 'cut timber', 'deck', 'bridge', 'you should', 'you must']
    for (const mind of FOUNDER_MINDS) {
      const said = [
        ...mind.personality.current.goals,
        ...mind.personality.current.worries,
      ].join(' ').toLowerCase()
      for (const hint of POINTING) {
        expect(said, `${mind.id} is being told what to do: ${hint}`).not.toContain(hint)
      }
    }
  })

  it('the cast is the five bodies the town spawns, by id', () => {
    // A mind whose id is not a body in the world gets no perception and never takes a turn;
    // a body with no mind stands still for ever. The two lists are one list or they are broken.
    expect(FOUNDER_MINDS.map((m) => m.id).sort())
      .toEqual(['amara', 'nadia', 'omar', 'salma', 'yusuf'])
  })
})

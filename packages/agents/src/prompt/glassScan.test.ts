import { describe, expect, it } from 'vitest'
import { MINUTES_PER_DAY, simTimeFromTick } from '@sj/shared'
import { assemblePrompt } from './assemble.js'
import {
  assertQuotedName, CONSTRUCT_VOCABULARY, MID_RUN_ENFORCED, scanForLayoutLeak,
  scanPromptForGlassLeak, TOWN_LAYOUT_VOCABULARY, UNNAMED_CONSTRUCT_COPY,
} from './glassScan.js'
import { makeablesLine, perceptionToProse } from './prose.js'
import { CAPABILITIES, RULES_OF_BEING, SPEECH_RULES } from './rulesOfBeing.js'
import { conversationPacket, fixtureBlocks, quietMeadowPacket } from '../testutil/fixtures.js'

describe('scanPromptForGlassLeak', () => {
  it('flags the taxonomy, whatever case it arrives in', () => {
    expect(scanPromptForGlassLeak('They are gathering for the festival.')).toEqual(['festival'])
    expect(scanPromptForGlassLeak('A Council was called.')).toEqual(['council'])
    expect(scanPromptForGlassLeak('this is a tier 2 milestone')).toEqual(['milestone', 'tier'])
    expect(scanPromptForGlassLeak('the construct was recognized')).toEqual(['construct'])
    expect(scanPromptForGlassLeak('first_bridge fired today')).toEqual(['first_bridge'])
  })

  it('leaves the world alone — a real object is not a label', () => {
    expect(scanPromptForGlassLeak('You stand beside the fire pit at (3, 4).')).toEqual([])
    expect(scanPromptForGlassLeak('Rahel gave you two hides. You are the first here.')).toEqual([])
    expect(scanPromptForGlassLeak('He told a joke, and then he lied about the fish.')).toEqual([])
  })

  it('names every offending term once, in order, and nothing else', () => {
    expect(scanPromptForGlassLeak('festival, festival, market')).toEqual(['festival', 'market'])
    expect(CONSTRUCT_VOCABULARY).toContain('festival')
    expect(CONSTRUCT_VOCABULARY).toContain('custom')
    expect(CONSTRUCT_VOCABULARY).toContain('milestone')
  })
})

describe('the prompt surfaces are clean', () => {
  it('block 1 — rules of being, capabilities and speech rules', () => {
    for (const block of [RULES_OF_BEING, CAPABILITIES, SPEECH_RULES]) {
      expect(scanPromptForGlassLeak(block)).toEqual([])
    }
  })

  it('the moment prose, including the calendar line', () => {
    expect(scanPromptForGlassLeak(perceptionToProse(quietMeadowPacket))).toEqual([])
    expect(scanPromptForGlassLeak(perceptionToProse(conversationPacket))).toEqual([])
  })

  it('the four words the world also owns are scanned, but never crash a living town', () => {
    // A market district, a council of neighbours, faith, a custom: all real. The scan reports
    // them for the authored surfaces the gate reads; assembly refuses only ops-only words.
    for (const word of ['faith', 'council', 'market', 'custom']) {
      expect(scanPromptForGlassLeak(`They spoke of the ${word}.`)).toEqual([word])
      expect(() => assemblePrompt(fixtureBlocks({ now: { prose: `They spoke of the ${word}.` } })))
        .not.toThrow()
    }
  })

  it('every prompt assembled across two scripted days', () => {
    for (let day = 0; day < 2; day++) {
      for (const hour of [7, 12, 19, 23]) {
        const prose = perceptionToProse({
          ...quietMeadowPacket, time: simTimeFromTick(day * MINUTES_PER_DAY + hour * 60),
        })
        const a = assemblePrompt(fixtureBlocks({ now: { prose } }))
        expect(scanPromptForGlassLeak(`${a.system}\n${a.messages.map((m) => m.content).join('\n')}`)).toEqual([])
      }
    }
  })

  it('assemblePrompt itself refuses to hand over a leaking prompt', () => {
    expect(() => assemblePrompt(fixtureBlocks({ now: { prose: 'The god_afterlife row was written.' } })))
      .toThrow(/god_afterlife/)
  })
})

describe('★ an ordinary English word must never kill a mind\'s day', () => {
  // G9b, two sim-days: ten consecutive `turn_crash`es, one mind, every one of them
  // `one-way glass leak in assemblePrompt: milestone`, ending at the day roll. The word
  // was in no store and nothing authored — the compaction summariser wrote it into that
  // mind's own append-only day log, and every remaining turn of the day threw pre-flight.
  const ordinaryPhrases: Record<string, string> = {
    milestone: 'Your mind wanders back over the day: finishing the roof felt like a milestone.',
    milestones: 'Your mind wanders back over the day: the milestones of a long summer.',
    tier: 'Nadia stacked the baskets, the small ones on the upper tier.',
    tiers: 'The riverbank falls away in tiers down to the water.',
    construct: 'Omar means to construct a rail along the deck.',
    constructs: 'He constructs a frame from the planks he cut.',
    festival: 'They spoke of holding a festival when the harvest is in.',
    faith: 'She kept faith with him through the whole cold week.',
    council: 'The neighbours held a council by the well.',
    market: 'I carried the hides down to the market.',
    custom: 'It is the custom here to eat after dark.',
  }

  it('the compacted day log may say milestone, tier or construct', () => {
    for (const [word, prose] of Object.entries(ordinaryPhrases)) {
      expect(() => assemblePrompt(fixtureBlocks({ dayLog: [prose] })), word).not.toThrow()
    }
  })

  it('and so may another mouth, and the mind\'s own remembered words', () => {
    for (const [word, prose] of Object.entries(ordinaryPhrases)) {
      expect(() => assemblePrompt(fixtureBlocks({ now: { prose } })), word).not.toThrow()
      expect(() => assemblePrompt(fixtureBlocks({
        scene: { ledgers: [{ name: 'Nadia', doc: prose }], memories: [] },
      })), word).not.toThrow()
    }
  })

  it('★ every word assembly still enforces mid-run is a key no person writes', () => {
    // The class fix, stated as the rule rather than as an exception roster: a term is
    // refused mid-run only if it is unspellable as ordinary English — an ops key with an
    // underscore (`god_afterlife`, `first_bridge`) or an ops phrase (`semantic first`).
    // Hand an ordinary word back into the enforced set and this reds on that word.
    expect(MID_RUN_ENFORCED.length).toBeGreaterThan(0)
    for (const term of MID_RUN_ENFORCED) {
      expect(/[_ ]/.test(term), `${term} is ordinary English and must not crash a live town`).toBe(true)
    }
  })

  it('★ and the split is not vacuous — the ops keys still throw', () => {
    for (const term of MID_RUN_ENFORCED) {
      expect(() => assemblePrompt(fixtureBlocks({ dayLog: [`The ${term} row was written.`] })), term)
        .toThrow(new RegExp(term))
    }
    // The shape ban still bites on a kind invented after this file was written.
    expect(() => assemblePrompt(fixtureBlocks({ dayLog: ['first_lantern fired today.'] })))
      .toThrow(/first_lantern/)
  })

  it('★ every word on the list is still caught on an authored surface', () => {
    // Nothing left the scan — only the mid-run throw narrowed. Named rather than iterated,
    // because iterating the list makes deleting a word from it pass this test vacuously.
    for (const term of Object.keys(ordinaryPhrases)) {
      expect(CONSTRUCT_VOCABULARY, term).toContain(term)
      expect(scanPromptForGlassLeak(`the ${term} row`), term).toContain(term)
    }
    expect(CONSTRUCT_VOCABULARY.length).toBe(Object.keys(ordinaryPhrases).length + MID_RUN_ENFORCED.length)
  })
})

describe('the naming law', () => {
  const said = { sourceKind: 'speech' as const, text: 'We call it the Long Turning.', eventSeq: 41, byId: 'bex' }
  const carved = { sourceKind: 'inscription' as const, text: 'THE LONG TURNING — every seventh night', eventSeq: 44, byId: 'ada' }

  it('accepts a name only when a mouth or a wall said it verbatim', () => {
    expect(assertQuotedName('Long Turning', [said])).toEqual({
      name: 'Long Turning', sourceKind: 'speech', eventSeq: 41, quote: said.text, byId: 'bex',
    })
    expect(assertQuotedName('THE LONG TURNING', [carved])).toEqual({
      name: 'THE LONG TURNING', sourceKind: 'inscription', eventSeq: 44, quote: carved.text, byId: 'ada',
    })
  })

  it('rejects a name nobody said, however close it is', () => {
    expect(assertQuotedName('The Long Turn', [said])).toBeNull()
    expect(assertQuotedName('long turning', [said])).toBeNull()
    expect(assertQuotedName('Long Turning', [])).toBeNull()
  })

  it('★ the layout vocabulary reaches no authored surface a mind reads', () => {
    for (const block of [RULES_OF_BEING, CAPABILITIES, SPEECH_RULES]) {
      expect(scanForLayoutLeak(block)).toEqual([])
    }
    expect(scanForLayoutLeak(perceptionToProse(quietMeadowPacket))).toEqual([])
    expect(scanForLayoutLeak(perceptionToProse(conversationPacket))).toEqual([])
    // The one line that DOES say something about the layout says only a place.
    const line = makeablesLine(
      { builds: [{ kind: 'house', inputs: { wood: 10 } }], crafts: [] }, { x: 67, y: 94 })
    expect(line).toContain('The town keeps ground for a new roof at (67, 94)')
    expect(scanForLayoutLeak(line)).toEqual([])
    expect(scanPromptForGlassLeak(line)).toEqual([])
    // And it says nothing at all when there is nowhere left, rather than an empty phrase.
    expect(makeablesLine({ builds: [{ kind: 'house', inputs: { wood: 10 } }], crafts: [] }, null))
      .not.toContain('keeps ground')
    expect(makeablesLine({ builds: [{ kind: 'house', inputs: { wood: 10 } }], crafts: [] }))
      .not.toContain('keeps ground')
  })

  it('★ and the scan is not vacuous: it catches every one of our own words for the grammar', () => {
    for (const word of TOWN_LAYOUT_VOCABULARY) {
      expect(scanForLayoutLeak(`Stand on the ${word} by the road.`), word).toContain(word)
    }
    // A sentence that leaks the rule rather than the place is exactly what this refuses.
    expect(scanForLayoutLeak('The next ring of blocks will be platted when this one fills.'))
      .toEqual(['blocks', 'ring', 'platted'])
  })

  it('has one copy for the unnamed case, and it is not a label', () => {
    expect(UNNAMED_CONSTRUCT_COPY).toBe('a gathering not yet named')
    expect(scanPromptForGlassLeak(UNNAMED_CONSTRUCT_COPY)).toEqual([])
  })
})

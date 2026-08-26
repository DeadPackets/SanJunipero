import { describe, expect, it } from 'vitest'
import { MINUTES_PER_DAY, simTimeFromTick } from '@sj/shared'
import { assemblePrompt } from './assemble.js'
import {
  assertQuotedName, CONSTRUCT_VOCABULARY, MID_RUN_ENFORCED, scanForLayoutLeak,
  scanPromptForGlassLeak, scanRulingForGlassLeak, TOWN_LAYOUT_VOCABULARY, UNNAMED_CONSTRUCT_COPY,
} from './glassScan.js'
import { makeablesLine, perceptionToProse } from './prose.js'
import { CAPABILITIES, RULES_OF_BEING, SPEECH_RULES } from './rulesOfBeing.js'
import { conversationPacket, fixtureBlocks, quietMeadowPacket } from '../testutil/fixtures.js'
// The constants themselves, not copies of them: a test that retypes the string it guards stops
// guarding the day somebody edits the source and not the test.
import { CRAFT_HINT, REPEATED_REFUSAL } from '../runtime/agentRuntime.js'

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

describe('★ a ruling is our machinery writing into a mind, not a person speaking', () => {
  // `refusalMemoryText` writes an arbiter's `impossible.reason` verbatim into a mind's memory,
  // and the next prompt reads it back. It is the one mind-facing string in the system authored
  // in the voice of something that knows the rules, which is exactly where our vocabulary
  // leaks. Mid-run enforcement spares the five ambiguous words to keep a live town from dying
  // over something one of its PEOPLE said; there is no person to protect in a ruling.
  it('catches all five words the town is being watched to reach on its own', () => {
    for (const word of ['festival', 'faith', 'council', 'market', 'custom']) {
      expect(scanRulingForGlassLeak(`the ${word} has no place for this`), word).toContain(word)
    }
  })

  it('catches our jargon and an ops key, exactly as the authored scan does', () => {
    expect(scanRulingForGlassLeak('that construct is a milestone')).toEqual(
      expect.arrayContaining(['construct', 'milestone']))
    expect(scanRulingForGlassLeak('first_bridge was already recorded')).toContain('first_bridge')
  })

  it('catches a directive — a refusal that hands over the next step', () => {
    // A refusal answers what was asked. One that also says what to do next has given the mind
    // a path it did not reach on its own. `CRAFT_HINT` is the single sanctioned door and it is
    // authored, rendered at prose time, and never written back into a stored ruling.
    for (const line of [
      'you should ask someone who knows the craft',
      'you must gather stone before this can begin',
      'you ought to wait for the water to fall',
      'you need to find a sharper edge',
      'nothing comes of it; instead, try the shallows',
      'there is no way through here — go inside and wait',
    ]) {
      expect(scanRulingForGlassLeak(line), line).not.toEqual([])
    }
  })

  it('★ and it is not vacuous: an honest refusal passes untouched', () => {
    // Every reason the arbiter can actually return today, plus the two strings the intents lane
    // added. If the guard reddens any of these it is banning the arbiter from refusing at all,
    // which is worse than the leak.
    for (const reason of [
      'nothing in the town lends itself to this',
      'no clear way to do this presents itself',
      'this would need a craft the town has not yet reached',
      'the river runs too fast here to stand in',
      // ★ THE WIDER FALLBACK, and the loop-breaker. Both are mind-facing and both are ours.
      'you turn it over and it will not come together as it stands',
      REPEATED_REFUSAL,
      CRAFT_HINT,
    ]) {
      expect(scanRulingForGlassLeak(reason), reason).toEqual([])
    }
  })

  // ★ THE FOURTH SHAPE — a refusal that names the missing thing has handed over the answer.
  it('★ catches a refusal that names the solution as an absence', () => {
    // The exact sentence the brief names as the thing that must never be written, plus the
    // shapes around it. None of these contains an ops word or a `you should`, which is why the
    // scan as it stood waved every one of them through.
    for (const line of [
      'you cannot smoke fish without a rack',
      'this will not hold unless you have a length of cord',
      'nothing comes of it until you find a sharper stone',
      'the fire will not take for lack of dry wood',
      'there is no edge to cut it with',
      // ★ VERBATIM FROM A LIVE RULING, intents lane A/B run. `without one` is the same
      // conditional as `without a rack` and the first draft of this pattern missed it by a
      // word. A leak found in the wild outranks a leak I invented.
      'The town lacks a marker, and the action cannot even be started without one.',
    ]) {
      expect(scanRulingForGlassLeak(line), line).not.toEqual([])
    }
  })

  it('★ and the fourth shape is not vacuous: a bare ABSENCE is a fact, not a recipe', () => {
    // ★ THE LINE IS THE CONDITIONAL, NOT THE NOUN, and a red test is what found it. The first
    // draft of the pattern also caught `you have no` and immediately reddened a shipped arbiter
    // fixture — `You have no reeds here.` on an `insufficient_materials` verdict. That sentence
    // states a fact the mind's own perception block already lists verbatim, and it connects
    // that fact to no method. `without a rack` is the other thing: smoking REQUIRES a rack, a
    // recipe fragment in a refusal.
    //
    // If this row ever reds, the guard has started refusing the arbiter the right to refuse.
    for (const line of [
      'this would need a craft the town has not yet reached',
      'there is no ground here to build on',
      'the water is too deep here',
      'you turn it over and it will not come together as it stands',
      'You have no reeds here.',
      'nothing you are carrying answers to this',
    ]) {
      expect(scanRulingForGlassLeak(line), line).toEqual([])
    }
  })

  it('★ and it does not ban a verb the mind was already taught by name', () => {
    // `CAPABILITIES` teaches `build`, `enter` and `craft` to every mind in block 1, by name.
    // A refusal using one reveals nothing a mind does not already hold, and forbidding them
    // would leave the arbiter no vocabulary to answer in. The DIRECTIVE is the leak, not the
    // verb: the first line here stays clean and the second does not.
    expect(scanRulingForGlassLeak('there is no ground here to build on')).toEqual([])
    expect(scanRulingForGlassLeak('you should build it by the river')).not.toEqual([])
    for (const verb of ['build', 'enter', 'craft', 'stoke', 'inscribe']) {
      expect(CAPABILITIES, verb).toContain(`${verb}: name it ${verb}`)
    }
  })

  it('★ the ruling scan is strictly stronger than the authored-surface scan', () => {
    // Stated as a property so a word added to CONSTRUCT_VOCABULARY is covered the day it
    // lands, rather than the day somebody remembers to extend this file.
    for (const term of CONSTRUCT_VOCABULARY) {
      const text = `the ${term} row`
      expect(scanRulingForGlassLeak(text), term).toEqual(
        expect.arrayContaining(scanPromptForGlassLeak(text)))
    }
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

import { describe, expect, it } from 'vitest'
import {
  MINUTES_PER_DAY,
  assertNoGlassLeak,
  assertQuotedName,
  simTimeFromTick,
  CONSTRUCT_VOCABULARY,
  MID_RUN_ENFORCED,
  scanForLayoutLeak,
  scanPromptForGlassLeak,
  scanRulingForGlassLeak,
  TOWN_LAYOUT_VOCABULARY,
  UNNAMED_CONSTRUCT_COPY,
} from '@sj/shared'
import { assemblePrompt } from './assemble.js'
import { makeablesLine, perceptionToProse } from './prose.js'
import { CAPABILITIES, RULES_OF_BEING, SPEECH_RULES } from './rulesOfBeing.js'
import { conversationPacket, fixtureBlocks, quietMeadowPacket } from '../testutil/fixtures.js'
// The constants themselves, not copies of them: a test that retypes the string it guards stops
// guarding the day somebody edits the source and not the test.
import { CANNOT_BEGIN, CRAFT_HINT, OPAQUE_REFUSAL } from '../runtime/agentRuntime.js'

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
    // them for the authored surfaces the gate reads; the mid-run gate cuts only ops-only words.
    for (const word of ['faith', 'council', 'market', 'custom']) {
      const said = `They spoke of the ${word}.`
      expect(scanPromptForGlassLeak(said)).toEqual([word])
      expect(assertNoGlassLeak(said, 'turn'), word).toBe(said)
    }
  })

  it('every prompt assembled across two scripted days', () => {
    for (let day = 0; day < 2; day++) {
      for (const hour of [7, 12, 19, 23]) {
        const prose = perceptionToProse({
          ...quietMeadowPacket,
          time: simTimeFromTick(day * MINUTES_PER_DAY + hour * 60),
        })
        const a = assemblePrompt(fixtureBlocks({ now: { prose } }))
        expect(
          scanPromptForGlassLeak(`${a.system}\n${a.messages.map((m) => m.content).join('\n')}`),
        ).toEqual([])
      }
    }
  })

  it('the line a mind is handed while something is already underway', () => {
    const a = assemblePrompt(fixtureBlocks({ underway: { what: 'walk 62 70', step: 2, of: 4 } }))
    expect(scanPromptForGlassLeak(a.messages.map((m) => m.content).join('\n'))).toEqual([])
  })

  it('★ the gate cuts the leaked span out and hands the rest over — the turn continues', () => {
    const leaks: string[][] = []
    expect(
      assertNoGlassLeak('The god_afterlife row was written.', 'turn', (l) => leaks.push([...l])),
    ).toBe('The [redacted] row was written.')
    expect(leaks).toEqual([['god_afterlife']])
  })
})

describe("★ an ordinary English word must never kill a mind's day", () => {
  // A mind's own day log carries ordinary English back into the prompt, so an ordinary word in
  // the enforced set crashes every remaining turn of its day.
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

  it('the compacted day log may say milestone, tier or construct, byte for byte', () => {
    for (const [word, prose] of Object.entries(ordinaryPhrases)) {
      const a = assemblePrompt(fixtureBlocks({ dayLog: [prose] }))
      expect(a.messages[0]!.content, word).toBe(prose)
      expect(assertNoGlassLeak(prose, 'turn'), word).toBe(prose)
    }
  })

  it('★ every word assembly still enforces mid-run is a key no person writes', () => {
    // The rule, not an exception roster: refused mid-run only if it is unspellable as ordinary
    // English — an underscored ops key, or a two-word ops phrase.
    expect(MID_RUN_ENFORCED.length).toBeGreaterThan(0)
    for (const term of MID_RUN_ENFORCED) {
      expect(/[_ ]/.test(term), `${term} is ordinary English and must not crash a live town`).toBe(
        true,
      )
    }
  })

  it('★ and the split is not vacuous — the ops keys are still cut out and reported', () => {
    for (const term of [...MID_RUN_ENFORCED, 'first_lantern']) {
      const leaks: string[][] = []
      const sealed = assertNoGlassLeak(`The ${term} row was written.`, 'turn', (l) =>
        leaks.push([...l]),
      )
      expect(sealed, term).toBe('The [redacted] row was written.')
      expect(leaks, term).toEqual([[term]])
    }
  })

  it('★ every word on the list is still caught on an authored surface', () => {
    // Nothing left the scan — only the mid-run gate is narrower. Named rather than iterated,
    // because iterating the list makes deleting a word from it pass this test vacuously.
    for (const term of Object.keys(ordinaryPhrases)) {
      expect(CONSTRUCT_VOCABULARY, term).toContain(term)
      expect(scanPromptForGlassLeak(`the ${term} row`), term).toContain(term)
    }
    expect(CONSTRUCT_VOCABULARY.length).toBe(
      Object.keys(ordinaryPhrases).length + MID_RUN_ENFORCED.length,
    )
  })
})

describe('★ a ruling is our machinery writing into a mind, not a person speaking', () => {
  // `refusalMemoryText` writes an `impossible.reason` verbatim into the next prompt, and there
  // is no person to protect in a ruling, so the full roster applies here and not mid-run.
  it('catches all five words the town is being watched to reach on its own', () => {
    for (const word of ['festival', 'faith', 'council', 'market', 'custom']) {
      expect(scanRulingForGlassLeak(`the ${word} has no place for this`), word).toContain(word)
    }
  })

  it('catches our jargon and an ops key, exactly as the authored scan does', () => {
    expect(scanRulingForGlassLeak('that construct is a milestone')).toEqual(
      expect.arrayContaining(['construct', 'milestone']),
    )
    expect(scanRulingForGlassLeak('first_bridge was already recorded')).toContain('first_bridge')
  })

  it('catches a directive — a refusal that hands over the next step', () => {
    // `CRAFT_HINT` is the single sanctioned door, and it is never written back into a ruling.
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
    // If the guard reddens any of these it is banning the arbiter from refusing at all.
    for (const reason of [
      'nothing in the town lends itself to this',
      'no clear way to do this presents itself',
      'this would need a craft the town has not yet reached',
      'the river runs too fast here to stand in',
      // ★ THE WIDER FALLBACK, and the loop-breaker. Both are mind-facing and both are ours.
      'you turn it over and it will not come together as it stands',
      CANNOT_BEGIN,
      CRAFT_HINT,
      OPAQUE_REFUSAL,
    ]) {
      expect(scanRulingForGlassLeak(reason), reason).toEqual([])
    }
  })

  // ★ THE FOURTH SHAPE — a refusal that names the missing thing has handed over the answer.
  it('★ catches a refusal that names the solution as an absence', () => {
    // None of these contains an ops word or a `you should`, which is why a narrower scan
    // waved them all through.
    for (const line of [
      'you cannot smoke fish without a rack',
      'this will not hold unless you have a length of cord',
      'nothing comes of it until you find a sharper stone',
      'the fire will not take for lack of dry wood',
      'there is no edge to cut it with',
      // Verbatim from a live ruling: `without one` is the same conditional as `without a rack`.
      'The town lacks a marker, and the action cannot even be started without one.',
      // Live, mind-facing: "The action requires 'green wood' as a resource…".
      'this requires a sharpened axe you do not carry',
      'digging that requires an iron shovel',
      // The same recipe told forward instead of backward.
      'she can attempt this once she has a sharper stone',
      'nothing comes of it once you have a length of cord',
    ]) {
      expect(scanRulingForGlassLeak(line), line).not.toEqual([])
    }
  })

  it('★ and the fourth shape is not vacuous: a bare ABSENCE is a fact, not a recipe', () => {
    // The line is the conditional, not the noun: `You have no reeds here.` states a fact and
    // connects it to no method, where `without a rack` says smoking REQUIRES one.
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

  // ★ The conditional is a recipe only when the thing it names is one the town has no word
  // for. Told the town's materials, the scan tells a fact about a known thing from a hint.
  it('★ a conditional naming a KNOWN material is a fact; an unknown one is still a recipe', () => {
    const vocabulary = { itemKinds: ['wood', 'stone', 'axe', 'cord'], structureKinds: ['hearth'] }
    for (const line of [
      'this requires a sharpened axe you do not carry',
      'this will not hold unless you have a length of cord',
      'nothing comes of it once she has a sharper stone',
      'it will not stand without a hearth',
    ]) {
      expect(scanRulingForGlassLeak(line, vocabulary), line).toEqual([])
    }
    for (const line of [
      'you cannot smoke fish without a rack',
      'this requires a bellows you do not carry',
      'nothing comes of it until you find a crucible',
    ]) {
      expect(scanRulingForGlassLeak(line, vocabulary), line).not.toEqual([])
    }
    // ANTI-VACUITY: told nothing, the scan refuses all of them exactly as it did before.
    for (const line of [
      'this requires a sharpened axe you do not carry',
      'it will not stand without a hearth',
    ]) {
      expect(scanRulingForGlassLeak(line), line).not.toEqual([])
    }
    // And a vocabulary never excuses an ops word or a directive.
    expect(scanRulingForGlassLeak('you should build it without a hearth', vocabulary)).toContain(
      'you should',
    )
    expect(scanRulingForGlassLeak('the festival needs no axe', vocabulary)).toContain('festival')
  })

  it('★ and it does not ban a verb the mind was already taught by name', () => {
    // Block 1 teaches these verbs to every mind by name, so the directive is the leak and never
    // the verb; forbidding them would leave the arbiter no vocabulary to refuse in.
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
        expect.arrayContaining(scanPromptForGlassLeak(text)),
      )
    }
  })
})

describe('the naming law', () => {
  const said = {
    sourceKind: 'speech' as const,
    text: 'We call it the Long Turning.',
    eventSeq: 41,
    byId: 'bex',
  }
  const carved = {
    sourceKind: 'inscription' as const,
    text: 'THE LONG TURNING — every seventh night',
    eventSeq: 44,
    byId: 'ada',
  }

  it('accepts a name only when a mouth or a wall said it verbatim', () => {
    expect(assertQuotedName('Long Turning', [said])).toEqual({
      name: 'Long Turning',
      sourceKind: 'speech',
      eventSeq: 41,
      quote: said.text,
      byId: 'bex',
    })
    expect(assertQuotedName('THE LONG TURNING', [carved])).toEqual({
      name: 'THE LONG TURNING',
      sourceKind: 'inscription',
      eventSeq: 44,
      quote: carved.text,
      byId: 'ada',
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
      { builds: [{ kind: 'house', inputs: { wood: 10 } }], crafts: [] },
      { x: 67, y: 94 },
    )
    expect(line).toContain('The town keeps ground for a new roof at (67, 94)')
    expect(scanForLayoutLeak(line)).toEqual([])
    expect(scanPromptForGlassLeak(line)).toEqual([])
    // And it says nothing at all when there is nowhere left, rather than an empty phrase.
    expect(
      makeablesLine({ builds: [{ kind: 'house', inputs: { wood: 10 } }], crafts: [] }, null),
    ).not.toContain('keeps ground')
    expect(
      makeablesLine({ builds: [{ kind: 'house', inputs: { wood: 10 } }], crafts: [] }),
    ).not.toContain('keeps ground')
  })

  it('★ and the scan is not vacuous: it catches every one of our own words for the grammar', () => {
    for (const word of TOWN_LAYOUT_VOCABULARY) {
      expect(scanForLayoutLeak(`Stand on the ${word} by the road.`), word).toContain(word)
    }
    // A sentence that leaks the rule rather than the place is exactly what this refuses.
    expect(
      scanForLayoutLeak('The next ring of blocks will be platted when this one fills.'),
    ).toEqual(['blocks', 'ring', 'platted'])
  })

  it('has one copy for the unnamed case, and it is not a label', () => {
    expect(UNNAMED_CONSTRUCT_COPY).toBe('a gathering not yet named')
    expect(scanPromptForGlassLeak(UNNAMED_CONSTRUCT_COPY)).toEqual([])
  })
})

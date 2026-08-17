import { describe, expect, it } from 'vitest'
import { MINUTES_PER_DAY, simTimeFromTick } from '@sj/shared'
import { assemblePrompt } from './assemble.js'
import {
  assertQuotedName, CONSTRUCT_VOCABULARY, scanPromptForGlassLeak, UNNAMED_CONSTRUCT_COPY,
} from './glassScan.js'
import { perceptionToProse } from './prose.js'
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
    expect(() => assemblePrompt(fixtureBlocks({ now: { prose: 'The festival begins.' } })))
      .toThrow(/festival/)
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

  it('has one copy for the unnamed case, and it is not a label', () => {
    expect(UNNAMED_CONSTRUCT_COPY).toBe('a gathering not yet named')
    expect(scanPromptForGlassLeak(UNNAMED_CONSTRUCT_COPY)).toEqual([])
  })
})

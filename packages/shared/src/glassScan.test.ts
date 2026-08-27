import { describe, expect, it } from 'vitest'
import { CONSTRUCT_VOCABULARY, scanForDirective, scanPromptForGlassLeak } from './glassScan.js'

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

  // ★ A live payload spelled `festival` with a zero-width space and a mind said the word back.
  // The scan saw nothing, so a whispered-to town was indistinguishable from a clean one.
  it('★ reads a word a payload broke with an invisible character', () => {
    expect(scanPromptForGlassLeak('they are gathering for the fes​tival')).toEqual(['festival'])
    expect(scanPromptForGlassLeak('the mar‌ket opens')).toEqual(['market'])
    expect(scanPromptForGlassLeak('a coun­cil was called')).toEqual(['council'])
    expect(scanPromptForGlassLeak('first⁠_bridge fired')).toEqual(['first_bridge'])
  })

  it('★ and a word spelled in a lookalike alphabet', () => {
    // Cyrillic е/с/о/а and Greek ο read as Latin to every eye that matters.
    expect(scanPromptForGlassLeak('the fеstival')).toEqual(['festival'])
    expect(scanPromptForGlassLeak('the сouncil sat')).toEqual(['council'])
    expect(scanPromptForGlassLeak('a custοm of theirs')).toEqual(['custom'])
    expect(scanPromptForGlassLeak('the mаrket')).toEqual(['market'])
    // Fullwidth and a decomposed accent are the same trick by another route.
    expect(scanPromptForGlassLeak('the ｆestival')).toEqual(['festival'])
    expect(scanPromptForGlassLeak('the féstival')).toEqual(['festival'])
  })

  it('★ ANTI-VACUITY: folding invents no leak in ordinary prose', () => {
    expect(scanPromptForGlassLeak('You stand beside the fire pit at (3, 4).')).toEqual([])
    expect(scanPromptForGlassLeak('Rahel gave you two hides. You are the first here.')).toEqual([])
    expect(scanPromptForGlassLeak('He told a joke, and then he lied about the fish.')).toEqual([])
    expect(scanPromptForGlassLeak('Nadia said “Good to see you.” — she meant it.')).toEqual([])
  })
})

describe('the counsel a perception sentence may not hand over', () => {
  it('★ names a planted remedy, and leaves a fact about now alone', () => {
    expect(scanForDirective('You should go inside before the cold.')).toEqual([
      'you should',
      'go inside',
    ])
    expect(scanForDirective('Go and find Amara, you must hurry.')).toEqual(['go and', 'you must'])
    expect(scanForDirective('Its walls are three quarters up.')).toEqual([])
  })
})

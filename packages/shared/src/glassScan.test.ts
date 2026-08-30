import { describe, expect, it } from 'vitest'
import {
  CONSTRUCT_VOCABULARY,
  assertNoGlassLeak,
  scanForDirective,
  scanPromptForGlassLeak,
} from './glassScan.js'

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

// ★ Ruling 11 (2026-08-30). The gate used to throw in dev and return silently under
// `NODE_ENV=production`, which `Dockerfile:18` sets — so the single runtime enforcement point of
// a binding invariant did nothing in every shipped container.
describe('★ the mid-run gate: always scan, cut the span out, tell the ops plane', () => {
  const sealed = (text: string): { text: string; leaks: string[][] } => {
    const leaks: string[][] = []
    return { text: assertNoGlassLeak(text, 'turn', (l) => leaks.push([...l])), leaks }
  }

  it('cuts the leaked span out and reports it, leaving the rest of the sentence alone', () => {
    expect(sealed('The god_afterlife row was written.')).toEqual({
      text: 'The [redacted] row was written.',
      leaks: [['god_afterlife']],
    })
    expect(sealed('first_bridge fired, and so did first_roof.')).toEqual({
      text: '[redacted] fired, and so did [redacted].',
      leaks: [['first_bridge', 'first_roof']],
    })
  })

  it('leaves clean text byte-for-byte alone, and says nothing at all', () => {
    for (const text of [
      'The neighbours held a council by the well.',
      'It is day 3, dusk, early winter.',
      '',
    ]) {
      expect(sealed(text), text).toEqual({ text, leaks: [] })
    }
  })

  it('★ behaves identically under NODE_ENV=production — the shipped container is the run', () => {
    const before = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      expect(sealed('The god_afterlife row was written.')).toEqual({
        text: 'The [redacted] row was written.',
        leaks: [['god_afterlife']],
      })
      expect(sealed('The neighbours held a council.').text).toBe('The neighbours held a council.')
    } finally {
      if (before === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = before
    }
  })

  it('★ cuts a span the payload spelled with an invisible character or a lookalike letter', () => {
    // The fold reads it as the word; the cut has to land on the bytes the mind would have read.
    expect(sealed('The god_after\u200blife row was written.').text).toBe(
      'The [redacted] row was written.',
    )
    expect(sealed('The gоd_afterlife row was written.').text).toBe(
      'The [redacted] row was written.',
    )
  })

  it('never throws — a false positive may not take a live town down', () => {
    expect(() => assertNoGlassLeak('The god_afterlife row was written.', 'turn')).not.toThrow()
  })
})

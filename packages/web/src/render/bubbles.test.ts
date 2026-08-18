import { describe, expect, it } from 'vitest'
import {
  BUBBLE_FONT_PX, BUBBLE_MAX_PX, SPEECH_MAX_CHARS, SPEECH_MS_BASE, SPEECH_MS_PER_CHAR,
  WRAP_CHARS, bubbleLife, wrapBubble,
} from './bubbles.js'
import { faceFor, wrapCharsFor } from './textFaces.js'

describe('bubbleLife', () => {
  it('is base plus per-char for short text', () => {
    expect(bubbleLife('hi')).toBe(SPEECH_MS_BASE + SPEECH_MS_PER_CHAR * 2)
  })
  it('clamps at SPEECH_MAX_CHARS', () => {
    expect(bubbleLife('x'.repeat(500))).toBe(SPEECH_MS_BASE + SPEECH_MS_PER_CHAR * SPEECH_MAX_CHARS)
  })
})

describe('wrapBubble', () => {
  it('breaks on word boundaries at 24 chars', () => {
    const lines = wrapBubble('the fish are biting well this morning by the river', 24)
    expect(lines).toEqual(['the fish are biting well', 'this morning by the', 'river'])
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(24)
  })
  it('never emits an empty line', () => {
    expect(wrapBubble('')).toEqual([])
    expect(wrapBubble('   ')).toEqual([])
    for (const l of wrapBubble('a '.repeat(60))) expect(l.length).toBeGreaterThan(0)
  })
  it('hard-splits a single overlong word rather than overflowing', () => {
    const lines = wrapBubble('a'.repeat(50), 24)
    expect(lines.every((l) => l.length <= 24)).toBe(true)
    expect(lines.join('')).toBe('a'.repeat(50))
  })

  // U18: the wrap was a hardcoded 24, which is only right for one face at one size. It comes
  // from the face's own advance now, so installing a wider face narrows the line instead of
  // overflowing the box.
  it('takes its default from the face the bubble is set in', () => {
    const face = faceFor('speech')
    expect(WRAP_CHARS).toBe(wrapCharsFor(face.family, BUBBLE_FONT_PX, BUBBLE_MAX_PX))
    expect(WRAP_CHARS * BUBBLE_FONT_PX).toBeLessThanOrEqual(BUBBLE_MAX_PX)
  })

  it('keeps every default-wrapped line inside the box the bubble is allowed', () => {
    for (const l of wrapBubble('the fish are biting well this morning by the river')) {
      expect(l.length).toBeLessThanOrEqual(WRAP_CHARS)
    }
  })
})

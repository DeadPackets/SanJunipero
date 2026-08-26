import { describe, expect, it } from 'vitest'
import {
  BUBBLE_FONT_PX, BUBBLE_MAX_PX, SPEECH_MAX_CHARS, SPEECH_MS_BASE, SPEECH_MS_PER_CHAR,
  WRAP_CHARS, bubbleLife, placeBubbles, wrapBubble,
} from './bubbles.js'
import { SCALLOP_COUNT, faceFor, scallopTrail, wrapCharsFor } from './textFaces.js'
import type { Rect } from './tooltip.js'

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

describe('two speakers standing together do not composite into one pile', () => {
  const overlaps = (a: Rect, b: Rect): boolean =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

  it('separates three bubbles asking for the same head', () => {
    const view = { x: 0, y: 0, w: 900, h: 700 }
    const size = { w: 180, h: 60 }
    const placed = placeBubbles(
      [0, 1, 2].map((i) => ({ id: `b${i}`, sx: 450, sy: 350, size })), view,
    )
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        expect(overlaps(placed[i]!.rect, placed[j]!.rect), `${i} vs ${j}`).toBe(false)
      }
    }
  })

  it('gives each one a side, so the tail keeps pointing at its own speaker', () => {
    const view = { x: 0, y: 0, w: 900, h: 700 }
    for (const p of placeBubbles([{ id: 'a', sx: 10, sy: 690, size: { w: 200, h: 50 } }], view)) {
      expect(['above', 'below', 'left', 'right']).toContain(p.side)
    }
  })

  it('is deterministic — the same speakers place the same way twice', () => {
    const view = { x: 0, y: 0, w: 900, h: 700 }
    const want = [
      { id: 'a', sx: 300, sy: 300, size: { w: 150, h: 40 } },
      { id: 'b', sx: 310, sy: 305, size: { w: 150, h: 40 } },
    ]
    expect(placeBubbles(want, view)).toEqual(placeBubbles(want, view))
  })
})

describe('a thought points at its thinker whichever side it ended up on', () => {
  it('puts the trail on the edge facing the speaker, for all four sides', () => {
    const w = 100, h = 40
    expect(scallopTrail('above', w, h).every((d) => d.cy > h)).toBe(true)
    expect(scallopTrail('below', w, h).every((d) => d.cy < 0)).toBe(true)
    expect(scallopTrail('left', w, h).every((d) => d.cx > w)).toBe(true)
    expect(scallopTrail('right', w, h).every((d) => d.cx < 0)).toBe(true)
  })

  it('shrinks away from the bubble and never draws a zero-radius dot', () => {
    const dots = scallopTrail('above', 100, 40)
    expect(dots).toHaveLength(SCALLOP_COUNT)
    for (const d of dots) expect(d.r).toBeGreaterThanOrEqual(1)
    expect(dots[0]!.r).toBeGreaterThan(dots[dots.length - 1]!.r)
  })
})

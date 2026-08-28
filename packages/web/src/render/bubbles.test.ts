import { describe, expect, it } from 'vitest'
import {
  BUBBLE_FONT_PX,
  BUBBLE_MAX_LINES,
  BUBBLE_MAX_PX,
  BUBBLE_NEAREST,
  ELLIPSIS,
  GLYPH_ZOOM,
  SPEAKER_TINT,
  SPEECH_MAX_CHARS,
  SPEECH_MS_BASE,
  SPEECH_MS_PER_CHAR,
  WRAP_CHARS,
  bubbleLife,
  bubbleShown,
  dominantColor,
  nearestSpeakers,
  placeBubbles,
  speakerWash,
  wrapBubble,
} from './bubbles.js'
import { SPEECH_FILL, SPEECH_INK, faceFor, wrapCharsFor } from './textFaces.js'
import { bandRatios, over } from './legibility.js'
import { ZOOM_STOPS } from './camera.js'
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
    const lines = wrapBubble('the fish are biting well this morning', 24)
    expect(lines).toEqual(['the fish are biting well', 'this morning'])
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
    expect(lines[0]).toBe('a'.repeat(24))
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

// A bubble that grows to five lines is a paper standing in the street, and it hides the town
// it is spoken over. Two lines, then the reader asks the person.
describe('a bubble stops at two lines and says so', () => {
  it('caps at BUBBLE_MAX_LINES and ends the last one in an ellipsis', () => {
    const lines = wrapBubble('the fish are biting well this morning by the river', 24)
    expect(lines).toHaveLength(BUBBLE_MAX_LINES)
    expect(lines[BUBBLE_MAX_LINES - 1]!.endsWith(ELLIPSIS)).toBe(true)
    expect(lines[0]).toBe('the fish are biting well')
  })

  it('never lets the ellipsis push a line past the wrap width', () => {
    const long = 'aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk llll'
    for (const width of [10, 16, 24, WRAP_CHARS]) {
      for (const l of wrapBubble(long, width))
        expect(l.length, `${width}`).toBeLessThanOrEqual(width)
    }
  })

  it('leaves a short line alone — no ellipsis on text that fits', () => {
    expect(wrapBubble('the iron sings today', 24)).toEqual(['the iron sings today'])
  })
})

describe('the bubble leans toward whoever is speaking', () => {
  const tinted = (speaker: number): number => over(speakerWash(speaker), SPEECH_FILL, SPEAKER_TINT)

  it('leans a fifth of the way at most', () => {
    expect(SPEAKER_TINT).toBe(0.15)
  })

  it('takes the speaker’s hue, not how dark their coat is', () => {
    // the same coat under two lamps is one person, so it washes to one paper
    expect(speakerWash(0x402010)).toBe(speakerWash(0x804020))
    expect(speakerWash(0x000000)).toBe(0xffffff)
  })

  it('never washes to something darker than the hue it came from', () => {
    for (const c of [0xff0000, 0x00ff00, 0x0000ff, 0x402010]) {
      const w = speakerWash(c)
      for (const shift of [16, 8, 0]) {
        expect((w >> shift) & 0xff, `${c.toString(16)} ch${shift}`).toBeGreaterThanOrEqual(
          (c >> shift) & 0xff,
        )
      }
    }
  })

  it('stays a cream bubble — the tint is a lean, not a repaint', () => {
    const paper = tinted(0x2f6f3f)
    for (const shift of [16, 8, 0]) {
      const from = (SPEECH_FILL >> shift) & 0xff
      const to = (paper >> shift) & 0xff
      expect(Math.abs(from - to), `channel ${shift}`).toBeLessThanOrEqual(40)
    }
    expect(paper).not.toBe(SPEECH_FILL)
  })

  // The tinted paper is what is actually drawn, so it — not SPEECH_FILL — is what has to
  // clear AA, in both light bands, for ANY sprite the forge ever makes.
  it('clears AA in both bands whatever colour the speaker is', () => {
    for (const speaker of [0x000000, 0xffffff, 0xff0000, 0x00ff00, 0x0000ff, 0x2f6f3f]) {
      const r = bandRatios(SPEECH_INK, tinted(speaker))
      expect(r.day, `day on ${speaker.toString(16)}`).toBeGreaterThanOrEqual(4.5)
      expect(r.night, `night on ${speaker.toString(16)}`).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('the dominant colour of a sheet is the cloth, not the outline', () => {
  const px = (rows: [number, number, number, number][]): number[] => rows.flat()

  it('picks the colour the most pixels are', () => {
    expect(
      dominantColor(
        px([
          [40, 120, 200, 255],
          [40, 120, 200, 255],
          [200, 60, 60, 255],
        ]),
      ),
    ).toBe(0x2878c8)
  })

  it('skips transparent pixels and the near-black outline', () => {
    expect(
      dominantColor(
        px([
          [10, 10, 10, 255],
          [10, 10, 10, 255],
          [10, 10, 10, 255],
          [0, 255, 0, 0],
          [200, 60, 60, 255],
        ]),
      ),
    ).toBe(0xc83c3c)
  })

  it('says nothing rather than guessing when there is nothing to read', () => {
    expect(dominantColor([])).toBeNull()
    expect(dominantColor(px([[0, 0, 0, 0]]))).toBeNull()
  })
})

// Ten people in a market square is ten bubbles, which is a wall of paper. Three is a scene.
describe('only the nearest three speak out loud', () => {
  const at = (id: string, sx: number, sy: number) => ({ id, sx, sy })

  it('keeps BUBBLE_NEAREST, measured from the camera centre', () => {
    const near = nearestSpeakers(
      [at('far', 500, 0), at('a', 10, 0), at('b', 0, 20), at('c', 30, 0), at('mid', 200, 0)],
      { x: 0, y: 0 },
    )
    expect(near.size).toBe(BUBBLE_NEAREST)
    expect([...near].sort()).toEqual(['a', 'b', 'c'])
  })

  it('takes everybody when there are fewer than three', () => {
    expect(nearestSpeakers([at('a', 0, 0)], { x: 0, y: 0 }).size).toBe(1)
  })

  it('breaks a tie by arrival order, so the same frame chooses the same three twice', () => {
    const want = [at('a', 10, 0), at('b', 10, 0), at('c', 10, 0), at('d', 10, 0)]
    const first = [...nearestSpeakers(want, { x: 0, y: 0 })]
    expect(first).toEqual(['a', 'b', 'c'])
    expect([...nearestSpeakers(want, { x: 0, y: 0 })]).toEqual(first)
  })

  it('collapses the whole town to a glyph at the widest stop', () => {
    expect(GLYPH_ZOOM).toBe(ZOOM_STOPS[0])
    expect(bubbleShown(GLYPH_ZOOM, true)).toBe(false)
    for (const zoom of ZOOM_STOPS.filter((z) => z > GLYPH_ZOOM)) {
      expect(bubbleShown(zoom, true), `${zoom}x`).toBe(true)
      expect(bubbleShown(zoom, false), `${zoom}x not nearest`).toBe(false)
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
      [0, 1, 2].map((i) => ({ id: `b${i}`, sx: 450, sy: 350, size })),
      view,
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

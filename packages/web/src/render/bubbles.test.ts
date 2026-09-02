import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  BUBBLE_FADE_MS,
  bubbleAlpha,
  onLeash,
  BUBBLE_FONT_PX,
  BUBBLE_MAX_PX,
  GLYPH_ZOOM,
  SPEAKER_TINT,
  SPEECH_MAX_CHARS,
  SPEECH_MS_BASE,
  SPEECH_MS_PER_CHAR,
  WRAP_CHARS,
  bubbleLife,
  bubbleShown,
  dominantColor,
  inViewSpeakers,
  placeBubbles,
  speakerWash,
  wrapBubble,
} from './bubbles.js'
import { SPEECH_FILL, SPEECH_INK, faceFor, wrapCharsFor } from './textFaces.js'
import { bandRatios, over } from './legibility.js'
import { ZOOM_STOPS } from './camera.js'
import { CHAR_TARGET_PX } from './charAnim.js'
import { typingMs } from './converse.js'
import type { Rect } from './tooltip.js'

describe('bubbleLife', () => {
  it('is base plus per-char for short text', () => {
    expect(bubbleLife('hi')).toBe(SPEECH_MS_BASE + SPEECH_MS_PER_CHAR * 2)
  })
  it('clamps at SPEECH_MAX_CHARS', () => {
    expect(bubbleLife('x'.repeat(500))).toBe(SPEECH_MS_BASE + SPEECH_MS_PER_CHAR * SPEECH_MAX_CHARS)
  })

  it('★ always outlasts its own typing, so no line dies half-said', () => {
    for (const len of [1, 13, 40, 120, SPEECH_MAX_CHARS]) {
      expect(bubbleLife('x'.repeat(len)), `${len} chars`).toBeGreaterThan(typingMs(len))
    }
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

describe('★ 2A — the box grows to the sentence, and nothing is cut', () => {
  const SPEECH =
    'the fish are biting well this morning by the river and the light is good on the water and nobody has come down to see any of it with me'

  it('★ keeps every character, however many lines that takes', () => {
    const lines = wrapBubble(SPEECH, 24)
    expect(lines.length).toBeGreaterThan(4)
    expect(lines.join(' ')).toBe(SPEECH)
    expect(lines.some((l) => l.endsWith('…'))).toBe(false)
  })

  // ★ Two lines cut a spoken line in half and the town read as a place of half-sentences.
  it('★ lets a whole spoken line through, where two lines would have cut it', () => {
    const said = 'the fish are biting well this morning by the river'
    expect(wrapBubble(said, 24)).toHaveLength(3)
    expect(wrapBubble(said, 24).join(' ')).toBe(said)
  })

  // The one the deck measured: 78 characters, cut to "Sit down, Sa…" at the old width.
  it('★ sets the recorded line in four lines or fewer at the width it is allowed', () => {
    const said = 'Sit down, Salma. Let me look at it before it decides to be more than a scratch.'
    const lines = wrapBubble(said)
    expect(lines.join(' ')).toBe(said)
    expect(lines.length).toBeLessThanOrEqual(4)
  })

  it('★ holds the whole sanitized ceiling without dropping a character', () => {
    const long = 'word '.repeat(60).slice(0, SPEECH_MAX_CHARS).trim()
    expect(wrapBubble(long).join(' ')).toBe(long)
  })

  it("holds a longer line longer, up to the sanitizer's own ceiling", () => {
    expect(bubbleLife('x'.repeat(200))).toBeGreaterThan(bubbleLife('x'.repeat(40)))
    expect(bubbleLife('x'.repeat(SPEECH_MAX_CHARS + 100))).toBe(
      SPEECH_MS_BASE + SPEECH_MS_PER_CHAR * SPEECH_MAX_CHARS,
    )
  })

  it('is about twice the width the box used to wrap at', () => {
    expect(BUBBLE_MAX_PX).toBeGreaterThanOrEqual(2 * 210)
    expect(WRAP_CHARS).toBeGreaterThanOrEqual(2 * 13)
  })

  it('never lets a line push past the wrap width', () => {
    const long = 'aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk llll'
    for (const width of [10, 16, 24, WRAP_CHARS]) {
      for (const l of wrapBubble(long, width))
        expect(l.length, `${width}`).toBeLessThanOrEqual(width)
    }
  })

  it('leaves a short line alone', () => {
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

// ★ Three speakers in a town of thirty read as a town where only three people ever talk. The
// picture is the rule now: if the camera can see them, they get their word.
describe('★ everybody the camera can see speaks out loud', () => {
  const at = (id: string, sx: number, sy: number) => ({ id, sx, sy })
  const VIEW = { x: 0, y: 0, w: 400, h: 300 }

  it('★ keeps every speaker inside the picture, however many that is', () => {
    const seen = inViewSpeakers(
      [at('a', 10, 10), at('b', 200, 150), at('c', 399, 299), at('d', 40, 90), at('e', 5, 5)],
      VIEW,
    )
    expect(seen.size).toBe(5)
  })

  it('★ drops the ones the camera cannot see, and keeps the ones on its edge', () => {
    const seen = inViewSpeakers(
      [at('far', 5000, 0), at('above', 200, -1), at('edge', 400, 300), at('in', 1, 1)],
      VIEW,
    )
    expect([...seen].sort()).toEqual(['edge', 'in'])
  })

  it('takes nobody out of an empty frame, and everybody out of a full one', () => {
    expect(inViewSpeakers([], VIEW).size).toBe(0)
    expect(inViewSpeakers([at('a', 0, 0)], VIEW).size).toBe(1)
  })

  it('collapses the whole town to a glyph at the widest stop', () => {
    expect(GLYPH_ZOOM).toBe(ZOOM_STOPS[0])
    expect(bubbleShown(GLYPH_ZOOM, true)).toBe(false)
    for (const zoom of ZOOM_STOPS.filter((z) => z > GLYPH_ZOOM)) {
      expect(bubbleShown(zoom, true), `${zoom}x`).toBe(true)
      expect(bubbleShown(zoom, false), `${zoom}x off screen`).toBe(false)
    }
  })

  /** ★ THE "…" ON A SPEAKER STANDING IN THE PICTURE. The cull was asked about the BUBBLE's own
   *  anchor — 70 world px over the speaker's feet — as a bare point with no margin, so anybody
   *  whose feet were inside the top 70 px of the view was ruled off screen and collapsed to a
   *  glyph. At the director's 3x stop the view is 300 world px tall: the whole top quarter. */
  describe('★ the cull is asked about the SPEAKER, not about where their words float', () => {
    const VIEW = { x: 0, y: 0, w: 1440, h: 900 }
    const feet = (id: string, sx: number, sy: number) => ({ id, sx, sy })

    it('★ keeps a speaker whose whole body is in the picture, however near the top edge', () => {
      for (const feetY of [0, 1, 20, 51, 52, 70, 450, 899]) {
        expect(inViewSpeakers([feet('a', 700, feetY)], VIEW).has('a'), `feet at ${feetY}`).toBe(true)
      }
    })

    it('★ still drops a speaker the camera genuinely cannot see', () => {
      // feet one pixel above the top edge, so even the heels are out of frame
      expect(inViewSpeakers([feet('above', 700, -1)], VIEW).has('above')).toBe(false)
      // ...and one whose head has just cleared the bottom edge
      expect(inViewSpeakers([feet('below', 700, 900 + CHAR_TARGET_PX + 1)], VIEW).has('below')).toBe(
        false,
      )
      expect(inViewSpeakers([feet('crown', 700, 900 + CHAR_TARGET_PX)], VIEW).has('crown')).toBe(
        true,
      )
      expect(inViewSpeakers([feet('far', 5000, 400)], VIEW).has('far')).toBe(false)
    })

    it('★ the layer hands it the feet, and lifts the box off the head only to place it', () => {
      const SRC = readFileSync(new URL('./bubbles.ts', import.meta.url), 'utf8')
      expect(SRC).toContain('const seen = inViewSpeakers(at, view)')
      expect(SRC).toContain('sy: p.sy - CHAR_TARGET_PX - BUBBLE_LIFT_PX - p.drift')
    })
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

  // ★ The nameplate is a DOM label over the same camera. It cannot move — it is nailed under
  // the figure — so the bubble is the one that has to step aside.
  it('★ steps a bubble clear of the nameplate under the same figure', () => {
    const view = { x: 0, y: 0, w: 900, h: 700 }
    // the plate sits just under the head the bubble is asked to sit under
    const plate = { x: 380, y: 24, w: 140, h: 20 }
    const want = [{ id: 'a', sx: 450, sy: 30, size: { w: 180, h: 60 } }]
    const [bare] = placeBubbles(want, view)
    const [clear] = placeBubbles(want, view, [plate])
    expect(overlaps(bare!.rect, plate), 'the fixture has to collide to prove anything').toBe(true)
    expect(overlaps(clear!.rect, plate)).toBe(false)
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

describe('a bubble stays on its leash and leaves on a fade (D19, D20)', () => {
  const size = { w: 60, h: 24 }

  it('is shown while the placed box still touches the speaker’s own box', () => {
    expect(onLeash({ x: 70, y: 100, w: 60, h: 24 }, 100, 140, size)).toBe(true)
  })

  it('is hidden once `placeTag` has pinned it a screen away from the speaker', () => {
    expect(onLeash({ x: 0, y: 0, w: 60, h: 24 }, 900, 700, size)).toBe(false)
    expect(onLeash({ x: 0, y: 0, w: 60, h: 24 }, 100, 140, size)).toBe(false)
  })

  it('fades over the reveal motion before it dies — monotone, on the curve it arrived on', () => {
    expect(bubbleAlpha(BUBBLE_FADE_MS * 10)).toBe(1)
    expect(bubbleAlpha(BUBBLE_FADE_MS)).toBe(1)
    for (let ms = BUBBLE_FADE_MS; ms > 0; ms -= 10)
      expect(bubbleAlpha(ms - 10)).toBeLessThanOrEqual(bubbleAlpha(ms))
    expect(bubbleAlpha(BUBBLE_FADE_MS / 2)).toBeGreaterThan(0)
    expect(bubbleAlpha(BUBBLE_FADE_MS / 2)).toBeLessThan(1)
    expect(bubbleAlpha(0)).toBe(0)
    expect(bubbleAlpha(-40)).toBe(0)
  })
})

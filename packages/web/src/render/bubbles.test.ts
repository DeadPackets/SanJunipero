import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  BUBBLE_FADE_MS,
  bubbleAlpha,
  onLeash,
  BUBBLE_FONT_PX,
  BUBBLE_MAX_LINES,
  BUBBLE_MAX_PX,
  capLines,
  GLYPH_ZOOM,
  READ_MS_PER_CHAR,
  SPEAKER_TINT,
  SPEECH_MAX_CHARS,
  SPEECH_MS_BASE,
  WRAP_CHARS,
  bubbleInked,
  bubbleLife,
  bubbleShown,
  BUBBLE_CAP,
  NAME_ROW_H,
  bubbleBox,
  clampBubble,
  safeView,
  dominantColor,
  inViewSpeakers,
  placeBubbles,
  speakerWash,
  createBubbleLayer,
  wrapBubble,
} from './bubbles.js'
import { BUBBLE_PAD, SPEECH_FILL, SPEECH_INK, faceFor, wrapCharsFor } from './textFaces.js'
import { bandRatios, over } from './legibility.js'
import { ZOOM_STOPS } from './camera.js'
import { CHAR_TARGET_PX } from './charAnim.js'
import {
  COLUMN_PRIOR_ALPHA,
  MAX_LIVE_THOUGHTS,
  PRIOR_ALPHA,
  columnLines,
  fateOfPriorLine,
  typedChars,
  typingMs,
} from './converse.js'
import type { Rect } from './tooltip.js'
import { Container } from 'pixi.js'
import type { Scene } from './scene.js'
import type { WorldStore } from '../state/worldStore.js'

// ★ D3 — 240 characters took 8.6s to type and died 13.1s in, leaving 4.5 seconds to read them:
// 53 characters a second, where a person reads about 18. The window is bought, not left over.
describe('★ bubbleLife buys a read window out of what is SHOWN', () => {
  it('is the typing, then the base, then a read window per shown character', () => {
    expect(READ_MS_PER_CHAR).toBe(55)
    expect(bubbleLife('hi')).toBe(typingMs(2) + SPEECH_MS_BASE + READ_MS_PER_CHAR * 2)
  })

  it('★ a thought is not typed, so it pays for reading only', () => {
    const thought = 'cold stays outside where it belongs'
    expect(bubbleLife(thought, true)).toBe(SPEECH_MS_BASE + READ_MS_PER_CHAR * thought.length)
    expect(bubbleLife(thought, true)).toBeLessThan(bubbleLife(thought))
  })

  it('★ the read window is never squeezed by the typing, at the longest box there is', () => {
    // the most a three-line box can hold: three full lines and the two breaks between them
    const shown = capLines(wrapBubble('x '.repeat(400), WRAP_CHARS), WRAP_CHARS).join('\n')
    expect(shown.split('\n')).toHaveLength(BUBBLE_MAX_LINES)
    expect(shown.length).toBeGreaterThan(3 * WRAP_CHARS - 4)
    expect(bubbleLife(shown) - typingMs(shown.length)).toBeGreaterThanOrEqual(
      READ_MS_PER_CHAR * shown.length,
    )
  })

  it('★ always outlasts its own typing, so no line dies half-said', () => {
    for (const len of [1, 13, 40, 120, SPEECH_MAX_CHARS]) {
      expect(bubbleLife('x'.repeat(len)), `${len} chars`).toBeGreaterThan(typingMs(len))
    }
  })
})

// ★ Holding the partner's line so the pair reads as one exchange also held the SPEAKER's own
// previous line, and two full-alpha slabs from one mouth stacked until the first timed out.
describe('★ what a new line does to the lines already in the air', () => {
  const line = (agentId: string, dimmed = false) => ({ agentId, isThought: false, dimmed })

  it('★ ends the speaker’s OWN last line — they have said something new', () => {
    expect(fateOfPriorLine(line('amara'), 'amara')).toBe('end')
    expect(fateOfPriorLine(line('amara', true), 'amara')).toBe('end')
  })

  it('★ dims and holds the other speaker’s, so the pair is on screen together', () => {
    expect(fateOfPriorLine(line('amara'), 'yusuf')).toBe('dim')
  })

  it('lets a dimmed line go the moment a third one lands', () => {
    expect(fateOfPriorLine(line('amara', true), 'omar')).toBe('end')
  })

  it('leaves a thought alone: it is not part of anybody’s exchange', () => {
    for (const speaker of ['amara', 'yusuf']) {
      expect(fateOfPriorLine({ agentId: 'amara', isThought: true, dimmed: false }, speaker)).toBe(
        'keep',
      )
      expect(fateOfPriorLine({ agentId: 'amara', isThought: true, dimmed: true }, speaker)).toBe(
        'keep',
      )
    }
  })

  it('★ the layer applies it to every live bubble on every spoken line', () => {
    const SRC = readFileSync(new URL('./bubbles.ts', import.meta.url), 'utf8')
    expect(SRC).toContain(
      'const fate = fateOfPriorLine({ ...b, dimmed: b.dimMs !== null }, agentId)',
    )
    expect(SRC).toContain("if (fate === 'end') b.dieMs = now")
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

  it('holds a longer line longer', () => {
    expect(bubbleLife('x'.repeat(200))).toBeGreaterThan(bubbleLife('x'.repeat(40)))
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

// ★ D2 — 240 characters wrapped to eleven lines and stood a slab over a third of a 1440px frame.
// The utterance still reaches the Chronicle whole; the DRAWING stops at three lines.
describe('★ the bubble draws four lines, and says so', () => {
  const SPEECH =
    'the fish are biting well this morning by the river and the light is good on the water and nobody has come down to see any of it with me'

  it('★ keeps a box of four lines or fewer exactly as it was wrapped', () => {
    // Four holds the median spoken line of the gate rehearsal whole; three cut 68% of them.
    expect(BUBBLE_MAX_LINES).toBe(4)
    for (const said of ['the iron sings today', 'the fish are biting well this morning']) {
      const lines = wrapBubble(said, 24)
      expect(capLines(lines, 24)).toEqual(lines)
    }
  })

  it('★ keeps the first four and ends the last in one ellipsis', () => {
    const lines = wrapBubble(SPEECH, 24)
    expect(lines.length).toBeGreaterThan(BUBBLE_MAX_LINES)
    const shown = capLines(lines, 24)
    expect(shown).toHaveLength(BUBBLE_MAX_LINES)
    expect(shown.slice(0, -1)).toEqual(lines.slice(0, BUBBLE_MAX_LINES - 1))
    expect(shown.at(-1)!.endsWith('…')).toBe(true)
    expect(shown.filter((l) => l.includes('…'))).toHaveLength(1)
  })

  it('★ the ellipsis replaces trailing characters rather than overflowing the box', () => {
    for (const width of [10, 16, 24, WRAP_CHARS]) {
      for (const l of capLines(wrapBubble(SPEECH, width), width))
        expect(l.length, `${width}`).toBeLessThanOrEqual(width)
    }
  })

  it('★ a thought is quieter, not longer: the same three lines', () => {
    const face = faceFor('thought')
    const at = wrapCharsFor(face.family, face.size, BUBBLE_MAX_PX)
    expect(capLines(wrapBubble(SPEECH, at), at)).toHaveLength(BUBBLE_MAX_LINES)
  })

  it('★ the layer cuts the DRAWING, never the line it was handed', () => {
    const SRC = readFileSync(new URL('./bubbles.ts', import.meta.url), 'utf8')
    expect(SRC).toContain('capLines(wrapBubble(text.slice(0, SPEECH_MAX_CHARS), wrapAt), wrapAt)')
    // and the event that carries it away is untouched: `spawn` is handed the whole `text`
    expect(SRC).toContain('spawnSpeech: (agentId, text) => {')
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
        expect(inViewSpeakers([feet('a', 700, feetY)], VIEW).has('a'), `feet at ${feetY}`).toBe(
          true,
        )
      }
    })

    it('★ still drops a speaker the camera genuinely cannot see', () => {
      // feet one pixel above the top edge, so even the heels are out of frame
      expect(inViewSpeakers([feet('above', 700, -1)], VIEW).has('above')).toBe(false)
      // ...and one whose head has just cleared the bottom edge
      expect(
        inViewSpeakers([feet('below', 700, 900 + CHAR_TARGET_PX + 1)], VIEW).has('below'),
      ).toBe(false)
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

  // ★ D5 — the burst frame caught a box pinned at the very top of the viewport with a line of
  // the box under it composited away. `placeTag` steps AWAY from the anchor and clamps as it
  // goes, so once the view pinned the box the step had nowhere left to move it.
  describe('★ the whole box stays inside the picture, clear of the boxes already there', () => {
    // the director's own frame at 1440x900 and the 2x stop, in world coordinates; a box is the
    // widest a bubble goes and three lines tall
    const VIEW = { x: 0, y: 0, w: 720, h: 450 }
    const BOX = { w: 213, h: 35 }
    // the place name over the same head, tall enough that stepping up runs out of viewport
    const NAME = { x: 0, y: 0, w: 720, h: 260 }
    const inside = (r: Rect): boolean =>
      r.x >= VIEW.x && r.y >= VIEW.y && r.x + r.w <= VIEW.x + VIEW.w && r.y + r.h <= VIEW.y + VIEW.h

    it('★ steps a box the view pinned at its top edge clear of what is already there', () => {
      const want = [0, 1].map((i) => ({ id: `b${i}`, sx: 360, sy: 320, size: BOX }))
      const placed = placeBubbles(want, VIEW, [NAME])
      for (const p of placed) {
        expect(overlaps(p.rect, NAME), p.id).toBe(false)
        expect(inside(p.rect), p.id).toBe(true)
      }
    })

    it('★ keeps four boxes asking for one head inside the frame and off each other', () => {
      const placed = placeBubbles(
        [0, 1, 2, 3].map((i) => ({ id: `b${i}`, sx: 360, sy: 320, size: BOX })),
        VIEW,
        [NAME],
      )
      for (const p of placed) expect(inside(p.rect), p.id).toBe(true)
      for (let i = 0; i < placed.length; i++) {
        for (let j = i + 1; j < placed.length; j++)
          expect(overlaps(placed[i]!.rect, placed[j]!.rect), `${i} vs ${j}`).toBe(false)
      }
    })

    it('★ the node is hung off the CLAMPED box, not off where the box wanted to be', () => {
      const [p] = placeBubbles([{ id: 'a', sx: 360, sy: 40, size: BOX }], VIEW)
      expect(p!.sy).toBe(p!.rect.y)
      expect(p!.sx).toBe(p!.rect.x + p!.rect.w / 2)
    })

    it('leaves a box that already fits exactly where the placer put it', () => {
      expect(clampBubble({ x: 200, y: 200, ...BOX }, VIEW, [])).toEqual({ x: 200, y: 200, ...BOX })
    })
  })
})

// ★ D1 — `build` draws the paper at its final w × h and then empties the label, so a speech
// bubble opened as a blank rectangle for the 36ms its first character took to type.
describe('★ the paper is not there until the first character is', () => {
  const SRC = readFileSync(new URL('./bubbles.ts', import.meta.url), 'utf8')

  it('★ is blank at the instant of speaking, and inked one character later', () => {
    expect(bubbleInked(typedChars(40, 0))).toBe(false)
    expect(bubbleInked(typedChars(40, -100))).toBe(false)
    expect(bubbleInked(typedChars(40, typingMs(1)))).toBe(true)
    expect(bubbleInked(typedChars(40, typingMs(40)))).toBe(true)
  })

  it('★ a thought is not typed, so its paper is there from the first frame', () => {
    expect(bubbleInked('cold stays outside'.length)).toBe(true)
  })

  it('★ the layer holds the node back rather than showing an empty box', () => {
    expect(SRC).toContain('node.visible = bubbleInked(typed)')
    expect(SRC).toContain(
      'b.node.visible = bubbleInked(b.typed) && onLeash(placed.rect, p.sx, p.sy, p.size)',
    )
    // and the box is still cut to the whole line: reflow would move paper under a reader
    expect(SRC).toContain('{ w: label.width, h: label.height }')
    expect(SRC).toContain("if (typed !== full.length) label.text = ''")
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

// The layer, driven the way the ticker drives it. Pixi measures labels through
// `document.createElement('canvas')` and these tests run with no DOM, so a label needs the
// smallest stub that lets one build.
function stubCanvas(): void {
  if (typeof globalThis.document !== 'undefined') return
  const ctx = {
    font: '',
    measureText: (t: string) => ({
      width: t.length * 8,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: t.length * 8,
      actualBoundingBoxAscent: 8,
      actualBoundingBoxDescent: 2,
    }),
    fillText: () => {},
    clearRect: () => {},
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    scale: () => {},
    translate: () => {},
    save: () => {},
    restore: () => {},
    setTransform: () => {},
  }
  const canvas = { width: 1, height: 1, getContext: () => ctx, style: {} }
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElement: () => canvas, body: { appendChild: () => {} } },
  })
  Object.defineProperty(globalThis, 'CanvasRenderingContext2D', {
    configurable: true,
    value: class {
      letterSpacing = ''
    },
  })
}

describe('★ a mind under a roof is not on the map, and neither is what it says', () => {
  beforeAll(stubCanvas)

  type Body = { x: number; y: number; alive: boolean; name: string; insideId?: string }

  function harness(): {
    layer: ReturnType<typeof createBubbleLayer>
    amara: Body
    said: () => Container[]
  } {
    const bubbleLayer = new Container()
    const amara: Body = { x: 4, y: 4, alive: true, name: 'Amara' }
    const scene = {
      layers: { bubbles: bubbleLayer },
      textScale: 1,
      getZoom: () => 1,
      wantsMotion: () => false,
      viewRect: () => ({ x: -1e4, y: -1e4, w: 2e4, h: 2e4 }),
      anchorOf: () => null,
      tags: { occupied: () => [], setOccupied: () => {} },
      ring: { bounds: () => null },
    } as unknown as Scene
    const store = {
      getState: () => ({ agents: { amara } }),
      sceneById: () => null,
      assetRecords: () => [],
    } as unknown as WorldStore
    return { layer: createBubbleLayer(scene, store), amara, said: () => bubbleLayer.children }
  }

  it('★ a line spoken indoors is not drawn over the roof', () => {
    const h = harness()
    h.amara.insideId = 'smithy'
    h.layer.spawnSpeech('amara', 'the iron is hot')
    expect(h.said()).toHaveLength(0)
  })

  it('★ a line spoken outside leaves with the speaker when they step inside', () => {
    const h = harness()
    h.layer.spawnSpeech('amara', 'the iron is hot')
    expect(h.said()).toHaveLength(1)

    h.amara.insideId = 'smithy'
    h.layer.tick(performance.now())
    expect(h.said()).toHaveLength(0)
  })

  // ★ `tick` is the ONLY reaper and it runs on the ticker, which stops with `requestAnimationFrame`
  // in a hidden tab. The socket keeps delivering, and `onEvents` spawns inline.
  it('★ a tab nobody is looking at does not stack speech without limit', () => {
    const h = harness()
    for (let i = 0; i < BUBBLE_CAP * 3; i++) h.layer.spawnSpeech('amara', `line ${String(i)}`)
    expect(h.said()).toHaveLength(BUBBLE_CAP)
  })

  // ★ Rehearsal 30's review: a box de-conflicted away from its speaker stood beside the wrong
  // figure, and nothing on it said whose line it was.
  it('★ a spoken line wears its speaker’s name; a thought wears none', () => {
    const h = harness()
    h.layer.spawnSpeech('amara', 'the iron is hot')
    h.layer.spawnThought('amara', 'too hot')
    const [speech, thought] = h.said().map((node) => node.children[0] as Container)
    const last = speech!.children.at(-1) as { text?: string }
    expect(last.text).toBe('Amara')
    expect(thought!.children).toHaveLength(speech!.children.length - 1)
  })
})

describe('★ the paper is cut for the name, and laid clear of the chrome', () => {
  it('cuts the box to the wider of the name and the line, with the line under the name', () => {
    expect(bubbleBox({ w: 100, h: 32 }, null)).toEqual({
      w: 100 + 2 * BUBBLE_PAD,
      h: 32 + 2 * BUBBLE_PAD,
      textY: BUBBLE_PAD,
    })
    const named = bubbleBox({ w: 100, h: 32 }, { w: 140, h: 16 })
    expect(named).toEqual({
      w: 140 + 2 * BUBBLE_PAD,
      h: 32 + NAME_ROW_H + 2 * BUBBLE_PAD,
      textY: BUBBLE_PAD + NAME_ROW_H,
    })
  })

  it('takes the chrome bands off the view in world px, and leaves an unbanded view alone', () => {
    const view = { x: 0, y: 0, w: 1000, h: 800 }
    expect(safeView(view, undefined, 2)).toBe(view)
    expect(safeView(view, { top: 60, bottom: 40 }, 2)).toEqual({ x: 0, y: 30, w: 1000, h: 750 })
    expect(safeView(view, { top: 5000, bottom: 0 }, 1).h).toBe(0)
  })

  it('★ the layer places the box in the safe view and reads who is in shot off the camera’s', () => {
    const SRC = readFileSync(new URL('./bubbles.ts', import.meta.url), 'utf8')
    expect(SRC).toContain('safeView(view, scene.safeInsets, zoom)')
    expect(SRC).toContain('const seen = inViewSpeakers(at, view)')
    const ACTS = readFileSync(new URL('./acts.ts', import.meta.url), 'utf8')
    expect(ACTS).toContain('safeView(view, scene.safeInsets, zoom)')
  })
})

// ★ Phase 3 — the owner's words were "the UI is extremely hard to follow what is going on":
// up to 24 boxes over the town, last-write-wins, and no way to tell which line answers which.
describe('★ the framed scene stacks in a column, and the rest of the town murmurs', () => {
  beforeAll(stubCanvas)

  type Ring = { sceneId: string; sx: number; sy: number; rx: number; ry: number } | null
  type Held = { id: string; participants: string[]; open: boolean }

  const RING = { sceneId: 's1', sx: 300, sy: 300, rx: 60, ry: 30 }
  /** the ring's own right edge: a docked line stands past it, a line over a head does not */
  const DOCKED = RING.sx + RING.rx

  const talk = (id: string, participants: string[]): Held => ({ id, participants, open: true })

  function town(
    scenes: Held[],
    startRing: Ring = { ...RING },
  ): {
    layer: ReturnType<typeof createBubbleLayer>
    nodes: () => Container[]
    box: (i: number) => Container
    glyph: (i: number) => Container
    mark: (i: number) => Container
    setRing: (r: Ring) => void
    close: (id: string) => void
  } {
    const held = new Container()
    const agents = {
      amara: { x: 4, y: 4, alive: true, name: 'Amara' },
      nadir: { x: 6, y: 4, alive: true, name: 'Nadir' },
      kofi: { x: 20, y: 12, alive: true, name: 'Kofi' },
    }
    let ring = startRing
    const open = new Map(scenes.map((s) => [s.id, s]))
    const scene = {
      layers: { bubbles: held },
      textScale: 1,
      getZoom: () => 1,
      wantsMotion: () => false,
      viewRect: () => ({ x: 0, y: 0, w: 2000, h: 900 }),
      anchorOf: () => null,
      tags: { occupied: () => [], setOccupied: () => {} },
      ring: { bounds: () => ring },
    } as unknown as Scene
    const store = {
      getState: () => ({ agents }),
      sceneById: (id: string) => open.get(id) ?? null,
      assetRecords: () => [],
    } as unknown as WorldStore
    const kids = (): Container[] => held.children
    return {
      layer: createBubbleLayer(scene, store),
      nodes: kids,
      box: (i) => kids()[i]!.children[0] as Container,
      glyph: (i) => kids()[i]!.children[1] as Container,
      mark: (i) => kids()[i]!.children[2] as Container,
      setRing: (r) => {
        ring = r
      },
      close: (id) => {
        open.get(id)!.open = false
      },
    }
  }

  it('★ stands the scene’s lines beside the ring, newest on its floor and the older at 0.45', () => {
    const t = town([talk('s1', ['amara', 'nadir'])])
    const now = performance.now()
    t.layer.spawnSpeech('amara', 'the well is dry')
    t.layer.spawnSpeech('nadir', 'then we dig')
    t.layer.tick(now + 500)
    const [older, newest] = t.nodes()
    expect(t.box(0).visible, 'both are slabs, not marks').toBe(true)
    expect(t.box(1).visible).toBe(true)
    // one column, off the ring's own side, and the newest sits on the ring's floor
    expect(older!.position.x).toBeGreaterThan(DOCKED)
    expect(newest!.position.x).toBeGreaterThan(DOCKED)
    expect(newest!.position.y).toBe(RING.sy + RING.ry)
    expect(older!.position.y).toBeLessThan(newest!.position.y)
    expect(newest!.alpha).toBe(1)
    expect(older!.alpha).toBe(COLUMN_PRIOR_ALPHA)
    expect(older!.alpha).toBe(0.45)
  })

  // ★ `fateOfPriorLine` ends the third line of any exchange, so a column that says four could
  // only ever draw two. The framed scene's lines are the column's now, and the fifth reaps the
  // oldest: the constant and the picture say the same number.
  it('★ holds four of the scene’s lines, and the fifth pushes the oldest out', () => {
    const t = town([talk('s1', ['amara', 'nadir'])])
    const now = performance.now()
    const said = [
      'the well is dry',
      'then we dig',
      'not in this ground',
      'we dig anyway',
      'at dawn',
    ]
    said.forEach((line, i) => {
      t.layer.spawnSpeech(i % 2 === 0 ? 'amara' : 'nadir', line)
    })
    const oldest = t.nodes()[0]!
    t.layer.tick(now + 500)
    expect(t.nodes().filter((n) => (n.children[0] as Container).visible)).toHaveLength(4)

    t.layer.tick(now + 520)
    expect(t.nodes()).toHaveLength(4)
    expect(oldest.destroyed, 'the first line is the one that went').toBe(true)
    const ys = t.nodes().map((n) => n.position.y)
    expect(
      [...ys].sort((a, b) => a - b),
      'oldest at the top, newest on the floor',
    ).toEqual(ys)
    expect(ys.at(-1)).toBe(RING.sy + RING.ry)
  })

  it('takes neither a thought nor a body the world left out of the scene', () => {
    expect(
      columnLines(
        [
          { agentId: 'amara', isThought: false },
          { agentId: 'amara', isThought: true },
          { agentId: 'kofi', isThought: false },
        ],
        new Set(['amara']),
      ),
    ).toEqual([0])
  })

  // ★ The nearest-three cap was killed deliberately: the town does not go quiet because the
  // camera looked away. A body outside the shot's scene murmurs, and murmuring is not silence.
  it('★ a body outside the shot’s scene keeps a 6 px mark and no slab', () => {
    const t = town([talk('s1', ['amara', 'nadir'])])
    t.layer.spawnSpeech('kofi', 'my roof leaks')
    t.layer.tick(performance.now() + 500)
    expect(t.box(0).visible).toBe(false)
    expect(t.mark(0).visible).toBe(true)
    // a MARK, not the three-dot glyph shrunk to where nobody can resolve it
    expect(t.glyph(0).visible).toBe(false)
    expect(t.mark(0).getLocalBounds().height).toBe(6)
    expect(t.nodes()[0]!.visible, '★ every speaking body still shows something').toBe(true)
  })

  // ★ `getScene()` answered with the last scene the town opened ANYWHERE, so with two talks
  // running the one the camera was on is the one that got muted.
  it('★ murmurs by the scene the camera is on, not by the last talk the town opened', () => {
    const t = town([talk('s1', ['amara', 'nadir']), talk('s2', ['kofi'])])
    const now = performance.now()
    t.layer.spawnSpeech('amara', 'the well is dry')
    t.layer.spawnSpeech('kofi', 'my roof leaks')
    t.layer.tick(now + 500)
    expect(t.box(0).visible, 'the shot’s own line is a slab').toBe(true)
    expect(t.nodes()[0]!.position.x).toBeGreaterThan(DOCKED)
    expect(t.box(1).visible, 'the other talk murmurs').toBe(false)
    expect(t.mark(1).visible).toBe(true)
  })

  // ★ A thought is not part of the exchange, so it was never in the murmur: it collapsed to a
  // 6 px mark for as long as any scene anywhere was open.
  it('★ a thought keeps its wisp while a scene is framed', () => {
    const t = town([talk('s1', ['amara', 'nadir'])])
    t.layer.spawnThought('kofi', 'the roof again')
    t.layer.spawnSpeech('kofi', 'my roof leaks')
    t.layer.tick(performance.now() + 500)
    expect(t.box(0).visible, 'the thought').toBe(true)
    expect(t.mark(0).visible).toBe(false)
    expect(t.box(1).visible, 'the spoken line beside it').toBe(false)
    expect(t.mark(1).visible).toBe(true)
  })

  it('★ lets the column and the murmur go the moment the world closes the scene', () => {
    const t = town([talk('s1', ['amara', 'nadir'])])
    const now = performance.now()
    t.layer.spawnSpeech('amara', 'the well is dry')
    t.layer.spawnSpeech('kofi', 'my roof leaks')
    t.layer.tick(now + 500)
    expect(t.nodes()[0]!.position.x).toBeGreaterThan(DOCKED)
    expect(t.mark(1).visible).toBe(true)

    t.close('s1')
    t.layer.tick(now + 600)
    expect(t.nodes()[0]!.position.x, 'the line goes back over its speaker').toBeLessThan(DOCKED)
    expect(t.mark(1).visible, 'and the town has its own voice back').toBe(false)
    expect(t.box(1).visible).toBe(true)
  })

  // ★ The column's dim comes from POSITION, and the alpha write was skipped whenever both were
  // 1: a short reply that died before the line it answered left that line stuck at 0.45.
  it('★ a line that returns to the front of the column brightens again', () => {
    const t = town([talk('s1', ['amara', 'nadir'])])
    const now = performance.now()
    t.layer.spawnSpeech('amara', 'the well by the mill is dry too')
    t.layer.spawnSpeech('nadir', 'no')
    t.layer.tick(now + 500)
    expect(t.nodes()[0]!.alpha).toBe(COLUMN_PRIOR_ALPHA)

    t.layer.tick(now + 4000) // the short reply has gone and the long line is the newest again
    expect(t.nodes()).toHaveLength(1)
    expect(t.nodes()[0]!.alpha).toBe(1)
  })

  it('leaves the town its slabs when the world holds no scene open', () => {
    const t = town([], null)
    t.layer.spawnSpeech('kofi', 'my roof leaks')
    t.layer.tick(performance.now() + 500)
    expect(t.box(0).visible).toBe(true)
    expect(t.mark(0).visible).toBe(false)
  })

  it('★ docks on the side with the room, and holds that side for the life of the scene', () => {
    const t = town([talk('s1', ['amara', 'nadir']), talk('s2', ['amara', 'nadir'])])
    const now = performance.now()
    t.layer.spawnSpeech('amara', 'the well is dry')
    t.layer.tick(now + 500)
    expect(t.nodes()[0]!.position.x, 'the room is to the right of a ring at 300').toBeGreaterThan(
      DOCKED,
    )

    // the cast walks across the frame and the room flips. The column does not.
    t.setRing({ sceneId: 's1', sx: 1700, sy: 300, rx: 60, ry: 30 })
    t.layer.tick(now + 600)
    expect(t.nodes()[0]!.position.x).toBeGreaterThan(1760)

    // a scene the world opened after it is a new question, and gets the other answer
    t.setRing({ sceneId: 's2', sx: 1700, sy: 300, rx: 60, ry: 30 })
    t.layer.tick(now + 700)
    expect(t.nodes()[0]!.position.x).toBeLessThan(1640)
  })

  // ★ Moved off `expect(SRC).toContain('PRIOR_HOLD_MS')`: the layer's own rule for a line
  // nobody is framing, driven rather than read.
  it('★ outside a framed scene it holds an answered line, and lets go on the third', () => {
    const t = town([], null)
    const now = performance.now()
    t.layer.spawnSpeech('amara', 'the well is dry')
    t.layer.spawnSpeech('nadir', 'then we dig')
    t.layer.tick(now + 500)
    expect(t.nodes()).toHaveLength(2)
    expect(t.nodes()[0]!.alpha, 'the answered line dims and stays').toBe(PRIOR_ALPHA)

    t.layer.spawnSpeech('amara', 'not in this ground')
    t.layer.tick(now + 600)
    expect(t.nodes()).toHaveLength(2)
  })

  // ★ Moved off `expect(SRC).toContain('for (const i of thoughtsToEnd(...)')`.
  it('★ ends a mind’s own earlier thought, and never leaves three standing', () => {
    const t = town([], null)
    const now = performance.now()
    t.layer.spawnThought('amara', 'the well')
    t.layer.spawnThought('nadir', 'the road')
    t.layer.spawnThought('kofi', 'the roof')
    t.layer.tick(now + 10)
    expect(t.nodes()).toHaveLength(MAX_LIVE_THOUGHTS)

    const kofi = t.nodes()[1]!
    t.layer.spawnThought('kofi', 'the roof again')
    t.layer.tick(now + 20)
    expect(t.nodes()).toHaveLength(MAX_LIVE_THOUGHTS)
    expect(kofi.destroyed, 'its own earlier one is the one that went').toBe(true)
  })
})

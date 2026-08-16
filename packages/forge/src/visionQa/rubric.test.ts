import { describe, it, expect } from 'vitest'
import { MASTER_PALETTE } from '../palette.js'
import type { RawImage } from '../post/raw.js'
import { NA_CRITERIA_BY_CLASS, CRITERIA } from './verdict.js'
import {
  RUBRIC_VERSION, CANONICAL_PITCH, PITCH_TOLERANCE, CHECKER_PX, CARD_PAD, SWATCH_PX,
  CHECKER_LIGHT, CHECKER_DARK, paletteCard, checkerCard, buildRubricPrompt,
} from './rubric.js'

function blank(w: number, h: number): RawImage {
  return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }
}
function hex(img: RawImage, x: number, y: number): string {
  const i = (y * img.width + x) * 4
  const h = (n: number) => n.toString(16).padStart(2, '0').toUpperCase()
  return `#${h(img.data[i]!)}${h(img.data[i + 1]!)}${h(img.data[i + 2]!)}`
}
function opaqueColors(img: RawImage): Set<string> {
  const s = new Set<string>()
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++)
      if (img.data[(y * img.width + x) * 4 + 3]! === 255) s.add(hex(img, x, y))
  return s
}

describe('palette card', () => {
  it('is deterministic and exactly sized', () => {
    const a = paletteCard(), b = paletteCard()
    expect(a.width).toBe(8 * SWATCH_PX + 2 * CARD_PAD)
    expect(a.height).toBe(5 * SWATCH_PX + 2 * CARD_PAD)
    expect(Array.from(a.data)).toEqual(Array.from(b.data))
  })

  it('shows exactly the 40 master palette colours and nothing else', () => {
    expect(opaqueColors(paletteCard())).toEqual(new Set(MASTER_PALETTE))
    expect(MASTER_PALETTE.length).toBe(40)
  })
})

describe('checker card', () => {
  it('adds a 16px margin on every side', () => {
    const c = checkerCard(blank(24, 40))
    expect(c.width).toBe(24 + 32)
    expect(c.height).toBe(40 + 32)
  })

  it('a fully transparent input yields a pure checker of palette greys', () => {
    const c = checkerCard(blank(16, 16))
    expect(opaqueColors(c)).toEqual(new Set([CHECKER_LIGHT, CHECKER_DARK]))
    expect(MASTER_PALETTE).toContain(CHECKER_LIGHT)
    expect(MASTER_PALETTE).toContain(CHECKER_DARK)
    // both squares actually appear — a solid fill would also pass a naive scan
    expect(hex(c, 0, 0)).not.toBe(hex(c, CHECKER_PX, 0))
  })

  it('preserves an opaque input pixel exactly', () => {
    const s = blank(16, 16)
    s.data.set([0xE8, 0x78, 0x5A, 255], 0)
    const c = checkerCard(s)
    expect(hex(c, 16, 16)).toBe('#E8785A')
    expect(c.data[(16 * c.width + 16) * 4 + 3]).toBe(255)
  })
})

const BANNED = ['poison', 'poisonous', 'toxic', 'deadly', 'danger', 'dangerous',
  'safe', 'edible', 'model', 'prompt', 'generated', 'sprite', 'pixel']

describe('rubric prompt', () => {
  const base = { commission: 'a squat storehouse with a mossy plank roof', naFor: [] as readonly string[] }

  it('asks all seven criteria for a building and names its pitch target', () => {
    const p = buildRubricPrompt({ klass: 'building', footprint: { w: 2, h: 2 }, expectedFacing: 'door-sw', ...base })
    for (const c of CRITERIA) expect(p).toContain(c)
    expect(p).toContain('4.00')
    expect(p).toContain('±20%')
    expect(PITCH_TOLERANCE).toBe(0.2)
    expect(p).toContain(base.commission)
    expect(p).toContain('door-sw')
    expect(p).toContain('2x2')
  })

  it('names the character pitch target', () => {
    const p = buildRubricPrompt({ klass: 'character', ...base, naFor: NA_CRITERIA_BY_CLASS.character })
    expect(p).toContain('5.12')
    expect(CANONICAL_PITCH).toEqual({ character: 5.12, building: 4.0 })
  })

  it('drops the N/A criteria from the ask for an icon and says why', () => {
    const p = buildRubricPrompt({ klass: 'icon', ...base, naFor: NA_CRITERIA_BY_CLASS.icon })
    for (const c of ['facing', 'alignment', 'proportion']) expect(p).not.toMatch(new RegExp(`\\d+\\. ${c}`))
    for (const c of ['palette', 'singleFigure', 'transparency', 'density'])
      expect(p).toMatch(new RegExp(`\\d+\\. ${c}`))
    expect(p).toContain('Not judged for this class')
    expect(p).toContain('facing, alignment, proportion')
  })

  it('carries the structured-output contract and the unjudgeable-criterion rule', () => {
    const p = buildRubricPrompt({ klass: 'building', ...base })
    expect(p).toContain('Score only what you can see.')
    expect(p).toContain('score it 0 and say why in evidence')
  })

  it('holds no model name, no API vocabulary, and no banned words', () => {
    for (const klass of ['building', 'character', 'icon', 'item', 'terrain', 'portrait']) {
      const p = buildRubricPrompt({ klass, ...base, naFor: NA_CRITERIA_BY_CLASS[klass] ?? [] })
      const low = p.toLowerCase()
      for (const w of BANNED) expect(low, `${klass} rubric leaks "${w}"`).not.toContain(w)
      expect(p).not.toContain('AI')
      for (const m of ['gemini', 'openrouter', 'gpt', 'openai', 'anthropic', 'llm'])
        expect(low).not.toContain(m)
    }
    expect(RUBRIC_VERSION).toBe('v1')
  })
})

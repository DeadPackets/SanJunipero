import { describe, it, expect } from 'vitest'
import { EMOTE_KINDS, EMOTE_SIZE, EMOTE_PALETTE, renderEmote } from './emotes.js'
import { cellDistance } from './sheet.js'
import { decodePng, encodePng } from './post/raw.js'

describe('emotes', () => {
  it('exports the 12 authored kinds in order', () => {
    expect(EMOTE_KINDS).toEqual([
      'exclaim',
      'question',
      'heart',
      'star',
      'sleep',
      'hunger',
      'cold',
      'rain',
      'hurt',
      'talk',
      'idea',
      'anger',
    ])
    expect(EMOTE_SIZE).toBe(16)
  })
  it('renders every kind as a non-empty 16×16 RGBA image', () => {
    for (const kind of EMOTE_KINDS) {
      const img = renderEmote(kind)
      expect(img.width).toBe(16)
      expect(img.height).toBe(16)
      expect(img.data.length).toBe(16 * 16 * 4)
      let opaque = 0
      for (let i = 3; i < img.data.length; i += 4) if (img.data[i]! > 0) opaque++
      expect(opaque).toBeGreaterThan(10)
    }
  })
  it('is deterministic', () => {
    for (const kind of EMOTE_KINDS) expect(renderEmote(kind).data).toEqual(renderEmote(kind).data)
  })
  it('every opaque pixel uses a palette color', () => {
    const palette = new Set(
      Object.values(EMOTE_PALETTE).map(([r, g, b]) => (r << 16) | (g << 8) | b),
    )
    for (const kind of EMOTE_KINDS) {
      const img = renderEmote(kind)
      for (let i = 0; i < img.data.length; i += 4) {
        if (img.data[i + 3] === 0) continue
        expect(palette.has((img.data[i]! << 16) | (img.data[i + 1]! << 8) | img.data[i + 2]!)).toBe(
          true,
        )
      }
    }
  })
  it('all 12 glyphs are pairwise distinct', () => {
    for (let i = 0; i < EMOTE_KINDS.length; i++)
      for (let j = i + 1; j < EMOTE_KINDS.length; j++) {
        const d = cellDistance(renderEmote(EMOTE_KINDS[i]!), renderEmote(EMOTE_KINDS[j]!))
        expect(d, `${EMOTE_KINDS[i]} vs ${EMOTE_KINDS[j]}`).toBeGreaterThan(0.05)
      }
  })
  it('survives a PNG round trip losslessly', async () => {
    for (const kind of EMOTE_KINDS) {
      const img = renderEmote(kind)
      const back = await decodePng(await encodePng(img))
      expect(back.width).toBe(img.width)
      expect(back.height).toBe(img.height)
      expect(back.data).toEqual(img.data)
    }
  })
})

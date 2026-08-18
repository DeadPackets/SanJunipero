import { describe, it, expect } from 'vitest'
import { EMOTE_KINDS, EMOTE_SIZE, renderEmote } from './emotes.js'
import { alphaBinaryGate, paletteGate, pixelGridGate, spriteDensity } from './pixelGates.js'
import { TOWN_TILE } from './assetResolution.js'
import { CHAR_FIGURE_PX } from './reCell.js'
import {
  STATUS_ICON_PX, STATUS_ICON_SCALE, STATUS_ICON_WORLD_PX, statusIcon, statusIconAtlas,
} from './statusIcons.js'

describe('the status icon bar', () => {
  it('RED-proves the defect: the authored glyph is ONE art pixel per world pixel', () => {
    // characters.ts draws the emote at EMOTE_PX = 16 world px from a 16 px glyph, while the
    // figure beside it now carries 208 art px over 52 world px. The icon is four times less
    // dense than everything around it, which is why it smudges at the deep zoom stops.
    expect(EMOTE_SIZE / STATUS_ICON_WORLD_PX).toBe(1)
    expect(CHAR_FIGURE_PX / 52).toBe(STATUS_ICON_SCALE)
    // and the authored glyph has nothing on a 4 px lattice to draw at that stop
    expect(pixelGridGate(renderEmote('hunger'), STATUS_ICON_SCALE).ok).toBe(false)
  })

  it('delivers the same design at the density the deepest zoom stop draws it', () => {
    expect(STATUS_ICON_PX).toBe(EMOTE_SIZE * STATUS_ICON_SCALE)
    expect(STATUS_ICON_PX / STATUS_ICON_WORLD_PX).toBe(STATUS_ICON_SCALE)
    const icon = statusIcon('hunger')
    expect(icon.width).toBe(STATUS_ICON_PX)
    expect(icon.height).toBe(STATUS_ICON_PX)
  })

  it('is on a whole 4 px lattice, so nothing invented a pixel on the way up', () => {
    for (const kind of EMOTE_KINDS) {
      expect(pixelGridGate(statusIcon(kind), STATUS_ICON_SCALE).failures, kind).toEqual([])
    }
  })

  it('every glyph clears alpha and palette', () => {
    for (const kind of EMOTE_KINDS) {
      expect(alphaBinaryGate(statusIcon(kind)).failures, kind).toEqual([])
      expect(paletteGate(statusIcon(kind)).failures, kind).toEqual([])
    }
  })

  it('carries the authored art exactly — a block is the pixel it came from', () => {
    const src = renderEmote('heart'), out = statusIcon('heart')
    for (let y = 0; y < EMOTE_SIZE; y++) for (let x = 0; x < EMOTE_SIZE; x++) {
      const s = (y * EMOTE_SIZE + x) * 4
      const d = ((y * STATUS_ICON_SCALE) * STATUS_ICON_PX + x * STATUS_ICON_SCALE) * 4
      expect([...out.data.slice(d, d + 4)]).toEqual([...src.data.slice(s, s + 4)])
    }
  })

  it('the atlas is one row of glyphs in the published order', () => {
    const a = statusIconAtlas()
    expect(a.width).toBe(EMOTE_KINDS.length * STATUS_ICON_PX)
    expect(a.height).toBe(STATUS_ICON_PX)
    expect(pixelGridGate(a, STATUS_ICON_SCALE).failures).toEqual([])
  })

  it('shares the density the world sprites now use', () => {
    // a 1x1 building is 256 art px over 32*(1+1) world px; the icon is 64 over 16
    expect(spriteDensity({ canvas: { w: 256, h: 256 }, footprint: { w: 1, h: 1 }, tile: TOWN_TILE }))
      .toBe(STATUS_ICON_PX / STATUS_ICON_WORLD_PX * 2)
  })
})

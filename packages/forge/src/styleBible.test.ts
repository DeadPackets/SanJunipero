import { describe, it, expect } from 'vitest'
import { buildAssetPrompt, targetSize, STYLE_PROMPT } from './styleBible.js'

describe('style bible prompts', () => {
  it('boilerplate demands magenta background and forbids anti-aliasing', () => {
    expect(STYLE_PROMPT).toContain('#FF00FF')
    expect(STYLE_PROMPT.toLowerCase()).toContain('no anti-aliasing')
  })
  it('asset prompt embeds boilerplate, description, and footprint', () => {
    const p = buildAssetPrompt('a stone bakery with a fat chimney', { w: 2, h: 2 }, 'building')
    expect(p).toContain(STYLE_PROMPT)
    expect(p).toContain('stone bakery')
    expect(p).toContain('2x2')
  })
  it('crop prompts ask for 4 growth stages', () => {
    expect(buildAssetPrompt('wheat', { w: 1, h: 1 }, 'crop')).toMatch(/4 growth stages/i)
  })
  it('non-character prompts carry the style-anchor density clause; character prompts do not', () => {
    const clause = 'match the pixel density, palette warmth, and cute rounded style of the first reference image exactly'
    for (const klass of ['building', 'item', 'crop', 'terrain'] as const)
      expect(buildAssetPrompt('x', { w: 1, h: 1 }, klass)).toContain(clause)
    for (const klass of ['rig-part', 'portrait'] as const)
      expect(buildAssetPrompt('x', { w: 1, h: 1 }, klass)).not.toContain(clause)
  })
  it('targetSize: 1x1 building is 64px, per Style Bible', () => {
    expect(targetSize('building', { w: 1, h: 1 })).toEqual({ w: 64, h: 64 })
    expect(targetSize('building', { w: 4, h: 4 })).toEqual({ w: 256, h: 256 })
    expect(targetSize('item', { w: 1, h: 1 })).toEqual({ w: 24, h: 24 })
    expect(targetSize('crop', { w: 1, h: 1 })).toEqual({ w: 128, h: 32 })
    expect(targetSize('rig-part', { w: 1, h: 1 })).toEqual({ w: 128, h: 32 })
    expect(targetSize('terrain', { w: 1, h: 1 })).toEqual({ w: 128, h: 64 })
    expect(targetSize('portrait', { w: 1, h: 1 })).toEqual({ w: 256, h: 256 })
  })
})

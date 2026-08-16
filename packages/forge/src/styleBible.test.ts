import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildAssetPrompt, targetSize, STYLE_PROMPT } from './styleBible.js'

// The bible wraps its lines, so every scan runs over whitespace-collapsed text —
// otherwise a law can be "absent" purely because it straddles a newline.
const BIBLE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'content', 'style-bible.md'), 'utf8')
  .replace(/\s+/g, ' ')

describe('style bible facing law (narrowed by C13)', () => {
  it('no longer claims the facing gate is never automated', () => {
    expect(BIBLE).not.toContain('Never automated, never claimed by the pipeline')
  })
  it('keeps the human eyeball as the final authority for masters', () => {
    expect(BIBLE).toContain('FINAL and ONLY authority for masters')
    expect(BIBLE).toContain('SCREENS facing')
  })
  it('does not erode the neighbouring buildings-never-mirror law', () => {
    expect(BIBLE).toContain('NEVER mirror BUILDING sprites')
  })
})

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

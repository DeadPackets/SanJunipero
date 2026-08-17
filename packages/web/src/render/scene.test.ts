import { describe, expect, it } from 'vitest'
import { BACKGROUND, rendererOptions } from './scene.js'

const root = {} as HTMLElement

describe('rendererOptions (B1 — the canvas at the screen’s own resolution)', () => {
  it('gives the backing store one pixel per device pixel', () => {
    expect(rendererOptions(root, 2).resolution).toBe(2)
    expect(rendererOptions(root, 3).resolution).toBe(3)
  })

  it('lets Pixi keep the CSS box while the buffer grows under it', () => {
    expect(rendererOptions(root, 2).autoDensity).toBe(true)
  })

  it('falls back to 1 when the display reports no usable ratio', () => {
    expect(rendererOptions(root, 0).resolution).toBe(1)
    expect(rendererOptions(root, Number.NaN).resolution).toBe(1)
    expect(rendererOptions(root, -2).resolution).toBe(1)
  })

  it('keeps every pixel-art law the renderer already carried', () => {
    const o = rendererOptions(root, 2)
    expect(o.antialias).toBe(false)
    expect(o.roundPixels).toBe(true)
    expect(o.background).toBe(BACKGROUND)
    expect(o.resizeTo).toBe(root)
  })
})

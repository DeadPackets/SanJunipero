import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { postProcess } from './postProcess.js'
import { decodePng } from './raw.js'

// 64x64 magenta field with a 32x32 red square centered — a fake "generation"
async function fakeGeneration(): Promise<Buffer> {
  const red = await sharp({ create: { width: 32, height: 32, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer()
  return sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 255, g: 0, b: 255, alpha: 1 } } })
    .composite([{ input: red, left: 16, top: 16 }]).png().toBuffer()
}

describe('postProcess', () => {
  it('building: keys magenta, downscales NEAREST, quantizes, outlines', async () => {
    const out = await decodePng(await postProcess(await fakeGeneration(), 'building', { w: 32, h: 32 }))
    expect(out.width).toBe(32); expect(out.height).toBe(32)
    // corners were magenta → transparent
    expect(out.data[3]).toBe(0)
    // center of the red square → terracotta #E8785A (nearest palette color to pure red)
    const c = ((16 * 32) + 16) * 4
    expect([...out.data.slice(c, c + 4)]).toEqual([0xe8, 0x78, 0x5a, 255])
    // square edge pixels are darker than the center (outline applied)
    const e = ((8 * 32) + 16) * 4 // top edge of the downscaled square
    const lum = (i: number) => out.data[i]! + out.data[i + 1]! + out.data[i + 2]!
    expect(out.data[e + 3]).toBe(255)
    expect(lum(e)).toBeLessThan(lum(c))
  })
  it('terrain: no chroma-key, no outline — magenta-free sheet stays fully opaque', async () => {
    const sheet = await sharp({ create: { width: 64, height: 32, channels: 4, background: { r: 150, g: 180, b: 120, alpha: 1 } } }).png().toBuffer()
    const out = await decodePng(await postProcess(sheet, 'terrain', { w: 32, h: 16 }))
    for (let i = 3; i < out.data.length; i += 4) expect(out.data[i]).toBe(255)
    // still quantized: every pixel is a palette color (sage snap)
    expect([...out.data.slice(0, 3)]).toEqual([0x93, 0xb5, 0x73])
  })
})

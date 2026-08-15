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
  it('non-square terrain target: square generation is band-cropped, x/y scale stays equal', async () => {
    // 512x512 sage field with a 128x128 red square centered; target 128x64 (2:1)
    const red = await sharp({ create: { width: 128, height: 128, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer()
    const gen = await sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 150, g: 180, b: 120, alpha: 1 } } })
      .composite([{ input: red, left: 192, top: 192 }]).png().toBuffer()
    const out = await decodePng(await postProcess(gen, 'terrain', { w: 128, h: 64 }))
    expect(out.width).toBe(128); expect(out.height).toBe(64)
    // red quantizes to terracotta #E8785A; its block must stay square (32x32), not 32x16
    let minX = 128, maxX = -1, minY = 64, maxY = -1
    for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) {
      const i = (y * 128 + x) * 4
      if (out.data[i] === 0xe8 && out.data[i + 1] === 0x78 && out.data[i + 2] === 0x5a) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x)
        minY = Math.min(minY, y); maxY = Math.max(maxY, y)
      }
    }
    expect(maxX - minX + 1).toBe(32)
    expect(maxY - minY + 1).toBe(32) // was 16 with independent axis ratios
  })
  it('non-square keyed target (crop, 128x32): sprite keeps its proportions', async () => {
    // 512x512 magenta field with a 64x64 red sprite centered; target 128x32 (4:1)
    const red = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer()
    const gen = await sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 255, g: 0, b: 255, alpha: 1 } } })
      .composite([{ input: red, left: 224, top: 224 }]).png().toBuffer()
    const out = await decodePng(await postProcess(gen, 'crop', { w: 128, h: 32 }))
    expect(out.width).toBe(128); expect(out.height).toBe(32)
    // opaque bbox after chroma-key must be square: 16x16 (4x downscale on BOTH axes)
    let minX = 128, maxX = -1, minY = 32, maxY = -1
    for (let y = 0; y < 32; y++) for (let x = 0; x < 128; x++) {
      if (out.data[(y * 128 + x) * 4 + 3] !== 0) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x)
        minY = Math.min(minY, y); maxY = Math.max(maxY, y)
      }
    }
    expect(maxX - minX + 1).toBe(16)
    expect(maxY - minY + 1).toBe(16) // was 4 with independent axis ratios (16x vertical squash)
  })
  it('terrain: no chroma-key, no outline — magenta-free sheet stays fully opaque', async () => {
    const sheet = await sharp({ create: { width: 64, height: 32, channels: 4, background: { r: 150, g: 180, b: 120, alpha: 1 } } }).png().toBuffer()
    const out = await decodePng(await postProcess(sheet, 'terrain', { w: 32, h: 16 }))
    for (let i = 3; i < out.data.length; i += 4) expect(out.data[i]).toBe(255)
    // still quantized: every pixel is a palette color (sage snap)
    expect([...out.data.slice(0, 3)]).toEqual([0x93, 0xb5, 0x73])
  })
})

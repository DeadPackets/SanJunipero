import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { postProcess } from './postProcess.js'
import { decodePng, type RawImage } from './raw.js'

function uniqueColours(img: RawImage): number {
  const seen = new Set<number>()
  for (let i = 0; i < img.data.length; i += 4)
    if (img.data[i + 3] !== 0)
      seen.add((img.data[i]! << 16) | (img.data[i + 1]! << 8) | img.data[i + 2]!)
  return seen.size
}

function alphaValues(img: RawImage): number[] {
  const seen = new Set<number>()
  for (let i = 3; i < img.data.length; i += 4) seen.add(img.data[i]!)
  return [...seen].sort((a, b) => a - b)
}

function opaqueBox(img: RawImage): { w: number; h: number } {
  let x0 = img.width,
    x1 = -1,
    y0 = img.height,
    y1 = -1
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++)
      if (img.data[(y * img.width + x) * 4 + 3] !== 0) {
        x0 = Math.min(x0, x)
        x1 = Math.max(x1, x)
        y0 = Math.min(y0, y)
        y1 = Math.max(y1, y)
      }
  return { w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

/** A block no two pixels of which share a colour, so a palette snap is visible as a colour count. */
async function manyColoured(w: number, h: number): Promise<Buffer> {
  const data = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      data[i] = 40 + (x % 200)
      data[i + 1] = 100 + (y % 156) // >72, so the chroma key never takes the subject
      data[i + 2] = 40 + ((x + y) % 200)
      data[i + 3] = 255
    }
  return sharp(data, { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toBuffer()
}

/** A subject of `w`x`h` centred on the magenta field a generation is asked for. */
async function onMagenta(gen: number, subject: Buffer, w: number, h: number): Promise<Buffer> {
  return sharp({
    create: {
      width: gen,
      height: gen,
      channels: 4,
      background: { r: 255, g: 0, b: 255, alpha: 1 },
    },
  })
    .composite([{ input: subject, left: (gen - w) >> 1, top: (gen - h) >> 1 }])
    .png()
    .toBuffer()
}

describe('postProcess — keyed classes', () => {
  it('★ a many-coloured generation keeps its colours: nothing snaps to MASTER_PALETTE', async () => {
    const gen = await onMagenta(512, await manyColoured(384, 384), 384, 384)
    const out = await decodePng(await postProcess(gen, 'building', { w: 128, h: 128 }))
    expect([out.width, out.height]).toEqual([128, 128])
    expect(uniqueColours(out)).toBeGreaterThan(1_000)
    expect(alphaValues(out)).toEqual([0, 255]) // binary: no outline pass, no soft edge
  })

  it('★ and so does the real house/sw generation', async () => {
    const raw = readFileSync(new URL('../fixtures/house-sw-raw.png', import.meta.url))
    const out = await decodePng(await postProcess(raw, 'building', { w: 128, h: 128 }))
    expect([out.width, out.height]).toEqual([128, 128])
    expect(uniqueColours(out)).toBeGreaterThan(1_000) // the quantized chain shipped 29
    expect(alphaValues(out)).toEqual([0, 255])
    // feet anchor: the subject's last row is the cell's last row, so a building keeps its base
    let feet = -1
    for (let x = 0; x < 128; x++) if (out.data[(127 * 128 + x) * 4 + 3] !== 0) feet = 127
    expect(feet).toBe(127)
  })

  it('non-square target (crop, 128x32): a 4:1 subject keeps its proportions', async () => {
    const gen = await onMagenta(512, await manyColoured(256, 64), 256, 64)
    const out = await decodePng(await postProcess(gen, 'crop', { w: 128, h: 32 }))
    expect([out.width, out.height]).toEqual([128, 32])
    const box = opaqueBox(out)
    // one whole factor on both axes: 248x56 eroded source ÷ 2, so the aspect is untouched
    expect(box.w / box.h).toBeCloseTo(248 / 56, 1)
  })

  it('a generation with no magenta to key is a failed candidate, not a silent bad sprite', async () => {
    const flat = await sharp({
      create: { width: 512, height: 512, channels: 4, background: { r: 10, g: 20, b: 30 } },
    })
      .png()
      .toBuffer()
    await expect(postProcess(flat, 'item', { w: 128, h: 128 })).rejects.toThrow()
  })
})

describe('postProcess — unkeyed classes', () => {
  it('★ terrain: whole-factor median downscale, fully opaque, colours intact', async () => {
    const sheet = await manyColoured(512, 512)
    const out = await decodePng(await postProcess(sheet, 'terrain', { w: 128, h: 64 }))
    expect([out.width, out.height]).toEqual([128, 64])
    expect(alphaValues(out)).toEqual([255]) // no chroma key on a sheet with no background
    expect(uniqueColours(out)).toBeGreaterThan(1_000)
  })

  it('a square generation is band-cropped, so x and y keep the same scale', async () => {
    const red = await sharp({
      create: {
        width: 128,
        height: 128,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 1 },
      },
    })
      .png()
      .toBuffer()
    const gen = await sharp({
      create: {
        width: 512,
        height: 512,
        channels: 4,
        background: { r: 150, g: 180, b: 120, alpha: 1 },
      },
    })
      .composite([{ input: red, left: 192, top: 192 }])
      .png()
      .toBuffer()
    const out = await decodePng(await postProcess(gen, 'terrain', { w: 128, h: 64 }))
    let minX = 128,
      maxX = -1,
      minY = 64,
      maxY = -1
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 128; x++) {
        const i = (y * 128 + x) * 4
        if (out.data[i] === 255 && out.data[i + 1] === 0 && out.data[i + 2] === 0) {
          minX = Math.min(minX, x)
          maxX = Math.max(maxX, x)
          minY = Math.min(minY, y)
          maxY = Math.max(maxY, y)
        }
      }
    expect(maxX - minX + 1).toBe(32)
    expect(maxY - minY + 1).toBe(32) // was 16 with independent axis ratios
  })
})

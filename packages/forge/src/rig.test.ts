import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { swapColors, composeLayers, composeCharacter, RigManifest } from './rig.js'
import { encodePng } from './post/raw.js'

const px = (r: number, g: number, b: number, a = 255) => [r, g, b, a]

describe('swapColors', () => {
  it('swaps exact ramp colors and leaves everything else alone', () => {
    const img = { width: 2, height: 1, data: new Uint8ClampedArray([...px(10, 10, 10), ...px(99, 99, 99)]) }
    const out = swapColors(img, [[10, 10, 10]], [[200, 100, 50]])
    expect([...out.data.slice(0, 4)]).toEqual(px(200, 100, 50))
    expect([...out.data.slice(4, 8)]).toEqual(px(99, 99, 99))
  })
})

describe('composeLayers', () => {
  it('binary alpha-over: top opaque wins, transparent reveals below', () => {
    const bottom = { width: 2, height: 1, data: new Uint8ClampedArray([...px(1, 1, 1), ...px(2, 2, 2)]) }
    const top = { width: 2, height: 1, data: new Uint8ClampedArray([...px(9, 9, 9), ...px(0, 0, 0, 0)]) }
    const out = composeLayers([bottom, top])
    expect([...out.data.slice(0, 4)]).toEqual(px(9, 9, 9))
    expect([...out.data.slice(4, 8)]).toEqual(px(2, 2, 2))
  })
  it('throws on layer size mismatch', () => {
    const a = { width: 1, height: 1, data: new Uint8ClampedArray(4) }
    const b = { width: 2, height: 1, data: new Uint8ClampedArray(8) }
    expect(() => composeLayers([a, b])).toThrow(/size/)
  })
})

describe('RigManifest', () => {
  it('validates the committed content manifest shape', () => {
    const m = RigManifest.parse({
      bodies: [{ id: 'body-a', age: 'adult', file: 'body-a-adult.png' }],
      hair: [{ id: 'braid', file: 'hair-braid.png', ramp: ['#F2C879', '#E0A95E', '#C68A48', '#7E512B'] }],
      clothing: [{ id: 'tunic', file: 'clothing-tunic.png', ramp: ['#DCE8C8', '#B9D19A', '#93B573', '#4F7040'] }],
    })
    expect(m.bodies[0]!.age).toBe('adult')
  })
})

// content/rigs/ does not exist until Step 4 curation, so composeCharacter is
// exercised against a temp dir: manifest + sheets written in beforeAll.
describe('composeCharacter (temp content dir)', () => {
  let dir: string
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'forge-rig-'))
    const png = (w: number, h: number, ...pixels: number[][]) =>
      encodePng({ width: w, height: h, data: new Uint8ClampedArray(pixels.flat()) })
    // 2x1 sheets: pixel0 clothing-opaque, pixel1 hair-opaque
    writeFileSync(join(dir, 'body.png'), await png(2, 1, px(10, 10, 10), px(20, 20, 20)))
    writeFileSync(join(dir, 'clothing.png'), await png(2, 1, px(30, 30, 30), px(0, 0, 0, 0))) // 30,30,30 = #1E1E1E (ramp idx 2)
    writeFileSync(join(dir, 'hair.png'), await png(2, 1, px(0, 0, 0, 0), px(40, 40, 40))) // 40,40,40 = #282828 (ramp idx 3)
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
      bodies: [{ id: 'body-a', age: 'adult', file: 'body.png' }],
      hair: [{ id: 'braid', file: 'hair.png', ramp: ['#0A0A0A', '#141414', '#1E1E1E', '#282828'] }],
      clothing: [{ id: 'tunic', file: 'clothing.png', ramp: ['#0A0A0A', '#141414', '#1E1E1E', '#282828'] }],
    }))
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('loads manifest + sheets, re-skins ramps, composes body←clothing←hair', async () => {
    const out = await composeCharacter({
      body: 'body-a', age: 'adult',
      hair: { id: 'braid', ramp: ['#F7A66B', '#E8785A', '#8A6FA8', '#F4E289'] },
      clothing: { id: 'tunic', ramp: ['#F2C6C2', '#E09E9B', '#C47876', '#9E5A5C'] },
    }, dir)
    expect(out.width).toBe(2); expect(out.height).toBe(1)
    expect([...out.data.slice(0, 4)]).toEqual(px(196, 120, 118)) // clothing #1E1E1E → #C47876
    expect([...out.data.slice(4, 8)]).toEqual(px(244, 226, 137)) // hair #282828 → #F4E289
  })

  it('composes a body-only spec (optional layers)', async () => {
    const out = await composeCharacter({ body: 'body-a', age: 'adult' }, dir)
    expect([...out.data.slice(0, 4)]).toEqual(px(10, 10, 10))
    expect([...out.data.slice(4, 8)]).toEqual(px(20, 20, 20))
  })

  it('rejects an unknown body id', async () => {
    await expect(composeCharacter({ body: 'nope', age: 'adult' }, dir)).rejects.toThrow(/no rig body/)
  })
})

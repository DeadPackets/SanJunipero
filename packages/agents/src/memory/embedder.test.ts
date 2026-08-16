import { describe, expect, it } from 'vitest'
import { Embedder, cosine } from './embedder.js'
import { FakeEmbedder } from '../testutil/fakeEmbedder.js'

describe('Embedder (real bge-small-en-v1.5)', () => {
  it(
    'embeds to a deterministic 384-dim unit vector with sane semantics',
    { timeout: 300_000 },
    async () => {
      const e = await Embedder.create()
      const v = await e.embed('fishing at the river fork')
      expect(v.length).toBe(384)
      expect(Math.hypot(...v)).toBeCloseTo(1, 3)
      expect(await e.embed('fishing at the river fork')).toEqual(v) // deterministic
      const near = cosine(v, await e.embed('catching fish by the water'))
      const far = cosine(v, await e.embed('a funeral in deep winter snow'))
      expect(near).toBeGreaterThan(far)
    },
  )
})

describe('FakeEmbedder', () => {
  it('is deterministic: identical text gives an identical vector', async () => {
    const e = await FakeEmbedder.create()
    const a = await e.embed('fishing at the river fork')
    const b = await e.embed('fishing at the river fork')
    expect(a).toEqual(b)
    expect(a.length).toBe(384)
  })

  it('gives different text a distinct direction (cosine < 0.9)', async () => {
    const e = await FakeEmbedder.create()
    const a = await e.embed('fishing at the river fork')
    const b = await e.embed('a funeral in deep winter snow')
    expect(cosine(a, b)).toBeLessThan(0.9)
  })

  it('produces unit-norm vectors', async () => {
    const e = await FakeEmbedder.create()
    const v = await e.embed('anything at all')
    expect(Math.hypot(...v)).toBeCloseTo(1, 6)
  })

  it('cosine of a vector with itself is 1', async () => {
    const e = await FakeEmbedder.create()
    const v = await e.embed('self similarity')
    expect(cosine(v, v)).toBeCloseTo(1, 6)
  })
})

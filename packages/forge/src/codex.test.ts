import { describe, it, expect } from 'vitest'
import { openForgeDb } from './db.js'
import { AssetCodex } from './codex.js'

const input = {
  class: 'item' as const, desc: 'a wooden bucket', footprint: { w: 1, h: 1 },
  png: Buffer.from('png-bytes'), widthPx: 24, heightPx: 24,
  status: 'ready' as const, score: 8.2, attempts: 1, costUsd: 0.14,
}

describe('AssetCodex', () => {
  it('register → get round-trips record and png blob', () => {
    const codex = new AssetCodex(openForgeDb(':memory:'))
    const rec = codex.register(input)
    expect(rec.seq).toBe(1)
    const got = codex.get(rec.id)!
    expect(got.record).toEqual(rec)
    expect(got.png.toString()).toBe('png-bytes')
  })
  it('listSince returns records after the given seq, in order', () => {
    const codex = new AssetCodex(openForgeDb(':memory:'))
    codex.register(input)
    const b = codex.register({ ...input, desc: 'a clay pot' })
    expect(codex.listSince(1).map(r => r.id)).toEqual([b.id])
  })
  it('fires onAssetReady with the registered record', () => {
    const codex = new AssetCodex(openForgeDb(':memory:'))
    const seen: string[] = []
    codex.onAssetReady(r => seen.push(r.desc))
    codex.register(input)
    expect(seen).toEqual(['a wooden bucket'])
  })
  it('register validates input before insert — failed registers leave no poison rows', () => {
    const codex = new AssetCodex(openForgeDb(':memory:'))
    expect(() => codex.register({ ...input, footprint: { w: 5, h: 5 } })).toThrow()
    expect(() => codex.register({ ...input, attempts: 0 })).toThrow()
    const ok = codex.register(input)
    expect(ok.seq).toBe(1)
    expect(codex.listSince(0)).toEqual([ok])
  })
})

import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { createForge } from './forge.js'
import { openForgeDb } from './db.js'
import { AssetCodex } from './codex.js'
import type { ImageClient, Candidate } from './imageClient.js'
import type { JudgeFn } from './judge.js'

// a valid 512x512 "generation": magenta field, sage square centered
async function goodPng(): Promise<Buffer> {
  const inner = await sharp({ create: { width: 256, height: 256, channels: 4, background: { r: 147, g: 181, b: 115, alpha: 1 } } }).png().toBuffer()
  return sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 255, g: 0, b: 255, alpha: 1 } } })
    .composite([{ input: inner, left: 128, top: 128 }]).png().toBuffer()
}

function fakeClient(png: Buffer, log: number[]): ImageClient {
  return { async generateCandidates(_p, _r, n = 3) {
    log.push(n)
    return Array.from({ length: n }, (): Candidate => ({ png, model: 'fake', costUsd: 0.045 }))
  } }
}
function scriptedJudge(scores: number[]): JudgeFn {
  let i = 0
  return async () => ({ score: scores[Math.min(i++, scores.length - 1)]!, notes: 'scripted' })
}

describe('createForge().commission', () => {
  it('ships on first attempt when a candidate scores >= 7', async () => {
    const codex = new AssetCodex(openForgeDb(':memory:'))
    const gens: number[] = []
    const ready: string[] = []
    const forge = createForge({ client: fakeClient(await goodPng(), gens), judge: scriptedJudge([8]), codex, refs: [Buffer.from('r')] })
    forge.onAssetReady(r => ready.push(r.status))
    const rec = await forge.commission('a sage tent', { w: 1, h: 1 }, 'building')
    expect(rec.status).toBe('ready')
    expect(rec.score).toBe(8)
    expect(rec.attempts).toBe(1)
    expect(rec.widthPx).toBe(64) // 1x1 building = 64px per Style Bible
    expect(gens).toEqual([3])    // one attempt, 3 candidates
    expect(ready).toEqual(['ready'])
    expect(rec.costUsd).toBeGreaterThan(0.13) // 3 gens + judges
  })
  it('retries on low scores and ships on a later attempt', async () => {
    const codex = new AssetCodex(openForgeDb(':memory:'))
    const gens: number[] = []
    // attempts 1+2: all 3 candidates score 5; attempt 3: scores 9
    const judge = scriptedJudge([5, 5, 5, 5, 5, 5, 9])
    const forge = createForge({ client: fakeClient(await goodPng(), gens), judge, codex, refs: [] })
    const rec = await forge.commission('a stubborn barn', { w: 2, h: 1 }, 'building')
    expect(rec.status).toBe('ready')
    expect(rec.attempts).toBe(3)
    expect(gens).toEqual([3, 3, 3])
  })
  it('falls back to a placeholder after 3 failed attempts', async () => {
    const codex = new AssetCodex(openForgeDb(':memory:'))
    const forge = createForge({ client: fakeClient(await goodPng(), []), judge: scriptedJudge([2]), codex, refs: [] })
    const rec = await forge.commission('an impossible ask', { w: 1, h: 1 }, 'item')
    expect(rec.status).toBe('placeholder')
    expect(rec.score).toBeNull()
    expect(rec.attempts).toBe(3)
    expect(codex.get(rec.id)).not.toBeNull() // placeholder is registered and hot-loadable
  })
  it('a generateCandidates throw on every attempt still yields a placeholder, never a rejection', async () => {
    const codex = new AssetCodex(openForgeDb(':memory:'))
    let calls = 0
    const client: ImageClient = { async generateCandidates() { calls++; throw new Error('provider outage') } }
    const forge = createForge({ client, judge: scriptedJudge([10]), codex, refs: [] })
    const rec = await forge.commission('unreachable provider', { w: 1, h: 1 }, 'item')
    expect(rec.status).toBe('placeholder')
    expect(rec.score).toBeNull()
    expect(rec.attempts).toBe(3)
    expect(rec.costUsd).toBe(0)
    expect(calls).toBe(3) // each throw consumed one attempt
    expect(codex.get(rec.id)).not.toBeNull()
  })
  it('a generation throw counts as a failed attempt; a later attempt can still ship', async () => {
    const codex = new AssetCodex(openForgeDb(':memory:'))
    const png = await goodPng()
    let calls = 0
    const client: ImageClient = { async generateCandidates(_p, _r, n = 3) {
      if (++calls === 1) throw new Error('transient outage')
      return Array.from({ length: n }, (): Candidate => ({ png, model: 'fake', costUsd: 0.045 }))
    } }
    const forge = createForge({ client, judge: scriptedJudge([9]), codex, refs: [] })
    const rec = await forge.commission('a resilient tent', { w: 1, h: 1 }, 'building')
    expect(rec.status).toBe('ready')
    expect(rec.attempts).toBe(2)
  })
  it('mechanical-gate failures never reach the judge', async () => {
    const codex = new AssetCodex(openForgeDb(':memory:'))
    // all-magenta generation → chroma-keys to fully transparent → gate fails (no opaque pixels ⇒ size ok but requireAlpha ok; palette ok; BUT judge must not run)
    const allMagenta = await sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 255, g: 0, b: 255, alpha: 1 } } }).png().toBuffer()
    let judgeCalls = 0
    const judge: JudgeFn = async () => { judgeCalls++; return { score: 10, notes: '' } }
    const forge = createForge({ client: fakeClient(allMagenta, []), judge, codex, refs: [] })
    const rec = await forge.commission('vapor', { w: 1, h: 1 }, 'item')
    expect(rec.status).toBe('placeholder')
    expect(judgeCalls).toBe(0)
  })
})

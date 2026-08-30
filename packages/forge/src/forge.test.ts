import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { createForge } from './forge.js'
import { openForgeDb } from './db.js'
import { AssetCodex } from './codex.js'
import { DEFAULT_FORGE_CONFIG } from './forgeConfig.js'
import type { ImageClient, Candidate } from './imageClient.js'
import { CRITERIA, deriveOverall, type VisionCriteria } from './visionQa/verdict.js'
import type { VisionJudgeFn } from './visionQa/visionJudge.js'

const JUDGE_USD = 0.0025

// a valid 512x512 "generation": magenta field, sage square centered
async function goodPng(): Promise<Buffer> {
  const inner = await sharp({
    create: {
      width: 256,
      height: 256,
      channels: 4,
      background: { r: 147, g: 181, b: 115, alpha: 1 },
    },
  })
    .png()
    .toBuffer()
  return sharp({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: { r: 255, g: 0, b: 255, alpha: 1 },
    },
  })
    .composite([{ input: inner, left: 128, top: 128 }])
    .png()
    .toBuffer()
}

function fakeClient(png: Buffer, log: number[]): ImageClient {
  return {
    async generateCandidates(_p, _r, n = 3) {
      log.push(n)
      return Array.from({ length: n }, (): Candidate => ({ png, model: 'fake', costUsd: 0.045 }))
    },
  }
}

/** One rubric verdict per call, every criterion on the same score. */
function scriptedJudge(scores: number[]): VisionJudgeFn {
  let i = 0
  return async (a) => {
    const score = scores[Math.min(i++, scores.length - 1)]!
    const criteria = Object.fromEntries(
      CRITERIA.map((k) => [k, { pass: score >= 7, score, evidence: 'seen' }]),
    ) as VisionCriteria
    return {
      costUsd: JUDGE_USD,
      verdict: {
        assetId: a.assetId,
        model: 'google/gemini-3.7-flash',
        rubricVersion: 'v1',
        criteria,
        feedback: 'raise the roof',
        overall: deriveOverall(criteria, {
          minScore: DEFAULT_FORGE_CONFIG.visionQa.minScore,
          attempt: a.attempt ?? 1,
          maxRetries: DEFAULT_FORGE_CONFIG.visionQa.maxRetries,
        }),
      },
    }
  }
}

describe('createForge().commission', () => {
  it('ships on first attempt when the eye passes, on ONE vision call', async () => {
    const codex = new AssetCodex(openForgeDb(':memory:'))
    const gens: number[] = []
    const ready: string[] = []
    const forge = createForge({
      client: fakeClient(await goodPng(), gens),
      judge: scriptedJudge([8]),
      codex,
      refs: [Buffer.from('r')],
    })
    forge.onAssetReady((r) => ready.push(r.status))
    const rec = await forge.commission('a sage tent', { w: 1, h: 1 }, 'building', 'tent')
    expect(rec.status).toBe('ready')
    // class + kind + ready is the whole of the renderer's lookup; a null kind is art nobody finds
    expect([rec.class, rec.kind]).toEqual(['building', 'tent'])
    expect(rec.score).toBe(8)
    expect(rec.attempts).toBe(1)
    expect(rec.widthPx).toBe(64) // 1x1 building = 64px per Style Bible
    expect(gens).toEqual([1]) // one generation, one eye — never a per-candidate fan-out
    expect(ready).toEqual(['ready'])
    expect(rec.costUsd).toBeCloseTo(0.045 + JUDGE_USD, 6)
  })
  it('the eye is shown the commission and its own feedback on a redraw', async () => {
    const codex = new AssetCodex(openForgeDb(':memory:'))
    const prompts: string[] = []
    const png = await goodPng()
    const client: ImageClient = {
      async generateCandidates(prompt) {
        prompts.push(prompt)
        return [{ png, model: 'fake', costUsd: 0.045 }]
      },
    }
    const forge = createForge({ client, judge: scriptedJudge([4, 9]), codex, refs: [] })
    await forge.commission('a leaning shed', { w: 1, h: 1 }, 'building', 'shed')
    expect(prompts[0]).not.toContain('raise the roof')
    // position is law: style boilerplate, then the fix, then the commission
    expect(prompts[1]).toMatch(/Stardew.*raise the roof.*Subject: a leaning shed/s)
  })
  it('retries on a failed verdict and ships on a later attempt', async () => {
    const codex = new AssetCodex(openForgeDb(':memory:'))
    const gens: number[] = []
    const judge = scriptedJudge([5, 5, 9])
    const forge = createForge({ client: fakeClient(await goodPng(), gens), judge, codex, refs: [] })
    const rec = await forge.commission('a stubborn barn', { w: 2, h: 1 }, 'building', 'barn')
    expect(rec.status).toBe('ready')
    expect(rec.attempts).toBe(3)
    expect(gens).toEqual([1, 1, 1])
  })
  it('falls back to a placeholder when the eye blocks every attempt', async () => {
    const codex = new AssetCodex(openForgeDb(':memory:'))
    const forge = createForge({
      client: fakeClient(await goodPng(), []),
      judge: scriptedJudge([2]),
      codex,
      refs: [],
    })
    const rec = await forge.commission('an impossible ask', { w: 1, h: 1 }, 'item', 'relic')
    expect(rec.status).toBe('placeholder')
    expect(rec.score).toBeNull()
    expect(rec.attempts).toBe(3)
    expect(rec.kind).toBe('relic') // the kind is recorded, so the town does not pay again on the next boot
    expect(codex.get(rec.id)).not.toBeNull() // placeholder is registered and hot-loadable
  })
  it('a generateCandidates throw on every try still yields a placeholder, never a rejection', async () => {
    const codex = new AssetCodex(openForgeDb(':memory:'))
    let calls = 0
    const client: ImageClient = {
      async generateCandidates() {
        calls++
        throw new Error('provider outage')
      },
    }
    const forge = createForge({ client, judge: scriptedJudge([10]), codex, refs: [] })
    const rec = await forge.commission('unreachable provider', { w: 1, h: 1 }, 'item', 'relic')
    expect(rec.status).toBe('placeholder')
    expect(rec.score).toBeNull()
    expect(rec.attempts).toBe(3)
    expect(rec.costUsd).toBe(0)
    expect(calls).toBe(2) // each throw consumed one draw try
    expect(codex.get(rec.id)).not.toBeNull()
  })
  it('a generation throw is a failed try; the next try still reaches the eye', async () => {
    const codex = new AssetCodex(openForgeDb(':memory:'))
    const png = await goodPng()
    let calls = 0
    const client: ImageClient = {
      async generateCandidates() {
        if (++calls === 1) throw new Error('transient outage')
        return [{ png, model: 'fake', costUsd: 0.045 }]
      },
    }
    const forge = createForge({ client, judge: scriptedJudge([9]), codex, refs: [] })
    const rec = await forge.commission('a resilient tent', { w: 1, h: 1 }, 'building', 'tent')
    expect(rec.status).toBe('ready')
    expect(rec.attempts).toBe(1)
    expect(calls).toBe(2)
  })
  it('mechanical-gate failures never reach the eye', async () => {
    const codex = new AssetCodex(openForgeDb(':memory:'))
    // all-magenta generation → chroma-keys to fully transparent → the gate refuses it
    const allMagenta = await sharp({
      create: {
        width: 512,
        height: 512,
        channels: 4,
        background: { r: 255, g: 0, b: 255, alpha: 1 },
      },
    })
      .png()
      .toBuffer()
    let judgeCalls = 0
    const judge: VisionJudgeFn = (a) => {
      judgeCalls++
      return scriptedJudge([10])(a)
    }
    const forge = createForge({ client: fakeClient(allMagenta, []), judge, codex, refs: [] })
    const rec = await forge.commission('vapor', { w: 1, h: 1 }, 'item', 'vapor')
    expect(rec.status).toBe('placeholder')
    expect(judgeCalls).toBe(0)
    expect(rec.costUsd).toBeCloseTo(2 * 0.045, 6) // the refused generations are still billed
  })
})

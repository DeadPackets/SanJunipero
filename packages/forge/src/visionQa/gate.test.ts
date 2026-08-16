import { describe, it, expect } from 'vitest'
import type { RawImage } from '../post/raw.js'
import { ForgeConfigSchema, DEFAULT_FORGE_CONFIG } from '../forgeConfig.js'
import { SpendLedger, AnomalyStopError } from '../spendLedger.js'
import { CRITERIA, deriveOverall, type VisionCriteria, type VisionVerdict } from './verdict.js'
import type { VisionJudgeFn } from './visionJudge.js'
import { runVisionGate } from './gate.js'

function art(tag: number): RawImage {
  const img = { width: 2, height: 2, data: new Uint8ClampedArray(16) }
  img.data[0] = tag
  return img
}
function criteria(score: number): VisionCriteria {
  return Object.fromEntries(CRITERIA.map(k => [k, { pass: true, score, evidence: 'seen' }])) as VisionCriteria
}
function verdict(score: number, attempt: number, feedback: string): VisionVerdict {
  const c = criteria(score)
  return {
    assetId: 'asset_1', model: 'google/gemini-3.7-flash', rubricVersion: 'v1', criteria: c, feedback,
    overall: deriveOverall(c, { minScore: 7, attempt, maxRetries: 3 }),
  }
}

const BASE = { boilerplate: 'STYLE.', commissionText: 'a squat storehouse.' }

function harness(scores: number[], judgeCost = 0.0025) {
  const prompts: string[] = []
  const judged: number[] = []
  let n = 0
  const regenerate = async (prompt: string, attempt: number) => {
    prompts.push(prompt)
    return { sprite: art(attempt), costUsd: 0.045, model: 'google/gemini-3.1-flash-image' }
  }
  const judge: VisionJudgeFn = async a => {
    const score = scores[Math.min(n, scores.length - 1)]!
    judged.push(score); n++
    return { verdict: verdict(score, a.attempt ?? 1, `raise the roof ${n}`), costUsd: judgeCost }
  }
  return { prompts, judged, regenerate, judge }
}

const argsFor = (h: ReturnType<typeof harness>, ledger: SpendLedger, config = DEFAULT_FORGE_CONFIG) => ({
  assetId: 'asset_1', klass: 'building', commission: 'a squat storehouse',
  regenerate: h.regenerate, basePrompt: BASE, judge: h.judge, ledger, config,
})

describe('runVisionGate', () => {
  it('passes on the first try with one generation, one judgement, two ledger rows', async () => {
    const h = harness([9]), ledger = new SpendLedger(null)
    const r = await runVisionGate(argsFor(h, ledger))
    expect(r.status).toBe('pass')
    expect(r.attempts).toBe(1)
    expect(h.prompts).toEqual(['STYLE. a squat storehouse.'])
    expect(h.judged).toHaveLength(1)
    expect(ledger.rows()).toHaveLength(2)
    expect(ledger.byKind()).toEqual({ image_gen: 0.045, vision_qa: 0.0025, style_judge: 0 })
    expect(r.spendUsd).toBe(ledger.totalFor('asset_1'))
    expect(r.overQaCap).toBe(false)
  })

  it('puts feedback AFTER the boilerplate and BEFORE the commission, character-for-character', async () => {
    const h = harness([5, 9]), ledger = new SpendLedger(null)
    const r = await runVisionGate(argsFor(h, ledger))
    expect(r.status).toBe('pass')
    expect(r.attempts).toBe(2)
    expect(h.prompts).toHaveLength(2)
    expect(h.prompts[1]).toBe('STYLE. raise the roof 1 a squat storehouse.')
    expect(h.prompts[1]).toBe(`${BASE.boilerplate} raise the roof 1 ${BASE.commissionText}`)
    expect(r.verdicts).toHaveLength(2)
  })

  it('blocks after the retry budget and returns the best-scoring attempt', async () => {
    const h = harness([3, 6, 4, 5]), ledger = new SpendLedger(null)
    const r = await runVisionGate(argsFor(h, ledger))
    expect(r.status).toBe('blocked')
    expect(h.prompts).toHaveLength(4)              // maxRetries 3 + the first try
    expect(r.verdicts).toHaveLength(4)
    expect(r.attempts).toBe(4)
    expect(r.verdicts.at(-1)!.overall).toBe('blocked')
    expect(r.sprite.data[0]).toBe(2)               // attempt 2 scored 6, the highest of the four
  })

  it('skips the judge entirely when the gate is switched off', async () => {
    const h = harness([1]), ledger = new SpendLedger(null)
    const config = ForgeConfigSchema.parse({ visionQa: { enabled: false } })
    const r = await runVisionGate(argsFor(h, ledger, config))
    expect(r.status).toBe('pass')
    expect(r.attempts).toBe(1)
    expect(h.judged).toHaveLength(0)
    expect(r.verdicts).toEqual([])
    expect(ledger.rows()).toHaveLength(1)
  })

  it('reports the QA sub-cap without enforcing it', async () => {
    const h = harness([9], 0.06), ledger = new SpendLedger(null)
    const r = await runVisionGate(argsFor(h, ledger))
    expect(r.overQaCap).toBe(true)
    expect(r.status).toBe('pass')
  })

  it('lets an anomaly stop propagate and generates nothing further', async () => {
    const h = harness([3]), ledger = new SpendLedger(null)
    ledger.append({ assetId: 'asset_1', kind: 'image_gen', model: 'm', usd: 4.99 })
    await expect(runVisionGate(argsFor(h, ledger))).rejects.toThrow(AnomalyStopError)
    expect(h.prompts).toHaveLength(1)
    expect(h.judged).toHaveLength(0)
  })
})

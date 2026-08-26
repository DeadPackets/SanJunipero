import type { Footprint } from '@sj/shared'
import type { RawImage } from '../post/raw.js'
import type { ForgeConfig } from '../forgeConfig.js'
import type { SpendLedger } from '../spendLedger.js'
import { CRITERIA, type VisionVerdict } from './verdict.js'
import type { VisionJudgeFn } from './visionJudge.js'

export type VisionGateArgs = {
  assetId: string
  klass: string
  commission: string
  regenerate: (
    prompt: string,
    attempt: number,
  ) => Promise<{ sprite: RawImage; costUsd: number; model: string }>
  basePrompt: { boilerplate: string; commissionText: string }
  judge: VisionJudgeFn
  ledger: SpendLedger
  config: ForgeConfig
  footprint?: Footprint
  expectedFacing?: string
}

export type VisionGateResult = {
  status: 'pass' | 'blocked'
  sprite: RawImage
  verdicts: VisionVerdict[]
  attempts: number
  spendUsd: number
  overQaCap: boolean
}

const totalScore = (v: VisionVerdict): number =>
  CRITERIA.reduce((s, k) => s + v.criteria[k].score, 0)

export async function runVisionGate(a: VisionGateArgs): Promise<VisionGateResult> {
  const { boilerplate, commissionText } = a.basePrompt
  const verdicts: VisionVerdict[] = []
  const tried: { sprite: RawImage; score: number }[] = []
  let prompt = `${boilerplate} ${commissionText}`
  let attempt = 1
  let qaSpend = 0

  for (;;) {
    const gen = await a.regenerate(prompt, attempt)
    a.ledger.append({ assetId: a.assetId, kind: 'image_gen', model: gen.model, usd: gen.costUsd })

    // The escape hatch for offline / no-key runs: one generation, no eye, and the report says so.
    if (!a.config.visionQa.enabled)
      return {
        status: 'pass',
        sprite: gen.sprite,
        verdicts: [],
        attempts: attempt,
        spendUsd: a.ledger.totalFor(a.assetId),
        overQaCap: false,
      }

    const { verdict, costUsd } = await a.judge({
      assetId: a.assetId,
      klass: a.klass,
      sprite: gen.sprite,
      commission: a.commission,
      footprint: a.footprint,
      expectedFacing: a.expectedFacing,
      attempt,
    })
    a.ledger.append({ assetId: a.assetId, kind: 'vision_qa', model: verdict.model, usd: costUsd })
    qaSpend += costUsd
    verdicts.push(verdict)
    tried.push({ sprite: gen.sprite, score: totalScore(verdict) })

    if (verdict.overall !== 'retry') {
      // ties keep the earliest attempt
      const best = tried.reduce((b, t) => (t.score > b.score ? t : b), tried[0]!)
      return {
        status: verdict.overall === 'pass' ? 'pass' : 'blocked',
        sprite: verdict.overall === 'pass' ? gen.sprite : best.sprite,
        verdicts,
        attempts: attempt,
        spendUsd: a.ledger.totalFor(a.assetId),
        overQaCap: qaSpend > a.config.visionQa.costCapPerAssetUsd,
      }
    }

    // Position is law (addendum §1): style boilerplate, then the fix, then the commission.
    prompt = `${boilerplate} ${verdict.feedback} ${commissionText}`
    attempt++
  }
}

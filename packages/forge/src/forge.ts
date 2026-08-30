import type { Candidate, ImageClient } from './imageClient.js'
import { mechanicalGate } from './gate.js'
import { postProcess } from './post/postProcess.js'
import { decodePng, encodePng, type RawImage } from './post/raw.js'
import { makePlaceholder } from './placeholder.js'
import { assetPromptParts, targetSize } from './styleBible.js'
import { DEFAULT_FORGE_CONFIG } from './forgeConfig.js'
import { SpendLedger } from './spendLedger.js'
import { runVisionGate } from './visionQa/gate.js'
import { CRITERIA, type VisionVerdict } from './visionQa/verdict.js'
import type { VisionJudgeFn } from './visionQa/visionJudge.js'
import type { AssetCodex } from './codex.js'
import type { AssetClass, AssetRecord, Footprint } from '@sj/shared'

export type Forge = {
  commission(
    desc: string,
    footprint: Footprint,
    klass: AssetClass,
    kind: string,
  ): Promise<AssetRecord>
  onAssetReady(cb: (rec: AssetRecord) => void): void
}

const CONFIG = DEFAULT_FORGE_CONFIG
/** The codex `attempts` column accepts 1..3, which is exactly this ceiling. */
const MAX_TRIES = CONFIG.visionQa.maxRetries + 1

/** The codex keeps one 1-10 score; the rubric keeps eight. */
const overallScore = (v: VisionVerdict): number =>
  Math.max(1, CRITERIA.reduce((s, k) => s + v.criteria[k].score, 0) / CRITERIA.length)

export function createForge(deps: {
  client: ImageClient
  judge: VisionJudgeFn
  codex: AssetCodex
  refs: Buffer[]
}): Forge {
  async function commission(
    desc: string,
    footprint: Footprint,
    klass: AssetClass,
    kind: string,
  ): Promise<AssetRecord> {
    const target = targetSize(klass, footprint)
    const requireAlpha = klass !== 'terrain' && klass !== 'portrait'
    const assetId = `${klass}:${kind}`
    const ledger = new SpendLedger(null)

    async function cut(cand: Candidate): Promise<RawImage | null> {
      try {
        const sprite = await decodePng(await postProcess(cand.png, klass, target))
        return mechanicalGate(sprite, { w: target.w, h: target.h, requireAlpha }).ok ? sprite : null
      } catch {
        return null
      }
    }

    // A provider outage or a generation the chain cannot cut is a failed try, not a failed
    // commission; only a sprite that clears the mechanical gate ever costs a vision call.
    async function draw(prompt: string): Promise<{
      sprite: RawImage
      costUsd: number
      model: string
    }> {
      for (let t = 0; t < MAX_TRIES; t++) {
        let cand: Candidate | undefined
        try {
          const out = await deps.client.generateCandidates(prompt, deps.refs, 1)
          cand = out[0]
        } catch {
          continue
        }
        if (cand === undefined) continue
        const sprite = await cut(cand)
        if (sprite !== null) return { sprite, costUsd: cand.costUsd, model: cand.model }
        ledger.append({ assetId, kind: 'image_gen', model: cand.model, usd: cand.costUsd })
      }
      throw new Error(`${assetId}: no generation survived the chain in ${MAX_TRIES} tries`)
    }

    // contract: commission never rejects on generation failure — every path registers an asset
    try {
      const res = await runVisionGate({
        assetId,
        klass,
        commission: desc,
        basePrompt: assetPromptParts(desc, footprint, klass),
        judge: deps.judge,
        ledger,
        config: CONFIG,
        footprint,
        regenerate: draw,
      })
      const last = res.verdicts.at(-1)
      if (res.status === 'pass')
        return deps.codex.register({
          class: klass,
          desc,
          kind,
          footprint,
          png: await encodePng(res.sprite),
          widthPx: target.w,
          heightPx: target.h,
          status: 'ready',
          score: last === undefined ? null : overallScore(last),
          attempts: res.attempts,
          costUsd: res.spendUsd,
        })
    } catch {
      // nothing the chain could cut, or the wallet said stop
    }
    // blocked by the eye or undrawable → placeholder, flagged (status) for silent regeneration
    const png = await encodePng(makePlaceholder(klass, target))
    return deps.codex.register({
      class: klass,
      desc,
      kind,
      footprint,
      png,
      widthPx: target.w,
      heightPx: target.h,
      status: 'placeholder',
      score: null,
      attempts: MAX_TRIES,
      costUsd: ledger.totalFor(assetId),
    })
  }
  return {
    commission,
    onAssetReady: (cb) => {
      deps.codex.onAssetReady(cb)
    },
  }
}

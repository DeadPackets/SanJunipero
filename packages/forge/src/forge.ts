import type { Candidate, ImageClient } from './imageClient.js'
import { mechanicalGate } from './gate.js'
import { postProcessRaw } from './post/postProcess.js'
import { decodePng, encodePng, type RawImage } from './post/raw.js'
import { makePlaceholder } from './placeholder.js'
import { assetPromptParts, targetSize } from './styleBible.js'
import { loadForgeConfig, type ForgeConfig } from './forgeConfig.js'
import { SpendLedger } from './spendLedger.js'
import { runVisionGate } from './visionQa/gate.js'
import { CRITERIA, totalScore } from './visionQa/verdict.js'
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

/** The codex `attempts` column accepts 1..3, so the eye never gets a longer leash than that. */
const MAX_ATTEMPTS = 3
/** Separate from the eye's retries: a generation the chain cannot cut is worth one more roll. */
const DRAW_TRIES = 2

export function createForge(deps: {
  client: ImageClient
  judge: VisionJudgeFn
  codex: AssetCodex
  refs: Buffer[]
  config?: ForgeConfig
}): Forge {
  const asked = deps.config ?? loadForgeConfig()
  const config: ForgeConfig = {
    ...asked,
    visionQa: {
      ...asked.visionQa,
      maxRetries: Math.min(asked.visionQa.maxRetries, MAX_ATTEMPTS - 1),
    },
  }

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

    function cut(gen: RawImage): RawImage | null {
      try {
        const sprite = postProcessRaw(gen, klass, target)
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
      for (let t = 0; t < DRAW_TRIES; t++) {
        let cand: Candidate | undefined
        try {
          const out = await deps.client.generateCandidates(prompt, deps.refs, 1)
          cand = out[0]
        } catch {
          continue
        }
        if (cand === undefined) continue
        const sprite = cut(await decodePng(cand.png))
        if (sprite !== null) return { sprite, costUsd: cand.costUsd, model: cand.model }
        ledger.append({ assetId, kind: 'image_gen', model: cand.model, usd: cand.costUsd })
      }
      throw new Error(`${assetId}: no generation survived the chain in ${DRAW_TRIES} tries`)
    }

    // contract: commission never rejects on generation failure — every path registers an asset
    const res = await runVisionGate({
      assetId,
      klass,
      commission: desc,
      basePrompt: assetPromptParts(desc, footprint, klass),
      judge: deps.judge,
      ledger,
      config,
      footprint,
      regenerate: draw,
    }).catch(() => null)

    const last = res?.verdicts.at(-1)
    const png =
      res?.status === 'pass'
        ? await encodePng(res.sprite)
        : await encodePng(makePlaceholder(klass, target))
    return deps.codex.register({
      class: klass,
      desc,
      kind,
      footprint,
      png,
      widthPx: target.w,
      heightPx: target.h,
      // blocked by the eye, or nothing the chain could cut → placeholder, flagged for regeneration
      status: res?.status === 'pass' ? 'ready' : 'placeholder',
      score:
        res?.status === 'pass' && last !== undefined
          ? Math.max(1, totalScore(last) / CRITERIA.length)
          : null,
      attempts: res?.attempts ?? MAX_ATTEMPTS,
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

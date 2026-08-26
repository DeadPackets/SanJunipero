import type { Candidate, ImageClient } from './imageClient.js'
import type { JudgeFn } from './judge.js'
import { EST_COST_PER_JUDGE } from './judge.js'
import { mechanicalGate, PASS_SCORE, MAX_ATTEMPTS, CANDIDATES_PER_ATTEMPT } from './gate.js'
import { postProcess } from './post/postProcess.js'
import { decodePng, encodePng } from './post/raw.js'
import { makePlaceholder } from './placeholder.js'
import { buildAssetPrompt, targetSize } from './styleBible.js'
import type { AssetCodex } from './codex.js'
import type { AssetClass, AssetRecord, Footprint } from '@sj/shared'

export type Forge = {
  commission(desc: string, footprint: Footprint, klass: AssetClass): Promise<AssetRecord>
  onAssetReady(cb: (rec: AssetRecord) => void): void
}

export function createForge(deps: {
  client: ImageClient
  judge: JudgeFn
  codex: AssetCodex
  refs: Buffer[]
}): Forge {
  async function commission(
    desc: string,
    footprint: Footprint,
    klass: AssetClass,
  ): Promise<AssetRecord> {
    const target = targetSize(klass, footprint)
    const prompt = buildAssetPrompt(desc, footprint, klass)
    const requireAlpha = klass !== 'terrain' && klass !== 'portrait'
    let costUsd = 0

    // contract: commission never rejects on generation failure — every path registers an asset (ready or placeholder)
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let candidates: Candidate[]
      try {
        candidates = await deps.client.generateCandidates(prompt, deps.refs, CANDIDATES_PER_ATTEMPT)
      } catch {
        continue
      } // provider outage / budget cap = a failed attempt, not an escaped throw
      costUsd += candidates.reduce((s, c) => s + c.costUsd, 0)

      let best: { png: Buffer; score: number } | null = null
      for (const cand of candidates) {
        const png = await postProcess(cand.png, klass, target)
        if (!mechanicalGate(await decodePng(png), { w: target.w, h: target.h, requireAlpha }).ok)
          continue
        const verdict = await deps.judge(png)
        costUsd += EST_COST_PER_JUDGE
        if (verdict.score >= PASS_SCORE && (!best || verdict.score > best.score))
          best = { png, score: verdict.score }
      }
      if (best) {
        return deps.codex.register({
          class: klass,
          desc,
          footprint,
          png: best.png,
          widthPx: target.w,
          heightPx: target.h,
          status: 'ready',
          score: best.score,
          attempts: attempt,
          costUsd,
        })
      }
    }
    // all attempts exhausted → placeholder, flagged (status) for silent regeneration
    const png = await encodePng(makePlaceholder(klass, target))
    return deps.codex.register({
      class: klass,
      desc,
      footprint,
      png,
      widthPx: target.w,
      heightPx: target.h,
      status: 'placeholder',
      score: null,
      attempts: MAX_ATTEMPTS,
      costUsd,
    })
  }
  return {
    commission,
    onAssetReady: (cb) => {
      deps.codex.onAssetReady(cb)
    },
  }
}

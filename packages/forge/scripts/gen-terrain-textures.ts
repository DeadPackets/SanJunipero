// LIVE. Generated repeating tiling ground textures (USER RULING 2026-08-17), through the
// C13 forge gate: rubric + retry-with-feedback + SpendLedger read-merge-write.
//
//   DRY=1 npx tsx packages/forge/scripts/gen-terrain-textures.ts
//   node --env-file=/Users/deadpackets/workspace/SanJunipero/.env \
//     node_modules/.pnpm/tsx@4.23.12/node_modules/tsx/dist/cli.mjs \
//     packages/forge/scripts/gen-terrain-textures.ts
//
// Controls: DRY=1 offline plan, ONLY=<comma list of assetIds> for reruns, CAP=<usd>.
// Nothing generated is committed by this script — art lands under $C3/ for curation.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { decodePng, encodePng } from '../src/post/raw.js'
import { BudgetGuard } from '../src/budget.js'
import { loadForgeConfig } from '../src/forgeConfig.js'
import { SpendLedger, AnomalyStopError } from '../src/spendLedger.js'
import { makeImageClient, EST_COST_PER_IMAGE } from '../src/imageClient.js'
import { makeVisionJudge, EST_COST_PER_VISION_CALL, type VisionJudgeFn } from '../src/visionQa/visionJudge.js'
import { runVisionGate } from '../src/visionQa/gate.js'
import { CRITERIA, type VisionVerdict } from '../src/visionQa/verdict.js'
import { loadReferenceSheet } from '../src/referenceSheet.js'
import {
  generationItems, materialFromCandidate, planTerrainProgram,
  seamReport, selfTile3x3, terrainBoilerplate,
} from '../src/terrainGen.js'

const OUT = '/private/tmp/claude-501/-Users-deadpackets-workspace-SanJunipero/461805e8-9eb9-4d32-b2ea-e2ef16ce8545/scratchpad/c3'
const LEDGER = join(OUT, 'spend-ledger.json')

const DRY = process.env.DRY === '1'
const ONLY = (process.env.ONLY ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const CAP = Number(process.env.CAP ?? '12')

const apiKey = process.env.OPENROUTER_API_KEY
if (!DRY && (apiKey === undefined || apiKey === '')) {
  throw new Error('OPENROUTER_API_KEY not set — run with node --env-file=<path to .env>')
}

const meanScore = (v: VisionVerdict): number =>
  CRITERIA.reduce((s, k) => s + v.criteria[k].score, 0) / CRITERIA.length

type ItemResult = {
  assetId: string; status: 'pass' | 'blocked' | 'error'
  attempts: number; spendUsd: number; scores: number[]; seam: string; note: string
}

async function main(): Promise<void> {
  const plan = planTerrainProgram()
  const items = generationItems(plan).filter((i) => ONLY.length === 0 || ONLY.includes(i.assetId))
  const derived = plan.filter((p) => p.generateFrom !== undefined)

  console.log(`terrain texture program: ${plan.length} pieces of art, ${items.length} model calls`)
  console.log(`  ${derived.length} pieces are cut from a generated material (road shapes) — $0 each`)
  const estimate = items.length * (EST_COST_PER_IMAGE + EST_COST_PER_VISION_CALL)
  console.log(`  estimate at one attempt each: $${estimate.toFixed(3)} (cap $${CAP})`)
  for (const i of items) console.log(`    ${i.assetId.padEnd(26)} ${i.commission.slice(0, 76)}`)
  if (DRY) { console.log('\nDRY=1 — nothing generated, nothing spent.'); return }

  mkdirSync(join(OUT, 'materials'), { recursive: true })
  mkdirSync(join(OUT, 'composites'), { recursive: true })

  const config = loadForgeConfig()
  const ledger = new SpendLedger(LEDGER)
  const budget = new BudgetGuard(CAP)
  const client = makeImageClient({ apiKey: apiKey!, budget })
  const refs = loadReferenceSheet()
  const baseJudge = makeVisionJudge({ apiKey: apiKey!, refs, config })

  const results: ItemResult[] = []
  for (const item of items) {
    const seams = new Map<string, ReturnType<typeof seamReport>>()

    // The judge sees the 3x3 SELF-TILED composite, which is the only picture in which a seam
    // or a recurring blob can show. The deterministic seam check overrides the model's tiling
    // score: a measured wrap failure is a fact, not an opinion.
    const judge: VisionJudgeFn = async (a) => {
      const seam = seams.get(`${a.assetId}:${a.attempt ?? 1}`)
      const r = await baseJudge({ ...a, sprite: selfTile3x3(a.sprite) })
      if (seam === undefined || seam.pass) return r
      const criteria = { ...r.verdict.criteria, tiling: { pass: false, score: 0, evidence: seam.note } }
      return {
        costUsd: r.costUsd,
        verdict: { ...r.verdict, criteria, overall: 'retry' as const, feedback: `${seam.note}. ${r.verdict.feedback}` },
      }
    }

    try {
      const result = await runVisionGate({
        assetId: item.assetId, klass: 'terrain', commission: item.commission,
        basePrompt: { boilerplate: terrainBoilerplate(), commissionText: item.commission },
        judge, ledger, config,
        regenerate: async (prompt, attempt) => {
          const [cand] = await client.generateCandidates(prompt, refs, 1)
          if (cand === undefined) throw new Error(`${item.assetId}: no candidate returned`)
          const material = materialFromCandidate(await decodePng(cand.png))
          seams.set(`${item.assetId}:${attempt}`, seamReport(material))
          return { sprite: material, costUsd: cand.costUsd, model: cand.model }
        },
      })
      const seam = seamReport(result.sprite)
      writeFileSync(join(OUT, 'materials', `${item.assetId.replace(/:/g, '_')}.png`), await encodePng(result.sprite))
      writeFileSync(join(OUT, 'composites', `${item.assetId.replace(/:/g, '_')}.png`), await encodePng(selfTile3x3(result.sprite)))
      results.push({
        assetId: item.assetId, status: result.status, attempts: result.attempts,
        spendUsd: result.spendUsd, scores: result.verdicts.map(meanScore),
        seam: `${seam.pass ? 'ok' : 'SEAM'} h=${seam.horizontalDelta.toFixed(1)} v=${seam.verticalDelta.toFixed(1)}`,
        note: result.verdicts.at(-1)?.feedback ?? '',
      })
    } catch (e) {
      if (e instanceof AnomalyStopError) { console.error(`ANOMALY STOP: ${e.message}`); ledger.flush(); throw e }
      results.push({
        assetId: item.assetId, status: 'error', attempts: 0, spendUsd: ledger.totalFor(item.assetId),
        scores: [], seam: '-', note: e instanceof Error ? e.message : String(e),
      })
    }
    ledger.flush()
    const r = results.at(-1)!
    console.log(`${r.assetId.padEnd(26)} ${r.status.padEnd(7)} n=${r.attempts} ${r.seam.padEnd(22)} $${r.spendUsd.toFixed(4)}`)
  }

  const total = results.reduce((s, r) => s + r.spendUsd, 0)
  writeFileSync(join(OUT, 'run-report.json'), `${JSON.stringify({ results, total }, null, 2)}\n`)
  console.log(`\n${results.filter((r) => r.status === 'pass').length}/${results.length} passed — total $${total.toFixed(4)}`)
  console.log(`materials → ${join(OUT, 'materials')}`)
  console.log(`next: npx tsx packages/forge/scripts/write-terrain-tileset.ts (reads the materials and merges the manifest)`)
}

await main()

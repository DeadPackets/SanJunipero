// LIVE. Generated repeating tiling ground textures (USER RULING 2026-08-17), through the
// C13 forge gate: rubric + retry-with-feedback + SpendLedger read-merge-write.
//
//   DRY=1 npx tsx packages/forge/scripts/gen-terrain-textures.ts
//   node --env-file=/Users/deadpackets/workspace/SanJunipero/.env \
//     node_modules/.pnpm/tsx@4.23.12/node_modules/tsx/dist/cli.mjs \
//     packages/forge/scripts/gen-terrain-textures.ts
//
// Controls: DRY=1 offline plan, ONLY=<comma list of assetIds>, CAP=<usd>, FORCE=1 to redo
// an asset that already has art. SPEND SAFETY: an asset whose material is already on disk is
// SKIPPED — a restart mid-batch must never pay twice for the same picture.
// Nothing generated is committed by this script — art lands under $C3/ for curation.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePng, encodePng } from '../src/post/raw.js'
import { BudgetGuard } from '../src/budget.js'
import { loadForgeConfig } from '../src/forgeConfig.js'
import { SpendLedger, AnomalyStopError } from '../src/spendLedger.js'
import { makeImageClient, EST_COST_PER_IMAGE } from '../src/imageClient.js'
import { makeVisionJudge, EST_COST_PER_VISION_CALL, type VisionJudgeFn } from '../src/visionQa/visionJudge.js'
import { runVisionGate } from '../src/visionQa/gate.js'
import { CRITERIA, type VisionVerdict } from '../src/visionQa/verdict.js'
import {
  generationItems, materialFromCandidate, planTerrainProgram,
  borderReport, materialVeto, seamReport, selfTile3x3, terrainBoilerplate,
} from '../src/terrainGen.js'

const C3 = '/private/tmp/claude-501/-Users-deadpackets-workspace-SanJunipero/461805e8-9eb9-4d32-b2ea-e2ef16ce8545/scratchpad/c3'
// TERRAIN_ROOT lets a re-run under a stricter bar land beside the old art, and book its
// spend against its own lane's ledger rather than C3's.
const OUT = process.env.TERRAIN_ROOT ?? C3
const LEDGER = join(OUT, 'spend-ledger.json')

const DRY = process.env.DRY === '1'
const ONLY = (process.env.ONLY ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const CAP = Number(process.env.CAP ?? '12')
const FORCE = process.env.FORCE === '1'

const materialPath = (assetId: string): string =>
  join(OUT, 'materials', `${assetId.replace(/:/g, '_')}.png`)

const apiKey = process.env.OPENROUTER_API_KEY
if (!DRY && (apiKey === undefined || apiKey === '')) {
  throw new Error('OPENROUTER_API_KEY not set — run with node --env-file=<path to .env>')
}

const meanScore = (v: VisionVerdict): number =>
  CRITERIA.reduce((s, k) => s + v.criteria[k].score, 0) / CRITERIA.length

type ItemResult = {
  assetId: string; status: 'pass' | 'blocked' | 'error'
  attempts: number; spendUsd: number; scores: number[]; seam: string; note: string
  criteria: Record<string, number>; eyeTiling: number[]
}

async function main(): Promise<void> {
  const plan = planTerrainProgram()
  const requested = generationItems(plan)
    .filter((i) => ONLY.length === 0 || ONLY.includes(i.assetId))
    .filter((i) => process.env['GROUND_ONLY'] !== '1' || i.sort === 'ground' || i.sort === 'material')
  const done = requested.filter((i) => !FORCE && existsSync(materialPath(i.assetId)))
  const items = requested.filter((i) => FORCE || !existsSync(materialPath(i.assetId)))
  const derived = plan.filter((p) => p.generateFrom !== undefined)

  // Reconcile against the ledger before spending anything, and say what was already bought.
  const priorLedger = new SpendLedger(LEDGER)
  const priorTotal = requested.reduce((t, i) => t + priorLedger.totalFor(i.assetId), 0)
  if (done.length > 0) {
    console.log(`already generated, SKIPPING (${done.length}): ${done.map((d) => d.assetId).join(', ')}`)
  }
  console.log(`spend already booked against these assets: $${priorTotal.toFixed(4)}`)

  console.log(`terrain texture program: ${plan.length} pieces of art, ${items.length} model calls to make`)
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
  // the committed canonical style anchor, exactly what C13's own live runner used
  const refs = [readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'content', 'reference', 'style-anchor.png'))]
  const baseJudge = makeVisionJudge({ apiKey: apiKey!, refs, config })

  const results: ItemResult[] = []
  for (const item of items) {
    const seams = new Map<string, string | null>()
    const eyeTiling: number[] = []

    // The judge sees the 3x3 SELF-TILED composite, which is the only picture in which a seam
    // or a recurring blob can show. The deterministic seam check overrides the model's tiling
    // score: a measured wrap failure is a fact, not an opinion.
    const judge: VisionJudgeFn = async (a) => {
      const broke = seams.get(`${a.assetId}:${a.attempt ?? 1}`)
      // A structured-output parse failure is transport, not a verdict — one retry, then let
      // it surface. Booked cost is unaffected: the failed call returned nothing to book.
      let r
      try { r = await baseJudge({ ...a, sprite: selfTile3x3(a.sprite) }) }
      catch { r = await baseJudge({ ...a, sprite: selfTile3x3(a.sprite) }) }
      eyeTiling.push(r.verdict.criteria.tiling.score)
      // RULING (corrected after the water:0 finding): a measurement may VETO, never RESCUE.
      // An objective failure is decisive; an objective pass is only a floor the eye still has
      // to clear. The first version floored the eye's tiling score whenever the seam measured
      // clean — and a DRAWN FRAME wraps perfectly, so it sailed through with a purple grid.
      const attempt = a.attempt ?? 1
      if (broke === undefined || broke === null) return r
      const criteria = { ...r.verdict.criteria, tiling: { pass: false, score: 0, evidence: broke } }
      return {
        costUsd: r.costUsd,
        verdict: {
          ...r.verdict, criteria,
          // a measured failure retries until the budget is out — never past it
          overall: attempt > config.visionQa.maxRetries ? 'blocked' as const : 'retry' as const,
          feedback: `${broke}. ${r.verdict.feedback}`,
        },
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
          seams.set(`${item.assetId}:${attempt}`, materialVeto(material))
          return { sprite: material, costUsd: cand.costUsd, model: cand.model }
        },
      })
      const seam = seamReport(result.sprite), border = borderReport(result.sprite)
      // Mechanical criteria are COUNTED, never asked of the judge: a material that still
      // fails the veto after its last attempt does not ship, whatever the eye scored it.
      const veto = materialVeto(result.sprite)
      writeFileSync(join(OUT, 'materials', `${item.assetId.replace(/:/g, '_')}.png`), await encodePng(result.sprite))
      writeFileSync(join(OUT, 'composites', `${item.assetId.replace(/:/g, '_')}.png`), await encodePng(selfTile3x3(result.sprite)))
      results.push({
        assetId: item.assetId, status: veto === null ? result.status : 'blocked', attempts: result.attempts,
        spendUsd: result.spendUsd, scores: result.verdicts.map(meanScore),
        seam: `${seam.pass ? 'ok' : 'SEAM'}${border.framed ? '/FRAMED' : ''} h=${seam.horizontalDelta.toFixed(1)} v=${seam.verticalDelta.toFixed(1)} ring=${border.ringDelta.toFixed(1)}`,
        note: veto ?? result.verdicts.at(-1)?.feedback ?? '',
        criteria: Object.fromEntries(
          CRITERIA.map((k) => [k, result.verdicts.at(-1)?.criteria[k].score ?? -1]),
        ),
        eyeTiling: [...eyeTiling],
      })
    } catch (e) {
      if (e instanceof AnomalyStopError) { console.error(`ANOMALY STOP: ${e.message}`); ledger.flush(); throw e }
      results.push({
        assetId: item.assetId, status: 'error', attempts: 0, spendUsd: ledger.totalFor(item.assetId),
        scores: [], seam: '-', note: e instanceof Error ? e.message : String(e), criteria: {},
        eyeTiling: [...eyeTiling],
      })
    }
    ledger.flush()
    const r = results.at(-1)!
    const worst = Object.entries(r.criteria).filter(([, v]) => v >= 0).sort((a, b) => a[1] - b[1])[0]
    console.log(`${r.assetId.padEnd(26)} ${r.status.padEnd(7)} n=${r.attempts} ${r.seam.padEnd(22)} ` +
      `worst=${worst ? `${worst[0]}:${worst[1]}` : '-'} $${r.spendUsd.toFixed(4)}`)
  }

  // House law: thresholds are read per-criterion over the POPULATION, never per item.
  const population: Record<string, { mean: number; min: number; n: number }> = {}
  for (const k of CRITERIA) {
    const vals = results.map((r) => r.criteria[k]).filter((v): v is number => v !== undefined && v >= 0)
    if (vals.length === 0) continue
    population[k] = { mean: vals.reduce((s2, v) => s2 + v, 0) / vals.length, min: Math.min(...vals), n: vals.length }
  }
  const eye = results.flatMap((r) => r.eyeTiling)
  console.log('\npopulation, per criterion:')
  for (const [k, v] of Object.entries(population)) {
    console.log(`  ${k.padEnd(14)} mean ${v.mean.toFixed(2)}  min ${v.min}  n=${v.n}`)
  }
  if (eye.length > 0) {
    console.log(`  ${'tiling(eye)'.padEnd(14)} mean ${(eye.reduce((s2, v) => s2 + v, 0) / eye.length).toFixed(2)}  n=${eye.length}`)
  }

  const total = results.reduce((s, r) => s + r.spendUsd, 0)
  writeFileSync(join(OUT, 'run-report.json'), `${JSON.stringify({ results, population, total }, null, 2)}\n`)
  console.log(`\n${results.filter((r) => r.status === 'pass').length}/${results.length} passed — total $${total.toFixed(4)}`)
  console.log(`materials → ${join(OUT, 'materials')}`)
  console.log(`next: npx tsx packages/forge/scripts/write-terrain-tileset.ts (reads the materials and merges the manifest)`)
}

await main()

// LIVE batched generation of the 50-entry premade library. One BATCH per invocation, so
// every batch meets an eyeball before the next one spends.
//
//   BATCH=tools DRY=1 node --env-file=/Users/deadpackets/workspace/SanJunipero/.env \
//     node_modules/.pnpm/tsx@4.23.12/node_modules/tsx/dist/cli.mjs packages/forge/scripts/gen-library.ts
//
// Controls: BATCH (required), ITEMS=<comma list> for reruns, DRY=1 for the offline plan,
// CANDIDATES=2|3. Nothing generated is committed — art lives under $C13/library/.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type AssetRecord } from '@sj/shared'
import { decodePng, encodePng, downscaleNearest, type RawImage } from '../src/post/raw.js'
import { chromaKey } from '../src/post/chromaKey.js'
import { quantize } from '../src/post/quantize.js'
import { despeckle, sweepMagenta, opaqueArea, estimatePitch } from '../src/sheet.js'
import { trimToFigure } from '../src/hires.js'
import { openForgeDb } from '../src/db.js'
import { AssetCodex } from '../src/codex.js'
import { loadForgeConfig } from '../src/forgeConfig.js'
import { SpendLedger, AnomalyStopError } from '../src/spendLedger.js'
import { makeImageClient, GEN_SIZE } from '../src/imageClient.js'
import { makeVisionJudge } from '../src/visionQa/visionJudge.js'
import { runVisionGate } from '../src/visionQa/gate.js'
import { recordVerdict } from '../src/visionQa/telemetry.js'
import { CRITERIA, type VisionVerdict } from '../src/visionQa/verdict.js'
import { planBatch, estimateBatchCost, LIBRARY_BATCHES } from '../src/library/plan.js'
import { registerLibraryEntry, deriveIcon, libraryIndexJson } from '../src/library/register.js'
import type { LibraryEntry } from '../src/library/catalog.js'

const C13 = '/private/tmp/claude-501/-Users-deadpackets-workspace-SanJunipero/461805e8-9eb9-4d32-b2ea-e2ef16ce8545/scratchpad/c13'
const FORGE = join(dirname(fileURLToPath(import.meta.url)), '..')
const LIB = join(C13, 'library')

const DRY = process.env.DRY === '1'
const BATCH = process.env.BATCH ?? ''
const ONLY = (process.env.ITEMS ?? '').split(',').map(s => s.trim()).filter(Boolean)
const CANDIDATES = process.env.CANDIDATES ? Number(process.env.CANDIDATES) : undefined

const apiKey = process.env.OPENROUTER_API_KEY
if (!DRY && !apiKey) throw new Error('OPENROUTER_API_KEY not set')
if (!BATCH) throw new Error(`BATCH is required — one of ${LIBRARY_BATCHES.join(', ')}`)

// The plan's post chain: key → despeckle → trim → nearest downscale → magenta sweep, then
// palette quantize (the rubric judges palette membership) and a centred square canvas so the
// codex row's pixel size is the entry's declared size.
function padSquare(img: RawImage, px: number): RawImage {
  if (img.width === px && img.height === px) return img
  const data = new Uint8ClampedArray(px * px * 4)
  const ox = (px - img.width) >> 1, oy = (px - img.height) >> 1
  for (let y = 0; y < img.height; y++)
    data.set(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4), ((y + oy) * px + ox) * 4)
  return { width: px, height: px, data }
}

function toSpriteCell(raw: RawImage, px: number): { cell: RawImage; pitch: number } {
  const keyed = chromaKey(raw)
  const cleaned = despeckle(keyed, Math.max(3, Math.ceil(opaqueArea(keyed) * 0.01)))
  const trimmed = trimToFigure(cleaned, 0)
  let pitch = Number.NaN
  try { pitch = estimatePitch(trimmed, [4, 40]) } catch { /* a flat figure has no lattice */ }
  const k = Math.max(trimmed.width, trimmed.height) / px
  const small = downscaleNearest(trimmed,
    Math.max(1, Math.min(px, Math.round(trimmed.width / k))),
    Math.max(1, Math.min(px, Math.round(trimmed.height / k))))
  return { cell: padSquare(quantize(sweepMagenta(small)), px), pitch }
}

const meanScore = (v: VisionVerdict): number =>
  CRITERIA.reduce((s, k) => s + v.criteria[k].score, 0) / CRITERIA.length

type ItemResult = {
  kind: string; status: 'pass' | 'blocked' | 'error'; attempts: number; spendUsd: number
  scores: number[]; iconScores: number[]; note: string
}

async function main(): Promise<void> {
  const items = planBatch(BATCH, CANDIDATES === undefined ? {} : { candidates: CANDIDATES })
    .filter(i => ONLY.length === 0 || ONLY.includes(i.entry.kind))
  if (ONLY.length) {
    const missing = ONLY.filter(k => !items.some(i => i.entry.kind === k))
    if (missing.length) throw new Error(`ITEMS not in batch ${BATCH}: ${missing.join(', ')}`)
  }

  console.log(`gen-library ${DRY ? 'DRY PLAN' : 'LIVE'} — batch ${BATCH}, ${items.length} items, ` +
    `${items.reduce((s, i) => s + i.candidates, 0)} images, est $${estimateBatchCost(items).toFixed(4)}`)
  for (const i of items)
    console.log(`  ${i.entry.kind.padEnd(16)} ${i.entry.category.padEnd(10)} ` +
      `sprite ${i.entry.spritePx} icon ${i.entry.iconPx} cand ${i.candidates}`)
  if (DRY) { console.log('DRY: no API calls made.'); return }

  const config = loadForgeConfig()
  const ledger = new SpendLedger(join(C13, 'spend.json'))
  const db = openForgeDb(join(LIB, 'library.db'))
  const codex = new AssetCodex(db)
  const anchor = readFileSync(join(FORGE, 'content', 'reference', 'style-anchor.png'))
  const judge = makeVisionJudge({ apiKey: apiKey!, refs: [anchor], config })
  const client = makeImageClient({ apiKey: apiKey! })
  const budget = config.visionQa.maxRetries + 1

  const results: ItemResult[] = []
  const records: AssetRecord[] = []

  for (const item of items) {
    const e: LibraryEntry = item.entry
    const assetId = `library:${e.kind}`
    const dir = join(LIB, e.kind)
    mkdirSync(join(dir, 'candidates'), { recursive: true })

    let attemptsUsed = 0, extra = ''
    let chosen: RawImage | null = null, icon: RawImage | null = null
    const spriteVerdicts: VisionVerdict[] = [], iconVerdicts: VisionVerdict[] = []
    let status: ItemResult['status'] = 'blocked'
    let note = ''

    try {
      while (attemptsUsed < budget) {
        const roundConfig = {
          ...config,
          visionQa: { ...config.visionQa, maxRetries: budget - attemptsUsed - 1 },
        }
        const res = await runVisionGate({
          assetId, klass: 'item', commission: e.desc,
          // Position law: boilerplate, then the fix, then the commission. Icon feedback from
          // the previous round rides at the end of the boilerplate for the same reason.
          basePrompt: {
            boilerplate: extra ? `${item.boilerplate} ${extra}` : item.boilerplate,
            commissionText: item.commissionText,
          },
          judge, ledger, config: roundConfig,
          regenerate: async (prompt, attempt) => {
            const n = attemptsUsed + attempt
            const cands = await client.generateCandidates(prompt, [anchor], item.candidates)
            const processed = await Promise.all(cands.map(async (c, ix) => {
              writeFileSync(join(dir, 'candidates', `a${n}-c${ix + 1}-raw.png`), c.png)
              return { c, ix, ...toSpriteCell(await decodePng(c.png), e.spritePx) }
            }))
            // Pick by pixel pitch: the candidate whose native block size is closest to the
            // downscale factor keeps its lattice through the nearest resize.
            const target = GEN_SIZE / e.spritePx
            const dist = (p: typeof processed[number]) =>
              Number.isFinite(p.pitch) ? Math.abs(p.pitch - target) : Number.POSITIVE_INFINITY
            const pick = processed.reduce((b, p) => (dist(p) < dist(b) ? p : b), processed[0]!)
            for (const p of processed)
              writeFileSync(join(dir, 'candidates',
                p === pick ? `a${n}-chosen.png` : `rejected-a${n}-c${p.ix + 1}.png`),
                await encodePng(p.cell))
            return {
              sprite: pick.cell, model: pick.c.model,
              costUsd: cands.reduce((s, c) => s + c.costUsd, 0),
            }
          },
        })
        attemptsUsed += res.attempts
        spriteVerdicts.push(...res.verdicts)
        chosen = res.sprite
        res.verdicts.forEach((v, ix) =>
          recordVerdict(db, v, { assetClass: 'item', attempt: attemptsUsed - res.verdicts.length + ix + 1, costUsd: 0 }))
        ledger.flush()
        if (res.status === 'blocked') { status = 'blocked'; note = res.verdicts.at(-1)?.feedback ?? ''; break }

        icon = deriveIcon(res.sprite, e.iconPx)
        const iv = await judge({
          assetId: `${assetId}#icon`, klass: 'icon', sprite: icon,
          commission: e.desc, attempt: attemptsUsed,
        })
        // D-6: the icon is a downscale, so its spend books against the sprite's asset id.
        ledger.append({ assetId, kind: 'vision_qa', model: iv.verdict.model, usd: iv.costUsd })
        ledger.flush()
        iconVerdicts.push(iv.verdict)
        recordVerdict(db, iv.verdict, { assetClass: 'icon', attempt: attemptsUsed, costUsd: iv.costUsd })
        if (iv.verdict.overall === 'pass') { status = 'pass'; break }
        extra = iv.verdict.feedback
        note = `icon rejected: ${iv.verdict.feedback}`
      }
    } catch (err) {
      status = 'error'
      note = err instanceof AnomalyStopError ? err.message : String(err)
      ledger.flush()
    }

    if (chosen) {
      icon ??= deriveIcon(chosen, e.iconPx)
      const spritePng = await encodePng(chosen)
      const iconPng = await encodePng(icon)
      writeFileSync(join(dir, 'sprite.png'), spritePng)
      writeFileSync(join(dir, 'icon.png'), iconPng)
      const last = spriteVerdicts.at(-1)
      const score = last ? Math.min(10, Math.max(1, meanScore(last))) : null
      const r = registerLibraryEntry(codex, e, {
        sprite: spritePng, icon: iconPng, score,
        attempts: Math.min(budget, Math.max(1, attemptsUsed)),
        costUsd: ledger.totalFor(assetId),
      })
      records.push(r.spriteRecord, r.iconRecord)
      writeFileSync(join(dir, 'report.json'), JSON.stringify({
        kind: e.kind, status, attempts: attemptsUsed, spendUsd: ledger.totalFor(assetId),
        spriteVerdicts, iconVerdicts,
      }, null, 2))
    }

    results.push({
      kind: e.kind, status, attempts: attemptsUsed, spendUsd: ledger.totalFor(assetId),
      scores: spriteVerdicts.at(-1) ? CRITERIA.map(c => spriteVerdicts.at(-1)!.criteria[c].score) : [],
      iconScores: iconVerdicts.at(-1) ? CRITERIA.map(c => iconVerdicts.at(-1)!.criteria[c].score) : [],
      note,
    })
    console.log(`  ${status.padEnd(8)} ${e.kind.padEnd(16)} attempts ${attemptsUsed} ` +
      `$${ledger.totalFor(assetId).toFixed(4)}`)
  }

  // Read-merge-write: each batch adds its kinds to the one durable index.
  const indexPath = join(LIB, 'index.json')
  const fresh = JSON.parse(libraryIndexJson(records)) as { version: string; entries: { kind: string }[] }
  const prior = existsSync(indexPath)
    ? (JSON.parse(readFileSync(indexPath, 'utf8')) as { entries: { kind: string }[] }).entries
    : []
  const merged = [...prior.filter(p => !fresh.entries.some(f => f.kind === p.kind)), ...fresh.entries]
  writeFileSync(indexPath, JSON.stringify({ version: fresh.version, entries: merged }, null, 2))

  mkdirSync(join(C13, 'reports'), { recursive: true })
  const spend = results.reduce((s, r) => s + r.spendUsd, 0)
  const md = [
    `# C13 library batch \`${BATCH}\``,
    '',
    `- Items: ${results.length}. Pass: ${results.filter(r => r.status === 'pass').length}. ` +
    `Blocked: ${results.filter(r => r.status === 'blocked').length}. ` +
    `Errors: ${results.filter(r => r.status === 'error').length}.`,
    `- Batch spend: **$${spend.toFixed(4)}** (estimate was $${estimateBatchCost(items).toFixed(4)}).`,
    `- Rubric v1, model \`${config.visionQa.model}\`, minScore ${config.visionQa.minScore}, ` +
    `maxRetries ${config.visionQa.maxRetries}.`,
    '',
    `| kind | status | attempts | sprite ${CRITERIA.join('/')} | icon ${CRITERIA.join('/')} | $ | note |`,
    '|---|---|---|---|---|---|---|',
    ...results.map(r => `| ${r.kind} | **${r.status}** | ${r.attempts} | ${r.scores.join(' ')} | ` +
      `${r.iconScores.join(' ')} | ${r.spendUsd.toFixed(4)} | ${r.note.replace(/\|/g, '/')} |`),
    '',
  ].join('\n')
  writeFileSync(join(C13, 'reports', `batch-${BATCH}.md`), md)
  console.log(`\nbatch ${BATCH}: $${spend.toFixed(4)} — wrote ${join(C13, 'reports', `batch-${BATCH}.md`)}`)
}

await main()

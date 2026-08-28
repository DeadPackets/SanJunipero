// LIVE batched generation of the 50-entry premade library. One BATCH per invocation, so every
// batch meets an eyeball before the next one spends. Controls: BATCH (required), ITEMS=, DRY=1,
// CANDIDATES=2|3. Nothing generated is committed — art lives under $C13/library/.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type AssetRecord } from '@sj/shared'
import { decodePng, encodePng, type RawImage } from '../src/post/raw.js'
import { openForgeDb } from '../src/db.js'
import { AssetCodex } from '../src/codex.js'
import { loadForgeConfig } from '../src/forgeConfig.js'
import { SpendLedger, AnomalyStopError } from '../src/spendLedger.js'
import {
  makeImageClient,
  GEN_SIZE,
  makeVisionJudge,
  runVisionGate,
  recordVerdict,
  CRITERIA,
  planBatch,
  estimateBatchCost,
  LIBRARY_BATCHES,
  type VisionJudgeFn,
  type VisionVerdict,
} from '@sj/forge/gen'
import { candidateRank, silhouetteStats } from '../src/library/postItem.js'
import { chromaKey } from '../src/post/chromaKey.js'
import { spriteCell } from '../src/reCell.js'
import { pixelBarReport } from '../src/pixelGates.js'
import { registerLibraryEntry, deriveIcon, libraryIndexJson } from '../src/library/register.js'
import { spriteGateStatus } from '../src/library/status.js'
import type { LibraryEntry } from '../src/library/catalog.js'
import { scratch } from './scratch.js'

const C13 = scratch('c13')
const FORGE = join(dirname(fileURLToPath(import.meta.url)), '..')
// ROOT lets a re-run at a new resolution land beside the old art rather than over it.
const ROOT = process.env.LIB_ROOT ?? C13
const LIB = join(ROOT, 'library')

const DRY = process.env.DRY === '1'
const BATCH = process.env.BATCH ?? ''
const ONLY = (process.env.ITEMS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const CANDIDATES = process.env.CANDIDATES ? Number(process.env.CANDIDATES) : undefined

const apiKey = process.env.OPENROUTER_API_KEY
if (!DRY && !apiKey) throw new Error('OPENROUTER_API_KEY not set')
if (!BATCH) throw new Error(`BATCH is required — one of ${LIBRARY_BATCHES.join(', ')}`)

const meanScore = (v: VisionVerdict): number =>
  CRITERIA.reduce((s, k) => s + v.criteria[k].score, 0) / CRITERIA.length

type ItemResult = {
  kind: string
  status: 'pass' | 'blocked' | 'error'
  attempts: number
  spendUsd: number
  scores: number[]
  iconScores: number[]
  note: string
}

async function main(): Promise<void> {
  const items = planBatch(BATCH, CANDIDATES === undefined ? {} : { candidates: CANDIDATES }).filter(
    (i) => ONLY.length === 0 || ONLY.includes(i.entry.kind),
  )
  if (ONLY.length) {
    const missing = ONLY.filter((k) => !items.some((i) => i.entry.kind === k))
    if (missing.length) throw new Error(`ITEMS not in batch ${BATCH}: ${missing.join(', ')}`)
  }

  console.log(
    `gen-library ${DRY ? 'DRY PLAN' : 'LIVE'} — batch ${BATCH}, ${items.length} items, ` +
      `${items.reduce((s, i) => s + i.candidates, 0)} images, est $${estimateBatchCost(items).toFixed(4)}`,
  )
  for (const i of items)
    console.log(
      `  ${i.entry.kind.padEnd(16)} ${i.entry.category.padEnd(10)} ` +
        `sprite ${i.entry.spritePx} icon ${i.entry.iconPx} cand ${i.candidates}`,
    )
  if (DRY) {
    console.log('DRY: no API calls made.')
    return
  }

  mkdirSync(LIB, { recursive: true })
  const config = loadForgeConfig()
  const ledger = new SpendLedger(join(ROOT, 'spend.json'))
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
    // A rerun must not leave last run's candidates behind: which file was chosen has to
    // stay unambiguous when a human opens the folder.
    rmSync(join(dir, 'candidates'), { recursive: true, force: true })
    mkdirSync(join(dir, 'candidates'), { recursive: true })

    const spentBefore = ledger.totalFor(assetId)
    let attemptsUsed = 0,
      extra = ''
    let chosen: RawImage | null = null,
      icon: RawImage | null = null
    // Boxed: a closure-assigned `let` narrows to null, and no-unnecessary-condition calls the read dead.
    const chosenRaw: { keyed: RawImage | null } = { keyed: null }
    const spriteVerdicts: VisionVerdict[] = [],
      iconVerdicts: VisionVerdict[] = []
    let status: ItemResult['status'] = 'blocked'
    let note = ''

    try {
      while (attemptsUsed < budget) {
        // The gate loops on the JUDGE's verdict, and the judge derives retry-vs-blocked from
        // the attempt number it is handed. Offset it by the rounds already spent, or an icon
        // rejection restarts the count and the item runs past its 3-attempt ceiling.
        const roundJudge: VisionJudgeFn = (a) =>
          judge({ ...a, attempt: attemptsUsed + (a.attempt ?? 1) })
        const res = await runVisionGate({
          assetId,
          klass: 'item',
          commission: e.desc,
          // Position law: boilerplate, then the fix, then the commission. Icon feedback from
          // the previous round rides at the end of the boilerplate for the same reason.
          basePrompt: {
            boilerplate: extra ? `${item.boilerplate} ${extra}` : item.boilerplate,
            commissionText: item.commissionText,
          },
          judge: roundJudge,
          ledger,
          config,
          regenerate: async (prompt, attempt) => {
            const n = attemptsUsed + attempt
            const cands = await client.generateCandidates(prompt, [anchor], item.candidates)
            const processed = await Promise.all(
              cands.map(async (c, ix) => {
                writeFileSync(join(dir, 'candidates', `a${n}-c${ix + 1}-raw.png`), c.png)
                const keyed = chromaKey(await decodePng(c.png))
                const { cell } = spriteCell(keyed, {
                  w: e.spritePx,
                  h: e.spritePx,
                  anchor: 'centre',
                })
                return { c, ix, keyed, cell, ...silhouetteStats(cell) }
              }),
            )
            // Pick the cleanest silhouette: one connected subject, no floating debris.
            const pick = processed.reduce(
              (b, p) => (candidateRank(p) < candidateRank(b) ? p : b),
              processed[0]!,
            )
            for (const p of processed)
              writeFileSync(
                join(
                  dir,
                  'candidates',
                  p === pick ? `a${n}-chosen.png` : `rejected-a${n}-c${p.ix + 1}.png`,
                ),
                await encodePng(p.cell),
              )
            chosenRaw.keyed = pick.keyed
            return {
              sprite: pick.cell,
              model: pick.c.model,
              costUsd: cands.reduce((s, c) => s + c.costUsd, 0),
            }
          },
        })
        attemptsUsed += res.attempts
        spriteVerdicts.push(...res.verdicts)
        chosen = res.sprite
        res.verdicts.forEach((v, ix) => {
          recordVerdict(db, v, {
            assetClass: 'item',
            attempt: attemptsUsed - res.verdicts.length + ix + 1,
            costUsd: 0,
          })
        })
        ledger.flush()
        if (res.status === 'blocked') {
          status = 'blocked'
          note = res.verdicts.at(-1)?.feedback ?? ''
          break
        }

        // Resample the icon from the paid generation at its own cell count: an integer
        // downscale of the 24 px sprite lands on 12 px of art, which the judge reads as mush.
        icon = chosenRaw.keyed
          ? spriteCell(chosenRaw.keyed, { w: e.iconPx, h: e.iconPx, anchor: 'centre' }).cell
          : deriveIcon(res.sprite, e.iconPx)
        const iv = await judge({
          assetId: `${assetId}#icon`,
          klass: 'icon',
          sprite: icon,
          commission: e.desc,
          attempt: attemptsUsed,
        })
        // D-6: the icon is a downscale, so its spend books against the sprite's asset id.
        ledger.append({ assetId, kind: 'vision_qa', model: iv.verdict.model, usd: iv.costUsd })
        ledger.flush()
        iconVerdicts.push(iv.verdict)
        recordVerdict(db, iv.verdict, {
          assetClass: 'icon',
          attempt: attemptsUsed,
          costUsd: iv.costUsd,
        })
        if (iv.verdict.overall === 'pass') {
          status = 'pass'
          break
        }
        extra = iv.verdict.feedback
        note = `icon rejected: ${iv.verdict.feedback}`
      }
    } catch (err) {
      status = 'error'
      note = err instanceof AnomalyStopError ? err.message : String(err)
      ledger.flush()
    }
    if (status !== 'error') status = spriteGateStatus(spriteVerdicts, status)

    if (chosen) {
      icon ??= chosenRaw.keyed
        ? spriteCell(chosenRaw.keyed, { w: e.iconPx, h: e.iconPx, anchor: 'centre' }).cell
        : deriveIcon(chosen, e.iconPx)
      // Mechanical criteria are COUNTED, never asked of the judge: a sprite that fails the pixel
      // bar never ships, whatever the eye said about it.
      const bars = [
        pixelBarReport({ name: e.kind, img: chosen, raw: { w: GEN_SIZE, h: GEN_SIZE } }),
        pixelBarReport({ name: `${e.kind}#icon`, img: icon, raw: { w: GEN_SIZE, h: GEN_SIZE } }),
      ]
      const barFailures = bars.flatMap((bar) => (bar.ok ? [] : bar.failures))
      // The palette is reported, never a refusal: the cell keeps the model's own colours.
      console.log(
        `  ${e.kind}: palette distance ` +
          bars.map((b) => `${b.name} ${b.paletteDistance.toFixed(1)}`).join(', '),
      )
      if (barFailures.length > 0) {
        status = 'blocked'
        note = `${note} pixel bar: ${barFailures.join('; ')}`.trim()
      }
    }
    if (chosen && icon && status !== 'blocked') {
      const spritePng = await encodePng(chosen)
      const iconPng = await encodePng(icon)
      writeFileSync(join(dir, 'sprite.png'), spritePng)
      writeFileSync(join(dir, 'icon.png'), iconPng)
      const last = spriteVerdicts.at(-1)
      const score = last ? Math.min(10, Math.max(1, meanScore(last))) : null
      const r = registerLibraryEntry(codex, e, {
        sprite: spritePng,
        icon: iconPng,
        score,
        attempts: Math.min(budget, Math.max(1, attemptsUsed)),
        costUsd: ledger.totalFor(assetId) - spentBefore,
      })
      records.push(r.spriteRecord, r.iconRecord)
      writeFileSync(
        join(dir, 'report.json'),
        JSON.stringify(
          {
            kind: e.kind,
            status,
            attempts: attemptsUsed,
            spendUsd: ledger.totalFor(assetId) - spentBefore,
            spriteVerdicts,
            iconVerdicts,
          },
          null,
          2,
        ),
      )
    }

    results.push({
      kind: e.kind,
      status,
      attempts: attemptsUsed,
      spendUsd: ledger.totalFor(assetId) - spentBefore,
      scores: spriteVerdicts.at(-1)
        ? CRITERIA.map((c) => spriteVerdicts.at(-1)!.criteria[c].score)
        : [],
      iconScores: iconVerdicts.at(-1)
        ? CRITERIA.map((c) => iconVerdicts.at(-1)!.criteria[c].score)
        : [],
      note,
    })
    console.log(
      `  ${status.padEnd(8)} ${e.kind.padEnd(16)} attempts ${attemptsUsed} ` +
        `$${(ledger.totalFor(assetId) - spentBefore).toFixed(4)}`,
    )
  }

  // Read-merge-write: each batch adds its kinds to the one durable index.
  const indexPath = join(LIB, 'index.json')
  const fresh = JSON.parse(libraryIndexJson(records)) as {
    version: string
    entries: { kind: string }[]
  }
  const prior = existsSync(indexPath)
    ? (JSON.parse(readFileSync(indexPath, 'utf8')) as { entries: { kind: string }[] }).entries
    : []
  const merged = [
    ...prior.filter((p) => !fresh.entries.some((f) => f.kind === p.kind)),
    ...fresh.entries,
  ]
  writeFileSync(indexPath, JSON.stringify({ version: fresh.version, entries: merged }, null, 2))

  mkdirSync(join(ROOT, 'reports'), { recursive: true })
  const spend = results.reduce((s, r) => s + r.spendUsd, 0)
  const md = [
    `# C13 library batch \`${BATCH}\``,
    '',
    `- Items: ${results.length}. Pass: ${results.filter((r) => r.status === 'pass').length}. ` +
      `Blocked: ${results.filter((r) => r.status === 'blocked').length}. ` +
      `Errors: ${results.filter((r) => r.status === 'error').length}.`,
    `- Batch spend: **$${spend.toFixed(4)}** (estimate was $${estimateBatchCost(items).toFixed(4)}).`,
    `- Rubric v1, model \`${config.visionQa.model}\`, minScore ${config.visionQa.minScore}, ` +
      `maxRetries ${config.visionQa.maxRetries}.`,
    '',
    `| kind | status | attempts | sprite ${CRITERIA.join('/')} | icon ${CRITERIA.join('/')} | $ | note |`,
    '|---|---|---|---|---|---|---|',
    ...results.map(
      (r) =>
        `| ${r.kind} | **${r.status}** | ${r.attempts} | ${r.scores.join(' ')} | ` +
        `${r.iconScores.join(' ')} | ${r.spendUsd.toFixed(4)} | ${r.note.replace(/\|/g, '/')} |`,
    ),
    '',
  ].join('\n')
  writeFileSync(join(ROOT, 'reports', `batch-${BATCH}.md`), md)
  console.log(
    `\nbatch ${BATCH}: $${spend.toFixed(4)} — wrote ${join(ROOT, 'reports', `batch-${BATCH}.md`)}`,
  )
}

await main()

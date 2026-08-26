// Re-derives every library icon at the catalog's current iconPx. Offline and $0; JUDGE=1 re-runs
// the vision judge (LIVE, ~$0.0055 each). Under the icon ruling iconPx === spritePx, so
// deriveIcon is a byte-for-byte no-op and the icon becomes the sprite the gate already judged.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type AssetRecord } from '@sj/shared'
import { decodePng, encodePng } from '../src/post/raw.js'
import { openForgeDb } from '../src/db.js'
import { AssetCodex } from '../src/codex.js'
import { loadForgeConfig } from '../src/forgeConfig.js'
import { SpendLedger } from '../src/spendLedger.js'
import { makeVisionJudge } from '../src/visionQa/visionJudge.js'
import { recordVerdict } from '../src/visionQa/telemetry.js'
import { CRITERIA, type VisionVerdict } from '../src/visionQa/verdict.js'
import { registerLibraryEntry, deriveIcon, libraryIndexJson } from '../src/library/register.js'
import { LIBRARY } from '../src/library/catalog.js'
import { scratch } from './scratch.js'

const C13 = scratch('c13')
const FORGE = join(dirname(fileURLToPath(import.meta.url)), '..')
const LIB = join(C13, 'library')

const JUDGE = process.env.JUDGE === '1'
const KINDS = (process.env.KINDS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const apiKey = process.env.OPENROUTER_API_KEY
if (JUDGE && !apiKey) throw new Error('OPENROUTER_API_KEY not set')

type Report = {
  kind: string
  status: string
  attempts: number
  spendUsd: number
  spriteVerdicts: VisionVerdict[]
  iconVerdicts: VisionVerdict[]
}

const meanScore = (v: VisionVerdict): number =>
  CRITERIA.reduce((s, k) => s + v.criteria[k].score, 0) / CRITERIA.length

async function main(): Promise<void> {
  const entries = LIBRARY.filter((e) => KINDS.length === 0 || KINDS.includes(e.kind))
  const config = loadForgeConfig()
  const db = openForgeDb(join(LIB, 'library.db'))
  const codex = new AssetCodex(db)
  const ledger = new SpendLedger(join(C13, 'spend.json'))
  const judge = JUDGE
    ? makeVisionJudge({
        apiKey: apiKey!,
        config,
        refs: [readFileSync(join(FORGE, 'content', 'reference', 'style-anchor.png'))],
      })
    : null

  const records: AssetRecord[] = []
  let spend = 0
  for (const e of entries) {
    const dir = join(LIB, e.kind)
    const spritePath = join(dir, 'sprite.png')
    if (!existsSync(spritePath)) {
      console.log(`  SKIP ${e.kind} — no sprite`)
      continue
    }
    const spritePng = readFileSync(spritePath)
    const report = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')) as Report

    const icon = deriveIcon(await decodePng(spritePng), e.iconPx)
    const iconPng = await encodePng(icon)
    writeFileSync(join(dir, 'icon.png'), iconPng)

    let note = ''
    if (judge) {
      const iv = await judge({
        assetId: `library:${e.kind}#icon`,
        klass: 'icon',
        sprite: icon,
        commission: e.desc,
        attempt: 1,
      })
      // D-6 unchanged: the icon is a downscale, so its judge call books on the sprite's id.
      ledger.append({
        assetId: `library:${e.kind}`,
        kind: 'vision_qa',
        model: iv.verdict.model,
        usd: iv.costUsd,
      })
      ledger.flush()
      recordVerdict(db, iv.verdict, { assetClass: 'icon', attempt: 1, costUsd: iv.costUsd })
      report.iconVerdicts = [iv.verdict]
      spend += iv.costUsd
      note = `${iv.verdict.overall} ${CRITERIA.map((c) => iv.verdict.criteria[c].score).join(' ')}`
    }
    writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2))

    const last = report.spriteVerdicts.at(-1)
    const r = registerLibraryEntry(codex, e, {
      sprite: spritePng,
      icon: iconPng,
      score: last ? Math.min(10, Math.max(1, meanScore(last))) : null,
      attempts: Math.min(3, Math.max(1, report.attempts)),
      costUsd: 0,
    })
    records.push(r.spriteRecord, r.iconRecord)
    console.log(`  ${e.kind.padEnd(16)} icon ${e.iconPx}px ${note}`)
  }

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
  console.log(`\n${records.length / 2} entries re-derived; judge spend $${spend.toFixed(4)}`)
}

await main()

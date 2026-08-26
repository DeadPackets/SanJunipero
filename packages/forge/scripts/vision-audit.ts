// REPORT-ONLY retrofit audit: runs the vision gate BACKWARDS over already-shipped art. It never
// mutates the codex, overwrites art or regenerates; failures are queued for a human.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePng } from '../src/post/raw.js'
import { openForgeDb } from '../src/db.js'
import { loadForgeConfig } from '../src/forgeConfig.js'
import { SpendLedger } from '../src/spendLedger.js'
import { makeVisionJudge, EST_COST_PER_VISION_CALL } from '../src/visionQa/visionJudge.js'
import { recordVerdict, passRates } from '../src/visionQa/telemetry.js'
import { CRITERIA, type VisionVerdict } from '../src/visionQa/verdict.js'
import { scratch } from './scratch.js'

const DRY = process.env.DRY === '1'
const C13 = scratch('c13')
const C5 = scratch('c5', 'production')
const FORGE = join(dirname(fileURLToPath(import.meta.url)), '..')
const TILESETS = join(FORGE, 'content', 'tilesets')

const apiKey = process.env.OPENROUTER_API_KEY
if (!DRY && !apiKey) throw new Error('OPENROUTER_API_KEY not set')

type Unit = { id: string; klass: string; path: string; commission: string; footprint?: { w: number; h: number }; expectedFacing?: string }

const FOUNDERS = [
  { id: 'amara', desc: 'a kind woman healer villager with grey-streaked hair under a soft water-blue headscarf, a cream apron dress with honey-gold trim, and a worn leather herb satchel strap' },
  { id: 'yusuf', desc: 'a sturdy older man villager with a short grey beard, a warm-grey flat cap and a honey-brown carpenter apron over a cream work shirt' },
  { id: 'nadia', desc: 'a young adult woman villager with a honey-brown braid, a straw sun hat with a brown band and a sage-green work dress' },
  { id: 'salma', desc: 'a stout middle-aged woman villager with dark hair in a round bun, a dusty-rose dress with pale sage trim and a white cooking apron' },
]
const EXPRESSIONS = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'weary', 'asleep']
const BUILDINGS = [
  { id: 'storehouse', fp: { w: 2, h: 2 }, door: true, desc: 'a sturdy communal storehouse of honey-wood planks on a cream-stone base, wide double doors, a small hay loft window under the roof peak' },
  { id: 'wagon', fp: { w: 1, h: 2 }, door: false, desc: 'a settler travel wagon with a rounded cream canvas cover, honey-wood body and two big spoked wheels, standing still with no animals' },
  { id: 'shed', fp: { w: 1, h: 1 }, door: true, desc: 'a small honey-wood tool shed with a single plank door and a slanted roof' },
  { id: 'scaffolding', fp: { w: 1, h: 1 }, door: false, desc: 'a construction scaffolding of honey-wood poles and cream canvas wraps' },
  { id: 'standing-stone', fp: { w: 1, h: 1 }, door: false, desc: 'an ancient weathered warm-grey standing stone, taller than a person, softly rounded edges, faint moss at its base' },
]
const SEASONS = ['spring', 'summer', 'autumn', 'winter']

function enumerate(): { units: Unit[]; skipped: string[] } {
  const units: Unit[] = []
  const skipped: string[] = []

  for (const f of FOUNDERS)
    units.push({
      id: `character:${f.id}`, klass: 'character', path: join(C5, f.id, 'contact-sheet.png'),
      commission: `${f.desc} — the full contact sheet of poses`,
      expectedFacing: 'the direction its own row is labelled with; every row must face where it claims',
    })

  for (const f of FOUNDERS)
    for (const e of EXPRESSIONS)
      units.push({
        id: `portrait:${f.id}:${e}`, klass: 'portrait',
        path: join(C5, f.id, 'portraits', 'final', `${e}.png`),
        commission: `${f.desc} — a ${e} portrait bust`,
        expectedFacing: 'the viewer, as a three-quarter bust',
      })

  for (const b of BUILDINGS)
    units.push({
      id: `building:${b.id}`, klass: 'building', path: join(C5, `building-${b.id}`, 'cell.png'),
      commission: b.desc, footprint: b.fp,
      expectedFacing: b.door ? 'door to the south-west' : 'no door; light from the north-west',
    })

  if (!existsSync(TILESETS)) skipped.push(`terrain season sheets (${SEASONS.length}): ${TILESETS} does not exist — C10 Task 1 owns it`)
  else for (const s of SEASONS) {
    const p = join(TILESETS, `${s}.png`)
    if (existsSync(p)) units.push({ id: `terrain:${s}`, klass: 'terrain', path: p, commission: `the ${s} terrain tile sheet` })
    else skipped.push(`terrain:${s} — ${p} missing`)
  }
  return { units, skipped }
}

async function main(): Promise<void> {
  const { units, skipped } = enumerate()
  const missing = units.filter(u => !existsSync(u.path))
  const cost = units.length * EST_COST_PER_VISION_CALL

  console.log(`vision-audit ${DRY ? 'DRY PLAN' : 'LIVE'} — ${units.length} units, ${units.length} calls, est $${cost.toFixed(4)}`)
  for (const u of units) console.log(`  ${existsSync(u.path) ? 'ok  ' : 'MISS'} ${u.id.padEnd(28)} ${u.klass.padEnd(10)} ${u.path}`)
  for (const s of skipped) console.log(`  skip ${s}`)
  if (missing.length) { console.error(`${missing.length} expected input file(s) missing`); process.exit(1) }
  if (DRY) { console.log('DRY: no API calls made.'); return }

  mkdirSync(join(C13, 'audit', 'verdicts'), { recursive: true })
  const config = loadForgeConfig()
  const ledger = new SpendLedger(join(C13, 'spend.json'))
  const db = openForgeDb(join(C13, 'audit', 'vision-audit.db'))
  const anchor = readFileSync(join(FORGE, 'content', 'reference', 'style-anchor.png'))
  const judge = makeVisionJudge({ apiKey: apiKey!, refs: [anchor], config })

  const results: { unit: Unit; verdict: VisionVerdict; costUsd: number }[] = []
  for (const u of units) {
    const sprite = await decodePng(readFileSync(u.path))
    const { verdict, costUsd } = await judge({
      assetId: u.id, klass: u.klass, sprite, commission: u.commission,
      footprint: u.footprint, expectedFacing: u.expectedFacing, attempt: 1,
    })
    ledger.append({ assetId: u.id, kind: 'vision_qa', model: verdict.model, usd: costUsd })
    ledger.flush()
    recordVerdict(db, verdict, { assetClass: u.klass, attempt: 1, costUsd })
    writeFileSync(join(C13, 'audit', 'verdicts', `${u.id.replace(/:/g, '_')}.json`), JSON.stringify(verdict, null, 2))
    results.push({ unit: u, verdict, costUsd })
    console.log(`  ${verdict.overall.padEnd(7)} ${u.id}`)
  }

  const fails = results.filter(r => r.verdict.overall !== 'pass')
  const queue = (klasses: string[]) => fails.filter(r => klasses.includes(r.unit.klass))
  const masters = queue(['character', 'building', 'portrait'])
  const props = queue(['item', 'terrain'])
  const row = (r: typeof results[number]) =>
    `| ${r.unit.id} | ${r.unit.klass} | ${CRITERIA.map(c => r.verdict.criteria[c].score).join(' / ')} | **${r.verdict.overall}** |`

  const md = [
    '# C13 Task 8 — retrofit vision audit (REPORT-ONLY)',
    '',
    '**No asset was modified, regenerated, or re-registered by this run.**',
    '',
    `- Rubric: v1, model \`${config.visionQa.model}\`, minScore ${config.visionQa.minScore}, attempt 1 only (no retries — an audit does not regenerate).`,
    `- Units judged: ${results.length}. Skipped: ${skipped.length ? skipped.join('; ') : 'none'}.`,
    `- Audit spend: $${results.reduce((s, r) => s + r.costUsd, 0).toFixed(4)}.`,
    '',
    '## Verdicts',
    '',
    `| unit | class | ${CRITERIA.join(' / ')} | overall |`,
    '|---|---|---|---|',
    ...results.map(row),
    '',
    '## Pass rates',
    '',
    '| scope | firstPass | withinRetries | blocked | n |',
    '|---|---|---|---|---|',
    ...['character', 'portrait', 'building', 'terrain']
      .map(k => ({ k, r: passRates(db, k) })).filter(x => x.r.n > 0)
      .map(({ k, r }) => `| ${k} | ${r.firstPass.toFixed(3)} | ${r.withinRetries.toFixed(3)} | ${r.blocked.toFixed(3)} | ${r.n} |`),
    (() => { const r = passRates(db); return `| ALL | ${r.firstPass.toFixed(3)} | ${r.withinRetries.toFixed(3)} | ${r.blocked.toFixed(3)} | ${r.n} |` })(),
    '',
    '## Masters queue (HUMAN EYEBALL — never auto-regenerated)',
    '',
    masters.length ? masters.map(r => `- \`${r.unit.id}\` — ${r.verdict.feedback}`).join('\n') : '_empty_',
    '',
    '## Props queue (normal regeneration loop)',
    '',
    props.length ? props.map(r => `- \`${r.unit.id}\` — ${r.verdict.feedback}`).join('\n') : '_empty_',
    '',
  ].join('\n')

  writeFileSync(join(C13, 'audit', 'vision-audit-report.md'), md)
  console.log(`\nwrote ${join(C13, 'audit', 'vision-audit-report.md')}`)
}

await main()

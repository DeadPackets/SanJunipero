// LIVE — the library repair round. One targeted EDIT call per item on the raw the KEPT
// sprite came from (the repair-building precedent, items instead of buildings), reprocessed
// through the same item post chain and judged by both instruments (sprite, then icon).
// Items are props, not masters, so a passing repair deploys itself; a failing one is kept
// beside the original and reported.
//
//   ITEMS=timber,stool node --env-file=/Users/deadpackets/workspace/SanJunipero/.env \
//     node_modules/.pnpm/tsx@4.23.12/node_modules/tsx/dist/cli.mjs packages/forge/scripts/repair-library.ts
//
// DRY=1 prints the plan and spends nothing. DEPLOY=0 judges without writing over the art.
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePng, encodePng, type RawImage } from '../src/post/raw.js'
import { openForgeDb } from '../src/db.js'
import { AssetCodex } from '../src/codex.js'
import { loadForgeConfig } from '../src/forgeConfig.js'
import { SpendLedger } from '../src/spendLedger.js'
import { makeVisionJudge } from '../src/visionQa/visionJudge.js'
import { recordVerdict } from '../src/visionQa/telemetry.js'
import { CRITERIA, criterionOf, type VisionVerdict } from '../src/visionQa/verdict.js'
import { libraryEntry, type LibraryEntry } from '../src/library/catalog.js'
import { itemBoilerplate, itemCommission } from '../src/library/plan.js'
import { toSpriteCell } from '../src/library/postItem.js'
import { registerLibraryEntry, libraryIndexJson } from '../src/library/register.js'

const C13 = '/private/tmp/claude-501/-Users-deadpackets-workspace-SanJunipero/461805e8-9eb9-4d32-b2ea-e2ef16ce8545/scratchpad/c13'
const LIB = join(C13, 'library')
const FORGE = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENDPOINT = 'https://openrouter.ai/api/v1/images/generations'
const MODEL = 'google/gemini-3.1-flash-image'
const MAX_ROUNDS = 2      // the two-strike rule: two edits, then the original stands

const DRY = process.env.DRY === '1'
const DEPLOY = process.env.DEPLOY !== '0'
const apiKey = process.env.OPENROUTER_API_KEY
if (!DRY && !apiKey) throw new Error('OPENROUTER_API_KEY not set')

type Repair = {
  kind: string
  srcRaw: string    // the raw the KEPT sprite was cut from — never a raw that lost the pick
  defect: string
  notes: readonly string[]   // one per strike; a second strike restarts from the same raw
}

// The defect lines are measured on the KEPT art, not on the last verdict in report.json:
// a blocked item keeps its BEST attempt, so the closing verdict often scores a discarded
// candidate. Both kept sprites are alpha-clean (0 semi-opaque pixels, one component) —
// what the judge called "transparency 0" is a stray off-ramp SPECK, and that is the fix.
const REPAIRS: readonly Repair[] = [
  {
    kind: 'timber', srcRaw: 'a2-c1-raw.png',
    defect: 'density 6.5, proportion 8.5 — salt-and-pepper single-pixel speckle across the '
      + 'wood with near-black flecks off the honey ramp, no plank seams and no end grain, so '
      + 'the stack reads as one lumpy block instead of three squared planks',
    // Flat repaint leads on both items: it is the instruction that cleared the storehouse's
    // micro-dither, and the softer "replace the speckle" wording was measured here first and
    // left the flecks in place (density 6.5 -> 7, seams gained, speckle unchanged).
    notes: [
      'repaint the whole stack as three flat honey-brown planks with one solid colour per face, '
      + 'a single darker line between each plank and a single darker line around the outside, and '
      + 'plain straight crosscut lines on the end faces. No speckles, no dots, no dithering '
      + 'anywhere, no dark navy and no black, and no colour that is not already on the wood.',
      'replace every scattered single-pixel speckle across the wood with flat blocks of solid '
      + 'colour four screen units across, cut two clean horizontal seams so three stacked planks '
      + 'read apart, and mark the end faces with plain straight crosscut lines. Use ONLY the '
      + 'honey-wood browns already on the stack and introduce NO new colour of any kind — no '
      + 'dark navy, no black, no grey flecks.',
    ],
  },
  {
    kind: 'stool', srcRaw: 'a2-c1-raw.png',
    defect: 'palette 8, density 6.5 — stray single-pixel dots scattered over the seat top and '
      + 'stray purple-pink pixels off the wood ramp around the seat rim',
    // The flat-repaint note leads because the softer "group the dots" note was measured first
    // and left the speckle in place (9.5, judge still asking for the rim); the flat repaint
    // scored 9.8 and cleared it. The palette is frozen in both, so neither can drift (R-22).
    notes: [
      'repaint the seat as one flat honey-brown disc with a single lighter crescent along its top '
      + 'edge and a single darker line around its rim, and repaint each leg as one flat honey-brown '
      + 'bar. No speckles, no dots, no purple, no pink, and no colour that is not already on the wood.',
      'group the scattered single-pixel dots on the seat top into two clean bands, one lighter '
      + 'highlight and one darker shadow, and repaint every stray purple or pink pixel around the '
      + 'seat rim in the honey-wood browns already on the stool. Keep the seat, the legs and the '
      + 'outline exactly where they are and introduce NO new colour of any kind.',
    ],
  },
]

const FILTER = (process.env.ITEMS ?? REPAIRS.map(r => r.kind).join(',')).split(',').map(s => s.trim())
const RUN = REPAIRS.filter(r => FILTER.includes(r.kind))
if (RUN.length === 0) throw new Error(`ITEMS=${process.env.ITEMS} matches nothing`)

// PROMOTE=stool:2 deploys a strike this script already judged, at $0 and with no new call.
const PROMOTE = new Map((process.env.PROMOTE ?? '').split(',').map(s => s.trim()).filter(Boolean)
  .map(s => { const [k, n] = s.split(':'); return [k!, Number(n)] as const }))

const config = loadForgeConfig()
const ledger = new SpendLedger(join(C13, 'spend.json'))
const anchorRef = readFileSync(join(FORGE, 'content', 'reference', 'style-anchor.png'))

function editPrompt(e: LibraryEntry, note: string): string {
  return `${itemBoilerplate(e)} Reproduce the LAST reference image EXACTLY — the same single object, `
    + 'the same shape, the same size, the same position on the magenta background — with ONE '
    + `change: ${note} Everything else stays identical. ${itemCommission(e)} `
    + 'NO text, NO labels, NO people, NO scenery, NO ground plane. '
    + 'Do NOT draw the cottage from the first reference image (it is a STYLE reference only).'
}

async function editCall(src: Buffer, prompt: string): Promise<{ png: Buffer; costUsd: number }> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey!}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, prompt, size: '1024x1024', response_format: 'b64_json',
      input_references: [anchorRef, src].map(b =>
        ({ type: 'image_url', image_url: { url: `data:image/png;base64,${b.toString('base64')}` } })),
      usage: { include: true },
    }),
  })
  if (!res.ok) throw new Error(`${MODEL} HTTP ${res.status}: ${await res.text()}`)
  const json = (await res.json()) as { data?: { b64_json?: string }[]; usage?: { cost?: number } }
  const b64 = (json.data ?? []).filter(d => d.b64_json).at(-1)?.b64_json
  if (!b64) throw new Error(`${MODEL}: no b64_json in data[]`)
  return { png: Buffer.from(b64, 'base64'), costUsd: json.usage?.cost ?? 0.045 }
}

const mean = (v: VisionVerdict): number =>
  CRITERIA.reduce((s, c) => s + (criterionOf(v, c)?.score ?? 0), 0)
  / CRITERIA.filter(c => criterionOf(v, c) !== undefined).length

type Round = { round: number; raw: string; sprite: VisionVerdict; icon: VisionVerdict }
type Row = { kind: string; rounds: Round[]; deployed: number | null; costUsd: number }

const roundPath = (dir: string, n: number, f: string): string => join(dir, `repair-r${n}-${f}`)

function deployRepair(e: LibraryEntry, n: number, r: Round, spend: number): void {
  const dir = join(LIB, e.kind)
  const backup = join(dir, 'pre-repair')
  if (!existsSync(backup)) {
    mkdirSync(backup, { recursive: true })
    for (const f of ['sprite.png', 'icon.png', 'report.json'])
      if (existsSync(join(dir, f))) cpSync(join(dir, f), join(backup, f))
  }
  const spritePng = readFileSync(roundPath(dir, n, 'sprite.png'))
  const iconPng = readFileSync(roundPath(dir, n, 'icon.png'))
  writeFileSync(join(dir, 'sprite.png'), spritePng)
  writeFileSync(join(dir, 'icon.png'), iconPng)
  const prior = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')) as Record<string, unknown>
  // Deploying the same strike twice must not append its verdicts twice.
  const again = prior['repairRaw'] === r.raw
  writeFileSync(join(dir, 'report.json'), JSON.stringify({
    ...prior, status: 'pass', repairedAt: new Date().toISOString(), repairRaw: r.raw,
    spriteVerdicts: again ? prior['spriteVerdicts'] : [...(prior['spriteVerdicts'] as VisionVerdict[]), r.sprite],
    iconVerdicts: again ? prior['iconVerdicts'] : [...(prior['iconVerdicts'] as VisionVerdict[]), r.icon],
    spendUsd: ledger.totalFor(`library:${e.kind}`),
  }, null, 2))

  const rec = registerLibraryEntry(codex, e, {
    sprite: spritePng, icon: iconPng, score: Math.min(10, Math.max(1, mean(r.sprite))),
    attempts: n, costUsd: spend,
  })
  // Read-merge-write, same law as the batch runner: a repair replaces one index row.
  const indexPath = join(LIB, 'index.json')
  const fresh = JSON.parse(libraryIndexJson([rec.spriteRecord, rec.iconRecord])) as
    { version: string; entries: { kind: string }[] }
  const prevEntries = existsSync(indexPath)
    ? (JSON.parse(readFileSync(indexPath, 'utf8')) as { entries: { kind: string }[] }).entries
    : []
  writeFileSync(indexPath, JSON.stringify({
    version: fresh.version,
    entries: [...prevEntries.filter(p => !fresh.entries.some(f => f.kind === p.kind)), ...fresh.entries],
  }, null, 2))
  console.log(`  DEPLOYED ${e.kind} from ${r.raw}`)
}

if (DRY) {
  console.log(`repair-library DRY PLAN — ${RUN.length} item(s), up to ${MAX_ROUNDS} edits each`)
  for (const r of RUN) console.log(`  ${r.kind.padEnd(10)} src ${r.srcRaw} — ${r.defect}`)
  console.log('DRY: no API calls made.')
  process.exit(0)
}

mkdirSync(LIB, { recursive: true })
const db = openForgeDb(join(LIB, 'library.db'))
const codex = new AssetCodex(db)
const judge = makeVisionJudge({ apiKey: apiKey!, refs: [anchorRef], config })

const rows: Row[] = []
for (const r of RUN) {
  const e = libraryEntry(r.kind)
  if (e === null) throw new Error(`${r.kind} is not a library entry`)
  const assetId = `library:${e.kind}`
  const dir = join(LIB, e.kind)
  const spentBefore = ledger.totalFor(assetId)
  console.log(`\n== ${e.kind} — ${r.defect}`)

  // A strike already judged is deployed by name at $0 — the R-21 promote path, so a better
  // later strike can be chosen without paying for the edit twice.
  const promote = PROMOTE.get(e.kind)
  if (promote !== undefined) {
    const saved = JSON.parse(readFileSync(roundPath(dir, promote, 'verdicts.json'), 'utf8')) as Round
    if (saved.sprite.overall !== 'pass') throw new Error(`${e.kind} r${promote}: sprite gate is red`)
    deployRepair(e, promote, saved, ledger.totalFor(assetId) - spentBefore)
    rows.push({ kind: e.kind, rounds: [saved], deployed: promote, costUsd: 0 })
    continue
  }

  const src = readFileSync(join(dir, 'candidates', r.srcRaw))
  const rounds: Round[] = []
  let deployed: number | null = null
  // Strike numbers are never reused: a second invocation that overwrote `repair-r1-*` would
  // leave the art already deployed from it pointing at somebody else's bytes.
  let base = 0
  while (existsSync(roundPath(dir, base + 1, 'sprite.png'))) base++
  for (let strike = 1, n = base + 1; strike <= MAX_ROUNDS && deployed === null; strike++, n++) {
    // A repair round never chains onto its own drift (R-22): every strike starts from the
    // same original raw, and only the note changes.
    const edit = await editCall(src, editPrompt(e, r.notes[strike - 1]!))
    ledger.append({ assetId, kind: 'image_gen', model: MODEL, usd: edit.costUsd })
    ledger.flush()
    const rawKey = `repair-r${n}-raw.png`
    writeFileSync(join(dir, 'candidates', rawKey), edit.png)

    const { cell } = toSpriteCell(await decodePng(edit.png), e.spritePx)
    const iconCell = toSpriteCell(await decodePng(edit.png), e.iconPx).cell
    writeFileSync(roundPath(dir, n, 'sprite.png'), await encodePng(cell))
    writeFileSync(roundPath(dir, n, 'icon.png'), await encodePng(iconCell))

    const s = await judge({ assetId, klass: 'item', sprite: cell, commission: e.desc, attempt: 1 })
    ledger.append({ assetId, kind: 'vision_qa', model: s.verdict.model, usd: s.costUsd })
    recordVerdict(db, s.verdict, { assetClass: 'item', attempt: n, costUsd: s.costUsd })
    const i = await judge({
      assetId: `${assetId}#icon`, klass: 'icon', sprite: iconCell, commission: e.desc, attempt: 1,
    })
    // D-6: the icon is a resample of a generation already paid for; it books on the sprite's id.
    ledger.append({ assetId, kind: 'vision_qa', model: i.verdict.model, usd: i.costUsd })
    ledger.flush()
    recordVerdict(db, i.verdict, { assetClass: 'icon', attempt: n, costUsd: i.costUsd })
    const round: Round = { round: n, raw: rawKey, sprite: s.verdict, icon: i.verdict }
    rounds.push(round)
    writeFileSync(roundPath(dir, n, 'verdicts.json'), JSON.stringify(round, null, 2))
    console.log(`  strike ${n}: sprite ${s.verdict.overall} (${mean(s.verdict).toFixed(1)}) `
      + `icon ${i.verdict.overall} (${mean(i.verdict).toFixed(1)})`)

    // The SPRITE verdict is the gate. Under the icon ruling the icon IS the sprite at the same
    // 24 px, so its verdict is a second read of one image, not a second bar to clear — gating on
    // it is R-20 again, and the judge moves +-3 points on identical pixels (batch-C concern 3).
    if (s.verdict.overall !== 'pass') continue
    if (!DEPLOY) { console.log('  DEPLOY=0 — held'); break }
    deployRepair(e, n, round, ledger.totalFor(assetId) - spentBefore)
    deployed = n
  }

  rows.push({ kind: e.kind, rounds, deployed, costUsd: ledger.totalFor(assetId) - spentBefore })
  if (deployed === null) console.log(`  held — ${MAX_ROUNDS} strikes, the original art stands`)
}

// Composed from every repair on disk, not just this run's, so an ITEMS= rerun does not erase
// the other rows (the batch-<name>.md lesson the building round already learned).
for (const row of rows) writeFileSync(join(LIB, row.kind, 'repair.json'), JSON.stringify(row, null, 2))
for (const r of REPAIRS) {
  if (rows.some(x => x.kind === r.kind)) continue
  const p = join(LIB, r.kind, 'repair.json')
  if (existsSync(p)) rows.push(JSON.parse(readFileSync(p, 'utf8')) as Row)
}
rows.sort((a, b) => REPAIRS.findIndex(r => r.kind === a.kind) - REPAIRS.findIndex(r => r.kind === b.kind))

const scores = (v: VisionVerdict): string =>
  CRITERIA.map(c => criterionOf(v, c)?.score ?? '—').join(' ')
const md = [
  '# C13 G13 full-close — library repair round (`timber`, `stool`)',
  '',
  'One edit call per strike on the raw the KEPT sprite was cut from, reprocessed through the',
  'item post chain and judged twice. The SPRITE verdict is the gate; the icon column is a second',
  'read of the same 24 px image under the icon ruling, reported and never gating. Two strikes,',
  'then the original art stands.',
  '',
  `| item | strike | raw | sprite | icon | ${CRITERIA.join('/')} | deployed | $ |`,
  '|---|---|---|---|---|---|---|---|',
  ...rows.flatMap(r => r.rounds.map(x =>
    `| \`${r.kind}\` | ${x.round} | \`${x.raw}\` | **${x.sprite.overall}** | ${x.icon.overall} | `
    + `${scores(x.sprite)} | ${r.deployed === x.round ? '**yes**' : 'no'} | ${r.costUsd.toFixed(4)} |`)),
  '',
  '## Defects, as measured on the KEPT art',
  '',
  ...REPAIRS.filter(r => rows.some(x => x.kind === r.kind))
    .map(r => `- \`${r.kind}\` — ${r.defect}\n  - edit: ${r.notes[0]}`),
  '',
  '## Judge feedback per strike',
  '',
  ...rows.flatMap(r => r.rounds.map(x => `- \`${r.kind}\` strike ${x.round}: ${x.sprite.feedback}`)),
  '',
].join('\n')
mkdirSync(join(C13, 'reports'), { recursive: true })
writeFileSync(join(C13, 'reports', 'library-repair.md'), md)
console.log(`\nwrote ${join(C13, 'reports', 'library-repair.md')} — `
  + `${rows.filter(r => r.deployed !== null).length}/${rows.length} deployed, `
  + `$${rows.reduce((s, r) => s + r.costUsd, 0).toFixed(4)}`)

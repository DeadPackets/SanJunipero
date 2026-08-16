// The alignment CI gate. The PIXEL half runs over every shipped building KEYLESSLY and
// exits non-zero on any failure. The vision SEAT half runs only when OPENROUTER_API_KEY is
// present; a seat failure is feedback for the Task 6 loop, never a silent pass.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePng, encodePng, downscaleNearest, type RawImage } from '../src/post/raw.js'
import { targetSize } from '../src/styleBible.js'
import { loadForgeConfig } from '../src/forgeConfig.js'
import { SpendLedger } from '../src/spendLedger.js'
import { makeVisionJudge } from '../src/visionQa/visionJudge.js'
import { validateBuildingAlignment, footprintDiamond, testGridRender, SEAT_CRITERION_PROMPT } from '../src/alignment.js'

const C13 = '/private/tmp/claude-501/-Users-deadpackets-workspace-SanJunipero/461805e8-9eb9-4d32-b2ea-e2ef16ce8545/scratchpad/c13'
const C5 = '/private/tmp/claude-501/-Users-deadpackets-workspace-SanJunipero/461805e8-9eb9-4d32-b2ea-e2ef16ce8545/scratchpad/c5/production'
const FORGE = join(dirname(fileURLToPath(import.meta.url)), '..')
const BUILDINGS = ['storehouse', 'wagon', 'shed', 'scaffolding', 'standing-stone']

const config = loadForgeConfig()
const apiKey = process.env.OPENROUTER_API_KEY
mkdirSync(join(C13, 'audit'), { recursive: true })

type Manifest = { kind: string; footprint: { w: number; h: number }; cell: { w: number; h: number; feetX: number; feetY: number } }

// v4 building cells ship at NATIVE resolution, trimmed to the figure, with a feet anchor;
// the renderer scales them into the target cell. The alignment law is written in target-cell
// pixels, so rebuild that cell here: uniform downscale, then place the feet at the centre.
function toTargetCell(img: RawImage, man: Manifest): { img: RawImage; cell: { w: number; h: number; feetY: number } } {
  const t = targetSize('building', man.footprint)
  const scale = man.cell.h / t.h
  const small = downscaleNearest(img, Math.max(1, Math.round(man.cell.w / scale)), t.h)
  const feetX = Math.round(man.cell.feetX / scale)
  const feetY = Math.min(t.h - 1, Math.round(man.cell.feetY / scale))
  const dx = Math.round(t.w / 2) - feetX
  const out: RawImage = { width: t.w, height: t.h, data: new Uint8ClampedArray(t.w * t.h * 4) }
  for (let y = 0; y < small.height; y++)
    for (let x = 0; x < small.width; x++) {
      const nx = x + dx
      if (nx < 0 || nx >= t.w || y >= t.h) continue
      out.data.set(small.data.subarray((y * small.width + x) * 4, (y * small.width + x) * 4 + 4), (y * t.w + nx) * 4)
    }
  return { img: out, cell: { w: t.w, h: t.h, feetY } }
}
type Row = { id: string; ok: boolean; failures: string[]; measured: Record<string, number>; diamond: Record<string, number>; seat?: { score: number; evidence: string; pass: boolean } }

const rows: Row[] = []
for (const id of BUILDINGS) {
  const dir = join(C5, `building-${id}`)
  const cellPath = join(dir, 'cell.png'), manPath = join(dir, 'manifest.json')
  if (!existsSync(cellPath) || !existsSync(manPath)) { console.error(`MISSING ${id}`); process.exit(1) }
  const man = JSON.parse(readFileSync(manPath, 'utf8')) as Manifest
  const { img, cell } = toTargetCell(await decodePng(readFileSync(cellPath)), man)
  const r = validateBuildingAlignment(img, man.footprint, config.alignment, cell)
  rows.push({ id, ok: r.ok, failures: r.failures, measured: r.measured, diamond: footprintDiamond(man.footprint, cell) })
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'} ${id.padEnd(16)} ${r.failures.join('; ')}`)
}

if (apiKey) {
  const anchor = readFileSync(join(FORGE, 'content', 'reference', 'style-anchor.png'))
  const judge = makeVisionJudge({ apiKey, refs: [anchor], config })
  const ledger = new SpendLedger(join(C13, 'spend.json'))
  mkdirSync(join(C13, 'audit', 'seat'), { recursive: true })
  for (const row of rows) {
    const dir = join(C5, `building-${row.id}`)
    const man = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Manifest
    const { img } = toTargetCell(await decodePng(readFileSync(join(dir, 'cell.png'))), man)
    const grid = testGridRender(img, man.footprint)
    writeFileSync(join(C13, 'audit', 'seat', `${row.id}.png`), await encodePng(grid))
    const { verdict, costUsd } = await judge({
      assetId: `seat:${row.id}`, klass: 'building', sprite: grid, attempt: 1,
      commission: `${man.kind} on its footprint diamond. ${SEAT_CRITERION_PROMPT}`,
      footprint: man.footprint, expectedFacing: 'door to the south-west',
    })
    ledger.append({ assetId: `seat:${row.id}`, kind: 'vision_qa', model: verdict.model, usd: costUsd })
    ledger.flush()
    row.seat = {
      score: verdict.criteria.alignment.score,
      pass: verdict.criteria.alignment.pass,
      evidence: verdict.criteria.alignment.evidence,
    }
    console.log(`  seat ${row.id.padEnd(16)} ${row.seat.score} — ${row.seat.evidence}`)
  }
} else {
  console.log('  (no OPENROUTER_API_KEY — pixel half only, seat check skipped)')
}

const md = [
  '# C13 Task 14 — alignment audit',
  '',
  `- Pixel half: keyless, over ${rows.length} shipped buildings. Tolerances: feet ±${config.alignment.feetTolerancePx}px, base fit ${config.alignment.baseFitToleranceQuarterTiles} quarter-tile.`,
  `- Seat half (vision): ${apiKey ? 'run' : 'SKIPPED (no key)'}.`,
  '',
  '| building | pixel | bottomY | nearVertexY | base x | diamond x | seat | failures |',
  '|---|---|---|---|---|---|---|---|',
  ...rows.map(r => `| ${r.id} | ${r.ok ? 'PASS' : '**FAIL**'} | ${r.measured.bottomY} | ${r.diamond.nearVertexY} | ${r.measured.baseLeft}..${r.measured.baseRight} | ${r.diamond.leftX}..${r.diamond.rightX} | ${r.seat ? r.seat.score : '—'} | ${r.failures.join('; ') || '—'} |`),
  '',
  ...(rows.some(r => r.seat) ? ['## Seat evidence', '', ...rows.filter(r => r.seat).map(r => `- \`${r.id}\` (${r.seat!.score}): ${r.seat!.evidence}`), ''] : []),
].join('\n')

writeFileSync(join(C13, 'audit', 'align-audit.md'), md)
console.log(`\nwrote ${join(C13, 'audit', 'align-audit.md')}`)

const failed = rows.filter(r => !r.ok)
if (failed.length) { console.error(`\nCI GATE FAILED: ${failed.length}/${rows.length} buildings misaligned`); process.exit(1) }
console.log(`\nCI GATE PASSED: ${rows.length}/${rows.length} buildings aligned`)

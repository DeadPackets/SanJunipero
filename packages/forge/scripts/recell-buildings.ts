// OFFLINE, $0.00 — re-cell the five production buildings from their cached 1024 raws; every
// shipped cell.png was matched byte-for-byte to one raw, so this repairs from source.
// Writes a LEAN art root: point SJ_ART_ROOT at it to see the repair, remove it to undo.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { decodePng, encodePng } from '../src/post/raw.js'
import { cellAnchor } from '../src/hires.js'
import { buildingCellPx, spriteCell } from '../src/reCell.js'
import {
  integerScaleGate,
  paletteDistance,
  spriteDensity,
  classDensityGate,
} from '../src/pixelGates.js'
import { TOWN_TILE } from '../src/assetResolution.js'
import { keyBg } from './lib/cells.js'
import { scratch } from './scratch.js'

const S = scratch()

const SRC = `${S}/c5/production`
const OUT = `${S}/fqc2/art-root/production`

// dir -> the raw the shipped cell.png was proved to come from (out/fqc2/identify-raws.mts)
const BUILDINGS = [
  { dir: 'building-storehouse', raw: 'building-storehouse-r1', fp: { w: 2, h: 2 } },
  { dir: 'building-wagon', raw: 'building-wagon-r1', fp: { w: 1, h: 2 } },
  { dir: 'building-shed', raw: 'building-shed-r1', fp: { w: 1, h: 1 } },
  { dir: 'building-scaffolding', raw: 'building-scaffolding-c0', fp: { w: 1, h: 1 } },
  { dir: 'building-standing-stone', raw: 'building-standing-stone-r2', fp: { w: 1, h: 1 } },
] as const

const rows: string[] = []
const members: { name: string; density: number }[] = []
const refused: string[] = []

for (const b of BUILDINGS) {
  const from = join(SRC, b.dir),
    to = join(OUT, b.dir)
  mkdirSync(join(to, 'raws'), { recursive: true })
  const manifest = JSON.parse(readFileSync(join(from, 'manifest.json'), 'utf8')) as {
    version: string
    kind: string
    footprint: { w: number; h: number }
  }

  const rawBuf = readFileSync(join(from, 'raws', `${b.raw}.png`))
  const raw = await decodePng(rawBuf)
  const cellPx = buildingCellPx(b.fp)
  const r = spriteCell(keyBg(raw), { cellPx, anchor: 'feet' })
  const anchor = cellAnchor(r.cell)

  const before = await decodePng(readFileSync(join(from, 'cell.png')))
  const density = spriteDensity({
    canvas: { w: cellPx, h: cellPx },
    footprint: b.fp,
    tile: TOWN_TILE,
  })
  members.push({ name: b.dir, density })
  // ★ THE GATE USED TO RUN AFTER THE WRITE. It decides now, and a refused building skips its
  // own write and lets the rest of the run finish. The palette distance is reported, not judged.
  const fails = integerScaleGate({ w: raw.width, h: raw.height }, { w: cellPx, h: cellPx }).failures
  rows.push(
    `| ${b.dir} | ${b.fp.w}x${b.fp.h} | ${before.width}x${before.height} | ${cellPx}x${cellPx} | ` +
      `${raw.width}/${r.plan.factor} (window ${r.plan.window}) | ` +
      `${density} | ${paletteDistance(r.cell).toFixed(1)} | ${fails.length === 0 ? 'clean' : fails.join('; ')} |`,
  )
  console.log(rows.at(-1))
  if (fails.length > 0) {
    refused.push(`${b.dir}: ${fails.join('; ')}`)
    continue
  }

  writeFileSync(join(to, 'cell.png'), await encodePng(r.cell))
  writeFileSync(
    join(to, 'manifest.json'),
    JSON.stringify(
      {
        version: 'v4-hires-building',
        kind: manifest.kind,
        footprint: manifest.footprint,
        cell: anchor,
      },
      null,
      2,
    ),
  )
  // KEEP THE RAWS: the source of this repair travels with its output.
  cpSync(join(from, 'raws', `${b.raw}.png`), join(to, 'raws', `${b.raw}.png`))
  // and the art it replaces, so the before/after is a file comparison, not a memory
  cpSync(join(from, 'cell.png'), join(to, 'before-cell.png'))
  cpSync(join(from, 'manifest.json'), join(to, 'before-manifest.json'))
}

const cls = classDensityGate(members)
const md = [
  '# buildings and structures — re-celled from the 1024 raws, $0.00',
  '',
  '| building | footprint | before | after | integer path | density | palette distance | pixel bar |',
  '|---|---|---|---|---|---|---|---|',
  ...rows,
  '',
  `class density: ${cls.densities.join(', ')} — ${cls.ok ? 'ONE density across the class' : cls.failures.join('; ')}`,
].join('\n')
mkdirSync(`${S}/fqc2/reports`, { recursive: true })
writeFileSync(`${S}/fqc2/reports/buildings.md`, md)
console.log(`\n${md}`)

// The report is on disk BEFORE the throw: it is what tells an operator whether the model or
// the threshold is wrong, and it is worthless if the failure eats it.
if (!cls.ok) refused.push(`class density: ${cls.failures.join('; ')}`)
if (refused.length > 0)
  throw new Error(
    `${refused.length} building(s) FAILED the pixel bar and were not written:\n    ` +
      `${refused.join('\n    ')}\n  The report is at ${S}/fqc2/reports/buildings.md.`,
  )

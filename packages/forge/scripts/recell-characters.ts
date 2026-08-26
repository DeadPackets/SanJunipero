// OFFLINE, $0.00 — re-cell all five founders from the raws their sheets were authored from.
// Raws: `master/master.png` plus the walk and sleep files named on report.txt's `chosen:` line.
// One WHOLE factor per cell so the figure lands on CHAR_FIGURE_PX and the renderer's scale is
// exactly 1/4 — factors 4 and 10, with a few-per-cent SOURCE correction, without which the
// walk cycle pulses 8%.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { decodePng, encodePng, type RawImage } from '../src/post/raw.js'
import { chromaKey } from '../src/post/chromaKey.js'
import { sliceStrip, opaqueBbox } from '../src/sheet.js'
import { buildManifestV4 } from '../src/hires.js'
import { deriveSheet, CELL_NAMES_V4 } from '../src/mirror.js'
import { CHAR_FIGURE_PX, reCell } from '../src/reCell.js'
import { alphaBinaryGate, paletteGate } from '../src/pixelGates.js'
import { SJ_SCRATCH } from './scratch.js'

const S = SJ_SCRATCH
const OUT = `${S}/fqc2/art-root`

// the cell canvas: 208 px of figure needs headroom for hair and a lying pose's length
export const CHAR_CELL_PX = 256

// `rawDirs` is searched in order. amara's shipped sheet came from the amara-v2 re-run
// (PROD_OUT), which is where its master-amara-c2edit and its se-contact-b-c1 actually live —
// only the finished cells were copied back into production/amara.
const CAST = [
  { id: 'omar', src: `${S}/c5/character-v4`, dest: `${OUT}/character-v4`, rawDirs: [`${S}/c5/character-v4/raws`] },
  { id: 'amara', src: `${S}/c5/production/amara`, dest: `${OUT}/production/amara`, rawDirs: [`${S}/c5/production/amara/raws`, `${S}/c5/production/amara-v2/raws`] },
  { id: 'yusuf', src: `${S}/c5/production/yusuf`, dest: `${OUT}/production/yusuf`, rawDirs: [`${S}/c5/production/yusuf/raws`] },
  { id: 'nadia', src: `${S}/c5/production/nadia`, dest: `${OUT}/production/nadia`, rawDirs: [`${S}/c5/production/nadia/raws`, `${S}/c5/production/nadia-attempt2/raws`] },
  { id: 'salma', src: `${S}/c5/production/salma`, dest: `${OUT}/production/salma`, rawDirs: [`${S}/c5/production/salma/raws`] },
]

function findRaw(dirs: readonly string[], key: string): string {
  for (const d of dirs) { const p = join(d, `${key}.png`); if (existsSync(p)) return p }
  throw new Error(`raw ${key}.png not found in ${dirs.join(', ')}`)
}

function keyBg(img: RawImage): RawImage {
  for (const tolerance of [72, 110]) {
    const keyed = chromaKey(img, { tolerance })
    let clear = 0
    for (let i = 3; i < keyed.data.length; i += 4) if (keyed.data[i] === 0) clear++
    if (clear / (keyed.width * keyed.height) >= 0.10) return keyed
  }
  throw new Error('keyBg: <10% keyed even at tolerance 110')
}

// report.txt's `chosen:` line, which names every raw that made the shipped sheet
function chosenRaws(dir: string): Record<string, string> | null {
  const p = join(dir, 'report.txt')
  if (!existsSync(p)) return null
  const line = readFileSync(p, 'utf8').split('\n').find((l) => l.startsWith('chosen: master='))
  if (line === undefined) return null
  const out: Record<string, string> = {}
  for (const part of line.replace('chosen: ', '').split(' ')) {
    const [k, v] = part.split('=')
    if (k !== undefined && v !== undefined) out[k] = v
  }
  return out
}

const rows: string[] = []
const factors = new Set<number>()
const refused: string[] = []

for (const c of CAST) {
  const chosen = chosenRaws(c.src)
  if (chosen === null) { console.log(`${c.id}: no chosen= line in report.txt — SKIPPED`); continue }
  const walks = (chosen['walk'] ?? '').split(',').filter(Boolean)
  const sleepKey = chosen['sleep']
  if (walks.length !== 6 || sleepKey === undefined) {
    console.log(`${c.id}: report.txt names ${walks.length} walk raws and sleep=${sleepKey} — SKIPPED`)
    continue
  }

  // the master pair: one generation, two figures side by side
  const masterRaw = await decodePng(readFileSync(join(c.src, 'master', 'master.png')))
  const segs = sliceStrip(keyBg(masterRaw), 2)
  const idle = {
    se: reCell(segs[0]!, { cellPx: CHAR_CELL_PX, targetFigurePx: CHAR_FIGURE_PX, anchor: 'feet' }),
    ne: reCell(segs[1]!, { cellPx: CHAR_CELL_PX, targetFigurePx: CHAR_FIGURE_PX, anchor: 'feet' }),
  }

  const poses = ['contact-a', 'passing', 'contact-b'] as const
  const strips = {
    se: { idle: idle.se.cell } as Record<string, RawImage>,
    ne: { idle: idle.ne.cell } as Record<string, RawImage>,
  }
  const cellPlans: { name: string; factor: number; scale: number; figure: number }[] = [
    { name: 'idle-se', factor: idle.se.plan.factor, scale: idle.se.plan.sourceScale, figure: idle.se.figurePx },
    { name: 'idle-ne', factor: idle.ne.plan.factor, scale: idle.ne.plan.sourceScale, figure: idle.ne.figurePx },
  ]
  // report.txt lists the six walk raws se-first, in pose order
  for (const [i, key] of walks.entries()) {
    const facing = i < 3 ? 'se' : 'ne'
    const pose = poses[i % 3]!
    const raw = await decodePng(readFileSync(findRaw(c.rawDirs, key)))
    const r = reCell(keyBg(raw), { cellPx: CHAR_CELL_PX, targetFigurePx: CHAR_FIGURE_PX, anchor: 'feet' })
    strips[facing][pose] = r.cell
    cellPlans.push({ name: `${pose}-${facing}`, factor: r.plan.factor, scale: r.plan.sourceScale, figure: r.figurePx })
  }

  // the sleeping figure is measured along its BODY, which is its width
  const sleepRaw = await decodePng(readFileSync(findRaw(c.rawDirs, sleepKey)))
  const sleep = reCell(keyBg(sleepRaw), {
    cellPx: CHAR_CELL_PX, targetFigurePx: CHAR_FIGURE_PX, figureAxis: 'width', anchor: 'centre',
  })
  cellPlans.push({ name: 'sleep', factor: sleep.plan.factor, scale: sleep.plan.sourceScale, figure: sleep.figurePx })

  const cells = deriveSheet({
    strips: {
      se: { idle: strips.se['idle']!, 'contact-a': strips.se['contact-a']!, passing: strips.se['passing']!, 'contact-b': strips.se['contact-b']! },
      ne: { idle: strips.ne['idle']!, 'contact-a': strips.ne['contact-a']!, passing: strips.ne['passing']!, 'contact-b': strips.ne['contact-b']! },
    },
    sleep: sleep.cell,
  })

  // figureH is what the renderer divides CHAR_TARGET_PX by; the standing figure decides it
  const standing = opaqueBbox(idle.se.cell)!
  const figureH = standing.y1 - standing.y0 + 1
  const manifest = buildManifestV4(cells, figureH)

  const before = JSON.parse(readFileSync(join(c.src, 'manifest.json'), 'utf8')) as { figureH: number; cells: Record<string, { w: number; h: number }> }
  const beforeSizes = [...new Set(Object.values(before.cells).map((v) => `${v.w}x${v.h}`))]
  // ★ THE PIXEL BAR USED TO RUN AFTER ALL 24 CELLS WERE ON DISK, and its verdict went into a
  // markdown cell. It decides now: a founder whose cells fail is not written, and the loop
  // carries on to the next one so one bad sheet does not cost the others.
  const fails: string[] = []
  for (const [name, img] of cells) {
    fails.push(...alphaBinaryGate(img).failures.map((f) => `${name}: ${f}`))
    fails.push(...paletteGate(img).failures.map((f) => `${name}: ${f}`))
    if (img.width !== CHAR_CELL_PX || img.height !== CHAR_CELL_PX) fails.push(`${name}: ${img.width}x${img.height}`)
  }
  for (const p of cellPlans) factors.add(p.factor)
  if (fails.length === 0) {
    mkdirSync(join(c.dest, 'cells'), { recursive: true })
    mkdirSync(join(c.dest, 'raws'), { recursive: true })
    mkdirSync(join(c.dest, 'master'), { recursive: true })
    for (const [name, img] of cells) writeFileSync(join(c.dest, 'cells', `${name}.png`), await encodePng(img))
    writeFileSync(join(c.dest, 'manifest.json'), JSON.stringify(manifest, null, 2))
    // KEEP THE RAWS beside the output, and the art it replaces beside them
    cpSync(join(c.src, 'master', 'master.png'), join(c.dest, 'master', 'master.png'))
    for (const key of [...walks, sleepKey]) cpSync(findRaw(c.rawDirs, key), join(c.dest, 'raws', `${key}.png`))
    mkdirSync(join(c.dest, 'before'), { recursive: true })
    for (const name of CELL_NAMES_V4) cpSync(join(c.src, 'cells', `${name}.png`), join(c.dest, 'before', `${name}.png`))
    cpSync(join(c.src, 'manifest.json'), join(c.dest, 'before-manifest.json'))
  } else refused.push(`${c.id}: ${fails.join('; ')}`)
  const figures = cellPlans.filter((p) => p.name !== 'sleep').map((p) => p.figure)
  const worstScale = cellPlans.reduce((w, p) => Math.max(w, Math.abs(1 - p.scale)), 0)
  rows.push(`| ${c.id} | ${beforeSizes.length} sizes, ${beforeSizes.slice(0, 2).join(' ')}${beforeSizes.length > 2 ? ' …' : ''} `
    + `| ${CHAR_CELL_PX}x${CHAR_CELL_PX} x24 | ${[...new Set(cellPlans.map((p) => p.factor))].sort((a, b) => a - b).join(', ')} `
    + `| ${before.figureH} → ${figureH} | ${Math.min(...figures)}–${Math.max(...figures)} | ${(100 * worstScale).toFixed(1)}% `
    + `| ${fails.length === 0 ? 'clean' : fails.slice(0, 2).join('; ')} |`)
  console.log(rows.at(-1))
}

const md = [
  '# the cast, re-celled from the raws, $0.00',
  '',
  `Every cell is ${CHAR_CELL_PX}x${CHAR_CELL_PX} with the figure at ${CHAR_FIGURE_PX} px, which makes the renderer's`,
  "`CHAR_TARGET_PX / figureH` exactly 1/4 and the 4x zoom stop exactly 1:1.",
  '',
  '| founder | before | after | integer factors | figureH | figure spread across cells | worst source correction | pixel bar |',
  '|---|---|---|---|---|---|---|---|',
  ...rows,
  '',
  `integer factors used across the whole cast: ${[...factors].sort((a, b) => a - b).join(', ')}`,
].join('\n')
mkdirSync(`${S}/fqc2/reports`, { recursive: true })
writeFileSync(`${S}/fqc2/reports/characters.md`, md)
console.log(`\n${md}`)

// Report first, then the wall: the margins are what tell an operator a threshold from a
// broken cell, and they are worthless if the failure eats them.
if (refused.length > 0) throw new Error(
  `${refused.length} founder(s) FAILED the pixel bar and were not written:\n    `
  + `${refused.join('\n    ')}\n  The report is at ${S}/fqc2/reports/characters.md.`)

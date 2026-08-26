// OFFLINE, $0.00 — re-cell one founder's sleep cells from a NAMED raw.
// recell-characters resolves `sleep=<key>` by first hit across `rawDirs`, and two directories
// hold a file of that name — so the v1 raw shadowed the corrected v2 orientation.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { decodePng, encodePng, type RawImage } from '../src/post/raw.js'
import { chromaKey } from '../src/post/chromaKey.js'
import { mirrorX } from '../src/sheet.js'
import { cellAnchor } from '../src/hires.js'
import { CHAR_FIGURE_PX, reCell } from '../src/reCell.js'
import { sleepAxisDeg, sleepAxisGate } from '../src/mirror.js'
import { alphaBinaryGate, paletteGate } from '../src/pixelGates.js'
import { SJ_SCRATCH } from './scratch.js'

const S = SJ_SCRATCH
const ROOT = `${S}/fqc2/art-root`
const CHAR_CELL_PX = 256

const FOUNDER = process.env.FOUNDER
const SLEEP_RAW = process.env.SLEEP_RAW
if (FOUNDER === undefined || SLEEP_RAW === undefined) throw new Error('FOUNDER and SLEEP_RAW are required')
const DEST = join(ROOT, FOUNDER)
if (!existsSync(DEST)) throw new Error(`${DEST} does not exist`)

function keyBg(img: RawImage): RawImage {
  for (const tolerance of [72, 110]) {
    const keyed = chromaKey(img, { tolerance })
    let clear = 0
    for (let i = 3; i < keyed.data.length; i += 4) if (keyed.data[i] === 0) clear++
    if (clear / (keyed.width * keyed.height) >= 0.10) return keyed
  }
  throw new Error('keyBg: <10% keyed even at tolerance 110')
}

const before = await decodePng(readFileSync(join(DEST, 'cells', 'sleep-se.png')))
const raw = await decodePng(readFileSync(SLEEP_RAW))
const r = reCell(keyBg(raw), {
  cellPx: CHAR_CELL_PX, targetFigurePx: CHAR_FIGURE_PX, figureAxis: 'width', anchor: 'centre',
})
const flip = mirrorX(r.cell)

// KEEP THE RAWS: the source of this repair travels with its output, and so does what it replaced
mkdirSync(join(DEST, 'raws'), { recursive: true })
mkdirSync(join(DEST, 'before'), { recursive: true })
cpSync(SLEEP_RAW, join(DEST, 'raws', basename(SLEEP_RAW)))
for (const n of ['sleep-se', 'sleep-sw', 'sleep-ne', 'sleep-nw'])
  cpSync(join(DEST, 'cells', `${n}.png`), join(DEST, 'before', `${n}.png`))

// ★ THE THREE GATES USED TO RUN AFTER ALL FOUR CELLS AND THE MANIFEST WERE ON DISK, and go
// into one log line. This script's whole job is to repair a sleep cell whose AXIS was wrong,
// so shipping one that still fails `sleepAxisGate` is the one thing it must not do.
const fails = [...alphaBinaryGate(r.cell).failures, ...paletteGate(r.cell).failures,
  ...sleepAxisGate(r.cell).map(f => `${f.gate} ${f.value.toFixed(1)} (limit ${f.limit})`)]
console.log(`${FOUNDER}  raw=${basename(SLEEP_RAW)}`)
console.log(`  axis  ${sleepAxisDeg(before).toFixed(1)}  ->  ${sleepAxisDeg(r.cell).toFixed(1)}`)
console.log(`  cell  ${r.cell.width}x${r.cell.height}  factor ${r.plan.factor}  source x${r.plan.sourceScale.toFixed(3)}`)
console.log(`  gates ${fails.length === 0 ? 'clean' : fails.join('; ')}`)
if (fails.length > 0) throw new Error(
  `${FOUNDER}: the repaired sleep cell FAILS its own gates and was not written.\n    `
  + `${fails.join('\n    ')}\n  The four cells and the manifest are untouched.`)

writeFileSync(join(DEST, 'cells', 'sleep-se.png'), await encodePng(r.cell))
writeFileSync(join(DEST, 'cells', 'sleep-sw.png'), await encodePng(r.cell))
writeFileSync(join(DEST, 'cells', 'sleep-ne.png'), await encodePng(flip))
writeFileSync(join(DEST, 'cells', 'sleep-nw.png'), await encodePng(flip))

// only the four sleep anchors move; every other cell in the sheet is untouched
const mPath = join(DEST, 'manifest.json')
const manifest = JSON.parse(readFileSync(mPath, 'utf8')) as
  { version: string; figureH: number; cells: Record<string, unknown> }
manifest.cells['sleep-se'] = cellAnchor(r.cell)
manifest.cells['sleep-sw'] = cellAnchor(r.cell)
manifest.cells['sleep-ne'] = cellAnchor(flip)
manifest.cells['sleep-nw'] = cellAnchor(flip)
writeFileSync(mPath, JSON.stringify(manifest, null, 2))

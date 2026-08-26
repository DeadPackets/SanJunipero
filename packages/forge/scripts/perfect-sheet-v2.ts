// OFFLINE — zero API spend. Pipeline v7 (v6 + outline blend repair).
// Drift field and sheet-wide merge are DROPPED: reconErr regression and linkage chaining.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import sharp from 'sharp'
import { decodePng, encodePng, type RawImage } from '../src/post/raw.js'
import { chromaKey } from '../src/post/chromaKey.js'
import {
  FACINGS, POSES, assembleGrid, duplicateReport, estimatePitch, registerToReference,
  sheetMetrics, v7Chain, opaqueBbox, upscaleNearest, distanceMatrix, pairwiseMedian,
  type Facing, type Pose,
} from '../src/sheet.js'

const OUT = 'packages/forge/out/character-sheet-v2'
const DURABLE = '/private/tmp/claude-501/-Users-deadpackets-workspace-SanJunipero/461805e8-9eb9-4d32-b2ea-e2ef16ce8545/scratchpad/c5'
const SHEET_DIR = `${DURABLE}/character-sheet-v2`
const REFS_DIR = `${DURABLE}/refs-v2`
const GIFS_DIR = `${DURABLE}/walk-gifs`
const CROPS_DIR = `${DURABLE}/pipeline-v3-stages/final-crops`
const REF_CANDIDATES = '/Users/deadpackets/workspace/SanJunipero/.claude/scratch/c5/reference-candidates'
for (const d of [GIFS_DIR, CROPS_DIR, REFS_DIR, 'packages/forge/out/refs-v2', `${OUT}/cells`]) mkdirSync(d, { recursive: true })

const label = (f: Facing, p: Pose) => `${f}/${p}`
const file = (f: Facing, p: Pose) => `${p}-${f}.png`

function bbox(img: RawImage) {
  const b = opaqueBbox(img)
  if (!b) throw new Error('empty sprite')
  return { ...b, w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1 }
}

type Processed = ReturnType<typeof v7Chain>
function runV7(keyed: RawImage, pitch: number, name: string): Processed {
  const c = v7Chain(keyed, pitch)
  if (c.despeckleRemoved > 0)
    console.log(`  ${name}: despeckle removed ${c.despeckleRemoved} px${c.despeckleRemoved > 2 ? ' ** FLAG >2 **' : ''}`)
  return c
}

// 1. Characters: per-cell pitch -> sheetPitch median -> v7 chain at sheetPitch.
const keyedCells = new Map<string, RawImage>()
const pitches: number[] = []
for (const p of POSES) for (const f of FACINGS) {
  const keyed = chromaKey(await decodePng(readFileSync(`${SHEET_DIR}/raws/${file(f, p)}`)))
  keyedCells.set(label(f, p), keyed)
  const pi = estimatePitch(keyed)
  pitches.push(pi)
  console.log(`${label(f, p)}: pitch ${pi.toFixed(2)}`)
}
const sorted = [...pitches].sort((a, b) => a - b)
const sheetPitch = sorted[Math.floor(sorted.length / 2)]!
console.log(`sheetPitch (median): ${sheetPitch.toFixed(2)}`)

const proc = new Map<string, Processed>()
for (const p of POSES) for (const f of FACINGS)
  proc.set(label(f, p), runV7(keyedCells.get(label(f, p))!, sheetPitch, label(f, p)))

// Canvas rule: any art height > 88 -> 128/118 for the whole sheet.
const maxH = Math.max(...[...proc.values()].map(c => c.out.height))
const CANVAS = maxH > 88 ? 128 : 96
const FEET_Y = maxH > 88 ? 118 : 88
console.log(`max art height ${maxH} -> canvas ${CANVAS}x${CANVAS} feetY ${FEET_Y}`)

function place(img: RawImage, tx: number, ty: number): RawImage {
  const b = bbox(img)
  tx = Math.min(CANVAS - 1 - b.x1, Math.max(-b.x0, tx))
  const out = new Uint8ClampedArray(CANVAS * CANVAS * 4)
  let dropped = 0
  for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) {
    const s = (y * img.width + x) * 4
    if (img.data[s + 3] === 0) continue
    const cx = x + tx, cy = y + ty
    if (cx < 0 || cy < 0 || cx >= CANVAS || cy >= CANVAS) { dropped++; continue }
    out.set(img.data.subarray(s, s + 4), (cy * CANVAS + cx) * 4)
  }
  if (dropped > 0) throw new Error(`place: ${dropped} opaque pixels dropped outside the ${CANVAS}x${CANVAS} canvas`)
  return { width: CANVAS, height: CANVAS, data: out }
}

const cells = new Map<string, RawImage>()
for (const f of FACINGS) {
  const idle = proc.get(label(f, 'idle'))!.out
  const bI = bbox(idle)
  const placedIdle = place(idle, Math.floor((CANVAS - bI.w) / 2) - bI.x0, FEET_Y - bI.y1)
  cells.set(label(f, 'idle'), placedIdle)
  for (const p of ['walk-a', 'walk-b'] as const) {
    const walk = proc.get(label(f, p))!.out
    const bW = bbox(walk)
    const ownTx = Math.floor((CANVAS - bW.w) / 2) - bW.x0
    const placed0 = place(walk, ownTx, FEET_Y - bW.y1)
    const { dx } = registerToReference(placedIdle, placed0)
    if (dx !== 0) console.log(`${label(f, p)}: registration dx=${dx}`)
    cells.set(label(f, p), dx === 0 ? placed0 : place(walk, ownTx + dx, FEET_Y - bW.y1))
  }
}

// 2. Per-cell metrics (cluster-dominance definition; v4's soft-lattice flags were a
// 5-bit binning artifact and are RETRACTED — see style-bible + report).
console.log('per-cell metrics (cluster ambiguous% / dupRows / reconErr / sweep / snaps / exclDelta):')
const metricLines: string[] = []
for (const p of POSES) for (const f of FACINGS) {
  const c = proc.get(label(f, p))!
  const m = sheetMetrics([c])
  const line = `${label(f, p).padEnd(12)} ${`${c.out.width}x${c.out.height}`.padEnd(8)} ${m.ambiguousPct.toFixed(1).padStart(5)}%  ${m.dupRowCount}  ${m.reconErr.toFixed(4)}  sweep=${c.sweepHits}  snaps=${c.outlineSnaps}o+${c.fillSnaps}f  excl=${c.exclDelta >= 0 ? "+" : ""}${c.exclDelta.toFixed(5)}`
  metricLines.push(line)
  console.log(`  ${line}`)
}

// 3. Refs at natural heights.
const refInputs: [string, string][] = [
  ['building-1', `${REF_CANDIDATES}/building-1.png`],
  ['item-1', `${REF_CANDIDATES}/item-1.png`],
  ['se-cottage', `${DURABLE}/building-facing/candidates/1.png`],
]
for (const [name, path] of refInputs) {
  const keyed = chromaKey(await decodePng(readFileSync(path)))
  const pitch = estimatePitch(keyed)
  const c = runV7(keyed, pitch, name)
  const m = sheetMetrics([c])
  metricLines.push(`${name.padEnd(12)} ${`${c.out.width}x${c.out.height}`.padEnd(8)} ${m.ambiguousPct.toFixed(1).padStart(5)}%  ${m.dupRowCount}  ${m.reconErr.toFixed(4)}  sweep=${c.sweepHits}  snaps=${c.outlineSnaps}o+${c.fillSnaps}f  excl=${c.exclDelta >= 0 ? "+" : ""}${c.exclDelta.toFixed(5)}`)
  console.log(`${name}: pitch ${pitch.toFixed(2)}, natural ${c.out.width}x${c.out.height}, ambiguous ${m.ambiguousPct.toFixed(1)}%, sweep=${c.sweepHits}  snaps=${c.outlineSnaps}o+${c.fillSnaps}f  excl=${c.exclDelta >= 0 ? "+" : ""}${c.exclDelta.toFixed(5)}`)
  const png = await encodePng(c.out)
  writeFileSync(`packages/forge/out/refs-v2/${name}.png`, png)
  writeFileSync(`${REFS_DIR}/${name}.png`, png)
  writeFileSync(`${REFS_DIR}/${name}-4x.png`, await encodePng(upscaleNearest(c.out, 4)))
}

// 4. Assemble + persist everything.
const sheet = assembleGrid(POSES.map(p => FACINGS.map(f => cells.get(label(f, p))!)), CANVAS, CANVAS)
const sheetPng = await encodePng(sheet)
writeFileSync(`${OUT}/sheet.png`, sheetPng)
writeFileSync(`${SHEET_DIR}/sheet.png`, sheetPng)
writeFileSync(`${SHEET_DIR}/sheet-4x.png`, await encodePng(upscaleNearest(sheet, 4)))
for (const p of POSES) for (const f of FACINGS) {
  const png = await encodePng(cells.get(label(f, p))!)
  writeFileSync(`${OUT}/cells/${file(f, p)}`, png)
  writeFileSync(`${SHEET_DIR}/cells/${file(f, p)}`, png)
}
for (const [f, p] of [['sw', 'idle'], ['se', 'idle'], ['ne', 'walk-a'], ['sw', 'walk-b'], ['nw', 'walk-a']] as [Facing, Pose][]) {
  const cell = cells.get(label(f, p))!
  writeFileSync(`${CROPS_DIR}/${file(f, p)}`, await encodePng(cell))
  writeFileSync(`${CROPS_DIR}/${file(f, p).replace('.png', '-4x.png')}`, await encodePng(upscaleNearest(cell, 4)))
}
for (const f of FACINGS) {
  const frames = (['idle', 'walk-a', 'idle', 'walk-b'] as const)
    .map(p => upscaleNearest(cells.get(label(f, p))!, 4))
  const fw = frames[0]!.width, fh = frames[0]!.height
  const stacked = new Uint8ClampedArray(fw * fh * frames.length * 4)
  frames.forEach((fr, i) => stacked.set(fr.data, fw * fh * 4 * i))
  const gif = await sharp(Buffer.from(stacked.buffer), {
    raw: { width: fw, height: fh * frames.length, channels: 4, pageHeight: fh },
  }).gif({ delay: frames.map(() => 180), loop: 0 }).toBuffer()
  const meta = await sharp(gif, { animated: true }).metadata()
  if (meta.pages !== frames.length) throw new Error(`walk-${f}.gif: expected ${frames.length} pages, got ${meta.pages}`)
  writeFileSync(`${GIFS_DIR}/walk-${f}.gif`, gif)
  console.log(`walk-${f}.gif: ${frames.length} frames, ${gif.length} bytes`)
}

// 5. Distance matrix, thresholds recalibrated (0.36x / 0.21x pairwise median).
const labels = POSES.flatMap(p => FACINGS.map(f => label(f, p)))
const median = pairwiseMedian(labels.map(l => cells.get(l)!))
const STRAIGHT_THR = 0.36 * median, MIRROR_THR = 0.21 * median
const matrix = (mirror: boolean) => distanceMatrix(labels.map(l => ({ label: l, img: cells.get(l)! })), mirror)
const rows = POSES.flatMap(p => duplicateReport(
  FACINGS.map(f => ({ label: label(f, p), img: cells.get(label(f, p))! })), STRAIGHT_THR, MIRROR_THR))
const cols = FACINGS.flatMap(f => duplicateReport(
  POSES.map(p => ({ label: label(f, p), img: cells.get(label(f, p))! })), STRAIGHT_THR, MIRROR_THR))
const report = [
  `== PIPELINE V7: sheetPitch ${sheetPitch.toFixed(2)}, natural heights, canvas ${CANVAS} feetY ${FEET_Y} ==`,
  '(v4 soft-lattice flags RETRACTED: 5-bit binning artifact; cluster-dominance is the metric)',
  '', '== per-output metrics (cluster ambiguous% / dupRows / reconErr / sweep / snaps / exclDelta) ==',
  ...metricLines,
  '',
  `pairwise median=${median.toFixed(3)}; thresholds straight<${STRAIGHT_THR.toFixed(3)} mirror<${MIRROR_THR.toFixed(3)}`,
  '', '== straight distance matrix (12x12) ==', matrix(false),
  '', '== mirrored distance matrix (12x12, col cell mirrored) ==', matrix(true),
  '', '== dupe findings ==',
  ...(rows.length + cols.length === 0 ? ['none'] : [
    ...rows.map(fd => `row  ${fd.a} ~ ${fd.b} d=${fd.distance.toFixed(3)} mirrored=${fd.mirrored}`),
    ...cols.map(fd => `col  ${fd.a} ~ ${fd.b} d=${fd.distance.toFixed(3)} mirrored=${fd.mirrored}`),
  ]),
].join('\n')
writeFileSync(`${SHEET_DIR}/distance-matrix-final.txt`, report)
console.log(report)

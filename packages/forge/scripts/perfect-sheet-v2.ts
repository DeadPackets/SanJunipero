// OFFLINE — zero API spend. PIPELINE V3 FINAL (controller-approved): rebuild the 12
// character cells + 3 refs from cached raws via chromaKey → pitch-derived erode →
// resampleToArtHeight → despeckle → fillPinholes → registration → anchor. No defringe,
// no detectArtScale/snapToGrid, no quantization — sprites ship with generated colors.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import sharp from 'sharp'
import { decodePng, encodePng, type RawImage } from '../src/post/raw.js'
import { chromaKey } from '../src/post/chromaKey.js'
import {
  FACINGS, POSES, assembleGrid, cellDistance, mirrorX, duplicateReport,
  erodeForPitch, resampleToArtHeight, despeckle, fillPinholes, registerToReference,
  type Facing, type Pose,
} from '../src/sheet.js'

const OUT = 'packages/forge/out/character-sheet-v2'
const DURABLE = '/private/tmp/claude-501/-Users-deadpackets-workspace-SanJunipero/461805e8-9eb9-4d32-b2ea-e2ef16ce8545/scratchpad/c5'
const SHEET_DIR = `${DURABLE}/character-sheet-v2`
const REFS_DIR = `${DURABLE}/refs-v2`
const GIFS_DIR = `${DURABLE}/walk-gifs`
const CROPS_DIR = `${DURABLE}/pipeline-v3-stages/final-crops`
const REF_CANDIDATES = '/Users/deadpackets/workspace/SanJunipero/.claude/scratch/c5/reference-candidates'
for (const d of [GIFS_DIR, CROPS_DIR, 'packages/forge/out/refs-v2']) mkdirSync(d, { recursive: true })

const CANVAS = 96, FEET_Y = 88, ART_H = 64
const label = (f: Facing, p: Pose) => `${f}/${p}`
const file = (f: Facing, p: Pose) => `${p}-${f}.png`

function bbox(img: RawImage) {
  let x0 = img.width, x1 = -1, y0 = img.height, y1 = -1
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++)
    if (img.data[(y * img.width + x) * 4 + 3]! > 0) {
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  if (x1 < 0) throw new Error('empty sprite')
  return { x0, x1, y0, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}
function place(img: RawImage, tx: number, ty: number): RawImage {
  const b = bbox(img)
  tx = Math.min(CANVAS - 1 - b.x1, Math.max(-b.x0, tx))
  const out = new Uint8ClampedArray(CANVAS * CANVAS * 4)
  for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) {
    const s = (y * img.width + x) * 4
    if (img.data[s + 3] === 0) continue
    const cx = x + tx, cy = y + ty
    if (cx < 0 || cy < 0 || cx >= CANVAS || cy >= CANVAS) continue
    out.set(img.data.subarray(s, s + 4), (cy * CANVAS + cx) * 4)
  }
  return { width: CANVAS, height: CANVAS, data: out }
}
function upscaleNearest(img: RawImage, k: number): RawImage {
  const out = new Uint8ClampedArray(img.width * k * img.height * k * 4)
  for (let y = 0; y < img.height * k; y++) for (let x = 0; x < img.width * k; x++) {
    const s = ((y / k | 0) * img.width + (x / k | 0)) * 4
    out.set(img.data.subarray(s, s + 4), (y * img.width * k + x) * 4)
  }
  return { width: img.width * k, height: img.height * k, data: out }
}
function chain(keyed: RawImage, targetH: number): RawImage {
  return fillPinholes(despeckle(resampleToArtHeight(erodeForPitch(keyed, targetH), targetH), 3), 2)
}

// 1. Characters: v3 chain to 64-tall natives, then per-column registration + anchor.
const nat = new Map<string, RawImage>()
for (const p of POSES) for (const f of FACINGS) {
  const keyed = chromaKey(await decodePng(readFileSync(`${SHEET_DIR}/raws/${file(f, p)}`)))
  const n = chain(keyed, ART_H)
  nat.set(label(f, p), n)
  console.log(`${label(f, p)}: native ${n.width}x${n.height}`)
}
const cells = new Map<string, RawImage>()
for (const f of FACINGS) {
  const idle = nat.get(label(f, 'idle'))!
  const bI = bbox(idle)
  const placedIdle = place(idle, Math.floor((CANVAS - bI.w) / 2) - bI.x0, FEET_Y - bI.y1)
  cells.set(label(f, 'idle'), placedIdle)
  for (const p of ['walk-a', 'walk-b'] as const) {
    const walk = nat.get(label(f, p))!
    const bW = bbox(walk)
    const ownTx = Math.floor((CANVAS - bW.w) / 2) - bW.x0
    const placed0 = place(walk, ownTx, FEET_Y - bW.y1)
    const { dx } = registerToReference(placedIdle, placed0)
    if (dx !== 0) console.log(`${label(f, p)}: dx=${dx}`)
    cells.set(label(f, p), dx === 0 ? placed0 : place(walk, ownTx + dx, FEET_Y - bW.y1))
  }
}

// 2. Refs at class targets (building/se-cottage 96, item 48); style-anchor stays raw.
const refInputs: [string, string, number][] = [
  ['building-1', `${REF_CANDIDATES}/building-1.png`, 96],
  ['item-1', `${REF_CANDIDATES}/item-1.png`, 48],
  ['se-cottage', `${DURABLE}/building-facing/candidates/1.png`, 96],
]
for (const [name, path, targetH] of refInputs) {
  const img = chain(chromaKey(await decodePng(readFileSync(path))), targetH)
  console.log(`${name}: native ${img.width}x${img.height}`)
  const png = await encodePng(img)
  writeFileSync(`packages/forge/out/refs-v2/${name}.png`, png)
  writeFileSync(`${REFS_DIR}/${name}.png`, png)
  writeFileSync(`${REFS_DIR}/${name}-4x.png`, await encodePng(upscaleNearest(img, 4)))
}

// 3. Assemble + persist sheet, cells, GIFs, inspection crops.
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
for (const [f, p] of [['sw', 'idle'], ['se', 'idle'], ['ne', 'walk-a'], ['sw', 'walk-b']] as [Facing, Pose][]) {
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

// 4. Matrices + findings, thresholds recalibrated (0.36x / 0.21x pairwise median).
const labels = POSES.flatMap(p => FACINGS.map(f => label(f, p)))
const dists: number[] = []
for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++)
  dists.push(cellDistance(cells.get(labels[i]!)!, cells.get(labels[j]!)!))
dists.sort((a, b) => a - b)
const median = dists[Math.floor(dists.length / 2)]!
const STRAIGHT_THR = 0.36 * median, MIRROR_THR = 0.21 * median
function matrix(mirror: boolean): string {
  const header = ['            ', ...labels.map(l => l.padStart(11))].join(' ')
  const lines = labels.map(la => [la.padEnd(12), ...labels.map(lb =>
    cellDistance(cells.get(la)!, mirror ? mirrorX(cells.get(lb)!) : cells.get(lb)!).toFixed(3).padStart(11))].join(' '))
  return [header, ...lines].join('\n')
}
const rows = POSES.flatMap(p => duplicateReport(
  FACINGS.map(f => ({ label: label(f, p), img: cells.get(label(f, p))! })), STRAIGHT_THR, MIRROR_THR))
const cols = FACINGS.flatMap(f => duplicateReport(
  POSES.map(p => ({ label: label(f, p), img: cells.get(label(f, p))! })), STRAIGHT_THR, MIRROR_THR))
const report = [
  '== PIPELINE V3 FINAL: pitch-derived erode + median resample (art height 64, cells 96x96) ==',
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

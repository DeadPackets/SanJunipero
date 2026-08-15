// OFFLINE — zero API spend. Perfection pass over cached raws: shared-scale snap,
// edge hygiene v2 (defringe + despeckle + pinholes), cross-cell union palette,
// per-column motion registration, sheet + refs rebuild, walk-cycle GIFs.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import sharp from 'sharp'
import { decodePng, encodePng, type RawImage } from '../src/post/raw.js'
import { chromaKey } from '../src/post/chromaKey.js'
import {
  FACINGS, POSES, assembleGrid, cellDistance, mirrorX, duplicateReport,
  detectArtScale, downscaleMajority, sheetScale, defringe, despeckle, fillPinholes,
  registerToReference, type Facing, type Pose,
} from '../src/sheet.js'

const OUT = 'packages/forge/out/character-sheet-v2'
const DURABLE = '/private/tmp/claude-501/-Users-deadpackets-workspace-SanJunipero/461805e8-9eb9-4d32-b2ea-e2ef16ce8545/scratchpad/c5'
const SHEET_DIR = `${DURABLE}/character-sheet-v2`
const REFS_DIR = `${DURABLE}/refs-v2`
const GIFS_DIR = `${DURABLE}/walk-gifs`
const REF_CANDIDATES = '/Users/deadpackets/workspace/SanJunipero/.claude/scratch/c5/reference-candidates'
mkdirSync(GIFS_DIR, { recursive: true })
mkdirSync('packages/forge/out/refs-v2', { recursive: true })

const CANVAS = 96, FEET_Y = 88
const STRAIGHT_THR = 0.149, MIRROR_THR = 0.087
const label = (f: Facing, p: Pose) => `${f}/${p}`
const file = (f: Facing, p: Pose) => `${p}-${f}.png`

function snapAt(img: RawImage, k: number): RawImage {
  return downscaleMajority(img, Math.max(1, Math.round(img.width / k)), Math.max(1, Math.round(img.height / k)))
}
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
// Translate content by (tx, ty) into a CANVAS² cell; tx clamped to keep the bbox inside.
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
const clean = (img: RawImage) => fillPinholes(despeckle(defringe(img), 3), 2)

// 1. Shared scale over the 12 character raws, raised until every sprite fits the canvas.
const keyed = new Map<string, RawImage>()
for (const p of POSES) for (const f of FACINGS)
  keyed.set(label(f, p), chromaKey(await decodePng(readFileSync(`${SHEET_DIR}/raws/${file(f, p)}`))))
let k = sheetScale([...keyed.values()])
const fits = (kk: number) => [...keyed.values()].every(img => {
  const b = bbox(snapAt(img, kk))
  return b.w <= CANVAS && b.h <= FEET_Y + 1
})
const modalK = k
while (!fits(k) && k < 16) k++
console.log(`shared scale: modal=${modalK} used=${k}`)

// 2-3. Snap at shared scale + edge hygiene v2 (characters), refs at their own scale.
const nat = new Map<string, RawImage>()
for (const [lbl, img] of keyed) nat.set(lbl, clean(snapAt(img, k)))
const refInputs: [string, string][] = [
  ['building-1', `${REF_CANDIDATES}/building-1.png`],
  ['item-1', `${REF_CANDIDATES}/item-1.png`],
  ['se-cottage', `${DURABLE}/building-facing/candidates/1.png`],
]
const refs = new Map<string, RawImage>()
for (const [name, path] of refInputs) {
  const rk = chromaKey(await decodePng(readFileSync(path)))
  refs.set(name, clean(snapAt(rk, detectArtScale(rk))))
}

// NO quantization: sprites ship with their generated colors (controller ruling —
// the 48-color union quantize was a visual regression; harmony is judge-enforced).

// 5. Per-column registration (idle = reference) + unit feet-anchor at FEET_Y.
const cells = new Map<string, RawImage>()
for (const f of FACINGS) {
  const idle = nat.get(label(f, 'idle'))!
  const bI = bbox(idle)
  const txI = Math.floor((CANVAS - bI.w) / 2) - bI.x0
  cells.set(label(f, 'idle'), place(idle, txI, FEET_Y - bI.y1))
  for (const p of ['walk-a', 'walk-b'] as const) {
    const walk = nat.get(label(f, p))!
    const { dx } = registerToReference(idle, walk)
    console.log(`${label(f, p)}: dx=${dx}`)
    cells.set(label(f, p), place(walk, txI + dx, FEET_Y - bbox(walk).y1))
  }
}

// 6. Assemble + persist sheet, cells, refs.
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
for (const [name, img] of refs) {
  const png = await encodePng(img)
  writeFileSync(`packages/forge/out/refs-v2/${name}.png`, png)
  writeFileSync(`${REFS_DIR}/${name}.png`, png)
  writeFileSync(`${REFS_DIR}/${name}-4x.png`, await encodePng(upscaleNearest(img, 4)))
}

// 7. Walk-cycle GIFs: idle -> walk-a -> idle -> walk-b at 4x, 180ms/frame.
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

// 8. Final matrices + findings.
const labels = POSES.flatMap(p => FACINGS.map(f => label(f, p)))
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
  '== PERFECTION PASS: shared scale + registration + hygiene v2 (no quantization) ==',
  `shared scale: modal=${modalK} used=${k}; sprites unquantized (palette harmony is judge-enforced)`,
  '', '== straight distance matrix (12x12) ==', matrix(false),
  '', '== mirrored distance matrix (12x12, col cell mirrored) ==', matrix(true),
  '', `== dupe findings (thresholds straight<${STRAIGHT_THR} mirror<${MIRROR_THR}) ==`,
  ...(rows.length + cols.length === 0 ? ['none'] : [
    ...rows.map(fd => `row  ${fd.a} ~ ${fd.b} d=${fd.distance.toFixed(3)} mirrored=${fd.mirrored}`),
    ...cols.map(fd => `col  ${fd.a} ~ ${fd.b} d=${fd.distance.toFixed(3)} mirrored=${fd.mirrored}`),
  ]),
].join('\n')
writeFileSync(`${SHEET_DIR}/distance-matrix-final.txt`, report)
console.log(report)

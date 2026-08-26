// Zero-spend facing repair: swaps mislabeled SE/SW cell pairs. Legal because SW cells are
// exact mirrors of SE, so a file swap re-labels the authored view.
// Usage: fix-facing-swap.ts <production-char-dir> [pose ...]
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import sharp from 'sharp'
import { decodePng, encodePng, type RawImage } from '../src/post/raw.js'
import { assembleGrid } from '../src/sheet.js'
import { cellAnchor, type CharacterManifestV4 } from '../src/hires.js'

const DIR = process.argv[2]
if (!DIR) throw new Error('usage: fix-facing-swap.ts <production-char-dir> [pose ...]')
const POSES = process.argv.length > 3 ? process.argv.slice(3) : ['idle', 'contact-a', 'passing-a', 'contact-b', 'passing-b']

const manifest = JSON.parse(readFileSync(`${DIR}/manifest.json`, 'utf8')) as CharacterManifestV4

function swapFiles(a: string, b: string): void {
  const tmp = `${a}.swap-tmp`
  renameSync(a, tmp)
  renameSync(b, a)
  renameSync(tmp, b)
}

for (const pose of POSES) {
  const se = manifest.cells[`${pose}-se`], sw = manifest.cells[`${pose}-sw`]
  if (!se || !sw) throw new Error(`${pose}: missing manifest entries`)
  // se/sw manifest entries must be identical (mirror law) or the swap would need a manifest rewrite
  if (se.w !== sw.w || se.h !== sw.h || se.feetX !== sw.feetX || se.feetY !== sw.feetY)
    throw new Error(`${pose}: se/sw manifest entries differ — refusing blind swap`)
  swapFiles(`${DIR}/cells/${pose}-se.png`, `${DIR}/cells/${pose}-sw.png`)
  console.log(`swapped cells ${pose}-se <-> ${pose}-sw`)
}

if (existsSync(`${DIR}/gifs/walk-se.gif`) && existsSync(`${DIR}/gifs/walk-sw.gif`)) {
  swapFiles(`${DIR}/gifs/walk-se.gif`, `${DIR}/gifs/walk-sw.gif`)
  console.log('swapped gifs walk-se <-> walk-sw')
}

if (existsSync(`${DIR}/master/master-se.png`)) {
  const flipped = await sharp(`${DIR}/master/master-se.png`).flop().png().toBuffer()
  writeFileSync(`${DIR}/master/master-se.png`, flipped)
  console.log('mirrored master/master-se.png in place')
}

// contact sheet rebuild from cells (same layout as gen-cast-v4)
const PREVIEW_CELL = 384
const PREVIEW_FIG_H = 320
const PREVIEW_FEET = { x: PREVIEW_CELL / 2, y: 352 }
async function previewCell(img: RawImage): Promise<RawImage> {
  const k = PREVIEW_FIG_H / manifest.figureH
  const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k))
  const buf = await sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength),
    { raw: { width: img.width, height: img.height, channels: 4 } })
    .resize(w, h, { kernel: 'lanczos3', fit: 'fill' }).raw().toBuffer()
  const scaled: RawImage = { width: w, height: h, data: new Uint8ClampedArray(buf) }
  const a = cellAnchor(img)
  const left = Math.round(PREVIEW_FEET.x - a.feetX * k), top = Math.round(PREVIEW_FEET.y - a.feetY * k)
  const out = new Uint8ClampedArray(PREVIEW_CELL * PREVIEW_CELL * 4)
  for (let y = 0; y < h; y++) {
    const dy = top + y
    if (dy < 0 || dy >= PREVIEW_CELL) continue
    for (let x = 0; x < w; x++) {
      const dx = left + x
      if (dx < 0 || dx >= PREVIEW_CELL) continue
      const s = (y * w + x) * 4
      if (scaled.data[s + 3] === 0) continue
      out.set(scaled.data.subarray(s, s + 4), (dy * PREVIEW_CELL + dx) * 4)
    }
  }
  return { width: PREVIEW_CELL, height: PREVIEW_CELL, data: out }
}
const preview = new Map<string, RawImage>()
for (const name of Object.keys(manifest.cells))
  preview.set(name, await previewCell(await decodePng(readFileSync(`${DIR}/cells/${name}.png`))))
const BLANK: RawImage = { width: PREVIEW_CELL, height: PREVIEW_CELL, data: new Uint8ClampedArray(PREVIEW_CELL * PREVIEW_CELL * 4) }
const pad = (row: RawImage[], cols: number) => [...row, ...Array(cols - row.length).fill(BLANK) as RawImage[]]
const walkRow = (f: string) => (['idle', 'contact-a', 'passing-a', 'contact-b'] as const).map(p => preview.get(`${p}-${f}`)!)
const rows: RawImage[][] = [
  pad([preview.get('idle-se')!, preview.get('idle-ne')!], 8),
  pad(walkRow('se'), 8),
  pad(walkRow('ne'), 8),
  pad([preview.get('sleep-se')!], 8),
  [...walkRow('sw'), ...walkRow('nw')],
]
writeFileSync(`${DIR}/contact-sheet.png`, await encodePng(assembleGrid(rows, PREVIEW_CELL, PREVIEW_CELL)))
console.log('contact-sheet.png rebuilt from cells')

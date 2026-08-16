// OFFLINE — zero API spend. Pipeline v3 inspection harness: runs ONE character cell
// (sw/idle cached raw) and building-1 through the v3 chain, dumping EVERY stage as
// PNG at 1:1 and 4x so a human can inspect true pixel structure. Does NOT touch the
// other 11 cells — the controller approves or adjusts before a full rebuild.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { decodePng, encodePng, type RawImage } from '../src/post/raw.js'
import { chromaKey } from '../src/post/chromaKey.js'
import { erodeAlpha, resampleToArtHeight, despeckle, fillPinholes, anchorToCanvas, upscaleNearest } from '../src/sheet.js'

const DURABLE = '/private/tmp/claude-501/-Users-deadpackets-workspace-SanJunipero/461805e8-9eb9-4d32-b2ea-e2ef16ce8545/scratchpad/c5'
const STAGES = `${DURABLE}/pipeline-v3-stages`
const REF_CANDIDATES = '/Users/deadpackets/workspace/SanJunipero/.claude/scratch/c5/reference-candidates'

function crop(img: RawImage, cx: number, cy: number, size = 128): RawImage {
  const x0 = Math.max(0, Math.min(img.width - size, cx - size / 2))
  const y0 = Math.max(0, Math.min(img.height - size, cy - size / 2))
  const out = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++)
    out.set(img.data.subarray(((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x0 + size) * 4), y * size * 4)
  return { width: size, height: size, data: out }
}

async function dump(dir: string, name: string, img: RawImage, with4x = true) {
  writeFileSync(`${dir}/${name}.png`, await encodePng(img))
  if (with4x) writeFileSync(`${dir}/${name}-4x.png`, await encodePng(upscaleNearest(img, 4)))
  console.log(`${name}: ${img.width}x${img.height}`)
}

async function run(kind: 'cell' | 'building', rawPath: string, targetH: number, canvas?: { w: number; h: number; feetY: number }) {
  const dir = `${STAGES}/${kind}`
  mkdirSync(dir, { recursive: true })
  const raw = await decodePng(readFileSync(rawPath))
  await dump(dir, '00-raw', raw, false)
  await dump(dir, '00-raw-crop-center', crop(raw, raw.width / 2, raw.height / 2), false)
  await dump(dir, '00-raw-crop-bottom', crop(raw, raw.width / 2, raw.height - 80), false)
  const keyed = chromaKey(raw)
  await dump(dir, '01-chromakey', keyed, false)
  const eroded = erodeAlpha(keyed, 1)
  await dump(dir, '02-erode', eroded, false)
  await dump(dir, '02-erode-crop-bottom', crop(eroded, eroded.width / 2, eroded.height - 80), false)
  const resampled = resampleToArtHeight(eroded, targetH)
  await dump(dir, `03-resample-h${targetH}`, resampled)
  const despeckled = despeckle(resampled, 3)
  await dump(dir, '04-despeckle', despeckled)
  const filled = fillPinholes(despeckled, 2)
  await dump(dir, '05-fillpinholes', filled)
  if (canvas) await dump(dir, '06-anchor', anchorToCanvas(filled, canvas.w, canvas.h, canvas.feetY))
}

// Character cell: art height 64 on a 96x96 canvas, feet at 88.
await run('cell', `${DURABLE}/character-sheet-v2/raws/idle-sw.png`, 64, { w: 96, h: 96, feetY: 88 })
// Building: art height 96 (class target; item would be 48), no canvas anchor — native sheet of 1.
await run('building', `${REF_CANDIDATES}/building-1.png`, 96)
console.log(`stages in ${STAGES}/{cell,building}/`)

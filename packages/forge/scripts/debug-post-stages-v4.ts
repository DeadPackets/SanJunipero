// OFFLINE — zero API spend. Pipeline v4 CHECKPOINT harness: sw/idle + building-1 only.
// chromaKey → pitch-derived erode (measured pitch) → refineLattice → mode resample
// (natural height from the lattice) → despeckle (logged) → fillPinholes → anchor.
// Dumps every stage 1:1 + 4x and prints v3 vs v4 jumble metrics. STOPS here.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { decodePng, encodePng, type RawImage } from '../src/post/raw.js'
import { chromaKey } from '../src/post/chromaKey.js'
import {
  erodeAlpha, erodeForPitch, estimatePitch, refineLattice, resampleModeLattice,
  resampleToArtHeight, despeckle, fillPinholes, anchorToCanvas, sheetMetrics, type Lattice,
} from '../src/sheet.js'

const DURABLE = '/private/tmp/claude-501/-Users-deadpackets-workspace-SanJunipero/461805e8-9eb9-4d32-b2ea-e2ef16ce8545/scratchpad/c5'
const STAGES = `${DURABLE}/pipeline-v4-stages`
const REF_CANDIDATES = '/Users/deadpackets/workspace/SanJunipero/.claude/scratch/c5/reference-candidates'

function upscaleNearest(img: RawImage, k: number): RawImage {
  const out = new Uint8ClampedArray(img.width * k * img.height * k * 4)
  for (let y = 0; y < img.height * k; y++) for (let x = 0; x < img.width * k; x++) {
    const s = ((y / k | 0) * img.width + (x / k | 0)) * 4
    out.set(img.data.subarray(s, s + 4), (y * img.width * k + x) * 4)
  }
  return { width: img.width * k, height: img.height * k, data: out }
}
async function dump(dir: string, name: string, img: RawImage) {
  writeFileSync(`${dir}/${name}.png`, await encodePng(img))
  writeFileSync(`${dir}/${name}-4x.png`, await encodePng(upscaleNearest(img, 4)))
  console.log(`  ${name}: ${img.width}x${img.height}`)
}
const opaqueCount = (img: RawImage) => {
  let n = 0
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i]! > 0) n++
  return n
}
const bboxOf = (img: RawImage) => {
  let x0 = img.width, x1 = -1, y0 = img.height, y1 = -1
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++)
    if (img.data[(y * img.width + x) * 4 + 3]! > 0) {
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  return { x0, x1, y0, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

async function run(kind: 'cell' | 'building', rawPath: string, v3TargetH: number, anchor: boolean) {
  const dir = `${STAGES}/${kind}`
  mkdirSync(dir, { recursive: true })
  console.log(`== ${kind} ==`)
  const keyed = chromaKey(await decodePng(readFileSync(rawPath)))
  const pitch = estimatePitch(keyed)
  console.log(`  measured pitch: ${pitch.toFixed(2)} (erode radius ${Math.max(1, Math.round(pitch / 2))})`)
  const eroded = erodeAlpha(keyed, Math.max(1, Math.round(pitch / 2)))
  await dump(dir, '01-erode', eroded)
  const b = bboxOf(eroded)
  const lat = refineLattice(eroded, pitch, { ox: b.x0, oy: b.y0 })
  console.log(`  lattice: px=${lat.px.toFixed(2)} py=${lat.py.toFixed(2)} ox=${lat.ox.toFixed(2)} oy=${lat.oy.toFixed(2)}`)
  const { out, dominance, origin } = resampleModeLattice(eroded, lat)
  await dump(dir, '02-resample-mode', out)
  const desp = despeckle(out, 3)
  const removed = opaqueCount(out) - opaqueCount(desp)
  console.log(`  despeckle removed ${removed} px${removed > 2 ? '  ** FLAG: >2 **' : ''}`)
  await dump(dir, '03-despeckle', desp)
  const filled = fillPinholes(desp, 2)
  await dump(dir, '04-fillpinholes', filled)
  if (anchor) await dump(dir, '05-anchor', anchorToCanvas(filled, 96, 96, 88))

  // v4 metrics on the resample output
  const v4m = sheetMetrics([{ out, dominance, eroded, lat, origin }])
  // v3 baseline: erodeForPitch + median resample at forced targetH
  const erodedV3 = erodeForPitch(keyed, v3TargetH)
  const outV3 = resampleToArtHeight(erodedV3, v3TargetH)
  const b3 = bboxOf(erodedV3)
  const p3 = b3.h / v3TargetH
  const latV3: Lattice = { px: p3, py: p3, ox: b3.x0 + b3.w / 2 - (outV3.width / 2) * p3, oy: b3.y1 + 1 - v3TargetH * p3 }
  const modeAtV3 = resampleModeLattice(erodedV3, latV3)
  const ambV3 = sheetMetrics([{ out: modeAtV3.out, dominance: modeAtV3.dominance, eroded: erodedV3, lat: latV3, origin: modeAtV3.origin }])
  const restV3 = sheetMetrics([{ out: outV3, dominance: new Float32Array(outV3.width * outV3.height).fill(1), eroded: erodedV3, lat: latV3, origin: { i0: 0, j0: 0 } }])
  console.log(`  metrics        ambiguous%   dupRows   reconErr`)
  console.log(`  v3 (h${v3TargetH})    ${ambV3.ambiguousPct.toFixed(1).padStart(8)}   ${String(restV3.dupRowCount).padStart(7)}   ${restV3.reconErr.toFixed(4)}`)
  console.log(`  v4 (natural)  ${v4m.ambiguousPct.toFixed(1).padStart(8)}   ${String(v4m.dupRowCount).padStart(7)}   ${v4m.reconErr.toFixed(4)}`)
}

await run('cell', `${DURABLE}/character-sheet-v2/raws/idle-sw.png`, 64, true)
await run('building', `${REF_CANDIDATES}/building-1.png`, 96, false)
console.log(`stages in ${STAGES}/{cell,building}/ — CHECKPOINT: full rebuild awaits controller approval`)
